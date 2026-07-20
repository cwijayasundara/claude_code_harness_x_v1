#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadOperationsPolicy, operationalStatus } = require("../lib/sensor-operations");
const { attest, verifyAttestation } = require("../lib/evidence-attestation");

const root = path.resolve(process.argv[2] || ".");
const runner = path.join(__dirname, "harness-sensors.js");
const canary = path.join(__dirname, "harness-sensor-canary.js");

process.stdout.write(`INFO  Harness CI verification: ${root}\n`);
const canaryResult = spawnSync(process.execPath, [canary, root], { stdio: "inherit" });
if (canaryResult.status !== 0) process.exit(canaryResult.status ?? 2);
const result = spawnSync(process.execPath, [runner, root, "--all"], { stdio: "inherit" });
if (result.error) {
  process.stderr.write(`ERROR: Unable to start sensor runner: ${result.error.message}\n`);
  process.exit(2);
}
if (result.status !== 0) process.exit(result.status ?? 2);
try {
  const health = operationalStatus(root, "ci");
  if (health.status !== "pass") {
    for (const reason of health.reasons) process.stderr.write(`ERROR: ${reason}\n`);
    process.exit(1);
  }
  const { policy } = loadOperationsPolicy(root);
  if (policy.attestation.required_in_ci) {
    if (!process.env.HARNESS_EVIDENCE_PRIVATE_KEY_PATH) throw new Error("CI attestation is required but HARNESS_EVIDENCE_PRIVATE_KEY_PATH is unavailable.");
    attest(root, process.env.HARNESS_EVIDENCE_PRIVATE_KEY_PATH);
    const verification = verifyAttestation(root, policy.attestation.public_key_path);
    if (!verification.valid) throw new Error("CI evidence attestation verification failed.");
    process.stdout.write("PASS  Cryptographic CI evidence attestation\n");
  }
  process.stdout.write(`PASS  Sensor evidence fresh; history chain ${health.history.head_sha256 || "empty"}\n`);
  process.exit(0);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(2);
}
