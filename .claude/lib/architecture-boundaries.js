const fs = require("node:fs");
const path = require("node:path");
const { resolveInspectionPaths } = require("./sensor-scope");

function loadBoundaryRules(root) {
  const filePath = path.join(root, ".claude", "project", "boundaries.json");
  if (!fs.existsSync(filePath)) return { filePath, rules: [] };
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.version !== 1 || !Array.isArray(parsed.rules)) throw new Error(`${filePath} must contain version 1 and a rules array.`);
  const ids = new Set();
  for (const rule of parsed.rules) {
    if (!rule || typeof rule.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(rule.id)) throw new Error(`${filePath} has a rule with an invalid id.`);
    if (ids.has(rule.id)) throw new Error(`${filePath} duplicates rule ${rule.id}.`);
    ids.add(rule.id);
    if (![rule.from, rule.reason].every((item) => typeof item === "string" && item)) throw new Error(`${filePath} rule ${rule.id} requires from and reason.`);
    if (!Array.isArray(rule.forbidden) || rule.forbidden.some((item) => typeof item !== "string" || !item)) throw new Error(`${filePath} rule ${rule.id} requires forbidden paths.`);
    if (!Array.isArray(rule.extensions) || rule.extensions.some((item) => typeof item !== "string" || !item.startsWith("."))) throw new Error(`${filePath} rule ${rule.id} requires extensions.`);
  }
  return { filePath, rules: parsed.rules };
}

function importsIn(source) {
  const imports = [];
  for (const match of source.matchAll(/(?:from\s+["']([^"']+)["']|import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']|from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/g)) {
    imports.push((match[1] || match[2] || match[3] || match[4]).replace(/\./g, "/"));
  }
  return imports;
}

function checkBoundaries(root, changedPaths) {
  const { rules } = loadBoundaryRules(root);
  const inspectionPaths = resolveInspectionPaths(root, changedPaths);
  const violations = [];
  for (const rule of rules) {
    for (const changedPath of inspectionPaths) {
      if (!changedPath.startsWith(rule.from) || !rule.extensions.includes(path.extname(changedPath))) continue;
      const fullPath = path.join(root, changedPath);
      if (!fs.existsSync(fullPath)) continue;
      for (const imported of importsIn(fs.readFileSync(fullPath, "utf8"))) {
        const forbidden = rule.forbidden.find((candidate) => imported.includes(candidate.replace(/\./g, "/")));
        if (forbidden) violations.push({ rule, path: changedPath, imported, forbidden });
      }
    }
  }
  return { rules, violations, inspectedPaths: inspectionPaths };
}

module.exports = { loadBoundaryRules, checkBoundaries };
