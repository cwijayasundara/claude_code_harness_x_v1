const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const patterns = [
  { name: "AWS access key", expression: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "AWS secret access key", expression: /\baws_secret_access_key\b\s*[:=]\s*["'][A-Za-z0-9/+=]{40}["']/i },
  { name: "GitHub token", expression: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "GitLab token", expression: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Slack token", expression: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", expression: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Stripe secret key", expression: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "JWT", expression: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { name: "Private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Hard-coded credential assignment", expression: /\b(?:api[_-]?key|password|secret|access[_-]?token)\b\s*[:=]\s*["'][^"'${}\s][^"']{7,}["']/i },
];

function scanSecrets(root, changedPaths) {
  const findings = [];
  for (const changedPath of changedPaths) {
    const fullPath = path.join(root, changedPath);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) continue;
    const source = fs.readFileSync(fullPath, "utf8");
    for (const { name, expression } of patterns) {
      if (expression.test(source)) findings.push({ path: changedPath, name });
    }
  }
  return findings;
}

function runGitleaks(root) {
  const execution = spawnSync("gitleaks", ["dir", ".", "--no-banner", "--redact", "--no-color"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  const output = `${execution.stdout || ""}${execution.stderr || ""}`;
  if (execution.error?.code === "ENOENT") return { status: "unavailable", output: "gitleaks command is unavailable." };
  if (execution.error) return { status: "error", output: execution.error.message };
  if (execution.status === 0) return { status: "pass", output };
  if (execution.status === 1) return { status: "findings", output };
  return { status: "error", output: output || `gitleaks exited ${execution.status}.` };
}

module.exports = { scanSecrets, runGitleaks };
