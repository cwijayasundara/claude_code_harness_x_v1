const fs = require("node:fs");
const path = require("node:path");

const LAYERS = new Set(["language", "framework"]);
const DEFAULT_MAX_FRAMEWORKS = 2;

function reasonRank(reason) {
  if (!reason) return 0;
  if (reason.startsWith("explicit-approved-hint")) return 40;
  if (reason.startsWith("content-signal:")) return 30;
  if (reason.startsWith("path-signal:")) return 20;
  if (reason.startsWith("required-by:")) return 10;
  if (reason.startsWith("language-extension:")) return 5;
  return 1;
}

function manifestPath(root, id) {
  return path.join(path.resolve(root), ".claude", "profiles", id, "manifest.json");
}

function loadManifest(root, id) {
  const file = manifestPath(root, id);
  if (!fs.existsSync(file)) throw new Error(`Missing profile manifest: ${file}`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = validateManifest(manifest, id);
  if (errors.length) throw new Error(errors.join(" "));
  return { manifest, file };
}

function validateManifest(manifest, expectedId) {
  const errors = [];
  if (manifest.version !== 1) errors.push(`${expectedId}: version must be 1.`);
  if (manifest.id !== expectedId) errors.push(`${expectedId}: manifest id must match its directory.`);
  if (!LAYERS.has(manifest.layer)) errors.push(`${expectedId}: layer must be language or framework.`);
  if (!Array.isArray(manifest.extensions) || manifest.extensions.some((item) => typeof item !== "string" || !item.startsWith("."))) {
    errors.push(`${expectedId}: extensions must be an array of extension strings starting with '.'.`);
  }
  if (!Array.isArray(manifest.requires) || manifest.requires.some((item) => typeof item !== "string")) {
    errors.push(`${expectedId}: requires must be an array.`);
  }
  if (!Array.isArray(manifest.content_signals) || manifest.content_signals.some((item) => typeof item !== "string")) {
    errors.push(`${expectedId}: content_signals must be an array.`);
  }
  if (!Array.isArray(manifest.path_signals) || manifest.path_signals.some((item) => typeof item !== "string")) {
    errors.push(`${expectedId}: path_signals must be an array.`);
  }
  if (manifest.guide !== "guide.md") errors.push(`${expectedId}: guide must be guide.md.`);
  if (manifest.layer === "framework" && (!manifest.requires || manifest.requires.length === 0)) {
    errors.push(`${expectedId}: framework profiles must require at least one language profile.`);
  }
  if (manifest.layer === "framework"
    && (!manifest.content_signals || manifest.content_signals.length === 0)
    && (!manifest.path_signals || manifest.path_signals.length === 0)) {
    errors.push(`${expectedId}: framework profiles need content_signals and/or path_signals so they only load when relevant.`);
  }
  return errors;
}

function inside(root, candidate) {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Profile context path is outside the project: ${candidate}`);
  }
  return { absolute, relative };
}

function matches(manifest, files, explicitHints) {
  if (explicitHints.has(manifest.id)) return { selected: true, reason: "explicit-approved-hint" };
  const relevant = files.filter((file) => manifest.extensions.includes(path.extname(file.relative)));
  if (!relevant.length) return { selected: false };
  if (manifest.layer === "language") {
    return { selected: true, reason: `language-extension:${relevant[0].relative}` };
  }
  // Frameworks never load from extension alone — need path/content/hint.
  for (const file of relevant) {
    if (manifest.path_signals.some((signal) => file.relative.toLowerCase().includes(signal.toLowerCase()))) {
      return { selected: true, reason: `path-signal:${file.relative}` };
    }
    if (fs.existsSync(file.absolute) && fs.statSync(file.absolute).isFile() && fs.statSync(file.absolute).size <= 1024 * 1024) {
      const content = fs.readFileSync(file.absolute, "utf8").toLowerCase();
      const signal = manifest.content_signals.find((item) => content.includes(item.toLowerCase()));
      if (signal) return { selected: true, reason: `content-signal:${signal}` };
    }
  }
  return { selected: false };
}

function listEngineeringReferences(pluginRoot) {
  const dir = path.join(pluginRoot, "skills", "harness-engineering-core", "references");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => path.join("skills", "harness-engineering-core", "references", name));
}

function engineeringCorePack(pluginRoot) {
  const skill = path.join("skills", "harness-engineering-core", "SKILL.md");
  const absoluteSkill = path.join(pluginRoot, skill);
  return {
    skill,
    skill_absolute: fs.existsSync(absoluteSkill) ? absoluteSkill : null,
    references: listEngineeringReferences(pluginRoot),
    note: "Stack-neutral base. Load progressive references only when the task needs them.",
  };
}

/**
 * Resolve language then framework guides for changed paths.
 * Frameworks load only via content/path signals or an explicit configured hint.
 */
function resolveProfiles(root, {
  configuredProfiles,
  changedPaths,
  hints = [],
  maxFrameworkProfiles = DEFAULT_MAX_FRAMEWORKS,
  pluginRoot = null,
} = {}) {
  if (!Array.isArray(changedPaths) || !changedPaths.length) {
    throw new Error("At least one changed path is required for profile resolution.");
  }
  if (!Number.isInteger(maxFrameworkProfiles) || maxFrameworkProfiles < 0 || maxFrameworkProfiles > 5) {
    throw new Error("maxFrameworkProfiles must be an integer from 0 to 5.");
  }

  const files = changedPaths.map((candidate) => inside(path.resolve(root), candidate));
  const configured = new Set(configuredProfiles);
  const explicitHints = new Set(hints);
  for (const hint of explicitHints) {
    if (!configured.has(hint)) {
      throw new Error(`Profile hint '${hint}' is not enabled in .claude/harness.yaml.`);
    }
  }

  const manifests = new Map();
  const visitConfigured = (id) => {
    if (manifests.has(id)) return;
    const loaded = loadManifest(root, id).manifest;
    manifests.set(id, loaded);
    for (const required of loaded.requires) visitConfigured(required);
  };
  for (const id of configured) visitConfigured(id);

  // Languages required by configured profiles are available even if not listed.
  for (const manifest of manifests.values()) {
    if (manifest.layer === "language") continue;
    for (const required of manifest.requires) {
      if (!manifests.has(required)) visitConfigured(required);
    }
  }

  const selected = new Map();
  for (const [id, manifest] of manifests) {
    const isConfigured = configured.has(id);
    const isLanguageDep = manifest.layer === "language";
    if (!isConfigured && !isLanguageDep) continue;
    // Unconfigured frameworks never load, even as transitive requires of another framework.
    if (manifest.layer === "framework" && !isConfigured && !explicitHints.has(id)) continue;
    const result = matches(manifest, files, explicitHints);
    if (result.selected) selected.set(id, result.reason);
  }

  const addRequirements = (id) => {
    const manifest = manifests.get(id);
    if (!manifest) return;
    for (const required of manifest.requires) {
      const requiredManifest = manifests.get(required);
      if (!requiredManifest) continue;
      // Only auto-add language dependencies; frameworks stay signal-gated.
      if (requiredManifest.layer !== "language") continue;
      if (!selected.has(required)) selected.set(required, `required-by:${id}`);
      addRequirements(required);
    }
  };
  for (const id of [...selected.keys()]) addRequirements(id);

  // Cap framework fan-out: keep strongest signal matches.
  const frameworks = [...selected.entries()]
    .filter(([id]) => manifests.get(id)?.layer === "framework")
    .map(([id, reason]) => ({ id, reason, rank: reasonRank(reason) }))
    .sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));

  const dropped_frameworks = [];
  if (frameworks.length > maxFrameworkProfiles) {
    for (const extra of frameworks.slice(maxFrameworkProfiles)) {
      selected.delete(extra.id);
      dropped_frameworks.push({
        id: extra.id,
        reason: extra.reason,
        note: `Exceeded max_framework_profiles=${maxFrameworkProfiles}; narrow --path or pass an explicit --hint.`,
      });
    }
  }

  const layerRank = { language: 0, framework: 1 };
  const profiles = [...selected.entries()].map(([id, reason]) => {
    const manifest = manifests.get(id);
    return {
      id,
      layer: manifest.layer,
      reason,
      guide: path.relative(path.resolve(root), path.join(path.dirname(manifestPath(root, id)), manifest.guide)),
    };
  }).sort((left, right) => layerRank[left.layer] - layerRank[right.layer] || left.id.localeCompare(right.id));

  const result = {
    changed_paths: changedPaths,
    profiles,
    guides: profiles.map((profile) => profile.guide),
    languages: profiles.filter((profile) => profile.layer === "language").map((profile) => profile.id),
    frameworks: profiles.filter((profile) => profile.layer === "framework").map((profile) => profile.id),
    dropped_frameworks,
    max_framework_profiles: maxFrameworkProfiles,
    policy: {
      frameworks_require_signal_or_hint: true,
      language_from_extension: true,
      engineering_core_always: true,
    },
  };

  if (pluginRoot) {
    result.engineering_core = engineeringCorePack(path.resolve(pluginRoot));
  }

  return result;
}

module.exports = {
  DEFAULT_MAX_FRAMEWORKS,
  engineeringCorePack,
  listEngineeringReferences,
  loadManifest,
  resolveProfiles,
  validateManifest,
};
