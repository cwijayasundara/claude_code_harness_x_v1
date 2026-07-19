#!/usr/bin/env node

const path = require("node:path");
const { validateHarnessConfig } = require("../lib/harness-config");
const {
  loadControlManifest,
  summarizeControlBudget,
  validateControlManifest,
} = require("../lib/control-manifest");

const root = path.resolve(process.argv[2] || ".");

try {
  const { config, errors } = validateHarnessConfig(root);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`ERROR: ${error}\n`);
    process.exit(1);
  }

  process.stdout.write(`PASS  Harness config: ${root}\n`);
  process.stdout.write(`INFO  Profiles: ${config.technologyProfiles.join(", ")}\n`);
  process.stdout.write(`INFO  Domain pack: ${config.domainPack}\n`);
  const { manifest } = loadControlManifest(root);
  const manifestErrors = validateControlManifest(manifest);
  if (manifestErrors.length > 0) {
    for (const error of manifestErrors) process.stderr.write(`ERROR: ${error}\n`);
    process.exit(1);
  }
  const budget = summarizeControlBudget(manifest);
  process.stdout.write(
    `INFO  Active controls: ${budget.active}/${budget.max_active ?? "?"} ` +
    `(baseline ${budget.baseline}, headroom ${budget.headroom ?? "?"})\n`
  );
  if (budget.net_adds.length > 0) {
    process.stdout.write(`INFO  Net-add controls: ${budget.net_adds.join(", ")}\n`);
  }
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(2);
}
