#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { checkCoverage, checkGenerative, checkMutation, loadRegressionConfig } = require("../lib/regression-sensors");
const { gitChangedPaths } = require("../lib/sensor-scope");

function parseArguments(args) {
  const parsed = { root: ".", kind: null, changedPaths: [] };
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (item === "--kind") { parsed.kind = args[++index]; }
    else if (item === "--changed") { parsed.changedPaths.push(args[++index]); }
    else if (!item.startsWith("-") && parsed.root === ".") parsed.root = item;
    else throw new Error(`Unknown argument: ${item}`);
  }
  if (!["coverage", "mutation", "property", "fuzz"].includes(parsed.kind)) throw new Error("--kind must be coverage, mutation, property, or fuzz.");
  if (parsed.changedPaths.some((item) => !item)) throw new Error("--changed requires a path.");
  return parsed;
}

function expandArgs(settings, changedPaths) {
  const joined = changedPaths.join(",");
  const extra = changedPaths.length ? settings.changed_args : [];
  return [...settings.args, ...extra].map((item) => item.replaceAll("{paths}", joined));
}

let options;
try { options = parseArguments(process.argv.slice(2)); } catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exit(2); }
const root = path.resolve(options.root);
const { config } = loadRegressionConfig(root);
const settings = config[options.kind];
if (!settings.enabled) { process.stderr.write(`ERROR: ${options.kind} regression sensing is disabled.\n`); process.exit(2); }
if (!settings.command) { process.stderr.write(`ERROR: ${options.kind}.command is not configured.\n`); process.exit(2); }
const changedPaths = options.changedPaths.length ? options.changedPaths : gitChangedPaths(root);
const args = expandArgs(settings, changedPaths);
const started = Date.now();
const execution = spawnSync(settings.command, args, { cwd: root, encoding: "utf8", timeout: 15 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
let result = null;
if (!execution.error && execution.status === 0) {
  if (options.kind === "coverage") result = checkCoverage(root, changedPaths);
  else if (options.kind === "mutation") result = checkMutation(root, changedPaths);
  else result = checkGenerative(root, options.kind);
}
const report = {
  generated_at: new Date().toISOString(), kind: options.kind, command: settings.command, args,
  changed_paths: changedPaths, exit_code: execution.status, runtime_ms: Date.now() - started,
  status: execution.error || execution.status !== 0 ? "fail" : result?.status || "fail",
  reason: execution.error?.message || (execution.status !== 0 ? `${settings.command} exited ${execution.status}.` : result.reason),
  metrics: result?.metrics || null,
};
const reportPath = path.join(root, ".claude", "specs", "evidence", "runtime", "regression-execution.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.status === "fail" ? 1 : 0);
