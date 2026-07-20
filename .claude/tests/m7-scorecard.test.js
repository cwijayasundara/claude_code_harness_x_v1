const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { buildM7Scorecard, writeM7Scorecard } = require("../lib/m7-scorecard");
const { recordPilot } = require("../lib/pilot-evidence");

const pluginRoot = path.resolve(__dirname, "..");

function seededProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "m7-scorecard-"));
  execFileSync(process.execPath, [path.join(pluginRoot, "scripts", "harness-init.js"), root], {
    stdio: "ignore",
  });
  return root;
}

function pilot(id, scenarioType, overrides = {}) {
  return {
    pilot_id: id,
    change_id: `change-${id}`,
    scenario_type: scenarioType,
    completed_at: "2026-07-01T00:00:00.000Z",
    reviewer: "reviewer",
    outcome: "accepted",
    first_pass_accepted: true,
    story_count: 1,
    human_review_minutes: 10,
    escaped_defects: 0,
    observation_days: 14,
    sensor_findings: 1,
    sensor_true_positives: 1,
    sensor_findings_corrected: 1,
    modularity_reviews: 1,
    modularity_findings: 1,
    modularity_true_positives: 1,
    modularity_useful_reviews: 1,
    modularity_review_minutes: 3,
    provider_cost_usd: 1,
    graph_queries: 2,
    graph_useful_results: 2,
    evidence_refs: [
      "branch-readiness",
      "human-review",
      "defect-observation",
      "sensor-assessment",
      "provider-receipt",
      ...(scenarioType === "brownfield" ? ["graph-assessment"] : []),
    ].map((label) => ({ label, path: "evidence.json" })),
    residual_risks: [],
    ...overrides,
  };
}

test("m7 scorecard is insufficient without real pilots and never auto-rollouts", () => {
  const root = seededProject();
  const scorecard = buildM7Scorecard(root, { syntheticStatus: "pass" });
  assert.equal(scorecard.decision_authority, "human");
  assert.equal(scorecard.never_auto_rollouts, true);
  assert.equal(scorecard.rollout.status, "insufficient-evidence");
  assert.equal(scorecard.synthetic.status, "pass");
  assert.ok(scorecard.harness.control_budget);
  assert.equal(scorecard.subtraction.applies_automatically, false);
  assert.ok(scorecard.next_actions.some((action) => /pilot/i.test(action)));
});

test("m7 scorecard becomes eligible only after matched pilots and still human-owned", () => {
  const root = seededProject();
  // Align policy to one of each for this unit test.
  fs.writeFileSync(path.join(root, ".claude", "pilot-policy.json"), JSON.stringify({
    schema_version: 1,
    minimum_pilots: { greenfield: 1, brownfield: 1 },
    minimum_observation_days: 14,
    thresholds: {
      minimum_first_pass_acceptance_rate: 0.8,
      maximum_mean_human_review_minutes: 30,
      maximum_escaped_defects_per_accepted_story: 0.1,
      minimum_sensor_precision: 0.8,
      minimum_sensor_correction_rate: 0.9,
      maximum_mean_provider_cost_per_accepted_story_usd: 5,
      minimum_brownfield_graph_useful_rate: 0.6,
      minimum_modularity_review_precision: 0.7,
      minimum_modularity_review_value_rate: 0.5,
    },
  }));
  fs.writeFileSync(path.join(root, "evidence.json"), "{}\n");
  recordPilot(root, pilot("green-1", "greenfield"));
  recordPilot(root, pilot("brown-1", "brownfield"));
  const { scorecard, file } = writeM7Scorecard(root, { syntheticStatus: "pass" });
  assert.equal(scorecard.rollout.status, "eligible-for-human-rollout-decision");
  assert.equal(scorecard.decision_authority, "human");
  assert.ok(fs.existsSync(file));
  assert.ok(scorecard.next_actions.some((action) => /Human reviews/i.test(action)));
});
