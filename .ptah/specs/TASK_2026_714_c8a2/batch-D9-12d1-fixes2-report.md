# Batch D9 12d-1 fixes 2

## Changes

- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:220-221`: use the branded execution session ID as the live-profile map key. The other live-profile write at line 194 already uses that key. Line 1126 now constructs its fixture ID with `SessionId.from(...)` instead of a cast.
- `libs/backend/agent-sdk/src/lib/di/register.ts:1011-1033`: register `NATIVE_SESSION_HISTORY_PORT` with the existing nullable runtime-port defaults before host binding. The lazy lookup at lines 312-323 accepts the null default.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:41,90-94` and `session-history-router.spec.ts:93-102,175-184`: model null as an unavailable host port and verify that both native history reads return `nativePortUnavailable` without falling through to Claude history.
- `apps/ptah-electron/src/di/expected-resolvable.ts:103-130`, `apps/ptah-extension-vscode/src/di/expected-resolvable.ts:14-31`, and `libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts:59-75`: include the new nullable port in the host censuses. The CLI source guard at line 107 also forbids a direct host binding.
- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:1028-1050`: the failed-binding assertion now expects the registered null default to remain. The disposal-error fixture at lines 272-290 disposes each child container before raising the deliberate error.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:437-442`: unref the host clock timer. The new history timeout at lines 638-654 was already unref'd and cleared in `finally`, with its AbortSignal listener removed there.

## Handle investigation

The new history timer and listener have cleanup in `finally`. The host clock timer at line 440 lacked `unref()` in HEAD and now has it. `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:624-636` has a kill timer, but that file is unchanged against HEAD; it is not a timer introduced by this batch. The new disposal-error spec fixture could leave a child container undisposed; it now closes the child before throwing. The precise cause of the Jest worker warning remains unconfirmed because test execution was forbidden.

## Files touched and line endings

| Absolute path | CR count | BOM |
| --- | ---: | --- |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\apps\ptah-electron\src\di\codex-runtime-composition.spec.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\apps\ptah-electron\src\di\codex-runtime-composition.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\apps\ptah-electron\src\di\expected-resolvable.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\apps\ptah-extension-vscode\src\di\expected-resolvable.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\di\register.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\session-history-router.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\session-history-router.spec.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\cli-engine\src\lib\codex-runtime-composition.spec.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12d1-fixes2-report.md` | 0 | no |

## Evidence and UNCONFIRMED

- `git diff --check` passed. Static inspection confirmed the Electron and VS Code token lists, the CLI null census, the branded map writes, and timer cleanup.
- **UNCONFIRMED:** tests, lint, typecheck, Nx verification, and diagnostics were not run by instruction. The three reported failures and the Jest worker-exit warning need coordinator verification.
- Skill files were discoverable in `.claude/skills`; no DI-specific skill or CLI skill-loader tool was exposed for this lane. No UI work was done.
