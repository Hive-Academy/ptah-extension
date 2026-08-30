# Cross-vendor review — TASK_2026_330

Date: 2026-08-28
Reviewer: `codex` CLI agent (independent, no shared context)
Test runner: `ollama cloud` Ptah CLI agent (independent)
Orchestrated from the Ptah session as Round 1, Batch A.

## Verdict

**PASS.** No findings.

## What the fix actually did

The task asked to move the memory-curator `Read` observation from `PreToolUse`
to `PostToolUse`. The shipped change went further: the `PreToolUse` handler,
its callback registry, its DI tokens and its barrel exports were **deleted**.
Ptah now installs no pre-execution SDK hook at all, so no hook can cancel a
tool call.

## Evidence

| Claim                                           | Evidence                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Only `PostToolUse` is installed                 | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1283-1335`                                       |
| Absence of `PreToolUse` is pinned by a test     | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts:1491-1496`                                  |
| The handler always returns `{ continue: true }` | `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts:60-108`                                         |
| A subscriber failure cannot escape              | `libs/backend/agent-sdk/src/lib/helpers/callback-registry.base.ts:22-39`                                              |
| The observation is still recorded               | `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:133-169` (subscribe) and `:535-541` (enqueue) |
| `Read` still produces a `file-read` row         | `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts:1773-1805`                               |

The reviewer confirmed that `pre-tool-use-hook-handler.ts` and
`pre-tool-use-callback-registry.ts` no longer exist on disk.

## Verification

`npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/agent-sdk ...`
ran 6 of 6 requested projects.

- `@ptah-extension/agent-sdk` — 75/75 suites, 1129/1129 tests, 0 failed
- `@ptah-extension/memory-curator` — 24/26 suites, 392/452 tests, 0 failed, 60 skipped

`typecheck` passed for all six projects.

## Test gap recorded (not blocking)

`libs/backend/memory-curator/src/lib/triggers/memory-trigger.integration.spec.ts`
should drive a real `PostToolUseHookHandler` `Read` payload through the registry
and assert the resulting `file-read` queue row. Today the subscribe side and the
enqueue side are tested separately.

## Outcome

Status moved `in_review` → `done`.
