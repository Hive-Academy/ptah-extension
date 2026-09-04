# Verification run — TASK_2026_323

Date: 2026-08-28
Runner: `ollama cloud` Ptah CLI agent (independent, no shared context)
Orchestrated from the Ptah session as Round 2.

This file records the measured test evidence only. The code review lives in
`cross-vendor-review.md`.

## Scope

Eleven projects covering all three phases of the task: the seven frontend chat
libraries touched by Phase 3, and the four backend libraries touched by Phase 1
and Phase 2.

## Commands

Two `run-many` invocations, deliberately split so neither exhausts memory. The
`Running target test for N projects` header was read after each run and matched
the requested count, so no project was silently dropped.

```
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state \
  @ptah-extension/chat-streaming @ptah-extension/chat-execution-tree \
  @ptah-extension/chat-routing @ptah-extension/chat-ui @ptah-extension/markdown
requested 7 / ran 7

npx nx run-many -t test -p @ptah-extension/rpc-handlers \
  @ptah-extension/cli-agent-runtime @ptah-extension/vscode-core \
  @ptah-extension/workspace-intelligence
requested 4 / ran 4
```

## Results

| Project                                  | Suites | Tests     | Skipped | Result |
| ---------------------------------------- | ------ | --------- | ------- | ------ |
| `@ptah-extension/rpc-handlers`           | 89/89  | 2493/2524 | 31      | PASS   |
| `@ptah-extension/workspace-intelligence` | 39/39  | 955/955   | 0       | PASS   |
| `@ptah-extension/chat`                   | 58/58  | 864/866   | 2       | PASS   |
| `@ptah-extension/cli-agent-runtime`      | 38/38  | 494/494   | 0       | PASS   |
| `@ptah-extension/vscode-core`            | 24/24  | 393/393   | 0       | PASS   |
| `@ptah-extension/chat-streaming`         | 19/19  | 346/347   | 1       | PASS   |
| `@ptah-extension/chat-state`             | 14/14  | 276/276   | 0       | PASS   |
| `@ptah-extension/chat-ui`                | 20/20  | 92/92     | 0       | PASS   |
| `@ptah-extension/chat-routing`           | 5/5    | 135/135   | 0       | PASS   |
| `@ptah-extension/markdown`               | 3/3    | 54/54     | 0       | PASS   |
| `@ptah-extension/chat-execution-tree`    | 2/2    | 22/22     | 0       | PASS   |

**Failures: none.**

## Typecheck

`npx nx run-many -t typecheck -p <all eleven>` — every project PASS. All eleven
declare a `typecheck` target, so none was skipped for a missing target.

## Notes affecting confidence

- A worker process in `@ptah-extension/markdown` and in
  `@ptah-extension/rpc-handlers` failed to exit gracefully and was force-exited.
  No test failed because of it, but a leaked handle is a real signal in a task
  about event-loop blocking. Worth a look.
- Each backend run printed a Node warning about loading the ES module
  `jest.config.ts`.
- The typecheck run printed `MaxListenersExceededWarning: 14 exit listeners
added to process`.
- `@ptah-extension/chat-execution-tree` has only 2 suites and 22 tests for the
  library that Phase 3 rewrote to build incrementally. That is thin coverage for
  the riskiest change in the phase.

## What this run does NOT prove

A green suite proves no existing assertion broke. It does not prove the
incremental execution-tree rebuild produces the same tree as a full rebuild,
because no test compares the two. See `cross-vendor-review.md`.
