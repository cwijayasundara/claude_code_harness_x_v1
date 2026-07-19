/**
 * Subtractive ratchet helpers: nominate controls for retirement/demotion.
 * Never applies changes — humans approve via /harness-retro or manual edit.
 */

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function loadSensorOutcomes(root) {
  const fs = require("node:fs");
  const path = require("node:path");
  const file = path.join(path.resolve(root), ".claude", "state", "sensor-outcomes.jsonl");
  if (!fs.existsSync(file)) return { available: false, path: file, rows: [] };
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid sensor outcome at line ${index + 1} in ${file}`);
    }
  });
  return { available: true, path: file, rows };
}

/**
 * Propose controls to retire, demote, or measure.
 * @param {object} manifest harness-manifest.json
 * @param {object} [options]
 * @param {string} [options.root] project root for optional sensor-outcomes.jsonl
 * @param {string|Date} [options.asOf] evaluation date
 */
function proposeControlSubtractions(manifest, options = {}) {
  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  const controls = Array.isArray(manifest?.controls) ? manifest.controls : [];
  const budget = manifest?.control_budget || {};
  const baseline = new Set(Array.isArray(budget.baseline_ids) ? budget.baseline_ids : []);
  const proposals = [];

  const outcomes = options.root
    ? loadSensorOutcomes(options.root)
    : { available: false, path: null, rows: [] };

  const firesBySensor = new Map();
  if (outcomes.available) {
    for (const row of outcomes.rows) {
      const id = row.sensor_id || row.control_id || row.id;
      if (!id) continue;
      const entry = firesBySensor.get(id) || { fires: 0, true_positive: 0, false_positive: 0 };
      entry.fires += 1;
      if (row.outcome === "true-positive" || row.corrected === true) entry.true_positive += 1;
      if (row.outcome === "false-positive") entry.false_positive += 1;
      firesBySensor.set(id, entry);
    }
  }

  for (const control of controls) {
    if (!control || !control.id) continue;
    const reviewDate = parseDate(control.review_date);
    if (control.status === "active" && reviewDate && reviewDate < asOf) {
      proposals.push({
        control_id: control.id,
        action: "review-or-retire",
        severity: "advisory",
        reason: `review_date ${control.review_date} is past; reaffirm value or retire.`,
        evidence: { review_date: control.review_date },
      });
    }

    if (control.status === "planned") {
      proposals.push({
        control_id: control.id,
        action: "activate-or-delete",
        severity: "advisory",
        reason: "Planned control has no active effect; activate with justification or delete.",
        evidence: { status: "planned" },
      });
    }

    if (control.status === "active" && control.kind === "sensor" && outcomes.available) {
      const stats = firesBySensor.get(control.id) || { fires: 0, true_positive: 0, false_positive: 0 };
      if (stats.fires === 0) {
        proposals.push({
          control_id: control.id,
          action: "measure-or-retire",
          severity: "advisory",
          reason: "Active sensor has zero recorded outcomes in sensor-outcomes.jsonl over the available ledger.",
          evidence: { fires: 0, ledger: outcomes.path },
        });
      } else if (stats.false_positive > 0 && stats.true_positive === 0) {
        proposals.push({
          control_id: control.id,
          action: "tune-or-retire",
          severity: "blocking-candidate",
          reason: "Sensor outcomes are false-positive only; precision may be too low to keep as blocking.",
          evidence: stats,
        });
      }
    }

    if (control.status === "active" && !baseline.has(control.id) && !control.net_add_justification && !control.replaces) {
      proposals.push({
        control_id: control.id,
        action: "justify-or-retire",
        severity: "blocking-candidate",
        reason: "Active net-add outside baseline lacks net_add_justification/replaces (should not pass validate).",
        evidence: { baseline: false },
      });
    }
  }

  const active = controls.filter((control) => control.status === "active").length;
  if (Number.isInteger(budget.max_active) && active > budget.max_active * 0.9) {
    proposals.push({
      control_id: "*",
      action: "prefer-subtraction",
      severity: "advisory",
      reason: `Active controls ${active} are near max_active ${budget.max_active}; prefer retire/replace before net-adds.`,
      evidence: { active, max_active: budget.max_active, headroom: budget.max_active - active },
    });
  }

  if (!outcomes.available) {
    proposals.push({
      control_id: "*",
      action: "enable-outcome-ledger",
      severity: "advisory",
      reason: "No .claude/state/sensor-outcomes.jsonl yet; zero-fire retirement cannot be data-driven until outcomes are recorded.",
      evidence: { ledger: outcomes.path },
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    as_of: asOf.toISOString(),
    decision_authority: "human",
    applies_automatically: false,
    sensor_outcomes_available: outcomes.available,
    proposals,
    summary: {
      total: proposals.length,
      blocking_candidates: proposals.filter((item) => item.severity === "blocking-candidate").length,
      advisory: proposals.filter((item) => item.severity === "advisory").length,
    },
  };
}

module.exports = {
  loadSensorOutcomes,
  proposeControlSubtractions,
};
