const assert = require("node:assert/strict");
const test = require("node:test");
const { evaluateComparison, route, validateRoutingPolicy } = require("../lib/routing-policy");

function policy(enabled = false) {
  return {
    version: 1,
    models: {
      sidekick: { model: "sonnet" },
      "evaluator-economical": { model: "haiku" },
      "evaluator-strong": { model: "opus" },
    },
    context_budgets: {
      sidekick: 1000,
      "evaluator-economical": 1000,
      "evaluator-strong": 2000,
    },
    cost: {
      story_usd_ceiling: 5,
      change_usd_ceiling: 25,
      enforcement: "receipt-observed",
    },
    economical_evaluator_promotion: {
      enabled,
      minimum_matched_samples: 2,
      max_review_minutes_increase: 0,
    },
  };
}

test("routes deterministic work without a model and risk to the strong evaluator", () => {
  assert.equal(route(policy(), { task: "test" }).execution, "deterministic");
  assert.equal(route(policy(), { task: "context-pack" }).execution, "deterministic");
  assert.equal(route(policy(), { task: "story-validation", risks: ["security"] }).role, "evaluator-strong");
  assert.equal(route(policy(), { task: "branch-review" }).role, "evaluator-strong");
  assert.equal(route(policy(), { task: "implementation" }).context_budget, 1000);
});

test("does not use the economical evaluator before human-enabled matched evidence", () => {
  assert.equal(route(policy(false), { task: "story-validation" }).role, "evaluator-strong");
  assert.equal(route(policy(true), { task: "story-validation", comparison: { status: "insufficient", matched_samples: 0 } }).role, "evaluator-strong");
});

test("promotes economical validation only when matched quality is preserved", () => {
  const samples = [
    { pair_id: "A", case_hash: "case-a", route: "economical", accepted_first_pass: true, escaped_defects: 0, repair_count: 0, human_review_minutes: 2, elapsed_seconds: 5, context_tokens: 100, cost_usd: 0.1 },
    { pair_id: "A", case_hash: "case-a", route: "strong", accepted_first_pass: true, escaped_defects: 0, repair_count: 0, human_review_minutes: 2, elapsed_seconds: 6, context_tokens: 100, cost_usd: 0.5 },
    { pair_id: "B", case_hash: "case-b", route: "economical", accepted_first_pass: true, escaped_defects: 0, repair_count: 0, human_review_minutes: 1, elapsed_seconds: 5, context_tokens: 90, cost_usd: 0.1 },
    { pair_id: "B", case_hash: "case-b", route: "strong", accepted_first_pass: true, escaped_defects: 0, repair_count: 0, human_review_minutes: 1, elapsed_seconds: 7, context_tokens: 90, cost_usd: 0.5 },
  ];
  const comparison = evaluateComparison(samples);
  assert.equal(route(policy(true), { task: "story-validation", comparison }).role, "evaluator-economical");
  assert.equal(comparison.matched_samples, 2);
  // Strong risks never downgrade even when promotion is eligible.
  assert.equal(
    route(policy(true), { task: "story-validation", risks: ["security"], comparison }).role,
    "evaluator-strong"
  );
  assert.equal(
    route(policy(true), { task: "branch-review", comparison }).role,
    "evaluator-strong"
  );
});

test("validates required model, budget, and cost policy", () => {
  assert.deepEqual(validateRoutingPolicy(policy()), []);
});
