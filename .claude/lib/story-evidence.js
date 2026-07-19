const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/**
 * Run a focused command inside the target project and return structured evidence.
 * Prefer this over hand-written exit codes so red/green claims stay grounded.
 */
function runFocusedCommand(root, command, args = [], options = {}) {
  if (typeof command !== "string" || !command) throw new Error("command is required.");
  if (!Array.isArray(args)) throw new Error("args must be an array.");
  const timeoutMs = Number.isInteger(options.timeout_ms) ? options.timeout_ms : 30_000;
  // Nested under `node --test`, NODE_TEST_CONTEXT makes child `node --test`
  // exit 0 without running files. Always isolate unless the caller opts out.
  const env = { ...process.env, ...(options.env || {}) };
  if (options.inherit_test_context !== true) {
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_CHANNEL_FD;
  }
  const result = spawnSync(command, args, {
    cwd: path.resolve(root),
    encoding: "utf8",
    timeout: timeoutMs,
    env,
  });
  const exitCode = result.error && result.error.code === "ETIMEDOUT"
    ? 124
    : (result.status === null ? 1 : result.status);
  const rendered = [command, ...args].join(" ");
  return {
    command: rendered,
    argv: [command, ...args],
    exit_code: exitCode,
    stdout: (result.stdout || "").slice(0, 8_000),
    stderr: (result.stderr || "").slice(0, 8_000),
    timed_out: Boolean(result.error && result.error.code === "ETIMEDOUT"),
    executed_at: new Date().toISOString(),
  };
}

function writeEvidence(root, relativePath, payload) {
  const absolute = path.resolve(root, relativePath);
  const projectRoot = path.resolve(root);
  const relative = path.relative(projectRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Evidence path must stay inside the target project.");
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return relative;
}

function buildRedEvidence(run, {
  expected_failure,
  observed_failure,
  test_paths,
  notes = [],
}) {
  if (!run || !Number.isInteger(run.exit_code) || run.exit_code === 0) {
    throw new Error("RED evidence requires a non-zero exit_code from an executed command.");
  }
  if (!expected_failure || !observed_failure) throw new Error("expected_failure and observed_failure are required.");
  if (!Array.isArray(test_paths) || test_paths.length === 0) throw new Error("test_paths is required.");
  return {
    command: run.command,
    argv: run.argv,
    exit_code: run.exit_code,
    expected_failure,
    observed_failure,
    test_paths,
    stdout: run.stdout,
    stderr: run.stderr,
    executed_at: run.executed_at,
    notes,
  };
}

function buildImplementationEvidence(run, {
  changed_paths,
  test_paths,
  notes = [],
}) {
  if (!run || run.exit_code !== 0) {
    throw new Error("IMPLEMENT evidence requires exit_code 0 from an executed command.");
  }
  if (!Array.isArray(changed_paths) || changed_paths.length === 0) {
    throw new Error("changed_paths is required.");
  }
  if (!Array.isArray(test_paths) || test_paths.length === 0) throw new Error("test_paths is required.");
  return {
    command: run.command,
    argv: run.argv,
    exit_code: run.exit_code,
    changed_paths,
    test_paths,
    stdout: run.stdout,
    stderr: run.stderr,
    executed_at: run.executed_at,
    notes,
  };
}

module.exports = {
  buildImplementationEvidence,
  buildRedEvidence,
  runFocusedCommand,
  writeEvidence,
};
