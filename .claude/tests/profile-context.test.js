const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  engineeringCorePack,
  resolveProfiles,
  validateManifest,
} = require("../lib/profile-context");

const pluginRoot = path.resolve(__dirname, "..");

function profile(root, manifest) {
  const directory = path.join(root, ".claude", "profiles", manifest.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    version: 1,
    guide: "guide.md",
    requires: [],
    extensions: [],
    content_signals: [],
    path_signals: [],
    ...manifest,
  }));
  fs.writeFileSync(path.join(directory, "guide.md"), `# ${manifest.id}\n`);
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "profile-context-"));
  profile(root, { id: "python", layer: "language", extensions: [".py"] });
  profile(root, {
    id: "python-fastapi",
    layer: "framework",
    requires: ["python"],
    extensions: [".py"],
    content_signals: ["from fastapi"],
    path_signals: ["/routers/"],
  });
  profile(root, {
    id: "langgraph",
    layer: "framework",
    requires: ["python"],
    extensions: [".py"],
    content_signals: ["from langgraph"],
    path_signals: ["/graphs/"],
  });
  fs.mkdirSync(path.join(root, "app"));
  return root;
}

test("loads language before only the framework signalled by the changed path", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "app", "api.py"), "from fastapi import APIRouter\n");
  const result = resolveProfiles(root, {
    configuredProfiles: ["python-fastapi", "langgraph"],
    changedPaths: ["app/api.py"],
    pluginRoot,
  });
  assert.deepEqual(result.profiles.map((item) => item.id), ["python", "python-fastapi"]);
  assert.match(result.profiles[0].reason, /language-extension/);
  assert.deepEqual(result.frameworks, ["python-fastapi"]);
  assert.ok(result.engineering_core.references.some((ref) => ref.includes("tdd.md")));
});

test("does not load framework context for plain language code", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "app", "domain.py"), "class CapitalCall:\n    pass\n");
  const result = resolveProfiles(root, {
    configuredProfiles: ["python-fastapi", "langgraph", "python"],
    changedPaths: ["app/domain.py"],
  });
  assert.deepEqual(result.profiles.map((item) => item.id), ["python"]);
  assert.deepEqual(result.frameworks, []);
});

test("an explicit hint must be enabled and still loads its language dependency", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "app", "workflow.py"), "pass\n");
  const selected = resolveProfiles(root, {
    configuredProfiles: ["langgraph"],
    changedPaths: ["app/workflow.py"],
    hints: ["langgraph"],
  });
  assert.deepEqual(selected.profiles.map((item) => item.id), ["python", "langgraph"]);
  assert.throws(
    () => resolveProfiles(root, {
      configuredProfiles: ["python-fastapi"],
      changedPaths: ["app/workflow.py"],
      hints: ["langgraph"],
    }),
    /not enabled/
  );
});

test("rejects paths outside the project", () => {
  const root = project();
  assert.throws(
    () => resolveProfiles(root, { configuredProfiles: ["python"], changedPaths: ["../escape.py"] }),
    /outside the project/
  );
});

test("framework manifests without signals are rejected", () => {
  const errors = validateManifest({
    version: 1,
    id: "weird-fw",
    layer: "framework",
    guide: "guide.md",
    requires: ["python"],
    extensions: [".py"],
    content_signals: [],
    path_signals: [],
  }, "weird-fw");
  assert.match(errors.join("\n"), /content_signals and\/or path_signals/);
});

test("caps concurrent framework profiles and reports drops", () => {
  const root = project();
  fs.writeFileSync(
    path.join(root, "app", "combo.py"),
    "from fastapi import APIRouter\nfrom langgraph.graph import StateGraph\n"
  );
  const result = resolveProfiles(root, {
    configuredProfiles: ["python-fastapi", "langgraph"],
    changedPaths: ["app/combo.py"],
    maxFrameworkProfiles: 1,
  });
  assert.equal(result.frameworks.length, 1);
  assert.equal(result.dropped_frameworks.length, 1);
  assert.ok(result.languages.includes("python"));
});

test("engineeringCorePack lists progressive references from the plugin", () => {
  const pack = engineeringCorePack(pluginRoot);
  assert.match(pack.skill, /harness-engineering-core/);
  assert.ok(pack.references.length >= 5);
  assert.ok(pack.references.every((ref) => ref.endsWith(".md")));
});
