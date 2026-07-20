const fs = require("node:fs");
const path = require("node:path");
const { validateClassification } = require("./work-intake");

const TERMINAL_STATES = new Set(["draft-pr-ready", "stopped", "superseded"]);
const GATE_ORDER = ["G0", "G1", "G2", "G3", "G4"];

function indexPath(root) { return path.join(path.resolve(root), ".claude", "specs", "index.json"); }
function readIndex(root) { return JSON.parse(fs.readFileSync(indexPath(root), "utf8")); }
function writeIndex(root, index) { fs.writeFileSync(indexPath(root), `${JSON.stringify(index, null, 2)}\n`, "utf8"); }

function checkpointFor(change) {
  const gates = change.gates || {};
  if (!gates.G0 || !gates.G1) return "product";
  if (!gates.G2 || !gates.G3 || !gates.G4) return "solution";
  return "delivery";
}

function nextActionFor(change) {
  const workflow = change.workflow || {};
  const gates = change.gates || {};
  if (!gates.G0) return "Prepare or review the grounded intent (G0).";
  if (!gates.G1) return "Prepare or review stories and dependencies (G1).";
  if (["brief", "backlog"].includes(workflow.target)) return "Requested documentation target is complete after the approved product checkpoint.";
  if (!gates.G2) return "Prepare or review test strategy and cases (G2).";
  if (!gates.G3) return "Prepare or review architecture and design (G3).";
  if (["design", "tests"].includes(workflow.target)) return `Requested ${workflow.target} target is complete after the approved solution artifacts.`;
  if (!gates.G4) return "Prepare or review executable story contracts and traceability (G4).";
  return "Resume the next dependency-ready story ratchet.";
}

function attachWorkflow(root, changeId, classification) {
  const errors = validateClassification(classification);
  if (errors.length) throw new Error(`Workflow classification is invalid:\n- ${errors.join("\n- ")}`);
  const index = readIndex(root);
  const change = index.changes?.[changeId];
  if (!change) throw new Error(`Unknown change '${changeId}'. Intake its source first.`);
  const now = new Date().toISOString();
  change.workflow = {
    ...classification,
    current_checkpoint: checkpointFor(change),
    state: "active",
    next_action: nextActionFor({ ...change, workflow: classification }),
    created_at: change.workflow?.created_at || now,
    updated_at: now,
  };
  writeIndex(root, index);
  return change.workflow;
}

function deriveWork(root, changeId) {
  const index = readIndex(root);
  const change = index.changes?.[changeId];
  if (!change) throw new Error(`Unknown change '${changeId}'.`);
  if (!change.workflow) return null;
  return {
    change_id: changeId,
    branch: change.branch,
    ...change.workflow,
    current_checkpoint: checkpointFor(change),
    approved_gates: GATE_ORDER.filter((gate) => change.gates?.[gate]?.status === "approved"),
    next_action: nextActionFor(change),
  };
}

function listActiveWork(root, branch = null) {
  const index = readIndex(root);
  return Object.entries(index.changes || {})
    .filter(([, change]) => change.workflow && !TERMINAL_STATES.has(change.workflow.state) && (!branch || change.branch === branch))
    .map(([changeId]) => deriveWork(root, changeId));
}

function resumeWork(root, { changeId, branch = null } = {}) {
  const candidates = changeId ? [deriveWork(root, changeId)].filter(Boolean) : listActiveWork(root, branch);
  if (candidates.length === 0) throw new Error("No active harness work was found for this branch.");
  if (candidates.length > 1) throw new Error(`Multiple active changes found: ${candidates.map((item) => item.change_id).join(", ")}. Supply --change <id>.`);
  return candidates[0];
}

module.exports = { TERMINAL_STATES, attachWorkflow, checkpointFor, deriveWork, listActiveWork, nextActionFor, resumeWork };
