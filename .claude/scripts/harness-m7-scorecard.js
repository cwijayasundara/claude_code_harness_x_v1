#!/usr/bin/env node

const path = require("node:path");
const { writeM7Scorecard } = require("../lib/m7-scorecard");

const root = path.resolve(
  process.argv.includes("--root")
    ? process.argv[process.argv.indexOf("--root") + 1]
    : "."
);
const syntheticStatus = process.argv.includes("--synthetic-pass")
  ? "pass"
  : process.argv.includes("--synthetic-fail")
    ? "fail"
    : "delegated-to-release-check";

try {
  const { scorecard, file } = writeM7Scorecard(root, { syntheticStatus });
  process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
  process.stdout.write(`SCORECARD ${file}\n`);
  process.stdout.write(`ROLLOUT ${scorecard.rollout.status}\n`);
  process.stdout.write(`AUTHORITY ${scorecard.decision_authority}\n`);
  // Exit 0 always for scorecard generation — pilot insufficient is expected and not a test failure.
  // Synthetic failure is signaled only when --synthetic-fail is passed by release-check.
  process.exit(syntheticStatus === "fail" ? 1 : 0);
} catch (error) {
  process.stderr.write(`ERROR: ${error.stack || error.message}\n`);
  process.exit(1);
}
