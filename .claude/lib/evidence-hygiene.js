function redactEvidence(value) {
  return value
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(api[_-]?key|password|secret|access[_-]?token)\b(\s*[:=]\s*["'])[^"'\r\n]+(["'])/gi, "$1$2[REDACTED]$3");
}

module.exports = { redactEvidence };
