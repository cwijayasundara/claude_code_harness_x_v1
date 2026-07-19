const fs = require("node:fs");
const path = require("node:path");

const axes = new Set(["maintainability", "architecture", "behaviour", "security", "traceability"]);
const kinds = new Set(["guide", "sensor"]);
const cadences = new Set(["planning", "session", "pre-commit", "ci", "scheduled"]);
const severities = new Set(["advisory", "blocking"]);
const statuses = new Set(["active", "planned", "retired"]);
const directions = new Set(["feedforward", "feedback"]);
const executionTypes = new Set(["computational", "inferential", "human"]);
const regulationDimensions = new Set(["maintainability", "architecture-fitness", "behaviour"]);

function loadControlManifest(root, manifestPath = ".claude/harness-manifest.json") {
  const resolvedPath = path.resolve(root, manifestPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Missing control manifest: ${resolvedPath}. Run harness-init or restore the project control manifest.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse control manifest ${resolvedPath}: ${error.message}`);
  }

  return { manifestPath: resolvedPath, manifest };
}

function activeControls(manifest) {
  if (!manifest || !Array.isArray(manifest.controls)) return [];
  return manifest.controls.filter((control) => control && control.status === "active");
}

function validateControlBudget(manifest, errors) {
  const budget = manifest.control_budget;
  if (budget === undefined) {
    errors.push("control_budget is required (anti-v5 subtractive ratchet).");
    return;
  }
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    errors.push("control_budget must be an object.");
    return;
  }
  if (!Number.isInteger(budget.max_active) || budget.max_active < 1) {
    errors.push("control_budget.max_active must be a positive integer.");
  }
  if (!Array.isArray(budget.baseline_ids)) {
    errors.push("control_budget.baseline_ids must be an array of control ids (may be empty if every active control is a justified net-add).");
  } else if (budget.baseline_ids.some((id) => typeof id !== "string" || !id.trim())) {
    errors.push("control_budget.baseline_ids entries must be non-empty strings.");
  }

  const baseline = new Set(Array.isArray(budget.baseline_ids) ? budget.baseline_ids : []);
  const active = activeControls(manifest);
  const activeIds = new Set(active.map((control) => control.id).filter(Boolean));

  if (Number.isInteger(budget.max_active) && active.length > budget.max_active) {
    errors.push(
      `control_budget: ${active.length} active controls exceed max_active ${budget.max_active}. ` +
      "Retire a control or raise the ceiling only with a human-reviewed net-add justification."
    );
  }

  for (const id of baseline) {
    if (!activeIds.has(id) && Array.isArray(manifest.controls) &&
      !manifest.controls.some((control) => control && control.id === id && control.status === "retired")) {
      // Baseline may still be planned; only warn when the id is unknown entirely.
      if (!manifest.controls.some((control) => control && control.id === id)) {
        errors.push(`control_budget.baseline_ids references unknown control '${id}'.`);
      }
    }
  }

  for (const [index, control] of (manifest.controls || []).entries()) {
    if (!control || control.status !== "active") continue;
    const label = `controls[${index}]`;
    const isBaseline = baseline.has(control.id);
    const replaces = typeof control.replaces === "string" ? control.replaces.trim() : "";
    const justification = typeof control.net_add_justification === "string"
      ? control.net_add_justification.trim()
      : "";

    if (!isBaseline) {
      if (!justification && !replaces) {
        errors.push(
          `${label} ('${control.id}') is active but not in control_budget.baseline_ids; ` +
          "provide net_add_justification or replaces."
        );
      }
      if (justification === "" && replaces) {
        // replaces alone is enough when the replaced control is retired or absent from active set
      }
      if (replaces) {
        const replaced = (manifest.controls || []).find((item) => item && item.id === replaces);
        if (!replaced) {
          errors.push(`${label}.replaces references unknown control '${replaces}'.`);
        } else if (replaced.status === "active") {
          errors.push(`${label}.replaces '${replaces}' is still active; retire it first.`);
        }
      }
      if (!replaces && justification && justification.length < 12) {
        errors.push(`${label}.net_add_justification must explain the recurring failure (min 12 chars).`);
      }
    }
  }
}

function validateControlManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["Control manifest must be a JSON object."];
  }
  if (manifest.version !== 1) errors.push("Control manifest version must be 1.");
  if (!Array.isArray(manifest.controls) || manifest.controls.length === 0) {
    errors.push("Control manifest must declare at least one control.");
    return errors;
  }

  const ids = new Set();
  for (const [index, control] of manifest.controls.entries()) {
    const label = `controls[${index}]`;
    if (!control || typeof control !== "object" || Array.isArray(control)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    if (typeof control.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(control.id)) {
      errors.push(`${label}.id must be a kebab-case identifier.`);
    } else if (ids.has(control.id)) {
      errors.push(`${label}.id duplicates ${control.id}.`);
    } else {
      ids.add(control.id);
    }
    if (!kinds.has(control.kind)) errors.push(`${label}.kind must be guide or sensor.`);
    const expectedDirection = control.kind === "guide" ? "feedforward" : "feedback";
    if (!directions.has(control.direction)) {
      errors.push(`${label}.direction must be feedforward or feedback.`);
    } else if (control.kind && control.direction !== expectedDirection) {
      errors.push(`${label}.direction must be ${expectedDirection} for a ${control.kind}.`);
    }
    if (!executionTypes.has(control.execution_type)) {
      errors.push(`${label}.execution_type must be computational, inferential, or human.`);
    }
    if (!Array.isArray(control.regulates) || control.regulates.length === 0 ||
      control.regulates.some((dimension) => !regulationDimensions.has(dimension))) {
      errors.push(`${label}.regulates must be a non-empty array of: ${[...regulationDimensions].join(", ")}.`);
    }
    if (!axes.has(control.axis)) errors.push(`${label}.axis must be one of: ${[...axes].join(", ")}.`);
    if (!cadences.has(control.cadence)) errors.push(`${label}.cadence is invalid.`);
    if (!severities.has(control.severity)) errors.push(`${label}.severity must be advisory or blocking.`);
    if (!statuses.has(control.status)) errors.push(`${label}.status must be active, planned, or retired.`);
    for (const field of ["scope", "owner", "introduced_for", "cost", "review_date", "removal_criteria"]) {
      if (typeof control[field] !== "string" || !control[field].trim()) {
        errors.push(`${label}.${field} is required.`);
      }
    }
    if (typeof control.review_date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(control.review_date)) {
      errors.push(`${label}.review_date must use YYYY-MM-DD.`);
    }
    if (control.status === "active" && control.kind === "sensor" &&
      (typeof control.execution !== "string" || !control.execution.trim())) {
      errors.push(`${label}.execution is required for an active sensor.`);
    }
    if (control.status === "active" && control.kind === "sensor" &&
      (typeof control.self_correction !== "string" || !control.self_correction.trim())) {
      errors.push(`${label}.self_correction is required for an active sensor.`);
    }
    if (control.net_add_justification !== undefined &&
      (typeof control.net_add_justification !== "string")) {
      errors.push(`${label}.net_add_justification must be a string when present.`);
    }
    if (control.replaces !== undefined && (typeof control.replaces !== "string" || !control.replaces.trim())) {
      errors.push(`${label}.replaces must be a non-empty string when present.`);
    }
  }

  validateControlBudget(manifest, errors);
  return errors;
}

function summarizeControlBudget(manifest) {
  const active = activeControls(manifest);
  const budget = manifest.control_budget || {};
  const baseline = new Set(Array.isArray(budget.baseline_ids) ? budget.baseline_ids : []);
  const netAdds = active.filter((control) => control.id && !baseline.has(control.id)).map((control) => control.id);
  return {
    active: active.length,
    max_active: budget.max_active ?? null,
    baseline: baseline.size,
    net_adds: netAdds,
    headroom: Number.isInteger(budget.max_active) ? budget.max_active - active.length : null,
  };
}

module.exports = {
  activeControls,
  loadControlManifest,
  summarizeControlBudget,
  validateControlManifest,
};
