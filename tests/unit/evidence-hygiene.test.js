const test = require("node:test");
const assert = require("node:assert/strict");
const { redactEvidence } = require("../../.claude/lib/evidence-hygiene");

test("redacts common credential values before evidence is stored", () => {
  const output = redactEvidence("api_key='abcdefghijk' token=ghp_abcdefghijklmnopqrstuvwxyz123456 password: 'secret-value'");
  assert.doesNotMatch(output, /abcdefghijk|abcdefghijklmnopqrstuvwxyz123456|secret-value/);
  assert.match(output, /REDACTED/);
});
