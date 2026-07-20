/**
 * Deterministic maintainability / coding-craft sensors.
 * Run for both "on the loop" (/harness) and "outside the loop" (vibe) sessions —
 * same computational feedback regardless of co-design state.
 * Config: target .claude/project/maintainability.json (optional defaults).
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_EXTENSIONS = [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs", ".java", ".kt"];
const DEFAULT_IGNORE = ["node_modules", ".git", "dist", "build", ".venv", "venv", "vendor", "generated"];

const DEFAULTS = Object.freeze({
  version: 1,
  file_size: {
    max_lines: 300,
    warn_lines: 250,
    extensions: DEFAULT_EXTENSIONS,
    ignore_path_parts: DEFAULT_IGNORE,
  },
  function_size: {
    max_lines: 30,
    warn_lines: 25,
    severity: "fail",
    max_findings: 30,
    extensions: DEFAULT_EXTENSIONS,
    ignore_path_parts: DEFAULT_IGNORE,
  },
  code_complexity: {
    max_arguments: 5,
    warn_arguments: 4,
    max_cyclomatic: 12,
    warn_cyclomatic: 9,
    severity: "warn",
    max_findings: 30,
    extensions: DEFAULT_EXTENSIONS,
    ignore_path_parts: DEFAULT_IGNORE,
  },
  exception_handling: {
    severity: "fail",
    max_findings: 30,
    extensions: DEFAULT_EXTENSIONS,
    ignore_path_parts: DEFAULT_IGNORE,
  },
  logging: {
    severity: "warn",
    max_findings: 30,
    extensions: DEFAULT_EXTENSIONS,
    ignore_path_parts: [...DEFAULT_IGNORE, "test", "tests", "__tests__", "spec"],
  },
  performance: {
    severity: "warn",
    max_findings: 20,
    extensions: DEFAULT_EXTENSIONS,
    ignore_path_parts: [...DEFAULT_IGNORE, "test", "tests", "__tests__", "spec"],
  },
  duplication: {
    min_block_lines: 8,
    min_occurrences: 2,
    extensions: DEFAULT_EXTENSIONS,
    ignore_path_parts: [...DEFAULT_IGNORE, "test", "tests", "__tests__"],
    max_findings: 20,
    severity: "warn",
  },
});

function loadMaintainabilityConfig(root) {
  const filePath = path.join(path.resolve(root), ".claude", "project", "maintainability.json");
  if (!fs.existsSync(filePath)) {
    return { filePath, config: structuredClone(DEFAULTS), defaults: true };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.version !== 1) throw new Error(`${filePath} must declare version 1.`);
  return {
    filePath,
    defaults: false,
    config: {
      version: 1,
      file_size: { ...DEFAULTS.file_size, ...(parsed.file_size || {}) },
      function_size: { ...DEFAULTS.function_size, ...(parsed.function_size || {}) },
      code_complexity: { ...DEFAULTS.code_complexity, ...(parsed.code_complexity || {}) },
      exception_handling: { ...DEFAULTS.exception_handling, ...(parsed.exception_handling || {}) },
      logging: { ...DEFAULTS.logging, ...(parsed.logging || {}) },
      performance: { ...DEFAULTS.performance, ...(parsed.performance || {}) },
      duplication: { ...DEFAULTS.duplication, ...(parsed.duplication || {}) },
    },
  };
}

function inspectPaths(root, changedPaths, settings) {
  let paths = resolveInspectPaths(root, changedPaths, settings.extensions, settings.ignore_path_parts);
  if (paths.length === 0 && (changedPaths.length === 0 || changedPaths.includes("."))) {
    paths = [];
    walkFiles(path.resolve(root), path.resolve(root), settings.extensions, settings.ignore_path_parts, paths);
  }
  return paths;
}

function summarizeFindings(findings, paths, {
  failLabel, warnLabel, passEmpty, passOk, nextFail, nextWarn,
}) {
  const fails = findings.filter((item) => item.level === "fail");
  const warns = findings.filter((item) => item.level === "warn");
  if (fails.length) {
    return {
      status: "fail",
      findings,
      affectedPaths: [...new Set(fails.map((item) => item.path))],
      reason: `${failLabel}: ${fails.map((item) => item.message).join(" ")}`,
      nextAction: nextFail,
    };
  }
  if (warns.length) {
    return {
      status: "warn",
      findings,
      affectedPaths: [...new Set(warns.map((item) => item.path))],
      reason: `${warnLabel}: ${warns.map((item) => item.message).join(" ")}`,
      nextAction: nextWarn,
    };
  }
  return {
    status: "pass",
    findings: [],
    affectedPaths: paths.length > 0 ? paths : ["."],
    reason: paths.length === 0 ? passEmpty : passOk(paths.length),
    nextAction: "No action required.",
  };
}

function leadingIndent(line) {
  const match = line.match(/^(\s*)/);
  return match ? match[1].replace(/\t/g, "  ").length : 0;
}

function isFunctionStart(line, ext) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) return false;
  if (ext === ".py") {
    return /^(async\s+)?def\s+[A-Za-z_][\w]*\s*\(/.test(trimmed);
  }
  // JS/TS/Java-ish
  if (/^(export\s+)?(async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(trimmed)) return true;
  if (/^(export\s+)?(async\s+)?function\s*\(/.test(trimmed)) return true;
  if (/^(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?\(/.test(trimmed) && /=>/.test(trimmed)) return true;
  if (/^(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s+)?function\b/.test(trimmed)) return true;
  if (/^(public|private|protected|static|async|\s)*[A-Za-z_$][\w$]*\s*\([^;]*\)\s*\{?\s*$/.test(trimmed)
    && !/^(if|for|while|switch|catch|return)\b/.test(trimmed)) {
    return /\{?\s*$/.test(trimmed) && !trimmed.includes("=");
  }
  return false;
}

function functionName(line) {
  const def = line.match(/(?:async\s+)?def\s+([A-Za-z_][\w]*)/);
  if (def) return def[1];
  const fn = line.match(/function\s+([A-Za-z_$][\w$]*)/);
  if (fn) return fn[1];
  const arrow = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
  if (arrow) return arrow[1];
  const method = line.match(/([A-Za-z_$][\w$]*)\s*\(/);
  return method ? method[1] : "anonymous";
}

/**
 * Approximate function bodies by indent (Python) or brace depth (C-like).
 */
function extractFunctions(text, relativePath) {
  const ext = path.extname(relativePath);
  const lines = text.split(/\r?\n/);
  const functions = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!isFunctionStart(line, ext)) {
      i += 1;
      continue;
    }
    const name = functionName(line);
    const start = i + 1;
    const startIndent = leadingIndent(line);
    let end = i;
    if (ext === ".py") {
      let j = i + 1;
      while (j < lines.length) {
        const raw = lines[j];
        if (raw.trim() === "") {
          j += 1;
          continue;
        }
        if (leadingIndent(raw) <= startIndent && !raw.trim().startsWith("#")) break;
        j += 1;
      }
      end = j - 1;
    } else {
      let depth = 0;
      let seenBrace = false;
      let j = i;
      for (; j < lines.length; j += 1) {
        const raw = lines[j];
        for (const ch of raw) {
          if (ch === "{") {
            depth += 1;
            seenBrace = true;
          } else if (ch === "}") {
            depth -= 1;
          }
        }
        if (seenBrace && depth <= 0) break;
        // arrow one-liner without braces
        if (j === i && /=>/.test(raw) && !raw.includes("{")) {
          break;
        }
      }
      end = j;
    }
    const bodyLines = Math.max(1, end - i + 1);
    functions.push({ name, start, end: end + 1, lines: bodyLines, path: relativePath });
    i = Math.max(i + 1, end + 1);
  }
  return functions;
}

function isIgnored(relativePath, ignoreParts) {
  const parts = relativePath.split(/[/\\]/);
  return parts.some((part) => ignoreParts.includes(part));
}

function shouldInspect(relativePath, extensions, ignoreParts) {
  if (isIgnored(relativePath, ignoreParts)) return false;
  return extensions.includes(path.extname(relativePath));
}

function resolveInspectPaths(root, changedPaths, extensions, ignoreParts) {
  const rootResolved = path.resolve(root);
  const files = [];
  for (const item of changedPaths) {
    if (item === "." || item === "") {
      // expand handled by caller via project files
      continue;
    }
    const full = path.join(rootResolved, item);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isFile() && shouldInspect(item, extensions, ignoreParts)) {
      files.push(item);
    } else if (stat.isDirectory()) {
      // only when explicitly changed path is a directory
      walkFiles(full, rootResolved, extensions, ignoreParts, files);
    }
  }
  return [...new Set(files)];
}

function walkFiles(directory, rootResolved, extensions, ignoreParts, out) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(rootResolved, full);
    if (entry.isDirectory()) {
      if (ignoreParts.includes(entry.name)) continue;
      walkFiles(full, rootResolved, extensions, ignoreParts, out);
    } else if (entry.isFile() && shouldInspect(relative, extensions, ignoreParts)) {
      out.push(relative);
    }
  }
}

function countLines(text) {
  if (!text) return 0;
  return text.replace(/\n$/, "").split(/\r?\n/).length;
}

/**
 * @returns {{ status: 'pass'|'warn'|'fail', findings: Array, reason: string, nextAction: string, affectedPaths: string[] }}
 */
function checkFileSizes(root, changedPaths, options = {}) {
  const { config } = options.config ? { config: options.config } : loadMaintainabilityConfig(root);
  const settings = config.file_size;
  const paths = inspectPaths(root, changedPaths, settings);
  const findings = [];
  for (const relative of paths) {
    const full = path.join(path.resolve(root), relative);
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = countLines(text);
    if (lines > settings.max_lines) {
      findings.push({
        path: relative, lines, level: "fail", limit: settings.max_lines,
        message: `${relative} has ${lines} lines (max ${settings.max_lines}).`,
      });
    } else if (lines > settings.warn_lines) {
      findings.push({
        path: relative, lines, level: "warn", limit: settings.warn_lines,
        message: `${relative} has ${lines} lines (warn at ${settings.warn_lines}, max ${settings.max_lines}).`,
      });
    }
  }
  return summarizeFindings(findings, paths, {
    failLabel: "File size limit exceeded",
    warnLabel: "File size approaching limit",
    passEmpty: "No source files in scope for file-size sensor.",
    passOk: (n) => `All ${n} inspected file(s) are within the line budget (max ${settings.max_lines}).`,
    nextFail: `Split oversized modules (max ${settings.max_lines} lines) or raise the limit in .claude/project/maintainability.json with explicit human justification.`,
    nextWarn: `Extract cohesive units before files exceed ${settings.max_lines} lines.`,
  });
}

function checkFunctionSizes(root, changedPaths, options = {}) {
  const { config } = options.config ? { config: options.config } : loadMaintainabilityConfig(root);
  const settings = config.function_size;
  const paths = inspectPaths(root, changedPaths, settings);
  const findings = [];
  const severityFail = settings.severity === "warn" ? "warn" : "fail";
  for (const relative of paths) {
    let text;
    try {
      text = fs.readFileSync(path.join(path.resolve(root), relative), "utf8");
    } catch {
      continue;
    }
    for (const fn of extractFunctions(text, relative)) {
      if (fn.lines > settings.max_lines) {
        findings.push({
          path: relative,
          level: severityFail,
          name: fn.name,
          lines: fn.lines,
          start: fn.start,
          message: `${relative}:${fn.start} function '${fn.name}' is ${fn.lines} lines (max ${settings.max_lines}).`,
        });
      } else if (fn.lines > settings.warn_lines) {
        findings.push({
          path: relative,
          level: "warn",
          name: fn.name,
          lines: fn.lines,
          start: fn.start,
          message: `${relative}:${fn.start} function '${fn.name}' is ${fn.lines} lines (warn at ${settings.warn_lines}).`,
        });
      }
      if (findings.length >= (settings.max_findings || 30)) break;
    }
    if (findings.length >= (settings.max_findings || 30)) break;
  }
  return summarizeFindings(findings, paths, {
    failLabel: "Function size limit exceeded",
    warnLabel: "Function size approaching limit",
    passEmpty: "No source files in scope for function-size sensor.",
    passOk: (n) => `Functions in ${n} file(s) stay within ${settings.max_lines} lines.`,
    nextFail: `Extract helpers so each function is ≤ ${settings.max_lines} lines (single responsibility).`,
    nextWarn: `Keep functions near ≤ ${settings.max_lines} lines; split before they grow further.`,
  });
}

function functionArguments(startLine) {
  const open = startLine.indexOf("(");
  const close = startLine.lastIndexOf(")");
  if (open < 0 || close <= open) return [];
  const raw = startLine.slice(open + 1, close).trim();
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function cyclomaticComplexity(lines) {
  let complexity = 1;
  for (const line of lines) {
    const code = normalizeCodeLine(line);
    complexity += (code.match(/\b(if|elif|else if|for|while|case|catch|except)\b/g) || []).length;
    complexity += (code.match(/&&|\|\||\?[^?:]/g) || []).length;
  }
  return complexity;
}

function checkCodeComplexity(root, changedPaths, options = {}) {
  const { config } = options.config ? { config: options.config } : loadMaintainabilityConfig(root);
  const settings = config.code_complexity;
  const paths = inspectPaths(root, changedPaths, settings);
  const findings = [];
  const limitLevel = settings.severity === "fail" ? "fail" : "warn";
  for (const relative of paths) {
    let text;
    try { text = fs.readFileSync(path.join(path.resolve(root), relative), "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (const fn of extractFunctions(text, relative)) {
      const args = functionArguments(lines[fn.start - 1] || "");
      const complexity = cyclomaticComplexity(lines.slice(fn.start - 1, fn.end));
      if (args.length > settings.max_arguments) {
        findings.push({ path: relative, level: limitLevel, line: fn.start, name: fn.name, metric: "arguments", value: args.length,
          message: `${relative}:${fn.start} function '${fn.name}' has ${args.length} arguments (max ${settings.max_arguments}).` });
      } else if (args.length > settings.warn_arguments) {
        findings.push({ path: relative, level: "warn", line: fn.start, name: fn.name, metric: "arguments", value: args.length,
          message: `${relative}:${fn.start} function '${fn.name}' has ${args.length} arguments (warn at ${settings.warn_arguments}).` });
      }
      if (complexity > settings.max_cyclomatic) {
        findings.push({ path: relative, level: limitLevel, line: fn.start, name: fn.name, metric: "cyclomatic", value: complexity,
          message: `${relative}:${fn.start} function '${fn.name}' has estimated cyclomatic complexity ${complexity} (max ${settings.max_cyclomatic}).` });
      } else if (complexity > settings.warn_cyclomatic) {
        findings.push({ path: relative, level: "warn", line: fn.start, name: fn.name, metric: "cyclomatic", value: complexity,
          message: `${relative}:${fn.start} function '${fn.name}' has estimated cyclomatic complexity ${complexity} (warn at ${settings.warn_cyclomatic}).` });
      }
      if (findings.length >= settings.max_findings) break;
    }
    if (findings.length >= settings.max_findings) break;
  }
  return summarizeFindings(findings, paths, {
    failLabel: "Code complexity limits exceeded",
    warnLabel: "Code complexity risk",
    passEmpty: "No source files in scope for code-complexity sensor.",
    passOk: (n) => `Argument count and estimated cyclomatic complexity are within limits in ${n} file(s).`,
    nextFail: "Introduce a cohesive parameter object or split decision logic into named units, then rerun sensors.",
    nextWarn: "Review the function's responsibilities; prefer a parameter object and simpler decision paths before complexity grows.",
  });
}

function checkExceptionHandling(root, changedPaths, options = {}) {
  const { config } = options.config ? { config: options.config } : loadMaintainabilityConfig(root);
  const settings = config.exception_handling;
  const paths = inspectPaths(root, changedPaths, settings);
  const findings = [];
  const failLevel = settings.severity === "warn" ? "warn" : "fail";

  for (const relative of paths) {
    let text;
    try {
      text = fs.readFileSync(path.join(path.resolve(root), relative), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const ext = path.extname(relative);
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (ext === ".py") {
        if (/^except\s*:\s*$/.test(trimmed) || /^except\s*:\s*pass\s*$/.test(trimmed)) {
          findings.push({
            path: relative, level: failLevel, line: i + 1,
            message: `${relative}:${i + 1} bare except: — catch specific exceptions and handle or re-raise.`,
          });
        }
        if (/^except\s+Exception(\s+as\s+\w+)?\s*:\s*$/.test(trimmed)) {
          const next = (lines[i + 1] || "").trim();
          if (next === "pass" || next === "...") {
            findings.push({
              path: relative, level: failLevel, line: i + 1,
              message: `${relative}:${i + 1} swallows Exception with pass — log, translate, or re-raise.`,
            });
          }
        }
        if (/^except\b/.test(trimmed) && /:\s*pass\s*$/.test(trimmed)) {
          findings.push({
            path: relative, level: failLevel, line: i + 1,
            message: `${relative}:${i + 1} except …: pass swallows errors silently.`,
          });
        }
      } else {
        if (/^catch\s*\([^)]*\)\s*\{\s*\}\s*$/.test(trimmed) || /^catch\s*\{\s*\}\s*$/.test(trimmed)) {
          findings.push({
            path: relative, level: failLevel, line: i + 1,
            message: `${relative}:${i + 1} empty catch block — log, map to domain error, or rethrow.`,
          });
        }
        if (/^catch\s*\([^)]*\)\s*\{\s*$/.test(trimmed) || /^catch\s*\{\s*$/.test(trimmed)) {
          const body = (lines[i + 1] || "").trim();
          if (body === "}" || body === "/* ignore */" || body === "// ignore") {
            findings.push({
              path: relative, level: failLevel, line: i + 1,
              message: `${relative}:${i + 1} empty/ignore catch — do not swallow failures silently.`,
            });
          }
        }
        if (/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(trimmed)) {
          findings.push({
            path: relative, level: failLevel, line: i + 1,
            message: `${relative}:${i + 1} empty catch — handle or rethrow with context.`,
          });
        }
      }
      if (findings.length >= (settings.max_findings || 30)) break;
    }
    if (findings.length >= (settings.max_findings || 30)) break;
  }

  return summarizeFindings(findings, paths, {
    failLabel: "Exception handling issues",
    warnLabel: "Exception handling issues",
    passEmpty: "No source files in scope for exception-handling sensor.",
    passOk: (n) => `No bare/empty exception swallows detected in ${n} file(s).`,
    nextFail: "Catch specific failures, log with context, rethrow or return a typed error — never empty catch/except pass.",
    nextWarn: "Review catch/except blocks for silent failure.",
  });
}

function hasLogSignal(line) {
  return /\b(log|logger|logging|console\.(error|warn|info|debug)|structlog|trace|span|metrics)\b/i.test(line)
    || /\b(logger\.|LOG\.|log_)\w*/.test(line);
}

function checkLoggingDiscipline(root, changedPaths, options = {}) {
  const { config } = options.config ? { config: options.config } : loadMaintainabilityConfig(root);
  const settings = config.logging;
  const paths = inspectPaths(root, changedPaths, settings);
  const findings = [];
  const level = settings.severity === "fail" ? "fail" : "warn";

  for (const relative of paths) {
    let text;
    try {
      text = fs.readFileSync(path.join(path.resolve(root), relative), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const ext = path.extname(relative);
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      const isCatch = ext === ".py"
        ? /^except\b/.test(trimmed)
        : /(^|\})\s*catch\b/.test(trimmed);
      if (!isCatch) continue;
      const window = lines.slice(i, Math.min(lines.length, i + 8)).join("\n");
      if (!hasLogSignal(window) && !/\braise\b|\bthrow\b|\brethrow\b|\breturn\b/.test(window)) {
        findings.push({
          path: relative,
          level,
          line: i + 1,
          message: `${relative}:${i + 1} catch/except without log, rethrow, or explicit return — add structured logging for support.`,
        });
      }
      // production print noise
      if (/\bprint\s*\(/.test(window) && !/test|debug/i.test(relative)) {
        findings.push({
          path: relative,
          level: "warn",
          line: i + 1,
          message: `${relative}:${i + 1} uses print() near error handling — prefer structured logger for production support.`,
        });
      }
      if (findings.length >= (settings.max_findings || 30)) break;
    }
    // bare print in non-test modules (warn)
    if (!/(^|\/)(test|tests|__tests__|spec)(\/|$)/i.test(relative)) {
      for (let i = 0; i < lines.length; i += 1) {
        if (/^\s*print\s*\(/.test(lines[i]) || /^\s*console\.log\s*\(/.test(lines[i])) {
          findings.push({
            path: relative,
            level: "warn",
            line: i + 1,
            message: `${relative}:${i + 1} debug print/console.log — use leveled structured logging for production support.`,
          });
          if (findings.length >= (settings.max_findings || 30)) break;
        }
      }
    }
    if (findings.length >= (settings.max_findings || 30)) break;
  }

  return summarizeFindings(findings, paths, {
    failLabel: "Logging discipline issues",
    warnLabel: "Logging discipline issues",
    passEmpty: "No source files in scope for logging sensor.",
    passOk: (n) => `Logging heuristics clean on ${n} file(s).`,
    nextFail: "On failure paths: structured log (level, correlation id, error) then rethrow or return typed error.",
    nextWarn: "Replace print/console.log with structured logger; log exceptions with context for ops support.",
  });
}

function checkPerformanceHeuristics(root, changedPaths, options = {}) {
  const { config } = options.config ? { config: options.config } : loadMaintainabilityConfig(root);
  const settings = config.performance;
  const paths = inspectPaths(root, changedPaths, settings);
  const findings = [];
  const level = settings.severity === "fail" ? "fail" : "warn";

  for (const relative of paths) {
    let text;
    try {
      text = fs.readFileSync(path.join(path.resolve(root), relative), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    let loopDepth = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      const opensLoop = /^(for|while)\b/.test(trimmed)
        || /\.forEach\s*\(/.test(trimmed)
        || /\.map\s*\(\s*(async\s*)?\(/.test(trimmed);
      const closes = (trimmed.match(/\}/g) || []).length;
      const opens = (trimmed.match(/\{/g) || []).length;
      if (opensLoop) {
        if (loopDepth >= 1) {
          findings.push({
            path: relative,
            level,
            line: i + 1,
            message: `${relative}:${i + 1} nested loop/map/forEach — likely O(n²); pre-index, batch, or move work out of inner loop.`,
          });
        }
        loopDepth += 1;
      }
      loopDepth = Math.max(0, loopDepth + opens - closes);
      if (loopDepth > 0 && /(\w+)\s*\+=\s*['"`]/.test(trimmed)) {
        findings.push({
          path: relative,
          level: "warn",
          line: i + 1,
          message: `${relative}:${i + 1} string += inside a loop — use join/builder to avoid quadratic allocation.`,
        });
      }
      if (/\.sort\s*\([^)]*\)\s*\.sort\s*\(/.test(trimmed)) {
        findings.push({
          path: relative,
          level: "warn",
          line: i + 1,
          message: `${relative}:${i + 1} chained sorts — confirm intent; prefer single pass with comparator.`,
        });
      }
      if (findings.length >= (settings.max_findings || 20)) break;
    }
    if (findings.length >= (settings.max_findings || 20)) break;
  }

  return summarizeFindings(findings, paths, {
    failLabel: "Performance heuristics",
    warnLabel: "Performance heuristics",
    passEmpty: "No source files in scope for performance sensor.",
    passOk: (n) => `No nested-loop / string-concat-in-loop smells in ${n} file(s).`,
    nextFail: "Remove nested full scans; measure against G3 budgets when hot.",
    nextWarn: "Fix nested loops and in-loop string concat; add a measured budget if this is a hotspot.",
  });
}

function normalizeCodeLine(line) {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/#.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function significantLines(text) {
  return text
    .split(/\r?\n/)
    .map(normalizeCodeLine)
    .filter((line) => line.length > 0 && !/^[{}();,]+$/.test(line));
}

/**
 * Near-duplication via fixed-size normalized line-block fingerprints.
 */
function checkNearDuplication(root, changedPaths, options = {}) {
  const { config } = options.config ? { config: options.config } : loadMaintainabilityConfig(root);
  const settings = config.duplication;
  const changed = inspectPaths(root, changedPaths, settings);
  const paths = inspectPaths(root, ["."], settings);
  const changedSet = new Set(changed);

  /** @type {Map<string, Array<{ path: string, start: number, end: number, preview: string }>>} */
  const fingerprints = new Map();
  const minLines = Math.max(4, Number(settings.min_block_lines) || 8);

  for (const relative of paths) {
    const full = path.join(path.resolve(root), relative);
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lines = significantLines(text);
    if (lines.length < minLines) continue;
    for (let index = 0; index <= lines.length - minLines; index += 1) {
      const block = lines.slice(index, index + minLines);
      const preview = block.slice(0, 3).join(" | ");
      const digest = crypto.createHash("sha256").update(block.join("\n")).digest("hex").slice(0, 16);
      const list = fingerprints.get(digest) || [];
      // Skip heavily overlapping windows in the same file (step roughly half block).
      const last = list[list.length - 1];
      if (last && last.path === relative && index < last.end - Math.floor(minLines / 2)) {
        continue;
      }
      list.push({ path: relative, start: index + 1, end: index + minLines, preview });
      fingerprints.set(digest, list);
    }
  }

  const findings = [];
  const minOcc = Math.max(2, Number(settings.min_occurrences) || 2);
  for (const [digest, locations] of fingerprints.entries()) {
    if (locations.length < minOcc) continue;
    if (!locations.some((item) => changedSet.has(item.path))) continue;
    const distinctPaths = new Set(locations.map((item) => item.path));
    // Prefer cross-file clones; allow same-file if far apart enough already filtered.
    if (distinctPaths.size < 2 && locations.length < minOcc) continue;
    if (distinctPaths.size < 2) {
      // same-file only: keep if at least 2 non-overlapping
      const sorted = [...locations].sort((a, b) => a.start - b.start);
      let count = 0;
      let lastEnd = -1;
      for (const loc of sorted) {
        if (loc.start >= lastEnd) {
          count += 1;
          lastEnd = loc.end;
        }
      }
      if (count < minOcc) continue;
    }
    findings.push({
      digest,
      occurrences: locations.length,
      paths: [...distinctPaths],
      samples: locations.slice(0, 4),
      message: `Near-duplicate block (${minLines}+ significant lines) in ${[...distinctPaths].join(", ")}`,
    });
  }

  findings.sort((a, b) => b.occurrences - a.occurrences || a.message.localeCompare(b.message));
  const capped = findings.slice(0, settings.max_findings || 20);
  const severity = settings.severity === "fail" ? "fail" : "warn";

  if (capped.length === 0) {
    return {
      status: "pass",
      findings: [],
      affectedPaths: changed.length > 0 ? changed : ["."],
      reason: paths.length === 0
        ? "No source files in scope for duplication sensor."
        : `No changed-code clone found against ${paths.length} eligible repository file(s).`,
      nextAction: "No action required.",
    };
  }

  const affected = [...new Set(capped.flatMap((item) => item.paths))];
  return {
    status: severity,
    findings: capped,
    affectedPaths: affected,
    reason: `Near-duplication detected (${capped.length} cluster(s)): ${capped.map((item) => item.message).join("; ")}`,
    nextAction:
      "Reuse one implementation (or extract a shared helper) for duplicated blocks; "
      + "only keep parallel copies with an approved justified-divergence. "
      + "Adjust .claude/project/maintainability.json if thresholds are wrong.",
  };
}

/**
 * All maintainability/craft sensors — same set for vibe and /harness sessions.
 * @returns {Array<{ sensorId: string, label: string, result: object }>}
 */
function runAllMaintainabilitySensors(root, changedPaths, options = {}) {
  const loaded = options.config
    ? { config: options.config }
    : loadMaintainabilityConfig(root);
  const opts = { config: loaded.config };
  return [
    { sensorId: "file-size", label: "File size", result: checkFileSizes(root, changedPaths, opts) },
    { sensorId: "function-size", label: "Function size", result: checkFunctionSizes(root, changedPaths, opts) },
    { sensorId: "code-complexity", label: "Code complexity", result: checkCodeComplexity(root, changedPaths, opts) },
    { sensorId: "exception-handling", label: "Exception handling", result: checkExceptionHandling(root, changedPaths, opts) },
    { sensorId: "logging-discipline", label: "Logging discipline", result: checkLoggingDiscipline(root, changedPaths, opts) },
    { sensorId: "performance-heuristics", label: "Performance heuristics", result: checkPerformanceHeuristics(root, changedPaths, opts) },
    { sensorId: "near-duplication", label: "Near-duplication", result: checkNearDuplication(root, changedPaths, opts) },
  ];
}

module.exports = {
  DEFAULTS,
  loadMaintainabilityConfig,
  checkFileSizes,
  checkFunctionSizes,
  checkCodeComplexity,
  checkExceptionHandling,
  checkLoggingDiscipline,
  checkPerformanceHeuristics,
  checkNearDuplication,
  runAllMaintainabilitySensors,
  extractFunctions,
  countLines,
  significantLines,
};
