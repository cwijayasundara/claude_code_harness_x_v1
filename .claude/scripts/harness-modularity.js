#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { buildReviewPacket, mergeReviews, writeReviewPacket } = require("../lib/modularity-review");
const { workspaceFingerprint } = require("../lib/sensor-scope");

function parseArguments(args) {
  const parsed = { root: ".", changedPaths: [], reviews: [] };
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (item === "--changed") parsed.changedPaths.push(args[++index]);
    else if (item === "--review") parsed.reviews.push(args[++index]);
    else if (!item.startsWith("-") && parsed.root === ".") parsed.root = item;
    else throw new Error(`Unknown argument: ${item}`);
  }
  if ([...parsed.changedPaths, ...parsed.reviews].some((item) => !item)) throw new Error("--changed and --review require values.");
  return parsed;
}

let options;
try { options = parseArguments(process.argv.slice(2)); } catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exit(2); }
const root = path.resolve(options.root);
try {
  const packet = buildReviewPacket(root, options.changedPaths);
  const written = writeReviewPacket(root, packet);
  if (!options.reviews.length) {
    process.stdout.write(`PACKET ${written.jsonPath}\nREQUIRED ${packet.required}\nREVIEWS ${packet.minimum_independent_reviews}\n`);
    process.exit(0);
  }
  if (workspaceFingerprint(root).sha256 !== packet.workspace.sha256) throw new Error("Workspace changed while preparing modularity review.");
  const reviews = options.reviews.map((relative) => JSON.parse(fs.readFileSync(path.resolve(root, relative), "utf8")));
  const merged = mergeReviews(root, packet, reviews);
  const outputPath = path.join(root, ".claude", "specs", "evidence", "runtime", "modularity", "merged-review.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  process.stdout.write(`STATUS ${merged.status}\nREPORT ${outputPath}\n`);
  process.exit(merged.status === "human-decision-required" ? 1 : 0);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(2);
}
