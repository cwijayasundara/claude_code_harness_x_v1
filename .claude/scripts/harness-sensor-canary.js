#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkBoundaries } = require("../lib/architecture-boundaries");
const { checkFileSizes } = require("../lib/maintainability-sensors");
const { scanSecrets } = require("../lib/secret-scan");

const root = path.resolve(process.argv[2] || ".");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bad-code-canary-"));
try {
  fs.mkdirSync(path.join(fixture, ".claude", "project"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "app"));
  fs.mkdirSync(path.join(fixture, "forbidden"));
  fs.writeFileSync(path.join(fixture, ".claude", "project", "maintainability.json"), JSON.stringify({ version: 1, file_size: { warn_lines: 2, max_lines: 3 } }));
  fs.writeFileSync(path.join(fixture, ".claude", "project", "boundaries.json"), JSON.stringify({ version: 1, rules: [{ id: "canary-boundary", from: "app/", forbidden: ["forbidden/"], extensions: [".js"], reason: "Injected canary." }] }));
  fs.writeFileSync(path.join(fixture, "forbidden", "data.js"), "export const data = 1;\n");
  fs.writeFileSync(path.join(fixture, "app", "bad.js"), "import '../forbidden/data.js';\nconst token = 'AKIAIOSFODNN7EXAMPLE';\nexport function bad() { return token; }\n// excess\n");

  const probes = [
    { id: "oversized-file", detected: checkFileSizes(fixture, ["app/bad.js"]).status === "fail" },
    { id: "boundary-violation", detected: checkBoundaries(fixture, ["app/bad.js"]).violations.length > 0 },
    { id: "embedded-secret", detected: scanSecrets(fixture, ["app/bad.js"]).length > 0 },
  ];
  const report = { schema_version: 1, generated_at: new Date().toISOString(), measurement_type: "deliberate-bad-code-canary", status: probes.every((probe) => probe.detected) ? "pass" : "fail", probes };
  const output = path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-canary.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`CANARY ${report.status}\nREPORT ${output}\n`);
  process.exit(report.status === "pass" ? 0 : 1);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
