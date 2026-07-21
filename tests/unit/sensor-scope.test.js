const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { gitChangedPaths, workspaceFingerprint } = require("../../.claude/lib/sensor-scope");

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sensor-scope-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "tracked.js"), "module.exports = 1;\n");
  execFileSync("git", ["-C", root, "add", "src/tracked.js"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
  return root;
}

test("changed scope includes untracked files alongside tracked modifications", () => {
  const root = repository();
  fs.writeFileSync(path.join(root, "src", "tracked.js"), "module.exports = 2;\n");
  fs.writeFileSync(path.join(root, "src", "generated.js"), "module.exports = 'generated';\n");

  assert.deepEqual(gitChangedPaths(root).sort(), ["src/generated.js", "src/tracked.js"]);
});

test("workspace fingerprint changes with product code but ignores harness evidence", () => {
  const root = repository();
  const baseline = workspaceFingerprint(root).sha256;
  fs.mkdirSync(path.join(root, ".claude", "specs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "specs", "evidence.json"), "{}\n");
  assert.equal(workspaceFingerprint(root).sha256, baseline);
  fs.writeFileSync(path.join(root, "src", "tracked.js"), "module.exports = 3;\n");
  assert.notEqual(workspaceFingerprint(root).sha256, baseline);
});
