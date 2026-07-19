/**
 * Stack-agnostic design-evolution rules for co-design gates.
 *
 * Forces Superpowers-style G3 alternatives and second-slice reuse pressure so
 * multi-entity / multi-pipeline products cannot silently clone vertical stacks.
 * Technology choices (LangGraph, workers, plain modules, etc.) stay project-owned.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Three structural shapes every G3 architecture proposal must present. */
const STRUCTURAL_ALTERNATIVE_IDS = Object.freeze([
  "clone-vertical",
  "shared-modules",
  "parameterized-spine",
]);

const STRUCTURAL_ALTERNATIVE_GUIDANCE = Object.freeze({
  "clone-vertical":
    "Independent vertical slices per feature/entity (own modules, own flow copy). Highest short-term speed; highest duplication risk.",
  "shared-modules":
    "Thin feature entrypoints call shared helpers/modules without a single orchestrating spine. Good when flows diverge but helpers do not.",
  "parameterized-spine":
    "One parameterized flow (stages + config/strategy per variant). Prefer when skeletons match and only policies differ. Not tied to any framework.",
});

const SECOND_SLICE_DECISIONS = Object.freeze([
  "first-slice",
  "reuse-existing",
  "extract-shared",
  "justified-divergence",
]);

const IMPLEMENTATION_POSTURES = SECOND_SLICE_DECISIONS;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function loadBody(root, record) {
  if (!record?.path) return null;
  const file = path.join(path.resolve(root), record.path);
  if (!fs.existsSync(file)) return null;
  if (record.package === "source") return null;
  return readJsonSafe(file);
}

/**
 * Validate G3 architecture content: three structural alternatives + selection
 * + evolutionary second-slice policy.
 */
function assertArchitectureAlternatives(content) {
  const errors = [];
  if (!content || typeof content !== "object") {
    return ["Architecture content must be an object."];
  }

  const alternatives = content.structural_alternatives;
  if (!Array.isArray(alternatives) || alternatives.length < 3) {
    errors.push(
      "Architecture must include structural_alternatives with at least the three required shapes: "
      + `${STRUCTURAL_ALTERNATIVE_IDS.join(", ")}.`
    );
    return errors;
  }

  const byId = new Map();
  for (const [index, alt] of alternatives.entries()) {
    if (!alt || typeof alt !== "object") {
      errors.push(`structural_alternatives[${index}] must be an object.`);
      continue;
    }
    if (!isNonEmptyString(alt.id)) {
      errors.push(`structural_alternatives[${index}].id is required.`);
      continue;
    }
    if (byId.has(alt.id)) errors.push(`Duplicate structural alternative id '${alt.id}'.`);
    byId.set(alt.id, alt);
    if (!isNonEmptyString(alt.summary)) {
      errors.push(`structural_alternatives '${alt.id}' needs a non-empty summary.`);
    }
    if (!isNonEmptyString(alt.duplication_risk)
      || !["high", "medium", "low", "med"].includes(String(alt.duplication_risk).toLowerCase())) {
      errors.push(`structural_alternatives '${alt.id}' needs duplication_risk of high|medium|low.`);
    }
  }

  for (const requiredId of STRUCTURAL_ALTERNATIVE_IDS) {
    if (!byId.has(requiredId)) {
      errors.push(
        `Missing required structural alternative '${requiredId}': ${STRUCTURAL_ALTERNATIVE_GUIDANCE[requiredId]}`
      );
    }
  }

  if (!isNonEmptyString(content.selected_alternative_id)) {
    errors.push("Architecture must set selected_alternative_id to the human-chosen shape.");
  } else if (byId.size > 0 && !byId.has(content.selected_alternative_id)) {
    errors.push(`selected_alternative_id '${content.selected_alternative_id}' is not among structural_alternatives.`);
  }

  if (!isNonEmptyString(content.selection_rationale)) {
    errors.push("Architecture must include selection_rationale explaining why the chosen shape beats the other two.");
  }

  const policy = content.second_slice_reuse_policy;
  if (!policy || typeof policy !== "object") {
    errors.push(
      "Architecture must include second_slice_reuse_policy "
      + "(when the next similar capability is added: reuse seams, extract shared, or justify divergence)."
    );
  } else {
    if (!isNonEmptyString(policy.when)) {
      errors.push("second_slice_reuse_policy.when is required (e.g. second-similar-capability).");
    }
    if (!isNonEmptyString(policy.required_action)) {
      errors.push(
        "second_slice_reuse_policy.required_action is required "
        + "(e.g. reuse-existing-seams-or-design-amendment)."
      );
    }
    const minUses = policy.generalize_min_uses;
    if (minUses !== undefined && (typeof minUses !== "number" || minUses < 2)) {
      errors.push("second_slice_reuse_policy.generalize_min_uses must be a number >= 2 when set.");
    }
  }

  if (!Array.isArray(content.evolutionary_rules) || content.evolutionary_rules.length === 0) {
    errors.push(
      "Architecture must list evolutionary_rules "
      + "(e.g. second similar feature reuses seams or opens a design amendment)."
    );
  }

  return errors;
}

/**
 * B2 change-strategy: explicit second-slice decision + reuse or justification.
 */
function assertChangeStrategySecondSlice(content) {
  const errors = [];
  if (!content || typeof content !== "object") {
    return ["Change strategy content must be an object."];
  }
  if (content.artifact_type && content.artifact_type !== "change-strategy") {
    return errors;
  }

  const decision = content.second_slice_decision;
  if (!isNonEmptyString(decision)) {
    errors.push(
      "Change strategy must set second_slice_decision to one of: "
      + `${SECOND_SLICE_DECISIONS.join(", ")}.`
    );
    return errors;
  }
  if (!SECOND_SLICE_DECISIONS.includes(decision)) {
    errors.push(`Unknown second_slice_decision '${decision}'.`);
    return errors;
  }

  const reuse = Array.isArray(content.reuse) ? content.reuse : [];
  if (decision === "reuse-existing" || decision === "extract-shared") {
    if (reuse.length === 0) {
      errors.push(`second_slice_decision '${decision}' requires at least one reuse target.`);
    }
  }
  if (decision === "justified-divergence") {
    if (!isNonEmptyString(content.divergence_justification)) {
      errors.push("justified-divergence requires divergence_justification (why a parallel implementation is warranted).");
    }
  }
  if (content.generalize_without_second_use === true) {
    errors.push("Strategy must not set generalize_without_second_use; generalize only with ≥2 real uses.");
  }

  return errors;
}

/**
 * G4 story contract: implementation posture and second-slice reuse fields.
 * @param {object} content contract content
 * @param {{ siblingStoryCount?: number }} [context]
 */
function assertStoryContractEvolution(content, context = {}) {
  const errors = [];
  if (!content || typeof content !== "object") {
    return ["Story contract content must be an object."];
  }

  const posture = content.implementation_posture;
  if (!isNonEmptyString(posture)) {
    errors.push(
      "Story contract must set implementation_posture to one of: "
      + `${IMPLEMENTATION_POSTURES.join(", ")}.`
    );
    return errors;
  }
  if (!IMPLEMENTATION_POSTURES.includes(posture)) {
    errors.push(`Unknown implementation_posture '${posture}'.`);
    return errors;
  }

  const deps = Array.isArray(content.dependency_story_ids) ? content.dependency_story_ids : [];
  const siblingStoryCount = Number(context.siblingStoryCount || 0);
  const reuseTargets = Array.isArray(content.reuse_targets) ? content.reuse_targets : [];

  if (deps.length > 0 && posture === "first-slice") {
    errors.push(
      "Stories with dependency_story_ids cannot use implementation_posture 'first-slice'; "
      + "use reuse-existing, extract-shared, or justified-divergence."
    );
  }

  if (siblingStoryCount >= 2 && posture === "first-slice" && deps.length === 0) {
    const decisions = Array.isArray(content.human_decisions) ? content.human_decisions : [];
    const acceptedIndependent = decisions.some((item) => {
      const text = typeof item === "string" ? item : item?.id || item?.text || "";
      return /independent-first-slice|accepted-as-independent/i.test(String(text));
    });
    if (!acceptedIndependent) {
      errors.push(
        "This change has multiple stories; a dependency-free first-slice needs "
        + "human_decisions noting independent-first-slice (or set a non-first posture with reuse)."
      );
    }
  }

  if (posture === "reuse-existing" || posture === "extract-shared") {
    if (reuseTargets.length === 0) {
      errors.push(`implementation_posture '${posture}' requires non-empty reuse_targets.`);
    } else {
      for (const [index, target] of reuseTargets.entries()) {
        if (!target || typeof target !== "object") {
          errors.push(`reuse_targets[${index}] must be an object with path and/or symbol.`);
          continue;
        }
        if (!isNonEmptyString(target.path) && !isNonEmptyString(target.symbol)) {
          errors.push(`reuse_targets[${index}] needs path and/or symbol.`);
        }
      }
    }
  }

  if (posture === "extract-shared") {
    const refs = Array.isArray(content.approved_design_refs) ? content.approved_design_refs : [];
    if (refs.length === 0) {
      errors.push("extract-shared requires approved_design_refs pointing at the design amendment or architecture decision.");
    }
  }

  if (posture === "justified-divergence") {
    if (!isNonEmptyString(content.divergence_justification)) {
      errors.push("justified-divergence requires divergence_justification.");
    }
  }

  return errors;
}

function contentFromBody(body) {
  if (!body || typeof body !== "object") return null;
  return body.content !== undefined ? body.content : body;
}

/**
 * Gate-level checks used by proposalPack and approve.
 */
function assertGateDesignEvolution(root, changeId, gate) {
  const indexPath = path.join(path.resolve(root), ".claude", "specs", "index.json");
  if (!fs.existsSync(indexPath)) return [];
  const index = readJsonSafe(indexPath);
  if (!index?.artifacts) return [];

  const changeArtifacts = index.artifacts.filter(
    (item) => item.change_id === changeId && item.status !== "superseded"
  );
  const errors = [];

  if (gate === "G3") {
    const architectureRecords = changeArtifacts.filter((item) => item.package === "architecture");
    if (architectureRecords.length === 0) {
      errors.push("G3 requires an architecture artifact with structural_alternatives.");
    }
    for (const record of architectureRecords) {
      const body = loadBody(root, record);
      const content = contentFromBody(body);
      for (const error of assertArchitectureAlternatives(content)) {
        errors.push(`[${record.id}] ${error}`);
      }
    }
  }

  if (gate === "B2") {
    const strategies = changeArtifacts.filter((item) => {
      if (item.package !== "brownfield") return false;
      const body = loadBody(root, item);
      const content = contentFromBody(body);
      const type = item.artifact_type || content?.artifact_type;
      return type === "change-strategy";
    });
    for (const record of strategies) {
      const body = loadBody(root, record);
      const content = contentFromBody(body);
      for (const error of assertChangeStrategySecondSlice(content)) {
        errors.push(`[${record.id}] ${error}`);
      }
    }

    const amendments = changeArtifacts.filter((item) => item.package === "amendments");
    for (const record of amendments) {
      const body = loadBody(root, record);
      const content = contentFromBody(body);
      if (!content) continue;
      if (Array.isArray(content.alternatives) && content.alternatives.length === 0
        && !isNonEmptyString(content.decision) && !isNonEmptyString(content.proposed_delta)) {
        errors.push(`[${record.id}] Design amendment needs decision/proposed_delta or non-empty alternatives.`);
      }
    }
  }

  if (gate === "G4") {
    const storyCount = changeArtifacts.filter((item) => item.package === "stories").length;
    const plans = changeArtifacts.filter((item) => item.package === "plans");
    for (const record of plans) {
      const body = loadBody(root, record);
      const content = contentFromBody(body);
      if (!content || !content.story_id) continue;
      for (const error of assertStoryContractEvolution(content, { siblingStoryCount: storyCount })) {
        errors.push(`[${record.id}] ${error}`);
      }
    }
  }

  return errors;
}

/**
 * Markdown section injected into G3/B2/G4 proposal packs.
 */
function proposalGuidanceMarkdown(gate) {
  if (gate === "G3") {
    return [
      "## Design evolution (required)",
      "",
      "Architecture must present **three structural alternatives** (stack-agnostic):",
      "",
      ...STRUCTURAL_ALTERNATIVE_IDS.map(
        (id) => `- **${id}** — ${STRUCTURAL_ALTERNATIVE_GUIDANCE[id]}`
      ),
      "",
      "Then set `selected_alternative_id`, `selection_rationale`, `second_slice_reuse_policy`, and `evolutionary_rules`.",
      "Do not skip to a framework choice before choosing the structural shape.",
      "",
    ].join("\n");
  }
  if (gate === "B2") {
    return [
      "## Second-slice reuse (required)",
      "",
      "Change strategy must set `second_slice_decision`:",
      "",
      ...SECOND_SLICE_DECISIONS.map((id) => `- \`${id}\``),
      "",
      "`reuse-existing` / `extract-shared` need reuse targets; `justified-divergence` needs a written justification.",
      "Generalize only with ≥2 real uses.",
      "",
    ].join("\n");
  }
  if (gate === "G4") {
    return [
      "## Implementation posture (required)",
      "",
      "Each story contract sets `implementation_posture` (`first-slice` | `reuse-existing` | `extract-shared` | `justified-divergence`).",
      "Dependent stories cannot be `first-slice`. Reuse postures need `reuse_targets`; divergence needs `divergence_justification`.",
      "",
    ].join("\n");
  }
  return "";
}

function listField(value) {
  if (Array.isArray(value) && value.length) {
    return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  }
  return [];
}

/**
 * Superpowers-style G3 design session: narrative first, JSON appendix later.
 * @param {{ design?: object|null, architecture?: object|null, ready?: boolean }} input
 */
function renderG3DesignSession({ design = null, architecture = null, ready = false } = {}) {
  const lines = [
    "## G3 design session (human decision)",
    "",
    "This gate freezes **structural shape** and **how the next similar capability grows**.",
    "Technology (modules, workers, queues, graph runtimes) is chosen *after* the shape — not instead of it.",
    "",
  ];

  if (!architecture || typeof architecture !== "object") {
    lines.push(
      "### Status",
      "",
      "_No architecture content yet. Register design + architecture drafts with the three required alternatives before approval._",
      "",
      proposalGuidanceMarkdown("G3").trimEnd(),
      "",
    );
    return `${lines.join("\n")}\n`;
  }

  const validation = assertArchitectureAlternatives(architecture);
  const alternatives = Array.isArray(architecture.structural_alternatives)
    ? architecture.structural_alternatives
    : [];
  const selectedId = architecture.selected_alternative_id || null;
  const byId = new Map(alternatives.filter((item) => item?.id).map((item) => [item.id, item]));

  lines.push("### Decision summary", "");
  if (selectedId && isNonEmptyString(architecture.selection_rationale) && validation.length === 0) {
    lines.push(
      `- **Recommended shape:** \`${selectedId}\``,
      `- **Why this beats the others:** ${architecture.selection_rationale.trim()}`,
      `- **Session complete enough to approve:** ${ready ? "yes (if you agree)" : "no — see blocking issues above"}`,
      "",
    );
  } else {
    lines.push(
      "- **Recommended shape:** _incomplete — fix architecture content before approve_",
      validation.length
        ? bulletish(validation.map((error) => `Validation: ${error}`))
        : "- _Missing selection or rationale._",
      "",
    );
  }

  lines.push("### Structural alternatives (compare before approving)", "");
  for (const requiredId of STRUCTURAL_ALTERNATIVE_IDS) {
    const alt = byId.get(requiredId);
    const marker = selectedId === requiredId ? " ← **selected**" : "";
    lines.push(`#### \`${requiredId}\`${marker}`, "");
    lines.push(`_${STRUCTURAL_ALTERNATIVE_GUIDANCE[requiredId]}_`, "");
    if (!alt) {
      lines.push("_Missing from architecture artifact._", "");
      continue;
    }
    if (isNonEmptyString(alt.summary)) lines.push(`- **Summary:** ${alt.summary.trim()}`);
    if (isNonEmptyString(alt.duplication_risk)) {
      lines.push(`- **Duplication risk:** ${String(alt.duplication_risk).toLowerCase()}`);
    }
    const pros = listField(alt.pros);
    const cons = listField(alt.cons);
    if (pros.length) lines.push(`- **Pros:** ${pros.join("; ")}`);
    if (cons.length) lines.push(`- **Cons:** ${cons.join("; ")}`);
    lines.push("");
  }

  // Any extra alternatives beyond the required three
  for (const alt of alternatives) {
    if (!alt?.id || STRUCTURAL_ALTERNATIVE_IDS.includes(alt.id)) continue;
    const marker = selectedId === alt.id ? " ← **selected**" : "";
    lines.push(`#### \`${alt.id}\`${marker} _(project-specific)_`, "");
    if (isNonEmptyString(alt.summary)) lines.push(`- **Summary:** ${alt.summary.trim()}`);
    if (isNonEmptyString(alt.duplication_risk)) {
      lines.push(`- **Duplication risk:** ${String(alt.duplication_risk).toLowerCase()}`);
    }
    lines.push("");
  }

  const policy = architecture.second_slice_reuse_policy;
  lines.push("### Second-slice reuse policy", "");
  if (policy && typeof policy === "object") {
    lines.push(
      `- **When:** ${policy.when || "_unset_"}`,
      `- **Required action:** ${policy.required_action || "_unset_"}`,
      `- **Generalize only after N real uses:** ${policy.generalize_min_uses ?? 2}`,
      "",
    );
  } else {
    lines.push("_Missing `second_slice_reuse_policy`._", "");
  }

  const rules = listField(architecture.evolutionary_rules);
  lines.push("### Evolutionary rules", "");
  lines.push(rules.length ? rules.map((rule) => `- ${rule}`).join("\n") : "_None recorded._", "");

  lines.push("### Design seams & layout", "");
  if (design && typeof design === "object") {
    if (isNonEmptyString(design.seam)) lines.push(`- **Primary seam:** ${design.seam.trim()}`);
    const folders = listField(design.folder_structure);
    if (folders.length) {
      lines.push("- **Folder / module structure:**");
      for (const folder of folders) lines.push(`  - \`${folder}\``);
    }
    if (isNonEmptyString(design.summary)) lines.push(`- **Notes:** ${design.summary.trim()}`);
    if (!isNonEmptyString(design.seam) && !folders.length && !isNonEmptyString(design.summary)) {
      lines.push("_Design artifact present but no seam/folder_structure fields — expand if helpful._");
    }
  } else {
    lines.push("_No design artifact content loaded._");
  }
  lines.push("");

  const budgets = listField(architecture.performance_budgets);
  const boundaries = listField(architecture.boundaries || architecture.dependency_direction);
  if (budgets.length || boundaries.length) {
    lines.push("### Budgets & dependency direction", "");
    if (boundaries.length) {
      lines.push("- **Boundaries / dependency direction:**");
      for (const item of boundaries) lines.push(`  - ${typeof item === "string" ? item : JSON.stringify(item)}`);
    }
    if (budgets.length) {
      lines.push("- **Performance budgets:**");
      for (const item of budgets) lines.push(`  - ${typeof item === "string" ? item : JSON.stringify(item)}`);
    }
    lines.push("");
  }

  lines.push(
    "### Human checklist before approve",
    "",
    "- [ ] I compared all three shapes (not only the recommended one).",
    "- [ ] I accept the **selected** shape for this change (or I will edit the draft and re-propose).",
    "- [ ] The **second-slice** rule matches how we want the next similar capability to land.",
    "- [ ] I am not approving a framework brand in place of a structural decision.",
    "- [ ] Open questions above are resolved or explicitly accepted.",
    "",
    "If you **reject**: change `selected_alternative_id` / rationale / policy in the architecture draft,",
    "re-register, re-run this proposal, then approve.",
    "",
    "### Artifact appendix",
    "",
    "Raw registered JSON follows for audit and re-edit. Prefer the sections above for the decision.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function bulletish(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Collect design + architecture content bodies for G3 narrative rendering.
 */
function extractG3Bodies(bodies) {
  let design = null;
  let architecture = null;
  for (const { record, body } of bodies || []) {
    if (!record || !body || body.kind) continue;
    const content = body.content !== undefined ? body.content : body;
    if (record.package === "design" && content && typeof content === "object") design = content;
    if (record.package === "architecture" && content && typeof content === "object") architecture = content;
  }
  return { design, architecture };
}

module.exports = {
  STRUCTURAL_ALTERNATIVE_IDS,
  STRUCTURAL_ALTERNATIVE_GUIDANCE,
  SECOND_SLICE_DECISIONS,
  IMPLEMENTATION_POSTURES,
  assertArchitectureAlternatives,
  assertChangeStrategySecondSlice,
  assertStoryContractEvolution,
  assertGateDesignEvolution,
  proposalGuidanceMarkdown,
  renderG3DesignSession,
  extractG3Bodies,
};
