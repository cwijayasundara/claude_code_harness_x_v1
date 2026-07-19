#!/usr/bin/env node

const path = require("node:path");
const { loadHarnessConfig } = require("../lib/harness-config");
const ratchet = require("../lib/story-ratchet");

function usage() {
  process.stderr.write("Usage:\n  harness-ratchet.js start --change <id> --story <id> [--root .]\n  harness-ratchet.js red|implement|review|sensors --story <id> --file <evidence.json> [--root .]\n  harness-ratchet.js repair-start --story <id> --failure <summary> [--root .]\n  harness-ratchet.js repair-outcome --story <id> --outcome <passed|failed|escalated> --evidence <ref> [--root .]\n  harness-ratchet.js verify|status --story <id> [--root .]\n");
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
const values = { root: "." };
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]; const value = args[index + 1];
  if (!flag?.startsWith("--") || value === undefined) usage();
  values[flag.slice(2)] = value;
}
if (!command || !values.story) usage();
const root = path.resolve(values.root);
try {
  let result;
  if (command === "start" && values.change) result = ratchet.start(root, { changeId: values.change, storyId: values.story });
  else if (command === "red" && values.file) result = ratchet.recordRed(root, values.story, values.file);
  else if (command === "implement" && values.file) result = ratchet.recordImplementation(root, values.story, values.file);
  else if (command === "review" && values.file) result = ratchet.recordReview(root, values.story, values.file);
  else if (command === "sensors" && values.file) result = ratchet.recordSensors(root, values.story, values.file);
  else if (command === "repair-start" && values.failure) result = ratchet.startRepair(root, values.story, values.failure, loadHarnessConfig(root).maxAutomatedRepairAttempts);
  else if (command === "repair-outcome" && values.outcome && values.evidence) result = ratchet.finishRepair(root, values.story, { outcome: values.outcome, evidence: values.evidence });
  else if (command === "verify") result = ratchet.verify(root, values.story);
  else if (command === "status") result = ratchet.loadState(root, values.story).state;
  else usage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
