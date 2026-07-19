const fs = require("node:fs");
const path = require("node:path");

const protectedSensors = new Set(["secret-scan", "architecture-boundaries"]);

function loadWaivers(root) {
  const waiverPath = path.join(root, ".claude", "sensor-waivers.json");
  if (!fs.existsSync(waiverPath)) throw new Error(`Missing sensor waiver policy: ${waiverPath}`);
  return { waiverPath, waivers: JSON.parse(fs.readFileSync(waiverPath, "utf8")) };
}

function validateWaivers(document) {
  const errors = [];
  if (!document || document.version !== 1 || !Array.isArray(document.waivers)) return ["Sensor waivers must contain version 1 and a waivers array."];
  const ids = new Set();
  for (const [index, waiver] of document.waivers.entries()) {
    const label = `waivers[${index}]`;
    if (!waiver || typeof waiver !== "object") { errors.push(`${label} must be an object.`); continue; }
    if (typeof waiver.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(waiver.id)) errors.push(`${label}.id must be kebab-case.`);
    else if (ids.has(waiver.id)) errors.push(`${label}.id duplicates ${waiver.id}.`);
    else ids.add(waiver.id);
    if (typeof waiver.sensor_id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(waiver.sensor_id)) errors.push(`${label}.sensor_id must be kebab-case.`);
    if (protectedSensors.has(waiver.sensor_id) || /-sast$/.test(waiver.sensor_id || "")) errors.push(`${label}.sensor_id is a protected control and cannot be waived.`);
    for (const field of ["owner", "approved_by", "reason", "expires_on"]) {
      if (typeof waiver[field] !== "string" || !waiver[field].trim()) errors.push(`${label}.${field} is required.`);
    }
    if (typeof waiver.expires_on === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(waiver.expires_on)) errors.push(`${label}.expires_on must use YYYY-MM-DD.`);
    if (!Array.isArray(waiver.affected_paths) || waiver.affected_paths.length === 0 || waiver.affected_paths.some((item) => typeof item !== "string" || !item || item === "." || item.includes("*"))) {
      errors.push(`${label}.affected_paths must be a non-empty list of explicit project paths.`);
    }
  }
  return errors;
}

function applyWaiver(result, document, today = new Date().toISOString().slice(0, 10)) {
  if (result.status !== "fail" || protectedSensors.has(result.sensor_id) || /-sast$/.test(result.sensor_id || "")) return result;
  const waiver = document.waivers.find((candidate) => candidate.sensor_id === result.sensor_id && candidate.expires_on >= today &&
    result.affected_paths.every((affectedPath) => candidate.affected_paths.includes(affectedPath)));
  if (!waiver) return result;
  return {
    ...result,
    status: "warn",
    waiver_id: waiver.id,
    reason: `${result.reason} Waived by ${waiver.approved_by} until ${waiver.expires_on}: ${waiver.reason}`,
    next_action: `Resolve the underlying issue before waiver ${waiver.id} expires on ${waiver.expires_on}.`,
  };
}

module.exports = { loadWaivers, validateWaivers, applyWaiver };
