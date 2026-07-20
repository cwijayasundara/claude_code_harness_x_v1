#!/usr/bin/env node

const path = require("node:path");
const specs = require("../lib/specifications");

function usage() {
  process.stderr.write(
    "Usage:\n" +
    "  harness-specs.js init [--root .]\n" +
    "  harness-specs.js intake --change <id> --source <file> --kind <brd|prd> [--root .]\n" +
    "  harness-specs.js register --file <artifact.json> [--root .]\n" +
    "  harness-specs.js proposal --change <id> --gate <G0..G4|B0..B2> [--write] [--root .]\n" +
    "  harness-specs.js approve --change <id> --gate <G0..G4|B0..B2> --approver <name> [--root .]\n" +
    "  harness-specs.js amend --change <id> --amendment <artifact-id> --approver <name> [--root .]\n" +
    "  harness-specs.js tracker-export --change <id> --provider <linear|jira|azure-devops|generic> --project <key> [--root .]\n" +
    "  harness-specs.js tracker-approve --projection <artifact-id> --approver <name> [--root .]\n" +
    "  harness-specs.js tracker-record --receipt <file> --id <receipt-id> [--root .]\n" +
    "  harness-specs.js validate [--change <id>] [--root .]\n"
  );
  process.exit(2);
}

const [command, ...raw] = process.argv.slice(2);
if (!command) usage();
const values = { root: "." };
const flags = new Set();
for (let index = 0; index < raw.length; index += 1) {
  const token = raw[index];
  if (!token?.startsWith("--")) usage();
  const key = token.slice(2);
  if (key === "write" || key === "markdown-only") {
    flags.add(key);
    continue;
  }
  const value = raw[index + 1];
  if (value === undefined || value.startsWith("--")) usage();
  values[key] = value;
  index += 1;
}

try {
  const root = path.resolve(values.root);
  let result;
  if (command === "init") result = { index: specs.initialize(root) };
  else if (command === "intake" && values.change && values.source && values.kind) {
    result = specs.intake(root, { changeId: values.change, source: values.source, kind: values.kind });
  } else if (command === "register" && values.file) {
    result = specs.register(root, values.file);
  } else if (command === "proposal" && values.change && values.gate) {
    result = specs.proposalPack(root, {
      changeId: values.change,
      gate: values.gate,
      write: flags.has("write"),
    });
    if (flags.has("markdown-only")) {
      process.stdout.write(result.markdown);
      process.exit(result.ready || result.packages_complete ? 0 : 1);
    }
  } else if (command === "approve" && values.change && values.gate && values.approver) {
    result = specs.approve(root, { changeId: values.change, gate: values.gate, approver: values.approver });
  } else if (command === "amend" && values.change && values.amendment && values.approver) {
    result = specs.applyPromptAmendment(root, { changeId: values.change, amendmentId: values.amendment, approver: values.approver });
  } else if (command === "tracker-export" && values.change && values.provider && values.project) {
    result = specs.createTrackerProjection(root, { changeId: values.change, provider: values.provider, projectKey: values.project });
  } else if (command === "tracker-approve" && values.projection && values.approver) {
    result = specs.approveTrackerProjection(root, { projectionId: values.projection, approver: values.approver });
  } else if (command === "tracker-record" && values.receipt && values.id) {
    result = specs.recordTrackerReceipt(root, { receiptFile: values.receipt, receiptId: values.id });
  } else if (command === "validate") {
    const errors = specs.validate(root, values.change);
    if (errors.length) throw new Error(errors.join("\n"));
    result = { status: "valid", change: values.change || null };
  } else usage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
