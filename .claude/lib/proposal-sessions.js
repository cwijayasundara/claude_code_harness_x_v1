/**
 * Human-readable co-design proposal sessions per gate (Superpowers-style).
 * G3 structural rules live in design-evolution.js; this module narrates all gates.
 */

const {
  renderG3DesignSession,
  extractG3Bodies,
  proposalGuidanceMarkdown,
} = require("./design-evolution");

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function contentOf(body) {
  if (!body || body.kind) return null;
  if (body.content !== undefined) return body.content;
  return body;
}

function packagesFromBodies(bodies) {
  const byPackage = {};
  for (const { record, body } of bodies || []) {
    if (!record) continue;
    const content = contentOf(body);
    byPackage[record.package] = byPackage[record.package] || [];
    byPackage[record.package].push({ record, content, body });
  }
  return byPackage;
}

function listish(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function bullets(items, empty = "_None._") {
  if (!items.length) return empty;
  return items.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`).join("\n");
}

function renderG0Session({ packs, ready }) {
  const lines = [
    "## G0 interpretation session (human decision)",
    "",
    "Confirm the grounded source interpretation before planning stories or design.",
    "",
    `**Ready to approve:** ${ready ? "yes (if you agree)" : "no — see blocking issues"}`,
    "",
  ];

  const sources = packs.source || [];
  const brd = packs.brd || [];
  const prd = packs.prd || [];
  const interpretations = [...brd, ...prd];
  const analyses = packs.analysis || [];
  const canvases = packs["reasons-canvas"] || [];

  lines.push("### Captured sources", "");
  if (!sources.length) lines.push("_No source package records._", "");
  for (const { record } of sources) {
    lines.push(
      `- \`${record.path || record.id}\` (${record.kind || "source"}, sha ${String(record.sha256 || "").slice(0, 12)}…)`,
    );
  }
  lines.push("");

  lines.push("### Normalized interpretation", "");
  if (!interpretations.length) {
    lines.push("_Register a brd or prd package for G0._", "");
  }
  for (const { record, content } of interpretations) {
    lines.push(`#### ${record.id}`, "");
    if (!isObject(content)) {
      lines.push("_No structured content._", "");
      continue;
    }
    if (content.summary) lines.push(`- **Summary:** ${content.summary}`);
    const outcomes = listish(content.outcomes);
    if (outcomes.length) {
      lines.push("- **Outcomes:**");
      for (const item of outcomes) lines.push(`  - ${typeof item === "string" ? item : JSON.stringify(item)}`);
    }
    const inScope = listish(content.in_scope || content.inScope);
    const outScope = listish(content.out_of_scope || content.outOfScope);
    if (inScope.length) {
      lines.push("- **In scope:**");
      for (const item of inScope) lines.push(`  - ${item}`);
    }
    if (outScope.length) {
      lines.push("- **Out of scope:**");
      for (const item of outScope) lines.push(`  - ${item}`);
    }
    if (content.nfr || content.constraints) {
      lines.push(`- **Constraints / NFR:** ${JSON.stringify(content.nfr || content.constraints)}`);
    }
    lines.push("");
  }

  lines.push("### SPDD analysis", "");
  if (!analyses.length) lines.push("_No SPDD analysis registered._", "");
  for (const { record, content } of analyses) {
    lines.push(`#### ${record.id}`, "");
    for (const field of ["domain_concepts", "strategic_direction", "risks", "requirement_gaps"]) {
      const values = listish(content?.[field]);
      lines.push(`- **${field.replaceAll("_", " ")}:** ${values.length ? values.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("; ") : "_missing_"}`);
    }
    lines.push("");
  }

  lines.push("### REASONS Canvas", "");
  if (!canvases.length) lines.push("_No REASONS Canvas registered._", "");
  for (const { record, content } of canvases) {
    lines.push(`#### ${record.id}`, "");
    for (const section of ["requirements", "entities", "approach", "structure", "operations", "norms", "safeguards"]) {
      const value = content?.[section];
      lines.push(`- **${section}:** ${value ? JSON.stringify(value) : "_missing_"}`);
    }
    lines.push(`- **sync:** ${content?.sync ? JSON.stringify(content.sync) : "_missing_"}`, "");
  }

  lines.push(
    "### Human checklist before approve",
    "",
    "- [ ] Source file is the governing BRD/PRD (not a chat summary).",
    "- [ ] Outcomes and scope match intent; contradictions are listed as open questions.",
    "- [ ] Assumptions will not be silently treated as requirements.",
    "- [ ] For PRD intake, the SPDD analysis and all seven REASONS sections preserve business intent.",
    "- [ ] For direct BRD intake, the rationale and sufficiency checks justify bypassing SPDD transformation.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function renderG1Session({ packs, ready, analysis }) {
  const lines = [
    "## G1 stories & dependencies session (human decision)",
    "",
    "Approve the epic/story breakdown and order before test or design work.",
    "",
    `**Ready to approve:** ${ready ? "yes (if you agree)" : "no — see blocking issues"}`,
    "",
  ];

  const epics = packs.epics || [];
  const stories = packs.stories || [];
  const deps = packs.dependencies || [];
  const allocations = packs.allocations || [];

  lines.push("### Epics", "");
  if (!epics.length) lines.push("_No epics registered._", "");
  for (const { record, content } of epics) {
    const title = content?.title || content?.goal || record.id;
    lines.push(`- **${record.id}:** ${title}`);
  }
  lines.push("");

  lines.push("### Stories", "");
  if (!stories.length) lines.push("_No stories registered._", "");
  for (const { record, content } of stories) {
    lines.push(`#### ${record.id}`, "");
    lines.push(`- **Title:** ${content?.title || "_untitled_"}`);
    lines.push(`- **Estimate:** ${content?.size || "_unset_"} / ${content?.story_points ?? "_unset_"} points / confidence ${content?.estimate_confidence || "_unset_"}`);
    const basis = listish(content?.estimate_basis);
    if (basis.length) lines.push(`- **Estimate basis:** ${basis.join("; ")}`);
    const ac = listish(content?.acceptance_criteria || content?.acceptanceCriteria);
    if (ac.length) {
      lines.push("- **Acceptance criteria:**");
      for (const item of ac) lines.push(`  - ${typeof item === "string" ? item : JSON.stringify(item)}`);
    } else {
      lines.push("- **Acceptance criteria:** _none — add before approve if behaviour is implied_");
    }
    lines.push("");
  }

  lines.push("### Dependency order", "");
  for (const { record, content } of deps) {
    const sequence = listish(content?.sequence);
    const dag = listish(content?.dag || content?.edges);
    if (sequence.length) {
      lines.push("- **Sequence:**");
      sequence.forEach((id, index) => lines.push(`  ${index + 1}. \`${id}\``));
    }
    if (dag.length) {
      lines.push("- **DAG / edges:**");
      for (const edge of dag) {
        if (typeof edge === "string") lines.push(`  - ${edge}`);
        else if (edge?.story_id) {
          const depends = listish(edge.depends_on).join(", ") || "_none_";
          lines.push(`  - \`${edge.story_id}\` depends on: ${depends}`);
        } else lines.push(`  - ${JSON.stringify(edge)}`);
      }
    }
    if (!sequence.length && !dag.length) {
      lines.push(`- _${record.id}: no sequence/dag fields_`);
    }
  }
  if (!deps.length) lines.push("_No dependencies artifact._");
  lines.push("");

  lines.push("### Derived plan", "");
  lines.push(`- **Topological order:** ${analysis?.topological_order?.join(" -> ") || "_unavailable_"}`);
  lines.push(`- **Dependency-ready stories:** ${analysis?.dependency_ready_story_ids?.join(", ") || "_none_"}`);
  lines.push(`- **Critical path:** ${analysis?.critical_path?.join(" -> ") || "_unavailable_"} (${analysis?.critical_path_points ?? 0} points)`, "");

  lines.push("### Allocation clusters", "");
  if (!allocations.length) lines.push("_No allocations artifact._", "");
  for (const { content } of allocations) for (const cluster of listish(content?.clusters)) {
    lines.push(`- **${cluster.id || "unnamed"}:** ${(cluster.story_ids || []).join(", ")} · ${cluster.total_points ?? "?"} points · depends on ${(cluster.depends_on_clusters || []).join(", ") || "none"}`);
  }
  lines.push("");

  lines.push(
    "### Human checklist before approve",
    "",
    "- [ ] Stories are vertical slices with observable acceptance, not layer tasks.",
    "- [ ] Dependency order is buildable (no hidden cycles).",
    "- [ ] Similar capabilities are ordered so later stories can reuse earlier seams.",
    "- [ ] Estimates separate effort from priority and state their confidence/basis.",
    "- [ ] Every story appears in exactly one cohesive allocation cluster.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function renderG2Session({ packs, ready }) {
  const lines = [
    "## G2 test strategy session (human decision)",
    "",
    "Approve test plans, cases, and data **before** architecture freeze and code.",
    "",
    `**Ready to approve:** ${ready ? "yes (if you agree)" : "no — see blocking issues"}`,
    "",
  ];

  const plans = packs["test-plans"] || [];
  const cases = packs["test-cases"] || [];
  const data = packs["test-data"] || [];

  lines.push("### Test plans", "");
  if (!plans.length) lines.push("_No test-plans registered._", "");
  for (const { record, content } of plans) {
    lines.push(`#### ${record.id}`, "");
    const levels = listish(content?.levels);
    if (levels.length) lines.push(`- **Levels:** ${levels.join(", ")}`);
    if (content?.hermetic !== undefined) lines.push(`- **Hermetic:** ${content.hermetic}`);
    if (content?.doubles) lines.push(`- **Boundary doubles:** ${typeof content.doubles === "string" ? content.doubles : JSON.stringify(content.doubles)}`);
    if (content?.performance_budgets) lines.push(`- **Perf budgets:** ${JSON.stringify(content.performance_budgets)}`);
    lines.push("");
  }

  lines.push("### Test cases", "");
  if (!cases.length) lines.push("_No test-cases registered._", "");
  for (const { record, content } of cases) {
    const caseList = listish(content?.cases);
    lines.push(`- **${record.id}:** ${caseList.length} case(s)`);
    for (const item of caseList.slice(0, 12)) {
      if (typeof item === "string") lines.push(`  - ${item}`);
      else if (item?.id) lines.push(`  - \`${item.id}\`${item.expect !== undefined ? ` → ${JSON.stringify(item.expect)}` : ""}`);
      else lines.push(`  - ${JSON.stringify(item)}`);
    }
    if (caseList.length > 12) lines.push(`  - _…${caseList.length - 12} more_`);
  }
  lines.push("");

  lines.push("### Test data / fixtures", "");
  if (!data.length) lines.push("_No test-data registered._", "");
  for (const { record, content } of data) {
    const fixtures = listish(content?.fixtures);
    lines.push(`- **${record.id}:** ${fixtures.length} fixture(s)`);
  }
  lines.push("");

  lines.push(
    "### Human checklist before approve",
    "",
    "- [ ] Happy path **and** relevant failure/auth/empty cases are named.",
    "- [ ] External boundaries (DB, HTTP, LLM, clock, …) have doubles or an explicit exception.",
    "- [ ] Expected results are specific enough to be immutable without amendment.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function renderG4Session({ packs, ready }) {
  const lines = [
    "## G4 story contracts session (human decision)",
    "",
    "Approve executable story contracts (scope, tests, posture, sensors) before the ratchet.",
    "",
    `**Ready to approve:** ${ready ? "yes (if you agree)" : "no — see blocking issues"}`,
    "",
    proposalGuidanceMarkdown("G4").trimEnd(),
    "",
  ];

  const plans = packs.plans || [];
  const traceability = packs.traceability || [];
  if (!plans.length) {
    lines.push("_No story contracts in plans/._", "");
  }

  lines.push("### Contracts", "");
  for (const { record, content } of plans) {
    if (!isObject(content) || !content.story_id) {
      lines.push(`- **${record.id}:** _not a story contract_`);
      continue;
    }
    lines.push(`#### ${content.story_id} (\`${record.id}\`)`, "");
    lines.push(`- **Implementation posture:** \`${content.implementation_posture || "_unset_"}\``);
    lines.push(`- **Feature surfaces:** ${listish(content.feature_surfaces).join(", ") || "_unset_"}`);
    if (content.feature_surfaces?.includes("ui")) lines.push(`- **Browser E2E:** ${content.browser_e2e_required === true ? "required" : "MISSING"} via ${content.browser_e2e_tool || "_unset tool_"}`);
    const deps = listish(content.dependency_story_ids);
    lines.push(`- **Depends on:** ${deps.length ? deps.map((id) => `\`${id}\``).join(", ") : "_none_"}`);
    const scope = listish(content.allowed_change_scope);
    lines.push(`- **Allowed change scope:** ${scope.length ? scope.map((s) => `\`${s}\``).join(", ") : "_unset_"}`);
    const reuse = listish(content.reuse_targets);
    if (reuse.length) {
      lines.push("- **Reuse targets:**");
      for (const target of reuse) {
        if (typeof target === "string") lines.push(`  - ${target}`);
        else lines.push(`  - \`${target.path || "?"}\`${target.symbol ? ` · \`${target.symbol}\`` : ""}`);
      }
    } else if (content.implementation_posture && content.implementation_posture !== "first-slice") {
      lines.push("- **Reuse targets:** _missing_");
    }
    if (content.divergence_justification) {
      lines.push(`- **Divergence justification:** ${content.divergence_justification}`);
    }
    const ac = listish(content.acceptance_criteria);
    if (ac.length) {
      lines.push("- **Acceptance criteria:**");
      for (const item of ac) lines.push(`  - ${item}`);
    }
    const tests = listish(content.test_case_ids);
    const sensors = listish(content.required_sensors);
    lines.push(`- **Test cases:** ${tests.length ? tests.join(", ") : "_none_"}`);
    lines.push(`- **Required sensors:** ${sensors.length ? sensors.join(", ") : "_none_"}`);
    const designRefs = listish(content.approved_design_refs);
    lines.push(`- **Design refs:** ${designRefs.length ? designRefs.join(", ") : "_none_"}`);
    lines.push("");
  }

  lines.push("### Requirements-to-test traceability", "");
  if (!traceability.length) lines.push("_No traceability artifact._", "");
  for (const { record, content } of traceability) {
    lines.push(`#### ${record.id}`, "");
    for (const link of listish(content?.links)) {
      lines.push(`- ${link.requirement_id || "?"} -> ${link.story_id || "?"} -> ${link.acceptance_criterion_id || "?"} -> ${link.test_case_id || "?"} -> ${link.verification_check_id || link.manual_evidence_id || link.disposition || "?"}`);
    }
    lines.push("");
  }

  lines.push(
    "### Human checklist before approve",
    "",
    "- [ ] Dependent stories are not marked `first-slice`.",
    "- [ ] `reuse-existing` / `extract-shared` contracts name real reuse targets.",
    "- [ ] Allowed change scope is narrow enough to block drive-by rewrites.",
    "- [ ] Required sensors include project-relevant checks (e.g. boundaries, file-size).",
    "- [ ] Every source requirement and AC has an explicit automated, manual, or approved-exclusion verification disposition.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function renderB0Session({ packs, ready }) {
  const lines = [
    "## B0 baseline session",
    "",
    `**Ready to approve:** ${ready ? "yes (if you agree)" : "no"}`,
    "",
    "Confirm baseline health is recorded so the change is not blamed for pre-existing red.",
    "",
  ];
  for (const { record, content } of packs.brownfield || []) {
    if (content?.artifact_type && content.artifact_type !== "baseline") continue;
    lines.push(`### ${record.id}`, "");
    const commands = listish(content?.commands);
    lines.push(`- **Recorded commands:** ${commands.length}`);
    if (content?.known_failures) lines.push(`- **Known failures:** ${JSON.stringify(content.known_failures)}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderB1Session({ packs, ready }) {
  const lines = [
    "## B1 code-map session",
    "",
    `**Ready to approve:** ${ready ? "yes (if you agree)" : "no"}`,
    "",
    "Confirm the bounded map, hotspots, and reuse candidates before strategy.",
    "",
  ];
  for (const { record, content } of packs.brownfield || []) {
    if (content?.artifact_type && content.artifact_type !== "code-map") continue;
    lines.push(`### ${record.id}`, "");
    const maps = content?.maps || {};
    lines.push(`- **Impact entries:** ${listish(maps.impact).length}`);
    lines.push(`- **Duplicate candidates:** ${listish(maps.duplicate_candidates).length}`);
    lines.push(`- **Canonical reuse candidates:** ${listish(maps.canonical_reuse_candidates).length}`);
    lines.push(`- **Adapter:** ${content?.adapter?.provider || content?.adapter_used?.provider || "none"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderB2Session({ packs, ready }) {
  const lines = [
    "## B2 change-strategy session",
    "",
    `**Ready to approve:** ${ready ? "yes (if you agree)" : "no"}`,
    "",
    proposalGuidanceMarkdown("B2").trimEnd(),
    "",
  ];
  for (const { record, content } of packs.brownfield || []) {
    if (content?.artifact_type && content.artifact_type !== "change-strategy") continue;
    lines.push(`### ${record.id}`, "");
    lines.push(`- **Goal / seam:** ${content?.goal || content?.smallest_behavioral_seam || "_unset_"}`);
    lines.push(`- **Second-slice decision:** \`${content?.second_slice_decision || "_unset_"}\``);
    const reuse = listish(content?.reuse);
    if (reuse.length) {
      lines.push("- **Reuse:**");
      for (const item of reuse) {
        if (typeof item === "string") lines.push(`  - ${item}`);
        else lines.push(`  - \`${item.path || "?"}\`${item.symbol ? ` · \`${item.symbol}\`` : ""}`);
      }
    }
    if (content?.divergence_justification) {
      lines.push(`- **Divergence:** ${content.divergence_justification}`);
    }
    lines.push("");
  }
  for (const { record, content } of packs.amendments || []) {
    lines.push(`### Amendment ${record.id}`, "");
    lines.push(`- **Decision:** ${content?.decision || "_unset_"}`);
    if (content?.proposed_delta) lines.push(`- **Delta:** ${content.proposed_delta}`);
    const alts = listish(content?.alternatives);
    if (alts.length) lines.push(`- **Alternatives:** ${alts.join("; ")}`);
    lines.push("");
  }
  lines.push(
    "### Human checklist before approve",
    "",
    "- [ ] Reuse is preferred over speculative generalization.",
    "- [ ] Duplication risks are named when the map found them.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

/**
 * @param {string} gate
 * @param {{ bodies: Array, ready: boolean }} input
 */
function renderGateSession(gate, { bodies = [], ready = false, analysis = null } = {}) {
  const packs = packagesFromBodies(bodies);
  if (gate === "G0") return renderG0Session({ packs, ready });
  if (gate === "G1") return renderG1Session({ packs, ready, analysis });
  if (gate === "G2") return renderG2Session({ packs, ready });
  if (gate === "G3") {
    const { design, architecture } = extractG3Bodies(bodies);
    return renderG3DesignSession({ design, architecture, ready });
  }
  if (gate === "G4") return renderG4Session({ packs, ready });
  if (gate === "B0") return renderB0Session({ packs, ready });
  if (gate === "B1") return renderB1Session({ packs, ready });
  if (gate === "B2") return renderB2Session({ packs, ready });
  return "";
}

function appendixHeading(gate) {
  if (gate === "G3") return "## Registered artifacts (JSON appendix)";
  if (["G0", "G1", "G2", "G4", "B0", "B1", "B2"].includes(gate)) {
    return "## Registered artifacts (JSON appendix)";
  }
  return "## Artifacts for review";
}

function approveHeading(gate) {
  if (["G0", "G1", "G2", "G3", "G4", "B0", "B1", "B2"].includes(gate)) return "## Approve command";
  return "## Human decision";
}

function approveIntro(gate) {
  const labels = {
    G0: "If the interpretation session above is acceptable, freeze source + interpretation:",
    G1: "If the story breakdown above is acceptable, freeze epics/stories/dependencies/allocations:",
    G2: "If the test strategy above is acceptable, freeze test plans/cases/data:",
    G3: "If the design session above is acceptable, freeze design + architecture:",
    G4: "If the story contracts above are acceptable, freeze plans and enter the ratchet:",
    B0: "If the baseline record is accurate, freeze B0:",
    B1: "If the bounded map is accurate, freeze B1:",
    B2: "If the reuse strategy is acceptable, freeze B2:",
  };
  return labels[gate]
    || "If you approve this gate, the harness records your name and freezes the listed artifacts:";
}

module.exports = {
  packagesFromBodies,
  renderGateSession,
  appendixHeading,
  approveHeading,
  approveIntro,
  bullets,
};
