#!/usr/bin/env node

const path = require("node:path");
const { configure, PROVIDERS } = require("../lib/tracker-mcp");

function usage() {
  process.stderr.write("Usage: harness-tracker-mcp.js configure --provider <linear|jira|azure-devops|all> [--azure-org <org>] [--replace] [--root .]\n");
  process.exit(2);
}

const [command, ...raw] = process.argv.slice(2);
if (command !== "configure") usage();
const values = { root: "." };
let replace = false;
for (let index = 0; index < raw.length; index += 1) {
  const token = raw[index];
  if (token === "--replace") { replace = true; continue; }
  if (!token?.startsWith("--") || raw[index + 1] === undefined || raw[index + 1].startsWith("--")) usage();
  values[token.slice(2)] = raw[index + 1];
  index += 1;
}
if (!values.provider) usage();
try {
  const providers = values.provider === "all" ? [...PROVIDERS] : values.provider.split(",");
  const result = configure(path.resolve(values.root), { providers, azureOrg: values["azure-org"], replace });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
