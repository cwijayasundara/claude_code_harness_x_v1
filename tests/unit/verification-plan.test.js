const assert = require("node:assert/strict");
const test = require("node:test");
const { validateVerificationPlan } = require("../../.claude/lib/verification-plan");

function plan() {
  const checks = ["install-build", "unit", "integration", "hermetic-system", "local-smoke", "lint", "type", "security"].map((kind) => ({
    id: kind, label: kind, cadence: "pre-pr", kind, configured: true, command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1000,
    ...(["unit", "integration", "hermetic-system", "local-smoke"].includes(kind) ? { hermetic: true, boundary_ids: ["postgres"] } : {}),
    ...(kind === "local-smoke" ? { public_seam: "HTTP /health", safe_local_config: "APP_ENV=test with doubled boundaries", journeys: [{ id: "healthy", type: "success" }, { id: "invalid", type: "failure" }] } : {}),
  }));
  checks.push({ id: "postgres-contract", label: "Postgres contract", cadence: "pre-pr", kind: "contract", configured: true, command: "node", args: ["-e", "process.exit(0)"], timeout_ms: 1000 });
  return { version: 1, checks, boundaries: [{ id: "postgres", kind: "database", production_dependency: "PostgreSQL", test_double: "ephemeral-postgresql", contract_check_id: "postgres-contract" }], performance_budgets: [{ id: "smoke-latency", check_id: "local-smoke", metric: "duration_ms", maximum: 1000, scope: "local health journey" }] };
}

test("accepts a complete hermetic pre-PR verification contract", () => {
  assert.deepEqual(validateVerificationPlan(plan()), []);
});

test("requires all responsible local-engineer checks", () => {
  const candidate = plan();
  candidate.checks = candidate.checks.filter((check) => check.kind !== "local-smoke");
  assert.match(validateVerificationPlan(candidate).join("\n"), /pre-pr requires a 'local-smoke'/);
});

test("rejects an in-memory PostgreSQL double without explicit semantic limits", () => {
  const candidate = plan();
  candidate.boundaries[0].test_double = "in-memory";
  assert.match(validateVerificationPlan(candidate).join("\n"), /requires postgres_semantics_required=false/);
});

test("accepts a configured hermetic browser E2E check with success and failure journeys", () => {
  const candidate = plan();
  candidate.checks.push({
    id: "browser-journeys", label: "Browser journeys", cadence: "pre-pr", kind: "browser-e2e", configured: true,
    command: "npx", args: ["playwright", "test"], timeout_ms: 60000, hermetic: true, boundary_ids: ["postgres"],
    public_seam: "web UI", safe_local_config: "ephemeral app and database",
    journeys: [{ id: "happy", type: "success" }, { id: "invalid", type: "failure" }],
  });
  assert.deepEqual(validateVerificationPlan(candidate), []);
});
