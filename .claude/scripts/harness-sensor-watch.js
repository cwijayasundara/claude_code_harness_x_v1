#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadOperationsPolicy } = require("../lib/sensor-operations");

const runner = path.join(__dirname, "harness-sensors.js");
const ignoredDirectories = new Set([".git", ".claude", "node_modules", "dist", "build", ".venv", "venv"]);

function parseArguments(args) {
  const parsed = { root: ".", debounceMs: 500, once: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--once") parsed.once = true;
    else if (argument === "--debounce-ms") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 100 || value > 60000) throw new Error("--debounce-ms must be an integer from 100 to 60000.");
      parsed.debounceMs = value;
      index += 1;
    } else if (!argument.startsWith("-") && parsed.root === ".") parsed.root = argument;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function isIgnored(relativePath) {
  return relativePath.split(path.sep).some((part) => ignoredDirectories.has(part));
}

function writeReceipt(root, receipt) {
  const receiptPath = path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-watch.json");
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

function latestSensorStatus(root) {
  const reportPath = path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-report.json");
  if (!fs.existsSync(reportPath)) return "unknown";
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8")).status || "unknown";
  } catch {
    return "unknown";
  }
}

function runSensors(root, changedPaths, receipt) {
  const args = [runner, root];
  if (changedPaths.length === 0) args.push("--all");
  else for (const changedPath of changedPaths) args.push("--changed", changedPath);
  receipt.last_started_at = new Date().toISOString();
  writeReceipt(root, receipt);
  process.stdout.write(`CHECK ${changedPaths.length === 0 ? "project-wide" : changedPaths.join(", ")}\n`);
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
  child.on("error", (error) => process.stderr.write(`ERROR: Unable to run sensors: ${error.message}\n`));
  child.on("close", (code) => {
    receipt.runs += 1;
    receipt.last_completed_at = new Date().toISOString();
    receipt.last_exit_code = code;
    receipt.last_status = latestSensorStatus(root);
    if (receipt.mode === "once") {
      receipt.state = "stopped";
      receipt.stopped_at = new Date().toISOString();
    }
    writeReceipt(root, receipt);
    process.stdout.write(`STATUS ${receipt.last_status}; run harness-status.js . --agent for correction guidance.\n`);
  });
  return child;
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(2);
}

const root = path.resolve(options.root);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  process.stderr.write(`ERROR: Target project directory does not exist: ${root}\n`);
  process.exit(2);
}

const receipt = {
  started_at: new Date().toISOString(),
  heartbeat_at: new Date().toISOString(),
  state: "starting",
  pid: process.pid,
  mode: options.once ? "once" : "watch",
  debounce_ms: options.debounceMs,
  runs: 0,
  last_status: "not-run",
};
writeReceipt(root, receipt);

if (options.once) {
  receipt.state = "running";
  receipt.backend = "once";
  writeReceipt(root, receipt);
  runSensors(root, [], receipt);
} else {
  const pending = new Set();
  let timer;
  let running = false;
  let rerunRequested = false;

  function flush() {
    if (running) {
      rerunRequested = true;
      return;
    }
    const paths = [...pending];
    pending.clear();
    if (paths.length === 0) return;
    running = true;
    const child = runSensors(root, paths, receipt);
    child.on("close", () => {
      running = false;
      if (rerunRequested || pending.size > 0) {
        rerunRequested = false;
        flush();
      }
    });
  }

  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const changedPath = filename.toString();
      if (isIgnored(changedPath)) return;
      pending.add(changedPath);
      clearTimeout(timer);
      timer = setTimeout(flush, options.debounceMs);
    });
    receipt.backend = "native-recursive";
  } catch (error) {
    const watchers = [];
    const visit = (directory) => {
      const relativeDirectory = path.relative(root, directory);
      if (relativeDirectory && isIgnored(relativeDirectory)) return;
      watchers.push(fs.watch(directory, (_event, filename) => {
        if (!filename) return;
        const changedPath = path.relative(root, path.join(directory, filename.toString()));
        if (isIgnored(changedPath)) return;
        pending.add(changedPath);
        clearTimeout(timer);
        timer = setTimeout(flush, options.debounceMs);
      }));
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) visit(path.join(directory, entry.name));
    };
    try { visit(root); } catch (fallbackError) {
      for (const item of watchers) item.close();
      process.stderr.write(`ERROR: Unable to watch ${root}: ${error.message}; fallback: ${fallbackError.message}\n`);
      process.exit(2);
    }
    watcher = { close: () => watchers.forEach((item) => item.close()) };
    receipt.backend = "portable-directory-watch";
  }

  receipt.state = "running";
  receipt.heartbeat_at = new Date().toISOString();
  writeReceipt(root, receipt);
  const { policy } = loadOperationsPolicy(root);
  const heartbeat = setInterval(() => {
    receipt.heartbeat_at = new Date().toISOString();
    writeReceipt(root, receipt);
  }, Math.max(1000, Math.floor(policy.watch_heartbeat_seconds * 500)));
  process.stdout.write(`WATCH ${root} (debounce ${options.debounceMs}ms). Press Ctrl-C to stop.\n`);
  function stop() {
    watcher.close();
    clearTimeout(timer);
    clearInterval(heartbeat);
    receipt.state = "stopped";
    receipt.stopped_at = new Date().toISOString();
    writeReceipt(root, receipt);
    process.stdout.write("WATCH stopped.\n");
    process.exit(0);
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("uncaughtException", (error) => {
    receipt.state = "crashed";
    receipt.error = error.message;
    receipt.stopped_at = new Date().toISOString();
    writeReceipt(root, receipt);
    process.stderr.write(`ERROR: Sensor watcher crashed: ${error.message}\n`);
    process.exit(2);
  });
}
