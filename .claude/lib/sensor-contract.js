const allowedStatuses = new Set(["pass", "fail", "warn"]);

function createSensorResult({ sensorId, status, affectedPaths, reason, nextAction, evidence, metrics }) {
  if (!allowedStatuses.has(status)) throw new Error("Sensor status must be pass, fail, or warn.");
  if (!Array.isArray(affectedPaths) || affectedPaths.some((item) => typeof item !== "string" || !item)) {
    throw new Error("Sensor affectedPaths must be a non-empty array of paths.");
  }
  if (![reason, nextAction, evidence].every((item) => typeof item === "string" && item.trim())) {
    throw new Error("Sensor reason, nextAction, and evidence are required.");
  }
  const result = { status, affected_paths: affectedPaths, reason, next_action: nextAction, evidence };
  if (metrics !== undefined) {
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new Error("Sensor metrics must be an object when provided.");
    result.metrics = metrics;
  }
  if (sensorId !== undefined) {
    if (typeof sensorId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(sensorId)) throw new Error("Sensor id must be a kebab-case identifier.");
    result.sensor_id = sensorId;
  }
  return result;
}

function reportStatus(results) {
  if (results.some((result) => result.status === "fail")) return "fail";
  if (results.some((result) => result.status === "warn")) return "warn";
  return "pass";
}

module.exports = { createSensorResult, reportStatus };
