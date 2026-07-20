const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { configure, definition } = require("../lib/tracker-mcp");

test("defines the official remote Linear and Atlassian endpoints", () => {
  assert.deepEqual(definition("linear"), { type: "http", url: "https://mcp.linear.app/mcp" });
  assert.deepEqual(definition("jira"), { type: "http", url: "https://mcp.atlassian.com/v1/mcp/authv2" });
});

test("Azure DevOps is limited to planning domains and requires an organization", () => {
  assert.throws(() => definition("azure-devops"), /azure-org is required/);
  assert.deepEqual(definition("azure-devops", { azureOrg: "contoso" }).args, ["-y", "@azure-devops/mcp", "contoso", "-d", "core", "work", "work-items"]);
});

test("configuration preserves unrelated MCP servers and is idempotent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-mcp-"));
  fs.writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers: { custom: { command: "custom-server" } }, note: "keep" }));
  const first = configure(root, { providers: ["linear", "jira"] });
  const second = configure(root, { providers: ["linear", "jira"] });
  const config = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
  assert.deepEqual(first.added, ["linear", "jira"]);
  assert.deepEqual(second.unchanged, ["linear", "jira"]);
  assert.equal(config.note, "keep");
  assert.deepEqual(config.mcpServers.custom, { command: "custom-server" });
  assert.equal(first.live_write_authorized, false);
});

test("configuration refuses to overwrite a customized server without review", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tracker-mcp-conflict-"));
  fs.writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers: { linear: { type: "http", url: "https://proxy.example/mcp" } } }));
  assert.throws(() => configure(root, { providers: ["linear"] }), /different definition/);
  assert.deepEqual(configure(root, { providers: ["linear"], replace: true }).added, ["linear"]);
});
