const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const KINDS = new Set(["source-requirement", "approved-decision", "domain-invariant", "expected-test-result", "code", "test", "guide", "graph", "tool-output"]);
const PROTECTED = new Set(["source-requirement", "approved-decision", "domain-invariant", "expected-test-result"]);

function estimatedTokens(text) {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function boundedFile(root, candidate) {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Context path is outside the project: ${candidate}`);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Context file not found: ${candidate}`);
  return { absolute, relative };
}

function toolExcerpt(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= 100) return { text, ranges: [[1, lines.length]], omitted_lines: 0 };
  const head = lines.slice(0, 50);
  const tail = lines.slice(-50);
  return { text: `${head.join("\n")}\n[... ${lines.length - 100} lines omitted ...]\n${tail.join("\n")}`, ranges: [[1, 50], [lines.length - 49, lines.length]], omitted_lines: lines.length - 100 };
}

function packContext(root, { manifest, tokenBudget }) {
  if (!Number.isInteger(tokenBudget) || tokenBudget <= 0) throw new Error("Context token budget must be positive.");
  if (!Array.isArray(manifest.items)) throw new Error("Context manifest items must be an array.");
  const prepared = manifest.items.map((item, index) => {
    if (!KINDS.has(item.kind)) throw new Error(`Context item ${index} has invalid kind '${item.kind}'.`);
    const file = boundedFile(path.resolve(root), item.path);
    const bytes = fs.readFileSync(file.absolute);
    const text = bytes.toString("utf8");
    return { item, file, bytes, text, protected: PROTECTED.has(item.kind), priority: Number.isFinite(item.priority) ? item.priority : 0 };
  }).sort((a, b) => Number(b.protected || b.item.required) - Number(a.protected || a.item.required) || b.priority - a.priority || a.file.relative.localeCompare(b.file.relative));
  const selected = [];
  const omitted = [];
  let used = 0;
  for (const entry of prepared) {
    const excerpt = entry.item.kind === "tool-output" ? toolExcerpt(entry.text) : null;
    const loadText = excerpt?.text || entry.text;
    const tokens = estimatedTokens(loadText);
    const required = entry.protected || entry.item.required === true;
    if (used + tokens > tokenBudget) {
      if (required) throw new Error(`Required ${entry.item.kind} '${entry.file.relative}' exceeds the context budget; increase the approved budget or narrow other required context.`);
      omitted.push({ path: entry.file.relative, kind: entry.item.kind, reason: "context-budget" });
      continue;
    }
    const record = {
      path: entry.file.relative, kind: entry.item.kind, required, priority: entry.priority,
      sha256: crypto.createHash("sha256").update(entry.bytes).digest("hex"), estimated_tokens: tokens,
      provenance: { source_path: entry.file.relative, line_ranges: excerpt?.ranges || [[1, entry.text.split(/\r?\n/).length]], omitted_lines: excerpt?.omitted_lines || 0 },
    };
    if (excerpt?.omitted_lines) record.compressed_tool_output = excerpt.text;
    selected.push(record);
    used += tokens;
  }
  return { schema_version: 1, budget_tokens: tokenBudget, estimated_tokens: used, selected, omitted, protected_kinds: [...PROTECTED] };
}

/**
 * Build a complete bounded packet for a role. Prefer one pack over many tiny calls.
 */
function buildContextManifest(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("Context manifest requires at least one item.");
  return {
    items: items.map((item, index) => {
      if (!item || typeof item.path !== "string" || !item.path) {
        throw new Error(`Context item ${index} requires path.`);
      }
      if (!KINDS.has(item.kind)) throw new Error(`Context item ${index} has invalid kind '${item.kind}'.`);
      return {
        path: item.path,
        kind: item.kind,
        priority: Number.isFinite(item.priority) ? item.priority : (PROTECTED.has(item.kind) ? 100 : 50),
        required: item.required === true || PROTECTED.has(item.kind),
      };
    }),
  };
}

module.exports = {
  KINDS,
  PROTECTED,
  buildContextManifest,
  estimatedTokens,
  packContext,
};
