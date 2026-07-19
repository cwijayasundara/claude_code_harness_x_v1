const assert = require("node:assert/strict");
const test = require("node:test");
const {
  STRUCTURAL_ALTERNATIVE_IDS,
  assertArchitectureAlternatives,
  assertChangeStrategySecondSlice,
  assertStoryContractEvolution,
  renderG3DesignSession,
} = require("../lib/design-evolution");

function validArchitecture(overrides = {}) {
  return {
    structural_alternatives: STRUCTURAL_ALTERNATIVE_IDS.map((id) => ({
      id,
      summary: `Summary for ${id}`,
      duplication_risk: id === "clone-vertical" ? "high" : "low",
    })),
    selected_alternative_id: "shared-modules",
    selection_rationale: "Helpers suffice for this change.",
    second_slice_reuse_policy: {
      when: "second-similar-capability",
      required_action: "reuse-existing-seams-or-design-amendment",
      generalize_min_uses: 2,
    },
    evolutionary_rules: ["Reuse seams on the second similar capability."],
    ...overrides,
  };
}

test("architecture requires the three structural shapes and a second-slice policy", () => {
  assert.deepEqual(assertArchitectureAlternatives(validArchitecture()), []);
  const missing = assertArchitectureAlternatives({
    structural_alternatives: [{ id: "clone-vertical", summary: "only one", duplication_risk: "high" }],
    selected_alternative_id: "clone-vertical",
    selection_rationale: "fast",
  });
  assert.match(missing.join("\n"), /shared-modules|parameterized-spine|second_slice/);
});

test("change strategy enforces second_slice_decision with reuse or justification", () => {
  assert.deepEqual(assertChangeStrategySecondSlice({
    artifact_type: "change-strategy",
    second_slice_decision: "reuse-existing",
    reuse: [{ path: "src/a.py" }],
  }), []);
  assert.match(
    assertChangeStrategySecondSlice({
      artifact_type: "change-strategy",
      second_slice_decision: "reuse-existing",
      reuse: [],
    }).join("\n"),
    /reuse target/
  );
  assert.match(
    assertChangeStrategySecondSlice({
      artifact_type: "change-strategy",
      second_slice_decision: "justified-divergence",
    }).join("\n"),
    /divergence_justification/
  );
});

test("story contracts block dependent first-slice and require reuse targets", () => {
  assert.deepEqual(assertStoryContractEvolution({
    implementation_posture: "first-slice",
    dependency_story_ids: [],
    reuse_targets: [],
    human_decisions: [],
  }), []);

  assert.match(
    assertStoryContractEvolution({
      implementation_posture: "first-slice",
      dependency_story_ids: ["S1"],
      reuse_targets: [],
      human_decisions: [],
    }).join("\n"),
    /cannot use implementation_posture 'first-slice'/
  );

  assert.match(
    assertStoryContractEvolution({
      implementation_posture: "reuse-existing",
      dependency_story_ids: ["S1"],
      reuse_targets: [],
      human_decisions: [],
    }).join("\n"),
    /reuse_targets/
  );

  assert.deepEqual(assertStoryContractEvolution({
    implementation_posture: "reuse-existing",
    dependency_story_ids: ["S1"],
    reuse_targets: [{ path: "src/parse.py", symbol: "parse_amount" }],
    human_decisions: [],
  }), []);

  assert.match(
    assertStoryContractEvolution({
      implementation_posture: "first-slice",
      dependency_story_ids: [],
      reuse_targets: [],
      human_decisions: [],
    }, { siblingStoryCount: 2 }).join("\n"),
    /independent-first-slice/
  );
});

test("G3 design session markdown narrates alternatives and checklist", () => {
  const md = renderG3DesignSession({
    ready: true,
    design: {
      seam: "createTodosFromTitles calls createTodo",
      folder_structure: ["src/todo.js", "tests/todo-batch.test.js"],
    },
    architecture: validArchitecture({
      selected_alternative_id: "shared-modules",
      selection_rationale: "Batch should call the factory, not clone validation.",
      structural_alternatives: STRUCTURAL_ALTERNATIVE_IDS.map((id) => ({
        id,
        summary: `Summary for ${id}`,
        duplication_risk: id === "clone-vertical" ? "high" : "low",
        pros: id === "shared-modules" ? ["Clear reuse"] : ["Fast"],
        cons: id === "clone-vertical" ? ["Drift"] : ["Ceremony"],
      })),
    }),
  });
  assert.match(md, /G3 design session/);
  assert.match(md, /Recommended shape:\*\* `shared-modules`/);
  assert.match(md, /Batch should call the factory/);
  assert.match(md, /clone-vertical/);
  assert.match(md, /parameterized-spine/);
  assert.match(md, /← \*\*selected\*\*/);
  assert.match(md, /Second-slice reuse policy/);
  assert.match(md, /Human checklist before approve/);
  assert.match(md, /Primary seam:\*\* createTodosFromTitles/);
  assert.match(md, /Artifact appendix/);

  const empty = renderG3DesignSession({});
  assert.match(empty, /No architecture content yet/);
});
