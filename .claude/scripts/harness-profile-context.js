#!/usr/bin/env node

const path = require("node:path");
const { loadHarnessConfig } = require("../lib/harness-config");
const { resolveProfiles } = require("../lib/profile-context");

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(__dirname, "..");

const values = { root: ".", paths: [], hints: [], maxFrameworks: null };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  const value = args[++index];
  if (value === undefined) process.exit(2);
  if (flag === "--path") values.paths.push(value);
  else if (flag === "--hint") values.hints.push(value);
  else if (flag === "--root") values.root = value;
  else if (flag === "--max-frameworks") values.maxFrameworks = Number(value);
  else process.exit(2);
}
if (!values.paths.length) {
  process.stderr.write(
    "Usage: harness-profile-context.js --path <changed-path> [--path ...] " +
    "[--hint <configured-profile>] [--max-frameworks N] [--root .]\n"
  );
  process.exit(2);
}
try {
  const root = path.resolve(values.root);
  const config = loadHarnessConfig(root);
  const options = {
    configuredProfiles: config.technologyProfiles,
    changedPaths: values.paths,
    hints: values.hints,
    pluginRoot,
  };
  if (Number.isInteger(values.maxFrameworks)) options.maxFrameworkProfiles = values.maxFrameworks;
  process.stdout.write(`${JSON.stringify(resolveProfiles(root, options), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
