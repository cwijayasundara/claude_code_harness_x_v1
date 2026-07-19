#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateHarnessConfig } = require("../lib/harness-config");
const { loadSensorProfile, loadSensorProfileFile } = require("../lib/sensor-profile");

const root = path.resolve(process.argv[2] || ".");

function commandAvailable(command) {
  const lookup = process.platform === "win32" ? "where" : "which";
  return spawnSync(lookup, [command], { stdio: "ignore" }).status === 0;
}

function packageScriptExists(name) {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) return false;
  try { return Boolean(JSON.parse(fs.readFileSync(packagePath, "utf8")).scripts?.[name]); } catch { return false; }
}

try {
  const validation = validateHarnessConfig(root);
  if (validation.errors.length > 0) throw new Error(validation.errors.join(" "));
  const sensors = [];
  for (const profileName of validation.config.technologyProfiles) sensors.push(...loadSensorProfile(root, profileName).profile.sensors);
  sensors.push(...loadSensorProfileFile(path.join(root, ".claude", "domains", validation.config.domainPack, "sensors.yaml")).profile.sensors);
  const findings = sensors.flatMap((sensor) => {
    const findingsForSensor = [];
    if (!commandAvailable(sensor.command)) findingsForSensor.push({ sensor_id: sensor.id, status: "warn", reason: `Missing command: ${sensor.command}`, next_action: `Install ${sensor.command}.` });
    if (sensor.require_file && !fs.existsSync(path.join(root, sensor.require_file))) findingsForSensor.push({ sensor_id: sensor.id, status: "warn", reason: `Missing required file: ${sensor.require_file}`, next_action: `Add ${sensor.require_file} or remove the sensor.` });
    if (sensor.require_script && !packageScriptExists(sensor.require_script)) findingsForSensor.push({ sensor_id: sensor.id, status: "warn", reason: `Missing package script: ${sensor.require_script}`, next_action: `Add npm script ${sensor.require_script} or remove the sensor.` });
    return findingsForSensor.length > 0 ? findingsForSensor : [{ sensor_id: sensor.id, status: "pass", reason: "Sensor prerequisites are available.", next_action: "No action required." }];
  });
  const report = {
    generated_at: new Date().toISOString(),
    root,
    node_version: process.version,
    status: findings.some((finding) => finding.status === "warn") ? "warn" : "pass",
    findings,
  };
  const reportPath = path.join(root, ".claude", "specs", "evidence", "runtime", "harness-doctor.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${report.status.toUpperCase()}  Harness doctor: ${reportPath}\n`);
  for (const finding of findings.filter((item) => item.status === "warn")) process.stdout.write(`WARN  ${finding.sensor_id}: ${finding.reason}\n`);
  process.exit(report.status === "warn" ? 1 : 0);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(2);
}
