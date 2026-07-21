const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkBoundaries } = require("../../.claude/lib/architecture-boundaries");

test("reports an import that violates an executable architecture boundary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-check-"));
  fs.mkdirSync(path.join(root, ".claude", "project"), { recursive: true });
  fs.mkdirSync(path.join(root, "app", "routers"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "project", "boundaries.json"), JSON.stringify({
    version: 1,
    rules: [{ id: "routers-no-repositories", from: "app/routers/", forbidden: ["app/repositories/"], extensions: [".py"], reason: "Routers use services." }],
  }));
  fs.writeFileSync(path.join(root, "app", "routers", "calls.py"), "from app.repositories.calls import load_call\n");

  const result = checkBoundaries(root, ["app/routers/calls.py"]);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule.id, "routers-no-repositories");
});

test("project-wide scope expands files before checking boundaries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boundary-all-"));
  fs.mkdirSync(path.join(root, ".claude", "project"), { recursive: true });
  fs.mkdirSync(path.join(root, "app", "routers"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "project", "boundaries.json"), JSON.stringify({
    version: 1,
    rules: [{ id: "routers-no-repositories", from: "app/routers/", forbidden: ["app/repositories/"], extensions: [".py"], reason: "Routers use services." }],
  }));
  fs.writeFileSync(path.join(root, "app", "routers", "calls.py"), "from app.repositories.calls import load_call\n");

  const result = checkBoundaries(root, ["."]);
  assert.equal(result.violations.length, 1);
  assert.ok(result.inspectedPaths.includes("app/routers/calls.py"));
});
