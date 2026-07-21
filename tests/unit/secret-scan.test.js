const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { scanSecrets, runGitleaks } = require("../../.claude/lib/secret-scan");

test("finds known credential patterns only in the requested files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-scan-"));
  fs.writeFileSync(path.join(root, "safe.js"), "const token = process.env.TOKEN;\n");
  fs.writeFileSync(path.join(root, "unsafe.js"), "const apiKey = 'abcdefghijk';\n");

  assert.deepEqual(scanSecrets(root, ["safe.js"]), []);
  assert.equal(scanSecrets(root, ["unsafe.js"])[0].name, "Hard-coded credential assignment");
});

test("recognizes additional provider tokens", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-providers-"));
  const syntheticToken = ["glpat", "abcdefghijklmnopqrstuvwxyz"].join("-");
  fs.writeFileSync(path.join(root, "unsafe.env"), `GITLAB_TOKEN=${syntheticToken}\n`);
  assert.equal(scanSecrets(root, ["unsafe.env"])[0].name, "GitLab token");
});

test("reports unavailable Gitleaks distinctly from a clean scan", () => {
  const previousPath = process.env.PATH;
  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), "no-gitleaks-"));
  try {
    assert.equal(runGitleaks(os.tmpdir()).status, "unavailable");
  } finally {
    process.env.PATH = previousPath;
  }
});
