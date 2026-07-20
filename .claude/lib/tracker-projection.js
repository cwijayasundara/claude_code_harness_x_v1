const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PROVIDERS = new Set(["linear", "jira", "azure-devops", "generic"]);

function hash(value) {
  const input = Buffer.isBuffer(value) || typeof value === "string" ? value : JSON.stringify(value);
  return crypto.createHash("sha256").update(input).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadArtifact(root, record) {
  const file = path.join(root, record.path);
  const actual = hash(fs.readFileSync(file));
  if (record.sha256 && actual !== record.sha256) throw new Error(`Approved artifact '${record.id}' no longer matches its registered hash.`);
  return readJson(file);
}

function projectionOperation(kind, localId, payload) {
  return { operation: "upsert", kind, local_id: localId, local_hash: hash(payload), payload };
}

function buildProjection(root, { changeId, provider, projectKey }) {
  const projectRoot = path.resolve(root);
  if (!PROVIDERS.has(provider)) throw new Error(`provider must be one of: ${[...PROVIDERS].join(", ")}.`);
  if (typeof projectKey !== "string" || !projectKey.trim()) throw new Error("projectKey is required.");
  const indexPath = path.join(projectRoot, ".claude", "specs", "index.json");
  if (!fs.existsSync(indexPath)) throw new Error("Missing .claude/specs/index.json.");
  const index = readJson(indexPath);
  const change = index.changes?.[changeId];
  if (!change?.gates?.G1 || change.gates.G1.status !== "approved") throw new Error(`Change '${changeId}' requires approved G1 before tracker projection.`);
  const records = index.artifacts.filter((item) => item.change_id === changeId && item.status === "approved");
  const epics = records.filter((item) => item.package === "epics").map((record) => ({ record, body: loadArtifact(projectRoot, record) }));
  const stories = records.filter((item) => item.package === "stories").map((record) => ({ record, body: loadArtifact(projectRoot, record) }));
  const dependencyRecord = records.find((item) => item.package === "dependencies");
  const allocationRecord = records.find((item) => item.package === "allocations");
  if (!epics.length || !stories.length || !dependencyRecord || !allocationRecord) throw new Error("Approved G1 projection requires epics, stories, dependencies, and allocations.");
  const dependencies = loadArtifact(projectRoot, dependencyRecord).content;
  const allocations = loadArtifact(projectRoot, allocationRecord).content;
  const clusterByStory = new Map();
  for (const cluster of allocations.clusters || []) for (const storyId of cluster.story_ids || []) clusterByStory.set(storyId, cluster.id);
  const dependsOn = new Map((dependencies.nodes || []).map((node) => [typeof node === "string" ? node : node.story_id, []]));
  for (const edge of dependencies.edges || []) if (dependsOn.has(edge.to)) dependsOn.get(edge.to).push(edge.from);

  const operations = [];
  for (const { record, body } of epics) operations.push(projectionOperation("epic", record.id, {
    title: body.content?.title || body.content?.goal || record.id,
    description: body.content?.goal || body.content?.summary || "",
    source_artifact_id: record.id,
  }));
  for (const { record, body } of stories) operations.push(projectionOperation("story", record.id, {
    title: body.content?.title || record.id,
    acceptance_criteria: body.content?.acceptance_criteria || [],
    size: body.content?.size,
    story_points: body.content?.story_points,
    estimate_confidence: body.content?.estimate_confidence,
    estimate_basis: body.content?.estimate_basis || [],
    epic_ids: (record.derived_from || []).filter((id) => epics.some((epic) => epic.record.id === id)),
    dependency_story_ids: (dependsOn.get(record.id) || []).sort(),
    allocation_cluster_id: clusterByStory.get(record.id) || null,
    source_artifact_id: record.id,
  }));
  for (const cluster of allocations.clusters || []) operations.push(projectionOperation("cluster", cluster.id, {
    story_ids: cluster.story_ids,
    total_points: cluster.total_points,
    depends_on_clusters: cluster.depends_on_clusters,
    shared_seams: cluster.shared_seams,
    required_skills: cluster.required_skills,
    rationale: cluster.rationale,
    assignee: cluster.assignee || null,
  }));

  const projectionId = `${changeId}-${provider}-projection`;
  const content = {
    schema_version: 1,
    provider,
    project_key: projectKey,
    authority: "local-specs",
    generated_from_gate: "G1",
    source_gate_approved_at: change.gates.G1.approved_at,
    operations,
  };
  content.projection_hash = hash(content);
  return {
    id: projectionId, package: "tracker-projections", change_id: changeId,
    source_ids: change.source_ids || [], source_locations: records.flatMap((item) => item.source_locations || []),
    derived_from: records.filter((item) => ["epics", "stories", "dependencies", "allocations"].includes(item.package)).map((item) => item.id),
    status: "draft", assumptions: [], open_questions: [], human_approver: null, approved_at: null, content,
  };
}

function validateProjection(content) {
  const errors = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) return ["tracker projection content must be an object."];
  if (content.schema_version !== 1) errors.push("tracker projection schema_version must be 1.");
  if (!PROVIDERS.has(content.provider)) errors.push("tracker projection provider is invalid.");
  if (typeof content.project_key !== "string" || !content.project_key.trim()) errors.push("tracker projection project_key is required.");
  if (content.authority !== "local-specs") errors.push("tracker projection authority must be 'local-specs'.");
  if (!Array.isArray(content.operations) || content.operations.length === 0) errors.push("tracker projection operations must be non-empty.");
  const ids = new Set();
  for (const [index, operation] of (content.operations || []).entries()) {
    if (!operation?.local_id || ids.has(operation.local_id)) errors.push(`operations[${index}].local_id must be unique and non-empty.`);
    ids.add(operation?.local_id);
    if (!operation?.local_hash || operation.local_hash !== hash(operation.payload)) errors.push(`operations[${index}].local_hash does not match payload.`);
    if (!new Set(["epic", "story", "cluster"]).has(operation?.kind)) errors.push(`operations[${index}].kind is invalid.`);
  }
  const { projection_hash: ignored, ...hashable } = content;
  if (!content.projection_hash || content.projection_hash !== hash(hashable)) errors.push("tracker projection projection_hash is invalid.");
  return errors;
}

function decideOperations(projection, previousReceipts = []) {
  const latestByLocal = new Map();
  for (const receipt of previousReceipts) for (const result of receipt.results || []) latestByLocal.set(result.local_id, result);
  return projection.content.operations.map((operation) => {
    const previous = latestByLocal.get(operation.local_id);
    if (previous?.remote_diverged === true) return { ...operation, decision: "human-decision-required", remote_id: previous.remote_id || null };
    if (previous?.status === "success" && previous.local_hash === operation.local_hash) return { ...operation, decision: "noop", remote_id: previous.remote_id };
    return { ...operation, decision: previous?.remote_id ? "update" : "create", remote_id: previous?.remote_id || null };
  });
}

async function executeWithAdapter(projection, adapter, previousReceipts = []) {
  if (!adapter || typeof adapter.create !== "function" || typeof adapter.update !== "function") throw new Error("Adapter requires create and update functions.");
  const decisions = decideOperations(projection, previousReceipts);
  if (decisions.some((item) => item.decision === "human-decision-required")) throw new Error("Remote divergence requires a human reconciliation decision before publication.");
  const results = [];
  for (const item of decisions) {
    if (item.decision === "noop") {
      results.push({ local_id: item.local_id, local_hash: item.local_hash, remote_id: item.remote_id, status: "success", operation: "noop" });
      continue;
    }
    try {
      const response = item.decision === "create" ? await adapter.create(item) : await adapter.update(item.remote_id, item);
      if (!response?.remote_id) throw new Error(`Adapter ${item.decision} did not return remote_id.`);
      results.push({ local_id: item.local_id, local_hash: item.local_hash, remote_id: response.remote_id, remote_url: response.remote_url || null, remote_snapshot_hash: response.remote_snapshot_hash || null, status: "success", operation: item.decision });
    } catch (error) {
      results.push({ local_id: item.local_id, local_hash: item.local_hash, remote_id: item.remote_id || null, status: "failure", operation: item.decision, error: String(error.message || error) });
    }
  }
  return { schema_version: 1, projection_id: projection.id, projection_hash: projection.content.projection_hash, provider: projection.content.provider, project_key: projection.content.project_key, generated_at: new Date().toISOString(), status: results.every((item) => item.status === "success") ? "success" : "partial-failure", results };
}

function validateReceipt(receipt, projection) {
  const errors = [];
  if (receipt.projection_id !== projection.id || receipt.projection_hash !== projection.content.projection_hash) errors.push("Receipt does not match the approved projection.");
  if (!Array.isArray(receipt.results)) errors.push("Receipt results must be an array.");
  for (const [index, result] of (receipt.results || []).entries()) {
    for (const field of ["local_id", "local_hash", "status", "operation"]) if (!result?.[field]) errors.push(`results[${index}].${field} is required.`);
    if (result?.status === "success" && !result.remote_id) errors.push(`results[${index}].remote_id is required for success.`);
    if (result?.status === "failure" && !result.error) errors.push(`results[${index}].error is required for failure.`);
  }
  return errors;
}

function recordReceipt(root, { receiptId, receipt }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(receiptId || "")) throw new Error("receiptId is invalid.");
  const projectRoot = path.resolve(root);
  const index = readJson(path.join(projectRoot, ".claude", "specs", "index.json"));
  const record = index.artifacts.find((item) => item.id === receipt.projection_id && item.package === "tracker-projections" && item.status === "approved");
  if (!record) throw new Error(`Approved tracker projection '${receipt.projection_id}' is unavailable.`);
  const projection = loadArtifact(projectRoot, record);
  const errors = validateReceipt(receipt, projection);
  if (errors.length) throw new Error(`Tracker receipt validation failed:\n- ${errors.join("\n- ")}`);
  const output = path.join(projectRoot, ".claude", "specs", "evidence", "tracker", receipt.projection_id, `${receiptId}.json`);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (fs.existsSync(output) && fs.readFileSync(output, "utf8") !== serialized) throw new Error(`Immutable tracker receipt '${receiptId}' already exists with different content.`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (!fs.existsSync(output)) fs.writeFileSync(output, serialized, "utf8");
  return { receipt_id: receiptId, path: path.relative(projectRoot, output), sha256: hash(Buffer.from(serialized)), status: receipt.status };
}

module.exports = { PROVIDERS, buildProjection, decideOperations, executeWithAdapter, hash, recordReceipt, validateProjection, validateReceipt };
