import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

test("fixture is a runnable package with two durable requirements", () => {
  const project = path.join(root, "project");
  const pkg = JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8"));
  assert.equal(pkg.scripts.test, "node --test");
  assert.ok(fs.existsSync(path.join(project, "requirements/task-board-prd.md")));
  assert.ok(fs.existsSync(path.join(project, "requirements/task-labels-feature.md")));
});

test("the E2E runner is opt-in and models two pull requests", () => {
  const runner = fs.readFileSync(path.join(root, "run-full-sdlc.mjs"), "utf8");
  assert.match(runner, /RUN_HARNESS_E2E/);
  assert.match(runner, /refs\/pull\/\$\{number\}\/head/);
  assert.match(runner, /simulatePullRequest\(1/);
  assert.match(runner, /simulatePullRequest\(2/);
  assert.match(runner, /task-labels-feature\.md/);
  assert.match(runner, /process\.kill\(-child\.pid/);
  assert.match(runner, /Bash\(pip \*\)/);
  assert.match(runner, /ready-for-draft-pr already recorded/);
  assert.match(runner, /scripts\/security-scan\.mjs/);
});
