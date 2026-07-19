/**
 * Additive harness upgrade for existing target projects.
 * - Creates missing template files (via harness-init semantics)
 * - Merges new baseline controls into harness-manifest.json without overwriting customs
 * - Ensures maintainability.json exists
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MAINTAINABILITY_REL = ".claude/project/maintainability.json";
const MANIFEST_REL = ".claude/harness-manifest.json";

/** Controls introduced for maintainability sensors; always merge when missing. */
const MAINTAINABILITY_CONTROL_IDS = Object.freeze([
  "file-size",
  "function-size",
  "exception-handling",
  "logging-discipline",
  "performance-heuristics",
  "near-duplication",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function templateRoot(pluginRoot) {
  return path.join(pluginRoot, "templates", "project");
}

/**
 * Merge template control budget + missing controls into a target manifest.
 * Never replaces an existing control object (project may customize it).
 */
function mergeHarnessManifest(targetManifest, templateManifest) {
  if (!targetManifest || typeof targetManifest !== "object") {
    throw new Error("Target harness-manifest.json must be a JSON object.");
  }
  if (!templateManifest || typeof templateManifest !== "object") {
    throw new Error("Template harness-manifest.json must be a JSON object.");
  }

  const result = structuredClone(targetManifest);
  result.version = result.version || templateManifest.version || 1;
  result.controls = Array.isArray(result.controls) ? [...result.controls] : [];
  result.control_budget = result.control_budget && typeof result.control_budget === "object"
    ? { ...result.control_budget }
    : {};

  const templateControls = Array.isArray(templateManifest.controls) ? templateManifest.controls : [];
  const templateById = new Map(templateControls.filter((c) => c?.id).map((c) => [c.id, c]));
  const existingIds = new Set(result.controls.map((c) => c?.id).filter(Boolean));

  const addedControls = [];
  // Prefer maintainability controls; also allow any template baseline missing from target.
  const templateBaseline = Array.isArray(templateManifest.control_budget?.baseline_ids)
    ? templateManifest.control_budget.baseline_ids
    : [];
  const candidates = new Set([...MAINTAINABILITY_CONTROL_IDS, ...templateBaseline]);

  for (const id of candidates) {
    if (existingIds.has(id)) continue;
    const control = templateById.get(id);
    if (!control) continue;
    result.controls.push(structuredClone(control));
    existingIds.add(id);
    addedControls.push(id);
  }

  const baseline = Array.isArray(result.control_budget.baseline_ids)
    ? [...result.control_budget.baseline_ids]
    : [];
  const baselineSet = new Set(baseline);
  const addedBaseline = [];
  for (const id of templateBaseline) {
    if (!baselineSet.has(id)) {
      baseline.push(id);
      baselineSet.add(id);
      addedBaseline.push(id);
    }
  }
  result.control_budget.baseline_ids = baseline;

  const templateMax = Number(templateManifest.control_budget?.max_active) || 0;
  const currentMax = Number(result.control_budget.max_active) || 0;
  const activeCount = result.controls.filter((c) => c && c.status === "active").length;
  const nextMax = Math.max(currentMax, templateMax, activeCount);
  const maxChanged = nextMax !== currentMax;
  result.control_budget.max_active = nextMax;

  return {
    manifest: result,
    changed: addedControls.length > 0 || addedBaseline.length > 0 || maxChanged,
    added_controls: addedControls,
    added_baseline_ids: addedBaseline,
    max_active: { from: currentMax || null, to: nextMax },
  };
}

function planUpgrade(targetRoot, pluginRoot) {
  const target = path.resolve(targetRoot);
  const plugin = path.resolve(pluginRoot);
  const pluginManifestPath = path.join(plugin, ".claude-plugin", "plugin.json");
  const pluginMeta = readJson(pluginManifestPath);
  const templateClaude = path.join(templateRoot(plugin), ".claude");

  const actions = [];

  // Missing files that init would create (sample of critical + maintainability).
  const watchFiles = [
    ".claude/harness.yaml",
    MANIFEST_REL,
    ".claude/harness-install.json",
    ".claude/project/boundaries.json",
    MAINTAINABILITY_REL,
    ".claude/domains/private-equity/sensors.yaml",
  ];
  for (const relativePath of watchFiles) {
    const exists = fs.existsSync(path.join(target, relativePath));
    actions.push({
      path: relativePath,
      action: exists ? "preserve" : "create",
      kind: "file",
    });
  }

  const targetManifestPath = path.join(target, MANIFEST_REL);
  const templateManifestPath = path.join(templateClaude, "harness-manifest.json");
  let manifestPlan = null;
  if (fs.existsSync(targetManifestPath) && fs.existsSync(templateManifestPath)) {
    const merge = mergeHarnessManifest(readJson(targetManifestPath), readJson(templateManifestPath));
    manifestPlan = {
      path: MANIFEST_REL,
      action: merge.changed ? "merge-controls" : "preserve",
      kind: "manifest-merge",
      added_controls: merge.added_controls,
      added_baseline_ids: merge.added_baseline_ids,
      max_active: merge.max_active,
    };
    actions.push(manifestPlan);
  } else if (!fs.existsSync(targetManifestPath)) {
    // create already listed
  }

  const receiptPath = path.join(target, ".claude", "harness-install.json");
  let installedVersion = null;
  if (fs.existsSync(receiptPath)) {
    try {
      installedVersion = readJson(receiptPath).installed_plugin_version || null;
    } catch {
      installedVersion = "unreadable";
    }
  }

  const needsApply = actions.some((item) => item.action === "create" || item.action === "merge-controls");

  return {
    generated_at: new Date().toISOString(),
    target_root: target,
    installed_plugin_version: installedVersion,
    available_plugin_version: pluginMeta.version,
    mode: "preview",
    actions,
    needs_apply: needsApply,
    next_action: needsApply
      ? "Review planned creates/merges; rerun with --apply to add missing files and merge new baseline controls."
      : "No missing files or maintainability control merges required; existing files preserved.",
  };
}

function applyUpgrade(targetRoot, pluginRoot) {
  const target = path.resolve(targetRoot);
  const plugin = path.resolve(pluginRoot);
  const plan = planUpgrade(target, plugin);

  const maintTarget = path.join(target, MAINTAINABILITY_REL);
  const maintTemplate = path.join(templateRoot(plugin), ".claude", "project", "maintainability.json");
  const maintMissingBefore = !fs.existsSync(maintTarget);
  const targetManifestPath = path.join(target, MANIFEST_REL);
  const templateManifestPath = path.join(templateRoot(plugin), ".claude", "harness-manifest.json");

  // Capture pre-init merge plan so we know what will change even if init rewrites nothing.
  let preMerge = null;
  if (fs.existsSync(targetManifestPath) && fs.existsSync(templateManifestPath)) {
    preMerge = mergeHarnessManifest(readJson(targetManifestPath), readJson(templateManifestPath));
  }

  // 1) Missing files only (never overwrite).
  const initializer = path.join(plugin, "scripts", "harness-init.js");
  const initResult = spawnSync(process.execPath, [initializer, target], { encoding: "utf8" });
  if (initResult.status !== 0) {
    throw new Error(initResult.stderr || initResult.stdout || "harness-init failed");
  }

  // 2) Ensure maintainability.json (init should have created it; fallback copy).
  let maintainability = {
    action: maintMissingBefore ? "create" : "preserve",
    path: MAINTAINABILITY_REL,
    via: maintMissingBefore ? "harness-init" : null,
  };
  if (!fs.existsSync(maintTarget)) {
    if (!fs.existsSync(maintTemplate)) throw new Error(`Missing template ${maintTemplate}`);
    fs.mkdirSync(path.dirname(maintTarget), { recursive: true });
    fs.copyFileSync(maintTemplate, maintTarget);
    maintainability = { action: "create", path: MAINTAINABILITY_REL, via: "direct-copy" };
  }

  // 3) Merge control manifest when target already had one (init never overwrites it).
  let manifestMerge = {
    action: "skipped",
    path: MANIFEST_REL,
    added_controls: [],
    added_baseline_ids: [],
  };
  if (fs.existsSync(targetManifestPath) && fs.existsSync(templateManifestPath)) {
    const merge = preMerge || mergeHarnessManifest(readJson(targetManifestPath), readJson(templateManifestPath));
    // Re-merge from current disk state after init (manifest is preserved by init).
    const liveMerge = mergeHarnessManifest(readJson(targetManifestPath), readJson(templateManifestPath));
    if (liveMerge.changed) {
      writeJson(targetManifestPath, liveMerge.manifest);
      manifestMerge = {
        action: "merged",
        path: MANIFEST_REL,
        added_controls: liveMerge.added_controls,
        added_baseline_ids: liveMerge.added_baseline_ids,
        max_active: liveMerge.max_active,
      };
    } else {
      manifestMerge = {
        action: "preserve",
        path: MANIFEST_REL,
        added_controls: [],
        added_baseline_ids: [],
        max_active: liveMerge.max_active,
      };
    }
  }

  // Refresh plan post-apply for report accuracy.
  const after = planUpgrade(target, plugin);
  return {
    ...after,
    mode: "applied",
    preview: plan,
    init_stdout: (initResult.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(0, 40),
    applied: {
      maintainability,
      manifest: manifestMerge,
    },
    next_action: "Validate with harness-validate.js; review merged controls if any were added.",
  };
}

function writeUpgradeReport(targetRoot, report) {
  const outputPath = path.join(path.resolve(targetRoot), ".claude", "specs", "evidence", "runtime", "harness-upgrade.json");
  writeJson(outputPath, report);
  return outputPath;
}

module.exports = {
  MAINTAINABILITY_CONTROL_IDS,
  MAINTAINABILITY_REL,
  MANIFEST_REL,
  mergeHarnessManifest,
  planUpgrade,
  applyUpgrade,
  writeUpgradeReport,
};
