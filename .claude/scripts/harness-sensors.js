#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateHarnessConfig } = require("../lib/harness-config");
const { createSensorResult, reportStatus } = require("../lib/sensor-contract");
const { loadSensorProfile, isApplicable } = require("../lib/sensor-profile");
const { loadSensorProfileFile } = require("../lib/sensor-profile");
const { checkBoundaries } = require("../lib/architecture-boundaries");
const { scanSecrets } = require("../lib/secret-scan");
const { runAllMaintainabilitySensors } = require("../lib/maintainability-sensors");
const { loadWaivers, applyWaiver } = require("../lib/sensor-waivers");
const { redactEvidence } = require("../lib/evidence-hygiene");

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

function gitChangedPaths(root) {
  const result = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function projectFiles(root) {
  const ignored = new Set([".git", ".claude", "node_modules", "dist", "build", ".venv", "venv"]);
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name)) pending.push(fullPath);
      if (entry.isFile()) files.push(path.relative(root, fullPath));
    }
  }
  return files;
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

function runSensor(root, sensor, changedPaths) {
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
  const execution = spawnSync(sensor.command, sensor.args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
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
const inspectionPaths = changedPaths.length > 0 ? changedPaths : projectFiles(root);
const results = [];
const { waivers } = loadWaivers(root);
function record(result) {
  results.push(applyWaiver(result, waivers));
}
process.stdout.write(`INFO  Harness sensors: ${root}\n`);
process.stdout.write(`INFO  Scope: ${changedPaths.length > 0 ? changedPaths.join(", ") : "project-wide (no Git diff detected)"}\n`);

for (const profileName of config.technologyProfiles) {
  const { profile } = loadSensorProfile(root, profileName);
  for (const sensor of profile.sensors) {
    const applicable = argumentsParsed.all || changedPaths.length === 0 || isApplicable(sensor, changedPaths);
    if (!applicable) continue;
    const sensorPaths = changedPaths.length === 0 ? scopedPaths : changedPaths.filter((item) => isApplicable(sensor, [item]));
    const result = createSensorResult({ sensorId: sensor.id, ...runSensor(root, sensor, sensorPaths.length > 0 ? sensorPaths : scopedPaths) });
    record(result);
    process.stdout.write(`${result.status.toUpperCase().padEnd(5)} ${sensor.label}\n`);
  }
}

const domainSensorsPath = path.join(root, ".claude", "domains", config.domainPack, "sensors.yaml");
const { profile: domainProfile } = loadSensorProfileFile(domainSensorsPath);
for (const sensor of domainProfile.sensors) {
  const applicable = argumentsParsed.all || changedPaths.length === 0 || isApplicable(sensor, changedPaths);
  if (!applicable) continue;
  const sensorPaths = changedPaths.length === 0 ? scopedPaths : changedPaths.filter((item) => isApplicable(sensor, [item]));
  const result = createSensorResult({ sensorId: sensor.id, ...runSensor(root, sensor, sensorPaths.length > 0 ? sensorPaths : scopedPaths) });
  record(result);
  process.stdout.write(`${result.status.toUpperCase().padEnd(5)} ${sensor.label}\n`);
}

const secretFindings = scanSecrets(root, inspectionPaths);
record(createSensorResult({ sensorId: "secret-scan", ...(secretFindings.length > 0 ? {
  status: "fail",
  affectedPaths: secretFindings.map((finding) => finding.path),
  reason: `Potential committed secrets found: ${secretFindings.map((finding) => `${finding.path} (${finding.name})`).join(", ")}.`,
  nextAction: "Remove the secret, rotate any exposed credential, and use the approved secret provider.",
  evidence: "Built-in deterministic secret scan.",
} : {
  status: "pass",
  affectedPaths: inspectionPaths.length > 0 ? inspectionPaths : ["."],
  reason: "Built-in secret scan found no known credential patterns in the selected scope.",
  nextAction: "No action required.",
  evidence: "Built-in deterministic secret scan.",
}) }));

const boundaryCheck = checkBoundaries(root, inspectionPaths);
record(createSensorResult({ sensorId: "architecture-boundaries", ...(boundaryCheck.violations.length > 0 ? {
  status: "fail",
  affectedPaths: boundaryCheck.violations.map((violation) => violation.path),
  reason: `Architecture boundary violations: ${boundaryCheck.violations.map((violation) => `${violation.path} imports ${violation.imported} (${violation.rule.id})`).join(", ")}.`,
  nextAction: "Move the dependency behind an allowed layer or obtain an approved boundary change.",
  evidence: ".claude/project/boundaries.json",
} : {
  status: "pass",
  affectedPaths: inspectionPaths.length > 0 ? inspectionPaths : ["."],
  reason: boundaryCheck.rules.length === 0 ? "No executable architecture boundary rules are configured." : "Configured architecture boundary rules passed.",
  nextAction: boundaryCheck.rules.length === 0 ? "Add a rule only after an approved, recurring boundary failure." : "No action required.",
  evidence: ".claude/project/boundaries.json",
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
  }));
  process.stdout.write(`${result.status.toUpperCase().padEnd(5)} ${label}\n`);
}

const reportPath = path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({
  generated_at: new Date().toISOString(),
  root,
  changed_paths: changedPaths,
  scope: changedPaths.length > 0 ? "changed-path" : "project-wide",
  status: reportStatus(results),
  sensors: results,
}, null, 2)}\n`, "utf8");
const historyPath = path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-history.jsonl");
const timestamp = new Date().toISOString();
for (const result of results) {
  fs.appendFileSync(historyPath, `${JSON.stringify({
    timestamp,
    sensor_id: result.sensor_id || "unidentified-sensor",
    status: result.status,
    waiver_id: result.waiver_id || null,
    affected_paths: result.affected_paths,
  })}\n`, "utf8");
}
process.stdout.write(`INFO  Sensor report: ${reportPath}\n`);
process.exit(results.some((result) => result.status === "fail") ||
  (argumentsParsed.failOnWarn && results.some((result) => result.status === "warn" && !result.waiver_id)) ? 1 : 0);
