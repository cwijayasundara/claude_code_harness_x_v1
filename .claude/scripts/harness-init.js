#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..");
const targetRoot = path.resolve(process.argv[2] || ".");
const templateRoot = path.join(pluginRoot, "templates", "project", ".claude");
const claudeTemplate = path.join(pluginRoot, "templates", "project", "CLAUDE.md");
const userGuideTemplate = path.join(pluginRoot, "templates", "project", "HARNESS_USER_GUIDE.md");
const targetClaude = path.join(targetRoot, ".claude");
const targetClaudeGuide = path.join(targetRoot, "CLAUDE.md");
const targetUserGuide = path.join(targetRoot, "HARNESS_USER_GUIDE.md");
const installReceiptPath = path.join(targetClaude, "harness-install.json");

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function copyMissing(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyMissing(sourcePath, targetPath);
      continue;
    }

    if (fs.existsSync(targetPath)) {
      process.stdout.write(`SKIP  ${targetPath} (already exists)\n`);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    process.stdout.write(`CREATE ${targetPath}\n`);
  }
}

function detectedStackSignals(root) {
  const markers = [
    ["package.json", "Node.js / JavaScript / TypeScript"],
    ["pyproject.toml", "Python (pyproject.toml)"],
    ["requirements.txt", "Python (requirements.txt)"],
    ["go.mod", "Go"],
    ["Cargo.toml", "Rust"],
    ["pom.xml", "Java / Maven"],
    ["build.gradle", "Java or Kotlin / Gradle"],
    ["build.gradle.kts", "Kotlin / Gradle"],
  ];
  const found = markers.filter(([file]) => fs.existsSync(path.join(root, file)));
  if (found.length === 0) return "- No supported root ecosystem marker was detected. Configure profiles after inspecting the repository.";
  return found.map(([file, label]) => `- ${label}, indicated by \`${file}\`.`).join("\n");
}

function renderUserGuide(root) {
  const template = fs.readFileSync(userGuideTemplate, "utf8");
  return template
    .replaceAll("{{PROJECT_NAME}}", path.basename(root))
    .replace("{{STACK_SIGNALS}}", detectedStackSignals(root));
}

if (!fs.existsSync(templateRoot)) {
  fail(`harness templates are missing at ${templateRoot}`);
}

fs.mkdirSync(targetClaude, { recursive: true });
copyMissing(templateRoot, targetClaude);

if (fs.existsSync(targetClaudeGuide)) {
  process.stdout.write(`SKIP  ${targetClaudeGuide} (already exists)\n`);
} else {
  fs.copyFileSync(claudeTemplate, targetClaudeGuide);
  process.stdout.write(`CREATE ${targetClaudeGuide}\n`);
}

if (fs.existsSync(targetUserGuide)) {
  process.stdout.write(`SKIP  ${targetUserGuide} (already exists)\n`);
} else {
  fs.writeFileSync(targetUserGuide, renderUserGuide(targetRoot), "utf8");
  process.stdout.write(`CREATE ${targetUserGuide}\n`);
}

if (fs.existsSync(installReceiptPath)) {
  process.stdout.write(`SKIP  ${installReceiptPath} (already exists)\n`);
} else {
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
  fs.writeFileSync(installReceiptPath, `${JSON.stringify({
    schema_version: 1,
    installed_plugin: pluginManifest.name,
    installed_plugin_version: pluginManifest.version,
    installed_at: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`CREATE ${installReceiptPath}\n`);
}

process.stdout.write("Harness layout is ready. Start with HARNESS_USER_GUIDE.md, customize .claude/harness.yaml, then validate before delivery.\n");
