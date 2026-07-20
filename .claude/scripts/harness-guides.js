#!/usr/bin/env node
const path = require("node:path");
const { loadGuideCatalog, resolveGuides, validateGuideCatalog } = require("../lib/feedforward-guides");
const values = { root: ".", paths: [], needs: [], capabilities: [] };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index]; const value = args[++index];
  if (value === undefined) process.exit(2);
  if (flag === "--root") values.root = value; else if (flag === "--path") values.paths.push(value); else if (flag === "--need") values.needs.push(value); else if (flag === "--available-capability") values.capabilities.push(value); else process.exit(2);
}
try {
  const root = path.resolve(values.root); const { catalog } = loadGuideCatalog(root); const errors = validateGuideCatalog(root, catalog);
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(`${JSON.stringify({ paths: values.paths, needs: values.needs, guides: resolveGuides(root, catalog, { paths: values.paths, needs: values.needs, availableCapabilities: values.capabilities }) }, null, 2)}\n`);
} catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exit(1); }
