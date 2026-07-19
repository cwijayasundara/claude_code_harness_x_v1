#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { packContext } = require("../lib/context-budget");
const { recordUsage, totals } = require("../lib/model-usage");
const { decideRoute, evaluateComparison, loadRoutingPolicy } = require("../lib/routing-policy");

function usage() {
  process.stderr.write(
    "Usage:\n" +
    "  harness-routing.js decide --task <type> --change <id> --story <id> [--risk <risk>]... [--root .]\n" +
    "  harness-routing.js pack --role <role> --story <id> --manifest <json> [--root .]\n" +
    "  harness-routing.js compare --samples <json> [--root .]\n" +
    "  harness-routing.js receipt --file <provider-receipt.json> [--root .]\n"
  );
  process.exit(2);
}

function projectJson(root, candidate) {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Input JSON must be inside the target project.");
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

const [command, ...args] = process.argv.slice(2);
const values = { root: ".", risks: [] };
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index]; const value = args[++index];
  if (!value) usage();
  if (flag === "--risk") values.risks.push(value);
  else if (flag.startsWith("--")) values[flag.slice(2)] = value;
  else usage();
}
if (!command) usage();
try {
  const root = path.resolve(values.root);
  const { policy } = loadRoutingPolicy(root);
  if (command === "decide" && values.task && values.change && values.story) {
    const decision = decideRoute(root, {
      task: values.task,
      changeId: values.change,
      storyId: values.story,
      risks: values.risks,
    });
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } else if (command === "pack" && values.role && values.story && values.manifest) {
    const budget = policy.context_budgets[values.role];
    if (!budget) throw new Error(`Unknown context role '${values.role}'.`);
    const packed = packContext(root, { manifest: projectJson(root, values.manifest), tokenBudget: budget });
    const output = path.join(root, ".claude", "state", "context", `${values.story}-${values.role}.json`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(packed, null, 2)}\n`);
    process.stdout.write(`CONTEXT ${output}\nESTIMATED_TOKENS ${packed.estimated_tokens}/${packed.budget_tokens}\n`);
  } else if (command === "compare" && values.samples) {
    const comparison = evaluateComparison(projectJson(root, values.samples));
    const output = path.join(root, policy.economical_evaluator_promotion.comparison_file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(comparison, null, 2)}\n`);
    process.stdout.write(`COMPARISON ${output}\nMATCHED ${comparison.matched_samples}\n`);
  } else if (command === "receipt" && values.file) {
    const result = recordUsage(root, projectJson(root, values.file));
    const spend = totals(root, { storyId: result.normalized.story_id, changeId: result.normalized.change_id });
    process.stdout.write(`${JSON.stringify({ receipt: result.normalized, observed_spend: spend, ceilings: policy.cost }, null, 2)}\n`);
  } else usage();
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
