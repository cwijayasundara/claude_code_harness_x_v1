const fs = require("node:fs");
const path = require("node:path");

const patterns = [
  { name: "AWS access key", expression: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", expression: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
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

module.exports = { scanSecrets };
