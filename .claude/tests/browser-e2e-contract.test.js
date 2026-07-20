const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateBrowserE2E, validateFeatureSurfaces } = require("../lib/browser-e2e-contract");

function rootWithPlan(checks = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-contract-"));
  fs.mkdirSync(path.join(root, ".claude"));
  const required = ["install-build", "unit", "integration", "hermetic-system", "local-smoke", "lint", "type", "security"].map((kind) => ({
    id: kind, label: kind, cadence: "pre-pr", kind, configured: true, command: process.execPath,
    args: ["-e", "process.exit(0)"], timeout_ms: 5000,
    ...(["unit", "integration", "hermetic-system", "local-smoke"].includes(kind) ? { hermetic: true, boundary_ids: [] } : {}),
    ...(kind === "local-smoke" ? { public_seam: "local seam", safe_local_config: "doubled", journeys: [{ id: "ok", type: "success" }, { id: "bad", type: "failure" }] } : {}),
  }));
  fs.writeFileSync(path.join(root, ".claude", "verification.json"), JSON.stringify({ version: 1, checks: [...required, ...checks], boundaries: [], performance_budgets: [] }));
  return root;
}

function browserCheck(overrides = {}) {
  return {
    id: "browser-journeys", label: "Browser journeys", cadence: "pre-pr", kind: "browser-e2e",
    configured: true, hermetic: true, boundary_ids: [], command: process.execPath,
    args: ["-e", "process.exit(0)"], timeout_ms: 5000, public_seam: "web UI",
    safe_local_config: "local API with doubles", journeys: [{ id: "happy", type: "success" }, { id: "invalid", type: "failure" }],
    ...overrides,
  };
}

function records(contract, links) {
  return [
    { id: "P1", package: "plans", status: "draft", body: { content: contract } },
    { id: "T1", package: "traceability", status: "draft", body: { content: { links } } },
  ];
}

test("feature surfaces are explicit and bounded", () => {
  assert.deepEqual(validateFeatureSurfaces({ feature_surfaces: ["ui", "api"] }), []);
  assert.match(validateFeatureSurfaces({ feature_surfaces: [] }).join("\n"), /non-empty/);
  assert.match(validateFeatureSurfaces({ feature_surfaces: ["desktop"] }).join("\n"), /unknown surface/);
});

test("UI plus API requires configured browser E2E and browser trace coverage", () => {
  const root = rootWithPlan([browserCheck()]);
  const contract = { story_id: "S1", feature_surfaces: ["ui", "api"], browser_e2e_required: true, browser_e2e_tool: "playwright" };
  const links = [{ story_id: "S1", level: "browser-e2e", disposition: "planned-automated", verification_check_id: "browser-journeys" }];
  const result = validateBrowserE2E(root, records(contract, links), (record) => record.body);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.required_story_ids, ["S1"]);
});

test("UI story fails closed without browser check or mapped trace", () => {
  const root = rootWithPlan([]);
  const contract = { story_id: "S1", feature_surfaces: ["ui"], browser_e2e_required: false };
  const result = validateBrowserE2E(root, records(contract, []), (record) => record.body);
  assert.match(result.errors.join("\n"), /browser_e2e_required/);
  assert.match(result.errors.join("\n"), /exactly one pre-pr browser-e2e/);
  assert.match(result.errors.join("\n"), /browser-e2e trace link/);
});

test("non-Playwright browser tool requires human-readable equivalence rationale", () => {
  const root = rootWithPlan([browserCheck()]);
  const contract = { story_id: "S1", feature_surfaces: ["ui"], browser_e2e_required: true, browser_e2e_tool: "cypress" };
  const links = [{ story_id: "S1", level: "browser-e2e", disposition: "planned-automated", verification_check_id: "browser-journeys" }];
  assert.match(validateBrowserE2E(root, records(contract, links), (record) => record.body).errors.join("\n"), /equivalent.rationale/);
  contract.browser_e2e_equivalent = { rationale: "Cypress drives the same approved success and failure journeys." };
  assert.deepEqual(validateBrowserE2E(root, records(contract, links), (record) => record.body).errors, []);
});

test("non-UI stories do not acquire a browser requirement", () => {
  const root = rootWithPlan([]);
  const result = validateBrowserE2E(root, records({ story_id: "S1", feature_surfaces: ["api"] }, []), (record) => record.body);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.required_story_ids, []);
});
