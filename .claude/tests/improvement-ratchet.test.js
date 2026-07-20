const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ratchet = require("../lib/improvement-ratchet");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "improvement-ratchet-"));
  fs.mkdirSync(path.join(root, ".claude", "specs", "evidence"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "specs", "evidence", "finding.json"), "{}\n");
  return root;
}

function observation(root, number, overrides = {}) {
  return ratchet.appendEvent(root, {
    event_key: `finding-${number}`,
    change_id: `change-${number < 3 ? 1 : 2}`,
    story_id: `story-${number}`,
    stage: "STORY_REVIEW",
    type: "validator-finding",
    classification: "verification.missing-test",
    severity: "blocking",
    evidence_refs: [{ path: ".claude/specs/evidence/finding.json" }],
    ...overrides,
  }).event;
}

function candidateInput(events) {
  return {
    candidate_id: "imp-1",
    classification: "verification.missing-test",
    evidence_event_ids: events.map((event) => event.event_id),
    diagnosis: {
      observed_problem: "Failure-path tests are repeatedly absent.",
      suspected_upstream_stage: "G2",
      confidence: 0.8,
      alternative_explanations: ["The story contract may omit the test reference."],
    },
    proposed_change: { type: "replace", target: "test-guide", summary: "Require explicit failure-path cases." },
    hypothesis: { metric: "missing_tests_per_story", expected_direction: "decrease", minimum_improvement: 0.25 },
  };
}

function result(missingTests, overrides = {}) {
  return {
    sample_size: 3,
    cost_usd: 2,
    metrics: {
      missing_tests_per_story: missingTests,
      escaped_defects: 0,
      first_pass_acceptance_rate: 0.8,
      human_review_minutes: 20,
      provider_cost_per_accepted_story_usd: 2,
      active_control_count: 10,
      ...overrides,
    },
  };
}

test("records hash-backed events idempotently and detects corroborated patterns", () => {
  const root = project();
  const events = [observation(root, 1), observation(root, 2), observation(root, 3)];
  assert.equal(ratchet.appendEvent(root, { ...events[0], event_id: undefined }).duplicate, true);
  assert.equal(ratchet.loadEvents(root).length, 3);
  const pattern = ratchet.buildPatterns(ratchet.loadEvents(root))[0];
  assert.equal(pattern.status, "CORROBORATED");
  assert.equal(pattern.story_ids.length, 3);
  assert.equal(pattern.change_ids.length, 2);
});

test("refuses candidates without corroborated independent evidence", () => {
  const root = project();
  const events = [observation(root, 1), observation(root, 2)];
  assert.throws(() => ratchet.createCandidate(root, candidateInput(events)), /not corroborated/);
});

test("requires human experiment approval and never auto-promotes an eligible treatment", () => {
  const root = project();
  const events = [observation(root, 1), observation(root, 2), observation(root, 3)];
  ratchet.createCandidate(root, candidateInput(events));
  assert.throws(() => ratchet.approveExperiment(root, {
    experiment_id: "exp-1", candidate_id: "imp-1", baseline_harness_sha256: "a".repeat(64),
    treatment_harness_sha256: "b".repeat(64), minimum_sample_size: 3,
  }), /approved_by/);
  ratchet.approveExperiment(root, {
    experiment_id: "exp-1", candidate_id: "imp-1", approved_by: "reviewer@example.com",
    baseline_harness_sha256: "a".repeat(64), treatment_harness_sha256: "b".repeat(64), minimum_sample_size: 3,
  });
  const evaluated = ratchet.evaluateExperiment(root, "exp-1", result(0.6), result(0.2));
  assert.equal(evaluated.decision.status, "ELIGIBLE_FOR_HUMAN_PROMOTION");
  assert.equal(evaluated.decision.applies_automatically, false);
  assert.equal(ratchet.loadCandidate(root, "imp-1").candidate.state, "ELIGIBLE");
  assert.throws(() => ratchet.transitionCandidate(root, "imp-1", "PROMOTED", "Adopt treatment."), /human authority/);
  assert.throws(() => ratchet.transitionCandidate(root, "imp-1", "CORROBORATED", "Skip backwards."), /not allowed/);
});

test("rejects a treatment that improves its target but regresses a protected guardrail", () => {
  const root = project();
  const events = [observation(root, 1), observation(root, 2), observation(root, 3)];
  ratchet.createCandidate(root, candidateInput(events));
  ratchet.approveExperiment(root, {
    experiment_id: "exp-1", candidate_id: "imp-1", approved_by: "reviewer@example.com",
    baseline_harness_sha256: "a".repeat(64), treatment_harness_sha256: "b".repeat(64), minimum_sample_size: 3,
  });
  const evaluated = ratchet.evaluateExperiment(root, "exp-1", result(0.6), result(0.2, { escaped_defects: 1 }));
  assert.equal(evaluated.decision.status, "REJECT");
  assert.equal(ratchet.loadCandidate(root, "imp-1").candidate.state, "REJECTED");
});

test("detects evidence drift in the append-only event ledger", () => {
  const root = project();
  observation(root, 1);
  fs.writeFileSync(path.join(root, ".claude", "specs", "evidence", "finding.json"), "changed\n");
  assert.throws(() => ratchet.loadEvents(root), /hash does not match/);
});
