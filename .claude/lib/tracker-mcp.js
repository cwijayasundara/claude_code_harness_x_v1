const fs = require("node:fs");
const path = require("node:path");

const PROVIDERS = new Set(["linear", "jira", "azure-devops"]);

function definition(provider, { azureOrg } = {}) {
  if (provider === "linear") return { type: "http", url: "https://mcp.linear.app/mcp" };
  if (provider === "jira") return { type: "http", url: "https://mcp.atlassian.com/v1/mcp/authv2" };
  if (provider === "azure-devops") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(azureOrg || "")) throw new Error("--azure-org is required and must be an Azure DevOps organization name.");
    return {
      type: "stdio",
      command: "npx",
      args: ["-y", "@azure-devops/mcp", azureOrg, "-d", "core", "work", "work-items"],
    };
  }
  throw new Error(`provider must be one of: ${[...PROVIDERS].join(", ")}.`);
}

function configure(root, { providers, azureOrg, replace = false }) {
  const projectRoot = path.resolve(root);
  const selected = [...new Set(providers || [])];
  if (!selected.length || selected.some((provider) => !PROVIDERS.has(provider))) throw new Error(`providers must contain one or more of: ${[...PROVIDERS].join(", ")}.`);
  const file = path.join(projectRoot, ".mcp.json");
  let config = { mcpServers: {} };
  if (fs.existsSync(file)) {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(".mcp.json must contain an object.");
    if (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))) throw new Error(".mcp.json mcpServers must be an object.");
    config.mcpServers ||= {};
  }
  const added = [];
  const unchanged = [];
  for (const provider of selected) {
    const desired = definition(provider, { azureOrg });
    const existing = config.mcpServers[provider];
    if (existing && JSON.stringify(existing) !== JSON.stringify(desired) && !replace) throw new Error(`MCP server '${provider}' already has a different definition; rerun with --replace after review.`);
    if (existing && JSON.stringify(existing) === JSON.stringify(desired)) unchanged.push(provider);
    else {
      config.mcpServers[provider] = desired;
      added.push(provider);
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { path: ".mcp.json", added, unchanged, authentication: "Run /mcp in Claude Code and approve/authenticate each configured server.", live_write_authorized: false };
}

module.exports = { PROVIDERS, configure, definition };
