const ENTRY_KINDS = Object.freeze([
  "idea", "prd", "brd", "feature", "epic", "story", "issue", "design", "tests", "diff",
]);
const TARGETS = Object.freeze(["brief", "backlog", "design", "tests", "implementation", "verified", "draft-pr"]);
const MODES = Object.freeze(["guided", "checkpoint", "unattended"]);
const POSTURES = Object.freeze(["greenfield", "brownfield"]);
const LANES = Object.freeze([
  "documentation", "tiny-change", "bounded-change", "refactor", "feature", "initiative", "discovery", "re-entry",
]);

function assertChoice(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label} must be one of: ${choices.join(", ")}.`);
}

function inferEntryKind(text) {
  const value = String(text || "").toLowerCase();
  if (/\b(diff|existing changes|uncommitted|vibe)\b/.test(value)) return ["diff", "Request describes existing changes."];
  if (/\b(issue|bug|defect)\b|#[0-9]+/.test(value)) return ["issue", "Request identifies an issue or defect."];
  if (/\b(user story|story|as an? .+ i want)\b/.test(value) || /\bus[-_ -]?[0-9]+\b/i.test(value)) return ["story", "Request identifies a user story."];
  if (/\b(test cases?|test plan|given.+when.+then)\b/.test(value)) return ["tests", "Request is centred on test artifacts."];
  if (/\b(design|architecture|adr)\b/.test(value)) return ["design", "Request is centred on design artifacts."];
  if (/\bbrd\b|business requirements?/.test(value)) return ["brd", "Request identifies a BRD."];
  if (/\bprd\b|product requirements?/.test(value)) return ["prd", "Request identifies a PRD."];
  if (/\bepic\b/.test(value)) return ["epic", "Request identifies an epic."];
  if (/\bfeature\b|\badd\b|\bimplement\b|\bdeliver\b/.test(value)) return ["feature", "Request describes a product feature."];
  return ["idea", "No stronger durable source-type signal was found."];
}

function inferTarget(text, entryKind) {
  const value = String(text || "").toLowerCase();
  if (/\b(do not|don't|without) (write |change |implement )?(code|implementation)\b/.test(value)) {
    if (/\btests?\b/.test(value)) return ["tests", "Request explicitly stops before code after tests."];
    if (/\bdesign|architecture\b/.test(value)) return ["design", "Request explicitly stops before code after design."];
    return ["backlog", "Request explicitly excludes implementation."];
  }
  if (/\bthrough (brief|backlog|design|tests?|implementation|verified|draft[- ]?pr)\b/.test(value)) {
    const match = value.match(/\bthrough (brief|backlog|design|tests?|implementation|verified|draft[- ]?pr)\b/)[1];
    return [match === "test" ? "tests" : match.replace("draft pr", "draft-pr"), "Request states its stopping point."];
  }
  if (entryKind === "design") return ["design", "A design request defaults to a design deliverable."];
  if (entryKind === "tests") return ["tests", "A test request defaults to a test deliverable."];
  return ["draft-pr", "Delivery requests default to verified draft-PR readiness."];
}

function deriveLane({ entryKind, target, repositoryPosture, scope = "unknown", refactor = false }) {
  if (["brief", "backlog", "design", "tests"].includes(target)) return "documentation";
  if (entryKind === "diff") return "re-entry";
  if (refactor) return "refactor";
  if (entryKind === "issue" || entryKind === "story") return "bounded-change";
  if (entryKind === "prd" || (repositoryPosture === "greenfield" && ["idea", "brd"].includes(entryKind))) return "initiative";
  if (["epic", "feature"].includes(entryKind)) return scope === "tiny" ? "tiny-change" : scope === "single" ? "bounded-change" : "feature";
  return repositoryPosture === "greenfield" ? "initiative" : "feature";
}

function classifyRequest({ request = "", entryKind, target, interactionMode = "checkpoint", repositoryPosture = "brownfield", scope = "unknown", refactor = false } = {}) {
  assertChoice(interactionMode, MODES, "interaction mode");
  assertChoice(repositoryPosture, POSTURES, "repository posture");
  const inferredEntry = entryKind ? [entryKind, "Entry kind was explicitly supplied."] : inferEntryKind(request);
  assertChoice(inferredEntry[0], ENTRY_KINDS, "entry kind");
  const inferredTarget = target ? [target, "Target was explicitly supplied."] : inferTarget(request, inferredEntry[0]);
  assertChoice(inferredTarget[0], TARGETS, "target");
  const lane = deriveLane({ entryKind: inferredEntry[0], target: inferredTarget[0], repositoryPosture, scope, refactor });
  assertChoice(lane, LANES, "delivery lane");
  const ambiguousIdea = inferredEntry[0] === "idea" && !entryKind;
  return {
    entry_kind: inferredEntry[0],
    target: inferredTarget[0],
    interaction_mode: interactionMode,
    repository_posture: repositoryPosture,
    delivery_lane: lane,
    classification_confidence: ambiguousIdea ? "medium" : "high",
    classification_rationale: [inferredEntry[1], inferredTarget[1], `Repository posture is ${repositoryPosture}.`],
    material_questions: ambiguousIdea ? ["Confirm whether this is a new idea or an existing-system feature."] : [],
  };
}

function validateClassification(value) {
  const errors = [];
  for (const [field, choices] of [["entry_kind", ENTRY_KINDS], ["target", TARGETS], ["interaction_mode", MODES], ["repository_posture", POSTURES], ["delivery_lane", LANES]]) {
    if (!choices.includes(value?.[field])) errors.push(`${field} must be one of: ${choices.join(", ")}.`);
  }
  if (!Array.isArray(value?.classification_rationale) || value.classification_rationale.length === 0) errors.push("classification_rationale must be a non-empty array.");
  if (!Array.isArray(value?.material_questions)) errors.push("material_questions must be an array.");
  return errors;
}

module.exports = { ENTRY_KINDS, LANES, MODES, POSTURES, TARGETS, classifyRequest, deriveLane, validateClassification };
