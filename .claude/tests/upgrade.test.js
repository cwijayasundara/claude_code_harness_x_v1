const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mergeHarnessManifest,
  planUpgrade,
  applyUpgrade,
} = require("../lib/harness-upgrade");

const pluginRoot = path.resolve(__dirname, "..");
const initializer = path.join(pluginRoot, "scripts", "harness-init.js");
const upgrader = path.join(pluginRoot, "scripts", "harness-upgrade.js");

test("upgrade previews and adds only missing harness files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-upgrade-"));
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Local guidance\n");
  execFileSync(process.execPath, [upgrader, "--target", root], { cwd: pluginRoot });
  let report = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "harness-upgrade.json"), "utf8"));
  assert.equal(report.mode, "preview");
  assert.ok(report.actions.some((item) => item.action === "create"));

  execFileSync(process.execPath, [upgrader, "--target", root, "--apply"], { cwd: pluginRoot });
  report = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "harness-upgrade.json"), "utf8"));
  assert.equal(report.mode, "applied");
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "# Local guidance\n");
  assert.ok(fs.existsSync(path.join(root, ".claude", "harness-install.json")));
  assert.ok(fs.existsSync(path.join(root, ".claude", "project", "maintainability.json")));

  const receipt = JSON.parse(fs.readFileSync(path.join(root, ".claude", "harness-install.json"), "utf8"));
  assert.equal(receipt.installed_plugin, "lean-expert-generalist-harness");
});

test("initializer creates an installation receipt without replacing it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-install-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot });
  const receiptPath = path.join(root, ".claude", "harness-install.json");
  const original = fs.readFileSync(receiptPath, "utf8");
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot });
  assert.equal(fs.readFileSync(receiptPath, "utf8"), original);
});

test("mergeHarnessManifest adds file-size and near-duplication without clobbering customs", () => {
  const template = JSON.parse(fs.readFileSync(
    path.join(pluginRoot, "templates", "project", ".claude", "harness-manifest.json"),
    "utf8"
  ));
  const old = {
    version: 1,
    control_budget: {
      max_active: 12,
      baseline_ids: [
        "delivery-workflow",
        "structured-requirements",
        "profile-verification",
        "independent-evaluation",
        "destructive-git-safety",
        "secret-scan",
        "architecture-boundaries",
        "ci-verification",
        "static-security-analysis",
      ],
    },
    controls: template.controls
      .filter((c) => !["file-size", "near-duplication"].includes(c.id))
      .map((c) => (c.id === "secret-scan"
        ? { ...c, owner: "Local security team" }
        : structuredClone(c))),
  };

  const merge = mergeHarnessManifest(old, template);
  assert.equal(merge.changed, true);
  assert.ok(merge.added_controls.includes("file-size"));
  assert.ok(merge.added_controls.includes("near-duplication"));
  assert.ok(merge.manifest.control_budget.baseline_ids.includes("file-size"));
  assert.ok(merge.manifest.control_budget.max_active >= 18);
  const secret = merge.manifest.controls.find((c) => c.id === "secret-scan");
  assert.equal(secret.owner, "Local security team");
  assert.ok(merge.manifest.controls.some((c) => c.id === "file-size"));
});

test("applyUpgrade merges maintainability controls into an already-initialized project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-upgrade-merge-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot });

  // Simulate pre-maintainability install: strip new controls and delete config.
  const manifestPath = path.join(root, ".claude", "harness-manifest.json");
  const template = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const stripped = {
    ...template,
    control_budget: {
      max_active: 12,
      baseline_ids: template.control_budget.baseline_ids.filter(
        (id) => !["file-size", "near-duplication"].includes(id)
      ),
    },
    controls: template.controls.filter((c) => !["file-size", "near-duplication"].includes(c.id)),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(stripped, null, 2)}\n`);
  fs.unlinkSync(path.join(root, ".claude", "project", "maintainability.json"));

  const preview = planUpgrade(root, pluginRoot);
  assert.equal(preview.mode, "preview");
  assert.ok(preview.actions.some((a) => a.path.includes("maintainability") && a.action === "create"));
  assert.ok(preview.actions.some((a) => a.action === "merge-controls"));

  const applied = applyUpgrade(root, pluginRoot);
  assert.equal(applied.mode, "applied");
  assert.equal(applied.applied.maintainability.action, "create");
  assert.equal(applied.applied.manifest.action, "merged");
  assert.ok(applied.applied.manifest.added_controls.includes("file-size"));
  assert.ok(applied.applied.manifest.added_controls.includes("near-duplication"));
  assert.ok(fs.existsSync(path.join(root, ".claude", "project", "maintainability.json")));

  const after = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok(after.controls.some((c) => c.id === "file-size"));
  assert.ok(after.controls.some((c) => c.id === "near-duplication"));
  assert.ok(after.control_budget.baseline_ids.includes("near-duplication"));

  // Second apply is a no-op merge.
  const again = applyUpgrade(root, pluginRoot);
  assert.equal(again.applied.manifest.action, "preserve");
  assert.equal(again.applied.maintainability.action, "preserve");
});
