const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { verifySensorHistory } = require("./sensor-operations");

function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function payload(root) {
  const projectRoot = path.resolve(root);
  const report = path.join(projectRoot, ".claude", "specs", "evidence", "runtime", "sensor-report.json");
  if (!fs.existsSync(report)) throw new Error("Sensor report is missing; cannot attest evidence.");
  const history = verifySensorHistory(projectRoot);
  if (!history.valid) throw new Error("Sensor history chain is invalid; cannot attest evidence.");
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    sensor_report_sha256: sha256(report),
    history_head_sha256: history.head_sha256,
    provenance: {
      provider: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : process.env.GITLAB_CI === "true" ? "gitlab-ci" : process.env.CI ? "ci" : "local",
      run_id: process.env.GITHUB_RUN_ID || process.env.CI_PIPELINE_ID || null,
      job_id: process.env.GITHUB_JOB || process.env.CI_JOB_ID || null,
      commit_sha: process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || null,
    },
  };
}

function attest(root, privateKeyPath) {
  if (!privateKeyPath) throw new Error("Attestation requires an explicit private-key path; keys are never generated or stored by the harness.");
  const document = payload(root);
  const key = fs.readFileSync(path.resolve(root, privateKeyPath));
  const signature = crypto.sign(null, Buffer.from(JSON.stringify(document)), key).toString("base64");
  const attestation = { ...document, algorithm: "Ed25519", signature };
  const file = path.join(path.resolve(root), ".claude", "specs", "evidence", "runtime", "sensor-attestation.json");
  fs.writeFileSync(file, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  return { file, attestation };
}

function verifyAttestation(root, publicKeyPath) {
  const file = path.join(path.resolve(root), ".claude", "specs", "evidence", "runtime", "sensor-attestation.json");
  if (!fs.existsSync(file)) return { valid: false, reason: "attestation is missing" };
  if (!publicKeyPath) return { valid: false, reason: "public key is not configured" };
  const attestation = JSON.parse(fs.readFileSync(file, "utf8"));
  const { algorithm, signature, ...document } = attestation;
  if (algorithm !== "Ed25519") return { valid: false, reason: "unsupported attestation algorithm" };
  const validSignature = crypto.verify(null, Buffer.from(JSON.stringify(document)), fs.readFileSync(path.resolve(root, publicKeyPath)), Buffer.from(signature, "base64"));
  const current = payload(root);
  const currentEvidence = current.sensor_report_sha256 === document.sensor_report_sha256 && current.history_head_sha256 === document.history_head_sha256;
  return { valid: validSignature && currentEvidence, signature_valid: validSignature, evidence_current: currentEvidence, attestation };
}

module.exports = { attest, payload, verifyAttestation };
