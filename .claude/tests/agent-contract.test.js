import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("ships separated generator and read-only evaluator roles", () => {
  const generator = read("agents/harness-generator.md");
  const evaluator = read("agents/harness-evaluator.md");
  const fastEvaluator = read("agents/harness-evaluator-fast.md");

  assert.match(generator, /name: harness-generator/);
  assert.match(generator, /model: sonnet/);
  assert.match(evaluator, /name: harness-evaluator/);
  assert.match(evaluator, /model: opus/);
  assert.match(evaluator, /disallowedTools: Write, Edit/);
  assert.match(evaluator, /not the generator's helper/);
  assert.match(evaluator, /Do not create blocking findings for style/);
  assert.match(fastEvaluator, /model: haiku/);
  assert.match(fastEvaluator, /disallowedTools: Write, Edit/);
  assert.match(fastEvaluator, /do not create\nblocking findings for style/);
});

test("preserves best-practice context and UI verification guidance", () => {
  const projectGuide = read("templates/project/CLAUDE.md");
  const reactGuide = read("templates/project/.claude/profiles/react-typescript/guide.md");

  assert.match(projectGuide, /When compacting, preserve active change\/story IDs/);
  assert.match(projectGuide, /separate Git worktree/);
  assert.match(reactGuide, /compare a fresh\n  browser screenshot/);
  assert.match(reactGuide, /tests and type checks do not\n  replace this visual verification/);
});

test("uses native plugin component discovery and routing policy", () => {
  const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
  const harnessSkill = read("skills/harness/SKILL.md");
  const template = read("templates/project/.claude/harness.yaml");

  assert.equal(Object.hasOwn(manifest, "agents"), false);
  assert.equal(Object.hasOwn(manifest, "skills"), false);
  assert.equal(fs.existsSync(path.join(root, "skills/harness/SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(root, "agents/harness-generator.md")), true);
  assert.equal(fs.existsSync(path.join(root, "agents/harness-evaluator.md")), true);
  assert.equal(fs.existsSync(path.join(root, "agents/harness-evaluator-fast.md")), true);
  assert.equal(fs.existsSync(path.join(root, "hooks/pre-tool-safety.js")), true);
  assert.match(harnessSkill, /\$CLAUDE_PLUGIN_ROOT\/hooks\/pre-tool-safety\.js/);
  assert.match(template, /routing\.json/);
});
