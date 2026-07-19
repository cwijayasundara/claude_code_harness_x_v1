const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  checkFileSizes,
  checkNearDuplication,
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

test("loadMaintainabilityConfig uses defaults when file missing", () => {
  const root = tempProject();
  const loaded = loadMaintainabilityConfig(root);
  assert.equal(loaded.defaults, true);
  assert.equal(loaded.config.file_size.max_lines, 300);
});
