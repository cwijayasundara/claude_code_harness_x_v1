const fs = require("node:fs");
const path = require("node:path");
const { totals } = require("./model-usage");

const STRONG_RISKS = new Set(["architecture", "domain", "security", "privacy", "public-contract", "migration", "performance"]);
const DETERMINISTIC_TASKS = new Set(["format", "lint", "type", "test", "graph", "build", "secret-scan", "classification", "context-pack"]);
const ROLES = new Set(["sidekick", "evaluator-economical", "evaluator-strong"]);
const AGENT_TASKS = new Set(["implementation", "repair", "story-validation", "branch-review"]);

function loadRoutingPolicy(root) {
  const file = path.join(path.resolve(root), ".claude", "routing.json");
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}.`);
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = validateRoutingPolicy(policy);
  if (errors.length) throw new Error(errors.join(" "));
  return { policy, file };
}

function validateRoutingPolicy(policy) {
  const errors = [];
  if (policy.version !== 1) errors.push("routing.version must be 1.");
  for (const role of ROLES) if (!policy.models?.[role]?.model) errors.push(`routing.models.${role}.model is required.`);
  for (const role of ROLES) if (!Number.isInteger(policy.context_budgets?.[role]) || policy.context_budgets[role] <= 0) errors.push(`routing.context_budgets.${role} must be a positive integer.`);
  if (typeof policy.cost?.story_usd_ceiling !== "number" || policy.cost.story_usd_ceiling <= 0) errors.push("routing.cost.story_usd_ceiling must be positive.");
  if (typeof policy.cost?.change_usd_ceiling !== "number" || policy.cost.change_usd_ceiling <= 0) errors.push("routing.cost.change_usd_ceiling must be positive.");
  if (!policy.cost?.enforcement || !["provider-enforced", "receipt-observed"].includes(policy.cost.enforcement)) errors.push("routing.cost.enforcement is invalid.");
  if (policy.cost?.enforcement === "provider-enforced" && !policy.cost.provider_limit_reference) errors.push("routing.cost.provider_limit_reference is required for provider-enforced limits.");
  const promotion = policy.economical_evaluator_promotion;
  if (!promotion || typeof promotion.enabled !== "boolean" || !Number.isInteger(promotion.minimum_matched_samples) || promotion.minimum_matched_samples < 1) errors.push("routing.economical_evaluator_promotion is invalid.");
  return errors;
}

function withBudget(policy, decision) {
  if (decision.execution !== "agent" || !decision.role) return decision;
  return {
    ...decision,
    context_budget: policy.context_budgets[decision.role],
    agent: decision.role === "sidekick" ? "harness-generator" : decision.role === "evaluator-economical" ? "harness-evaluator-fast" : "harness-evaluator",
  };
}

function comparisonDecision(policy, comparison) {
  const promotion = policy.economical_evaluator_promotion;
  if (!promotion.enabled) return { promoted: false, reason: "economical evaluator is not human-enabled" };
  if (!comparison || comparison.status !== "eligible" || comparison.matched_samples < promotion.minimum_matched_samples) {
    return { promoted: false, reason: "insufficient eligible matched comparison evidence" };
  }
  if (comparison.economical.first_pass_acceptance < comparison.strong.first_pass_acceptance) {
    return { promoted: false, reason: "first-pass acceptance is lower" };
  }
  if (comparison.economical.escaped_defects > comparison.strong.escaped_defects) {
    return { promoted: false, reason: "escaped defects are higher" };
  }
  if (comparison.economical.mean_repair_count > comparison.strong.mean_repair_count) {
    return { promoted: false, reason: "repair count is higher" };
  }
  if (comparison.economical.mean_human_review_minutes > comparison.strong.mean_human_review_minutes + promotion.max_review_minutes_increase) {
    return { promoted: false, reason: "human review burden is higher" };
  }
  return { promoted: true, reason: "matched quality guardrails passed" };
}

function route(policy, { task, risks = [], comparison = null }) {
  for (const risk of risks) if (!STRONG_RISKS.has(risk)) throw new Error(`Unknown routing risk '${risk}'.`);
  if (DETERMINISTIC_TASKS.has(task)) {
    return { execution: "deterministic", model: null, role: null, reason: `${task} is a deterministic tool task` };
  }
  // Strong risks and branch review never downgrade — even if economical promotion is enabled.
  if (task === "branch-review" || risks.some((risk) => STRONG_RISKS.has(risk))) {
    return withBudget(policy, {
      execution: "agent",
      role: "evaluator-strong",
      model: policy.models["evaluator-strong"].model,
      reason: task === "branch-review"
        ? "branch review always uses the strongest approved evaluator"
        : `strong-risk:${risks.find((risk) => STRONG_RISKS.has(risk))}`,
    });
  }
  if (task === "story-validation") {
    const decision = comparisonDecision(policy, comparison);
    const role = decision.promoted ? "evaluator-economical" : "evaluator-strong";
    return withBudget(policy, {
      execution: "agent",
      role,
      model: policy.models[role].model,
      reason: decision.reason,
    });
  }
  if (["implementation", "repair"].includes(task)) {
    return withBudget(policy, {
      execution: "agent",
      role: "sidekick",
      model: policy.models.sidekick.model,
      reason: "bounded production or packing task",
    });
  }
  throw new Error(`Unknown routing task '${task}'.`);
}

/**
 * Full decision including observed spend ceilings from provider receipts.
 */
function decideRoute(root, { task, changeId, storyId, risks = [], comparison = null }) {
  if (!changeId || !storyId) throw new Error("changeId and storyId are required.");
  const { policy } = loadRoutingPolicy(root);
  let comparisonData = comparison;
  const comparisonFile = policy.economical_evaluator_promotion.comparison_file;
  if (!comparisonData && comparisonFile) {
    const absolute = path.join(path.resolve(root), comparisonFile);
    if (fs.existsSync(absolute)) comparisonData = JSON.parse(fs.readFileSync(absolute, "utf8"));
  }
  let decision = route(policy, { task, risks, comparison: comparisonData });
  const spend = totals(root, { storyId, changeId });
  const ceilings = {
    story_usd_ceiling: policy.cost.story_usd_ceiling,
    change_usd_ceiling: policy.cost.change_usd_ceiling,
  };
  if (decision.execution === "agent"
    && (spend.story_usd >= ceilings.story_usd_ceiling || spend.change_usd >= ceilings.change_usd_ceiling)) {
    decision = {
      execution: "human-approval-required",
      model: null,
      role: null,
      context_budget: null,
      agent: null,
      reason: "observed cost ceiling reached; obtain a human decision before further model work",
    };
  }
  return {
    ...decision,
    task,
    risks,
    observed_spend: spend,
    ceilings,
    enforcement: policy.cost.enforcement,
    enforcement_note: policy.cost.enforcement === "receipt-observed"
      ? "Ceilings stop further routing after recorded provider receipts; not a live provider hard limit unless provider-enforced."
      : "Provider-enforced limit reference must be real and cited in routing.cost.provider_limit_reference.",
  };
}

function evaluateComparison(samples) {
  if (!Array.isArray(samples)) throw new Error("Comparison samples must be an array.");
  const pairs = new Map();
  for (const sample of samples) {
    if (!sample.pair_id || !sample.case_hash || !["economical", "strong"].includes(sample.route)) throw new Error("Every comparison sample requires pair_id, case_hash, and economical|strong route.");
    if (typeof sample.accepted_first_pass !== "boolean" || !Number.isInteger(sample.escaped_defects) || sample.escaped_defects < 0 || !Number.isInteger(sample.repair_count) || sample.repair_count < 0 || typeof sample.human_review_minutes !== "number" || sample.human_review_minutes < 0 || typeof sample.elapsed_seconds !== "number" || sample.elapsed_seconds < 0 || !Number.isInteger(sample.context_tokens) || sample.context_tokens < 0) throw new Error(`Comparison sample '${sample.pair_id}' has invalid quality measures.`);
    const pair = pairs.get(sample.pair_id) || {};
    if (pair[sample.route]) throw new Error(`Duplicate ${sample.route} sample for '${sample.pair_id}'.`);
    pair[sample.route] = sample;
    pairs.set(sample.pair_id, pair);
  }
  for (const [pairId, pair] of pairs) if (pair.economical && pair.strong && pair.economical.case_hash !== pair.strong.case_hash) throw new Error(`Matched pair '${pairId}' does not use the same case_hash.`);
  const matched = [...pairs.values()].filter((pair) => pair.economical && pair.strong);
  const aggregate = (routeName) => {
    const rows = matched.map((pair) => pair[routeName]);
    return {
      first_pass_acceptance: rows.length ? rows.filter((row) => row.accepted_first_pass).length / rows.length : 0,
      escaped_defects: rows.reduce((sum, row) => sum + row.escaped_defects, 0),
      mean_human_review_minutes: rows.length ? rows.reduce((sum, row) => sum + row.human_review_minutes, 0) / rows.length : 0,
      mean_repair_count: rows.length ? rows.reduce((sum, row) => sum + row.repair_count, 0) / rows.length : 0,
      mean_elapsed_seconds: rows.length ? rows.reduce((sum, row) => sum + row.elapsed_seconds, 0) / rows.length : 0,
      mean_context_tokens: rows.length ? rows.reduce((sum, row) => sum + row.context_tokens, 0) / rows.length : 0,
      mean_cost_usd: rows.length ? rows.reduce((sum, row) => sum + (row.cost_usd || 0), 0) / rows.length : 0,
    };
  };
  return { status: matched.length ? "eligible" : "insufficient", matched_samples: matched.length, economical: aggregate("economical"), strong: aggregate("strong") };
}

module.exports = {
  AGENT_TASKS,
  DETERMINISTIC_TASKS,
  STRONG_RISKS,
  comparisonDecision,
  decideRoute,
  evaluateComparison,
  loadRoutingPolicy,
  route,
  validateRoutingPolicy,
};
