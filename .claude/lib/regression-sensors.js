const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULTS = Object.freeze({
  version: 1,
  coverage: {
    enabled: false,
    report_path: "coverage/coverage-summary.json",
    minimum_lines_pct: 80,
    minimum_branches_pct: 70,
    minimum_changed_lines_pct: 90,
    minimum_changed_branches_pct: 80,
    severity: "warn",
    command: null,
    args: [],
    changed_args: [],
  },
  mutation: {
    enabled: false,
    report_path: "reports/mutation/mutation.json",
    minimum_score_pct: 70,
    minimum_changed_score_pct: 80,
    maximum_changed_survivors: 0,
    maximum_changed_no_coverage: 0,
    severity: "warn",
    command: null,
    args: [],
    changed_args: ["--mutate", "{paths}"],
  },
  test_integrity: {
    enabled: true,
    severity: "warn",
    test_path_pattern: "(^|/)(test|tests|__tests__|spec)(/|$)|[._-](test|spec)\\.",
  },
  property: { enabled: false, report_path: "reports/property.json", minimum_cases: 100, maximum_failures: 0, severity: "warn", command: null, args: [], changed_args: [] },
  fuzz: { enabled: false, report_path: "reports/fuzz.json", minimum_cases: 1000, maximum_failures: 0, severity: "warn", command: null, args: [], changed_args: [] },
});

function loadRegressionConfig(root) {
  const filePath = path.join(path.resolve(root), ".claude", "project", "regression-sensors.json");
  if (!fs.existsSync(filePath)) return { filePath, defaults: true, config: structuredClone(DEFAULTS) };
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.version !== 1) throw new Error(`${filePath} must declare version 1.`);
  const config = {
    version: 1,
    coverage: { ...DEFAULTS.coverage, ...(parsed.coverage || {}) },
    mutation: { ...DEFAULTS.mutation, ...(parsed.mutation || {}) },
    test_integrity: { ...DEFAULTS.test_integrity, ...(parsed.test_integrity || {}) },
    property: { ...DEFAULTS.property, ...(parsed.property || {}) },
    fuzz: { ...DEFAULTS.fuzz, ...(parsed.fuzz || {}) },
  };
  for (const [name, settings] of Object.entries({ coverage: config.coverage, mutation: config.mutation, property: config.property, fuzz: config.fuzz })) {
    if (typeof settings.enabled !== "boolean") throw new Error(`${filePath} ${name}.enabled must be boolean.`);
    const normalizedReportPath = typeof settings.report_path === "string" ? path.normalize(settings.report_path) : "";
    if (!normalizedReportPath || path.isAbsolute(normalizedReportPath) || normalizedReportPath === ".." || normalizedReportPath.startsWith(`..${path.sep}`)) throw new Error(`${filePath} ${name}.report_path must be project-relative.`);
    for (const [key, value] of Object.entries(settings).filter(([key]) => key.includes("pct"))) if (typeof value !== "number" || value < 0 || value > 100) throw new Error(`${filePath} ${name}.${key} must be from 0 to 100.`);
    if (settings.command !== null && settings.command !== undefined && (typeof settings.command !== "string" || !settings.command)) throw new Error(`${filePath} ${name}.command must be null or a command name.`);
    for (const key of ["args", "changed_args"]) if (!Array.isArray(settings[key]) || settings[key].some((item) => typeof item !== "string")) throw new Error(`${filePath} ${name}.${key} must be a string array.`);
  }
  if (typeof config.test_integrity.enabled !== "boolean" || typeof config.test_integrity.test_path_pattern !== "string") throw new Error(`${filePath} test_integrity configuration is invalid.`);
  return { filePath, defaults: false, config };
}

function percentage(covered, total) { return total > 0 ? Number(((covered / total) * 100).toFixed(2)) : 100; }
function metric(value) {
  if (!value) return { pct: 100, covered: 0, total: 0 };
  if (typeof value.pct === "number") return { pct: value.pct, covered: value.covered || 0, total: value.total || 0 };
  const covered = value.covered ?? value.num_covered ?? value.num_branches_covered ?? 0;
  const total = value.total ?? value.num_statements ?? value.num_branches ?? 0;
  return { pct: percentage(covered, total), covered, total };
}

function normalizeCoverage(report) {
  if (report.total) {
    const files = Object.fromEntries(Object.entries(report).filter(([name]) => name !== "total").map(([name, data]) => [name.replace(/^\.\//, ""), { lines: metric(data.lines || data.statements), branches: metric(data.branches) }]));
    return { total: { lines: metric(report.total.lines || report.total.statements), branches: metric(report.total.branches) }, files };
  }
  if (report.totals && report.files) {
    const pythonMetric = (summary, branch = false) => branch
      ? metric({ covered: summary.covered_branches ?? summary.num_branches_covered, total: summary.num_branches })
      : metric({ covered: summary.covered_lines, total: summary.num_statements });
    return { total: { lines: pythonMetric(report.totals), branches: pythonMetric(report.totals, true) }, files: Object.fromEntries(Object.entries(report.files).map(([name, data]) => [name.replace(/^\.\//, ""), { lines: pythonMetric(data.summary || {}), branches: pythonMetric(data.summary || {}, true) }])) };
  }
  throw new Error("Unsupported coverage report format; expected Istanbul summary or coverage.py JSON.");
}

function aggregateFiles(files) {
  const result = { lines: { covered: 0, total: 0 }, branches: { covered: 0, total: 0 } };
  for (const data of files) for (const key of ["lines", "branches"]) { result[key].covered += data[key].covered; result[key].total += data[key].total; }
  return { lines: metric(result.lines), branches: metric(result.branches) };
}
function isChangedReportPath(reportName, changedSet) {
  return [...changedSet].some((changed) => reportName === changed || reportName.endsWith(`/${changed}`));
}

function checkCoverage(root, changedPaths, options = {}) {
  const loaded = options.config ? { config: options.config, filePath: "provided config" } : loadRegressionConfig(root);
  const settings = loaded.config.coverage;
  if (!settings.enabled) return null;
  const reportPath = path.join(path.resolve(root), settings.report_path);
  if (!fs.existsSync(reportPath)) return { status: "warn", affectedPaths: [settings.report_path], reason: "Coverage sensing is enabled but its report is missing.", nextAction: `Run the configured coverage command to create ${settings.report_path}.`, metrics: { report_missing: 1 } };
  const normalized = normalizeCoverage(JSON.parse(fs.readFileSync(reportPath, "utf8")));
  const changedSet = new Set(changedPaths.filter((item) => item !== ".").map((item) => item.replace(/^\.\//, "")));
  const changedEntries = Object.entries(normalized.files).filter(([name]) => isChangedReportPath(name, changedSet)).map(([, data]) => data);
  const changed = aggregateFiles(changedEntries);
  const failures = [];
  if (normalized.total.lines.pct < settings.minimum_lines_pct) failures.push(`overall lines ${normalized.total.lines.pct}% < ${settings.minimum_lines_pct}%`);
  if (normalized.total.branches.pct < settings.minimum_branches_pct) failures.push(`overall branches ${normalized.total.branches.pct}% < ${settings.minimum_branches_pct}%`);
  if (changedEntries.length && changed.lines.pct < settings.minimum_changed_lines_pct) failures.push(`changed lines ${changed.lines.pct}% < ${settings.minimum_changed_lines_pct}%`);
  if (changedEntries.length && changed.branches.pct < settings.minimum_changed_branches_pct) failures.push(`changed branches ${changed.branches.pct}% < ${settings.minimum_changed_branches_pct}%`);
  const metrics = { overall_lines_pct: normalized.total.lines.pct, overall_branches_pct: normalized.total.branches.pct, changed_lines_pct: changed.lines.pct, changed_branches_pct: changed.branches.pct, changed_files_in_report: changedEntries.length };
  if (!failures.length) return { status: "pass", affectedPaths: changedSet.size ? [...changedSet] : [settings.report_path], reason: "Coverage thresholds passed.", nextAction: "No action required.", metrics };
  return { status: settings.severity === "fail" ? "fail" : "warn", affectedPaths: changedSet.size ? [...changedSet] : [settings.report_path], reason: `Coverage thresholds missed: ${failures.join("; ")}.`, nextAction: "Add behavior-focused assertions for uncovered paths; do not add execution-only tests merely to inflate coverage.", metrics };
}

function mutationCounts(mutants) {
  const counts = { killed: 0, survived: 0, no_coverage: 0, timeout: 0, ignored: 0 };
  for (const mutant of mutants) {
    const status = String(mutant.status || "").toLowerCase().replace(/[^a-z]/g, "_");
    if (status === "killed") counts.killed += 1;
    else if (status === "survived") counts.survived += 1;
    else if (status === "no_coverage" || status === "nocoverage") counts.no_coverage += 1;
    else if (status === "timeout") counts.timeout += 1;
    else counts.ignored += 1;
  }
  const denominator = counts.killed + counts.survived + counts.no_coverage + counts.timeout;
  return { ...counts, score_pct: percentage(counts.killed + counts.timeout, denominator) };
}

function normalizeMutation(report) {
  if (!report.files || typeof report.files !== "object") throw new Error("Unsupported mutation report format; expected Stryker mutation-testing JSON.");
  const files = Object.fromEntries(Object.entries(report.files).map(([name, data]) => [name.replace(/^\.\//, ""), mutationCounts(data.mutants || [])]));
  const allMutants = Object.values(report.files).flatMap((data) => data.mutants || []);
  return { total: mutationCounts(allMutants), files };
}

function checkMutation(root, changedPaths, options = {}) {
  const loaded = options.config ? { config: options.config, filePath: "provided config" } : loadRegressionConfig(root);
  const settings = loaded.config.mutation;
  if (!settings.enabled) return null;
  const reportPath = path.join(path.resolve(root), settings.report_path);
  if (!fs.existsSync(reportPath)) return { status: "warn", affectedPaths: [settings.report_path], reason: "Mutation sensing is enabled but its report is missing.", nextAction: `Run incremental mutation testing to create ${settings.report_path}.`, metrics: { report_missing: 1 } };
  const normalized = normalizeMutation(JSON.parse(fs.readFileSync(reportPath, "utf8")));
  const changedSet = new Set(changedPaths.filter((item) => item !== ".").map((item) => item.replace(/^\.\//, "")));
  const selected = Object.entries(normalized.files).filter(([name]) => isChangedReportPath(name, changedSet));
  const changedMutants = selected.flatMap(([name, counts]) => Array.from({ length: counts.killed }, () => ({ status: "Killed", name })).concat(Array.from({ length: counts.survived }, () => ({ status: "Survived", name })), Array.from({ length: counts.no_coverage }, () => ({ status: "NoCoverage", name })), Array.from({ length: counts.timeout }, () => ({ status: "Timeout", name }))));
  const changed = mutationCounts(changedMutants);
  const failures = [];
  if (normalized.total.score_pct < settings.minimum_score_pct) failures.push(`overall score ${normalized.total.score_pct}% < ${settings.minimum_score_pct}%`);
  if (selected.length && changed.score_pct < settings.minimum_changed_score_pct) failures.push(`changed score ${changed.score_pct}% < ${settings.minimum_changed_score_pct}%`);
  if (changed.survived > settings.maximum_changed_survivors) failures.push(`${changed.survived} changed survivors > ${settings.maximum_changed_survivors}`);
  if (changed.no_coverage > settings.maximum_changed_no_coverage) failures.push(`${changed.no_coverage} changed no-coverage mutants > ${settings.maximum_changed_no_coverage}`);
  const metrics = { overall_score_pct: normalized.total.score_pct, changed_score_pct: changed.score_pct, changed_survivors: changed.survived, changed_no_coverage: changed.no_coverage, changed_files_in_report: selected.length, total_mutants: normalized.total.killed + normalized.total.survived + normalized.total.no_coverage + normalized.total.timeout };
  if (!failures.length) return { status: "pass", affectedPaths: changedSet.size ? [...changedSet] : [settings.report_path], reason: "Mutation-effectiveness thresholds passed.", nextAction: "No action required.", metrics };
  return { status: settings.severity === "fail" ? "fail" : "warn", affectedPaths: changedSet.size ? [...changedSet] : [settings.report_path], reason: `Mutation thresholds missed: ${failures.join("; ")}.`, nextAction: "Strengthen assertions around survivors and add tests for no-coverage mutants; review whether each mutant represents intended behavior.", metrics };
}

function checkTestIntegrity(root, _changedPaths, options = {}) {
  const loaded = options.config ? { config: options.config } : loadRegressionConfig(root);
  const settings = loaded.config.test_integrity;
  if (!settings.enabled) return null;
  let testPattern;
  try { testPattern = new RegExp(settings.test_path_pattern, "i"); } catch { throw new Error("test_integrity.test_path_pattern must be a valid regular expression."); }
  const diff = spawnSync("git", ["-C", path.resolve(root), "diff", "--unified=0", "HEAD", "--"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (diff.status !== 0) return { status: "warn", affectedPaths: ["."], reason: "Unable to compare tests with Git HEAD.", nextAction: "Restore Git baseline access and rerun test-integrity sensing.", metrics: { git_diff_unavailable: 1 } };
  let currentPath = null;
  const affected = new Set();
  let removedAssertions = 0; let addedAssertions = 0; let removedTests = 0; let addedTests = 0;
  const assertion = /\b(assert|expect|should|pytest\.raises|assertRaises|assertThat|require\.)\b/;
  const testDeclaration = /\b(test|it|describe)\s*\(|\bdef\s+test_|\bclass\s+Test/;
  for (const line of diff.stdout.split(/\r?\n/)) {
    const header = line.match(/^\+\+\+ b\/(.+)$/);
    if (header) { currentPath = header[1]; continue; }
    if (!currentPath || !testPattern.test(currentPath) || line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("-") && assertion.test(line.slice(1))) { removedAssertions += 1; affected.add(currentPath); }
    if (line.startsWith("+") && assertion.test(line.slice(1))) { addedAssertions += 1; affected.add(currentPath); }
    if (line.startsWith("-") && testDeclaration.test(line.slice(1))) { removedTests += 1; affected.add(currentPath); }
    if (line.startsWith("+") && testDeclaration.test(line.slice(1))) { addedTests += 1; affected.add(currentPath); }
  }
  const netAssertionRemoval = Math.max(0, removedAssertions - addedAssertions);
  const netTestRemoval = Math.max(0, removedTests - addedTests);
  const metrics = { removed_assertions: removedAssertions, added_assertions: addedAssertions, net_assertion_removal: netAssertionRemoval, removed_tests: removedTests, added_tests: addedTests, net_test_removal: netTestRemoval };
  if (!netAssertionRemoval && !netTestRemoval) return { status: "pass", affectedPaths: affected.size ? [...affected] : ["."], reason: "No unexplained net deletion of test assertions or test declarations detected.", nextAction: "No action required.", metrics };
  return { status: settings.severity === "fail" ? "fail" : "warn", affectedPaths: [...affected], reason: `Test protection weakened: net ${netAssertionRemoval} assertion(s) and ${netTestRemoval} test declaration(s) removed.`, nextAction: "Restore regression protection or record explicit human-approved evidence that the removed behavior is obsolete; mutation results should confirm remaining assertions are effective.", metrics };
}

function normalizeGenerativeReport(report) {
  const summary = report.summary || report;
  const cases = summary.cases ?? summary.runs ?? summary.inputs ?? summary.executions;
  const failures = summary.failures ?? summary.failed ?? summary.crashes ?? 0;
  const errors = summary.errors ?? 0;
  if (!Number.isFinite(cases) || !Number.isFinite(failures) || !Number.isFinite(errors)) throw new Error("Generative test report requires numeric cases/runs, failures, and optional errors.");
  return { cases, failures, errors };
}

function checkGenerative(root, kind, options = {}) {
  if (!["property", "fuzz"].includes(kind)) throw new Error("Generative sensor kind must be property or fuzz.");
  const loaded = options.config ? { config: options.config } : loadRegressionConfig(root);
  const settings = loaded.config[kind];
  if (!settings.enabled) return null;
  const reportPath = path.join(path.resolve(root), settings.report_path);
  if (!fs.existsSync(reportPath)) return { status: "warn", affectedPaths: [settings.report_path], reason: `${kind} sensing is enabled but its report is missing.`, nextAction: `Run the configured ${kind} test command to create ${settings.report_path}.`, metrics: { report_missing: 1 } };
  const metrics = normalizeGenerativeReport(JSON.parse(fs.readFileSync(reportPath, "utf8")));
  const failures = [];
  if (metrics.cases < settings.minimum_cases) failures.push(`${metrics.cases} cases < ${settings.minimum_cases}`);
  if (metrics.failures + metrics.errors > settings.maximum_failures) failures.push(`${metrics.failures + metrics.errors} failures/errors > ${settings.maximum_failures}`);
  if (!failures.length) return { status: "pass", affectedPaths: [settings.report_path], reason: `${kind} test thresholds passed.`, nextAction: "No action required.", metrics };
  return { status: settings.severity === "fail" ? "fail" : "warn", affectedPaths: [settings.report_path], reason: `${kind} test thresholds missed: ${failures.join("; ")}.`, nextAction: `Investigate the smallest reproducible ${kind} failure and preserve it as a deterministic regression test.`, metrics };
}

module.exports = { DEFAULTS, checkCoverage, checkGenerative, checkMutation, checkTestIntegrity, loadRegressionConfig, mutationCounts, normalizeCoverage, normalizeGenerativeReport, normalizeMutation };
