const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { projectFiles, resolveInspectionPaths } = require("./sensor-scope");

const DEFAULTS = Object.freeze({
  version: 1,
  extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py"],
  ignore_path_parts: ["test", "tests", "__tests__", "node_modules", "dist", "build", "vendor", "generated"],
  cycles: { severity: "warn", max_findings: 20 },
  coupling: { warn_fan_in: 8, warn_fan_out: 12, max_findings: 20 },
  approved_roots: [],
  suppressions: [],
});

function loadDependencyConfig(root) {
  const filePath = path.join(path.resolve(root), ".claude", "project", "dependency-sensors.json");
  if (!fs.existsSync(filePath)) return { filePath, defaults: true, config: structuredClone(DEFAULTS) };
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.version !== 1) throw new Error(`${filePath} must declare version 1.`);
  const config = {
    ...DEFAULTS,
    ...parsed,
    cycles: { ...DEFAULTS.cycles, ...(parsed.cycles || {}) },
    coupling: { ...DEFAULTS.coupling, ...(parsed.coupling || {}) },
  };
  if (!Array.isArray(config.approved_roots) || config.approved_roots.some((item) => typeof item !== "string" && !(item && typeof item.path === "string"))) throw new Error(`${filePath} approved_roots must contain paths.`);
  if (!Array.isArray(config.suppressions)) throw new Error(`${filePath} suppressions must be an array.`);
  validateSuppressions(config, filePath);
  return { filePath, defaults: false, config };
}

function validateSuppressions(config, filePath, today = new Date().toISOString().slice(0, 10)) {
  const active = [];
  for (const [index, suppression] of (config.suppressions || []).entries()) {
    if (!suppression || !["dependency-cycles", "coupling-impact"].includes(suppression.sensor_id)) throw new Error(`${filePath} suppressions[${index}].sensor_id is invalid.`);
    if (!Array.isArray(suppression.affected_paths) || !suppression.affected_paths.length || suppression.affected_paths.some((item) => typeof item !== "string" || !item || item.includes("*"))) throw new Error(`${filePath} suppressions[${index}].affected_paths must be explicit paths.`);
    for (const field of ["owner", "reason", "expires_on"]) if (typeof suppression[field] !== "string" || !suppression[field].trim()) throw new Error(`${filePath} suppressions[${index}].${field} is required.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(suppression.expires_on)) throw new Error(`${filePath} suppressions[${index}].expires_on must use YYYY-MM-DD.`);
    if (suppression.expires_on >= today) active.push(suppression);
  }
  return active;
}

function suppressed(sensorId, paths, suppressions) {
  return suppressions.some((item) => item.sensor_id === sensorId && paths.every((candidate) => item.affected_paths.includes(candidate)));
}

function ignored(relative, parts) {
  return relative.split(/[/\\]/).some((part) => parts.includes(part));
}

function importSpecifiers(source, extension) {
  const values = [];
  if (extension === ".py") {
    for (const match of source.matchAll(/^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+/gm)) values.push(match[1]);
    for (const match of source.matchAll(/^\s*import\s+([A-Za-z0-9_.]+)/gm)) values.push(match[1]);
  } else {
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g)) values.push(match[1]);
    for (const match of source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) values.push(match[1] || match[2]);
  }
  return [...new Set(values)];
}

function resolveModule(from, specifier, nodes, extensions) {
  let base;
  if (specifier.startsWith(".")) base = path.normalize(path.join(path.dirname(from), specifier));
  else {
    const normalized = specifier.replace(/\./g, "/");
    if (![...nodes].some((node) => node === normalized || node.startsWith(`${normalized}.`) || node.startsWith(`${normalized}/`))) return null;
    base = normalized;
  }
  const candidates = [base, ...extensions.map((extension) => `${base}${extension}`), ...extensions.map((extension) => path.join(base, `index${extension}`))];
  return candidates.find((candidate) => nodes.has(candidate.replace(/\\/g, "/")))?.replace(/\\/g, "/") || null;
}

function buildDependencyGraph(root, options = {}) {
  const { config } = options.config ? { config: options.config } : loadDependencyConfig(root);
  const files = projectFiles(root).filter((relative) => config.extensions.includes(path.extname(relative)) && !ignored(relative, config.ignore_path_parts));
  const nodes = new Set(files.map((item) => item.replace(/\\/g, "/")));
  const edges = new Map([...nodes].map((node) => [node, new Set()]));
  for (const relative of nodes) {
    let source;
    try { source = fs.readFileSync(path.join(path.resolve(root), relative), "utf8"); } catch { continue; }
    for (const specifier of importSpecifiers(source, path.extname(relative))) {
      const target = resolveModule(relative, specifier, nodes, config.extensions);
      if (target && target !== relative) edges.get(relative).add(target);
    }
  }
  return { nodes: [...nodes], edges, config };
}

function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const keys = new Set();
  function visit(node) {
    if (visiting.has(node)) {
      const cycle = stack.slice(stack.indexOf(node)).concat(node);
      const key = [...new Set(cycle.slice(0, -1))].sort().join("|");
      if (!keys.has(key)) { keys.add(key); cycles.push(cycle); }
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node); stack.push(node);
    for (const target of graph.edges.get(node) || []) visit(target);
    stack.pop(); visiting.delete(node); visited.add(node);
  }
  for (const node of graph.nodes) visit(node);
  return cycles;
}

function changedSourcePaths(root, changedPaths, graph) {
  const requested = new Set(resolveInspectionPaths(root, changedPaths).map((item) => item.replace(/\\/g, "/")));
  return graph.nodes.filter((node) => requested.has(node));
}

function newEdgesFromHead(root, changed, graph) {
  const additions = [];
  for (const relative of changed) {
    const current = graph.edges.get(relative) || new Set();
    const previous = spawnSync("git", ["-C", path.resolve(root), "show", `HEAD:${relative}`], { encoding: "utf8" });
    const before = new Set();
    if (previous.status === 0) for (const specifier of importSpecifiers(previous.stdout, path.extname(relative))) {
      const target = resolveModule(relative, specifier, new Set(graph.nodes), graph.config.extensions);
      if (target && target !== relative) before.add(target);
    }
    for (const target of current) if (!before.has(target)) additions.push({ from: relative, to: target });
  }
  return additions;
}

function checkDependencyCycles(root, changedPaths, options = {}) {
  const graph = buildDependencyGraph(root, options);
  const changed = new Set(changedSourcePaths(root, changedPaths, graph));
  const activeSuppressions = validateSuppressions(graph.config, loadDependencyConfig(root).filePath);
  const allCycles = findCycles(graph).filter((cycle) => cycle.some((node) => changed.has(node))).slice(0, graph.config.cycles.max_findings);
  const cycles = allCycles.filter((cycle) => !suppressed("dependency-cycles", [...new Set(cycle.slice(0, -1))], activeSuppressions));
  const roots = (graph.config.approved_roots || []).map((item) => typeof item === "string" ? item.replace(/\/$/, "") : item.path?.replace(/\/$/, "")).filter(Boolean);
  const outsideRoots = roots.length ? [...changed].filter((node) => !roots.some((rootPath) => node === rootPath || node.startsWith(`${rootPath}/`))) : [];
  const activeOutside = outsideRoots.filter((node) => !suppressed("dependency-cycles", [node], activeSuppressions));
  const metrics = { nodes: graph.nodes.length, edges: [...graph.edges.values()].reduce((sum, targets) => sum + targets.size, 0), changed_nodes: changed.size, cycle_count: cycles.length, outside_approved_roots: activeOutside.length, suppressed_count: (allCycles.length - cycles.length) + (outsideRoots.length - activeOutside.length) };
  if (!roots.length && !cycles.length) return { status: "warn", affectedPaths: [".claude/project/dependency-sensors.json"], reason: "Dependency cycles passed, but approved source roots are not configured.", nextAction: "List the repository's approved source/module roots before treating dependency structure as calibrated.", metrics: { ...metrics, roots_configured: 0 } };
  if (!cycles.length && !activeOutside.length) return { status: "pass", affectedPaths: changed.size ? [...changed] : ["."], reason: `Dependency structure passed for ${changed.size} changed source node(s).`, nextAction: "No action required.", metrics: { ...metrics, roots_configured: roots.length } };
  const details = [];
  if (cycles.length) details.push(`cycles: ${cycles.map((cycle) => cycle.join(" -> ")).join("; ")}`);
  if (activeOutside.length) details.push(`files outside approved roots: ${activeOutside.join(", ")}`);
  return { status: graph.config.cycles.severity === "fail" ? "fail" : "warn", affectedPaths: [...new Set([...cycles.flat(), ...activeOutside])], reason: `Dependency structure violations — ${details.join("; ")}`, nextAction: "Break cycles along a stable dependency direction and move new modules into an approved root; change architecture policy only with human approval.", metrics: { ...metrics, cycles, outside_roots: activeOutside } };
}

function checkCouplingImpact(root, changedPaths, options = {}) {
  const graph = buildDependencyGraph(root, options);
  const changed = changedSourcePaths(root, changedPaths, graph);
  const incoming = new Map(graph.nodes.map((node) => [node, 0]));
  for (const targets of graph.edges.values()) for (const target of targets) incoming.set(target, (incoming.get(target) || 0) + 1);
  const modules = changed.map((node) => ({ path: node, fan_in: incoming.get(node) || 0, fan_out: graph.edges.get(node)?.size || 0 }));
  const newEdges = newEdgesFromHead(root, changed, graph);
  const activeSuppressions = validateSuppressions(graph.config, loadDependencyConfig(root).filePath);
  const risky = modules.filter((item) => item.fan_in >= graph.config.coupling.warn_fan_in || item.fan_out >= graph.config.coupling.warn_fan_out)
    .filter((item) => !suppressed("coupling-impact", [item.path], activeSuppressions))
    .sort((a, b) => (b.fan_in + b.fan_out) - (a.fan_in + a.fan_out)).slice(0, graph.config.coupling.max_findings);
  const metrics = { nodes: graph.nodes.length, changed_nodes: changed.length, new_edge_count: newEdges.length, new_edges: newEdges, modules };
  if (!risky.length) return { status: "pass", affectedPaths: changed.length ? changed : ["."], reason: `No changed module exceeds fan-in ${graph.config.coupling.warn_fan_in} or fan-out ${graph.config.coupling.warn_fan_out}.`, nextAction: "No action required.", metrics };
  return { status: "warn", affectedPaths: risky.map((item) => item.path), reason: `High-impact changed modules: ${risky.map((item) => `${item.path} (fan-in ${item.fan_in}, fan-out ${item.fan_out})`).join("; ")}`, nextAction: "Prioritize regression and semantic review for these modules; reduce coupling only when an approved cohesive seam is clear.", metrics: { ...metrics, risky_modules: risky } };
}

module.exports = { DEFAULTS, buildDependencyGraph, checkCouplingImpact, checkDependencyCycles, findCycles, importSpecifiers, loadDependencyConfig, validateSuppressions };
