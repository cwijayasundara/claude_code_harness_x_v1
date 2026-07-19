#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { buildCodeMap } = require("../lib/brownfield-map");
const { currentBranch, register } = require("../lib/specifications");

function usage() {
  process.stderr.write("Usage: harness-brownfield.js map --change <id> --source-id <id> --path <relative-path> [--path ...] --focus <path|module|symbol> [--focus ...] [--adapter <graph.json>] [--root .]\n");
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
const values = { root: ".", paths: [], focus: [] };
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  const value = args[++index];
  if (!value) usage();
  if (flag === "--path") values.paths.push(value);
  else if (flag === "--focus") values.focus.push(value);
  else if (flag === "--change") values.change = value;
  else if (flag === "--source-id") values.sourceId = value;
  else if (flag === "--adapter") values.adapter = value;
  else if (flag === "--root") values.root = value;
  else usage();
}
if (command !== "map" || !values.change || !values.sourceId || !values.paths.length || !values.focus.length) usage();

const root = path.resolve(values.root);
let inputPath;
try {
  currentBranch(root);
  const content = buildCodeMap(root, values.paths, values.adapter, values.focus);
  const id = `${values.change}-code-map`;
  const artifact = {
    id, package: "brownfield", change_id: values.change,
    source_ids: [values.sourceId], source_locations: values.paths,
    derived_from: [], status: "draft", assumptions: [], open_questions: [],
    human_approver: null, approved_at: null,
    content: { artifact_type: "code-map", ...content },
  };
  inputPath = path.join(root, ".claude", "specs", "brownfield", `.${id}.input.json`);
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.writeFileSync(inputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const record = register(root, path.relative(root, inputPath));
  fs.unlinkSync(inputPath);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
} catch (error) {
  if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
