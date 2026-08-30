# Cross-vendor review — TASK_2026_328

Date: 2026-08-28
Reviewer: `codex` CLI agent (independent, no shared context)
Test runner: `ollama cloud` Ptah CLI agent (independent)
Orchestrated from the Ptah session as Round 1, Batch A.

## Verdict

**PARTIAL.** All three original defects are fixed. The fix introduced one new
setting that is not reachable on the VS Code host.

## The three original defects — all fixed

| Defect                                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) `memory.enabled` missing from `FILE_BASED_SETTINGS_KEYS`                     | Registered at `libs/backend/platform-core/src/file-settings-keys.ts:320-332`, default at `:565-567`, routed at `:682-688`. Tested at `file-settings-keys.spec.ts:764-790`.                                                                                                                                                                                                                                |
| (b) Unbounded internal-query queue wait, and optional deps not declared optional | Ceiling applied to every `execute` at `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:267-285`. Removal and rejection at `:123-175`. Typed error at `libs/backend/agent-sdk/src/lib/errors/internal-query-queue-timeout.error.ts:16-26`. tsyringe `{ isOptional: true }` now present at `internal-query.service.ts:207-210`. Tested at `internal-query.service.spec.ts:322-388`. |
| (c) `readJsonlTail` first-line drop                                              | First line preserved when `readStart === 0` at `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:251-274`. The `windowStart === 1` boundary is pinned at `jsonl-reader.streaming.spec.ts:233-250`.                                                                                                                                                                                  |

## Open finding — the fix's own setting is unreachable on VS Code

`internal-query.service.ts:354-357` reads `ptah.internalQuery.queueTimeoutMs`.
That key is **not** in the file-based registry at
`libs/backend/platform-core/src/file-settings-keys.ts:154-401`, and no
`contributes.configuration` entry exists for it either.

`libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:80-84`
therefore falls through to VS Code configuration, which has no such key. The
timeout cannot be written on the VS Code host and stays at the hard-coded
60,000 ms.

This is in scope for TASK_2026_328, because the queue timeout is what this task
shipped. It is a small fix: add the key to `FILE_BASED_SETTINGS_KEYS` with its
default and routing, exactly as `memory.enabled` was added in this same task.

Note the marketplace constraint. `ptah.internalQuery.queueTimeoutMs` carries no
trademarked AI product name, so either route is allowed. The file-based route is
the one this task already used and is the consistent choice.

## Verification

`@ptah-extension/agent-sdk` — 75/75 suites, 1129/1129 tests, 0 failed.
`@ptah-extension/settings-core` — 7/7 suites, 163/163 tests, 0 failed.
`typecheck` passed for all six projects in the batch.

## Test gaps recorded

- `libs/backend/platform-core/src/file-settings-keys.spec.ts` — assert
  `internalQuery.queueTimeoutMs` routes to writable file-based storage.
- `jsonl-reader.streaming.spec.ts` — no `readJsonlTail` assertion for
  `windowStart === 0` (`maxBytes` exactly equals the file size).
- `jsonl-reader.streaming.spec.ts` — no successful one-line `readJsonlTail` case.
- `jsonl-reader.streaming.spec.ts` — the no-trailing-newline case is covered for
  `readJsonlMessages` at `:146-154` but not for `readJsonlTail`.

## Resolution — 2026-08-28

Fixed, and the finding turned out to be twice as wide as reported.

The reviewer named `internalQuery.queueTimeoutMs`. A repo-wide grep found that
**neither** `internalQuery` key was registered anywhere:

- `internalQuery.maxConcurrent` — absent from `FILE_BASED_SETTINGS_KEYS`, and
  absent from `apps/ptah-extension-vscode/package.json contributes.configuration`.
- `internalQuery.queueTimeoutMs` — same, as reported.

`maxConcurrent` is the more consequential of the two. It is the limit on the
process-wide gate that TASK_2026_323 B6 introduced, pinned at
`DEFAULT_MAX_CONCURRENT = 1`. The prior `code-logic-review.md` rated the
interactive-wizard stall behind that gate as its SERIOUS finding 1. A user who
wanted to raise the limit to 2 to relieve it had no way to do so on any host.

### What changed

- `libs/backend/platform-core/src/file-settings-keys.ts` — both keys added to
  `FILE_BASED_SETTINGS_KEYS`, with defaults `1` and `60000` matching
  `DEFAULT_MAX_CONCURRENT` and `DEFAULT_QUEUE_TIMEOUT_MS` in
  `agent-sdk/src/lib/internal-query/internal-query.service.ts:38,49`.
- `libs/backend/platform-core/src/file-settings-keys.spec.ts` — a new
  `internalQuery.*` block, three tests: registration, routing through
  `isFileBasedSettingKey`, and defaults matching the gate constants.

The defaults are hard-coded in the spec rather than imported. `platform-core` is
L0.5 and imports nothing from `@ptah-extension/*`, so it cannot reach the
`agent-sdk` constants. The test exists to catch that drift.

### Verified reachable on all three hosts

The service calls `getConfiguration('ptah', 'internalQuery.maxConcurrent', …)`.
All three adapters branch on the same predicate with the same key spelling, in
both the read and the write direction:

| Adapter                          | Read     | Write              |
| -------------------------------- | -------- | ------------------ |
| `vscode-workspace-provider.ts`   | `:80-84` | `setConfiguration` |
| `electron-workspace-provider.ts` | `:95`    | `:217`             |
| `cli-workspace-provider.ts`      | `:89`    | `:109`             |

### Tests

`npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/agent-sdk`
— 2 of 2 projects ran, 30 suites, 537 passed, 4 todo, 0 failed. `typecheck`
passed for both. The three new tests were confirmed to execute by running the
suite filtered to `internalQuery`: 3 passed, 538 skipped.

### Left open

The three `readJsonlTail` boundary cases in "Test gaps recorded" above are still
missing. They are test coverage for behaviour already proven correct, not
defects, so they do not hold the task open.

## Outcome

Status moved `in_review` → `done`. The review queue is empty.
