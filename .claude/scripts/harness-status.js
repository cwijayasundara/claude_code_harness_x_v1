#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { validateHarnessConfig } = require("../lib/harness-config");
const { loadControlManifest } = require("../lib/control-manifest");
const { loadWaivers } = require("../lib/sensor-waivers");
const { evaluatePilots } = require("../lib/pilot-evidence");

const argumentsParsed = process.argv.slice(2);
const agentMode = argumentsParsed.includes("--agent");
const rootArgument = argumentsParsed.find((argument) => argument !== "--agent");
const root = path.resolve(rootArgument || ".");

function trendFor(result, history) {
  const rank = { pass: 0, warn: 1, fail: 2 };
  const previous = history.filter((entry) => entry.sensor_id === result.sensor_id).at(-2);
  if (!previous) return "new";
  if (rank[result.status] > rank[previous.status]) return "worse";
  if (rank[result.status] < rank[previous.status]) return "better";
  return "same";
}

function writeAgentSensorStatus(root, manifest) {
  const evidenceDirectory = path.join(root, ".claude", "specs", "evidence", "runtime");
  const reportPath = path.join(evidenceDirectory, "sensor-report.json");
  if (!fs.existsSync(reportPath)) {
    process.stdout.write("SENSOR STATUS: not run\nNEXT: Run harness-sensors.js for the changed paths before claiming completion.\n");
    return;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const historyPath = path.join(evidenceDirectory, "sensor-history.jsonl");
  const history = fs.existsSync(historyPath)
    ? fs.readFileSync(historyPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const controls = new Map(manifest.controls.map((control) => [control.id, control]));
  const actionable = (report.sensors || []).filter((result) => result.status !== "pass");
  process.stdout.write(`SENSOR STATUS: ${report.status || "unknown"} (${report.generated_at || "unknown time"})\n`);
  if (actionable.length === 0) {
    process.stdout.write("NEXT: No sensor correction required. Preserve this evidence for review.\n");
    return;
  }
  for (const result of actionable) {
    const control = controls.get(result.sensor_id);
    process.stdout.write(`\n${result.status.toUpperCase()} ${result.sensor_id || "unidentified-sensor"} [${trendFor(result, history)}]\n`);
    process.stdout.write(`PATHS: ${result.affected_paths.join(", ")}\n`);
    process.stdout.write(`WHY: ${result.reason}\n`);
    process.stdout.write(`NEXT: ${control?.self_correction || result.next_action}\n`);
  }
}

try {
  const { config, errors } = validateHarnessConfig(root);
  const { manifest } = loadControlManifest(root);
  if (agentMode) {
    writeAgentSensorStatus(root, manifest);
    process.exitCode = 0;
    return;
  }
  process.stdout.write("# Harness status\n\n");
  process.stdout.write(`- Profiles: ${config.technologyProfiles.join(", ") || "not configured"}\n`);
  process.stdout.write(`- Domain pack: ${config.domainPack || "not configured"}\n`);
  process.stdout.write(`- Configuration: ${errors.length === 0 ? "valid" : `${errors.length} issue(s)`}\n`);
  const installPath = path.join(root, ".claude", "harness-install.json");
  const install = fs.existsSync(installPath) ? JSON.parse(fs.readFileSync(installPath, "utf8")) : null;
  process.stdout.write(`- Installed harness: ${install?.installed_plugin_version || "unknown"}\n`);
  process.stdout.write(`- Active controls: ${manifest.controls.filter((control) => control.status === "active").length}\n`);

  const specsIndexPath = path.join(root, ".claude", "specs", "index.json");
  if (fs.existsSync(specsIndexPath)) {
    const specsIndex = JSON.parse(fs.readFileSync(specsIndexPath, "utf8"));
    process.stdout.write("\n## Grounded delivery\n");
    for (const [changeId, change] of Object.entries(specsIndex.changes || {})) {
      const gates = Object.entries(change.gates || {}).filter(([, gate]) => gate.status === "approved").map(([gate]) => gate).join(", ") || "none";
      process.stdout.write(`- ${changeId}: branch ${change.branch}; approved gates ${gates}\n`);
    }
  }
  const storyStateDirectory = path.join(root, ".claude", "state", "stories");
  process.stdout.write("\n## Story ratchet\n");
  if (!fs.existsSync(storyStateDirectory)) process.stdout.write("- None\n");
  else for (const name of fs.readdirSync(storyStateDirectory).filter((item) => item.endsWith(".json")).sort()) {
    const story = JSON.parse(fs.readFileSync(path.join(storyStateDirectory, name), "utf8"));
    process.stdout.write(`- ${story.story_id}: ${story.state}; repairs ${story.repair_attempts || 0}; updated ${story.updated_at}\n`);
  }
  const verificationPlanPath = path.join(root, ".claude", "verification.json");
  if (fs.existsSync(verificationPlanPath)) {
    const verification = JSON.parse(fs.readFileSync(verificationPlanPath, "utf8"));
    const prePr = verification.checks.filter((check) => check.cadence === "pre-pr");
    process.stdout.write("\n## Pre-PR verification\n");
    process.stdout.write(`- Configured checks: ${prePr.filter((check) => check.configured).length}/${prePr.length}\n`);
    const specEvidence = path.join(root, ".claude", "specs", "evidence");
    const readiness = fs.existsSync(specEvidence) ? fs.readdirSync(specEvidence).filter((name) => name.endsWith("-branch-readiness.json")).sort() : [];
    if (!readiness.length) process.stdout.write("- Branch readiness: not finalized\n");
    else {
      const latest = JSON.parse(fs.readFileSync(path.join(specEvidence, readiness.at(-1)), "utf8"));
      process.stdout.write(`- Branch readiness: ${latest.change_id} ${latest.status} (${latest.generated_at})\n`);
    }
  }
  const routingPath = path.join(root, ".claude", "routing.json");
  if (fs.existsSync(routingPath)) {
    const routing = JSON.parse(fs.readFileSync(routingPath, "utf8"));
    const usagePath = path.join(root, ".claude", "specs", "evidence", "model-usage.jsonl");
    const receipts = fs.existsSync(usagePath) ? fs.readFileSync(usagePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
    const recorded = receipts.reduce((sum, receipt) => sum + receipt.cost_usd, 0);
    process.stdout.write("\n## Model routing and context\n");
    process.stdout.write(`- Economical evaluator human-enabled: ${routing.economical_evaluator_promotion.enabled}\n`);
    process.stdout.write(`- Context budgets: sidekick ${routing.context_budgets.sidekick}; economical evaluator ${routing.context_budgets["evaluator-economical"]}; strong evaluator ${routing.context_budgets["evaluator-strong"]} estimated tokens\n`);
    process.stdout.write(`- Provider-evidenced usage: ${receipts.length} receipt(s), $${recorded.toFixed(4)} recorded; enforcement ${routing.cost.enforcement}\n`);
  }

  const pilot = evaluatePilots(root);
  process.stdout.write("\n## Real-pilot readiness\n");
  process.stdout.write(`- Status: ${pilot.status}; rollout authority: human\n`);
  process.stdout.write(`- Evidence: ${pilot.metrics.pilot_counts.greenfield} greenfield, ${pilot.metrics.pilot_counts.brownfield} brownfield pilot(s)\n`);

  const evidenceDirectory = path.join(root, ".claude", "specs", "evidence", "runtime");
  const sensorReportPath = path.join(evidenceDirectory, "sensor-report.json");
  const doctorPath = path.join(evidenceDirectory, "harness-doctor.json");
  process.stdout.write("\n## Operational health\n");
  if (fs.existsSync(sensorReportPath)) {
    const report = JSON.parse(fs.readFileSync(sensorReportPath, "utf8"));
    process.stdout.write(`- Latest sensors: ${report.status} (${report.generated_at || "unknown time"})\n`);
  } else process.stdout.write("- Latest sensors: not run\n");
  if (fs.existsSync(doctorPath)) {
    const doctor = JSON.parse(fs.readFileSync(doctorPath, "utf8"));
    process.stdout.write(`- Environment doctor: ${doctor.status}\n`);
  } else process.stdout.write("- Environment doctor: not run\n");
  const { waivers } = loadWaivers(root);
  const today = new Date().toISOString().slice(0, 10);
  const activeWaivers = waivers.waivers.filter((waiver) => waiver.expires_on >= today);
  process.stdout.write(`- Active waivers: ${activeWaivers.length}\n`);
  for (const waiver of activeWaivers) process.stdout.write(`  - ${waiver.id} expires ${waiver.expires_on}\n`);

  if (errors.length > 0) {
    process.stdout.write("\n## Blockers\n");
    for (const error of errors) process.stdout.write(`- ${error}\n`);
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 2;
}
