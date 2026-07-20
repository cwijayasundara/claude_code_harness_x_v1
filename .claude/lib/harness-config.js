const fs = require("node:fs");
const path = require("node:path");
const { loadControlManifest, validateControlManifest } = require("./control-manifest");
const { loadSensorProfile, validateSensorProfile } = require("./sensor-profile");
const { loadWaivers, validateWaivers } = require("./sensor-waivers");

function parseHarnessConfig(text) {
  const profiles = [];
  let domainPack = null;
  let maxAutomatedRepairAttempts = 1;
  let readingProfiles = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === "technology_profiles:") {
      readingProfiles = true;
      continue;
    }

    const profileMatch = readingProfiles && line.match(/^-\s+([a-z0-9][a-z0-9-]*)$/i);
    if (profileMatch) {
      profiles.push(profileMatch[1]);
      continue;
    }

    readingProfiles = false;
    const domainMatch = line.match(/^domain_pack:\s*([a-z0-9][a-z0-9-]*)$/i);
    if (domainMatch) domainPack = domainMatch[1];
    const repairAttemptsMatch = line.match(/^max_automated_repair_attempts:\s*(\S+)$/);
    if (repairAttemptsMatch) maxAutomatedRepairAttempts = Number(repairAttemptsMatch[1]);
  }

  return { technologyProfiles: profiles, domainPack, maxAutomatedRepairAttempts };
}

function loadHarnessConfig(root) {
  const configPath = path.join(root, ".claude", "harness.yaml");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ${configPath}. Run harness-init first.`);
  }

  return {
    configPath,
    ...parseHarnessConfig(fs.readFileSync(configPath, "utf8")),
  };
}

function validateHarnessConfig(root) {
  const config = loadHarnessConfig(root);
  const errors = [];

  if (config.technologyProfiles.length === 0) {
    errors.push("Select at least one technology profile in .claude/harness.yaml.");
  }

  if (!Number.isInteger(config.maxAutomatedRepairAttempts) || config.maxAutomatedRepairAttempts < 0 || config.maxAutomatedRepairAttempts > 3) {
    errors.push("max_automated_repair_attempts must be an integer from 0 to 3.");
  }

  for (const profile of config.technologyProfiles) {
    const guide = path.join(root, ".claude", "profiles", profile, "guide.md");
    const sensors = path.join(root, ".claude", "profiles", profile, "sensors.yaml");
    const profileManifest = path.join(root, ".claude", "profiles", profile, "manifest.json");
    let allowEmptySensors = false;
    if (fs.existsSync(profileManifest)) {
      try {
        const { loadManifest } = require("./profile-context");
        const { manifest } = loadManifest(root, profile);
        allowEmptySensors = manifest.layer === "language" || manifest.layer === "framework";
        for (const required of manifest.requires) loadManifest(root, required);
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (!fs.existsSync(guide)) errors.push(`Missing profile guide: ${guide}`);
    if (!fs.existsSync(sensors)) errors.push(`Missing profile sensors: ${sensors}`);
    if (fs.existsSync(sensors)) {
      try {
        const { profile: sensorProfile } = loadSensorProfile(root, profile);
        for (const error of validateSensorProfile(sensorProfile, profile, { allowEmpty: allowEmptySensors })) errors.push(`Sensor profile: ${error}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  if (!config.domainPack) {
    errors.push("Select a domain_pack in .claude/harness.yaml.");
  } else {
    for (const file of [
      "glossary.md",
      "concepts.yaml",
      "invariants.yaml",
      "lifecycles.yaml",
      "policies.yaml",
      "events.yaml",
      "data-classification.yaml",
      "review-policy.md",
    ]) {
      const requiredPath = path.join(root, ".claude", "domains", config.domainPack, file);
      if (!fs.existsSync(requiredPath)) errors.push(`Missing domain artifact: ${requiredPath}`);
    }
    const domainSensors = path.join(root, ".claude", "domains", config.domainPack, "sensors.yaml");
    if (!fs.existsSync(domainSensors)) {
      errors.push(`Missing domain sensor profile: ${domainSensors}`);
    } else {
      try {
        const { loadSensorProfileFile, validateDomainSensorProfile } = require("./sensor-profile");
        const { profile: domainProfile } = loadSensorProfileFile(domainSensors);
        const invariantsPath = path.join(root, ".claude", "domains", config.domainPack, "invariants.yaml");
        for (const error of validateDomainSensorProfile(domainProfile, config.domainPack, invariantsPath)) errors.push(`Domain sensor profile: ${error}`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  try {
    const { loadBoundaryRules } = require("./architecture-boundaries");
    loadBoundaryRules(root);
  } catch (error) {
    errors.push(error.message);
  }

  try {
    require("./dependency-sensors").loadDependencyConfig(root);
    require("./regression-sensors").loadRegressionConfig(root);
    require("./modularity-review").loadModularityConfig(root);
    require("./modularity-review").loadDecisions(root);
    require("./sensor-operations").loadOperationsPolicy(root);
    require("./sensor-quarantine").loadQuarantines(root);
  } catch (error) {
    errors.push(error.message);
  }

  try {
    const { waivers } = loadWaivers(root);
    for (const error of validateWaivers(waivers)) errors.push(`Sensor waivers: ${error}`);
  } catch (error) {
    errors.push(error.message);
  }

  try {
    const { manifest, manifestPath } = loadControlManifest(root);
    const manifestErrors = validateControlManifest(manifest);
    for (const error of manifestErrors) errors.push(`Control manifest (${manifestPath}): ${error}`);
  } catch (error) {
    errors.push(error.message);
  }

  const verificationPath = path.join(root, ".claude", "verification.json");
  if (fs.existsSync(verificationPath)) {
    try {
      const { loadVerificationPlan, validateVerificationPlan } = require("./verification-plan");
      const { plan } = loadVerificationPlan(root);
      for (const error of validateVerificationPlan(plan)) errors.push(`Verification plan: ${error}`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const routingPath = path.join(root, ".claude", "routing.json");
  if (fs.existsSync(routingPath)) {
    try {
      const { loadRoutingPolicy } = require("./routing-policy");
      loadRoutingPolicy(root);
    } catch (error) {
      errors.push(error.message);
    }
  }

  return { config, errors };
}

module.exports = { loadHarnessConfig, parseHarnessConfig, validateHarnessConfig };
