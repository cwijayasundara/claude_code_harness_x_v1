#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { loadControlManifest } = require("../lib/control-manifest");
const { proposeControlSubtractions } = require("../lib/control-subtract");

const root = path.resolve(
  process.argv.includes("--root")
    ? process.argv[process.argv.indexOf("--root") + 1]
    : "."
);
const write = process.argv.includes("--write");

try {
  const { manifest } = loadControlManifest(root);
  const report = proposeControlSubtractions(manifest, { root });
  if (write) {
    const out = path.join(root, ".claude", "specs", "evidence", "control-subtraction-proposals.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`WROTE ${out}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `PROPOSALS ${report.summary.total} (blocking-candidates ${report.summary.blocking_candidates})\n`
  );
  process.stdout.write("Applies automatically: false — human must approve retirements.\n");
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
