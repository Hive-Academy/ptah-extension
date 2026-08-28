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

## Outcome

Status stays `in_review`. Close it after the `queueTimeoutMs` key is registered.
