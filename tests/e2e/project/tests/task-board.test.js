import assert from "node:assert/strict";
import test from "node:test";
import { createTaskBoard } from "../src/task-board.js";

test("a new task board is empty", () => {
  assert.deepEqual(createTaskBoard(), { tasks: [] });
});
