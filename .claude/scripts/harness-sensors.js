#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateHarnessConfig } = require("../lib/harness-config");
const { createSensorResult, reportStatus } = require("../lib/sensor-contract");
const { loadSensorProfile, isApplicable } = require("../lib/sensor-profile");
const { loadSensorProfileFile } = require("../lib/sensor-profile");
const { checkBoundaries } = require("../lib/architecture-boundaries");
const { scanSecrets, runGitleaks } = require("../lib/secret-scan");
const { runAllMaintainabilitySensors } = require("../lib/maintainability-sensors");
const { loadWaivers, applyWaiver } = require("../lib/sensor-waivers");
const { redactEvidence } = require("../lib/evidence-hygiene");
const { loadControlManifest } = require("../lib/control-manifest");
const { gitChangedPaths, resolveInspectionPaths, workspaceFingerprint } = require("../lib/sensor-scope");
const { checkCouplingImpact, checkDependencyCycles } = require("../lib/dependency-sensors");
const { checkCoverage, checkGenerative, checkMutation, checkTestIntegrity } = require("../lib/regression-sensors");
const { appendSensorHistory, loadOperationsPolicy, readHistory } = require("../lib/sensor-operations");
const { applyQuarantine, loadQuarantines } = require("../lib/sensor-quarantine");

const runStartedAt = Date.now();

function parseArguments(args) {
  const parsed = { root: ".", changedPaths: [], all: false, failOnWarn: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--changed") {
      const changedPath = args[index + 1];
      if (!changedPath) throw new Error("--changed requires a project-relative path.");
      parsed.changedPaths.push(changedPath);
      index += 1;
    } else if (argument === "--all") {
      parsed.all = true;
    } else if (argument === "--fail-on-warn") {
      parsed.failOnWarn = true;
    } else if (!argument.startsWith("-") && parsed.root === ".") {
      parsed.root = argument;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return parsed;
}

function packageScriptExists(root, name) {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return Boolean(pkg.scripts && pkg.scripts[name]);
  } catch {
    return false;
  }
}

function diagnosticPaths(output, root, fallbackPaths) {
  const found = new Set();
  const pattern = /(?:^|\s)([A-Za-z0-9_./@-]+\.(?:[A-Za-z0-9]+))(?::\d+(?::\d+)?|\(\d+,\d+\))?/gm;
  for (const match of output.matchAll(pattern)) {
    const candidate = match[1].replace(/^\.\//, "");
    if (fs.existsSync(path.join(root, candidate))) found.add(candidate);
  }
  return found.size > 0 ? [...found] : fallbackPaths;
}

function conciseOutput(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, 8).join("\n").slice(0, 1600) || "No diagnostic output.";
}

function writeLog(root, sensorId, output) {
  const reportDirectory = path.join(root, ".claude", "specs", "evidence", "runtime", "sensors");
  fs.mkdirSync(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, `${sensorId}.log`);
  fs.writeFileSync(reportPath, redactEvidence(output || "No command output.\n"), "utf8");
  return path.relative(root, reportPath);
}

function runSensor(root, sensor, changedPaths, timeoutMs) {
  const command = [sensor.command, ...sensor.args].join(" ");
  if (sensor.require_file && !fs.existsSync(path.join(root, sensor.require_file))) {
    return {
      status: "warn",
      affectedPaths: [sensor.require_file],
      reason: `${sensor.label} is configured but ${sensor.require_file} is missing.`,
      nextAction: `Add ${sensor.require_file} or remove the sensor from its profile.`,
      evidence: `missing required file: ${sensor.require_file}`,
    };
  }
  if (sensor.require_script && !packageScriptExists(root, sensor.require_script)) {
    return {
      status: "warn",
      affectedPaths: ["package.json"],
      reason: `${sensor.label} is configured but package.json has no ${sensor.require_script} script.`,
      nextAction: `Add the ${sensor.require_script} script or remove the sensor from its profile.`,
      evidence: "package.json scripts",
    };
  }

  process.stdout.write(`RUN   ${sensor.label}\n`);
  const execution = spawnSync(sensor.command, sensor.args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: timeoutMs, killSignal: "SIGTERM" });
  const output = `${execution.stdout || ""}${execution.stderr || ""}`;
  const logPath = writeLog(root, sensor.id, output);
  const affectedPaths = diagnosticPaths(output, root, changedPaths);
  if (execution.error && execution.error.code === "ENOENT") {
    return {
      status: "warn",
      affectedPaths,
      reason: `${sensor.label} could not run because ${sensor.command} is unavailable.`,
      nextAction: `Install ${sensor.command} or configure an equivalent project sensor.`,
      evidence: `${logPath}; command unavailable: ${sensor.command}`,
    };
  }
  if (execution.error && execution.error.code === "ETIMEDOUT") {
    return {
      status: "fail", affectedPaths,
      reason: `${sensor.label} exceeded its ${timeoutMs}ms execution budget.`,
      nextAction: "Diagnose the stalled command or explicitly tune the sensor operations timeout.",
      evidence: `${logPath}; ${command} timed out`,
    };
  }
  if (execution.status === 0) {
    return {
      status: "pass",
      affectedPaths,
      reason: `${sensor.label} passed for the selected scope.`,
      nextAction: "No action required.",
      evidence: `${logPath}; ${command} (exit 0)`,
    };
  }
  return {
    status: "fail",
    affectedPaths,
    reason: `${sensor.label} failed: ${conciseOutput(output)}`,
    nextAction: `Repair the reported failure, then rerun: ${command}.`,
    evidence: `${logPath}; ${command} (exit ${execution.status ?? "unknown"})`,
  };
}

let argumentsParsed;
try {
  argumentsParsed = parseArguments(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(2);
}

const root = path.resolve(argumentsParsed.root);
let operationsPolicy;
try { operationsPolicy = loadOperationsPolicy(root).policy; } catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exit(2); }
let config;
try {
  const validation = validateHarnessConfig(root);
  if (validation.errors.length > 0) {
    for (const error of validation.errors) process.stderr.write(`ERROR: ${error}\n`);
    process.exit(2);
  }
  config = validation.config;
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(2);
}

const changedPaths = [...new Set(argumentsParsed.changedPaths.length > 0
  ? argumentsParsed.changedPaths
  : (argumentsParsed.all ? ["."] : gitChangedPaths(root)))];
const scopedPaths = changedPaths.length > 0 ? changedPaths : ["."];
const inspectionPaths = resolveInspectionPaths(root, scopedPaths);
const results = [];
const { waivers } = loadWaivers(root);
const { document: quarantines } = loadQuarantines(root);
const historySamples = new Map();
for (const entry of readHistory(root)) if (entry.sensor_id) historySamples.set(entry.sensor_id, (historySamples.get(entry.sensor_id) || 0) + 1);
const { manifest } = loadControlManifest(root);
const controlPolicies = new Map(manifest.controls.map((control) => [control.id, control.severity]));
function policyFor(sensorId, fallbackControl) {
  return controlPolicies.get(sensorId) || controlPolicies.get(fallbackControl) || "blocking";
}
function withPolicy(result, fallbackControl) {
  const waived = applyWaiver(result, waivers);
  const quarantined = applyQuarantine(waived, quarantines, historySamples.get(result.sensor_id) || 0);
  const policySeverity = policyFor(result.sensor_id, fallbackControl);
  return {
    ...quarantined,
    policy_severity: policySeverity,
    disposition: quarantined.waiver_id ? "waived" : quarantined.quarantine_id ? "quarantined" : policySeverity === "blocking" ? "blocking" : "advisory",
  };
}
function record(result) {
  results.push(withPolicy(result));
}
function recordProfile(result) {
  results.push(withPolicy(result, "profile-verification"));
}
process.stdout.write(`INFO  Harness sensors: ${root}\n`);
process.stdout.write(`INFO  Scope: ${changedPaths.length > 0 ? changedPaths.join(", ") : "project-wide (no Git diff detected)"}\n`);

for (const profileName of config.technologyProfiles) {
  const { profile } = loadSensorProfile(root, profileName);
  for (const sensor of profile.sensors) {
    const applicable = argumentsParsed.all || changedPaths.length === 0 || isApplicable(sensor, changedPaths);
    if (!applicable) continue;
    const sensorPaths = changedPaths.length === 0 ? scopedPaths : changedPaths.filter((item) => isApplicable(sensor, [item]));
    const result = createSensorResult({ sensorId: sensor.id, ...runSensor(root, sensor, sensorPaths.length > 0 ? sensorPaths : scopedPaths, operationsPolicy.sensor_timeout_ms) });
    recordProfile(result);
    process.stdout.write(`${result.status.toUpperCase().padEnd(5)} ${sensor.label}\n`);
  }
}

const domainSensorsPath = path.join(root, ".claude", "domains", config.domainPack, "sensors.yaml");
const { profile: domainProfile } = loadSensorProfileFile(domainSensorsPath);
for (const sensor of domainProfile.sensors) {
  const applicable = argumentsParsed.all || changedPaths.length === 0 || isApplicable(sensor, changedPaths);
  if (!applicable) continue;
  const sensorPaths = changedPaths.length === 0 ? scopedPaths : changedPaths.filter((item) => isApplicable(sensor, [item]));
  const result = createSensorResult({ sensorId: sensor.id, ...runSensor(root, sensor, sensorPaths.length > 0 ? sensorPaths : scopedPaths, operationsPolicy.sensor_timeout_ms) });
  recordProfile(result);
  process.stdout.write(`${result.status.toUpperCase().padEnd(5)} ${sensor.label}\n`);
}

const secretFindings = scanSecrets(root, inspectionPaths);
const gitleaks = runGitleaks(root);
const gitleaksLog = writeLog(root, "secret-scan", gitleaks.output);
record(createSensorResult({ sensorId: "secret-scan", ...(secretFindings.length > 0 || gitleaks.status === "findings" ? {
  status: "fail",
  affectedPaths: secretFindings.length > 0 ? secretFindings.map((finding) => finding.path) : inspectionPaths,
  reason: secretFindings.length > 0
    ? `Potential secrets found: ${secretFindings.map((finding) => `${finding.path} (${finding.name})`).join(", ")}.`
    : "Gitleaks found one or more potential secrets in the repository.",
  nextAction: "Remove the secret, rotate any exposed credential, and use the approved secret provider.",
  evidence: `Built-in deterministic secret scan and ${gitleaksLog}.`,
} : gitleaks.status === "unavailable" || gitleaks.status === "error" ? {
  status: "warn",
  affectedPaths: inspectionPaths.length > 0 ? inspectionPaths : ["."],
  reason: gitleaks.status === "unavailable"
    ? "The built-in scan passed, but the required Gitleaks deep secret scan is unavailable."
    : "The built-in scan passed, but Gitleaks could not complete successfully.",
  nextAction: "Install Gitleaks and rerun the sensor; CI treats this warning as blocking.",
  evidence: `Built-in deterministic secret scan and ${gitleaksLog}.`,
} : {
  status: "pass",
  affectedPaths: inspectionPaths.length > 0 ? inspectionPaths : ["."],
  reason: "Built-in pattern scanning and Gitleaks found no potential secrets.",
  nextAction: "No action required.",
  evidence: `Built-in deterministic secret scan and ${gitleaksLog}.`,
}) }));

const boundaryCheck = checkBoundaries(root, inspectionPaths);
record(createSensorResult({ sensorId: "architecture-boundaries", ...(boundaryCheck.rules.length === 0 ? {
  status: "warn",
  affectedPaths: [".claude/project/boundaries.json"],
  reason: "Architecture boundaries are active but no executable rules are configured.",
  nextAction: "Define the approved module roots and dependency directions before treating architecture verification as complete.",
  evidence: ".claude/project/boundaries.json (0 rules evaluated)",
} : boundaryCheck.violations.length > 0 ? {
  status: "fail",
  affectedPaths: boundaryCheck.violations.map((violation) => violation.path),
  reason: `Architecture boundary violations: ${boundaryCheck.violations.map((violation) => `${violation.path} imports ${violation.imported} (${violation.rule.id})`).join(", ")}.`,
  nextAction: "Move the dependency behind an allowed layer or obtain an approved boundary change.",
  evidence: ".claude/project/boundaries.json",
} : {
  status: "pass",
  affectedPaths: inspectionPaths.length > 0 ? inspectionPaths : ["."],
    reason: `Configured architecture boundary rules passed across ${boundaryCheck.inspectedPaths.length} inspected path(s).`,
    nextAction: "No action required.",
    evidence: `.claude/project/boundaries.json (${boundaryCheck.rules.length} rules; ${boundaryCheck.inspectedPaths.length} paths)`,
}) }));

// Craft sensors always run (vibe / outside-the-loop and /harness alike).
for (const { sensorId, label, result } of runAllMaintainabilitySensors(root, inspectionPaths)) {
  record(createSensorResult({
    sensorId,
    status: result.status,
    affectedPaths: result.affectedPaths,
    reason: result.reason,
    nextAction: result.nextAction,
    evidence: `.claude/project/maintainability.json (${sensorId}) or built-in defaults`,
    metrics: { finding_count: Array.isArray(result.findings) ? result.findings.length : 0 },
  }));
  process.stdout.write(`${result.status.toUpperCase().padEnd(5)} ${label}\n`);
}

for (const { sensorId, label, result } of [
  { sensorId: "dependency-cycles", label: "Dependency cycles", result: checkDependencyCycles(root, inspectionPaths) },
  { sensorId: "coupling-impact", label: "Coupling impact", result: checkCouplingImpact(root, inspectionPaths) },
]) {
  record(createSensorResult({
    sensorId,
    status: result.status,
    affectedPaths: result.affectedPaths,
    reason: result.reason,
    nextAction: result.nextAction,
    evidence: ".claude/project/dependency-sensors.json or built-in defaults",
    metrics: result.metrics,
  }));
  process.stdout.write(`${result.status.toUpperCase().padEnd(5)} ${label}\n`);
}

for (const [sensorId, label, result] of [
  ["test-integrity", "Test integrity", checkTestIntegrity(root, inspectionPaths)],
  ["coverage-effectiveness", "Coverage effectiveness", checkCoverage(root, inspectionPaths)],
  ["mutation-effectiveness", "Mutation effectiveness", checkMutation(root, inspectionPaths)],
  ["property-effectiveness", "Property-test effectiveness", checkGenerative(root, "property")],
  ["fuzz-effectiveness", "Fuzz-test effectiveness", checkGenerative(root, "fuzz")],
]) {
  if (!result) continue;
  const normalized = createSensorResult({ sensorId, status: result.status, affectedPaths: result.affectedPaths, reason: result.reason, nextAction: result.nextAction, evidence: ".claude/project/regression-sensors.json and configured report", metrics: result.metrics });
  results.push(withPolicy(normalized, "regression-effectiveness"));
  process.stdout.write(`${result.status.toUpperCase().padEnd(5)} ${label}\n`);
}

const reportPath = path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const workspace = workspaceFingerprint(root);
const rawStatus = reportStatus(results);
const blockingStatus = results.some((result) => result.disposition === "blocking" && result.status !== "pass") ? "fail" : "pass";
const generatedAt = new Date().toISOString();
const runtimeMs = Date.now() - runStartedAt;
fs.writeFileSync(reportPath, `${JSON.stringify({
  generated_at: generatedAt,
  runtime_ms: runtimeMs,
  root,
  changed_paths: changedPaths,
  scope: changedPaths.length > 0 ? "changed-path" : "project-wide",
  status: rawStatus,
  blocking_status: blockingStatus,
  workspace,
  inspected_paths: inspectionPaths,
  sensors: results,
}, null, 2)}\n`, "utf8");
for (const result of results) {
  appendSensorHistory(root, {
    timestamp: generatedAt,
    workspace_sha256: workspace.sha256,
    runtime_ms: runtimeMs,
    sensor_id: result.sensor_id || "unidentified-sensor",
    status: result.status,
    waiver_id: result.waiver_id || null,
    affected_paths: result.affected_paths,
    metrics: result.metrics || null,
  });
}
process.stdout.write(`INFO  Sensor report: ${reportPath}\n`);
process.exit(blockingStatus === "fail" ||
  (argumentsParsed.failOnWarn && results.some((result) => result.status === "warn" && result.disposition !== "waived")) ? 1 : 0);
