const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { packContext, buildContextManifest } = require("./context-budget");
const { recordUsage, totals } = require("./model-usage");
const {
  decideRoute,
  evaluateComparison,
  loadRoutingPolicy,
  route,
} = require("./routing-policy");

const pluginRoot = path.resolve(__dirname, "..");

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return relative;
}

function writeJson(root, relative, value) {
  return write(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Lived cost/context canary: routing, protected packs, receipts, ceilings, promotion gates.
 */
function runRoutingCanary(options = {}) {
  const started = Date.now();
  const keep = Boolean(options.keep);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-routing-"));
  const changeId = "ROUTE-001";
  const storyId = "ROUTE-001-story";
  const report = {
    schema_version: 1,
    measurement_type: "lived-routing-context-canary",
    change_id: changeId,
    story_id: storyId,
  };

  try {
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "config", "user.email", "canary@example.com"]);
    execFileSync("git", ["-C", root, "config", "user.name", "Routing Canary"]);
    write(root, "README.md", "# routing canary\n");
    execFileSync("git", ["-C", root, "add", "README.md"]);
    execFileSync("git", ["-C", root, "commit", "-qm", "seed"]);
    execFileSync("git", ["-C", root, "switch", "-qc", "feature/routing"]);

    execFileSync(process.execPath, [path.join(pluginRoot, "scripts", "harness-init.js"), root], {
      stdio: "ignore",
    });

    // Tight ceilings so a single receipt can trip them.
    const routing = JSON.parse(fs.readFileSync(path.join(root, ".claude", "routing.json"), "utf8"));
    routing.cost.story_usd_ceiling = 1;
    routing.cost.change_usd_ceiling = 2;
    routing.cost.enforcement = "receipt-observed";
    routing.economical_evaluator_promotion.enabled = false;
    routing.economical_evaluator_promotion.minimum_matched_samples = 2;
    writeJson(root, ".claude/routing.json", routing);

    write(root, "requirements/prd.md", "Must not expose tokens.\n");
    write(root, "specs/decision.md", "Approved: use strong review for security.\n");
    write(root, "logs/verbose.txt", Array.from({ length: 200 }, (_, i) => `log line ${i + 1}`).join("\n"));
    write(root, "src/app.js", "module.exports = { ok: true };\n");

    const { policy } = loadRoutingPolicy(root);

    // Deterministic task: no model.
    const lintRoute = decideRoute(root, {
      task: "lint",
      changeId,
      storyId,
      risks: [],
    });
    if (lintRoute.execution !== "deterministic") throw new Error("lint must be deterministic");

    // Implementation -> sidekick/sonnet
    const implement = decideRoute(root, {
      task: "implementation",
      changeId,
      storyId,
    });
    if (implement.role !== "sidekick" || implement.model !== policy.models.sidekick.model) {
      throw new Error(`expected sidekick, got ${JSON.stringify(implement)}`);
    }
    if (!implement.context_budget) throw new Error("sidekick decision must include context_budget");

    // Ordinary validation without promotion -> strong/opus
    const ordinary = decideRoute(root, {
      task: "story-validation",
      changeId,
      storyId,
    });
    if (ordinary.role !== "evaluator-strong") {
      throw new Error("economical evaluator must stay off until promoted");
    }

    // Strong risk never downgrades even with perfect matched comparison + enabled promotion.
    const samples = [
      {
        pair_id: "A", case_hash: "case-a", route: "economical", accepted_first_pass: true,
        escaped_defects: 0, repair_count: 0, human_review_minutes: 1, elapsed_seconds: 5,
        context_tokens: 100, cost_usd: 0.05,
      },
      {
        pair_id: "A", case_hash: "case-a", route: "strong", accepted_first_pass: true,
        escaped_defects: 0, repair_count: 0, human_review_minutes: 1, elapsed_seconds: 6,
        context_tokens: 100, cost_usd: 0.5,
      },
      {
        pair_id: "B", case_hash: "case-b", route: "economical", accepted_first_pass: true,
        escaped_defects: 0, repair_count: 0, human_review_minutes: 1, elapsed_seconds: 5,
        context_tokens: 90, cost_usd: 0.05,
      },
      {
        pair_id: "B", case_hash: "case-b", route: "strong", accepted_first_pass: true,
        escaped_defects: 0, repair_count: 0, human_review_minutes: 1, elapsed_seconds: 7,
        context_tokens: 90, cost_usd: 0.5,
      },
    ];
    const comparison = evaluateComparison(samples);
    writeJson(root, routing.economical_evaluator_promotion.comparison_file, comparison);
    routing.economical_evaluator_promotion.enabled = true;
    writeJson(root, ".claude/routing.json", routing);

    const promotedOrdinary = decideRoute(root, {
      task: "story-validation",
      changeId,
      storyId,
    });
    if (promotedOrdinary.role !== "evaluator-economical") {
      throw new Error("promoted ordinary validation should use economical evaluator");
    }

    const security = decideRoute(root, {
      task: "story-validation",
      changeId,
      storyId,
      risks: ["security"],
    });
    if (security.role !== "evaluator-strong") {
      throw new Error("security risk must never use economical evaluator");
    }
    const branch = decideRoute(root, {
      task: "branch-review",
      changeId,
      storyId,
    });
    if (branch.role !== "evaluator-strong") {
      throw new Error("branch review must use strong evaluator");
    }

    // Context pack: protect requirements; compress tool output only.
    const manifest = buildContextManifest([
      { path: "requirements/prd.md", kind: "source-requirement", priority: 100 },
      { path: "specs/decision.md", kind: "approved-decision", priority: 90 },
      { path: "src/app.js", kind: "code", priority: 50 },
      { path: "logs/verbose.txt", kind: "tool-output", priority: 1 },
    ]);
    writeJson(root, ".claude/work/context-manifest.json", manifest);
    const packed = packContext(root, {
      manifest,
      tokenBudget: policy.context_budgets.sidekick,
    });
    if (!packed.selected.some((item) => item.kind === "source-requirement")) {
      throw new Error("source-requirement must be selected");
    }
    const tool = packed.selected.find((item) => item.kind === "tool-output");
    if (!tool || !tool.provenance.omitted_lines) {
      throw new Error("tool-output must be compressed with provenance");
    }
    if (packed.selected.some((item) => item.kind === "source-requirement" && item.compressed_tool_output)) {
      throw new Error("protected kinds must not be compressed as tool output");
    }

    // Provider receipt only — then trip ceiling.
    write(root, ".claude/specs/evidence/provider-session.json", JSON.stringify({
      session: "sess-1",
      usage: { input: 1000, output: 200 },
    }, null, 2));
    recordUsage(root, {
      change_id: changeId,
      story_id: storyId,
      role: "sidekick",
      model: "sonnet",
      provider: "anthropic",
      provider_session_id: "sess-1",
      input_tokens: 1000,
      output_tokens: 200,
      cost_usd: 1.25,
      elapsed_seconds: 12,
      evidence_path: ".claude/specs/evidence/provider-session.json",
    });
    const spend = totals(root, { storyId, changeId });
    if (spend.story_usd < 1.25) throw new Error("receipt total missing");

    const afterCeiling = decideRoute(root, {
      task: "implementation",
      changeId,
      storyId,
    });
    if (afterCeiling.execution !== "human-approval-required") {
      throw new Error("implementation after spend ceiling must require human approval");
    }

    // Fabricated receipt without evidence file must fail.
    let rejectedFabrication = false;
    try {
      recordUsage(root, {
        change_id: changeId,
        story_id: storyId,
        role: "sidekick",
        model: "sonnet",
        provider: "anthropic",
        provider_session_id: "fake",
        input_tokens: 1,
        output_tokens: 1,
        cost_usd: 9,
        elapsed_seconds: 1,
        evidence_path: ".claude/specs/evidence/missing-provider.json",
      });
    } catch {
      rejectedFabrication = true;
    }
    if (!rejectedFabrication) throw new Error("fabricated receipt must be rejected");

    report.status = "pass";
    report.elapsed_ms = Date.now() - started;
    report.decisions = {
      lint: lintRoute.execution,
      implementation: implement.role,
      ordinary_before_promotion: ordinary.role,
      ordinary_after_promotion: promotedOrdinary.role,
      security_with_promotion: security.role,
      branch_review: branch.role,
      after_ceiling: afterCeiling.execution,
    };
    report.context_pack = {
      estimated_tokens: packed.estimated_tokens,
      budget_tokens: packed.budget_tokens,
      selected_kinds: packed.selected.map((item) => item.kind),
      tool_omitted_lines: tool.provenance.omitted_lines,
    };
    report.observed_spend = spend;
    report.rejected_fabricated_receipt = true;
    report.enforcement = afterCeiling.enforcement;
    if (keep) report.root = root;
    return report;
  } catch (error) {
    report.status = "fail";
    report.elapsed_ms = Date.now() - started;
    report.error = error.message;
    report.root = root;
    throw Object.assign(error, { report, root });
  } finally {
    if (!keep && report.status === "pass") fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { runRoutingCanary };
