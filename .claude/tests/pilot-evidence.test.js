const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { recordPilot, evaluatePilots } = require("../lib/pilot-evidence");

function project(policy = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-evidence-"));
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
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
    ...policy,
  }));
  fs.writeFileSync(path.join(root, "evidence.json"), "{}\n");
  return root;
}

function pilot(id, scenarioType) {
  return {
    pilot_id: id, change_id: `change-${id}`, scenario_type: scenarioType,
    completed_at: "2026-07-01T00:00:00.000Z", reviewer: "reviewer",
    outcome: "accepted", first_pass_accepted: true, story_count: 1,
    human_review_minutes: 10, escaped_defects: 0, observation_days: 14,
    sensor_findings: 1, sensor_true_positives: 1, sensor_findings_corrected: 1,
    modularity_reviews: 1, modularity_findings: 1, modularity_true_positives: 1,
    modularity_useful_reviews: 1, modularity_review_minutes: 3,
    provider_cost_usd: 1, graph_queries: 2, graph_useful_results: 2,
    evidence_refs: ["branch-readiness", "human-review", "defect-observation", "sensor-assessment", "provider-receipt", ...(scenarioType === "brownfield" ? ["graph-assessment"] : [])]
      .map((label) => ({ label, path: "evidence.json" })),
    residual_risks: [],
  };
}

test("requires matched real pilots and leaves rollout to a human", () => {
  const root = project();
  assert.equal(evaluatePilots(root).status, "insufficient-evidence");
  recordPilot(root, pilot("green-1", "greenfield"));
  recordPilot(root, pilot("brown-1", "brownfield"));
  const report = evaluatePilots(root);
  assert.equal(report.status, "eligible-for-human-rollout-decision");
  assert.equal(report.decision_authority, "human");
  assert.equal(report.metrics.sensor_precision, 1);
  assert.equal(report.metrics.brownfield_graph_useful_rate, 1);
  assert.equal(report.metrics.modularity_review_precision, 1);
  assert.equal(report.metrics.modularity_review_value_rate, 1);
});

test("holds rollout when measured quality misses policy", () => {
  const root = project();
  recordPilot(root, pilot("green-1", "greenfield"));
  const brown = pilot("brown-1", "brownfield");
  brown.human_review_minutes = 100;
  recordPilot(root, brown);
  assert.equal(evaluatePilots(root).status, "hold");
});

test("pilot records and their evidence are immutable", () => {
  const root = project();
  recordPilot(root, pilot("green-1", "greenfield"));
  assert.throws(() => recordPilot(root, pilot("green-1", "greenfield")), /immutable/);
  fs.writeFileSync(path.join(root, "evidence.json"), "changed\n");
  assert.throws(() => evaluatePilots(root), /evidence drift/);
});
