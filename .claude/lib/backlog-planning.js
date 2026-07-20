const SIZE_POINTS = Object.freeze({
  low: new Set([1, 2, 3]),
  medium: new Set([5]),
  high: new Set([8, 13]),
});
const CONFIDENCE = new Set(["low", "medium", "high"]);

function contentOf(record, loadBody) {
  return loadBody(record)?.content || null;
}

function validateStoryEstimate(content, storyId) {
  const errors = [];
  const prefix = `Story '${storyId}'`;
  if (!content || typeof content !== "object") return [`${prefix} content must be an object.`];
  if (!SIZE_POINTS[content.size]) errors.push(`${prefix} size must be low, medium, or high.`);
  else if (!SIZE_POINTS[content.size].has(content.story_points)) {
    errors.push(`${prefix} story_points ${content.story_points} does not match ${content.size} sizing policy.`);
  }
  if (!CONFIDENCE.has(content.estimate_confidence)) errors.push(`${prefix} estimate_confidence must be low, medium, or high.`);
  if (!Array.isArray(content.estimate_basis) || content.estimate_basis.length === 0) errors.push(`${prefix} estimate_basis must be a non-empty array.`);
  if (!Array.isArray(content.acceptance_criteria) || content.acceptance_criteria.length === 0) errors.push(`${prefix} acceptance_criteria must be a non-empty array.`);
  return errors;
}

function normalizeGraph(content) {
  if (!content || typeof content !== "object") return { nodes: [], edges: [] };
  return {
    nodes: Array.isArray(content.nodes) ? content.nodes : [],
    edges: Array.isArray(content.edges) ? content.edges : [],
  };
}

function analyzeDag(storyRecords, graph, storyPoints) {
  const errors = [];
  const storyIds = new Set(storyRecords.map((item) => item.id));
  const storyParents = new Map(storyRecords.map((item) => [item.id, new Set(item.derived_from || [])]));
  const nodeIds = graph.nodes.map((node) => typeof node === "string" ? node : node?.story_id);
  const nodeSet = new Set(nodeIds.filter(Boolean));
  if (nodeIds.length !== nodeSet.size) errors.push("Dependency DAG contains duplicate nodes.");
  for (const storyId of storyIds) if (!nodeSet.has(storyId)) errors.push(`Dependency DAG is missing story '${storyId}'.`);
  for (const nodeId of nodeSet) if (!storyIds.has(nodeId)) errors.push(`Dependency DAG contains unknown story '${nodeId}'.`);

  const outgoing = new Map([...storyIds].map((id) => [id, []]));
  const incoming = new Map([...storyIds].map((id) => [id, []]));
  const edgeKeys = new Set();
  for (const [index, edge] of graph.edges.entries()) {
    const from = edge?.from;
    const to = edge?.to;
    if (!storyIds.has(from) || !storyIds.has(to)) {
      errors.push(`Dependency edge[${index}] references an unknown story.`);
      continue;
    }
    if (from === to) errors.push(`Dependency edge '${from}' -> '${to}' is a self-edge.`);
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) errors.push(`Dependency edge '${key}' is duplicated.`);
    edgeKeys.add(key);
    if (from !== to) {
      outgoing.get(from).push(to);
      incoming.get(to).push(from);
    }
    const fromParents = storyParents.get(from) || new Set();
    const toParents = storyParents.get(to) || new Set();
    const inferredEpicCrossing = fromParents.size > 0 && toParents.size > 0
      && ![...fromParents].some((parent) => toParents.has(parent));
    if ((edge.epic_crossing === true || inferredEpicCrossing) && (typeof edge.rationale !== "string" || !edge.rationale.trim())) {
      errors.push(`Cross-epic dependency '${key}' requires rationale.`);
    }
  }

  const indegree = new Map([...storyIds].map((id) => [id, incoming.get(id).length]));
  const ready = [...storyIds].filter((id) => indegree.get(id) === 0).sort();
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const next of outgoing.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
    ready.sort();
  }
  if (order.length !== storyIds.size) errors.push("Dependency DAG contains a cycle.");

  const distances = new Map();
  const paths = new Map();
  for (const id of order) {
    const own = storyPoints.get(id) || 0;
    let bestDistance = own;
    let bestPath = [id];
    for (const predecessor of incoming.get(id)) {
      const candidate = (distances.get(predecessor) || 0) + own;
      if (candidate > bestDistance) {
        bestDistance = candidate;
        bestPath = [...(paths.get(predecessor) || []), id];
      }
    }
    distances.set(id, bestDistance);
    paths.set(id, bestPath);
  }
  const terminal = order.reduce((best, id) => !best || (distances.get(id) || 0) > (distances.get(best) || 0) ? id : best, null);
  return {
    errors,
    topological_order: order,
    dependency_ready_story_ids: order.filter((id) => incoming.get(id).length === 0),
    critical_path: terminal ? paths.get(terminal) : [],
    critical_path_points: terminal ? distances.get(terminal) : 0,
    incoming,
  };
}

function validateAllocations(content, storyRecords, storyPoints, dag) {
  const errors = [];
  const clusters = content?.clusters;
  if (!Array.isArray(clusters) || clusters.length === 0) return ["Allocations must contain a non-empty clusters array."];
  const storyIds = new Set(storyRecords.map((item) => item.id));
  const owners = new Map();
  const clusterIds = new Set();
  for (const [index, cluster] of clusters.entries()) {
    const label = `clusters[${index}]`;
    if (!cluster?.id || clusterIds.has(cluster.id)) errors.push(`${label}.id must be unique and non-empty.`);
    else clusterIds.add(cluster.id);
    if (!Array.isArray(cluster?.story_ids) || cluster.story_ids.length === 0) errors.push(`${label}.story_ids must be non-empty.`);
    for (const storyId of cluster?.story_ids || []) {
      if (!storyIds.has(storyId)) errors.push(`${label} references unknown story '${storyId}'.`);
      if (owners.has(storyId)) errors.push(`Story '${storyId}' appears in multiple allocation clusters.`);
      owners.set(storyId, cluster.id);
    }
    const expectedPoints = (cluster?.story_ids || []).reduce((sum, id) => sum + (storyPoints.get(id) || 0), 0);
    if (cluster?.total_points !== expectedPoints) errors.push(`${label}.total_points must equal ${expectedPoints}.`);
    for (const field of ["shared_seams", "required_skills", "depends_on_clusters"]) if (!Array.isArray(cluster?.[field])) errors.push(`${label}.${field} must be an array.`);
    if (typeof cluster?.rationale !== "string" || !cluster.rationale.trim()) errors.push(`${label}.rationale is required.`);
  }
  for (const storyId of storyIds) if (!owners.has(storyId)) errors.push(`Story '${storyId}' is not assigned to an allocation cluster.`);
  for (const cluster of clusters) for (const dependency of cluster.depends_on_clusters || []) {
    if (!clusterIds.has(dependency)) errors.push(`Cluster '${cluster.id}' depends on unknown cluster '${dependency}'.`);
    if (dependency === cluster.id) errors.push(`Cluster '${cluster.id}' cannot depend on itself.`);
  }
  for (const [storyId, predecessors] of dag.incoming.entries()) for (const predecessor of predecessors) {
    const fromCluster = owners.get(predecessor);
    const toCluster = owners.get(storyId);
    if (fromCluster && toCluster && fromCluster !== toCluster) {
      const target = clusters.find((cluster) => cluster.id === toCluster);
      if (!target?.depends_on_clusters?.includes(fromCluster)) errors.push(`Cluster '${toCluster}' must depend on '${fromCluster}' because ${storyId} depends on ${predecessor}.`);
    }
  }
  return errors;
}

function validateG1(records, loadBody) {
  const errors = [];
  const stories = records.filter((item) => item.package === "stories" && item.status !== "superseded");
  const storyPoints = new Map();
  for (const story of stories) {
    const content = contentOf(story, loadBody);
    errors.push(...validateStoryEstimate(content, story.id));
    if (Number.isInteger(content?.story_points)) storyPoints.set(story.id, content.story_points);
  }
  const dependencyRecords = records.filter((item) => item.package === "dependencies" && item.status !== "superseded");
  if (dependencyRecords.length !== 1) errors.push("G1 requires exactly one canonical dependencies artifact.");
  const graph = normalizeGraph(dependencyRecords[0] ? contentOf(dependencyRecords[0], loadBody) : null);
  const dag = analyzeDag(stories, graph, storyPoints);
  errors.push(...dag.errors);
  const allocationRecords = records.filter((item) => item.package === "allocations" && item.status !== "superseded");
  if (allocationRecords.length !== 1) errors.push("G1 requires exactly one allocations artifact.");
  else errors.push(...validateAllocations(contentOf(allocationRecords[0], loadBody), stories, storyPoints, dag));
  return { errors, ...dag };
}

function validateG4DependencyConsistency(records, loadBody) {
  const errors = [];
  const dependency = records.find((item) => item.package === "dependencies" && item.status === "approved");
  if (!dependency) return ["G4 requires the approved canonical G1 dependency DAG."];
  const graph = normalizeGraph(contentOf(dependency, loadBody));
  const expected = new Map(graph.nodes.map((node) => [typeof node === "string" ? node : node.story_id, []]));
  for (const edge of graph.edges) if (expected.has(edge.to)) expected.get(edge.to).push(edge.from);
  const plans = records.filter((item) => item.package === "plans" && item.status !== "superseded");
  const seen = new Set();
  for (const plan of plans) {
    const content = contentOf(plan, loadBody);
    if (!content?.story_id) continue;
    seen.add(content.story_id);
    const actual = [...(content.dependency_story_ids || [])].sort();
    const wanted = [...(expected.get(content.story_id) || [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      errors.push(`Story contract '${plan.id}' dependency_story_ids must match G1 DAG: ${wanted.join(", ") || "none"}.`);
    }
  }
  for (const storyId of expected.keys()) if (!seen.has(storyId)) errors.push(`G4 is missing a story contract for '${storyId}'.`);
  return errors;
}

module.exports = { SIZE_POINTS, analyzeDag, normalizeGraph, validateAllocations, validateG1, validateG4DependencyConsistency, validateStoryEstimate };
