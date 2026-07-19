const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { discover, renderDiscovery } = require("../lib/discovery");

test("discovers source signals and candidate seams only in the requested scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-discovery-"));
  fs.mkdirSync(path.join(root, "app", "services"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "[project]\nname='demo'\n");
  fs.writeFileSync(path.join(root, "app", "services", "capital_call_service.py"), "pass\n");
  fs.writeFileSync(path.join(root, "tests", "test_capital_call.py"), "def test_example(): pass\n");

  const result = discover(root, ["app"]);
  assert.deepEqual(result.sourceFiles, ["app/services/capital_call_service.py"]);
  assert.deepEqual(result.roles.application, ["app/services/capital_call_service.py"]);
  assert.ok(result.signals.includes("Python source"));
  assert.ok(result.signals.includes("pyproject.toml"));
});

test("renders a concise, actionable discovery report", () => {
  const report = renderDiscovery({
    id: "PE-001-discovery",
    config: { technologyProfiles: ["python-fastapi"], domainPack: "private-equity" },
    scopedPaths: ["app/services"],
    result: {
      files: ["app/services/capital_call_service.py"],
      skipped: [],
      sourceFiles: ["app/services/capital_call_service.py"],
      signals: ["Python source"],
      roles: { application: ["app/services/capital_call_service.py"] },
    },
  });

  assert.match(report, /Brownfield discovery: PE-001-discovery/);
  assert.match(report, /canonical existing pattern/);
});
