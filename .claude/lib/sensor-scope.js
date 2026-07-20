const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const IGNORED_DIRECTORIES = new Set([".git", ".claude", "node_modules", "dist", "build", ".venv", "venv"]);

function gitOutput(root, args) {
  return spawnSync("git", ["-C", path.resolve(root), ...args], { encoding: "utf8" });
}

function statusPath(line) {
  const body = line.slice(3);
  const destination = body.includes(" -> ") ? body.split(" -> ").at(-1) : body;
  return destination.replace(/^"|"$/g, "");
}

function gitChangedPaths(root) {
  const result = gitOutput(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (result.status !== 0) return [];
  return [...new Set(result.stdout.split(/\r?\n/).filter(Boolean).map(statusPath).filter(Boolean))];
}

function projectFiles(root) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  const pending = [resolvedRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) files.push(path.relative(resolvedRoot, fullPath));
    }
  }
  return files.sort();
}

function resolveInspectionPaths(root, requestedPaths) {
  if (requestedPaths.length === 0 || requestedPaths.includes(".")) return projectFiles(root);
  return [...new Set(requestedPaths)];
}

function workspaceFingerprint(root) {
  const resolvedRoot = path.resolve(root);
  const headResult = gitOutput(resolvedRoot, ["rev-parse", "HEAD"]);
  const head = headResult.status === 0 ? headResult.stdout.trim() : "no-git-head";
  const changed = gitChangedPaths(resolvedRoot)
    .filter((relative) => relative !== "CLAUDE.md" && !relative.startsWith(".claude/"))
    .sort();
  const hash = crypto.createHash("sha256");
  hash.update(`${head}\n`);
  for (const relative of changed) {
    hash.update(`${relative}\0`);
    const fullPath = path.join(resolvedRoot, relative);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) hash.update(fs.readFileSync(fullPath));
    else hash.update("<deleted>");
    hash.update("\0");
  }
  return { head, changed_paths: changed, sha256: hash.digest("hex") };
}

module.exports = { gitChangedPaths, projectFiles, resolveInspectionPaths, workspaceFingerprint };
