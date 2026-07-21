const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const script = path.join(__dirname, "..", "..", ".claude", "templates", "project", ".claude", "scripts", "harness-cost-statusline.js");

test("cost status line surfaces context, spend, reasoning, limits, and warning", () => {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({
      model: { display_name: "Sonnet" },
      context_window: { used_percentage: 86.9 },
      cost: { total_cost_usd: 1.234 },
      effort: { level: "medium" },
      thinking: { enabled: true },
      rate_limits: { five_hour: { used_percentage: 42.8 }, seven_day: { used_percentage: 17.2 } },
    }),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /\[Sonnet\] context 86% \| session \$1\.23/);
  assert.match(result.stdout, /effort:medium thinking:on/);
  assert.match(result.stdout, /limits 5h:42% 7d:17%/);
  assert.match(result.stdout, /COMPACT\/CLEAR SOON/);
});

test("cost status line tolerates missing and invalid input", () => {
  const missing = spawnSync(process.execPath, [script], { input: "{}", encoding: "utf8" });
  const invalid = spawnSync(process.execPath, [script], { input: "not-json", encoding: "utf8" });

  assert.match(missing.stdout, /context 0% \| session \$0\.00/);
  assert.equal(invalid.stdout, "[Claude] cost status unavailable\n");
  assert.match(invalid.stderr, /cost-status-unavailable/);
});
