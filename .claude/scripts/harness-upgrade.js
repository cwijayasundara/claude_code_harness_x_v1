#!/usr/bin/env node

const path = require("node:path");
const {
  planUpgrade,
  applyUpgrade,
  writeUpgradeReport,
} = require("../lib/harness-upgrade");

function parseArguments(args) {
  const parsed = { target: ".", apply: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--target") {
      if (!args[index + 1]) throw new Error("--target requires a path.");
      parsed.target = args[index + 1];
      index += 1;
    } else if (args[index] === "--apply") parsed.apply = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return parsed;
}

try {
  const args = parseArguments(process.argv.slice(2));
  const target = path.resolve(args.target);
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
  const report = args.apply
    ? applyUpgrade(target, pluginRoot)
    : planUpgrade(target, pluginRoot);
  const outputPath = writeUpgradeReport(target, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`INFO  Upgrade report: ${outputPath}\n`);
  if (args.apply) {
    const merged = report.applied?.manifest?.added_controls || [];
    const createdMaint = report.applied?.maintainability?.action === "create";
    if (merged.length) process.stdout.write(`INFO  Merged controls: ${merged.join(", ")}\n`);
    if (createdMaint) process.stdout.write(`INFO  Created ${report.applied.maintainability.path}\n`);
  }
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
