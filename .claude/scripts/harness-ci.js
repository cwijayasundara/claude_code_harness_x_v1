#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(process.argv[2] || ".");
const runner = path.join(__dirname, "harness-sensors.js");

process.stdout.write(`INFO  Harness CI verification: ${root}\n`);
const result = spawnSync(process.execPath, [runner, root, "--all", "--fail-on-warn"], { stdio: "inherit" });
if (result.error) {
  process.stderr.write(`ERROR: Unable to start sensor runner: ${result.error.message}\n`);
  process.exit(2);
}
process.exit(result.status ?? 2);
