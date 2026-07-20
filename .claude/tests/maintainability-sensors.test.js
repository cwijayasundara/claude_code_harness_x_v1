const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  checkFileSizes,
  checkFunctionSizes,
  checkCodeComplexity,
  checkExceptionHandling,
  checkLoggingDiscipline,
  checkPerformanceHeuristics,
  checkNearDuplication,
  runAllMaintainabilitySensors,
  loadMaintainabilityConfig,
} = require("../lib/maintainability-sensors");

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maint-sensors-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude", "project"), { recursive: true });
  return root;
}

test("file-size fails when a source file exceeds max_lines", () => {
  const root = tempProject();
  fs.writeFileSync(
    path.join(root, ".claude", "project", "maintainability.json"),
    JSON.stringify({
      version: 1,
      file_size: { max_lines: 10, warn_lines: 8, extensions: [".js"] },
      duplication: { min_block_lines: 50, severity: "warn" },
    })
  );
  const big = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`).join("\n");
  fs.writeFileSync(path.join(root, "src", "big.js"), `${big}\n`);
  const result = checkFileSizes(root, ["src/big.js"]);
  assert.equal(result.status, "fail");
  assert.ok(result.affectedPaths.includes("src/big.js"));
  assert.match(result.reason, /20 lines/);
});

test("file-size warns between warn_lines and max_lines", () => {
  const root = tempProject();
  fs.writeFileSync(
    path.join(root, ".claude", "project", "maintainability.json"),
    JSON.stringify({
      version: 1,
      file_size: { max_lines: 20, warn_lines: 5, extensions: [".js"] },
    })
  );
  fs.writeFileSync(path.join(root, "src", "mid.js"), "a\nb\nc\nd\ne\nf\ng\n");
  const result = checkFileSizes(root, ["src/mid.js"]);
  assert.equal(result.status, "warn");
});

test("near-duplication detects copied blocks across files", () => {
  const root = tempProject();
  fs.writeFileSync(
    path.join(root, ".claude", "project", "maintainability.json"),
    JSON.stringify({
      version: 1,
      duplication: {
        min_block_lines: 6,
        min_occurrences: 2,
        severity: "warn",
        extensions: [".js"],
        ignore_path_parts: ["node_modules"],
      },
    })
  );
  const block = [
    "function parseAmount(value) {",
    "  const cleaned = String(value).replace(/[$,]/g, \"\");",
    "  const negative = cleaned.includes(\"(\");",
    "  const numeric = Number(cleaned.replace(/[()]/g, \"\"));",
    "  if (Number.isNaN(numeric)) throw new Error(\"bad amount\");",
    "  return negative ? -Math.abs(numeric) : numeric;",
    "}",
  ].join("\n");
  fs.writeFileSync(path.join(root, "src", "a.js"), `${block}\nexports.a = parseAmount;\n`);
  fs.writeFileSync(path.join(root, "src", "b.js"), `${block}\nexports.b = parseAmount;\n`);
  const result = checkNearDuplication(root, ["src/a.js", "src/b.js"]);
  assert.equal(result.status, "warn");
  assert.ok(result.findings.length >= 1);
  assert.ok(result.affectedPaths.includes("src/a.js"));
  assert.ok(result.affectedPaths.includes("src/b.js"));
});

test("near-duplication compares changed code with unchanged repository code", () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, ".claude", "project", "maintainability.json"), JSON.stringify({
    version: 1,
    duplication: { min_block_lines: 6, min_occurrences: 2, severity: "warn", extensions: [".js"], ignore_path_parts: ["node_modules"] },
  }));
  const block = [
    "function normalize(value) {", "  const text = String(value);", "  const trimmed = text.trim();",
    "  if (!trimmed) throw new Error('empty');", "  const lowered = trimmed.toLowerCase();",
    "  return lowered.replace(/\\s+/g, '-');", "}",
  ].join("\n");
  fs.writeFileSync(path.join(root, "src", "canonical.js"), `${block}\n`);
  fs.writeFileSync(path.join(root, "src", "changed.js"), `${block}\n`);
  const result = checkNearDuplication(root, ["src/changed.js"]);
  assert.equal(result.status, "warn");
  assert.ok(result.affectedPaths.includes("src/canonical.js"));
  assert.ok(result.affectedPaths.includes("src/changed.js"));
});

test("loadMaintainabilityConfig uses defaults when file missing", () => {
  const root = tempProject();
  const loaded = loadMaintainabilityConfig(root);
  assert.equal(loaded.defaults, true);
  assert.equal(loaded.config.file_size.max_lines, 300);
  assert.equal(loaded.config.function_size.max_lines, 30);
});

test("function-size fails when a function exceeds max_lines", () => {
  const root = tempProject();
  fs.writeFileSync(
    path.join(root, ".claude", "project", "maintainability.json"),
    JSON.stringify({
      version: 1,
      function_size: { max_lines: 5, warn_lines: 4, severity: "fail", extensions: [".js"] },
    })
  );
  const body = [
    "function big() {",
    ...Array.from({ length: 10 }, (_, i) => `  const x${i} = ${i};`),
    "  return x0;",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "src", "fn.js"), body);
  const result = checkFunctionSizes(root, ["src/fn.js"]);
  assert.equal(result.status, "fail");
  assert.match(result.reason, /big/);
});

test("code-complexity reports excessive arguments and branching", () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, ".claude", "project", "maintainability.json"), JSON.stringify({
    version: 1,
    code_complexity: { max_arguments: 3, warn_arguments: 2, max_cyclomatic: 3, warn_cyclomatic: 2, severity: "fail", extensions: [".js"] },
  }));
  fs.writeFileSync(path.join(root, "src", "complex.js"), [
    "function decide(a, b, c, d) {", "  if (a) return b;", "  if (c && d) return c;", "  return d;", "}", "",
  ].join("\n"));
  const result = checkCodeComplexity(root, ["src/complex.js"]);
  assert.equal(result.status, "fail");
  assert.match(result.reason, /arguments/);
  assert.match(result.reason, /cyclomatic/);
});

test("exception-handling fails on empty catch", () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, "src", "bad.js"), "try { f(); } catch (e) {}\n");
  const result = checkExceptionHandling(root, ["src/bad.js"]);
  assert.equal(result.status, "fail");
  assert.match(result.reason, /empty catch/i);
});

test("logging-discipline warns on catch without log or rethrow", () => {
  const root = tempProject();
  fs.writeFileSync(
    path.join(root, "src", "silent.js"),
    "try {\n  f();\n} catch (e) {\n  x = 1;\n}\n"
  );
  const result = checkLoggingDiscipline(root, ["src/silent.js"]);
  assert.notEqual(result.status, "pass");
  assert.match(result.reason, /log|Logging/i);
});

test("performance-heuristics warns on nested loops", () => {
  const root = tempProject();
  fs.writeFileSync(
    path.join(root, "src", "nested.js"),
    "function scan(a, b) {\n  for (const x of a) {\n    for (const y of b) {\n      use(x, y);\n    }\n  }\n}\n"
  );
  const result = checkPerformanceHeuristics(root, ["src/nested.js"]);
  assert.equal(result.status, "warn");
  assert.match(result.reason, /nested/i);
});

test("runAllMaintainabilitySensors returns the full craft suite", () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, "src", "ok.js"), "function ok() {\n  return 1;\n}\n");
  const suite = runAllMaintainabilitySensors(root, ["src/ok.js"]);
  const ids = suite.map((item) => item.sensorId);
  assert.deepEqual(ids, [
    "file-size",
    "function-size",
    "code-complexity",
    "exception-handling",
    "logging-discipline",
    "performance-heuristics",
    "near-duplication",
  ]);
});
