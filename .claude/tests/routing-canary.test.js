const assert = require("node:assert/strict");
const test = require("node:test");
const { runRoutingCanary } = require("../lib/routing-canary");

test("routing canary enforces strong risks, promotion gates, packs, and spend ceilings", () => {
  const report = runRoutingCanary();
  assert.equal(report.status, "pass");
  assert.equal(report.decisions.lint, "deterministic");
  assert.equal(report.decisions.implementation, "sidekick");
  assert.equal(report.decisions.ordinary_before_promotion, "evaluator-strong");
  assert.equal(report.decisions.ordinary_after_promotion, "evaluator-economical");
  assert.equal(report.decisions.security_with_promotion, "evaluator-strong");
  assert.equal(report.decisions.branch_review, "evaluator-strong");
  assert.equal(report.decisions.after_ceiling, "human-approval-required");
  assert.ok(report.context_pack.tool_omitted_lines > 0);
  assert.ok(report.context_pack.selected_kinds.includes("source-requirement"));
  assert.equal(report.rejected_fabricated_receipt, true);
  assert.ok(report.observed_spend.story_usd >= 1.25);
});
