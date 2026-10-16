# Code Logic Review r3 — `TASK_2026_686_eb9e` (release-flush follow-up, PR #741)

Review family: Anthropic (reviewer); implementer: codex lane

Scope: uncommitted diff of four files, read in full along with their callers:
`command-center-send-lock.service.ts` (+spec), `message-dispatch.service.ts`
(+`message-dispatch.command-center-lock.spec.ts`). Callers traced:
`tab-manager.service.ts:1471-1473`, `session-coordinator.ts:195,214`, `chat.store.ts:438-451`,
`streaming-handler.service.ts:222-236,485-497`, `message-dispatch.service.ts:260-313`.
Not run (per instructions): Nx, Jest, tsc. The orchestrator's pass of typecheck, lint and tests
is taken as given. The lane's `ptah_get_diagnostics` timed out, so that is not independent
evidence.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 8/10           |
| Assessment          | APPROVED       |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Moderate issues     | 2              |
| Minor issues        | 3              |
| Failure modes found | 3              |

Why 8 rather than 9: the CodeRabbit finding is closed, and the double-flush and missed-case
checks hold. What is left is a contract weakness (`notifyRelease` has no error isolation) and
thin coverage of the new interleavings, both non-blocking. Why not 7: I found no reachable
wrong behaviour in the traced paths.

## Is the PR comment closed?

Yes. The old effect compared `state()` snapshots and only ran when Angular scheduled it, so a
release followed by another state change (re-engage, other-root engage) in one tick could skip
the release transition. Now every transition that drops a held root fires `notifyRelease`
synchronously after `_state.set` (`command-center-send-lock.service.ts:35-47,28-32`), so no
transition depends on effect timing. Transitions covered:

- owner `release` (`:35-40`)
- matching `clearForRoot` (`:42-47`)
- `engage` over a different root (`:28-32`)
- `engage` over the same root, with the same or a different token: correctly silent, because the
  root stays held
- `rekey`: correctly silent (`:49-54`). The notification carries `rootTabId`, and `isHeld`
  matches on `rootTabId` too (`:60`), so a later rekeyed release still resolves.

The release then re-engage in one tick case is handled by the microtask re-check of
`isHeld` (`message-dispatch.service.ts:131-132`). Test: spec line 144.

## Five logic questions

### 1. How does this fail silently?

- A release that arrives while the tab is busy (`isTabBusyGenerating`,
  `message-dispatch.service.ts:136-142`) is skipped, with no log. It relies on a later terminal
  turn-end flush through `ChatStore.processStreamEvent` (`chat.store.ts:446-451`). That is the
  old effect's behaviour too, so nothing regressed. If the busy signal is stale (for example a
  lingering `hasUnsettledTree`), the queue waits for the next turn. The release will not flush
  it again.
- An exception thrown inside the deferred microtask (`findTabByIdAcrossWorkspaces`,
  `isTabStreaming`) becomes an uncaught microtask error. It does not break release, but nothing
  attributes it. Only `sendQueuedMessage` has its own try/catch (`:269-309`). See minor M-3.

### 2. What user action produces unexpected behaviour?

- User mutes (release), then in the same tick starts voice again (re-engage with the same
  owner): the microtask sees `isHeld('root')` true and skips. Correct, and tested.
- User closes the Command Center tab while it is held: `closeTab` removes the tab first
  (`tab-manager.service.ts:1471`), then `clearForRoot` (`:1473`). The listener's microtask finds
  no tab and returns. Correct.

### 3. What input data produces a wrong answer?

- Queued content that is whitespace-only is not flushed (`.trim()` check, `:135`). Consistent
  with the turn-end path (`streaming-handler.service.ts:227`).
- Both `release` and `clearForRoot` guard on `current?.active` and the matching token or root,
  so a second call on a null state emits nothing. One release gives one notification. The
  `active` check is redundant, because `engage` always sets `active: true` and no path stores
  `active: false`. That is harmless.

### 4. What happens when a dependency fails?

- `sendQueuedMessage` failure: handled inside it. The message is restored and
  `showSendFailure` is called (`:296-308`); `void` is therefore safe.
- A throwing release listener: not isolated. See M-1.

### 5. What is missing that the requirements never mentioned?

- A test for turn-end plus release interleaving, a test for DestroyRef teardown, and a
  dispatch-level test for the engage-replaces-root path (see minors).

## Double-flush analysis

I found no reachable double flush.

- Release while the turn-end flush has already run, with the lock held: `sendQueuedMessage`
  returns early at `:265` and leaves the queue intact. The release listener then flushes once.
  Correct.
- Release, then a terminal turn_state in the same tick, with the turn-end path first: the lock
  is no longer held, so `sendQueuedMessage` runs. It clears the queue synchronously, before its
  first `await` (`:289`). The microtask then reads `tab.queuedContent`, finds it empty, and
  returns. Correct.
- The listener's microtask first, then turn-end: `sendQueuedMessage` clears the queue
  synchronously. The streaming handler computes its flush list from `tab.queuedContent`
  (`streaming-handler.service.ts:222-229`, `:492`) in the same synchronous stack as
  `ChatStore`'s call, so it sees an empty queue. Microtasks cannot interleave with that stack.
- Residual hazard, not introduced by this diff: `sendQueuedMessage` falls back to its `content`
  argument when the tab's queue is empty (`:285`). A second caller holding a stale `content`
  after a first flush has cleared the queue would resend it. The new listener passes content it
  read in the same synchronous block as the call, so it cannot create that case.
- Two notifications for one release: not possible. Release then `engage` of a different root
  gives one notification (the first `engage` sees a null previous state).

## Failure modes

### Throwing listener skips remaining listeners and the caller's tail

- Trigger: any future `onRelease` listener whose synchronous part throws.
- Symptom: the exception propagates out of `release`, `clearForRoot` or `engage`. From
  `closeTab` this skips `recordCommandCenterWrite` and `emitTabClosed`
  (`tab-manager.service.ts:1473-1489`), which would leave a stale run manifest and a missing
  close event.
- Evidence: `command-center-send-lock.service.ts:66-68` (bare `for` loop, no try/catch).
- Current handling: the only registered listener defers all work behind `queueMicrotask`, so its
  synchronous part cannot throw. State is also set before notifying, so the lock itself is
  consistent. Safety is by construction of this one listener, not by the service contract.
- Recommendation: wrap each listener call in try/catch and log it, or document that listeners
  must not throw.

### Stale-busy release leaves the queue waiting

- Trigger: release while `isTabBusyGenerating` is transiently true and no further terminal
  event arrives.
- Symptom: the queued message is unsent until the next turn.
- Evidence: `message-dispatch.service.ts:136-143`.
- Current handling: same as the old effect.
- Recommendation: none required for this comment.

### Unobserved microtask exception

- Trigger: TabManager lookup throws inside the deferred callback.
- Symptom: uncaught error, no log attribution.
- Evidence: `message-dispatch.service.ts:131-147`.
- Recommendation: optional try/catch with `console.error`, mirroring `sendQueuedMessage`.

## Teardown

Correct. `MessageDispatchService` is `providedIn: 'root'` (`:119`), so `DestroyRef` is the root
environment injector's: it fires on app or TestBed teardown. The subscription is removed and a
`destroyed` flag guards microtasks already scheduled (`:128,148-151`). The service holds a
listener `Set` on a root singleton, but both live and die together, so there is no leak. The
unsubscribe closure is idempotent. Deleting from the `Set` during iteration (a listener
unsubscribing itself) is safe.

## Blocking issues

None.

## Serious issues

None.

## Moderate issues

- M-1: `notifyRelease` has no listener error isolation (see failure mode above).
  `command-center-send-lock.service.ts:66-68`.
- M-2: no test pins the interleaving that makes "no double flush" true (release, then terminal
  turn-end in the same tick; or two queued sends). The existing "flushes exactly once" spec
  (`message-dispatch.command-center-lock.spec.ts:131`) uses queue-then-release, not the
  turn-end path. The mock `sendQueuedMessage` collaborators cannot show the clear-before-await
  ordering. Suggest one spec that calls `dispatch.sendQueuedMessage` and the release in either
  order and asserts a single `flush`.

## Minor issues

- M-3: add a try/catch with `console.error` around the microtask body
  (`message-dispatch.service.ts:131-147`).
- M-4: no spec for DestroyRef teardown (a release after `TestBed.resetTestingModule()` or
  destroy must not flush). The `destroyed` guard at `:132` is currently untested.
- M-5: `current?.active` in `release` and `clearForRoot` (`:37,44`) is redundant, since `active`
  is always true when state is non-null. It is harmless, but it implies a state that does not
  exist.

## Data flow

1. Coordinator `mute/stop/destroy` calls `lock.release(ownerToken)`: OK
   (`session-coordinator.ts:214`).
2. `release` clears state, then `notifyRelease(rootTabId)` synchronously: OK; no error isolation
   (M-1).
3. Dispatch listener schedules `queueMicrotask`: OK. Re-engage in the same tick is absorbed by
   the `isHeld` recheck.
4. The microtask re-reads the tab, queue and busy state fresh (no stale capture): OK.
5. `sendQueuedMessage` re-checks the lock, clears the queue synchronously, sends, and restores
   on failure: OK.
6. Turn-end path (`ChatStore`) shares step 5; the queue clear makes the two paths mutually
   exclusive: OK.

## Requirements fulfilment

| Requirement                                                    | Status   | Gap                      |
| -------------------------------------------------------------- | -------- | ------------------------ |
| Engage/release before the effect's next run is not missed      | COMPLETE | none                     |
| No double flush with the ChatStore turn-end flush              | COMPLETE | no pinning test (M-2)    |
| Engage replacing a different root notifies the old root        | COMPLETE | no dispatch-level test   |
| Same-root engage and rekey do not release                      | COMPLETE | none                     |
| Teardown on a root-provided service                            | COMPLETE | untested (M-4)           |
| Listener errors cannot break `release()`                       | PARTIAL  | by construction only (M-1) |

## Edge cases

| Case                                    | Handled | How                                   | Concern                        |
| --------------------------------------- | ------- | ------------------------------------- | ------------------------------ |
| Release then re-engage, same tick       | YES     | microtask `isHeld` recheck            | none                           |
| Release then another root engaged       | YES     | one notification each, per root       | none                           |
| Release while streaming                 | YES     | skipped; turn-end flushes later       | relies on terminal event       |
| Tab closed while held                   | YES     | tab removed first; microtask no-ops   | none                           |
| Duplicate release / clear on null state | YES     | guard returns before notify           | none                           |
| Service destroyed with microtask queued | YES     | `destroyed` flag                      | untested                       |
| Throwing listener                       | NO      | propagates                            | M-1                            |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH on the flush logic, MEDIUM on runtime behaviour (no tests run by me).
- Top risk: `notifyRelease` has no error isolation, so one future throwing listener could break
  `release`, `clearForRoot` and `closeTab`'s tail.
- What a robust implementation would add: try/catch per listener, a spec pinning one flush for
  release and turn-end in either order, and a teardown spec.
