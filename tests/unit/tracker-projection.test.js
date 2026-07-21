const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { buildProjection, decideOperations, executeWithAdapter, recordReceipt, validateProjection } = require("../../.claude/lib/tracker-projection");

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-projection-"));
  const specs = path.join(root, ".claude", "specs");
  fs.mkdirSync(specs, { recursive: true });
  const artifacts = [];
  function add(id, packageName, content, derivedFrom = []) {
    const relative = `.claude/specs/${packageName}/${id}.json`;
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ id, package: packageName, change_id: "C-1", status: "approved", content }));
    artifacts.push({ id, package: packageName, change_id: "C-1", status: "approved", path: relative, sha256: digest(file), source_locations: ["prd.md"], derived_from: derivedFrom });
  }
  add("E1", "epics", { title: "Billing" });
  add("S1", "stories", { title: "Foundation", acceptance_criteria: ["AC1"], size: "low", story_points: 2, estimate_confidence: "high", estimate_basis: ["small"] }, ["E1"]);
  add("S2", "stories", { title: "Dependent", acceptance_criteria: ["AC2"], size: "medium", story_points: 5, estimate_confidence: "medium", estimate_basis: ["integration"] }, ["E1"]);
  add("D1", "dependencies", { nodes: [{ story_id: "S1" }, { story_id: "S2" }], edges: [{ from: "S1", to: "S2", rationale: "reuse" }] });
  add("A1", "allocations", { clusters: [{ id: "cluster-1", story_ids: ["S1", "S2"], total_points: 7, depends_on_clusters: [], shared_seams: ["src"], required_skills: ["TypeScript"], rationale: "cohesive" }] });
  fs.writeFileSync(path.join(specs, "index.json"), JSON.stringify({
    schema_version: 1,
    changes: { "C-1": { source_ids: ["C-1-source"], gates: { G1: { status: "approved", approved_at: "2026-07-20T00:00:00Z" } } } },
    artifacts, relationships: [],
  }));
  return root;
}

test("builds a provider-neutral projection from approved G1", () => {
  const projection = buildProjection(fixture(), { changeId: "C-1", provider: "linear", projectKey: "ENG" });
  assert.deepEqual(validateProjection(projection.content), []);
  assert.equal(projection.content.authority, "local-specs");
  assert.equal(projection.content.operations.filter((item) => item.kind === "story").length, 2);
  const story2 = projection.content.operations.find((item) => item.local_id === "S2");
  assert.deepEqual(story2.payload.dependency_story_ids, ["S1"]);
  assert.equal(story2.payload.allocation_cluster_id, "cluster-1");
});

test("projection refuses work before approved G1", () => {
  const root = fixture();
  const indexPath = path.join(root, ".claude", "specs", "index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  delete index.changes["C-1"].gates.G1;
  fs.writeFileSync(indexPath, JSON.stringify(index));
  assert.throws(() => buildProjection(root, { changeId: "C-1", provider: "jira", projectKey: "ENG" }), /requires approved G1/);
});

test("idempotency chooses noop, update, and human reconciliation", () => {
  const projection = buildProjection(fixture(), { changeId: "C-1", provider: "jira", projectKey: "ENG" });
  const first = projection.content.operations[0];
  assert.equal(decideOperations(projection, [{ results: [{ local_id: first.local_id, local_hash: first.local_hash, remote_id: "R1", status: "success" }] }])[0].decision, "noop");
  assert.equal(decideOperations(projection, [{ results: [{ local_id: first.local_id, local_hash: "old", remote_id: "R1", status: "success" }] }])[0].decision, "update");
  assert.equal(decideOperations(projection, [{ results: [{ local_id: first.local_id, local_hash: first.local_hash, remote_id: "R1", status: "success", remote_diverged: true }] }])[0].decision, "human-decision-required");
});

test("fake adapter records partial failure and retries safely", async () => {
  const projection = buildProjection(fixture(), { changeId: "C-1", provider: "generic", projectKey: "ENG" });
  let calls = 0;
  const receipt = await executeWithAdapter(projection, {
    create: async (item) => {
      calls += 1;
      if (calls === 2) throw new Error("provider unavailable");
      return { remote_id: `R-${item.local_id}`, remote_snapshot_hash: "snapshot" };
    },
    update: async (remoteId) => ({ remote_id: remoteId }),
  });
  assert.equal(receipt.status, "partial-failure");
  assert.ok(receipt.results.some((item) => item.status === "failure"));
  const retry = decideOperations(projection, [receipt]);
  assert.ok(retry.some((item) => item.decision === "noop"));
  assert.ok(retry.some((item) => item.decision === "create"));
});

test("receipts require an approved projection and are immutable", () => {
  const root = fixture();
  const projection = buildProjection(root, { changeId: "C-1", provider: "linear", projectKey: "ENG" });
  const projectionRelative = `.claude/specs/tracker-projections/${projection.id}.json`;
  const projectionFile = path.join(root, projectionRelative);
  fs.mkdirSync(path.dirname(projectionFile), { recursive: true });
  projection.status = "approved";
  fs.writeFileSync(projectionFile, JSON.stringify(projection));
  const indexPath = path.join(root, ".claude", "specs", "index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  index.artifacts.push({ id: projection.id, change_id: "C-1", package: "tracker-projections", status: "approved", path: projectionRelative, sha256: digest(projectionFile) });
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const receipt = { schema_version: 1, projection_id: projection.id, projection_hash: projection.content.projection_hash, status: "success", results: projection.content.operations.map((item) => ({ local_id: item.local_id, local_hash: item.local_hash, remote_id: `R-${item.local_id}`, status: "success", operation: "create" })) };
  const recorded = recordReceipt(root, { receiptId: "run-1", receipt });
  assert.equal(recorded.sha256.length, 64);
  assert.throws(() => recordReceipt(root, { receiptId: "run-1", receipt: { ...receipt, status: "partial-failure" } }), /different content/);
});
