#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { recordPilot, writeReport } = require("../lib/pilot-evidence");

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

try {
  const command = process.argv[2];
  const root = path.resolve(option("--root") || ".");
  if (command === "record") {
    const inputPath = option("--file");
    if (!inputPath) throw new Error("Usage: harness-pilot.js record --file <pilot.json> [--root <project>]");
    const result = recordPilot(root, JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8")));
    process.stdout.write(`Recorded immutable pilot evidence: ${result.file}\n`);
    process.stdout.write(`Rollout status: ${writeReport(root).report.status}\n`);
  } else if (command === "report") {
    const { report, file } = writeReport(root);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Report: ${file}\n`);
  } else throw new Error("Usage: harness-pilot.js <record|report> [options]");
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
