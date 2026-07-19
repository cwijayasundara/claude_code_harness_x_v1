#!/usr/bin/env node
"use strict";

function blockedOperation(command) {
  if (typeof command !== "string") return null;

  const checks = [
    [/\bgit\s+reset\s+--hard\b/, "git reset --hard discards local changes"],
    [/\bgit\s+clean\b(?=[^\n]*(?:\s--force\b|\s-[a-z]*f))/,
      "git clean with force removes untracked files"],
    [/\bgit\s+checkout\s+--(?:\s|$)/, "git checkout -- discards local changes"],
    [/\bgit\s+push\b(?=[^\n]*(?:\s--force(?:-with-lease)?\b|\s-f(?:\s|$)))/,
      "force-push can overwrite remote history"],
  ];

  for (const [pattern, reason] of checks) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

function evaluate(input) {
  const command = input && input.tool_input && input.tool_input.command;
  const reason = blockedOperation(command);
  if (!reason) return { block: false };

  return {
    block: true,
    message: `Blocked by the harness safety gate: ${reason}. Use a reversible alternative or obtain an explicit human decision.`,
  };
}

function readInput(callback) {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { body += chunk; });
  process.stdin.on("end", () => {
    try {
      callback(JSON.parse(body));
    } catch {
      // A safety hook must not disrupt work if Claude Code supplies malformed input.
      callback(null);
    }
  });
}

if (require.main === module) {
  readInput((input) => {
    const result = evaluate(input);
    if (result.block) {
      process.stderr.write(`${result.message}\n`);
      process.exitCode = 2;
    }
  });
}

module.exports = { blockedOperation, evaluate };
