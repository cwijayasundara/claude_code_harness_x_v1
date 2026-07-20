const fs = require("node:fs");
const path = require("node:path");

function validateReleaseLayout(root) {
  const errors = [];
  if (path.basename(root) === ".claude") {
    const repositoryRoot = path.dirname(root);
    const allowedRootEntries = new Set([".git", ".claude", ".vscode", "CLAUDE.md", "README.md", "design.html"]);
    for (const entry of fs.readdirSync(repositoryRoot)) if (!allowedRootEntries.has(entry)) errors.push(`Unexpected repository-root entry: ${entry}`);
  }
  const pluginPath = path.join(root, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(pluginPath)) return [`Missing plugin manifest: ${pluginPath}`];
  let plugin;
  try {
    plugin = JSON.parse(fs.readFileSync(pluginPath, "utf8"));
  } catch (error) {
    return [`Unable to parse plugin manifest: ${error.message}`];
  }
  if (typeof plugin.name !== "string" || !plugin.name) errors.push("Plugin manifest requires a name.");
  if (typeof plugin.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plugin.version)) {
    errors.push("Plugin manifest version must be semantic-version formatted.");
  }
  if (Object.hasOwn(plugin, "skills") || Object.hasOwn(plugin, "agents")) {
    errors.push("Plugin skills and agents must use native root directories, not manifest path registrations.");
  }
  for (const required of [
    "skills/harness/SKILL.md",
    "skills/harness-context-selection/SKILL.md",
    "skills/harness-engineering-core/SKILL.md",
    "skills/harness-operations/SKILL.md",
    "skills/harness-modularity-review/SKILL.md",
    "skills/harness-retro/SKILL.md",
    "skills/harness-status/SKILL.md",
    "agents/harness-generator.md",
    "agents/harness-evaluator.md",
    "agents/harness-evaluator-fast.md",
    "hooks/pre-tool-safety.js",
    "hooks/hooks.json",
    "hooks/sensor-lifecycle.js",
    "scripts/harness-init.js",
    "scripts/harness-validate.js",
    "scripts/harness-sensors.js",
    "scripts/harness-regression.js",
    "scripts/harness-modularity.js",
    "scripts/harness-specs.js",
    "scripts/harness-brownfield.js",
    "scripts/harness-ratchet.js",
    "scripts/harness-verify.js",
    "scripts/harness-profile-context.js",
    "scripts/harness-guides.js",
    "scripts/harness-routing.js",
    "scripts/harness-sensor-watch.js",
    "scripts/harness-sensor-canary.js",
    "scripts/harness-operations-evidence.js",
    "scripts/harness-git-hooks.js",
    "scripts/harness-git-gate.js",
    "scripts/harness-ci.js",
    "scripts/harness-p7-canary.js",
    "scripts/harness-lived-canary.js",
    "scripts/harness-multi-story-canary.js",
    "scripts/harness-brownfield-canary.js",
    "scripts/harness-routing-canary.js",
    "scripts/harness-m7-scorecard.js",
    "scripts/harness-subtract.js",
    "scripts/harness-pilot.js",
    "scripts/harness-improvement.js",
    "scripts/harness-upgrade.js",
    "scripts/harness-waiver.js",
    "scripts/harness-doctor.js",
    "templates/project/.claude/harness-manifest.json",
    "templates/project/HARNESS_USER_GUIDE.md",
    "templates/project/.claude/guides.json",
    "templates/project/.claude/harness.yaml",
    "templates/project/.claude/sensor-waivers.json",
    "templates/project/.claude/specs/index.json",
    "templates/project/.claude/specs/brownfield/baseline.example.json",
    "templates/project/.claude/specs/plans/story-contract.example.json",
    "templates/project/.claude/specs/architecture/architecture.example.json",
    "lib/design-evolution.js",
    "lib/proposal-sessions.js",
    "lib/improvement-ratchet.js",
    "lib/maintainability-sensors.js",
    "lib/dependency-sensors.js",
    "lib/regression-sensors.js",
    "lib/modularity-review.js",
    "lib/sensor-operations.js",
    "lib/sensor-quarantine.js",
    "lib/evidence-attestation.js",
    "lib/production-feedback.js",
    "lib/harness-upgrade.js",
    "lib/feedforward-guides.js",
    "templates/project/.claude/project/maintainability.json",
    "templates/project/.claude/project/dependency-sensors.json",
    "templates/project/.claude/project/regression-sensors.json",
    "templates/project/.claude/project/modularity-review.json",
    "templates/project/.claude/project/modularity-decisions.json",
    "templates/project/.claude/project/sensor-operations.json",
    "templates/project/.claude/sensor-quarantines.json",
    "templates/project/.claude/specs/evidence/production-feedback.example.json",
    "templates/project/.claude/specs/reviews/modularity-review.example.json",
    "templates/project/.claude/verification.json",
    "templates/project/.claude/routing.json",
    "templates/project/.claude/pilot-policy.json",
    "templates/project/.claude/specs/evidence/pilot-record.example.json",
    "templates/project/.claude/specs/improvements/improvement-candidate.example.json",
    "templates/project/.claude/specs/improvements/experiment.example.json",
    "templates/project/.claude/specs/evidence/context-manifest.example.json",
    "templates/project/.claude/profiles/python/manifest.json",
    "templates/project/.claude/profiles/typescript/manifest.json",
    "templates/project/.claude/profiles/langgraph/manifest.json",
    "release/p7-scorecard.json",
    "release/m7-scorecard.example.json",
    "docs/v1-improvement-plan.md",
    "docs/harness-operating-model.md",
    "docs/production-sensor-system.md",
    "docs/implementation.md",
    "docs/release.md",
  ]) {
    if (!fs.existsSync(path.join(root, required))) errors.push(`Missing release asset: ${required}`);
  }
  for (const removed of [
    "lib/artifacts.js", "lib/repair-attempt.js", "lib/requirement-brief.js", "lib/sprint-amendment.js",
    "scripts/harness-artifact.js", "scripts/harness-intake.js", "scripts/harness-discover.js",
    "scripts/harness-review-plan.js", "scripts/harness-repair-attempt.js", "scripts/harness-self-canary.js",
    "templates/project/.claude/artifacts",
  ]) if (fs.existsSync(path.join(root, removed))) errors.push(`Superseded release asset still exists: ${removed}`);
  const scorecardPath = path.join(root, "release", "p7-scorecard.json");
  if (fs.existsSync(scorecardPath)) {
    try {
      const scorecard = JSON.parse(fs.readFileSync(scorecardPath, "utf8"));
      if (scorecard.status !== "pass" || scorecard.measurement_type !== "synthetic-deterministic-release-canary" || !Array.isArray(scorecard.real_pilot_measures_required) || scorecard.real_pilot_measures_required.length === 0) {
        errors.push("P7 scorecard must pass and state its synthetic measurement limits and required real-pilot measures.");
      }
    } catch (error) {
      errors.push(`Unable to parse P7 scorecard: ${error.message}`);
    }
  }
  return errors;
}

module.exports = { validateReleaseLayout };
