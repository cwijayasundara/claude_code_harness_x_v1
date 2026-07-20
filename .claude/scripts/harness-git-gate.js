#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { operationalStatus } = require("../lib/sensor-operations");

const gate = process.argv[2];
const root = path.resolve(process.argv[3] || ".");
if (!new Set(["pre-commit", "pre-push"]).has(gate)) { process.stderr.write("ERROR: gate must be pre-commit or pre-push.\n"); process.exit(2); }
const script = path.join(__dirname, gate === "pre-push" ? "harness-ci.js" : "harness-sensors.js");
const args = gate === "pre-push" ? [script, root] : [script, root];
const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 2);
const health = operationalStatus(root, gate === "pre-push" ? "ci" : "completion");
if (health.status !== "pass") {
  for (const reason of health.reasons) process.stderr.write(`ERROR: ${reason}\n`);
  process.exit(1);
}
process.stdout.write(`PASS  ${gate} sensor gate\n`);
