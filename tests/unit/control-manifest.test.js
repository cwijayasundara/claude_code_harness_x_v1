const test = require("node:test");
const assert = require("node:assert/strict");

const {
  summarizeControlBudget,
  validateControlManifest,
} = require("../../.claude/lib/control-manifest");

function control(overrides = {}) {
  return {
    id: "profile-verification",
    kind: "sensor",
    direction: "feedback",
    execution_type: "computational",
    regulates: ["maintainability"],
    axis: "maintainability",
    cadence: "session",
    severity: "blocking",
    status: "active",
    scope: "Changed profile code.",
    owner: "Profile maintainer",
    introduced_for: "Missing verification evidence.",
    cost: "Fast.",
    review_date: "2026-10-01",
    removal_criteria: "Equivalent replacement exists.",
    execution: "runner",
    self_correction: "Repair the reported failure and rerun the affected sensor.",
    ...overrides,
  };
}

function budgeted(controls, budgetOverrides = {}) {
  const activeIds = controls.filter((c) => c.status === "active").map((c) => c.id);
  return {
    version: 1,
    control_budget: {
      max_active: 12,
      baseline_ids: activeIds,
      ...budgetOverrides,
    },
    controls,
  };
}

test("accepts a complete versioned control manifest with budget", () => {
  assert.deepEqual(validateControlManifest(budgeted([control()])), []);
});

test("rejects controls without Fowler control metadata or active sensor correction", () => {
  const errors = validateControlManifest(budgeted([control({
    id: "not valid",
    owner: "",
    execution: "",
    direction: "feedforward",
    execution_type: "opaque",
    regulates: [],
    self_correction: "",
  })], { baseline_ids: ["not-valid"] }));

  assert.match(errors.join("\n"), /kebab-case/);
  assert.match(errors.join("\n"), /owner is required/);
  assert.match(errors.join("\n"), /execution is required/);
  assert.match(errors.join("\n"), /direction must be feedback/);
  assert.match(errors.join("\n"), /execution_type/);
  assert.match(errors.join("\n"), /regulates/);
  assert.match(errors.join("\n"), /self_correction is required/);
});

test("requires control_budget and rejects over-budget active sets", () => {
  const withoutBudget = {
    version: 1,
    controls: [control()],
  };
  assert.match(validateControlManifest(withoutBudget).join("\n"), /control_budget is required/);

  const over = budgeted(
    [control({ id: "a" }), control({ id: "b" })],
    { max_active: 1, baseline_ids: ["a", "b"] }
  );
  assert.match(validateControlManifest(over).join("\n"), /exceed max_active/);
});

test("net-add controls outside baseline need justification or replaces", () => {
  const bareNetAdd = budgeted(
    [control({ id: "baseline-one" }), control({ id: "extra-sensor" })],
    { baseline_ids: ["baseline-one"], max_active: 5 }
  );
  assert.match(validateControlManifest(bareNetAdd).join("\n"), /net_add_justification or replaces/);

  const justified = budgeted(
    [
      control({ id: "baseline-one" }),
      control({
        id: "extra-sensor",
        net_add_justification: "Recurring secret leaks in agent commits required a scan.",
      }),
    ],
    { baseline_ids: ["baseline-one"], max_active: 5 }
  );
  assert.deepEqual(validateControlManifest(justified), []);

  const replacesStillActive = budgeted(
    [
      control({ id: "old-sensor" }),
      control({ id: "new-sensor", replaces: "old-sensor" }),
    ],
    { baseline_ids: [], max_active: 5 }
  );
  assert.match(validateControlManifest(replacesStillActive).join("\n"), /still active/);

  const replacesRetired = budgeted(
    [
      control({ id: "old-sensor", status: "retired", execution: "n/a", self_correction: "n/a" }),
      control({ id: "new-sensor", replaces: "old-sensor" }),
    ],
    { baseline_ids: [], max_active: 5 }
  );
  assert.deepEqual(validateControlManifest(replacesRetired), []);
});

test("summarizeControlBudget reports headroom and net-adds", () => {
  const manifest = budgeted(
    [
      control({ id: "baseline-one" }),
      control({
        id: "extra-sensor",
        net_add_justification: "Recurring failure needed a new sensor.",
      }),
    ],
    { baseline_ids: ["baseline-one"], max_active: 4 }
  );
  assert.deepEqual(summarizeControlBudget(manifest), {
    active: 2,
    max_active: 4,
    baseline: 1,
    net_adds: ["extra-sensor"],
    headroom: 2,
  });
});
