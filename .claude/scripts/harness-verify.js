#!/usr/bin/env node

const path = require("node:path");
const { finalizeBranch, verifyBranch } = require("../lib/branch-verification");

const values = { root: "." };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]; const value = args[index + 1];
  if (!flag?.startsWith("--") || value === undefined) process.exit(2);
  values[flag.slice(2)] = value;
}
const action = values.action || "run";
if (!values.change || (action === "run" && !["story-fast", "pre-pr", "scheduled"].includes(values.cadence)) || (action === "finalize" && (!values.report || !values.review))) {
  process.stderr.write("Usage:\n  harness-verify.js --action run --change <id> --cadence <story-fast|pre-pr|scheduled> [--root .]\n  harness-verify.js --action finalize --change <id> --report <pre-pr.json> --review <branch-review.json> [--root .]\n");
  process.exit(2);
}
try {
  if (action === "run") {
    const { report, reportPath } = verifyBranch(path.resolve(values.root), { changeId: values.change, cadence: values.cadence });
    process.stdout.write(`REPORT ${reportPath}\nSTATUS ${report.status}\n`);
    process.exitCode = report.status === "pass" ? 0 : 1;
  } else if (action === "finalize") {
    const { evidence, output } = finalizeBranch(path.resolve(values.root), { changeId: values.change, reportFile: values.report, reviewFile: values.review });
    process.stdout.write(`EVIDENCE ${output}\nSTATUS ${evidence.status}\n`);
  } else throw new Error(`Unknown action '${action}'.`);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 2;
}
