const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function usagePath(root) {
  return path.join(path.resolve(root), ".claude", "specs", "evidence", "model-usage.jsonl");
}

function loadUsage(root) {
  const file = usagePath(root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    let receipt;
    try { receipt = JSON.parse(line); } catch { throw new Error(`Invalid model usage receipt at line ${index + 1}.`); }
    if (typeof receipt.cost_usd !== "number" || receipt.cost_usd < 0 || !receipt.story_id || !receipt.change_id || !receipt.evidence_path || !receipt.evidence_sha256) throw new Error(`Invalid model usage receipt fields at line ${index + 1}.`);
    const evidence = path.join(path.resolve(root), receipt.evidence_path);
    if (!fs.existsSync(evidence) || crypto.createHash("sha256").update(fs.readFileSync(evidence)).digest("hex") !== receipt.evidence_sha256) throw new Error(`Provider evidence drift for model usage receipt line ${index + 1}.`);
    return receipt;
  });
}

function totals(root, { storyId, changeId }) {
  const receipts = loadUsage(root);
  return {
    story_usd: receipts.filter((item) => item.story_id === storyId).reduce((sum, item) => sum + item.cost_usd, 0),
    change_usd: receipts.filter((item) => item.change_id === changeId).reduce((sum, item) => sum + item.cost_usd, 0),
  };
}

function validateProviderReceipt(root, receipt) {
  const requiredStrings = ["change_id", "story_id", "role", "model", "provider", "provider_session_id", "evidence_path"];
  for (const field of requiredStrings) if (typeof receipt[field] !== "string" || !receipt[field]) throw new Error(`Provider receipt requires ${field}.`);
  for (const field of ["input_tokens", "output_tokens"]) if (!Number.isInteger(receipt[field]) || receipt[field] < 0) throw new Error(`Provider receipt ${field} must be a non-negative integer.`);
  for (const field of ["cost_usd", "elapsed_seconds"]) if (typeof receipt[field] !== "number" || receipt[field] < 0) throw new Error(`Provider receipt ${field} must be non-negative.`);
  const projectRoot = path.resolve(root);
  const evidence = path.resolve(projectRoot, receipt.evidence_path);
  const relative = path.relative(projectRoot, evidence);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(evidence) || !fs.statSync(evidence).isFile()) throw new Error("Provider receipt evidence_path must identify a file inside the project.");
  return { ...receipt, timestamp: receipt.timestamp || new Date().toISOString(), evidence_path: relative, evidence_sha256: crypto.createHash("sha256").update(fs.readFileSync(evidence)).digest("hex") };
}

function recordUsage(root, receipt) {
  const normalized = validateProviderReceipt(root, receipt);
  const file = usagePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(normalized)}\n`, "utf8");
  return { normalized, file };
}

module.exports = { loadUsage, recordUsage, totals, validateProviderReceipt };
