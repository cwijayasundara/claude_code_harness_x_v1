const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { recordUsage, totals } = require("../lib/model-usage");

test("records only a provider-evidenced usage receipt and totals it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-usage-"));
  fs.writeFileSync(path.join(root, "provider.json"), "{}\n");
  recordUsage(root, { change_id: "C-1", story_id: "S-1", role: "sidekick", model: "sonnet", provider: "anthropic", provider_session_id: "session-1", input_tokens: 10, output_tokens: 5, cost_usd: 0.25, elapsed_seconds: 2, evidence_path: "provider.json" });
  assert.deepEqual(totals(root, { storyId: "S-1", changeId: "C-1" }), { story_usd: 0.25, change_usd: 0.25 });
});

test("rejects a receipt without durable provider evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-usage-"));
  assert.throws(() => recordUsage(root, { change_id: "C-1", story_id: "S-1" }), /requires role/);
});
