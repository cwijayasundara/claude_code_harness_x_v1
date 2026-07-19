const fs = require("node:fs");
const path = require("node:path");

const ignoredDirectories = new Set([".claude", ".git", ".venv", "venv", "node_modules", "dist", "build", "coverage", ".next"]);
const sourceExtensions = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".go", ".rs"]);

function withinRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function walkFiles(root, scopedPaths = []) {
  const starts = scopedPaths.length === 0 ? [root] : scopedPaths.map((scope) => path.resolve(root, scope));
  const files = [];
  const skipped = [];

  for (const start of starts) {
    if (!withinRoot(root, start)) throw new Error(`Scope is outside the project root: ${start}`);
    if (!fs.existsSync(start)) {
      skipped.push(path.relative(root, start));
      continue;
    }

    const pending = [start];
    while (pending.length > 0) {
      const current = pending.pop();
      const stat = fs.statSync(current);
      if (stat.isFile()) {
        files.push(path.relative(root, current));
        continue;
      }

      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) pending.push(path.join(current, entry.name));
        if (entry.isFile()) files.push(path.relative(root, path.join(current, entry.name)));
      }
    }
  }

  return { files: [...new Set(files)].sort(), skipped };
}

function inferRole(file) {
  const name = path.basename(file).toLowerCase();
  if (/(^|[._/-])(test|spec)([._/-]|$)|__tests__|tests\//.test(file.toLowerCase())) return "test";
  if (/(router|route|controller|handler)/.test(name)) return "boundary";
  if (/(service|usecase|use-case|domain)/.test(name)) return "application";
  if (/(repo|repository|dao|store|persistence)/.test(name)) return "persistence";
  if (/(schema|model|dto|types?)/.test(name)) return "contract";
  return null;
}

function ecosystemSignals(root, files) {
  const signals = [];
  if (files.some((file) => file.endsWith(".py"))) signals.push("Python source");
  if (files.some((file) => file.endsWith(".ts") || file.endsWith(".tsx"))) signals.push("TypeScript source");
  if (files.some((file) => file.endsWith(".java"))) signals.push("Java source");
  if (files.some((file) => file.endsWith(".go"))) signals.push("Go source");
  if (files.some((file) => file.endsWith(".rs"))) signals.push("Rust source");
  if (fs.existsSync(path.join(root, "pyproject.toml"))) signals.push("pyproject.toml");
  if (fs.existsSync(path.join(root, "package.json"))) signals.push("package.json");
  if (fs.existsSync(path.join(root, "Dockerfile"))) signals.push("Dockerfile");
  return signals;
}

function discover(root, scopedPaths = []) {
  const { files, skipped } = walkFiles(root, scopedPaths);
  const sourceFiles = files.filter((file) => sourceExtensions.has(path.extname(file)));
  const roles = new Map();

  for (const file of sourceFiles) {
    const role = inferRole(file);
    if (!role) continue;
    const bucket = roles.get(role) || [];
    bucket.push(file);
    roles.set(role, bucket);
  }

  return {
    files,
    skipped,
    sourceFiles,
    signals: ecosystemSignals(root, files),
    roles: Object.fromEntries([...roles.entries()].map(([role, paths]) => [role, paths.sort()])),
  };
}

function renderDiscovery({ id, config, scopedPaths, result }) {
  const scope = scopedPaths.length === 0 ? "entire repository inventory (metadata only)" : scopedPaths.join(", ");
  const roleSections = Object.entries(result.roles).sort(([left], [right]) => left.localeCompare(right));
  const lines = [
    `# Brownfield discovery: ${id}`,
    "",
    `**Scope:** ${scope}`,
    `**Profiles:** ${config.technologyProfiles.join(", ")}`,
    `**Domain pack:** ${config.domainPack}`,
    "",
    "## Inventory",
    "",
    `- Source files found: ${result.sourceFiles.length}`,
    `- Files inventoried: ${result.files.length}`,
    `- Ecosystem signals: ${result.signals.join(", ") || "none detected"}`,
    `- Missing requested scopes: ${result.skipped.join(", ") || "none"}`,
    "",
    "## Candidate seams (verify before changing)",
    "",
  ];

  if (roleSections.length === 0) {
    lines.push("- No conventional seams inferred. Inspect the scoped source paths manually.");
  } else {
    for (const [role, paths] of roleSections) {
      lines.push(`### ${role}`);
      for (const file of paths.slice(0, 12)) lines.push(`- \`${file}\``);
      if (paths.length > 12) lines.push(`- _${paths.length - 12} additional ${role} files omitted_`);
      lines.push("");
    }
  }

  lines.push(
    "## Required follow-up",
    "",
    "- Identify one canonical existing pattern before implementation.",
    "- Confirm the public seam and relevant tests.",
    "- Check affected domain terms, invariants, lifecycle, and policy files.",
    "- Record unknowns that require a human/domain decision before editing code.",
    "",
  );
  return lines.join("\n");
}

module.exports = { discover, renderDiscovery };
