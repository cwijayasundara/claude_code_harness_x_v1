#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { operationalStatus } = require("../lib/sensor-operations");

const runner = path.resolve(__dirname, "..", "scripts", "harness-sensors.js");
const ignored = new Set([".git", ".claude", "node_modules", "dist", "build", ".venv", "venv", "coverage", "vendor", "generated"]);

function readInput() {
  const text = fs.readFileSync(0, "utf8");
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { throw new Error("Claude Code hook input must be valid JSON."); }
}
function projectRoot(input) { return path.resolve(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()); }
function active(root) { return fs.existsSync(path.join(root, ".claude", "harness.yaml")); }
function runtime(root) { return path.join(root, ".claude", "specs", "evidence", "runtime"); }
function relativeChangedPath(root, input) {
  const supplied = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (typeof supplied !== "string" || !supplied) return null;
  const absolute = path.resolve(root, supplied); const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep).some((part) => ignored.has(part))) return null;
  return relative;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function wait(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function queuePaths(root) {
  const file = path.join(runtime(root), "sensor-hook-queue.jsonl");
  if (!fs.existsSync(file)) return [];
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  fs.writeFileSync(file, "", "utf8");
  return [...new Set(rows.map((row) => row.path).filter(Boolean))];
}
function runSensors(root, paths) {
  const args = [runner, root];
  for (const changed of paths) args.push("--changed", changed);
  return spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 220000, killSignal: "SIGTERM" });
}
function correction(root, health, execution) {
  const report = health.report;
  const findings = (report?.sensors || []).filter((item) => item.status !== "pass" && item.disposition !== "waived" && item.disposition !== "quarantined").slice(0, 6);
  const details = findings.map((item) => `${item.sensor_id}: ${item.reason} NEXT: ${item.next_action}`).join("\n");
  const reasons = health.reasons.join("; ");
  const commandError = execution?.error ? ` Sensor runner error: ${execution.error.message}.` : "";
  return `Production sensor gate blocked completion: ${reasons || "sensor execution failed"}.${commandError}${details ? `\n${details}` : ""}\nRepair the findings and allow the hook to rerun. Do not claim completion.`;
}

async function schedule(input) {
  const root = projectRoot(input); if (!active(root)) return;
  const changed = relativeChangedPath(root, input); if (!changed) return;
  const directory = runtime(root); fs.mkdirSync(directory, { recursive: true });
  const queue = path.join(directory, "sensor-hook-queue.jsonl");
  fs.appendFileSync(queue, `${JSON.stringify({ path: changed, queued_at: new Date().toISOString(), session_id: input.session_id || null })}\n`);
  const lock = path.join(directory, "sensor-hook-worker.lock");
  try { fs.mkdirSync(lock); } catch (error) { if (error.code === "EEXIST") return; throw error; }
  try {
    await sleep(750);
    while (true) {
      const paths = queuePaths(root); if (!paths.length) break;
      runSensors(root, paths);
      await sleep(250);
    }
  } finally { fs.rmdirSync(lock); }
}

function gate(input, cadence) {
  const root = projectRoot(input); if (!active(root)) return 0;
  let health = operationalStatus(root, cadence);
  let execution = null;
  const rerunnable = health.reasons.some((reason) => /missing|freshness|different workspace state/.test(reason));
  if (rerunnable) {
    const lock = path.join(runtime(root), "sensor-hook-worker.lock");
    fs.mkdirSync(runtime(root), { recursive: true });
    const deadline = Date.now() + 200000;
    let acquired = false;
    while (!acquired && Date.now() < deadline) {
      try { fs.mkdirSync(lock); acquired = true; } catch (error) { if (error.code !== "EEXIST") throw error; wait(100); }
    }
    if (!acquired) {
      process.stderr.write("Production sensor gate blocked completion: background sensor execution did not finish within 200 seconds.\n");
      return 2;
    }
    try { execution = runSensors(root, []); } finally { fs.rmdirSync(lock); }
    health = operationalStatus(root, cadence);
  }
  if (execution?.status === 2 || health.status !== "pass") {
    process.stderr.write(`${correction(root, health, execution)}\n`);
    return 2;
  }
  return 0;
}

async function main() {
  const command = process.argv[2]; const input = readInput();
  if (command === "post-tool") await schedule(input);
  else if (command === "gate") process.exitCode = gate(input, process.argv[3] || "completion");
  else throw new Error("Unknown sensor lifecycle hook command.");
}
main().catch((error) => { process.stderr.write(`Production sensor hook error: ${error.message}\n`); process.exitCode = 2; });
