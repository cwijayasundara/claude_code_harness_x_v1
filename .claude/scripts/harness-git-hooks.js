#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MARKER = "# managed-by-lean-expert-generalist-harness";
const args = process.argv.slice(2);
const command = args[0];
const rootIndex = args.indexOf("--root");
const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] : ".");
function git(...items) { return execFileSync("git", ["-C", root, ...items], { encoding: "utf8" }).trim(); }
try {
  const gitDirectory = path.resolve(root, git("rev-parse", "--git-dir"));
  const hooks = path.join(gitDirectory, "hooks");
  if (command === "status") {
    const state = Object.fromEntries(["pre-commit", "pre-push"].map((name) => {
      const file = path.join(hooks, name); const managed = fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(MARKER);
      return [name, managed ? "managed" : fs.existsSync(file) ? "external" : "missing"];
    }));
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  } else if (command === "install") {
    fs.mkdirSync(hooks, { recursive: true });
    for (const name of ["pre-commit", "pre-push"]) {
      const file = path.join(hooks, name);
      if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").includes(MARKER)) throw new Error(`Refusing to overwrite existing ${name} hook.`);
      const content = `#!/bin/sh\n${MARKER}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(__dirname, "harness-git-gate.js"))} ${name} ${JSON.stringify(root)}\n`;
      fs.writeFileSync(file, content, { mode: 0o755 });
      fs.chmodSync(file, 0o755);
    }
    process.stdout.write(`INSTALLED managed pre-commit and pre-push hooks in ${hooks}\n`);
  } else throw new Error("Usage: harness-git-hooks.js <status|install> [--root <project>]");
} catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 2; }
