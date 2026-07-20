const REASONS_SECTIONS = Object.freeze([
  "requirements",
  "entities",
  "approach",
  "structure",
  "operations",
  "norms",
  "safeguards",
]);

const ANALYSIS_ARRAYS = Object.freeze([
  "domain_concepts",
  "strategic_direction",
  "risks",
  "requirement_gaps",
]);

function populated(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" && value.trim().length > 0;
}

function validateAnalysis(content) {
  const errors = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return ["analysis content must be an object."];
  }
  for (const field of ANALYSIS_ARRAYS) {
    if (!Array.isArray(content[field]) || content[field].length === 0) {
      errors.push(`analysis.${field} must be a non-empty array.`);
    }
  }
  return errors;
}

function validateReasonsCanvas(content) {
  const errors = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return ["reasons-canvas content must be an object."];
  }
  for (const section of REASONS_SECTIONS) {
    if (!populated(content[section])) errors.push(`reasons-canvas.${section} must be populated.`);
  }
  if (!content.sync || typeof content.sync !== "object" || Array.isArray(content.sync)) {
    errors.push("reasons-canvas.sync must be an object.");
  } else {
    if (content.sync.status !== "aligned") errors.push("reasons-canvas.sync.status must be 'aligned'.");
    if (!Array.isArray(content.sync.amendment_ids)) errors.push("reasons-canvas.sync.amendment_ids must be an array.");
  }
  return errors;
}

function validateDirectBrd(content) {
  if (content?.intake_path !== "brd-direct") return [];
  const errors = [];
  if (typeof content.direct_brd_rationale !== "string" || !content.direct_brd_rationale.trim()) {
    errors.push("brd-direct requires direct_brd_rationale.");
  }
  if (!Array.isArray(content.sufficiency_checks) || content.sufficiency_checks.length === 0) {
    errors.push("brd-direct requires non-empty sufficiency_checks.");
  }
  return errors;
}

function validateGoverningIntent(content) {
  const errors = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) return ["intents content must be an object."];
  if (content.artifact_type !== "governing-intent") errors.push("intents.artifact_type must be 'governing-intent'.");
  if (typeof content.outcome !== "string" || !content.outcome.trim()) errors.push("intents.outcome is required.");
  for (const field of ["actors", "scope", "exclusions", "acceptance_signals"]) {
    if (!Array.isArray(content[field])) errors.push(`intents.${field} must be an array.`);
  }
  return errors;
}

function validateSpddArtifact(artifact) {
  if (artifact.package === "analysis") return validateAnalysis(artifact.content);
  if (artifact.package === "reasons-canvas") return validateReasonsCanvas(artifact.content);
  if (artifact.package === "brd") return validateDirectBrd(artifact.content);
  if (artifact.package === "intents") return validateGoverningIntent(artifact.content);
  if (artifact.package === "prompt-amendments") {
    const content = artifact.content;
    const errors = [];
    if (!content || typeof content !== "object" || Array.isArray(content)) return ["prompt-amendments content must be an object."];
    if (typeof content.reason !== "string" || !content.reason.trim()) errors.push("prompt-amendments.reason is required.");
    for (const field of ["affected_gates", "supersedes_artifact_ids", "replacement_artifact_ids"]) {
      if (!Array.isArray(content[field]) || content[field].length === 0) errors.push(`prompt-amendments.${field} must be a non-empty array.`);
    }
    if (Array.isArray(content.affected_gates) && content.affected_gates.some((gate) => !["G0", "G1", "G2", "G3", "G4"].includes(gate))) {
      errors.push("prompt-amendments.affected_gates may contain only G0..G4.");
    }
    if (Array.isArray(content.affected_gates) && !content.affected_gates.includes("G0")) {
      errors.push("prompt amendments must reopen G0.");
    }
    return errors;
  }
  return [];
}

function g0Requirements(sourceKind) {
  if (sourceKind === "prd") return ["source", "prd", "analysis", "reasons-canvas"];
  if (sourceKind === "brd") return ["source", "brd"];
  return ["source", "intents"];
}

function validateG0Route(records, loadBody) {
  const errors = [];
  const sourceKind = records.find((item) => item.package === "source")?.kind;
  if (sourceKind === "prd") {
    const analysis = records.find((item) => item.package === "analysis" && item.status !== "superseded");
    const canvas = records.find((item) => item.package === "reasons-canvas" && item.status !== "superseded");
    if (analysis && canvas && !(canvas.derived_from || []).includes(analysis.id)) {
      errors.push(`REASONS Canvas '${canvas.id}' must derive from analysis '${analysis.id}'.`);
    }
  }
  if (sourceKind === "brd") {
    const brd = records.find((item) => item.package === "brd" && item.status !== "superseded");
    if (brd) {
      const content = loadBody(brd)?.content;
      if (content?.intake_path !== "brd-direct") {
        errors.push("Direct BRD intake requires content.intake_path='brd-direct' for the human G0 decision.");
      } else {
        errors.push(...validateDirectBrd(content));
      }
    }
  }
  return errors;
}

module.exports = {
  ANALYSIS_ARRAYS,
  REASONS_SECTIONS,
  g0Requirements,
  validateAnalysis,
  validateDirectBrd,
  validateGoverningIntent,
  validateG0Route,
  validateReasonsCanvas,
  validateSpddArtifact,
};
