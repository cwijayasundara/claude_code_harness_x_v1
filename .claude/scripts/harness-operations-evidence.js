#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { analyzeFlakiness, compactHistory, operationalStatus, watcherStatus } = require("../lib/sensor-operations");
const { attest, verifyAttestation } = require("../lib/evidence-attestation");
const { evaluateProductionSlos, recordProductionFeedback } = require("../lib/production-feedback");

function value(args, name) { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; }
const args = process.argv.slice(2);
const command = args[0];
const root = path.resolve(value(args, "--root") || ".");
try {
  if (command === "status") process.stdout.write(`${JSON.stringify({ operations: operationalStatus(root), watcher: watcherStatus(root), flakiness: analyzeFlakiness(root), production: evaluateProductionSlos(root) }, null, 2)}\n`);
  else if (command === "compact") process.stdout.write(`${JSON.stringify(compactHistory(root), null, 2)}\n`);
  else if (command === "attest") {
    const key = value(args, "--private-key");
    const result = attest(root, key);
    process.stdout.write(`ATTESTATION ${result.file}\n`);
  } else if (command === "verify-attestation") {
    const key = value(args, "--public-key");
    const result = verifyAttestation(root, key);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.valid ? 0 : 1;
  } else if (command === "record-production") {
    const file = value(args, "--file");
    if (!file) throw new Error("record-production requires --file <feedback.json>.");
    const result = recordProductionFeedback(root, JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8")));
    process.stdout.write(`RECORDED ${result.output}\n`);
  } else throw new Error("Usage: harness-operations-evidence.js <status|compact|attest|verify-attestation|record-production> [options]");
} catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 2; }
