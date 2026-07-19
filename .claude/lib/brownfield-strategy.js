/**
 * Build a B2 change-strategy proposal from a code map.
 * Prefers reuse of existing symbols/modules over new abstractions.
 */

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function proposeChangeStrategy({
  goal,
  focus = [],
  codeMap,
  preferredReuse = [],
  characterizationTests = [],
}) {
  if (!goal || !String(goal).trim()) throw new Error("goal is required for a change strategy.");
  if (!codeMap || typeof codeMap !== "object") throw new Error("codeMap is required.");

  const focusTerms = focus.map((term) => String(term).toLowerCase());
  const impact = Array.isArray(codeMap.maps?.impact) ? codeMap.maps.impact : [];
  const duplicates = Array.isArray(codeMap.maps?.duplicate_candidates)
    ? codeMap.maps.duplicate_candidates
    : [];
  const canonical = Array.isArray(codeMap.maps?.canonical_reuse_candidates)
    ? codeMap.maps.canonical_reuse_candidates
    : [];
  const tests = Array.isArray(codeMap.maps?.tests) ? codeMap.maps.tests : [];
  const hotspots = Array.isArray(codeMap.maps?.hotspots) ? codeMap.maps.hotspots : [];

  const impactPaths = unique(impact.map((item) => item.path).filter(Boolean));
  const focusImpact = impact.filter((item) =>
    focusTerms.some((term) =>
      `${item.id || ""} ${item.path || ""} ${item.kind || ""}`.toLowerCase().includes(term)
    )
  );

  const reuseFromPreferred = preferredReuse.map((item) => ({
    path: item.path,
    symbol: item.symbol || null,
    reason: item.reason || "Human or canary nominated reuse target.",
    status: "required-reuse",
  }));

  const reuseFromCanonical = canonical
    .filter((item) => impactPaths.includes(item.path) || focusTerms.some((term) => item.path.toLowerCase().includes(term)))
    .slice(0, 8)
    .map((item) => ({
      path: item.path,
      role: item.role,
      reason: "Canonical role candidate from code map; verify source before reuse.",
      status: item.status || "candidate-needs-source-verification",
    }));

  const duplicationRisks = duplicates.map((item) => ({
    symbol: item.symbol,
    paths: item.paths,
    risk: "Possible duplicated concept — prefer one implementation after behavioral verification.",
    status: item.status || "candidate-needs-behavioral-verification",
  }));

  const smallestSeam = preferredReuse[0]
    ? `${preferredReuse[0].symbol || preferredReuse[0].path}`
    : (focusImpact[0]?.path || focus[0] || impactPaths[0] || "unspecified-seam");

  const characterization = characterizationTests.length
    ? characterizationTests
    : tests
      .filter((testPath) => impactPaths.some((impactPath) => {
        const base = require("node:path").basename(impactPath, require("node:path").extname(impactPath));
        return testPath.toLowerCase().includes(base.toLowerCase());
      }))
      .slice(0, 10)
      .map((testPath) => ({ path: testPath, purpose: "Pin current behaviour before edit." }));

  const regressionScope = unique([
    ...impactPaths,
    ...tests.filter((testPath) => impactPaths.some((p) => testPath.includes(require("node:path").basename(p, require("node:path").extname(p))))),
  ]);

  const reuse = [...reuseFromPreferred, ...reuseFromCanonical];
  const hasDuplicationPressure = duplicationRisks.length > 0;
  let secondSliceDecision = "first-slice";
  if (reuseFromPreferred.length > 0) secondSliceDecision = "reuse-existing";
  else if (hasDuplicationPressure && reuse.length > 0) secondSliceDecision = "extract-shared";
  else if (hasDuplicationPressure) secondSliceDecision = "justified-divergence";

  return {
    artifact_type: "change-strategy",
    goal: String(goal).trim(),
    smallest_behavioral_seam: smallestSeam,
    second_slice_decision: secondSliceDecision,
    divergence_justification: secondSliceDecision === "justified-divergence"
      ? "Duplication candidates exist but no verified reuse target yet — confirm divergence or name a reuse path before approval."
      : null,
    reuse,
    duplication_risks: duplicationRisks,
    compatibility_contracts: [
      "Do not change public behaviour outside the approved story acceptance criteria.",
      "Prefer calling existing helpers over copying logic.",
      "Second similar capability reuses seams or opens a design amendment; do not clone vertical stacks.",
    ],
    characterization_tests: characterization,
    regression_scope: regressionScope,
    migration_and_rollback: ["No schema migration; revert the feature branch if behaviour regresses."],
    hotspot_notes: hotspots.slice(0, 5).map((item) => ({
      path: item.path,
      graph_degree: item.graph_degree,
      note: "High coupling — prefer narrow edits.",
    })),
    adapter_used: codeMap.adapter || { provider: "none" },
    cautions: [
      ...(codeMap.cautions || []),
      "Generalize only when at least two real call sites share stable behaviour.",
      "Open cited source before implementing; graph edges are navigation aids only.",
    ],
  };
}

function assertStrategyPrefersReuse(strategy, requiredPaths = []) {
  const { assertChangeStrategySecondSlice } = require("./design-evolution");
  const errors = [];
  if (!strategy || strategy.artifact_type !== "change-strategy") {
    errors.push("Strategy must declare artifact_type change-strategy.");
  }
  if (!Array.isArray(strategy.reuse) || strategy.reuse.length === 0) {
    errors.push("Strategy must list at least one reuse target.");
  }
  for (const required of requiredPaths) {
    if (!strategy.reuse.some((item) => item.path === required || item.symbol === required)) {
      errors.push(`Strategy must reuse '${required}'.`);
    }
  }
  if (strategy.generalize_without_second_use === true) {
    errors.push("Strategy must not enable speculative generalization.");
  }
  errors.push(...assertChangeStrategySecondSlice(strategy));
  return errors;
}

module.exports = {
  assertStrategyPrefersReuse,
  proposeChangeStrategy,
};
