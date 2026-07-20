const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { REQUIRED_CAPABILITIES, loadGuideCatalog, resolveGuides, validateGuideCatalog } = require("../lib/feedforward-guides");
const templateRoot = path.resolve(__dirname, "../templates/project");

test("template catalog covers every Fowler feedforward capability", () => {
  const { catalog } = loadGuideCatalog(templateRoot);
  assert.deepEqual(validateGuideCatalog(templateRoot, catalog), []);
  const covered = new Set(catalog.guides.flatMap((guide) => guide.capabilities));
  assert.deepEqual([...REQUIRED_CAPABILITIES].filter((item) => !covered.has(item)), []);
});

test("resolver distinguishes required guides from computational adapters", () => {
  const { catalog } = loadGuideCatalog(templateRoot);
  const absent = resolveGuides(templateRoot, catalog, { paths: ["src/app.ts"], needs: ["code-intelligence"] });
  assert.equal(absent.find((guide) => guide.id === "code-intelligence").available, false);
  assert.ok(absent.some((guide) => guide.id === "project-entrypoint" && guide.required));
  const present = resolveGuides(templateRoot, catalog, { paths: ["src/app.ts"], needs: ["code-intelligence"], availableCapabilities: ["lsp"] });
  assert.equal(present.find((guide) => guide.id === "code-intelligence").available, true);
});

test("catalog validation rejects a missing required capability", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "feedforward-guides-"));
  fs.writeFileSync(path.join(target, "CLAUDE.md"), "# guide\n");
  const catalog = { version: 1, guides: [{ id: "only-principles", execution_type: "inferential", capabilities: ["principles"], resource: { type: "file", value: "CLAUDE.md" }, selection: { mode: "always" } }] };
  assert.ok(validateGuideCatalog(target, catalog).some((error) => error.includes("codemods")));
});
