const fs = require("node:fs");
const path = require("node:path");

function scalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed;
}

// This intentionally supports the small, documented profile subset rather than
// introducing a general YAML dependency: `sensors`, list items, and scalar keys.
function parseSensorProfile(text) {
  const profile = { sensors: [] };
  let current = null;
  let inSensors = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) continue;
    if (/^sensors:\s*(?:\[\s*\])?$/.test(withoutComment)) {
      inSensors = true;
      continue;
    }
    if (!inSensors) continue;
    const item = withoutComment.match(/^\s{2}-\s+([a-z_]+):\s*(.+)$/);
    if (item) {
      current = { [item[1]]: scalar(item[2]) };
      profile.sensors.push(current);
      continue;
    }
    const field = withoutComment.match(/^\s{4}([a-z_]+):\s*(.+)$/);
    if (field && current) current[field[1]] = scalar(field[2]);
  }

  return profile;
}

function validateSensorProfile(profile, profileName, { allowEmpty = false } = {}) {
  const errors = [];
  if (!Array.isArray(profile.sensors) || profile.sensors.length === 0) {
    return allowEmpty ? [] : [`Profile ${profileName} must declare at least one sensor.`];
  }
  const ids = new Set();
  for (const [index, sensor] of profile.sensors.entries()) {
    const label = `${profileName}.sensors[${index}]`;
    if (typeof sensor.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(sensor.id)) errors.push(`${label}.id must be kebab-case.`);
    else if (ids.has(sensor.id)) errors.push(`${label}.id duplicates ${sensor.id}.`);
    else ids.add(sensor.id);
    if (typeof sensor.label !== "string" || !sensor.label) errors.push(`${label}.label is required.`);
    if (typeof sensor.command !== "string" || !sensor.command) errors.push(`${label}.command is required.`);
    if (!Array.isArray(sensor.args) || sensor.args.some((arg) => typeof arg !== "string")) errors.push(`${label}.args must be a string array.`);
    if (!Array.isArray(sensor.extensions) || sensor.extensions.some((extension) => typeof extension !== "string" || !extension.startsWith("."))) {
      errors.push(`${label}.extensions must be an array of file extensions.`);
    }
    if (sensor.require_script !== undefined && (typeof sensor.require_script !== "string" || !sensor.require_script)) {
      errors.push(`${label}.require_script must be a non-empty string when present.`);
    }
    if (sensor.require_file !== undefined && (typeof sensor.require_file !== "string" || !sensor.require_file)) {
      errors.push(`${label}.require_file must be a non-empty project-relative path when present.`);
    }
  }
  return errors;
}

function loadSensorProfile(root, profileName) {
  const profilePath = path.join(root, ".claude", "profiles", profileName, "sensors.yaml");
  return loadSensorProfileFile(profilePath);
}

function loadSensorProfileFile(profilePath) {
  if (!fs.existsSync(profilePath)) throw new Error(`Missing sensor profile: ${profilePath}`);
  let profile;
  try {
    profile = parseSensorProfile(fs.readFileSync(profilePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse sensor profile ${profilePath}: ${error.message}`);
  }
  return { profilePath, profile };
}

function invariantIds(invariantsPath) {
  if (!fs.existsSync(invariantsPath)) return [];
  return [...fs.readFileSync(invariantsPath, "utf8").matchAll(/^\s*-\s+id:\s*([a-z0-9][a-z0-9-]*)\s*$/gmi)].map((match) => match[1]);
}

function validateDomainSensorProfile(profile, domainName, invariantsPath) {
  const errors = validateSensorProfile(profile, `${domainName} domain`, { allowEmpty: true });
  const knownInvariants = new Set(invariantIds(invariantsPath));
  for (const [index, sensor] of profile.sensors.entries()) {
    const label = `${domainName} domain.sensors[${index}]`;
    if (!Array.isArray(sensor.invariants) || sensor.invariants.length === 0 || sensor.invariants.some((id) => typeof id !== "string")) {
      errors.push(`${label}.invariants must name one or more approved invariant ids.`);
      continue;
    }
    for (const invariant of sensor.invariants) {
      if (!knownInvariants.has(invariant)) errors.push(`${label}.invariants references unknown invariant ${invariant}.`);
    }
  }
  return errors;
}

function isApplicable(sensor, changedPaths) {
  return changedPaths.some((changedPath) => sensor.extensions.includes(path.extname(changedPath)));
}

module.exports = { parseSensorProfile, validateSensorProfile, validateDomainSensorProfile, loadSensorProfile, loadSensorProfileFile, isApplicable };
