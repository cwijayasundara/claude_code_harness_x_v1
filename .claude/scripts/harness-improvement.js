#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const improvement = require("../lib/improvement-ratchet");

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
function jsonFile(name) {
  const file = option(name);
  if (!file) throw new Error(`${name} requires a JSON file.`);
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}
function usage() {
  throw new Error("Usage: harness-improvement.js <record|patterns|propose|approve-experiment|evaluate|status> [--root .] [--file input.json] [--baseline baseline.json --treatment treatment.json --experiment id]");
}

try {
  const command = process.argv[2];
  const root = path.resolve(option("--root") || ".");
  let result;
  if (command === "record") result = improvement.appendEvent(root, jsonFile("--file"));
  else if (command === "patterns") result = improvement.writePatterns(root);
  else if (command === "propose") result = improvement.createCandidate(root, jsonFile("--file"));
  else if (command === "approve-experiment") result = improvement.approveExperiment(root, jsonFile("--file"));
  else if (command === "evaluate") {
    const experimentId = option("--experiment");
    if (!experimentId) usage();
    result = improvement.evaluateExperiment(root, experimentId, jsonFile("--baseline"), jsonFile("--treatment"));
  } else if (command === "status") result = improvement.learningStatus(root);
  else usage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
