# Implementation Plan Addendum v2 - TASK_2026_627: every session handover is user-authorized

Addendum to `implementation-plan.md`. It applies D22 (`decisions.md:299-314`), which replaces user
decision 1 in `handoff.md:24`, and the review resolutions D23-D25 (`decisions.md:316-341`). Where
the two plans disagree, this one wins. All line references are to the worktree at `a8a6cdec5`.
Revision 1 (see the Revision log at the end) answers `implementation-plan-v2-user-authorized-review.md`;
Round 2 answers `implementation-plan-v2-user-authorized-rereview.md`.

## Inputs and constraints

- Requirements used: `decisions.md` D5, D6, D13-D25; `handoff.md`; `implementation-plan.md`
  (Components 1, 3, 5, 9, Integration architecture); `batches.md` (Verification rules :21-44,
  deferred rows 627-L1..L20 :684-703); `code-logic-review-phase3.md`;
  `implementation-plan-v2-user-authorized-review.md`.
- Corrections applied: D22 supersedes D5 (in-place `budget-auto` to `budget-limit` conversion),
  D6 (15-minute escalation), D17/D18 (stage arming at the terminal and after the result), and the
  data-flow steps 1 and 3 of `implementation-plan.md:380-394`. D23 replaces the former Q1 (agent
  successor kept unchanged). D24 replaces the former Decision 5 (composer text pushed into held
  inputs). D25 sets the live-stage contract and replaces "lane-provider error counts as 0".
- Design handoff used: none. The UI change reuses the existing banner component.
- Missing decision-critical input: none. Q1 is resolved by D23.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `armAtTerminal` creates a `budget-auto` op and starts it (`startAutomatic`) when the stage is handoff and no work is in flight | `session-handover-coordinator.service.ts:288-385` (create :349, start :378-384) | Main automatic path. Remove it. |
| The S1 conversion, the 15-minute wait bound and the escalation | `coordinator:144, 309-318, 331-339, 356-362` | Exist only for `budget-auto`. Delete them. |
| `cancelledAutomaticSources` suppresses re-arming after a Cancel or failure | `coordinator:177, 295-302, 435-437, 703-704` | Dead with no automatic op. Delete. |
| `begin` → `request` → `confirmBudgetOperation`/`confirmSuccessor` starts at once when idle, with **no work gate** for `successor` | `coordinator:233-284, 476-491, 511-518`; the gate applies only to `budget-auto` (:324-329) | The user's click needs the work gate plus a "go now" override. |
| `confirm()` has no caller in `libs` | `coordinator:401-418` | Dead code. Delete. |
| `HELD_SOURCE_PHASES` includes `awaiting-confirmation`; `admitOrHold` holds in every held phase; `admitInterrupt` holds for any live op | `coordinator:128-135, 386-399` | An agent-requested parked op must not hold the user's input (D23). One hold predicate is needed. |
| `restore()` hands every op input to `runtime.restoreInputs`, which prepends to the source queue and wakes an idle pump | `coordinator:759-775`; `session-registry.service.ts:560-573` | Composer text must never enter `op.inputs` (D24). |
| `complete()` delivers `op.inputs` in batches; on a failed batch it un-shifts delivered inputs back and fails | `coordinator:588-612` | The draft rides with the first batch but is tracked apart, so a failure can still return it as a draft. |
| `snapshot()` exposes counts, `waitingFor`, `lostInputTexts`; "Transport never exposes queued inputs" | `coordinator:817-836`; `session-handover.types.ts:1, 16-40` | The draft is the user's own composer text, exposed only in a terminal phase, like `lostInputTexts`. |
| `workInFlight` treats a lane-provider throw as 0 lanes | `coordinator:495-510` | Changes to "unknown" (D25). |
| Terminal arming passes `stageFor === 'handoff'` | `session-lifecycle-manager.ts:514-532` (:525) | Remove the stage argument. |
| Post-result arming for `handoff`/`limit` | `sdk-agent-adapter.ts:1825-1834` → `session-lifecycle-manager.ts:539-561` | Keep only to park the blocking limit. |
| Stop calls `onTurnTerminal` (627-L15 route) | `session-control.service.ts:124-127` | Disappears once the terminal never arms a stage. |
| `observeLive` returns `void`; early returns for non-provisional, disabled (clears `liveFigure`), untracked, older revision, measure mismatch; posts via `noticeLiveStage` | `session-budget.service.ts:272-321` (disabled :277-281, revision :285-288, measure :303-310, post :313-314 → :1144-1166) | The return becomes a three-way update (D25). |
| The live figure is cleared at turn end and on extend or a settings change | `session-budget.service.ts:331-338, 552` | Backend clear points already exist. |
| The adapter contract already uses "`undefined` = no update, `null` = clear" for `budget` | `agent-adapter.types.ts:82-87` | `liveBudgetStage` copies that convention. |
| The notice text promises an automatic flow | `session-budget.service.ts:198-213` (:205) | Rewrite (627-L19). |
| Budget actions are one RPC with an action union; `act` never throws | `session-budget.types.ts:296-305`; `session-budget-rpc.schema.ts:17-28`; `session-budget-rpc.handlers.ts:56-67`; `session-budget.service.ts:390-420` | "Ask agent to wrap up" is a new action, no new RPC. |
| The budget service depends on the lifecycle through a `Pick` | `session-budget.service.ts:71-74`; `SessionLifecycleManager.find` :690 | The wrap-up action can read `turnInFlight` without a new DI edge. |
| Subagent monitor: per-subagent stop plus a notice, own off switch | `subagent-budget-monitor.ts:2-37`; `di/register.ts:495-518` | Not a session handover. Keep (Decision 4). |
| The begin RPC hard-codes `'successor'`, calls `admitOrHold` for `queuedInput` and ignores `held` | `session-handover-rpc.handlers.ts:85-106` (:98-103) | Text is lost today on a mid-turn click; replaced by the draft (D24). |
| The cancel RPC returns `latestStates` or `snapshotFor` | `session-handover-rpc.handlers.ts:108-121` | The cancel result carries `draftText` with no handler change. |
| `queuedContent` is the auto-send queue flushed after the turn by `sendQueuedMessage` | `message-dispatch.service.ts:230-272`; captured at `session-budget-actions.service.ts:228-247` | A returned draft must go to the composer input, never back to `queuedContent`. |
| `restoreContentToInput` refuses when the composer is not empty; chat-view's lost-input handler joins texts with a blank line | `chat-input.component.ts:1498-1506`; `chat-view.component.ts:1314-1317` | A new append-safe method is needed so a returned draft is never dropped. |
| The agent tool `ptah_session_start` successor mode calls `begin('successor')` and replies "Successor handover accepted…" | `session-spawner.service.ts:288-310`; `session-tool-handlers.ts:184-192`; description `session-tools.ts:64-65`; spec `session-tools.spec.ts:324` | Reroute to an agent request (D23); change the reply text. |
| The live payload carries no budget stage; the webview installs live stats with `budget: undefined` | `agent-adapter.types.ts:98-117`; `session-stats-live.ts:21-46`; `session-stats-aggregator.service.ts:229-237` | One optional field. |
| Handover snapshots reach the webview inside `SESSION_STATS` and are recorded by revision | `session-handover-rpc.handlers.ts:60-80`; `session-stats-aggregator.service.ts:125-128`; `session-handover-client.service.ts:38-47` | Agent marker and draft travel on the existing snapshot. |
| The banner renders only when the tab is `loaded` | `chat-view.component.ts:939-950` | The condition must change. |
| The banner validates `waitingFor` counts as finite non-negative integers | `session-budget-banner.component.ts:73, 509-513, 625` | It must accept `lanes: null` as "unknown". |
| The banner copy assumes an automatic flow | `session-budget-banner.component.ts:605, 633-635` | Rewrite. |
| The webview matches the literal `'source session unavailable'` | `coordinator:548` ↔ `session-budget-actions.service.ts:47-53, 219-222` | Keep byte-identical. |

## Architecture decision

- **Chosen approach: one authority, one setter.** An operation reaches `writing-handoff` only from
  `SessionHandoverCoordinator.begin()`, and `begin()` is called only by the `session:beginHandover`
  RPC (the user). `begin()` alone sets `userConfirmed`; `startConfirmed()`, the only caller of
  `complete()`, requires it. Three other entries may create or change an op, and none can start one:
  1. `armAtTerminal` parks a `budget-limit` op in `awaiting-confirmation` at the blocking limit
     ("as today"), and advances an op the user already confirmed once its wait ends.
  2. `parkLimitHandoverIfIdle` (post-result) parks the same blocking-limit op by delegating to
     `armAtTerminal`, including the agent-op conversion.
  3. `requestFromAgent()` (new, D23), called by `ptah_session_start` successor mode, parks a
     `successor` op in `awaiting-confirmation` with `requestedBy: 'agent'`. The banner asks the user;
     Approve is the ordinary user begin.

  The live feed computes a display stage only. The wrap-up notice is posted only by a budget action.
  Composer text captured by a click is a draft, stored apart from held inputs and never handed to
  `restoreInputs` (D24).
- **Rationale.** D22 items 1-3 and D23-D25 by construction: one flag setter reachable only from the
  user RPC, one gate before `complete()`. Reuses the `successor`/`budget-limit` reasons, the
  `waiting-for-turn-end` phase with `waitingFor`, `cancel` with `restore`, the `session:budgetAction`
  channel, and the snapshot broadcast. No new RPC method.
- **Rejected alternatives.**
  - (a) Keep `budget-auto` but park it. Keeps a second automatic creation path and the S1/D6 code.
  - (b) A new `session:requestWrapUp` RPC. The action union already exists.
  - (c) A second "Continue in new session" click as "go now". A double-click would skip the wait.
  - (d) Refuse successor mode (reviewer's Q1 option). Removes a capability without user approval;
    D23 chose confirmation instead.
  - (e) Return the draft through `restoreInputs` or `queuedContent`. Both send it without a press
    (`session-registry.service.ts:560-573`; `message-dispatch.service.ts:230`).
  - (f) Keep the draft only in the webview. The successful path must still transfer it with the held
    inputs, which only the backend can order; and a failure that arrives by broadcast after a reload
    would lose it.
- **Assumptions.**
  - A1: lane-completion and background-subagent completion messages reach the source as turns that
    end in `onTurnTerminal`, and are not refused by `refuseIfBudgetReached` (the `chat:continue`
    path only, `chat-session.service.ts:475-495, 959`). Check: trace lane-completion delivery
    (`agent-process-manager.service.ts` → `session-stream-pump.service.ts:100, 255`). If false, the
    wait ends only through "Continue now anyway", which the copy already offers.
  - A2: background subagents that finish without a parent turn leave `getBackgroundAgents` before
    the next terminal. Check: `subagent-registry.service.ts:481, 574`.
  - A3: `@ptah-extension/vscode-lm-tools` Jest may reach `marked`. Check: run the spec once; if it
    fails with "Could not locate module marked", pass the `batches.md:34-40` mapper.
- **Effect on existing code.**
  - Removed: `budget-auto`, the S1 conversion, `WORK_IN_FLIGHT_WAIT_LIMIT_MS` and its escalation,
    `cancelledAutomaticSources`, the `atHandoffStage` argument, `atHandoffOrLimitStage`, `request()`
    as a public entry, dead `confirm()`, the automatic notice in `observeLive`, the begin handler's
    `admitOrHold`, and the agent's direct `begin` call.
  - Kept: Batches 1-6 infrastructure (notice queue, PostToolUse delivery, builder, lane work provider,
    `source-unavailable` fallback); the subagent monitor; the stage file write at handoff and limit
    (`session-budget.service.ts:653-682`, preparation only); `canSend` refusal; extend; the limit park;
    the agent successor capability (now confirmed by the user).

## Automatic-path inventory (D22 approves every removal; listed for the record)

| # | Path that starts without a user click | Where | Fate |
| --- | --- | --- | --- |
| P1 | Terminal at handoff stage creates `budget-auto` and starts it | `session-lifecycle-manager.ts:521-526` → `coordinator:349, 378-384` | Remove. |
| P2 | Terminal with work in flight creates a waiting `budget-auto` that later auto-starts | `coordinator:324-346` | Remove. The gate runs only for a user-confirmed op. |
| P3 | Post-result `armHandoverIfIdle` arms `budget-auto` for `handoff` or non-blocking `limit` | `sdk-agent-adapter.ts:1825-1834`; `session-lifecycle-manager.ts:539-561` | Rename to `parkLimitHandoverIfIdle`; runs only when `isAtBlockingLimit` (:592-597); the adapter calls it only when `budget?.blocked === true`. |
| P4 | Stop → `onTurnTerminal` → arm at a live handoff (627-L15) | `session-control.service.ts:124-127` | Disappears with P1. |
| P5 | S1 converts a waiting `budget-auto` in place | `coordinator:309-318` | Remove. |
| P6 | D6 escalation after 15 minutes | `coordinator:144, 331-339, 356-362` | Remove. |
| P7 | `cancelledAutomaticSources` | `coordinator:177, 295-302, 435-437, 703-704` | Remove. |
| P8 | Live estimate posts the wrap-up notice | `session-budget.service.ts:313-314, 1162-1165` | Remove the post; keep one INFO line per live rank per turn. |
| P9 | Blocking limit parks `budget-limit` in `awaiting-confirmation` holding queued inputs | `coordinator:349-366`, `HELD_SOURCE_PHASES` :128-135 | Keep. Not a start. |
| P10 | Subagent monitor stops an over-budget subagent | `di/register.ts:510-513`; monitor :2-37 | Keep (Decision 4). |
| P11 | Agent tool `ptah_session_start` successor mode starts or waits on its own | `session-spawner.service.ts:288-310` | Change (D23): `requestFromAgent` parks it for the user's Approve. |

## Target flow (state table)

"Display stage" is the higher of the authoritative stage and the live stage; the live stage counts
only while the tab is `streaming` and its budget is non-null (Component F1).

| Situation | Banner shows | Buttons → call | Backend op | Work in flight | Cancel |
| --- | --- | --- | --- | --- | --- |
| Handoff (80%), no op, turn running | "This session is near its budget", authoritative figures (a live stage is marked "estimate") | **Ask agent to wrap up** → `session:budgetAction{request-wrap-up}` (once per stage per turn, then disabled); **Continue in new session** → `beginHandover`; Preview; Dismiss | none | runs normally | n/a |
| Handoff, no op, idle | same, without "Ask agent to wrap up" | Continue in new session; Preview; Dismiss | none | n/a | n/a |
| Limit, non-blocking | "Reached its budget" | as the handoff rows; "Allow 20% more" only when the authoritative stage is `limit` | none | runs normally | n/a |
| Limit, blocking (`canSend` false) | "Reached its budget; new messages paused" | **New session** → `beginHandover`; **Allow 20% more** → `extend`; **Cancel handover** (when parked); Preview | parked `budget-limit` in `awaiting-confirmation`, holding queued inputs (P9) | sends refused (`SESSION_BUDGET_REACHED`) | held inputs restored (as today); a captured draft returns to the composer. Next blocking terminal re-parks. |
| Agent asked (D23) | "The agent asks to continue in a new session" | **Approve** → `beginHandover` (the user begin: gate, then wait or start); **Cancel** → `cancelHandover` | `successor` in `awaiting-confirmation`, `requestedBy: 'agent'`, not `userConfirmed`; holds nothing | runs normally; user sends go to the source | `cancelled`; nothing to restore |
| After a click: turn running, or subagents/lanes running | "Waiting for the turn to end" / "Waiting for N subagents, M lanes" / "…, lane status unknown"; "Messages you send now go to this session" | **Continue now anyway** → `beginHandover{continueNow:true}`; **Cancel** | `successor` (or the parked `budget-limit`) in `waiting-for-turn-end`, `userConfirmed`, `waitingFor` | new inputs not held. Counts re-read at each terminal and each begin. Unknown lanes never end the wait. | held inputs restored; the draft returns to the composer |
| Wait ends (terminal with no known work) or "Continue now anyway" while idle | "Writing the handoff…" | **Cancel (keep working)** while `writing-handoff` | `writing-handoff` → `starting-successor` → … → `closed` | the owned handoff turn runs | inputs restored; the draft returns to the composer |
| "Continue now anyway" mid-turn | waiting copy | none new | `forced`; the next terminal starts without the gate | — | as above |
| Failure / source gone | existing failed and Retry copy; `source-unavailable` → new tab with the seed | Retry, Keep working, Put back | `failed`, inputs restored; `draftText` published | — | the draft returns to the composer |

Backend transitions:

```
none ─begin─▶ waiting-for-turn-end (turn running or work in flight or lanes unknown; publishes waitingFor)
     ─terminal, no known work / begin{continueNow} while idle─▶ writing-handoff ▶ … ▶ closed
none ─begin, idle, no known work─▶ writing-handoff
none ─requestFromAgent─▶ awaiting-confirmation (successor, requestedBy agent, holds nothing)
awaiting-confirmation (limit park or agent request) ─begin─▶ (gate) waiting-for-turn-end | writing-handoff
awaiting-confirmation (agent request) ─blocking-limit terminal─▶ same op becomes the limit park (reason budget-limit, marker cleared, holds)
waiting-for-turn-end, awaiting-confirmation, writing-handoff, failed ─cancel─▶ cancelled (inputs restored, draftText published)
```

A repeated `begin` without `continueNow` on a waiting or in-progress op returns the snapshot
unchanged except a refreshed `waitingFor` (double-click safe). A `requestFromAgent` while any live op
exists returns that op's snapshot unchanged.

## Decisions

1. **Wrap-up action (D22 item 1).** New `SessionBudgetAction` `'request-wrap-up'` on
   `session:budgetAction`.
   - Succeeds only when the session has a budget entry, the display stage (`stageFor`) is `handoff`
     or `limit`, and a turn is in flight (`sessionControl.find(id)?.turnInFlight`, widening
     `SessionBudgetSessionControl` with `'find'`). Otherwise `{ success: false, errorCode:
     'WRAP_UP_UNAVAILABLE' }`.
   - Idempotency: once per stage rank per turn (`entry.wrapUpRequestedRank`, the renamed
     `liveNoticedRank` slot). Reset at `onTurnTerminal` (:331-338) and on extend or a settings change
     (:552). A repeat returns `success: true` and posts nothing.
   - The text says the user will continue in a new session (627-L19).
2. **Wait and show (D22 item 2, D25).** The work gate applies to every `begin` without
   `continueNow`, at every stage, including the parked limit and an approved agent request.
   - No D6 bound, no timer; recheck points are `armAtTerminal` and every `begin`.
   - Lane-provider throw: `waitingFor.lanes = null` (unknown), WARN once per op. Unknown counts as
     work in flight, so the wait never ends on its own while unknown; a later terminal whose provider
     call succeeds re-reads it. "Continue now anyway" is always offered.
3. **Contract shape.** Minimal:
   - `SessionHandoverReason` drops `'budget-auto'`.
   - `SessionHandoverState` gains `requestedBy?: 'agent'` (only while the op came from
     `requestFromAgent` and was not approved or converted) and `draftText?: string` (only in
     `cancelled` or `failed`, see Decision 5). `waitingFor.lanes` becomes `number | null`
     (`null` = lane status unknown); its doc comment names the user-started wait.
   - `BeginSessionHandoverParams` gains `continueNow?: boolean`. `queuedInput` keeps its name and
     doc; it now becomes the draft.
   - `SessionBudgetAction` gains `'request-wrap-up'`; the error union gains `'WRAP_UP_UNAVAILABLE'`.
   - `SessionStatsLivePayload` and `SessionStatsLiveWire` gain `liveBudgetStage?: 'handoff' |
     'limit' | null`, with the `budget` convention (`agent-adapter.types.ts:82-87`): absent = no
     change, `null` = clear, a value = set.
   - `BeginSessionHandoverResult`, `CancelSessionHandoverResult`, `SessionChildStartResult` and the
     `'source session unavailable'` literal are unchanged.
4. **Subagent monitor is kept.** It never creates, arms or starts a session handover; the session
   keeps running. 627-L1 and 627-L17 remain.
5. **Captured composer text is a draft (D24).**
   - Storage: `Operation.draftText?: string`, separate from `Operation.inputs`. `begin` stores
     `queuedInput` there (a second capture on the same op is appended after a blank line). It never
     enters `inputs`, so `heldInputCount` excludes it and `restore()`/`restoreInputs` never see it.
     The begin handler stops calling `admitOrHold`.
   - Success: `complete()` appends the draft as one `require-idle` input after the held inputs in the
     first transfer batch to the successor (the user asked to continue there with it). The draft is
     cleared only on the transition to `closing`.
   - Cancel or failure before `closing` (any cancellable phase, `fail()`, delivery failure after the
     draft was delivered, `sourceEnded`): the draft stays on the op and the snapshot publishes
     `draftText`. It is never sent to the source.
   - Return path: the cancel RPC result `state` and the `SESSION_STATS` broadcast both carry
     `draftText`. The webview applies it once per `operationId`, only into a mounted composer and
     acknowledged only after the write (Component F1/F2), into the composer
     **input**, never into `queuedContent` (which auto-sends after the turn).
6. **Fold in 627-L6 with one hold predicate.** `holdsSource(op)` = `HELD_SOURCE_PHASES.has(phase)`
   and not (`phase === 'awaiting-confirmation'` and `requestedBy === 'agent'`). `admitOrHold`, the
   queued-input move in `armAtTerminal`, and `admitInterrupt` all use it. `admitInterrupt` therefore
   no longer blocks Stop during a user-started wait or an agent request (627-L6).
7. **Banner visibility.** The banner also renders while `streaming` when the display stage is
   `handoff`/`limit` or a handover snapshot is pending (including an agent request, which arrives
   mid-turn). Without this neither the wrap-up button nor Approve can be clicked
   (`chat-view.component.ts:939-950`).
8. **Agent-initiated successor (D23).** `requestFromAgent(source, agentHandoff?)` applies `begin`'s
   guards (`unavailable`, `source-unavailable`) and parks as above; it never sets `userConfirmed`,
   never runs the gate and never calls `startConfirmed`. `armAtTerminal` leaves the parked agent op
   alone, except at a blocking-limit terminal, where the same op becomes the limit park (reason
   `budget-limit`, `requestedBy` cleared, `agentHandoff` kept, now holding), because sends are
   refused there and P9 must stop queued inputs draining past the limit. Approve is
   `continueInNewSession()` → `session:beginHandover` → `begin`, which keeps the op's
   `agentHandoff`, clears `requestedBy`, sets `userConfirmed`, and gates. The tool returns
   `{ ok: true, successor: true }` (unchanged shape); the reply text tells the agent: "Successor
   handover requested. It waits for the user to approve it in the session banner; nothing changes
   until then. Keep working normally. If the user cancels, this session continues." The tool
   description (`session-tools.ts:64-65`) says successor mode asks the user.

## Lane-introduced constraints (reviewer list): kept, and UI/backend agreement

| Constraint | Kept? | UI | Backend | Agree? |
| --- | --- | --- | --- | --- |
| Wrap-up only during a running turn at handoff/limit with a budget entry | Yes | Button shown only while `streaming` at display stage ≥ handoff; a refusal shows "The agent is not working on a turn right now." | `turnInFlight` from the lifecycle record; returns `WRAP_UP_UNAVAILABLE` | Yes. At the turn edge the two signals can differ by one event; the backend is authoritative and the UI shows its refusal. |
| One wrap-up per stage rank per turn | Yes | Local `${sessionId}\|${stage}` flag disables the button; reset when the tab leaves `streaming` | `wrapUpRequestedRank` reset at `onTurnTerminal`, extend, settings change | Yes: both reset at the turn end. Extend lowers the stage, so the UI key changes too. A mismatch cannot double-post: a repeat returns `success: true` and posts nothing. |
| Lane-provider error counts as zero | **No** (D25) | "lane status unknown" in the waiting copy | `lanes: null`; the wait does not end on its own | Yes. |
| No timer or automatic escalation | Yes | No countdown; both exit buttons always shown in the waiting state | Recheck only at terminals and begins | Yes. |
| Composer sends during a wait go to the source | Yes | Waiting copy "Messages you send now go to this session" | `waiting-for-turn-end` and an agent-requested park hold nothing | Yes. Spec S23 checks it. |

## Component specifications

### B1. SessionHandoverCoordinator: user-only start

- Purpose: the single authority for whether a handover may start.
- Responsibilities:
  - `begin(source, reason, turnInFlight, agentHandoff?, options?: { continueNow?: boolean;
    queuedInput?: string })`: existing guards (:240-247); fold `request()` in; set `userConfirmed`;
    store `queuedInput` as `draftText` (Decision 5); on a parked op (limit or agent) clear
    `requestedBy` and keep its `agentHandoff`; apply the gate unless `continueNow`; with
    `continueNow` mid-turn set `forced`.
  - `requestFromAgent(source, agentHandoff?)`: Decision 8. Returns `BeginSessionHandoverResult`.
  - `armAtTerminal(source, atBlockingLimit, queuedInputs)`: park `budget-limit` when
    `atBlockingLimit` and no live op exists; convert a parked agent op at the blocking limit
    (Decision 8); for a `userConfirmed` op in `waiting-for-turn-end`, re-run the gate unless
    `forced`, then publish `waitingFor` or start; move queued inputs only when `holdsSource(op)`.
    Never create anything else.
  - `workInFlight`: lanes `null` on a provider throw; returns `waitingFor` when subagents > 0, lanes
    > 0 or lanes is `null`.
  - `startConfirmed(op)` replaces `startAutomatic`, `confirmSuccessor`, `confirmBudgetOperation`;
    no effect unless `op.userConfirmed`; the only caller of `complete()`.
  - `complete()`: draft in the first transfer batch; clear `draftText` at `closing` (Decision 5).
  - `snapshot()`: `requestedBy` when set; `draftText` only in `cancelled`/`failed`.
  - Delete P5-P7 code and `confirm()`. Clear `waitingFor` in `cancel`/`fail`/`sourceEnded`
    (627-L2). `holdsSource` (Decision 6).
- Verified contracts: the evidence table; `isRestartable` :801-806; `complete` :527-633; `restore`
  :759-775; `sourceEnded` :714-733.
- Dependencies: unchanged.
- Failure behaviour: provider throw → lanes unknown, WARN (no longer fail-open); `complete` failure →
  `failed`, inputs restored, `draftText` published; the `'source session unavailable'` literal is
  byte-identical.
- Verification seam: `session-handover-coordinator.service.spec.ts`.
- Files: MODIFY
  `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\agent-sdk\src\lib\helpers\session-handoff\session-handover-coordinator.service.ts`
  and `.spec.ts`.

### B2. Lifecycle and adapter wiring: arm nothing, park the blocking limit

- `onTurnTerminal` calls `armAtTerminal(key, atBlockingLimit, queue)` with no stage argument, then
  `sessionBudget.onTurnTerminal` (existing order).
- `armHandoverIfIdle` becomes `parkLimitHandoverIfIdle`: no-op unless idle and `isAtBlockingLimit`;
  otherwise it delegates to `armAtTerminal(key, true, rec.messageQueue)` exactly as today's call does
  (`session-lifecycle-manager.ts:539-549`), so the agent-op → limit-park conversion (Decision 8) and
  the `holdsSource` queue move have one implementation for both detection points (terminal and
  post-result, `sdk-agent-adapter.ts:1812-1834`). No separate park path. Delete
  `atHandoffOrLimitStage`. The adapter `wrapResultStatsForActivity` calls it only when
  `budget?.blocked === true`.
- Adapter `wrapLiveStatsForBudget`: when `observeLive` returns `undefined`, the payload goes to
  `inner` without `liveBudgetStage`; when it returns `null` or a stage, the field is set to it. A
  throw keeps the WARN-once and omits the field.
- Files: MODIFY `...\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts` and spec;
  `...\agent-sdk\src\lib\sdk-agent-adapter.ts` and spec.

### B3. SessionBudgetService: display-only live stage, wrap-up on request

- `observeLive(snapshot): 'handoff' | 'limit' | null | undefined` (D25), D13-D15 rules kept, no post:
  - `undefined` (no change; the frontend keeps what it shows): not provisional, untracked or released
    entry (`trackedEntry` null), older revision (:285-288), measure mismatch (:303-310), and a throw.
    The retained `liveFigure` is untouched on these paths.
  - `null` (clear): budget disabled (`liveFigure` cleared, :277-281), and an accepted figure below
    handoff (including a fresh figure after a settings change, `resetStage`).
  - the stage: an accepted figure at `handoff` or `limit`.
- `noticeLiveStage` becomes log-only `logLiveStage` (once per rank per turn).
- `act` case `'request-wrap-up'` (Decision 1); rewrite `wrapUpNotice`; widen
  `SessionBudgetSessionControl` with `'find'`.
- Failure: `act` never throws (:409-419). No `noticeQueue` → `WRAP_UP_UNAVAILABLE`.
- Files: MODIFY `...\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts` and spec.

### S1. Shared contract

- Files: MODIFY under `libs\shared\src\lib\types\`:
  - `session-handover.types.ts`: reason union, `requestedBy`, `draftText`, `waitingFor.lanes:
    number | null`, `continueNow`; the header comment notes that `draftText` is the user's own
    composer text returned in a terminal phase.
  - `session-budget.types.ts`: action and error code.
  - `agent-adapter.types.ts`: `liveBudgetStage?: 'handoff' | 'limit' | null`.
  - `messages\session-stats-live.ts` and `session-stats-live.spec.ts`: on a provisional payload the
    parser keeps `'handoff'`, `'limit'` or `null`; any other value drops only the field (= no
    change), the same rule as `context`.

### R1. RPC handlers

- `session-handover-rpc.schema.ts`: `continueNow: z.boolean().optional()`.
- `session-handover-rpc.handlers.ts`: pass `{ continueNow, queuedInput }` to `begin`; remove
  `admitOrHold` (:98-103); one INFO line `{ sourceSessionId, continueNow }`. Cancel handler
  unchanged (its `state` carries `draftText`).
- `session-budget-rpc.schema.ts`: `'request-wrap-up'` in `SESSION_BUDGET_ACTIONS`.
- Specs: `session-handover-rpc.handlers.spec.ts`, `session-budget-rpc.handlers.spec.ts`.

### C1. Agent successor tool (D23)

- `session-spawner.service.ts` `startSuccessor` (:288-310): call
  `handoverCoordinator.requestFromAgent(activeId, request.handoff)` instead of `begin`; drop the local
  `turnInFlight` read (the injected `turnState` stays; it is used at :1328-1329). Refusals unchanged.
  Narrow the coordinator `Pick` in the spec harness (:70, :185) from `'begin'` to
  `'requestFromAgent'`, so the agent path cannot reach `begin`.
- `session-tool-handlers.ts` `sessionStartReply` (:184-192): the new reply text (Decision 8).
  `session-tools.ts:64-65`: description says successor mode asks the user to approve.
- Failure: coordinator refusal → existing `chat-runtime-unavailable` refusal.
- Specs: `session-spawner.service.spec.ts` (:407-424 rewritten), `session-tools.spec.ts` (:324).
- Files: MODIFY
  `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\cli-agent-runtime\src\lib\session-children\session-spawner.service.ts`
  and `.spec.ts`;
  `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\session-tool-handlers.ts`,
  `session-tools.ts`, `session-tools.spec.ts`.

### F1. Frontend state: live stage and draft bookkeeping

- `TabState` gains `liveBudgetStage: 'handoff' | 'limit' | null` (`tab-manager.service.ts`, beside
  `sessionBudget`, with a setter).
- `session-stats-aggregator.service.ts`: `handleLiveSessionStats` — field absent: no change; `null`:
  clear; a value: set. `handleSessionStats` clears it on a result (not on a snapshot-only broadcast).
- `SessionBudgetActionsService.displayStage`: the live stage counts only while the tab is
  `streaming` and its `sessionBudget` is non-null (covers Stop, an abnormal stream end, disable).
  Gains `requestWrapUp()` (`runAction('request-wrap-up')`, local requested flag per Decision 1 row)
  and `continueNowAnyway()` (begin with `continueNow: true`). `continueInNewSession` still clears
  `queuedContent` only when `accepted`; it is also the Approve path for an agent request.
- `SessionHandoverClientService` draft bookkeeping is a peek plus an explicit acknowledgement (Round
  2), never a consuming read:
  - `peekDraft(sessionId): { operationId: string; text: string } | null` returns the recorded
    state's `draftText` when the phase is `cancelled`/`failed` and that `operationId` is not yet
    acknowledged. It changes nothing.
  - `acknowledgeDraft(operationId)` adds the id to a root-scoped `Set` (a canvas tile and the main
    panel cannot both apply it). Called only after `restoreDraftToInput` returned.
  - Why peek + ack rather than "an effect that waits for a mounted input, then takes": both need the
    effect to read `chatInputRef()`, but only peek + ack ties consumption to the write itself, so any
    reason the composer is absent (compact view, `chat-view.component.html:4-18` vs `:254-258`; the
    optional `viewChild` at `chat-view.component.ts:638`, used with `?.` at `:1316`) or a throw in
    the write leaves the draft recoverable. One rule, no "is it mounted" predicate to keep in sync.

### F2. Banner and view

- `session-budget-banner.component.ts`: inputs `turnRunning`, `liveStage`; outputs `requestWrapUp`,
  `continueNowAnyway`, `approveAgentRequest`. `stage` uses the display stage. Copy per the state table:
  "This session is near its budget" replaces "Preparing to continue…"; "Waiting for handover to start
  at …" is removed; agent-request copy and Approve/Cancel; waiting copy with "lane status unknown"
  when `lanes === null` (the count validator at :73 accepts `null` for lanes). New buttons get
  `aria-label`s.
- `chat-view.component.ts`/`.html`: visibility (Decision 7), bindings, and one effect that reads
  both `resolvedHandover()` and `chatInputRef()`. With no mounted input it does nothing (the draft
  stays unacknowledged); when the signal `viewChild` resolves (compact → full view), the effect
  re-runs. With an input it calls `peekDraft`, then `chatInputRef()!.restoreDraftToInput(text)`,
  then `acknowledgeDraft(operationId)`; a throw skips the acknowledgement.
- Banner and waiting copy, from the accepted begin until the op closes or ends, when the click sent a
  non-empty `queuedInput` (a local per-`operationId` flag set by `continueInNewSession`, since
  `draftText` is published only in `cancelled`/`failed`): "Your queued message will be sent in the
  new session." (R5; `complete()` delivers it after the held inputs, `chat-session.service.ts:791-806`.)
- `chat-input.component.ts`: new `restoreDraftToInput(text)`: an empty composer gets the text; a
  non-empty one gets `current + '\n\n' + text` (never drops, never overwrites). Never sends.
- No new timers or observers.

## Integration architecture

- Data flow:
  1. Live payload → `observeLive` → `undefined | null | stage` → adapter omits or sets
     `liveBudgetStage` on `SESSION_STATS_LIVE` (`sdk-callbacks.ts:168-170`) → parser → aggregator
     (absent: no change) → tab → display stage (only while streaming, budget non-null).
  2. A user click → RPC → `act`/`begin`. Only `begin` sets `userConfirmed`; only `startConfirmed`
     calls `complete`.
  3. The agent tool → `requestFromAgent` → parked op → `SESSION_STATS` broadcast → banner → Approve →
     step 2.
  4. A terminal → `armAtTerminal`: park the blocking limit, convert a parked agent op at the
     blocking limit, or advance a confirmed wait.
  5. A result → `observe`; when `blocked`, `parkLimitHandoverIfIdle`. The webview clears the live
     stage.
  6. Cancel/failure → snapshot with `draftText` → cancel result and broadcast → `peekDraft` (only
     with a mounted composer) → `restoreDraftToInput` (append, never overwrite) → `acknowledgeDraft`.
- State: in memory per session (existing). The draft lives on the op until `closing` or a terminal
  phase; the op is replaced on the next begin (`isRestartable`).
- Failure and rollback: Cancel restores held inputs in every cancellable phase and returns the draft.
  A failed start → `failed`, inputs restored, draft returned, Retry.
- Observability: existing INFO phase lines (now with `requestedBy`); INFO `[SessionBudget] Wrap-up
  requested by the user for <id> at <stage>`; INFO `[SessionHandover] Agent requested a successor
  for <id>`; WARN for an unknown lane count; the begin handler INFO. Log check: no
  `writing-handoff` line without a preceding begin-handler line.

## Spec cases that prove D22-D25

| # | Case | Spec |
| --- | --- | --- |
| S1 | Terminal at a live `handoff`, idle, 0 work: no op, nothing published, `complete` not called | coordinator + lifecycle |
| S2 | Terminal at an authoritative `handoff` and a non-blocking `limit`: no op | lifecycle + coordinator |
| S3 | Result at `handoff`/non-blocking `limit`: `parkLimitHandoverIfIdle` not called; with `blocked: true` it parks `budget-limit` in `awaiting-confirmation` | adapter + lifecycle |
| S4 | Stop at a live `handoff`: no op | lifecycle |
| S5 | `observeLive` at 81% and 105%: `noticeQueue.post` never called; returns `handoff`/`limit`; `blocked` unchanged | budget service |
| S6 | `request-wrap-up`: posts once in a running turn at `handoff`; repeat in the turn posts nothing and succeeds; posts again at `limit`; after `onTurnTerminal` may post again; idle or below handoff → `WRAP_UP_UNAVAILABLE` | budget service + budget RPC |
| S7 | `begin` idle with 1 subagent and 1 lane: waits, `waitingFor {1,1}`; terminal with work: waits; terminal with 0: starts; repeat `begin` unchanged | coordinator |
| S8 | `begin{continueNow}` idle starts at once; mid-turn sets `forced` and the next terminal starts despite work | coordinator + handover RPC |
| S9 | Cancel from `waiting-for-turn-end` and from the parked limit restores held inputs via `restoreInputs`, which never receives the draft; `cancelled`, `waitingFor` cleared | coordinator + handover RPC |
| S10 | `admitInterrupt` during a user-started wait and during an agent request does not hold | coordinator |
| S11 | Blocking limit unchanged: `canSend` refuses; the park holds queued inputs; `extend` as before | `chat-session-budget.spec.ts` green; coordinator park case |
| S12 | `source-unavailable` and the `'source session unavailable'` fallback unchanged | actions spec green |
| S13 | Webview: banner shows while streaming at a live `handoff`; wrap-up emits once then disables; waiting copy shows counts with both buttons; idle hides wrap-up | banner, actions, chat-view specs |
| S14 | Parser keeps `liveBudgetStage` `'handoff'`, `'limit'`, `null` on a provisional payload; drops other values and non-provisional | `session-stats-live.spec.ts` |
| S15 | `requestFromAgent`: parks `successor` in `awaiting-confirmation` with `requestedBy: 'agent'`, `userConfirmed` unset, `complete` not called; a non-blocking terminal leaves it parked; `admitOrHold` does not hold; a live op returns its snapshot unchanged; `unavailable`/`source-unavailable` guards | coordinator |
| S16 | Approve: `begin` on the agent op sets `userConfirmed`, clears `requestedBy`, keeps `agentHandoff`, gates (waits with work, starts idle). Blocking-limit terminal on the agent op converts it to the holding limit park. Post-result: the blocking limit first becomes authoritative on the result (terminal saw non-blocking) → adapter calls `parkLimitHandoverIfIdle` → same conversion through `armAtTerminal(key, true, queue)` (reason `budget-limit`, marker cleared, `agentHandoff` kept, queued inputs held, `complete` not called) | coordinator + lifecycle + adapter |
| S17 | Spawner successor mode calls `requestFromAgent` (never `begin`) and returns `{ ok: true, successor: true }`; refusals unchanged; reply text says it awaits the user | `session-spawner.service.spec.ts`, `session-tools.spec.ts` |
| S18 | Banner agent copy; Approve emits → `beginHandover`; Cancel → `cancelHandover` | banner + actions specs |
| S19 | Draft (D24): `begin` with `queuedInput` while the turn runs, then Cancel before the turn ends → `draftText` in the cancel snapshot, `restoreInputs` without it, `heldInputCount` excludes it; Cancel after the turn ended (`writing-handoff`) → same; Cancel at the blocking-limit park → held inputs restored and draft returned separately; failure (`complete` throws, delivery fails after the draft batch, `sourceEnded`) → `draftText`; success → draft last in the first transfer batch, no `draftText` after `closing` | coordinator + handover RPC (no `admitOrHold`) |
| S20 | Webview draft: a `cancelled`/`failed` state with `draftText` puts it in the composer once per `operationId` (empty composer: set; non-empty: appended after a blank line, never overwritten); `queuedContent` untouched; no send call. `peekDraft` alone never acknowledges. Compact → full recovery: state arrives while the tab is compact (no `chatInputRef`) → not acknowledged, composer untouched; switch to full view → the draft is applied and acknowledged once; a second tile/panel does not re-apply it. A throwing `restoreDraftToInput` leaves it unacknowledged | handover client, chat-view, chat-input specs |
| S21 | Live contract (D25): `observeLive` returns `undefined` for older revision, measure mismatch, untracked/released, throw (retained `liveFigure` untouched); `null` when disabled and below handoff; adapter omits for `undefined`, sends `null`; aggregator: absent keeps, `null` clears, result clears; display ignores live when not streaming or budget null | budget service, adapter, aggregator, actions specs |
| S22 | Unknown lanes: provider throws → `waitingFor { subagents: 0, lanes: null }`; terminal keeps waiting; a later terminal with a readable 0 starts; `continueNow` starts; banner shows "lane status unknown" | coordinator + banner |
| S23 | During a user-started wait a composer send goes through the normal send path to the source and is not held; waiting copy says so | chat-view (or actions) + coordinator `admitOrHold` |

## Deferred rows (627-L1..L20) under D22

- **Disappear by design:** 627-L13, L14, L15; D20 items 1 and 2; the notice re-post half of L16; the
  "single retry" half of L20.
- **Fixed by this addendum:** L19 (notice wording); L2 (`waitingFor` cleared); L6 (interrupt during
  the wait).
- **Shrinks:** L7 (the coordinator loses S1, D6 and suppression code; re-measure `max-lines`); L18 (a
  skipped park after a throwing `inner` is harmless).
- **Stays as recorded:** L1, L3, L4, L5, L8, L9, L10, L11, L12, L17, the display half of L16 (now
  limited by the streaming-only display rule), and the cost half of L20.

## Team-leader handoff

- Recommended executors: backend-developer for S1, B1-B3, R1 and C1; frontend-developer for F1-F2.
- Complexity: MEDIUM-HIGH. Backend work is mostly deletion around one invariant, plus the draft slot
  and `requestFromAgent`. Risk sits in spec rewrites (many cases assert `budget-auto`) and the draft
  return path.
- Dependencies and ordering (component level):
  1. S1 + B1 + B2 + B3 together (removing the reason breaks agent-sdk until B1 lands; C1 needs
     `requestFromAgent`). Libs: shared, agent-sdk.
  2. Then R1 (rpc-handlers), C1 (cli-agent-runtime, vscode-lm-tools), and F1 + F2 (chat-state, chat).
     File-disjoint; may be implemented in parallel, but checks run one at a time.
- Files affected (all MODIFY, under the worktree root):
  - shared: `session-handover.types.ts`, `session-budget.types.ts`, `agent-adapter.types.ts`,
    `messages/session-stats-live.ts` and spec.
  - agent-sdk: `session-handover-coordinator.service.ts`, `session-lifecycle-manager.ts`,
    `sdk-agent-adapter.ts`, `session-budget.service.ts`, each with its spec.
  - rpc-handlers: `session-handover-rpc.schema.ts`, `session-handover-rpc.handlers.ts` and spec,
    `session-budget-rpc.schema.ts`, `session-budget-rpc.handlers.spec.ts`.
  - cli-agent-runtime: `session-children/session-spawner.service.ts` and spec.
  - vscode-lm-tools: `code-execution/mcp-core/session-tool-handlers.ts`, `session-tools.ts`,
    `session-tools.spec.ts`.
  - chat-state: `tab-manager.service.ts` and spec.
  - chat: `session-stats-aggregator.service.ts`, `session-budget-actions.service.ts`,
    `session-handover-client.service.ts`, `session-budget-banner.component.ts`,
    `chat-view.component.ts`/`.html`, `chat-input.component.ts`, and their specs.
- Verification (one heavy check at a time, from the worktree root; never run-many, build, serve or
  `npm install`; never edit a config):
  - shared: `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/messages/session-stats-live.spec.ts --coverage=false --maxWorkers=2`;
    `npx nx typecheck @ptah-extension/shared --parallel=1`; `npx nx lint @ptah-extension/shared --parallel=1`.
  - agent-sdk: `npx jest -c libs/backend/agent-sdk/jest.config.ts <the four changed specs> --coverage=false --maxWorkers=2`;
    typecheck and lint `@ptah-extension/agent-sdk` with `--parallel=1` (no warning on a changed line;
    record `max-lines` against the baseline).
  - rpc-handlers: `npx jest -c libs/backend/rpc-handlers/jest.config.ts <handover + budget handler specs> libs/backend/rpc-handlers/src/lib/chat/session/chat-session-budget.spec.ts --coverage=false --maxWorkers=2`;
    typecheck and lint `@ptah-extension/rpc-handlers` with `--parallel=1`.
  - cli-agent-runtime: `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{"^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js","^vscode$":"D:/projects/ptah-extension/.claude-worktrees/session-budget-handoff/__mocks__/vscode.ts"}'`
    (the `marked` worktree quirk, `batches.md:34-40`); typecheck and lint
    `@ptah-extension/cli-agent-runtime` with `--parallel=1`.
  - vscode-lm-tools: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts --coverage=false --maxWorkers=2`
    (add the same mapper if A3 fails); typecheck and lint `@ptah-extension/vscode-lm-tools` with
    `--parallel=1`.
  - chat-state, chat: `npx jest -c libs/frontend/<lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`
    (chat may need the same mapper); typecheck and lint `@ptah-extension/chat-state` and
    `@ptah-extension/chat` with `--parallel=1`.
  - Grep gates after the backend batches:
    - no `budget-auto`, `startAutomatic`, `WORK_IN_FLIGHT_WAIT_LIMIT_MS`, `cancelledAutomaticSources`
      in `libs`;
    - `userConfirmed = true` appears only inside `begin`; `.begin(` on the coordinator is called only
      from `session-handover-rpc.handlers.ts`;
    - `complete(` is called only from `startConfirmed`;
    - `noticeQueue?.post` appears only in the `request-wrap-up` path;
    - `draftText` never reaches `restoreInputs` or `admitOrHold`.

## Risks

- **Q2 (decided "as today"):** "Allow 20% more" leaves a parked limit op pending; the banner keeps
  "Cancel handover". Optional follow-up: cancel the parked op on extend.
- **R1:** the wait re-checks only at terminals and clicks, so counts can lag (A1, A2). An unknown lane
  count can keep the wait open until a readable terminal or "Continue now anyway"; by D25 that is
  intended, and the copy says "lane status unknown".
- **R2:** composer sends during a wait go to the source (copy and S23).
- **R3:** the banner renders while streaming; it must not steal focus or shift the composer. Applying
  a returned draft focuses the composer only on Cancel/failure, which the user caused. Covered by the
  user's Phase 2 manual Electron check.
- **R4:** spec churn. Rewrite `budget-auto`/D6/S1 cases to S1-S23, not loosen them.
- **R5 (accepted, Round 2):** the queued message rides to the successor on success, as the user's
  Send intended; the banner says "Your queued message will be sent in the new session." D24's draft
  return covers Cancel/failure only.
- **R6 (accepted, Round 2):** an agent request converted at the blocking limit (at the terminal or
  after the result) shows the limit copy, not the agent copy; the agent's handoff text is kept and
  used if the user picks "New session".
- **R7:** an agent can re-request after the user cancels. Each request parks once and holds nothing,
  so the cost is a banner; a frequency limit is not added without evidence.

## Revision log

- Finding 1 / Q1 → D23: `ptah_session_start` successor mode now calls `requestFromAgent`, which parks
  a `successor` op in `awaiting-confirmation` with `requestedBy: 'agent'`; banner copy, Approve (the
  user begin with the gate and "Continue now anyway") and Cancel; tool reply text defined; a parked
  agent op holds nothing; `userConfirmed` is set only in `begin`, reachable only from the user RPC
  (grep gate). Added C1 (cli-agent-runtime spawner + spec, vscode-lm-tools reply/description + spec),
  the `marked` mapper command, S15-S18, R6-R7. Q1 removed.
- Finding 2 → D24: captured composer text is `Operation.draftText`, outside `inputs`, never passed to
  `restoreInputs`; published as `SessionHandoverState.draftText` in `cancelled`/`failed`; carried by
  the cancel result and the `SESSION_STATS` broadcast; applied once per operation into the composer
  input with a new append-safe `restoreDraftToInput`, never into `queuedContent`. Success transfers it
  with the first batch. S9 reworded; S19-S20 added; R5.
- Finding 3 → D25: `observeLive` returns `undefined` (no change) on every early return, `null` to
  clear (disabled, below handoff), or the stage; `liveBudgetStage?: … | null` follows the `budget`
  wire convention; the webview clears on the result and ignores the live stage when not streaming or
  without a budget. S14 widened; S21 added.
- D25 lane status unknown: `waitingFor.lanes: number | null`; unknown keeps the wait open, shows
  "lane status unknown"; "Continue now anyway" always available. Decision 2 changed; S22 added.
- Lane-introduced constraints: new table with keep/drop and UI/backend agreement, including the
  wrap-up reset point.
- Spec table, files, batches (new C1 group, scoped checks per project), grep gates and Risks updated.

### Round 2 (answers `implementation-plan-v2-user-authorized-rereview.md`)

- New finding 1: `takeDraft` replaced by `peekDraft` + `acknowledgeDraft`, acknowledged only after
  `restoreDraftToInput` returns; the chat-view effect reads `chatInputRef()` and does nothing while
  compact, re-running on mount. Append, never overwrite. F1, F2, data flow 6, S20 (compact → full
  recovery, throw, no double apply).
- R5 accepted: banner/waiting copy "Your queued message will be sent in the new session." F2, Risks.
- R6 accepted: `parkLimitHandoverIfIdle` delegates to `armAtTerminal`, sharing the agent-op →
  limit-park conversion. Architecture item 2, B2, S16 (post-result case), Risks.
