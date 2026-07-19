#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { runMultiStoryEvolutionCanary } = require("../lib/lived-canary");

const keep = process.argv.includes("--keep");
const outputIndex = process.argv.indexOf("--output");

try {
  const report = runMultiStoryEvolutionCanary({ keep });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputIndex >= 0) {
    const output = path.resolve(process.argv[outputIndex + 1]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, text);
  }
  process.stdout.write(text);
  process.exit(report.status === "pass" ? 0 : 1);
} catch (error) {
  if (error.report) process.stdout.write(`${JSON.stringify(error.report, null, 2)}\n`);
  process.stderr.write(`ERROR: ${error.stack || error.message}\n`);
  process.exit(1);
}
