#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateReleaseLayout } = require("../lib/release-readiness");

const root = path.resolve(process.argv[2] || path.resolve(__dirname, ".."));
const errors = validateReleaseLayout(root);
if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`ERROR: ${error}\n`);
  process.exit(1);
}

function run(label, command, args, cwd = root) {
  process.stdout.write(`RUN   ${label}\n`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.stderr.write(`ERROR: ${label} failed.\n`);
    process.exit(result.status ?? 1);
  }
  process.stdout.write(`PASS  ${label}\n`);
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { cwd: root, stdio: "ignore" });
  return !result.error && result.status === 0;
}

if (commandAvailable("claude")) {
  run("Claude Code plugin validation", "claude", ["plugins", "validate", "."]);
} else {
  process.stdout.write("SKIP  Claude Code plugin validation (claude command unavailable)\n");
}
run("plugin test suite", process.execPath, ["--test", "tests/*.test.js"]);
run("lived TDD story canary (G0-G4 + real tests)", process.execPath, ["scripts/harness-lived-canary.js"]);
run("multi-story evolution canary (first-slice → reuse)", process.execPath, ["scripts/harness-multi-story-canary.js"]);
run("lived brownfield reuse canary (B0-B2 + adapter)", process.execPath, ["scripts/harness-brownfield-canary.js"]);
run("lived routing/context canary (cost + packs)", process.execPath, ["scripts/harness-routing-canary.js"]);
run("matched greenfield/brownfield P7 canaries", process.execPath, ["scripts/harness-p7-canary.js"]);

// M7 on a throwaway target so templates stay clean.
const sampleTarget = fs.mkdtempSync(path.join(os.tmpdir(), "harness-m7-release-"));
try {
  run("init sample target for M7", process.execPath, ["scripts/harness-init.js", sampleTarget]);
  run(
    "M7 scorecard (pilots human-gated; subtraction proposals only)",
    process.execPath,
    ["scripts/harness-m7-scorecard.js", "--root", sampleTarget, "--synthetic-pass"]
  );
  run(
    "control subtraction proposals (human-approved only)",
    process.execPath,
    ["scripts/harness-subtract.js", "--root", sampleTarget, "--write"]
  );
  // Persist a committed copy of the last synthetic M7 shape under release/ for humans.
  const generated = path.join(sampleTarget, ".claude", "specs", "evidence", "m7-scorecard.json");
  if (fs.existsSync(generated)) {
    const dest = path.join(root, "release", "m7-scorecard.example.json");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(generated, dest);
    process.stdout.write(`INFO  Wrote example M7 scorecard: ${dest}\n`);
  }
} finally {
  fs.rmSync(sampleTarget, { recursive: true, force: true });
}

process.stdout.write("PASS  Release readiness\n");
process.stdout.write("NOTE  Real pilot rollout remains human-owned (harness-pilot.js report).\n");
