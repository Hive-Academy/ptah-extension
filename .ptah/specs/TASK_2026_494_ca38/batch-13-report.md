# Batch 13 report — UI mutations and submit flow (TASK_2026_494)

Executor: frontend-developer. Git was not run. No committed file was edited.

## Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\services\`.

| File | Lines | Status |
| --- | --- | --- |
| `apps-surface-operations.service.ts` | 432 | CREATED: root facade with public API, page-local interaction state, the effect wiring, and one lanes + flow pair per routing id |
| `apps-surface-operations.service.spec.ts` | 681 | CREATED |
| `apps-submit-flow.ts` | 638 | CREATED: `AppsSubmitFlow`, a plain class holding one timer per routing id |
| `apps-submit-flow.spec.ts` | 539 | CREATED |
| `apps-surface-lanes.ts` | 570 | CREATED: **deviation D1**. `AppsSurfaceLanes` is a plain class with the per-surface change/select send queue |

Every file is at most 700 lines. Lint `max-lines` (700) is clean.

## Public API (for Batch 15)

`AppsSurfaceOperations` (`providedIn: 'root'`):

- `change(surfaceId, SurfaceInputCommit)`
- `select(surfaceId, SurfaceSelection | null)`
- `submit(surfaceId, SurfaceActionInvoke)`
- `interaction(surfaceId): SurfaceInteractionState`: reactive, and fed straight to the renderer's `interaction` input
- `notice(surfaceId): string | null`: the Req 6.6 `role="status"` text
- `submittedBubbles: Signal<readonly AppsUserBubble[]>`: the "Submitted: {label}" bubbles
- `release(routingId)`

## Requirements and where they are met

- **Public methods never throw.** Every public method is wrapped in `catch (error: unknown)`. The async sends are `void …catch(...)`. The warn messages carry only a step name plus an `errorCode`, a reject reason or `Error.name`.
  - Pinned by "console.warn never carries a payload value".
- **One in-flight mutation per surface; the base is the MATERIALIZED revision.**
  - `AppsSurfaceLanes.pump` (lanes.ts:336) sends only when `inFlight === null`.
  - The base is `entry.materializedRevision`, read at send time.
  - Pinned by "case 6": B is sent with revision 2 after A's echo.
- **Wait for the echo when expected > materialized.**
  - `pump` arms `armWait` (lanes.ts:375) and does not send.
  - The echo or a read reaches the facade effect (service.ts:112), which calls `pumpAll`.
  - The 1.5 s grace read is the slice's `AppsSurfaceSync` timer, armed through `expectSurfaceRevision`.
  - As a backstop, after `APPS_ECHO_WAIT_LIMIT_MS` (grace + 10 s read timeout) the lane sends on the held base and the host's conflict check decides.
- **Queue coalescing.**
  - `AppsSurfaceLanes.change` (lanes.ts:215) replaces a queued unsent change for the same `componentId`. It calls `overlays.retire(replacedId).add({...})` (:237-238).
  - `select` (:252) filters out the queued selects before it appends the new one.
  - Pinned by "a queued unsent change is replaced and its overlay retired unsent" and "queued selects collapse to the latest".
- **Rule 1.**
  - `settleChange` `applied` calls `overlays.settle(opId, ackRevision)` (lanes.ts:480-481), then `expect()`. `expect()` sets the lane's expected revision to the max and calls `session.expectSurfaceRevision`.
  - Nothing writes `materializedRevision`. The only revision writers are the session hooks, and the Batch 12 facade guarantees those hooks never materialize.
  - Pinned by "case 1" (`materializedRevision` stays 1 after the ack), "case 5" (still 1 at 1,499 ms), "pending is a transport failure…" and the submit spec's "applied with an updated surface state: the revision is expected, never materialized".
- **Rules 2 and 3.** These run in the existing reducer and sync. The facade only calls the hooks.
- **Rule 4.** Overlays are built as exactly `{ operationId, path, value, baseRevision }` (lanes.ts:238-243), per the B10 carry-forward.
- **Result handling (plan :548-575)**, in `settleChange` / `settleSelect` (lanes.ts:472, :511):
  - `stale-revision`, select: calls `requestRead`, raises the lane's expected revision to `currentRevision ?? base+1`, and queues ONE retry (`retried: true`) with a new id. The lane sends it after the read lands, on the new materialized base. A second stale result is not re-sent; it shows the Req 6.6 notice.
  - `stale-revision`, change: retires the overlay, calls `requestRead`, and shows the per-input issue "This field changed while you were editing. Your value was not saved." It is never re-sent.
  - `invalid-value`, `undeclared`, `budget`, `too-many-operations`, `operation-expired`, `operation-conflict`: retire the overlay and show `detail` as the input's notice (it.each).
  - `not-found`: retires the overlay and requests a read.
  - `pending`, a transport failure (no `errorCode`) or a thrown call: ask `surface:operation` ONCE through `checkOperation` (lanes.ts:444).
    - A terminal answer is handled as above.
    - Anything else retires the overlay, requests a read and shows a notice.
    - Nothing is ever re-sent.
  - Host refusal (`errorCode`): retires the overlay and shows `result.error` as the notice. It does not ask `surface:operation` and does not read.
- **Req 6.6.**
  - The selection override stays shown and is marked `selectionUnsynced`, with the notice "Selection not shared with the agent: {detail}" (`APPS_SELECTION_NOTICE_PREFIX`, lanes.ts:56).
  - The mark clears on the next pushed selection (`reconcileUi`, service.ts:272) or the next user selection (`select`, service.ts:193).
  - Pinned by "keeps the selection shown with the notice; the next pushed selection clears the mark" and "a timed-out select asks surface:operation once…".
- **Submit (`AppsSubmitFlow`).**
  - Precondition: `!host.isProcessing()` (flow.ts:303), re-checked before the send (:405).
  - Wait: `syncState` must be `settled`, meaning the queue is drained and nothing is in flight or behind. While the flow waits, its OWN tick (`onWaitTick`, :377) requests a read every 1.5 s when the surface is behind (B12 N1). It gives up after 30 s with "did not finish syncing", and nothing is sent.
  - Local pre-check: `collectSubmitScope` (:421), then `checkSubmitValues` (:429). On failure it marks every issue and sends nothing.
  - Send: one `surface:action` with `{ timeout: 30_000, signal }` (:456).
  - A transport failure without an `errorCode` (including the 30 s timeout) or a `pending` result leads to polling (`poll`, :511):
    - one `surface:operation` call every 3 s, each with a 10 s timeout;
    - polling stops 150 s after the send, or after 3 consecutive poll failures, and settles as `unknown`;
    - nothing is re-sent.
  - Exactly one `timer` field exists per routing id. `dispose()` clears it and aborts the flow's `AbortController`, which also releases the RPC timers in flight.
- **No `chat:*` call from any mutation.** Pinned by "no mutation calls chat:start or chat:continue (Req 6.4)" and "never calls chat:continue".
- **No timers after dispose.**
  - Pinned by "leaves no timer after the conversation is discarded (fake timers)": after `session.discard()`, the effect detects the discard and calls `release()`, and `jest.getTimerCount() === 0`.
  - Also pinned by "leaves no timer after release() while polling" and "release() aborts the mutation in flight…".

## Spec pins → spec names

| Pin | Spec |
| --- | --- |
| Reconciliation cases 1-6 | `apps-surface-operations.service.spec.ts` "case 1 …" to "case 6 …" (lines 261-344). They use the real `AppsSessionService`, `AppsSurfaceSync`, reducer and overlays, fed by pushes through the real `SurfaceUpdateInbox` |
| Pending overlays survive an agent snapshot replace (B11 F5) | "pending overlays survive an agent snapshot replace (B11 F5)" |
| Submit waits for the queue and the echo | "waits for the queue and the echo, then sends surface:action once on the materialized base"; "requests its OWN read after the grace when the sync grace read failed (B12 N1)" |
| 30 s timeout → polling, no second `surface:action` | "a 30 s timeout leads to polling, with no second surface:action" |
| Polling stops at 150 s / after 3 failures | "stops at 150 s after the send and settles unknown" (49 polls); "settles unknown after 3 consecutive poll failures" |
| Stale select re-sends once with a new id; change does not | "a select re-sends ONCE after the read, with a new id and the new base"; "a change does NOT re-send: …" |
| Req 6.6 notice | "keeps the selection shown with the notice; …" |
| Zero `chat:start` / `chat:continue` | "no mutation calls chat:start or chat:continue (Req 6.4)"; "never calls chat:continue" |
| No timers after dispose | "leaves no timer after the conversation is discarded (fake timers)"; "leaves no timer after release() while polling (fake timers)" |
| An ack is never materialized | "case 1", "case 5", "applied with an updated surface state: …", "pending is a transport failure: …" |

The scripted MockRpc mirrors `ClaudeRpcService.call` timing: it resolves `RPC timeout: <method>` when `options.timeout` elapses and `RPC aborted` on the signal. That makes the fake-timer timer counts meaningful.

## Contracts and APIs used (verified in source)

- `ClaudeRpcService.call(method, params, { timeout, signal })`, `RpcResult.isSuccess()`, `.errorCode`, `.error`: `libs/frontend/core/src/lib/services/claude-rpc.service.ts:24-65, 129-205`. The timeout path resolves with no `errorCode` (:154-167).
- Registry entries `surface:change`, `surface:select`, `surface:action`, `surface:operation`: `libs/shared/src/lib/types/rpc.types.ts:2221-2236`.
- Params and results: `libs/shared/src/lib/types/rpc/rpc-surface.types.ts`:
  - `SurfaceChangeParams` :51, `SurfaceSelectParams` :57, `SurfaceActionParams` :65, `SurfaceOperationParams` :70;
  - `SurfaceMutationResult` :176-180, `SurfaceActionResult` :183-189, `SurfaceOperationResult` :195-206;
  - `SurfaceSubmitSurfaceState` :153-155.
- `SurfaceRejectReason` and `SurfaceOperationStatus`: `libs/shared/src/mcp-apps-contracts/surface.types.ts:244-258`.
- `checkDraftValue` (`surface-bindings.ts:201`), `checkSubmitValues` (:297), `collectSubmitScope` (:374), `collectSurfaceInputs` (:94), `findSurfaceAction` (:334). All are exported from `surface.index.ts:58-65`.
- `SURFACE_OPERATION_ID_PATTERN`: `surface-catalog.ts:76`.
- `createSurfaceOperationId`: `state/surface-operation-id.ts:73`.
- `AppsOperationOverlays` `add`/`settle`/`retire`/`pendingValues`: `state/apps-operation-overlays.ts:91, 106, 127, 160`.
- `AppsSurfaceEntry`: `state/apps-surface-reducer.ts:32-43`. `updateSurfaceOverlays` retires a settled overlay at once when the materialized revision already covers it (:455-469), which case 2 relies on.
- `AppsSessionService` hooks: `requestSurfaceRead` :345, `expectSurfaceRevision` :357, `updateOverlays` :369. Signals: `routingId` :123, `surfaces` :136, `isProcessing` :148, `workspaceKey` :112.
- `APPS_ECHO_GRACE_MS`, `APPS_SURFACE_READ_TIMEOUT_MS`, `AppsSurfaceReadReason`, `AppsSurfaceRpc`: `apps-surface-sync.ts:36-63`.
- `AppsUserBubble`: `apps-workspace-slice.ts:35`.
- `SurfaceInteractionState`, `SurfaceActionUiState`, `SurfaceInputCommit`, `SurfaceActionInvoke`: `libs/frontend/declarative-dashboard/src/lib/surface-interaction.ts:8-32`, exported from its `index.ts`.

## Deviations

1. **D1: a fifth file, `apps-surface-lanes.ts`.** Written as one facade, the service was 917 lines after Prettier, which is over both the brief's 700-line cap and the lint `max-lines` rule.
   - The per-surface send queue moved into a plain class, the same shape as `AppsSubmitFlow`, with an `AppsLaneHost` interface. The facade keeps the public API and the UI state.
   - It has no spec of its own. `apps-surface-operations.service.spec.ts` exercises it end-to-end through the real reducer, as the brief asked.
2. **D2: the "Submitted: {label}" bubble (plan :601) is exposed as `AppsSurfaceOperations.submittedBubbles`, not appended to the slice.** `AppsSessionService` has no append-bubble hook, and it may not be edited while Batch 14 owns it.
   - Batch 15 should merge these bubbles into the transcript by `at`.
   - Alternatively, a later owner of the session file can add an `appendUserBubble(routingId, text)` hook and replace this signal.
3. **D3: release on discard is detected, not called.** The facade's effect tracks workspace key → routing id. When the same key shows a different (or no) routing id, the old one was discarded, so the effect calls `release(old)`.
   - A workspace **removal** (`removedWorkspace$`) of a non-active slice is not observed, so its bounded queues stay in memory. The timers self-terminate: at most 11.5 s for a lane wait and 150 s for a poll.
   - Wiring `release()` into `AppsSessionService.discard()`/`dropSlice` would close this. That is Batch 14/15's file.
4. **D4: extra texts.**
   - The submit wait gives up after 30 s (`APPS_SUBMIT_SYNC_LIMIT_MS`) with "This app did not finish syncing. Check the values and submit again." Nothing is sent. The plan gives no bound for this wait.
   - A lane waiting for an echo sends on the held base after grace + read timeout (11.5 s). Without this bound a failed grace read would strand the queue (B12 N1).
   - Change notices for an unconfirmed transport failure: "We could not confirm that your value was saved."
5. **D5: operation ids are minted per attempt.** The selection override carries the latest select's operation id, so a stale retry re-targets it. This is needed to scope the Req 6.6 mark to the attempt it belongs to.
6. **Not done (optional B12 N5):** the start → real `onSurfaceCreated` → `sessionFor` spec. That path lives in `apps-session.service.ts`, which Batch 14 owns, and Batch 13 did not touch it.

## Verification

Command, run from the worktree root:
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page --skip-nx-cache --parallel=2 --output-style=static`

- Test Suites: 10 passed, 10 total
- Tests: 199 passed, 199 total
- Lint: ✔ All files pass linting
- `npx prettier --check` on the five files: all use Prettier style.

Last 10 lines:

```



 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/mcp-apps-page


  Run duration:      15.1s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     14.3s (1 task)
  Recoverable time:  792ms (5% of the run)
```

Batch 14 ran in parallel in this library. No failure came from its files.
