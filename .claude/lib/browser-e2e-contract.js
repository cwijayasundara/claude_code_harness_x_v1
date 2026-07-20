const { loadVerificationPlan, validateVerificationPlan } = require("./verification-plan");

const FEATURE_SURFACES = new Set(["ui", "api", "cli", "event", "worker", "internal"]);

function validateFeatureSurfaces(contract, label = "Story contract") {
  const errors = [];
  if (!Array.isArray(contract?.feature_surfaces) || contract.feature_surfaces.length === 0) {
    return [`${label} feature_surfaces must be a non-empty array.`];
  }
  const seen = new Set();
  for (const surface of contract.feature_surfaces) {
    if (!FEATURE_SURFACES.has(surface)) errors.push(`${label} feature_surfaces contains unknown surface '${surface}'.`);
    if (seen.has(surface)) errors.push(`${label} feature_surfaces duplicates '${surface}'.`);
    seen.add(surface);
  }
  return errors;
}

function validateBrowserE2E(root, records, loadBody) {
  const errors = [];
  let verification;
  try {
    verification = loadVerificationPlan(root).plan;
    errors.push(...validateVerificationPlan(verification));
  } catch (error) {
    return { errors: [error.message], required_story_ids: [], check_id: null };
  }
  const trace = records.find((item) => item.package === "traceability" && item.status !== "superseded");
  const traceLinks = trace ? loadBody(trace)?.content?.links || [] : [];
  const contracts = records.filter((item) => item.package === "plans" && item.status !== "superseded")
    .map((record) => ({ record, content: loadBody(record)?.content }))
    .filter((item) => item.content?.story_id);
  const required = [];
  for (const { record, content } of contracts) {
    errors.push(...validateFeatureSurfaces(content, `Story contract '${record.id}'`));
    if (!content.feature_surfaces?.includes("ui")) continue;
    required.push(content.story_id);
    if (content.browser_e2e_required !== true) errors.push(`UI story '${content.story_id}' must set browser_e2e_required=true.`);
    const tool = content.browser_e2e_tool;
    if (typeof tool !== "string" || !tool.trim()) errors.push(`UI story '${content.story_id}' must name browser_e2e_tool.`);
    if (tool && tool !== "playwright") {
      const equivalent = content.browser_e2e_equivalent;
      if (!equivalent || typeof equivalent.rationale !== "string" || !equivalent.rationale.trim()) {
        errors.push(`UI story '${content.story_id}' using '${tool}' requires browser_e2e_equivalent.rationale.`);
      }
    }
  }
  if (!required.length) return { errors, required_story_ids: [], check_id: null };
  const browserChecks = verification.checks.filter((check) => check.cadence === "pre-pr" && check.kind === "browser-e2e");
  if (browserChecks.length !== 1) errors.push("UI delivery requires exactly one pre-pr browser-e2e check.");
  const browserCheck = browserChecks[0];
  if (browserCheck && browserCheck.configured !== true) errors.push(`Browser E2E check '${browserCheck.id}' must be configured.`);
  for (const storyId of required) {
    if (!traceLinks.some((link) => link.story_id === storyId && link.level === "browser-e2e" && link.disposition === "planned-automated" && link.verification_check_id === browserCheck?.id)) {
      errors.push(`UI story '${storyId}' requires a browser-e2e trace link to '${browserCheck?.id || "the configured browser check"}'.`);
    }
  }
  return { errors, required_story_ids: required, check_id: browserCheck?.id || null };
}

module.exports = { FEATURE_SURFACES, validateBrowserE2E, validateFeatureSurfaces };
