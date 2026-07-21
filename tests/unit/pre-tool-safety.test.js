const test = require("node:test");
const assert = require("node:assert/strict");

const { blockedOperation, evaluate } = require("../../.claude/hooks/pre-tool-safety");

test("blocks clearly destructive Git operations", () => {
  for (const command of [
    "git reset --hard",
    "git clean -fd",
    "git clean --force --dirs",
    "git checkout -- src/app.js",
    "git push --force origin main",
    "git push -f origin main",
  ]) {
    assert.ok(blockedOperation(command), command);
  }
});

test("allows normal Git and development commands", () => {
  for (const command of [
    "git status --short",
    "git reset --soft HEAD~1",
    "git checkout -b feature/capital-call",
    "git push origin feature/capital-call",
    "npm test",
  ]) {
    assert.equal(blockedOperation(command), null, command);
  }
});

test("evaluates only the Bash command field and fails open for malformed input", () => {
  assert.equal(evaluate({ tool_input: { command: "git reset --hard" } }).block, true);
  assert.equal(evaluate({ tool_input: { command: "git status" } }).block, false);
  assert.equal(evaluate(null).block, false);
});
