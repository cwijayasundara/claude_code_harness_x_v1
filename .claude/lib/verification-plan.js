const fs = require("node:fs");
const path = require("node:path");

const CADENCES = new Set(["story-fast", "pre-pr", "scheduled"]);
const KINDS = new Set(["install-build", "unit", "integration", "contract", "hermetic-system", "local-smoke", "browser-e2e", "lint", "type", "security", "migration", "performance", "other"]);
const REQUIRED_PRE_PR_KINDS = ["install-build", "unit", "integration", "hermetic-system", "local-smoke", "lint", "type", "security"];
const EXTERNAL_KINDS = new Set(["database", "llm", "embedding", "http", "queue", "filesystem", "clock", "other"]);
const DOUBLE_TYPES = new Set(["stub", "fake", "in-memory", "ephemeral-postgresql", "local-emulator"]);

function loadVerificationPlan(root) {
  const planPath = path.join(path.resolve(root), ".claude", "verification.json");
  if (!fs.existsSync(planPath)) throw new Error(`Missing ${planPath}.`);
  let plan;
  try { plan = JSON.parse(fs.readFileSync(planPath, "utf8")); }
  catch (error) { throw new Error(`Unable to parse ${planPath}: ${error.message}`); }
  return { plan, planPath };
}

function validateVerificationPlan(plan) {
  const errors = [];
  if (plan.version !== 1) errors.push("verification.version must be 1.");
  if (!Array.isArray(plan.checks)) errors.push("verification.checks must be an array.");
  if (!Array.isArray(plan.boundaries)) errors.push("verification.boundaries must be an array.");
  if (!Array.isArray(plan.performance_budgets)) errors.push("verification.performance_budgets must be an array.");
  if (errors.length) return errors;
  const ids = new Set();
  const boundaryIds = new Set();
  for (const [index, boundary] of plan.boundaries.entries()) {
    const label = `boundaries[${index}]`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(boundary.id || "")) errors.push(`${label}.id must be kebab-case.`);
    else if (boundaryIds.has(boundary.id)) errors.push(`${label}.id duplicates '${boundary.id}'.`);
    else boundaryIds.add(boundary.id);
    if (!EXTERNAL_KINDS.has(boundary.kind)) errors.push(`${label}.kind is invalid.`);
    if (!DOUBLE_TYPES.has(boundary.test_double)) errors.push(`${label}.test_double is invalid.`);
    if (!boundary.production_dependency) errors.push(`${label}.production_dependency is required.`);
    if (!boundary.contract_check_id) errors.push(`${label}.contract_check_id is required.`);
    if (boundary.kind === "database" && /postgres/i.test(boundary.production_dependency) && boundary.test_double === "in-memory") {
      if (boundary.postgres_semantics_required !== false || !Array.isArray(boundary.semantic_caveats) || boundary.semantic_caveats.length === 0) {
        errors.push(`${label}: an in-memory PostgreSQL double requires postgres_semantics_required=false and explicit semantic_caveats; otherwise use ephemeral-postgresql.`);
      }
    }
  }
  for (const [index, check] of plan.checks.entries()) {
    const label = `checks[${index}]`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(check.id || "")) errors.push(`${label}.id must be kebab-case.`);
    else if (ids.has(check.id)) errors.push(`${label}.id duplicates '${check.id}'.`);
    else ids.add(check.id);
    if (!CADENCES.has(check.cadence)) errors.push(`${label}.cadence is invalid.`);
    if (!KINDS.has(check.kind)) errors.push(`${label}.kind is invalid.`);
    if (check.configured !== true && check.configured !== false) errors.push(`${label}.configured must be boolean.`);
    if (check.configured) {
      if (typeof check.command !== "string" || !check.command) errors.push(`${label}.command is required when configured.`);
      if (!Array.isArray(check.args) || check.args.some((arg) => typeof arg !== "string")) errors.push(`${label}.args must be a string array.`);
      if (!Number.isInteger(check.timeout_ms) || check.timeout_ms < 100 || check.timeout_ms > 3600000) errors.push(`${label}.timeout_ms must be 100..3600000.`);
    } else if (!check.configuration_help) errors.push(`${label}.configuration_help is required while unconfigured.`);
    if (["unit", "integration", "hermetic-system", "local-smoke", "browser-e2e"].includes(check.kind)) {
      if (check.hermetic !== true) errors.push(`${label} must declare hermetic=true.`);
      if (!Array.isArray(check.boundary_ids)) errors.push(`${label}.boundary_ids must be an array.`);
    }
    if (["local-smoke", "browser-e2e"].includes(check.kind)) {
      if (!check.public_seam) errors.push(`${label}.public_seam is required.`);
      if (!check.safe_local_config) errors.push(`${label}.safe_local_config is required.`);
      if (!Array.isArray(check.journeys) || !check.journeys.some((journey) => journey.type === "success") || !check.journeys.some((journey) => journey.type === "failure")) {
        errors.push(`${label}.journeys must include at least one approved success and failure journey.`);
      }
    }
  }
  for (const required of REQUIRED_PRE_PR_KINDS) {
    if (!plan.checks.some((check) => check.cadence === "pre-pr" && check.kind === required)) errors.push(`pre-pr requires a '${required}' check.`);
  }
  for (const check of plan.checks) for (const boundaryId of check.boundary_ids || []) if (!boundaryIds.has(boundaryId)) errors.push(`Check '${check.id}' references unknown boundary '${boundaryId}'.`);
  for (const check of plan.checks.filter((item) => item.kind === "hermetic-system" || item.kind === "local-smoke" || item.kind === "browser-e2e")) for (const boundaryId of boundaryIds) {
    if (!check.boundary_ids.includes(boundaryId)) errors.push(`Hermetic '${check.kind}' check '${check.id}' does not double declared boundary '${boundaryId}'.`);
  }
  for (const boundary of plan.boundaries) if (!ids.has(boundary.contract_check_id)) errors.push(`Boundary '${boundary.id}' references unknown contract check '${boundary.contract_check_id}'.`);
  for (const [index, budget] of plan.performance_budgets.entries()) {
    const label = `performance_budgets[${index}]`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(budget.id || "")) errors.push(`${label}.id must be kebab-case.`);
    if (!ids.has(budget.check_id)) errors.push(`${label}.check_id references unknown check '${budget.check_id}'.`);
    if (budget.metric !== "duration_ms") errors.push(`${label}.metric currently supports only duration_ms.`);
    if (typeof budget.maximum !== "number" || budget.maximum <= 0) errors.push(`${label}.maximum must be positive.`);
    if (!budget.scope) errors.push(`${label}.scope is required.`);
  }
  return errors;
}

module.exports = { CADENCES, KINDS, REQUIRED_PRE_PR_KINDS, loadVerificationPlan, validateVerificationPlan };
