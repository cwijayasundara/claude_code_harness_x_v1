import assert from "node:assert/strict";
import { createTaskBoard } from "../src/task-board.js";

const board = createTaskBoard();
assert.equal(board.addTask("Smoke test").title, "Smoke test");
assert.throws(() => board.addTask("   "));
assert.equal(board.listTasks().length, 1);
console.log("Task-board success and failure smoke journeys passed");
