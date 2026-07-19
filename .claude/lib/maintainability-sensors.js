/**
 * Deterministic maintainability sensors: file size and near-duplication.
 * Configured by target .claude/project/maintainability.json (optional defaults).
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULTS = Object.freeze({
  version: 1,
  file_size: {
    max_lines: 300,
    warn_lines: 250,
    extensions: [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs", ".java", ".kt"],
    ignore_path_parts: ["node_modules", ".git", "dist", "build", ".venv", "venv", "vendor", "generated"],
  },
  duplication: {
    min_block_lines: 8,
    min_occurrences: 2,
    extensions: [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs", ".java", ".kt"],
    ignore_path_parts: ["node_modules", ".git", "dist", "build", ".venv", "venv", "vendor", "generated", "test", "tests", "__tests__"],
    max_findings: 20,
    /** fail | warn — default warn so first enable is non-catastrophic */
    severity: "warn",
  },
});

function loadMaintainabilityConfig(root) {
  const filePath = path.join(path.resolve(root), ".claude", "project", "maintainability.json");
  if (!fs.existsSync(filePath)) {
    return { filePath, config: structuredClone(DEFAULTS), defaults: true };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.version !== 1) throw new Error(`${filePath} must declare version 1.`);
  return {
    filePath,
    defaults: false,
    config: {
      version: 1,
      file_size: { ...DEFAULTS.file_size, ...(parsed.file_size || {}) },
      duplication: { ...DEFAULTS.duplication, ...(parsed.duplication || {}) },
    },
  };
}

function isIgnored(relativePath, ignoreParts) {
  const parts = relativePath.split(/[/\\]/);
  return parts.some((part) => ignoreParts.includes(part));
}

function shouldInspect(relativePath, extensions, ignoreParts) {
  if (isIgnored(relativePath, ignoreParts)) return false;
  return extensions.includes(path.extname(relativePath));
}

function resolveInspectPaths(root, changedPaths, extensions, ignoreParts) {
  const rootResolved = path.resolve(root);
  const files = [];
  for (const item of changedPaths) {
    if (item === "." || item === "") {
      // expand handled by caller via project files
      continue;
    }
    const full = path.join(rootResolved, item);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isFile() && shouldInspect(item, extensions, ignoreParts)) {
      files.push(item);
    } else if (stat.isDirectory()) {
      // only when explicitly changed path is a directory
      walkFiles(full, rootResolved, extensions, ignoreParts, files);
    }
  }
  return [...new Set(files)];
}

function walkFiles(directory, rootResolved, extensions, ignoreParts, out) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(rootResolved, full);
    if (entry.isDirectory()) {
      if (ignoreParts.includes(entry.name)) continue;
      walkFiles(full, rootResolved, extensions, ignoreParts, out);
    } else if (entry.isFile() && shouldInspect(relative, extensions, ignoreParts)) {
      out.push(relative);
    }
  }
}

function countLines(text) {
  if (!text) return 0;
  return text.replace(/\n$/, "").split(/\r?\n/).length;
}

/**
 * @returns {{ status: 'pass'|'warn'|'fail', findings: Array, reason: string, nextAction: string, affectedPaths: string[] }}
 */
function checkFileSizes(root, changedPaths, options = {}) {
  const { config } = options.config ? { config: options.config } : loadMaintainabilityConfig(root);
  const settings = config.file_size;
  let paths = resolveInspectPaths(root, changedPaths, settings.extensions, settings.ignore_path_parts);
  if (paths.length === 0 && (changedPaths.length === 0 || changedPaths.includes("."))) {
    paths = [];
    walkFiles(path.resolve(root), path.resolve(root), settings.extensions, settings.ignore_path_parts, paths);
  }

  const findings = [];
  for (const relative of paths) {
    const full = path.join(path.resolve(root), relative);
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = countLines(text);
    if (lines > settings.max_lines) {
      findings.push({
        path: relative,
        lines,
        level: "fail",
        limit: settings.max_lines,
        message: `${relative} has ${lines} lines (max ${settings.max_lines}).`,
      });
    } else if (lines > settings.warn_lines) {
      findings.push({
        path: relative,
        lines,
        level: "warn",
        limit: settings.warn_lines,
        message: `${relative} has ${lines} lines (warn at ${settings.warn_lines}, max ${settings.max_lines}).`,
      });
    }
  }

  const fails = findings.filter((item) => item.level === "fail");
  const warns = findings.filter((item) => item.level === "warn");
  if (fails.length) {
    return {
      status: "fail",
      findings,
      affectedPaths: fails.map((item) => item.path),
      reason: `File size limit exceeded: ${fails.map((item) => item.message).join(" ")}`,
      nextAction: `Split oversized modules (max ${settings.max_lines} lines) or raise the limit in .claude/project/maintainability.json with an explicit human justification.`,
    };
  }
  if (warns.length) {
    return {
      status: "warn",
      findings,
      affectedPaths: warns.map((item) => item.path),
      reason: `File size approaching limit: ${warns.map((item) => item.message).join(" ")}`,
      nextAction: `Consider extracting cohesive units before files exceed ${settings.max_lines} lines.`,
    };
  }
  return {
    status: "pass",
    findings: [],
    affectedPaths: paths.length > 0 ? paths : ["."],
    reason: paths.length === 0
      ? "No source files in scope for file-size sensor."
      : `All ${paths.length} inspected file(s) are within the line budget (max ${settings.max_lines}).`,
    nextAction: "No action required.",
  };
}

function normalizeCodeLine(line) {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/#.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function significantLines(text) {
  return text
    .split(/\r?\n/)
    .map(normalizeCodeLine)
    .filter((line) => line.length > 0 && !/^[{}();,]+$/.test(line));
}

/**
 * Near-duplication via fixed-size normalized line-block fingerprints.
 */
function checkNearDuplication(root, changedPaths, options = {}) {
  const { config } = options.config ? { config: options.config } : loadMaintainabilityConfig(root);
  const settings = config.duplication;
  let paths = resolveInspectPaths(root, changedPaths, settings.extensions, settings.ignore_path_parts);
  if (paths.length === 0 && (changedPaths.length === 0 || changedPaths.includes("."))) {
    paths = [];
    walkFiles(path.resolve(root), path.resolve(root), settings.extensions, settings.ignore_path_parts, paths);
  }

  /** @type {Map<string, Array<{ path: string, start: number, end: number, preview: string }>>} */
  const fingerprints = new Map();
  const minLines = Math.max(4, Number(settings.min_block_lines) || 8);

  for (const relative of paths) {
    const full = path.join(path.resolve(root), relative);
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = significantLines(text);
    if (lines.length < minLines) continue;
    for (let index = 0; index <= lines.length - minLines; index += 1) {
      const block = lines.slice(index, index + minLines);
      const preview = block.slice(0, 3).join(" | ");
      const digest = crypto.createHash("sha256").update(block.join("\n")).digest("hex").slice(0, 16);
      const list = fingerprints.get(digest) || [];
      // Skip heavily overlapping windows in the same file (step roughly half block).
      const last = list[list.length - 1];
      if (last && last.path === relative && index < last.end - Math.floor(minLines / 2)) {
        continue;
      }
      list.push({ path: relative, start: index + 1, end: index + minLines, preview });
      fingerprints.set(digest, list);
    }
  }

  const findings = [];
  const minOcc = Math.max(2, Number(settings.min_occurrences) || 2);
  for (const [digest, locations] of fingerprints.entries()) {
    if (locations.length < minOcc) continue;
    const distinctPaths = new Set(locations.map((item) => item.path));
    // Prefer cross-file clones; allow same-file if far apart enough already filtered.
    if (distinctPaths.size < 2 && locations.length < minOcc) continue;
    if (distinctPaths.size < 2) {
      // same-file only: keep if at least 2 non-overlapping
      const sorted = [...locations].sort((a, b) => a.start - b.start);
      let count = 0;
      let lastEnd = -1;
      for (const loc of sorted) {
        if (loc.start >= lastEnd) {
          count += 1;
          lastEnd = loc.end;
        }
      }
      if (count < minOcc) continue;
    }
    findings.push({
      digest,
      occurrences: locations.length,
      paths: [...distinctPaths],
      samples: locations.slice(0, 4),
      message: `Near-duplicate block (${minLines}+ significant lines) in ${[...distinctPaths].join(", ")}`,
    });
  }

  findings.sort((a, b) => b.occurrences - a.occurrences || a.message.localeCompare(b.message));
  const capped = findings.slice(0, settings.max_findings || 20);
  const severity = settings.severity === "fail" ? "fail" : "warn";

  if (capped.length === 0) {
    return {
      status: "pass",
      findings: [],
      affectedPaths: paths.length > 0 ? paths : ["."],
      reason: paths.length === 0
        ? "No source files in scope for duplication sensor."
        : `No near-duplicate blocks (≥${minLines} significant lines, ≥${minOcc} occurrences) in ${paths.length} file(s).`,
      nextAction: "No action required.",
    };
  }

  const affected = [...new Set(capped.flatMap((item) => item.paths))];
  return {
    status: severity,
    findings: capped,
    affectedPaths: affected,
    reason: `Near-duplication detected (${capped.length} cluster(s)): ${capped.map((item) => item.message).join("; ")}`,
    nextAction:
      "Reuse one implementation (or extract a shared helper) for duplicated blocks; "
      + "only keep parallel copies with an approved justified-divergence. "
      + "Adjust .claude/project/maintainability.json if thresholds are wrong.",
  };
}

module.exports = {
  DEFAULTS,
  loadMaintainabilityConfig,
  checkFileSizes,
  checkNearDuplication,
  countLines,
  significantLines,
};
