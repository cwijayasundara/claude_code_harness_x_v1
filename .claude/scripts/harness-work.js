#!/usr/bin/env node

const path = require("node:path");
const { parseArgs } = require("node:util");
const { spawnSync } = require("node:child_process");
const specs = require("../lib/specifications");
const { classifyRequest } = require("../lib/work-intake");
const { attachWorkflow, deriveWork, listActiveWork, resumeWork } = require("../lib/work-state");

function usage() {
  process.stderr.write(
    "Usage:\n" +
    "  harness-work.js classify [--request <text>] [--kind <kind>] [--target <target>] [--mode <mode>] [--posture <greenfield|brownfield>]\n" +
    "  harness-work.js start --change <id> --source <file> [classification options] [--root .]\n" +
    "  harness-work.js status --change <id> [--root .]\n" +
    "  harness-work.js list [--branch <branch>] [--root .]\n" +
    "  harness-work.js resume [--change <id>] [--branch <branch>] [--root .]\n"
  );
  process.exit(2);
}

const command = process.argv[2];
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: {
    request: { type: "string" }, kind: { type: "string" }, target: { type: "string" },
    mode: { type: "string" }, posture: { type: "string" }, scope: { type: "string" },
    refactor: { type: "boolean" }, change: { type: "string" }, source: { type: "string" },
    root: { type: "string", default: "." }, branch: { type: "string" },
  },
  strict: true,
});
const root = path.resolve(values.root);

function branch() {
  if (values.branch) return values.branch;
  const result = spawnSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function classification() {
  return classifyRequest({
    request: values.request || values.source || "",
    entryKind: values.kind,
    target: values.target,
    interactionMode: values.mode || "checkpoint",
    repositoryPosture: values.posture || "brownfield",
    scope: values.scope || "unknown",
    refactor: values.refactor || false,
  });
}

try {
  let result;
  if (command === "classify") result = classification();
  else if (command === "start") {
    if (!values.change || !values.source) usage();
    const classified = classification();
    specs.intake(root, { changeId: values.change, source: values.source, kind: classified.entry_kind });
    result = { change_id: values.change, workflow: attachWorkflow(root, values.change, classified) };
  } else if (command === "status") {
    if (!values.change) usage();
    result = deriveWork(root, values.change);
  } else if (command === "list") result = listActiveWork(root, values.branch || null);
  else if (command === "resume") result = resumeWork(root, { changeId: values.change, branch: branch() });
  else usage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
