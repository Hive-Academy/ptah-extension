# Code Logic Review — TASK_2026_592_a44d, Batch 2

Disclosure: same-side review (author and reviewer in-process; CLI lanes busy). A cross-side whole-diff review follows.
Files-count check: batches.md Batch 2 (lines 157-176) records the 4 shell-spec provider stubs as an "Approved deviation (team-leader, during execution)": 6 planned + 4 approved = 10 files, matching `git status`. The deviation is legitimate.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 4        |
| Failure modes found | 4        |

Scope read in full: `closed-tab-session-ender.service.ts` and its spec, the canvas.store.ts diff and spec diff, both shell diffs, the 4 stub diffs (config-gate read; others same one-line pattern per report/git status), plus `tab-manager.service.ts` closeTab/forceCloseTab/resetTabToFresh/findTabBySessionId, `tab-workspace-partition.service.ts:236-275`, and all non-spec `closeTab(` callers. I did not re-run the test suites; I relied on the report's tail (canvas 221 passed, chat 1685 passed).

## Must-hold checklist

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Workspace switch never aborts | HOLDS, proven only indirectly | Ender acts solely on `closedTab` (`closed-tab-session-ender.service.ts:42-46`). `_closedTab.set` exists only at `tab-manager.service.ts:889` (forceClose), `:969` (close), `:1055` (reset); the switch path is not among them (Batch 1 cross-workspace test covers that). The effect tracks only `closedTab()`, with the work in `untracked`, so a partition swap cannot re-run it. A stale value persisting across a switch is not re-read, because the effect only re-runs when the signal changes. No ender test exercises a real TabManager across a switch (see M1). |
| 2 | forceClose and reset never abort | HOLDS | `service.ts:49` returns unless `kind === 'close'`. Spec cases `forceClose` and `reset` assert zero RPCs. `resetTabToFresh` caller `chat-message-handler.service.ts:321` and the tribunal rollback `forceCloseTab` (`tribunal-run.service.ts:227`) are covered. |
| 3 | Streaming close gives exactly one abort | HOLDS (flag path) | The listener aborts, `closeTab` sets `streamAbortDispatched` (`tab-manager.service.ts:944-969`), and the ender skips at `service.ts:50`. Spec: `streamAbortDispatched: true` gives 0 RPCs. The ender-side tests are fake-driven; the real combination is only joined across Batch 1 and Batch 2 tests. A streaming tab with no controller (e.g. a background-partition tab) gets the flag false and one ender abort, which is correct, not a double. |
| 4 | Idle close gives one abort with the real session id | HOLDS | `service.ts:56`, sessionId is `tab.claudeSessionId` (`tab-manager.service.ts:971`), never the tab id. The spec asserts the exact params. The `claudeSessionId` assignments (`:1512`, `:2156`, `:2264`) come from real session ids; no placeholder is written there. |
| 5 | Session still bound elsewhere is not aborted | HOLDS | `isStillDisplayed` (`service.ts:73-79`): `findTabBySessionId` covers the active tab list plus every partition (`tab-workspace-partition.service.ts:236-275`, with the index lazily refreshed, so there is no stale-index false negative) and canvas tiles (tabs). Non-tab surfaces are covered via `findContainingSession` and `surfacesFor`. Guard is conservative: a surface bound to any session of the conversation suppresses the abort. Spec cases cover both. |
| 6 | RPC rejection or throw never propagates | HOLDS | Sync throw is caught (`service.ts:58-63`), rejection is caught, both log. Also the effect is decoupled from `closeTab`, so nothing can reach the closer anyway. Tests cover both and a following close. |
| 7 | Signal coalescing, single processing | PARTIAL, see M2 | Single processing: `ClosedTabSessionEnderService` is `providedIn: 'root'`, so injecting it from both AppShell and ElectronShell (ElectronShell embeds `<ptah-app-shell>`, `electron-shell.component.ts:259`) yields one instance and one effect. Effect re-run: not possible without a signal write. Dropping: unresolved, see M2. |
| 8 | Canvas Task 2.3 | HOLDS | `canvas.store.ts:244-246`: after `await closeTab`, if the tab is still in `tabs()` the method returns and tile and focus stay. A confirmed close removes it from `tabs()`, so tile and focus are dropped. A tile whose tab is already gone is also dropped, so there is no regression there. Both spec cases are real and would fail without the guard (cancel case: the tile would be dropped). Existing `tribunal-run.service.ts:207-213` uses the same idiom, so this is consistent. Residual, pre-existing: a tile whose tab lives in a background partition is not in `tabs()`, so `closeTab` is a no-op and the tile is dropped anyway. |
| 9 | Both hosts get the service, no leak | HOLDS | Both shells inject; root singleton lives for the app lifetime, and root effects need no manual disposal. Instantiated once. No timers or listeners. |
| 10 | Tests fail without the fix | PARTIAL | Ender spec and canvas spec would fail against the pre-fix code. The wiring is not covered: all 4 shell specs stub the service with `{}`, and no test asserts the shells instantiate it (see M3). |

## Five logic questions

1. Silent failure: an RPC failure is logged via `console.warn` only (`service.ts:83`), with no user signal. This is acceptable for a best-effort cleanup, and the session was already closed from the user's view. If `closedTab` emits before the shell mounts, the event is not replayed (see M4).
2. Unexpected user action: closing two tabs in the same tick (see M2); Ctrl+W repeated fast is separate tasks and flushes between. The delete-original path in `chat-view.component.ts:1415-1419` closes N tabs of the same session in a microtask-only loop; the last event wins and the session is aborted once, which is correct by luck of the same-session shape.
3. Wrong answer from data: a conversation with several session ids where a surface is bound (`service.ts:77-78`) suppresses the abort of an older, non-displayed session id (a leak of a backend process, not a wrong abort). Conservative and acceptable.
4. Dependency failure: ClaudeRpcService absent or backend down is handled (log, continue). The backend returning `{success:false}` is ignored by design; an `already-ended` reply is benign.
5. Missing: no test with the real `TabManagerService` that proves switch to zero aborts end to end; no test of eager instantiation.

## Failure modes

### M2 Closed-tab signal coalescing (latent)
- Trigger: two `closeTab` calls without an Angular effect flush between them (any synchronous or microtask-only loop over tabs).
- Symptom: the first event is overwritten by the second (`tab-manager.service.ts:969`, single-value signal) and its session is never aborted; the claude process leaks until exit.
- Evidence: `service.ts:42-46` reads one value per flush. Only live trigger today is `chat-view.component.ts:1415-1419`, which is same-session, so no loss now. `closeOtherTabs`/`closeTabsToRight` (the bulk closers) were deleted in Batch 1, so no current caller exercises it.
- Current handling: none; the report's "sequential-close test" calls `TestBed.tick()` between closes, so it does not test the coalescing case.
- Recommendation: either document the one-event-per-tick contract at `closedTab`, or have the ender consume from a queue; add a test that closes two different sessions in one tick, expecting both to abort, or a documented known limit.

### M1 Switch-safety and double-abort are not tested end to end
- Evidence: the ender spec uses a fake TabManager (`closed-tab-session-ender.service.spec.ts:33-47`); switch safety rests entirely on Batch 1 never emitting. A future change that makes a switch call `closeTab` or `resetTabToFresh` would not be caught here.
- Recommendation: add one test with the real TabManager plus partition service: switch workspace, tick, expect 0 `chat:abort`. Another: real close of a streaming tab sends one abort in total across the listener and the ender.

### M3 Eager wiring not covered
- Evidence: `electron-shell.config-gate.spec.ts:~135` and 3 siblings provide `useValue: {}`; the injection fields `_closedTabSessionEnder` at `app-shell.component.ts:153-156` and `electron-shell.component.ts:319-322` are the only thing that makes the fix live. Remove them and no test fails.
- Recommendation: one shell-level test (or an app.spec) asserting the service is constructed, or inject it in the root `App` next to `StreamRouter` (`app.ts:57`), which is already the established eager-instantiation home and is not behind shell-conditional rendering.

### M4 Effect first-run reads a pre-existing event
- Evidence: `service.ts:42-46`. If the service is first instantiated after a close has already been recorded, the initial effect run would process that stale event (an abort for a long-gone close; benign but unintended). Not reachable today since the shell mounts before user close actions.
- Recommendation: seed a `lastHandled` reference (skip the initial value).

## Blocking issues
None.

## Serious issues
None.

## Moderate and minor issues
- M1-M4 above.
- Minor: `console.warn` logs the raw error object; fine here.
- Minor: report claims `app-shell` second-prompt after a delete is harmless; confirmed (backend `already-ended`), assuming the backend maps unknown or ended sessions to a non-throwing result. I did not verify the backend side.
- Minor, accepted residual: close during the first stream before the session id is known (Batch 1 failure mode) and the cross-webview twin remain, as recorded.

## Data flow

1. User closes the tab, `closeTab` (`tab-manager.service.ts:909`): OK (re-read after confirm).
2. Abort listener sends `chat:abort` when streaming; flag recorded: OK.
3. `_closedTab.set` then tab removal: OK; single-value signal, see M2.
4. Effect flush runs the ender: kind, flag, session-id, then tab/surface guards: OK.
5. Fire-and-forget `chat:abort`: OK, errors logged.

## Requirements fulfilment

| Requirement | Status | Gap |
|---|---|---|
| Close ends the idle session | COMPLETE | |
| Switch never ends sessions | COMPLETE | Test indirect (M1) |
| No double abort | COMPLETE | |
| Shared or non-tab surface kept | COMPLETE | |
| Canvas cancel keeps the tile | COMPLETE | |
| Wired in both hosts | COMPLETE | Untested (M3) |

## Edge cases

| Case | Handled | How | Concern |
|---|---|---|---|
| Null or empty session id | YES | early return | none |
| Same session in another tab or partition | YES | `findTabBySessionId` | none |
| Non-tab surface bound | YES | registry + binding | conservative |
| RPC reject or sync throw | YES | try/catch + `.catch` | none |
| Two closes in one tick | NO | single-value signal | M2 |
| Service created after a prior close | NO | initial run reads value | M4 |

## Verdict

- Recommendation: APPROVE (7/10), with M1-M3 as recommended follow-ups before the final cross-side review.
- Confidence: MEDIUM-HIGH (suites not re-run by me).
- Top risk: a single-value `closedTab` signal can drop a close on a synchronous multi-close, leaking a session; today no caller triggers it.
- Robust version would add: one real-TabManager switch test, a shell or root instantiation test (or move the inject into `App` beside `StreamRouter`), a two-closes-one-tick test or queue, and a skip of the initial stale event.
