const fs = require("node:fs");
const path = require("node:path");
const { evaluatePilots } = require("./pilot-evidence");
const { loadControlManifest, summarizeControlBudget } = require("./control-manifest");
const { proposeControlSubtractions } = require("./control-subtract");

/**
 * Aggregate synthetic canary inventory, pilot readiness, and subtraction
 * proposals. Never authorizes rollout — decision_authority remains human.
 */
function buildM7Scorecard(root, options = {}) {
  const projectRoot = path.resolve(root);
  const asOf = options.asOf || new Date().toISOString();

  let pilot;
  try {
    pilot = evaluatePilots(projectRoot);
  } catch (error) {
    pilot = {
      status: "insufficient-evidence",
      decision_authority: "human",
      error: error.message,
      metrics: null,
      checks: [],
    };
  }

  let controlBudget = null;
  let subtraction = null;
  try {
    const { manifest } = loadControlManifest(projectRoot);
    controlBudget = summarizeControlBudget(manifest);
    subtraction = proposeControlSubtractions(manifest, { root: projectRoot, asOf });
  } catch (error) {
    subtraction = {
      applies_automatically: false,
      decision_authority: "human",
      error: error.message,
      proposals: [],
      summary: { total: 0, blocking_candidates: 0, advisory: 0 },
    };
  }

  const synthetic = {
    measurement_type: "synthetic-deterministic-canaries",
    required: [
      "harness-lived-canary.js",
      "harness-multi-story-canary.js",
      "harness-brownfield-canary.js",
      "harness-routing-canary.js",
      "harness-p7-canary.js",
    ],
    limitations: [
      "Synthetic canaries prove control integration only.",
      "They do not measure human review time, escaped production defects, provider cost quality, or real graph value.",
    ],
    status: options.syntheticStatus || "delegated-to-release-check",
  };

  // Product readiness for broader rollout: pilot-driven only.
  const rollout = {
    status: pilot.status || "insufficient-evidence",
    decision_authority: "human",
    note: pilot.status === "eligible-for-human-rollout-decision"
      ? "Metrics met policy; a human still decides whether to expand, tune, or stop."
      : pilot.status === "hold"
        ? "Pilot metrics missed thresholds; subtract/tune before another pilot window."
        : "Record ≥3 greenfield and ≥3 brownfield real pilots with observation windows before rollout eligibility.",
  };

  // Harness engineering readiness: synthetic path + control budget intact.
  const harness = {
    status: controlBudget && Number.isInteger(controlBudget.headroom) && controlBudget.headroom >= 0
      ? "synthetic-controls-ready"
      : "control-budget-missing-or-over",
    control_budget: controlBudget,
    subtraction_summary: subtraction.summary,
  };

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    measurement_type: "m7-release-and-pilot-scorecard",
    decision_authority: "human",
    never_auto_merges: true,
    never_auto_rollouts: true,
    synthetic,
    harness,
    pilot,
    subtraction,
    rollout,
    next_actions: buildNextActions(rollout, subtraction, harness),
  };
}

function buildNextActions(rollout, subtraction, harness) {
  const actions = [];
  if (rollout.status === "insufficient-evidence") {
    actions.push("Run real greenfield/brownfield pilots and record them with harness-pilot.js record.");
  }
  if (rollout.status === "hold") {
    actions.push("Review failed pilot checks; subtract or tune controls before a new pilot window.");
  }
  if (rollout.status === "eligible-for-human-rollout-decision") {
    actions.push("Human reviews pilot-readiness.json and decides expand / tune / stop.");
  }
  if (subtraction?.summary?.total > 0) {
    actions.push("Review subtraction proposals via /harness-retro; retire or justify each nominated control.");
  }
  if (harness.status !== "synthetic-controls-ready") {
    actions.push("Fix control_budget / harness-manifest so active controls stay within max_active.");
  }
  actions.push("Keep release-check green (lived + brownfield + routing + P7 canaries).");
  return actions;
}

function writeM7Scorecard(root, options = {}) {
  const scorecard = buildM7Scorecard(root, options);
  const relative = options.outputRelative || path.join(".claude", "specs", "evidence", "m7-scorecard.json");
  const file = path.join(path.resolve(root), relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
  return { scorecard, file };
}

module.exports = {
  buildM7Scorecard,
  writeM7Scorecard,
};
