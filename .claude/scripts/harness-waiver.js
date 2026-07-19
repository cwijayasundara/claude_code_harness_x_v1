#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { loadWaivers, validateWaivers } = require("../lib/sensor-waivers");

function parseArguments(args) {
  const values = { root: "." };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--") || !args[index + 1]) throw new Error(`Expected a value after ${key}.`);
    values[key.slice(2).replaceAll("-", "_")] = args[index + 1];
    index += 1;
  }
  return values;
}

try {
  const args = parseArguments(process.argv.slice(2));
  const root = path.resolve(args.root);
  for (const field of ["id", "sensor_id", "path", "owner", "approved_by", "reason", "expires_on"]) {
    if (!args[field]) throw new Error(`--${field.replaceAll("_", "-")} is required.`);
  }
  const { waiverPath, waivers } = loadWaivers(root);
  if (waivers.waivers.some((waiver) => waiver.id === args.id)) throw new Error(`Waiver ${args.id} already exists.`);
  waivers.waivers.push({
    id: args.id,
    sensor_id: args.sensor_id,
    affected_paths: [args.path],
    owner: args.owner,
    approved_by: args.approved_by,
    reason: args.reason,
    expires_on: args.expires_on,
  });
  const errors = validateWaivers(waivers);
  if (errors.length > 0) throw new Error(errors.join(" "));
  fs.writeFileSync(waiverPath, `${JSON.stringify(waivers, null, 2)}\n`, "utf8");
  process.stdout.write(`INFO  Created waiver ${args.id} in ${waiverPath}\n`);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
