#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { validateHarnessConfig } = require("../lib/harness-config");

const root = path.resolve(process.argv[2] || ".");

function meaningfulLines(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#") && !/^\|[- :]+\|/.test(line.trim()))
    .length;
}

try {
  const { config, errors } = validateHarnessConfig(root);
  if (errors.length > 0) throw new Error(errors.join(" "));
  const domainRoot = path.join(root, ".claude", "domains", config.domainPack);
  const files = ["glossary.md", "concepts.yaml", "invariants.yaml", "lifecycles.yaml", "policies.yaml", "events.yaml", "data-classification.yaml", "review-policy.md"];

  process.stdout.write(`# Domain pack: ${config.domainPack}\n\n`);
  for (const file of files) {
    const count = meaningfulLines(path.join(domainRoot, file));
    process.stdout.write(`- ${file}: ${count === 0 ? "placeholder only" : `${count} meaningful line(s)`}\n`);
  }
  process.stdout.write("\nDomain owners must approve semantic rules before they become implementation constraints.\n");
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
