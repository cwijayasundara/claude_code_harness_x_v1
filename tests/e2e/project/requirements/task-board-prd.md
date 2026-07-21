# Tiny Task Board PRD

## Outcome

A developer using the library can add a task and list the tasks in insertion order.

## Requirements

- A task has a generated stable identifier and a non-empty title.
- Adding a blank title fails with a clear error and does not mutate the board.
- Listing tasks returns a copy so callers cannot mutate board state accidentally.

## Acceptance criteria

1. Adding `Write tests` to a new board returns a task with that title and an identifier.
2. Listing after two additions returns both tasks in insertion order.
3. Blank or whitespace-only titles are rejected.
4. Mutating a returned list does not mutate the board.

## Constraints

- Keep this dependency-free and in-memory.
- Preserve the existing `createTaskBoard()` public entry point.
- No UI, network, persistence, authentication, or personal data is in scope.
