const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_CAPABILITIES = new Set(["principles", "conventions", "rules", "reference-docs", "how-tos", "cross-functional-requirements", "functional-specification", "architecture-requirements", "performance-requirements", "observability-guidance", "bootstrap", "cli-tools", "scripts", "codemods", "code-intelligence", "knowledge-source", "api-docs"]);
const EXECUTION_TYPES = new Set(["inferential", "computational", "both"]);
const RESOURCE_TYPES = new Set(["file", "glob", "command", "capability"]);

function loadGuideCatalog(root, relative = ".claude/guides.json") {
  const catalogPath = path.resolve(root, relative);
  if (!fs.existsSync(catalogPath)) throw new Error(`Missing guide catalog: ${catalogPath}.`);
  try { return { catalogPath, catalog: JSON.parse(fs.readFileSync(catalogPath, "utf8")) }; }
  catch (error) { throw new Error(`Unable to parse guide catalog ${catalogPath}: ${error.message}`); }
}

function validateGuideCatalog(root, catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return ["Guide catalog must be an object."];
  if (catalog.version !== 1) errors.push("Guide catalog version must be 1.");
  if (!Array.isArray(catalog.guides) || catalog.guides.length === 0) return [...errors, "Guide catalog must declare guides."];
  const ids = new Set();
  const covered = new Set();
  for (const [index, guide] of catalog.guides.entries()) {
    const label = `guides[${index}]`;
    if (!guide || typeof guide !== "object" || Array.isArray(guide)) { errors.push(`${label} must be an object.`); continue; }
    if (typeof guide.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(guide.id)) errors.push(`${label}.id must be kebab-case.`);
    else if (ids.has(guide.id)) errors.push(`${label}.id duplicates '${guide.id}'.`);
    else ids.add(guide.id);
    if (!EXECUTION_TYPES.has(guide.execution_type)) errors.push(`${label}.execution_type must be inferential, computational, or both.`);
    if (!Array.isArray(guide.capabilities) || guide.capabilities.length === 0) errors.push(`${label}.capabilities must be non-empty.`);
    else for (const capability of guide.capabilities) {
      if (!REQUIRED_CAPABILITIES.has(capability)) errors.push(`${label}.capabilities contains unknown '${capability}'.`);
      else covered.add(capability);
    }
    if (!guide.resource || !RESOURCE_TYPES.has(guide.resource.type)) errors.push(`${label}.resource.type must be file, glob, command, or capability.`);
    if (!guide.resource || typeof guide.resource.value !== "string" || !guide.resource.value.trim()) errors.push(`${label}.resource.value is required.`);
    if (!guide.selection || !["always", "task", "optional"].includes(guide.selection.mode)) errors.push(`${label}.selection.mode must be always, task, or optional.`);
    if (guide.resource?.type === "file" && !fs.existsSync(path.resolve(root, guide.resource.value))) errors.push(`${label} references missing file '${guide.resource.value}'.`);
  }
  for (const capability of REQUIRED_CAPABILITIES) if (!covered.has(capability)) errors.push(`Missing Fowler feedforward capability '${capability}'.`);
  return errors;
}

function resolveGuides(root, catalog, { paths = [], needs = [], availableCapabilities = [] } = {}) {
  const available = new Set(availableCapabilities);
  return catalog.guides.filter((guide) => guide.selection.mode === "always" || needs.some((need) => guide.capabilities.includes(need)) || paths.some((candidate) => (guide.selection.path_signals || []).some((signal) => candidate.toLowerCase().includes(signal.toLowerCase())))).map((guide) => ({
    id: guide.id, execution_type: guide.execution_type, capabilities: guide.capabilities, resource: guide.resource,
    available: guide.resource.type !== "capability" || available.has(guide.resource.value), required: guide.selection.mode !== "optional",
  }));
}

module.exports = { REQUIRED_CAPABILITIES, loadGuideCatalog, resolveGuides, validateGuideCatalog };
