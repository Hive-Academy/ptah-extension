# Batch D9 12c-1 follow-up fixes

## Changes

| Item | File:line | Result |
| --- | --- | --- |
| Coordinator typecheck and lint failure | `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:71-80` | `threadTime` is declared with `let` in the projection loop where it is updated. The unused declaration in the parent-tool scan is gone. The `linked` lookup uses its string value with a nullish fallback, removing the possibly-undefined property access. The whole source file was reviewed for similar scope errors. |
| N1, fixed failure text | `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:24,197-215`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.spec.ts:123-155` | Every failed turn emits the fixed `Codex reported a runtime error.` notice as a complete-source text event, including turns without assistant items or `error.message`. Specs assert raw native error messages never appear in events. |
| N2, cross-thread parent lookup | `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:50-80,156`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.spec.ts:207-218` | The pre-scan finds collaboration tools across every snapshot thread. A found tool links its receiver even when its containing thread differs from `parentThreadId`; the unresolved synthetic id and skip record remain when no tool is found. |
| N4, omitted async question data | `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:142-145`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.spec.ts:166-179` | A replayed async question with omitted question/card data records `asyncQuestionsNotPresented` in `skippedItems`; the spec includes options. Failed turns without output are covered by N1. |
| N3 and N5 decisions | `.ptah/specs/TASK_2026_714_c8a2/plan-d9-history.md:34-36` | Recorded `agentType: 'unknown'` as matching Claude history for missing configuration, and cross-turn timestamp clamping as accepted. |

The live-path constant is `FAILURE_NOTICE = 'Codex reported a runtime error.'` in `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:58`; it is private, not a public export. `CodexChatEvents` uses the same text at `codex-chat-events.ts:305,354`. The projector uses a local constant with the exact live text because importing the private constant is unavailable and changing the live stream is outside this batch.

## Files touched

- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\plan-d9-history.md`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12c1-fixes2-report.md`

## Evidence and UNCONFIRMED

- Tree-sitter parse status for the projector and spec: `ok`, zero error nodes. `git diff --check` passed for tracked changes.
- CR byte counts: projector 0; spec 0; plan 0; report 0. All four files have no UTF-8 BOM.
- UNCONFIRMED: tests, lint, typecheck, Nx, npm, build, diagnostics, commit and push were prohibited for this lane and were not run. The coordinator must verify the new assertions and strict compilation.
- UNCONFIRMED: pinned App Server replay payload and packaged Electron history rendering were not exercised. The unresolved synthetic parent id still needs UI evidence for damaged history.
- Skill discovery through the available Ptah harness returned no matching skill. The Ptah symbol index had zero symbols and `rg` was denied by the environment, so source text searches used PowerShell `Select-String`.
