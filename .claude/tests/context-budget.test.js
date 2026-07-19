const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildContextManifest, packContext } = require("../lib/context-budget");

test("preserves protected context and compresses only verbose tool output with provenance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-budget-"));
  fs.writeFileSync(path.join(root, "prd.md"), "approved requirement\n");
  fs.writeFileSync(path.join(root, "log.txt"), Array.from({ length: 140 }, (_, index) => `line ${index + 1}`).join("\n"));
  const packed = packContext(root, { tokenBudget: 1000, manifest: { items: [
    { path: "prd.md", kind: "source-requirement", priority: 100 },
    { path: "log.txt", kind: "tool-output", priority: 1 },
  ] } });
  assert.equal(packed.selected[0].kind, "source-requirement");
  assert.equal(packed.selected[1].provenance.omitted_lines, 40);
  assert.match(packed.selected[1].compressed_tool_output, /lines omitted/);
});

test("fails instead of truncating an approved requirement", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-budget-"));
  fs.writeFileSync(path.join(root, "prd.md"), "x".repeat(1000));
  assert.throws(() => packContext(root, { tokenBudget: 10, manifest: { items: [{ path: "prd.md", kind: "source-requirement" }] } }), /Required source-requirement/);
});

test("omits lower-priority optional context when the budget is reached", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-budget-"));
  fs.writeFileSync(path.join(root, "required.py"), "x".repeat(100));
  fs.writeFileSync(path.join(root, "optional.py"), "y".repeat(100));
  const packed = packContext(root, { tokenBudget: 30, manifest: { items: [
    { path: "required.py", kind: "code", priority: 10, required: true },
    { path: "optional.py", kind: "code", priority: 1 },
  ] } });
  assert.equal(packed.selected.length, 1);
  assert.equal(packed.omitted[0].path, "optional.py");
});

test("buildContextManifest marks protected kinds required", () => {
  const manifest = buildContextManifest([
    { path: "prd.md", kind: "source-requirement" },
    { path: "app.js", kind: "code", priority: 10 },
  ]);
  assert.equal(manifest.items[0].required, true);
  assert.equal(manifest.items[1].required, false);
});
