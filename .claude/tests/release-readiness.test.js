const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReleaseLayout } = require("../lib/release-readiness");

test("release layout rejects a missing or malformed plugin manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-layout-"));
  assert.match(validateReleaseLayout(root)[0], /Missing plugin manifest/);
  fs.mkdirSync(path.join(root, ".claude-plugin"));
  fs.writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), "{bad json");
  assert.match(validateReleaseLayout(root)[0], /Unable to parse/);
});

test("current plugin layout is release-ready before execution checks", () => {
  const root = path.resolve(__dirname, "..");
  assert.deepEqual(validateReleaseLayout(root), []);
});
