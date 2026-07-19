const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { discover } = require("./discovery");

const MAX_SOURCE_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function language(file) {
  const ext = path.extname(file);
  if (ext === ".py") return "python";
  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) return "javascript";
  if (ext === ".java") return "java";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "rust";
  return "unknown";
}

function declarations(text, file) {
  const patterns = language(file) === "python"
    ? [{ kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)/gm }, { kind: "function", regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm }]
    : [{ kind: "class", regex: /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g }, { kind: "function", regex: /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g }];
  const output = [];
  for (const { kind, regex } of patterns) {
    for (const match of text.matchAll(regex)) output.push({ name: match[1], kind, line: lineNumber(text, match.index) });
  }
  return output;
}

function imports(text, file) {
  const patterns = language(file) === "python"
    ? [/^\s*from\s+([\w.]+)\s+import\s+/gm, /^\s*import\s+([\w.]+)/gm]
    : [/\bfrom\s+["']([^"']+)["']/g, /\brequire\(\s*["']([^"']+)["']\s*\)/g, /\bimport\s+["']([^"']+)["']/g];
  const output = [];
  for (const regex of patterns) {
    for (const match of text.matchAll(regex)) output.push({ target: match[1], line: lineNumber(text, match.index) });
  }
  return output;
}

function gitMetadata(root, files) {
  const result = spawnSync("git", ["-C", root, "log", "-n", "200", "--name-only", "--pretty=format:@@%H"], { encoding: "utf8" });
  if (result.status !== 0) return { available: false, reason: "git history unavailable", cochange: [] };
  const allowed = new Set(files);
  const counts = new Map();
  let commitFiles = [];
  const flush = () => {
    const unique = [...new Set(commitFiles.filter((file) => allowed.has(file)))].sort();
    for (let left = 0; left < unique.length; left += 1) for (let right = left + 1; right < unique.length; right += 1) {
      const key = `${unique[left]}\0${unique[right]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    commitFiles = [];
  };
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("@@")) flush();
    else if (line.trim()) commitFiles.push(line.trim());
  }
  flush();
  const cochange = [...counts.entries()].filter(([, count]) => count >= 2)
    .map(([key, count]) => ({ files: key.split("\0"), commits: count, provenance: { method: "git-history", confidence: "extracted" } }))
    .sort((a, b) => b.commits - a.commits || a.files.join().localeCompare(b.files.join())).slice(0, 50);
  return { available: true, commits_scanned: 200, cochange };
}

const ADAPTER_CONFIDENCE = new Set(["extracted", "inferred", "projected"]);
const ADAPTER_PROVIDERS = new Set(["graphify", "cce", "lsp", "manual", "none"]);

/**
 * Validate an external graph export (Graphify / CCE / LSP). The harness does
 * not own a graph engine — it only imports a bounded, provenance-labelled subgraph.
 */
function validateAdapterExport(data, { requireProjectPaths = false, projectRoot = null } = {}) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["Adapter export must be a JSON object."];
  if (typeof data.provider !== "string" || !data.provider.trim()) {
    errors.push("provider is required (e.g. graphify, cce, lsp, manual).");
  } else if (!ADAPTER_PROVIDERS.has(data.provider) && data.provider !== "lsp-or-graphify-or-cce") {
    // Allow unknown provider strings for forward compatibility, but warn via note.
  }
  if (!Array.isArray(data.nodes)) errors.push("nodes must be an array.");
  if (!Array.isArray(data.edges)) errors.push("edges must be an array.");
  if (errors.length) return errors;

  const ids = new Set();
  for (const [index, node] of data.nodes.entries()) {
    const label = `nodes[${index}]`;
    if (!node || typeof node !== "object") {
      errors.push(`${label} must be an object.`);
      continue;
    }
    if (typeof node.id !== "string" || !node.id.trim()) errors.push(`${label}.id is required.`);
    else if (ids.has(node.id)) errors.push(`${label}.id duplicates '${node.id}'.`);
    else ids.add(node.id);
    if (node.path != null) {
      if (typeof node.path !== "string" || !node.path.trim()) errors.push(`${label}.path must be a non-empty string when present.`);
      else if (requireProjectPaths && projectRoot) {
        const absolute = path.resolve(projectRoot, node.path);
        const relative = path.relative(projectRoot, absolute);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
          errors.push(`${label}.path escapes the project root.`);
        }
      }
    }
    if (node.provenance) {
      if (!node.provenance.method || !node.provenance.confidence) {
        errors.push(`${label}.provenance requires method and confidence when present.`);
      } else if (!ADAPTER_CONFIDENCE.has(node.provenance.confidence)) {
        errors.push(`${label}.provenance.confidence must be extracted, inferred, or projected.`);
      }
    }
  }

  for (const [index, edge] of data.edges.entries()) {
    const label = `edges[${index}]`;
    if (!edge || typeof edge !== "object") {
      errors.push(`${label} must be an object.`);
      continue;
    }
    if (typeof edge.from !== "string" || typeof edge.to !== "string") {
      errors.push(`${label} requires string from and to.`);
    } else {
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        errors.push(`${label} '${edge.from}' -> '${edge.to}' has a missing endpoint.`);
      }
    }
    if (!edge.provenance?.method || !edge.provenance?.confidence) {
      errors.push(`${label} requires provenance.method and provenance.confidence.`);
    } else if (!ADAPTER_CONFIDENCE.has(edge.provenance.confidence)) {
      errors.push(`${label}.provenance.confidence must be extracted, inferred, or projected.`);
    }
    if (edge.type != null && (typeof edge.type !== "string" || !edge.type.trim())) {
      errors.push(`${label}.type must be a non-empty string when present.`);
    }
  }
  return errors;
}

function loadAdapter(root, adapterFile) {
  if (!adapterFile) return { provider: "none", nodes: [], edges: [] };
  const file = path.resolve(root, adapterFile);
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Graph adapter file must be inside the project.");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Graph adapter file not found: ${adapterFile}`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse graph adapter ${adapterFile}: ${error.message}`);
  }
  const errors = validateAdapterExport(data, { requireProjectPaths: true, projectRoot: root });
  if (errors.length) throw new Error(`Invalid graph adapter export:\n- ${errors.join("\n- ")}`);
  return {
    provider: data.provider,
    nodes: data.nodes,
    edges: data.edges,
    notes: data.notes || null,
    source: relative,
    sha256: digest(fs.readFileSync(file)),
  };
}

function buildCodeMap(root, scopedPaths, adapterFile, focusTerms = []) {
  if (!scopedPaths.length) throw new Error("At least one explicit --path scope is required; use --path . only after consciously choosing repository-wide discovery.");
  if (!focusTerms.length) throw new Error("At least one --focus path, module, or symbol is required to bound impact analysis.");
  const projectRoot = path.resolve(root);
  const inventory = discover(projectRoot, scopedPaths);
  if (inventory.sourceFiles.length > MAX_SOURCE_FILES) throw new Error(`Scope contains ${inventory.sourceFiles.length} source files; narrow it below ${MAX_SOURCE_FILES + 1}.`);
  const nodes = [];
  const edges = [];
  const skipped = [...inventory.skipped.map((item) => ({ path: item, reason: "missing scope" }))];
  const basenames = new Map(inventory.sourceFiles.map((file) => [path.basename(file, path.extname(file)), file]));

  for (const file of inventory.sourceFiles) {
    const absolute = path.join(projectRoot, file);
    const stat = fs.statSync(absolute);
    if (stat.size > MAX_FILE_BYTES) { skipped.push({ path: file, reason: `larger than ${MAX_FILE_BYTES} bytes` }); continue; }
    const content = fs.readFileSync(absolute);
    const text = content.toString("utf8");
    const fileId = `file:${file}`;
    nodes.push({ id: fileId, kind: "file", path: file, language: language(file), sha256: digest(content), role: Object.entries(inventory.roles).find(([, paths]) => paths.includes(file))?.[0] || "unclassified" });
    for (const symbol of declarations(text, file)) {
      const symbolId = `symbol:${file}:${symbol.name}:${symbol.line}`;
      nodes.push({ id: symbolId, kind: symbol.kind, name: symbol.name, path: file, line: symbol.line });
      edges.push({ from: fileId, to: symbolId, type: "declares", provenance: { method: "static-source-extraction", confidence: "extracted", source: file, line: symbol.line } });
    }
    for (const item of imports(text, file)) {
      const resolved = basenames.get(item.target.split(/[./]/).filter(Boolean).at(-1));
      edges.push({ from: fileId, to: resolved ? `file:${resolved}` : `external:${item.target}`, type: "imports", provenance: { method: "static-source-extraction", confidence: resolved ? "inferred" : "extracted", source: file, line: item.line } });
    }
  }

  const adapter = loadAdapter(projectRoot, adapterFile);
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.to) && edge.to.startsWith("external:")) {
      nodes.push({ id: edge.to, kind: "external-module", name: edge.to.slice("external:".length) });
      nodeIds.add(edge.to);
    }
  }
  const allNodes = [...nodes, ...adapter.nodes];
  const allEdges = [...edges, ...adapter.edges];
  const normalizedFocus = focusTerms.map((term) => term.toLowerCase());
  const seedIds = new Set(allNodes.filter((node) => normalizedFocus.some((term) => `${node.id} ${node.name || ""} ${node.path || ""}`.toLowerCase().includes(term))).map((node) => node.id));
  const impactedIds = new Set(seedIds);
  for (const edge of allEdges) if (seedIds.has(edge.to)) impactedIds.add(edge.from);
  const impact = allNodes.filter((node) => impactedIds.has(node.id)).map((node) => ({ id: node.id, path: node.path || null, kind: node.kind, reason: seedIds.has(node.id) ? "focus-match" : "direct-inbound-dependency" }));
  const degree = new Map();
  for (const edge of allEdges) { degree.set(edge.from, (degree.get(edge.from) || 0) + 1); degree.set(edge.to, (degree.get(edge.to) || 0) + 1); }
  const hotspots = allNodes.filter((node) => node.kind === "file").map((node) => ({ path: node.path, graph_degree: degree.get(node.id) || 0 }))
    .sort((a, b) => b.graph_degree - a.graph_degree || a.path.localeCompare(b.path)).slice(0, 20);
  const symbolNames = new Map();
  for (const node of allNodes.filter((item) => item.kind === "class" || item.kind === "function")) {
    const matches = symbolNames.get(node.name) || [];
    matches.push(node.path);
    symbolNames.set(node.name, matches);
  }
  const duplicateCandidates = [...symbolNames.entries()].filter(([, paths]) => new Set(paths).size > 1)
    .map(([name, paths]) => ({ symbol: name, paths: [...new Set(paths)].sort(), status: "candidate-needs-behavioral-verification" }));
  const roleMap = Object.fromEntries(Object.entries(inventory.roles).map(([role, files]) => [role, files]));
  const canonicalCandidates = Object.entries(roleMap).flatMap(([role, files]) => files.slice(0, 5).map((file) => ({ role, path: file, status: "candidate-needs-source-verification" })));
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    scope: scopedPaths,
    focus: focusTerms,
    limits: { max_source_files: MAX_SOURCE_FILES, max_file_bytes: MAX_FILE_BYTES },
    inventory: { files: inventory.files.length, source_files: inventory.sourceFiles.length, signals: inventory.signals, skipped },
    graph: { nodes: allNodes, edges: allEdges },
    maps: { roles: roleMap, public_entry_candidates: roleMap.boundary || [], tests: roleMap.test || [], canonical_reuse_candidates: canonicalCandidates, impact, hotspots, duplicate_candidates: duplicateCandidates },
    history: gitMetadata(projectRoot, inventory.sourceFiles),
    adapter: { provider: adapter.provider, source: adapter.source || null, sha256: adapter.sha256 || null },
    cautions: ["Inferred edges and candidates are navigation aids. Open the cited source and tests before making a claim or edit."],
  };
}

module.exports = {
  ADAPTER_CONFIDENCE,
  MAX_FILE_BYTES,
  MAX_SOURCE_FILES,
  buildCodeMap,
  loadAdapter,
  validateAdapterExport,
};
