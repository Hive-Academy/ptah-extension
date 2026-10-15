# Batch F round 1 fix report

Project: `@ptah-extension/chat`. All edits stayed in the designated worktree and chat scope. No git operation was run.

| Item | Root cause and fix | Regression evidence |
| --- | --- | --- |
| A1 | The newly reached viewport declaration path assumed every RPC mock/reply had `success`; an absent reply threw during dock setup. `stream-viewport-controller.service.ts:67,117` now treats absent or rejected declarations as focused scheduling. | `stream-viewport-controller.service.spec.ts:80` (`keeps focused scheduling when the declaration resolves without a reply`); `:89` asserts `declaredViewport`. The unchanged `chat-view.dock.spec.ts` passes. |
| A2 | CLI restore's test injector did not provide the new liveness/viewport collaborators, and the restore path dereferenced an absent RPC reply. `session-loader.cli-restore.spec.ts` provides those collaborators; `session-loader.service.ts:1574-1575` and `session-liveness-reconciler.service.ts:66` safely handle missing replies. | Unweakened CLI restore assertions in `session-loader.cli-restore.spec.ts`, including `restores the cards even when the transcript replay throws` and `restores the cards when the transcript yields no events`; all seven pass. |
| A3 | A minimal buffered event reached the new persisted filter, whose exception escaped the filter decision and prevented delivery. `session-history-replayer.service.ts:879-889` catches decision failures, retires the filter, and delivers the event. | `session-loader.service.spec.ts:2499` (`claims a resync before session:load and releases history, seed, then buffered live events`); `session-history-replayer.service.spec.ts:1233`. The test's history → seed → buffer order matches component 7 and the addendum. |
| F3-1 | The loader released a non-resync claim while its in-flight registry entry still existed, so a compaction event drained by release skipped its next reload. `session-loader.service.ts:1137-1155` removes the owner-checked entry before release for non-resync loads, preserves reservation → claim → registry order for resync, and resolves waiters through nested `finally`. | `session-loader.service.spec.ts:2526` (`starts a second compaction reload drained by release after a failed load`). |
| F3-2 | The compaction gauge marker was captured at resync arrival and cleared on stale exits. `session-loader.service.ts:1057-1065,1161-1169` reads it when applying stats, clears it only after application, and carries it into a fresh resync after overflow. | `session-loader.service.spec.ts:2575` (waiting resync ordering A) and `:2604` (overflow ordering B). |
| F3-3 | A seed array could contain invalid elements; a later finalizer then dereferenced one. `chat-message-handler.service.ts:593-597` rejects the entire malformed snapshot, and `session-loader.service.ts:1174` safely checks the finalizer's seed events. | `chat-message-handler.service.spec.ts:1098` tests null, scalar, and non-string `eventType` elements. |
| F3-4 | Early `session:load` failure released the seed onto the old tab contents. `session-loader.service.ts:1124-1133` clears pending writes and resets the tab before release, preserving the seed and buffered events. | `session-loader.service.spec.ts:2553` (`resets a resync tab before applying the seed after session:load fails`). |
| F2 D1 | A filter-registration throw could leave the fence and claim held. `session-history-replayer.service.ts:709-767` catches registration failure, applies the seed unfiltered, and closes the fence in `finally`; release also cleans claim metadata in `finally` (`:224-235`). | `session-history-replayer.service.spec.ts:1203` (`closes the fence and delivers buffered events when filter registration throws`). |
| F2 D2 | Exceptions from `decide` lost seed, buffered, or after-close content. `session-history-replayer.service.ts:729-758,855-889` catches each filter call, logs one warning, retires it, and keeps the affected event; seed application continues unfiltered. | `session-history-replayer.service.spec.ts:1217` (seed) and `:1233` (buffered and after-close). |
| F2 D3 | Filters for closed/rebound tabs and idle/terminal seeds remained resident. `session-loader.service.ts:399-410` retires on binding changes; `session-history-replayer.service.ts:770-786` sweeps stale bindings and avoids idle/terminal registration. | `session-loader.service.spec.ts:2641` (`retires a persisted filter as soon as its tab is closed`); `session-history-replayer.service.spec.ts:1254` (`retires an idle empty-seed filter at fence close`). |
| F2 D4 | Overflow delivery keyed filtering by the event session rather than the held fence session. `session-history-replayer.service.ts:647,841,851-853` passes the held session key to every overflow drain. | `session-history-replayer.service.spec.ts:1284` (`uses the held session key when an overflow drains a mismatched event`). |
| F2 D5 | An unchanged but matching historical tool result counted as failed reconciliation, leaving the filter's result state behind. `session-history-replayer.service.ts:810-824` recognizes an existing matching tool node as reconciled. | `session-history-replayer.service.spec.ts:1262` (`accepts an unchanged matching history tool node as reconciled`). |

The full suite also exposed an existing live-seed subagent case: history finalization preceded seed application, leaving a Task node without its seeded child. `session-history-replayer.service.ts:332-370` rebuilds that historical tree from the *applied* seed while preserving the separate live streaming state. `session-loader.resync-live-seed.spec.ts:276` now passes unchanged.

## Checks

- `npx jest -c libs/frontend/chat/jest.config.ts <seven affected spec files> --coverage=false --maxWorkers=2`: **PASS**, 7 suites, 249 tests passed, 2 skipped (before the final subagent-specific correction). A later focused run of the three affected loader/replayer/seed specs: **PASS**, 3 suites, 167 passed, 2 skipped.
- `npx nx test @ptah-extension/chat --parallel=1 --maxWorkers=2 --coverage=false`: **PASS** on final files, 199 suites; 3,688 passed, 2 skipped, 3,690 total.
- `npx nx typecheck @ptah-extension/chat --parallel=1`: **PASS** on final files. One existing Angular NG8107 warning in `peer-session-send-dialog.component.ts` appeared on the preceding typecheck run.
- `npx nx lint @ptah-extension/chat --parallel=1`: **PASS** on final files, 0 errors and 45 warnings. The two new `no-useless-assignment` warnings were removed.
- Scoped `ptah_get_diagnostics`: no diagnostics in the edited production files. The tool also reports existing sibling spec diagnostics, which are outside the project's typecheck target.

## Decisions

- Kept `chat-view.dock.spec.ts` unchanged: the viewport declaration reply is optional at the RPC boundary, so production handles it.
- Kept the CLI restore assertions intact and updated only its injected test doubles for the newly reached collaborators.
- On filter failure, delivery is fail open, even if this can display an overlap; hidden-period content must not be lost.
- Kept seeded subagent content in live state while attaching its initial tree under the historical Task node.

## Open

- No blocking Batch F failures remain. The two skipped tests and unrelated lint/type diagnostic warnings were not changed.
