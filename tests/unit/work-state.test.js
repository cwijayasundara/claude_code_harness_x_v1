const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const specs = require("../../.claude/lib/specifications");
const { classifyRequest } = require("../../.claude/lib/work-intake");
const { attachWorkflow, deriveWork, listActiveWork, resumeWork } = require("../../.claude/lib/work-state");

function project(branch = "feature/work") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-work-state-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  fs.writeFileSync(path.join(root, "seed.txt"), "seed\n");
  execFileSync("git", ["-C", root, "add", "seed.txt"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "seed"]);
  execFileSync("git", ["-C", root, "switch", "-qc", branch]);
  return root;
}

test("persists workflow metadata additively and derives the next action", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "story.md"), "# US-142\n");
  specs.intake(root, { changeId: "US-142", source: "story.md", kind: "story" });
  const classification = classifyRequest({ request: "Implement story US-142", entryKind: "story" });
  const saved = attachWorkflow(root, "US-142", classification);
  assert.equal(saved.delivery_lane, "bounded-change");
  const work = deriveWork(root, "US-142");
  assert.equal(work.current_checkpoint, "product");
  assert.match(work.next_action, /G0/);
  const index = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "index.json"), "utf8"));
  assert.equal(index.schema_version, 1);
  assert.equal(index.changes["US-142"].workflow.target, "draft-pr");
});

test("resumes the sole active change and requires selection for several", () => {
  const root = project();
  for (const id of ["C-1", "C-2"]) {
    fs.writeFileSync(path.join(root, `${id}.md`), `# ${id}\n`);
    specs.intake(root, { changeId: id, source: `${id}.md`, kind: "feature" });
    attachWorkflow(root, id, classifyRequest({ request: "Add feature", entryKind: "feature" }));
  }
  assert.equal(listActiveWork(root).length, 2);
  assert.throws(() => resumeWork(root), /Multiple active changes/);
  assert.equal(resumeWork(root, { changeId: "C-2" }).change_id, "C-2");
});

test("terminal work is excluded from active work", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "feature.md"), "# Feature\n");
  specs.intake(root, { changeId: "C-1", source: "feature.md", kind: "feature" });
  attachWorkflow(root, "C-1", classifyRequest({ request: "Add feature", entryKind: "feature" }));
  const indexPath = path.join(root, ".claude", "specs", "index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  index.changes["C-1"].workflow.state = "draft-pr-ready";
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  assert.deepEqual(listActiveWork(root), []);
  assert.throws(() => resumeWork(root), /No active harness work/);
});
