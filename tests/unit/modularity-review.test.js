const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { buildReviewPacket, findingFingerprint, mergeReviews, validateReview } = require("../../.claude/lib/modularity-review");
const modularityRunner = path.resolve(__dirname, "../../.claude/scripts/harness-modularity.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "modularity-review-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, ".claude", "project"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.js"), "export const value = 1;\n");
  fs.writeFileSync(path.join(root, ".claude", "project", "dependency-sensors.json"), JSON.stringify({ version: 1, approved_roots: ["src"] }));
  fs.writeFileSync(path.join(root, ".claude", "project", "modularity-review.json"), JSON.stringify({ version: 1, enabled: true, minimum_independent_reviews: 2, triggers: { changed_source_files: 1, changed_files: 99, new_dependency_edges: 99, high_impact_modules: 99, dependency_cycles: 99 }, include_paths: [".claude/project/dependency-sensors.json"] }));
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
  fs.writeFileSync(path.join(root, "src", "app.js"), "export const value = 2;\n");
  return root;
}

function review(packet, number, finding) {
  return { schema_version: 1, review_id: `review-${number}`, reviewer_id: `reviewer-${number}`, independent_context_id: `context-${number}`, packet_id: packet.packet_id, workspace_sha256: packet.workspace.sha256, findings: finding ? [finding] : [] };
}

function duplicatedFinding() {
  return { category: "semantic-duplication", severity: "high", affected_paths: ["src/app.js", "src/other.js"], evidence: ["The same policy is independently implemented."], design_options: ["Reuse app policy.", "Extract a shared policy after confirming co-change."], recommendation: "Reuse first." };
}

test("risk triggers produce a grounded required review packet", () => {
  const root = fixture();
  const packet = buildReviewPacket(root);
  assert.equal(packet.required, true);
  assert.ok(packet.triggers.fired.some((item) => item.id === "changed_source_files"));
  assert.equal(packet.workspace.changed_paths[0], "src/app.js");
  assert.ok(packet.grounding_refs[0].sha256);
});

test("two independent high-severity findings require a human decision", () => {
  const root = fixture();
  const packet = buildReviewPacket(root);
  const finding = duplicatedFinding();
  const merged = mergeReviews(root, packet, [review(packet, 1, finding), review(packet, 2, finding)]);
  assert.equal(merged.status, "human-decision-required");
  assert.equal(merged.findings[0].corroborated, true);
  assert.equal(merged.findings[0].review_count, 2);
});

test("reviews must be fresh and independently identified", () => {
  const root = fixture();
  const packet = buildReviewPacket(root);
  const first = review(packet, 1, duplicatedFinding());
  const duplicate = { ...review(packet, 2, duplicatedFinding()), reviewer_id: first.reviewer_id };
  assert.throws(() => mergeReviews(root, packet, [first, duplicate]), /distinct reviewers/);
  const stale = { ...first, workspace_sha256: "0".repeat(64) };
  assert.match(validateReview(stale, packet).join(" "), /stale/);
});

test("an active human-approved intentional hub decision classifies the finding", () => {
  const root = fixture();
  const packet = buildReviewPacket(root);
  const finding = duplicatedFinding();
  const findingHash = findingFingerprint(finding);
  fs.writeFileSync(path.join(root, ".claude", "project", "modularity-decisions.json"), JSON.stringify({ version: 1, decisions: [{ finding_fingerprint: findingHash, classification: "intentional-hub", owner: "Architecture", approved_by: "Human Architect", reason: "Composition root intentionally centralizes wiring.", expires_on: "2099-01-01" }] }));
  const merged = mergeReviews(root, packet, [review(packet, 1, finding), review(packet, 2, finding)]);
  assert.equal(merged.status, "pass");
  assert.equal(merged.findings[0].disposition, "accepted-decision");
});

test("modularity CLI writes a token-efficient grounded packet", () => {
  const root = fixture();
  const output = execFileSync(process.execPath, [modularityRunner, root], { encoding: "utf8" });
  assert.match(output, /REQUIRED true/);
  const packetPath = path.join(root, ".claude", "specs", "evidence", "runtime", "modularity", "review-packet.json");
  const markdownPath = path.join(root, ".claude", "specs", "evidence", "runtime", "modularity", "review-packet.md");
  assert.ok(fs.existsSync(packetPath));
  assert.match(fs.readFileSync(markdownPath, "utf8"), /semantic duplication/);
});
