import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const e2eRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(e2eRoot, "../..");
const pluginRoot = path.join(repositoryRoot, ".claude");
const workRoot = path.join(e2eRoot, ".work");
const projectRoot = path.join(workRoot, "project");
const remoteRoot = path.join(workRoot, "origin.git");
const pullsRoot = path.join(workRoot, "pulls");
const logsRoot = path.join(workRoot, "logs");

if (process.env.RUN_HARNESS_E2E !== "1") {
  console.error("This test invokes the real Claude CLI and can consume API/subscription quota.");
  console.error("Run it explicitly with: RUN_HARNESS_E2E=1 npm test");
  process.exit(2);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeout || 120_000;
    const output = [];
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, ...(options.env || {}) },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const logPath = options.log ? path.join(logsRoot, options.log) : null;
    if (logPath) {
      fs.mkdirSync(logsRoot, { recursive: true });
      fs.writeFileSync(logPath, "");
    }
    const collect = (chunk) => {
      const text = chunk.toString();
      output.push(text);
      if (logPath) fs.appendFileSync(logPath, text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }, 5_000).unref();
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      const detail = output.join("");
      if (status === 0) resolve(detail);
      else reject(new Error(`${command} ${args.join(" ")} failed (${status ?? signal}):\n${detail}`));
    });
  });
}

async function git(...args) {
  return run("git", args, { timeout: 30_000 });
}

function configureHarness() {
  fs.copyFileSync(
    path.join(projectRoot, "e2e-verification.json"),
    path.join(projectRoot, ".claude", "verification.json")
  );
  fs.writeFileSync(path.join(projectRoot, ".claude", "harness.yaml"), [
    "technology_profiles:",
    "  - typescript",
    "domain_pack: private-equity",
    "review:",
    "  max_automated_repair_attempts: 1",
    "optional_sensors:",
    "  playwright: disabled",
    "artifacts:",
    "  root: .claude/specs",
    ""
  ].join("\n"));
  const sensorPath = path.join(projectRoot, ".claude", "profiles", "typescript", "sensors.yaml");
  fs.writeFileSync(sensorPath, [
    "sensors:",
    "  - id: typescript-language-sast",
    "    label: Fixture JavaScript static security analysis",
    "    command: node",
    '    args: ["scripts/security-scan.mjs"]',
    '    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]',
    ""
  ].join("\n"));
}

async function claudeTurns(name, initialPrompt, previousReadinessCount) {
  const sessionId = crypto.randomUUID();
  const common = [
    "--print",
    "--output-format", "text",
    "--permission-mode", "bypassPermissions",
    "--dangerously-skip-permissions",
    "--disallowedTools", "Bash(pip *),Bash(pip3 *),Bash(brew *),Bash(curl *),Bash(gh *),Bash(git commit *),Bash(git push *)",
    "--plugin-dir", pluginRoot,
    "--model", process.env.HARNESS_E2E_MODEL || "sonnet",
    "--max-budget-usd", process.env.HARNESS_E2E_TURN_BUDGET || "8"
  ];
  const turns = [
    initialPrompt,
    "I have reviewed the complete generated product checkpoint proposal. I explicitly approve the product checkpoint, including every constituent gate. Record my approval as e2e-human and continue.",
    "I have reviewed the complete generated solution checkpoint proposal. I explicitly approve the solution checkpoint, including every constituent gate. Record my approval as e2e-human and continue through implementation and verified draft-PR readiness.",
    "/harness:run \"Continue this active change through verified draft-PR readiness. Correct any actionable verification failures, but do not weaken checks or merge.\""
  ];

  for (const [index, prompt] of turns.entries()) {
    const startedAt = Date.now();
    console.log(`START ${name} turn ${index + 1}/${turns.length}`);
    const sessionArgs = index === 0
      ? [...common, "--session-id", sessionId, prompt]
      : [...common, "--resume", sessionId, prompt];
    await run("claude", sessionArgs, {
      timeout: Number(process.env.HARNESS_E2E_TURN_TIMEOUT_MS || 30 * 60_000),
      log: `${name}-${index + 1}.log`
    });
    console.log(`DONE  ${name} turn ${index + 1}/${turns.length} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    if (readinessEvidence().length > previousReadinessCount) {
      console.log(`SKIP  remaining ${name} turns (ready-for-draft-pr already recorded)`);
      break;
    }
  }
}

function readinessEvidence() {
  const evidenceRoot = path.join(projectRoot, ".claude", "specs", "evidence");
  const matches = [];
  if (!fs.existsSync(evidenceRoot)) return matches;
  for (const entry of fs.readdirSync(evidenceRoot, { recursive: true })) {
    if (!entry.endsWith(".json")) continue;
    const candidate = path.join(evidenceRoot, entry);
    try {
      const value = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (value.status === "ready-for-draft-pr") matches.push(candidate);
    } catch {
      // Proposal markdown and partial evidence are intentionally ignored.
    }
  }
  return matches;
}

async function simulatePullRequest(number, branch, title, readinessPath) {
  await git("add", ".");
  await git("commit", "-m", title);
  await git("push", "-u", "origin", branch);
  const head = (await git("rev-parse", "HEAD")).trim();
  await run("git", ["--git-dir", remoteRoot, "update-ref", `refs/pull/${number}/head`, head], { cwd: workRoot });
  fs.mkdirSync(pullsRoot, { recursive: true });
  fs.writeFileSync(path.join(pullsRoot, `${number}.json`), `${JSON.stringify({
    number,
    title,
    base: "main",
    head: branch,
    head_sha: head,
    draft: true,
    simulated: true,
    readiness_evidence: path.relative(projectRoot, readinessPath)
  }, null, 2)}\n`);
}

function requireNewReadiness(previousCount, label) {
  const evidence = readinessEvidence();
  if (evidence.length <= previousCount) {
    throw new Error(`${label} did not produce new ready-for-draft-pr evidence. Inspect ${logsRoot}`);
  }
  return evidence.at(-1);
}

fs.rmSync(workRoot, { recursive: true, force: true });
fs.mkdirSync(workRoot, { recursive: true });
fs.cpSync(path.join(e2eRoot, "project"), projectRoot, { recursive: true });
await run("claude", ["--version"], { cwd: workRoot, timeout: 30_000 });
await run("git", ["init", "--bare", remoteRoot], { cwd: workRoot });
await run(process.execPath, [path.join(pluginRoot, "scripts", "harness-init.js"), projectRoot], { cwd: workRoot });
configureHarness();

await git("init", "-b", "main");
await git("config", "user.name", "Harness E2E");
await git("config", "user.email", "harness-e2e@example.invalid");
await git("remote", "add", "origin", remoteRoot);
await git("add", ".");
await git("commit", "-m", "Seed tiny task board and harness configuration");
await git("push", "-u", "origin", "main");
await run(process.execPath, [path.join(pluginRoot, "scripts", "harness-validate.js"), projectRoot], { cwd: workRoot });
await run(process.execPath, [path.join(pluginRoot, "scripts", "harness-doctor.js"), projectRoot], { cwd: workRoot });

await git("switch", "-c", "feature/task-board");
await claudeTurns("01-task-board", "/harness:run \"Deliver requirements/task-board-prd.md\" --through draft-pr --mode checkpoint", 0);
const firstEvidence = requireNewReadiness(0, "Initial PRD delivery");
await simulatePullRequest(1, "feature/task-board", "Deliver task board PRD", firstEvidence);

// This merge models the human-owned action between PRs; the harness never performs it.
await git("switch", "main");
await git("merge", "--no-ff", "feature/task-board", "-m", "Merge simulated PR #1");
await git("push", "origin", "main");
await git("switch", "-c", "feature/task-labels");
const priorEvidenceCount = readinessEvidence().length;
await claudeTurns("02-task-labels", "/harness:run \"Deliver requirements/task-labels-feature.md as a new feature\" --through draft-pr --mode checkpoint --existing-system", priorEvidenceCount);
const secondEvidence = requireNewReadiness(priorEvidenceCount, "Follow-up feature delivery");
await simulatePullRequest(2, "feature/task-labels", "Add task labels", secondEvidence);

const report = {
  status: "pass",
  project: projectRoot,
  simulated_pull_requests: [
    JSON.parse(fs.readFileSync(path.join(pullsRoot, "1.json"), "utf8")),
    JSON.parse(fs.readFileSync(path.join(pullsRoot, "2.json"), "utf8"))
  ],
  note: "Pull refs are local simulations; no network PR, merge, or deployment was authorized."
};
fs.writeFileSync(path.join(workRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`PASS full SDLC E2E. Report: ${path.join(workRoot, "report.json")}`);
