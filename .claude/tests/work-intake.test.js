const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyRequest, validateClassification } = require("../lib/work-intake");

test("classifies supported natural-language entry points", () => {
  assert.equal(classifyRequest({ request: "Implement user story US-142" }).entry_kind, "story");
  assert.equal(classifyRequest({ request: "Fix issue #381" }).entry_kind, "issue");
  assert.equal(classifyRequest({ request: "Deliver requirements/payments-prd.md" }).entry_kind, "prd");
  assert.equal(classifyRequest({ request: "Create test cases for export" }).entry_kind, "tests");
  assert.equal(classifyRequest({ request: "Govern these existing uncommitted changes" }).entry_kind, "diff");
});

test("explicit classification overrides inference", () => {
  const result = classifyRequest({ request: "Fix issue #381", entryKind: "feature", target: "design", interactionMode: "guided" });
  assert.equal(result.entry_kind, "feature");
  assert.equal(result.target, "design");
  assert.equal(result.interaction_mode, "guided");
  assert.equal(result.delivery_lane, "documentation");
});

test("do-not-code requests stop at the requested artifact", () => {
  assert.equal(classifyRequest({ request: "Design invoice export but do not write code" }).target, "design");
  assert.equal(classifyRequest({ request: "Create tests without implementation" }).target, "tests");
});

test("risk-neutral lane selection follows scale and entry kind", () => {
  assert.equal(classifyRequest({ request: "Implement story US-142" }).delivery_lane, "bounded-change");
  assert.equal(classifyRequest({ request: "Deliver payments PRD" }).delivery_lane, "initiative");
  assert.equal(classifyRequest({ request: "Add invoice export", scope: "single" }).delivery_lane, "bounded-change");
  assert.equal(classifyRequest({ request: "Add invoice export", scope: "unknown" }).delivery_lane, "feature");
});

test("ambiguous ideas are visible rather than silently promoted", () => {
  const result = classifyRequest({ request: "Make reporting better" });
  assert.equal(result.entry_kind, "idea");
  assert.equal(result.classification_confidence, "medium");
  assert.equal(result.material_questions.length, 1);
  assert.deepEqual(validateClassification(result), []);
});

test("rejects unsupported classification values", () => {
  assert.throws(() => classifyRequest({ request: "x", entryKind: "task" }), /entry kind must be one of/);
  assert.throws(() => classifyRequest({ request: "x", interactionMode: "auto" }), /interaction mode must be one of/);
});
