const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const { checkCoverage, checkGenerative, checkMutation, checkTestIntegrity, mutationCounts } = require("../lib/regression-sensors");

const regressionRunner = path.resolve(__dirname, "..", "scripts", "harness-regression.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "regression-sensors-"));
  fs.mkdirSync(path.join(root, "coverage"), { recursive: true });
  fs.mkdirSync(path.join(root, "reports", "mutation"), { recursive: true });
  return root;
}

test("coverage adapter reports weak changed branch coverage", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "coverage", "coverage-summary.json"), JSON.stringify({
    total: { lines: { total: 100, covered: 90, pct: 90 }, branches: { total: 20, covered: 15, pct: 75 } },
    "src/changed.js": { lines: { total: 10, covered: 10, pct: 100 }, branches: { total: 10, covered: 5, pct: 50 } },
  }));
  const result = checkCoverage(root, ["src/changed.js"], { config: { coverage: { enabled: true, report_path: "coverage/coverage-summary.json", minimum_lines_pct: 80, minimum_branches_pct: 70, minimum_changed_lines_pct: 90, minimum_changed_branches_pct: 80, severity: "warn" } } });
  assert.equal(result.status, "warn");
  assert.equal(result.metrics.changed_branches_pct, 50);
  assert.match(result.reason, /changed branches/);
});

test("mutation adapter reports survivors and no-coverage mutants in changed code", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "reports", "mutation", "mutation.json"), JSON.stringify({ files: {
    "src/changed.js": { mutants: [{ status: "Killed" }, { status: "Survived" }, { status: "NoCoverage" }] },
    "src/stable.js": { mutants: [{ status: "Killed" }, { status: "Killed" }] },
  } }));
  const result = checkMutation(root, ["src/changed.js"], { config: { mutation: { enabled: true, report_path: "reports/mutation/mutation.json", minimum_score_pct: 50, minimum_changed_score_pct: 80, maximum_changed_survivors: 0, maximum_changed_no_coverage: 0, severity: "warn" } } });
  assert.equal(result.status, "warn");
  assert.equal(result.metrics.changed_survivors, 1);
  assert.equal(result.metrics.changed_no_coverage, 1);
});

test("mutation score counts timeout as detected and excludes ignored mutants", () => {
  const counts = mutationCounts([{ status: "Killed" }, { status: "Timeout" }, { status: "Survived" }, { status: "Ignored" }]);
  assert.equal(counts.score_pct, 66.67);
  assert.equal(counts.ignored, 1);
});

test("weak-test canary passes coverage but fails mutation effectiveness", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "coverage", "coverage-summary.json"), JSON.stringify({ total: { lines: { total: 5, covered: 5, pct: 100 }, branches: { total: 2, covered: 2, pct: 100 } }, "src/weak.js": { lines: { total: 5, covered: 5, pct: 100 }, branches: { total: 2, covered: 2, pct: 100 } } }));
  fs.writeFileSync(path.join(root, "reports", "mutation", "mutation.json"), JSON.stringify({ files: { "src/weak.js": { mutants: [{ status: "Survived" }] } } }));
  const config = { coverage: { enabled: true, report_path: "coverage/coverage-summary.json", minimum_lines_pct: 80, minimum_branches_pct: 70, minimum_changed_lines_pct: 90, minimum_changed_branches_pct: 80, severity: "warn" }, mutation: { enabled: true, report_path: "reports/mutation/mutation.json", minimum_score_pct: 70, minimum_changed_score_pct: 80, maximum_changed_survivors: 0, maximum_changed_no_coverage: 0, severity: "warn" } };
  assert.equal(checkCoverage(root, ["src/weak.js"], { config }).status, "pass");
  const mutation = checkMutation(root, ["src/weak.js"], { config });
  assert.equal(mutation.status, "warn");
  assert.equal(mutation.metrics.changed_survivors, 1);
});

test("test-integrity sensor detects assertion deletion against HEAD", () => {
  const root = fixture();
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "tests", "app.test.js"), "test('value', () => {\n  assert.equal(value(), 2);\n});\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "tested baseline"]);
  fs.writeFileSync(path.join(root, "tests", "app.test.js"), "test('value', () => {\n  value();\n});\n");
  const result = checkTestIntegrity(root, ["tests/app.test.js"], { config: { test_integrity: { enabled: true, severity: "warn", test_path_pattern: "(^|/)tests/|\\.test\\." } } });
  assert.equal(result.status, "warn");
  assert.equal(result.metrics.net_assertion_removal, 1);
});

test("property and fuzz adapters normalize cases and failures", () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(path.join(root, "reports", "property.json"), JSON.stringify({ summary: { runs: 250, failures: 0 } }));
  fs.writeFileSync(path.join(root, "reports", "fuzz.json"), JSON.stringify({ executions: 500, crashes: 1 }));
  const property = checkGenerative(root, "property", { config: { property: { enabled: true, report_path: "reports/property.json", minimum_cases: 100, maximum_failures: 0, severity: "warn" } } });
  const fuzz = checkGenerative(root, "fuzz", { config: { fuzz: { enabled: true, report_path: "reports/fuzz.json", minimum_cases: 1000, maximum_failures: 0, severity: "warn" } } });
  assert.equal(property.status, "pass");
  assert.equal(fuzz.status, "warn");
  assert.equal(fuzz.metrics.failures, 1);
});

test("incremental regression runner executes configured command and evaluates its report", () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, ".claude", "project"), { recursive: true });
  const program = "require('fs').writeFileSync('coverage/coverage-summary.json', JSON.stringify({total:{lines:{total:1,covered:1,pct:100},branches:{total:0,covered:0,pct:100}},'src/app.js':{lines:{total:1,covered:1,pct:100},branches:{total:0,covered:0,pct:100}}}))";
  fs.writeFileSync(path.join(root, ".claude", "project", "regression-sensors.json"), JSON.stringify({ version: 1, coverage: { enabled: true, command: process.execPath, args: ["-e", program], changed_args: [] } }));
  execFileSync(process.execPath, [regressionRunner, root, "--kind", "coverage", "--changed", "src/app.js"], { encoding: "utf8" });
  const receipt = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "regression-execution.json"), "utf8"));
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.metrics.changed_lines_pct, 100);
});
