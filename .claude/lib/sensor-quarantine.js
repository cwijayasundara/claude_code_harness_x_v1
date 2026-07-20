const fs = require("node:fs");
const path = require("node:path");

const PROTECTED = new Set(["secret-scan", "architecture-boundaries"]);

function validateQuarantines(document) {
  const errors = [];
  if (!document || document.version !== 1 || !Array.isArray(document.quarantines)) return ["Sensor quarantines must contain version 1 and quarantines array."];
  const ids = new Set();
  for (const [index, item] of document.quarantines.entries()) {
    const label = `quarantines[${index}]`;
    if (typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) errors.push(`${label}.id must be kebab-case.`);
    else if (ids.has(item.id)) errors.push(`${label}.id duplicates ${item.id}.`); else ids.add(item.id);
    if (typeof item.sensor_id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(item.sensor_id)) errors.push(`${label}.sensor_id must be kebab-case.`);
    if (PROTECTED.has(item.sensor_id) || /-sast$/.test(item.sensor_id || "")) errors.push(`${label}.sensor_id is protected and cannot be quarantined.`);
    for (const field of ["owner", "approved_by", "reason", "expires_on"]) if (typeof item[field] !== "string" || !item[field].trim()) errors.push(`${label}.${field} is required.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.expires_on || "")) errors.push(`${label}.expires_on must use YYYY-MM-DD.`);
    if (!Number.isInteger(item.minimum_samples) || item.minimum_samples < 3) errors.push(`${label}.minimum_samples must be at least 3.`);
  }
  return errors;
}

function loadQuarantines(root) {
  const filePath = path.join(path.resolve(root), ".claude", "sensor-quarantines.json");
  if (!fs.existsSync(filePath)) return { filePath, document: { version: 1, quarantines: [] } };
  const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const errors = validateQuarantines(document);
  if (errors.length) throw new Error(errors.join(" "));
  return { filePath, document };
}

function applyQuarantine(result, document, sampleCount, today = new Date().toISOString().slice(0, 10)) {
  if (result.status !== "fail" || PROTECTED.has(result.sensor_id) || /-sast$/.test(result.sensor_id || "")) return result;
  const item = document.quarantines.find((candidate) => candidate.sensor_id === result.sensor_id && candidate.expires_on >= today && sampleCount >= candidate.minimum_samples);
  if (!item) return result;
  return { ...result, status: "warn", quarantine_id: item.id, reason: `${result.reason} Quarantined by ${item.approved_by} until ${item.expires_on}: ${item.reason}`, next_action: `Stabilize the sensor before quarantine ${item.id} expires.`, disposition: "quarantined" };
}

module.exports = { PROTECTED, applyQuarantine, loadQuarantines, validateQuarantines };
