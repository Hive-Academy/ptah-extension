# CI chat failures at cc151f659

## Root cause and fix by failure

| Failure | Root cause and evidence | Fix |
| --- | --- | --- |
| `SessionHistoryReplayer` yield semantics, no `MessageChannel` | Full replay called `restoreNativeCompletedChildren` after the three chunk claim checks. Recovery looked up the tab's provider even when the 600 events contained no native child. The assertion at `session-history-replayer.service.spec.ts:403` therefore observed four lookups instead of the three claim checks. | `session-history-replayer.service.ts:328,365,581-589` accepts the provider as a replay argument and removes recovery's tab lookup. The three claim checks remain. |
| `SessionLoaderService` UICS-010, null stats | Its one-event replay reached the new recovery lookup, but this test's tab mock at `session-loader.service.spec.ts:1718-1732` has no `findTabByIdAcrossWorkspaces`. That original TypeError entered the replay failure handler, whose `clearPendingUpdates` call threw a second TypeError because this test's streaming mock lacks it (`:1740-1744`). | `session-loader.service.ts:1128-1134` supplies the resume, session-list, or existing-tab provider to replay. Recovery uses that argument without a lookup. The normal replay and null-stats assertion can proceed; no mock change is needed. |
| `switchSession` guard, compaction bypass | The test at `session-loader.service.spec.ts:1913-1935` deliberately resumes a one-event snapshot through the normal replay path. The same new recovery lookup threw on the guard harness's small tab mock (`:1825-1839`), then the failure handler threw on its streaming mock (`:1847-1851`). | Same provider handoff at `session-loader.service.ts:1128-1134` and lookup removal at `session-history-replayer.service.ts:581-589`. |
| `switchSession` guard, cold existing tab | The one-event reply at `session-loader.service.spec.ts:1954-1974` reached the same recovery lookup and masked failure handler. | Same fix. |
| `switchSession` guard, no existing tab | The one-event reply at `session-loader.service.spec.ts:1976-1992` reached the same recovery lookup and masked failure handler. | Same fix. |
| `switchSession` guard, background live tab | The one-event reply at `session-loader.service.spec.ts:1994-2013` reached the same recovery lookup and masked failure handler. | Same fix. |

`origin/main` has the same UICS-010 and guard test bodies and already has `clearPendingUpdates` in the production failure handler. Its replayer has no native recovery call. Source comparison therefore indicates these five tests would avoid both errors on `origin/main`; they were not run because this task forbids Jest. The merge left the mainline failure handler intact and added recovery from the branch. The new recovery lookup exposed an incomplete mock, while the failure handler's incomplete mock masked the first error. The production lookup is the cause addressed here.

The cached-tab route already reads `restoredTab`; `session-loader.service.ts:1846-1861` now passes its provider when the resume reply omits one. The full replay passes the reply provider first, then the session-list or existing-tab provider. Native Codex marker detection remains for histories with no provider. `session-history-replayer.service.spec.ts:214-249` now exercises explicit Codex and Claude providers, including Codex history without a native marker. `session-history-replayer.native-recovery.spec.ts` still supplies `openai-codex` explicitly; the loader's cached-tab spec at `session-loader.service.spec.ts:1273-1310` still expects the reply provider to reach recovery. Claude events without a native marker remain excluded.

## Changed files

- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
- `.ptah/specs/TASK_2026_714_c8a2/task-D9-fix10-report.md`

## Evidence and limit

Reviewed the six failure entries in the supplied CI log, the relevant source and specs, and read-only `git show origin/main`/`git diff`. `git diff --check` found no whitespace errors. No npm, Nx, Jest, lint, typecheck, build, verify, or git write command was run, per task instructions; the coordinator must run the chat checks.
