# Code Logic Review — `TASK_2026_494` Batch 12

Scope: `libs/frontend/mcp-apps-page/src/lib/services/apps-workspace-slice.ts`,
`apps-surface-sync.ts` (+ `.spec.ts`), `apps-session.service.ts` (+ `.spec.ts`). Read in full.
Read for interface context only (not reviewed): `apps-surface-reducer.ts`, `apps-surface-intake.ts`
(Batch 11), `surface-update-inbox.service.ts` (Batch 1). `npx nx run-many -t test -p
@ptah-extension/mcp-apps-page --skip-nx-cache` was run: 1/1 project green (see Verification).

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                     |
| Serious issues      | 0                                     |
| Moderate issues     | 3                                     |
| Failure modes found | 4                                     |

## Five logic questions

### 1. How does this fail silently?

- `AppsSessionService.send()` (`apps-session.service.ts:236-243`): when the session has not
  resolved yet, the prompt is discarded (never appended to `userBubbles`, never sent) and only
  a generic `error` string is set. The caller sees a failure notice, so this is not truly silent,
  but nothing preserves the user's typed text for retry — the caller must re-type it. See Failure
  mode "Unresolved-session send loses the draft".
- `AppsSurfaceSync.onPush` / `requestRead` / `expectRevision` / `dispose` all wrap their bodies in
  `try/catch` and only `console.warn` on failure (`apps-surface-sync.ts:106-116, 122-133,
  140-159`). A thrown error inside the reducer or `applySurfaceOps` would be swallowed and the
  slice would keep its last-good state — this is the intended fail-closed behaviour per
  implementation-plan.md:470-476 ("intake, reducer and guard never throw"), not a defect, but it
  does mean a *new* throwing bug introduced later in the reducer would silently stop applying
  pushes with only a console line as evidence.
- A failed `chat:start` fully resets the slice (`apps-session.service.ts:452`,
  `rollBackFailedStart`) — the `error` field is the only surviving signal; the transcript line the
  user typed is gone. Not "success-looking", but the loss itself is undiscoverable without the
  error text (see deviation 7).

### 2. What user action produces unexpected behaviour?

- Typing and sending a second message in the (short) window between `chat:start` succeeding and
  `TabSessionBinding.conversationForSurface` resolving produces a visible error and a dropped
  message with no auto-retry (`apps-session.service.ts:227-243`, spec-pinned at
  `apps-session.service.spec.ts:595-603`).
- Retrying `start()` after a failed start is transparent (slice is fully reset), but retrying loses
  the original prompt text the user already typed — they must re-type it.
- Switching workspaces mid-conversation is fully supported and round-trips state correctly
  (`apps-session.service.spec.ts:443-462`); no defect found there.

### 3. What input data produces a wrong answer?

- None found that produces a *wrong* answer (as opposed to a dropped/erroring one). The revision
  bookkeeping (`materializedRevision`, `expected`) is exercised against genuine gap/echo scenarios
  in the spec and holds up under trace (see Data flow).
- A crafted `surface:updated` payload whose top-level `routingId` matches this slice's routing id
  but is otherwise malformed is correctly routed to the reducer and rejected there
  (`apps-surface-sync.ts:105-116` → `applySurfacePush` → `guardSurfacePush`, Batch 11 scope).

### 4. What happens when a dependency fails?

- `ClaudeRpcService.call('surface:read', …)` timeout/transport failure: handled — last good view
  kept, `syncNotice` set, next trigger retries (`apps-surface-sync.ts:216-234`, spec
  `apps-surface-sync.spec.ts:310-332, 349-372`).
- `chat:start` / `chat:continue` / `chat:abort` RPC rejection or `{success:false}`: handled via
  `rollBackFailedStart` / `failTurn`, both reachable from the `catch` and the `!result.success`
  branch (`apps-session.service.ts:196-220, 258-273, 288-313`).
- `TabSessionBinding` / `ConversationRegistry` returning no session/record: handled defensively in
  `sessionFor` (`apps-session.service.ts:534-540`), returns `null`, callers treat that as "still
  starting".
- A release step throwing during rollback/discard/workspace-removal
  (`releaseConversation`, `apps-session.service.ts:478-497`): each step is individually
  try/caught so one failing collaborator (e.g. `streamRouter.onSurfaceClosed` throwing) does not
  prevent the others from running. Verified by inspection; no spec explicitly injects a throwing
  collaborator here (Moderate finding).

### 5. What is missing that the requirements never mentioned?

- No mechanism to preserve or resend a user's prompt after a failed `start()` or an
  unresolved-session `send()` — the plan specifies *that* rollback/error happens, not what UX
  recovers the lost text. Recorded as a Moderate/UX finding below, not a logic defect against the
  written contract.
- No spec exercises a *time-gapped* second `expectRevision` call (both grace-timer specs call it
  twice at the same fake-timer instant) — the "re-armed rather than multiplied" wording is
  therefore only partially pinned. See Deviation ruling 1.

## Failure modes

### Unresolved-session send loses the draft

- Trigger: `send(prompt)` called after `start()` has returned but before
  `TabSessionBinding.conversationForSurface` resolves a conversation id.
- Symptom: `error` is set to "The Apps session is still starting. Try again in a moment."; the
  prompt is never added to `userBubbles` and is not retried automatically.
- Evidence: `apps-session.service.ts:235-243`; pinned by
  `apps-session.service.spec.ts:595-603`.
- Current handling: user-visible error, manual re-send required (no text preserved by this
  service — whatever composer component Batch 15 builds must retain the draft on its own).
- Recommendation: none required by the plan (Batch 13/15 own the UI); flag for Batch 15's
  reviewer that the composer must not clear the input text until `send()` succeeds.

### Failed `start()` discards the first typed bubble

- Trigger: `chat:start` returns `{success:false}` or rejects.
- Symptom: `rollBackFailedStart` replaces the whole slice with `createAppsWorkspaceSlice()` plus
  the `error` text; the bubble recorded by `startAppsSlice` (`apps-workspace-slice.ts:150-162`) is
  gone.
- Evidence: `apps-session.service.ts:441-453`; `apps-workspace-slice.ts:154-161`.
- Current handling: matches implementation-plan.md:471 ("chat:start failure: full rollback")
  literally.
- Recommendation: see Deviation ruling 7 — accepted as spec-compliant, but worth a UX note for the
  team since "full rollback" is not explicitly defined to include or exclude the transcript draft.

### Grace-timer deadline does not restart on a second ack for the same surface

- Trigger: `expectRevision(surfaceId, r1)` followed later (real time elapsed, not the same tick) by
  `expectRevision(surfaceId, r2)` before the first grace timer fires.
- Symptom: the read fires at `t0 + 1,500ms` (from the first ack), not at
  `t1 + 1,500ms` (from the second, more recent ack) — the second ack gets less than a full grace
  window.
- Evidence: `apps-surface-sync.ts:140-159` (`if (... this.graceTimer === null)` — no branch resets
  an already-armed timer).
- Current handling: harmless — an early `surface:read` is idempotent and self-corrects
  (`reconcileExpected`); no data is lost or corrupted, only a possibly redundant read.
- Recommendation: none required (see Deviation ruling 1); consider a spec that arms the timer,
  advances a partial interval, then sends a second `expectRevision` to document the accepted
  behaviour explicitly.

### `reconcileExpected` can drop an expectation for a surface it never received

- Trigger: `expectRevision(surfaceId, r)` is called for a surface id that never appears in
  `store.surfaces().entries` (e.g., a caller bug in a later batch calls it with the wrong id), and
  a `surface:read` later completes.
- Symptom: after that read, the expectation is silently deleted
  (`apps-surface-sync.ts:251-261`, `afterRead` branch) with no warning logged, even though the
  entry was never real for this routing id.
- Evidence: `apps-surface-sync.ts:245-261`.
- Current handling: by design ("an expectation for a surface the host no longer holds can never be
  met and is dropped too") — correct for the documented case (deleted/evicted surface), but the
  same code path also silently absorbs a caller passing a bad surface id, with no diagnostic.
- Recommendation: Moderate, non-blocking — a `console.warn` when an expectation is dropped for a
  surface id that was never observed at all (vs. one that existed and was deleted) would help
  debug a Batch 13 integration mistake. Not required by the plan.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: no automatic preservation/retry of the user's typed prompt on a failed `start()` or an
  unresolved-session `send()` (`apps-session.service.ts:227-243, 441-453`). Not a plan violation
  (plan requires "full rollback"), but a real UX gap worth flagging to Batch 15.
- Moderate: the grace timer is not restarted on a later `expectRevision` call for an
  already-armed surface (`apps-surface-sync.ts:140-159`); harmless but under-specified by the
  plan's "re-armed rather than multiplied" wording, and under-tested (both grace specs call
  `expectRevision` twice at the same fake-timer instant, so the time-gapped case is never
  exercised).
- Minor: `reconcileExpected`'s `afterRead` branch drops an expectation for a surface id that was
  never observed at all with no diagnostic, conflating "surface deleted" with "caller passed a bad
  id" (`apps-surface-sync.ts:251-261`).

## Data flow

1. `AppsSessionService.start(prompt)` reads `workspaceKey()` (pinned from
   `tabManager.activeWorkspacePath$()`), bails if the slice already has a conversation — OK.
2. `claimConversation` mints `routingId`/`surfaceId`, constructs `AppsSurfaceSync`, writes the
   slice via `startAppsSlice` (conversation + sync + bubble) **before** claiming anything — OK,
   documented rationale ("the slice holds the conversation before the claim, so the first push
   already finds the slice it writes to").
3. `inbox.claim(routingId, raw => sync.onPush(raw))` runs, then `workflowClaims.claim`, then
   `surfaceRegistry.register(..., {interactive:true})`, then `streamRouter.onSurfaceCreated` — all
   synchronous, all before the `await rpc.call('chat:start', …)` — OK, matches the ordering
   requirement (Deviation-adjacent check, see "Also explicitly check").
4. `chat:start` is awaited. On RPC-level rejection or `{success:false}`/`{data.success:false}`,
   `rollBackFailedStart` tears down every claim made in step 3 (via `releaseConversation`, each
   step individually try/caught) and replaces the slice with a fresh empty one plus the error text
   — OK, but destroys the transcript bubble (see Failure modes).
5. A `surface:updated` push arrives through the inbox's claimed listener → `sync.onPush(raw)` →
   `isOwnPush` gate (routingId match) → `applySurfacePush` (pure reducer, Batch 11 scope) → if
   `needsRead`, `requestRead('needs-read')` — OK, single read in flight, coalesced.
6. `requestRead` → `runRead`: captures `readSeq` at send time, calls `surface:read` with a 10s
   timeout and an `AbortController` signal, applies the result through `applySurfaceRead`, updates
   `syncNotice`, then reconciles `expected` and fires any coalesced follow-up — OK, matches Rule 2
   (only a read/push can move `materializedRevision`; `runRead` never sets it directly, it goes
   through the reducer).
7. `expectSurfaceRevision` (exposed for Batch 13) → `AppsSurfaceSync.expectRevision`: raises
   `expected`, arms the grace timer if not already armed — never touches
   `materializedRevision` — OK (Rule 1 preserved).
8. `discard()` / workspace removal → `teardown` → `releaseConversation` (inbox/claims/stream
   router/sync all released, each step isolated) → slice replaced/removed — OK, confirmed by spec
   (`registry.getAdapter` null, `inbox.isClaimed` false, `jest.getTimerCount()` 0 in the sync spec
   equivalent).

No step was found where a value is lost, duplicated, or read stale without the code already
accounting for it (the `readSeq` mechanism specifically defends against stale reads undoing a
newer push, and the `patchOwned` ownership check specifically defends against a stale async result
writing into a slice that has since been discarded or restarted).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `inbox.claim` before `chat:start` (plan :401-403) | COMPLETE | none |
| Rollback releases inbox, claims, surface, sync (plan :401-403) | COMPLETE | transcript bubble is also discarded (see Moderate note) |
| `discard()` releases inbox, claims, surface, sync (plan :401-403) | COMPLETE | none |
| One read in flight per slice, coalescing (plan :455-456) | COMPLETE | none |
| 10s read timeout (plan :456) | COMPLETE | none |
| One grace timer per slice, 1,500ms, cleared on catch-up/dispose (plan :461-464) | COMPLETE | timer is not restarted on a later ack while already armed (harmless; see Moderate note) |
| Rule 1: only push/read advance materialized revision (plan :571, :549) | COMPLETE | none |
| Rule 4 hook (`updateOverlays`) never touches materialized revision (plan :574-582) | COMPLETE | none |
| No `TabManagerService` mutation (Req 2.1) | COMPLETE | none |
| Workspace switch shows the other slice; state survives destroy/re-create (Req 2.4, 2.6) | COMPLETE | none |
| Push for another routing id never reaches the slice (Req 3.3) | COMPLETE | none |
| Each file ≤ 700 lines | COMPLETE | `apps-workspace-slice.ts` 163, `apps-surface-sync.ts` 269, `apps-session.service.ts` 559 |

Implicit requirements not addressed: preserving a user's typed draft across a failed `start()` or
an unresolved-session `send()` (not stated in the plan; flagged for Batch 15's UI layer).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Concurrent read triggers while one read is in flight | YES | `followUp` flag, one coalesced follow-up (`apps-surface-sync.ts:122-133, 235`) | none |
| Read result arrives after `dispose()` | YES | `inFlight !== controller` / `disposed` guard drops it (`apps-surface-sync.ts:203, 220`) | none |
| Push for another routing id | YES | `isOwnPush` gate + inbox claim scoping | none |
| Push/RPC result landing after `discard()`/restart | YES | `patchOwned` ownership check via `isAppsSliceOf` | none |
| Workspace removed mid-conversation | YES | `removedWorkspace$` effect → `dropSlice` → full teardown | none |
| `start()` called twice concurrently on the same slice | PARTIAL | guarded by `conversation !== null` check at entry, but two concurrent calls before either sets `conversation` on the slice would both proceed (`start()` at :175-176 reads `_slices()` synchronously before any `await`, and `claimConversation` also runs synchronously before the first `await`, so the second concurrent call's synchronous prefix runs after the slice already has a conversation set by the first — in practice not reachable from a single-threaded synchronous prefix) | none in practice; not spec-pinned as a race test |
| Grace timer re-armed vs restarted on repeated ack | YES (as coded) | see Deviation ruling 1 | spec does not exercise the time-gapped case |
| Failed `start()` mid-await, then `discard()` races it | YES | `rollBackFailedStart` checks `isAppsSliceOf` before acting, so a `discard()` that already replaced the slice is not overwritten | none |

## Deviation rulings

### 1. The grace deadline is not restarted on a repeated ack

- Ruling: **ACCEPT**
- Evidence: `apps-surface-sync.ts:140-159` — `expectRevision` only calls `setTimeout` when
  `this.graceTimer === null`; a later ack for the same or another surface while the timer is
  already armed updates `expected` but leaves the existing timer's deadline untouched.
- Reasoning: the plan's own wording is "one timer per slice, **re-armed rather than multiplied**"
  (implementation-plan.md:463) — the operative concern is avoiding a second/third timer per
  surface, which the code satisfies (`graceTimer` is a single nullable field, never multiplied).
  Not restarting the deadline only makes the eventual `surface:read` fire *earlier* than a
  best-effort "1,500ms after the latest ack" would, which is harmless: a `surface:read` is
  idempotent, Rule 2 still gates what it may write, and `reconcileExpected` clears stale
  expectations either way. No blocking or serious defect. Flagged as a Moderate spec-coverage gap
  only (see Moderate issues).

### 2. After a read, the sync drops expected revisions for surfaces the host no longer holds

- Ruling: **ACCEPT**
- Evidence: `apps-surface-sync.ts:245-261`, `reconcileExpected(afterRead)` — when
  `entries.get(surfaceId) === undefined` and `afterRead` is true, the expectation is deleted; the
  method's own doc comment (`:245-250`) states this is intentional.
- Reasoning: a `surface:read` result is the host's authoritative complete state
  (implementation-plan.md:448-453). If a surface is absent from `entries` immediately after a
  successful read was applied, the reducer has already concluded the host does not hold it (either
  removed via `not-found`/absence-with-no-newer-push, or never existed). Keeping the expectation
  alive would arm the grace timer forever for a revision that can never be echoed, causing a
  runaway retry loop. Dropping it is correct and matches Rule 3's purpose (recover from a missed
  echo, not chase a surface that is gone). See the related Failure mode note about the missing
  diagnostic for a genuinely-bad caller id, which is a separate Moderate/Minor observation, not a
  reason to reject this behaviour.

### 3. `dispose()` aborts the in-flight read

- Ruling: **ACCEPT**
- Evidence: `apps-surface-sync.ts:170-178` — `dispose()` captures `this.inFlight`, nulls the field,
  then calls `inFlight?.abort()`. `apps-surface-sync.spec.ts:447-478` proves both the
  `AbortSignal` fires and `jest.getTimerCount()` reaches 0 (the mocked RPC clears its own internal
  timeout on abort).
- Reasoning: the plan requires "no timer after dispose()" and the class's own contract states
  "every read has ... an abort path (dispose())" (`apps-surface-sync.ts:20-24`, restating
  implementation-plan.md's Component 4 intent at :454-464). Aborting is not merely permitted, it is
  necessary to release the underlying RPC's own timeout timer promptly rather than waiting up to
  10s for it to expire on its own — without the abort, `jest.getTimerCount()` would not reach 0
  immediately after `dispose()`, which the "no timers survive after dispose()" requirement in
  batches.md explicitly calls for. The `disposed`/`inFlight !== controller` guards in `runRead`
  already made the abort's result harmless even before the explicit `abort()` call, so this is a
  correctness improvement, not a source of a new failure mode.

### 4. Hooks exposed for Batch 13 — do `requestSurfaceRead`, `expectSurfaceRevision`,
   `updateOverlays` let a future caller violate Rule 1?

- Ruling: **ACCEPT** (no violation possible through these three entry points as written)
- Evidence and trace:
  - `requestSurfaceRead(routingId, reason)` → `AppsSurfaceSync.requestRead` → `runRead` →
    `applySurfaceRead` (the pure reducer) is the **only** call in this chain that can write
    `materializedRevision`, and it only does so from an actual `surface:read` RPC result
    (`apps-surface-sync.ts:122-133, 189-236`; `apps-session.service.ts:345-350`). A Batch 13 caller
    cannot inject an arbitrary revision through this hook — it can only ask for a real read.
  - `expectSurfaceRevision(routingId, surfaceId, revision)` → `AppsSurfaceSync.expectRevision`
    only writes `this.expected` (a private `Map`) and arms the grace timer; it never calls
    `store.setSurfaces` (`apps-surface-sync.ts:140-159`). There is no code path from this method to
    the reducer at all.
  - `updateOverlays(routingId, surfaceId, update)` → `updateSurfaceOverlays` (reducer,
    `apps-surface-reducer.ts:455-469`) only replaces the `overlays` field of the matching entry via
    `{ ...existing, overlays }`; `materializedRevision` is untouched, and the function's own
    `retireSettledUpTo(existing.materializedRevision)` call reads the revision but never assigns
    it.
  - Conclusion: a Batch 13 `AppsSurfaceOperations`/`AppsSubmitFlow` built strictly on these three
    methods has no way to materialize an ack without a real revision bump — the only writer of
    `materializedRevision` in the whole reachable call graph from these hooks is
    `applySurfaceRead`/`applySurfacePush`, both of which require an actual RPC result or push.
    (Batch 13 will add `AppsSurfaceOperations` itself, which is out of this batch's scope to audit
    further, but the *surface* these three hooks present is sound.)

### 5. `chat:start` uses the slice's workspace path rather than `vscode.config().workspaceRoot`

- Ruling: **ACCEPT**
- Evidence and trace:
  - `AppsSessionService.workspaceKey` is `computed(() =>
    appsSliceKey(this.tabManager.activeWorkspacePath$()))` (`apps-session.service.ts:112-114`),
    fed by `TabManagerService.activeWorkspacePath$`, which forwards
    `TabWorkspacePartitionService.activeWorkspacePath$`
    (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:734`,
    `tab-workspace-partition.service.ts:82-96`). This is a live signal set by
    `TabWorkspacePartitionService` as the shell's active workspace changes (Electron multi-window
    shell), not `VSCodeService.config().workspaceRoot` (a static per-webview config value).
  - `appsWorkspacePath(key)` returns `null` for the `APPS_IMPLICIT_WORKSPACE` sentinel (no known
    workspace path yet) and the raw key otherwise (`apps-workspace-slice.ts:85-87`); `start()`
    omits `workspacePath` from the `chat:start` params entirely when `null`
    (`apps-session.service.ts:187-189`), mirroring the harness's own `...(workspacePath ? {
    workspacePath } : {})` pattern (`harness-workflow.service.ts:309`) for the omission behaviour.
  - Host reach: the `apps` route only loads (`canMatch: [electronOnlySurface]`,
    implementation-plan.md D2) in Electron, where `TabWorkspacePartitionService` is the
    multi-workspace source of truth the Electron shell already switches on
    (`tribunal-state.service.ts:144-168` is the explicitly cited precedent, D1). The VS Code
    webview never mounts `AppsSessionService` (lazy import gated by the route), so the
    "does the null/default sentinel land correctly in the VS Code host" branch of the question is
    moot for this component: VS Code never reaches it.
  - `APPS_IMPLICIT_WORKSPACE`: used only when `activeWorkspacePath$()` is `null` — i.e. before
    `TabWorkspacePartitionService.initialize()` has set an active path, or if a host exposes no
    workspace at all. Since the Apps tab itself is only rendered when
    `hasWorkspaceFolders()` is true (Batch 17, not yet built) and `TabManagerService` is a root
    singleton initialized during app bootstrap (`tab-manager.service.ts:578`, called from
    `app.config.ts`/app init, well before any route can be navigated to), the sentinel key is
    reachable in practice only in the brief bootstrap window before any workspace signal
    propagates, or in a genuinely workspace-less Electron window. In either case `start()` still
    works correctly — it just omits `workspacePath`, exactly as harness does for the same
    condition.
  - This diverges from the harness's `vscode.config().workspaceRoot` intentionally and per the
    plan: D1 explicitly chose the Tribunal-style per-workspace partition over the harness's
    single-pinned-root pattern, because Apps (unlike a one-shot harness workflow) must show a
    different conversation per active workspace (Req 2.6). Using `vscode.config().workspaceRoot`
    here would have broken workspace-switch isolation, which the spec explicitly pins
    (`apps-session.service.spec.ts:443-462`).

### 6. `send()` before the session/conversation resolves shows an error — correct, or should it queue/no-op?

- Ruling: **ACCEPT**
- Evidence: `apps-session.service.ts:235-243`; pinned by
  `apps-session.service.spec.ts:595-603` ("send() before the session resolves reports an error
  and sends nothing").
- Reasoning: the closest precedent, `HarnessWorkflowService.sendMessage`
  (`harness-workflow.service.ts:359-368`), silently drops the message with only a
  `console.warn` and no user-facing error when `sessionId` has not resolved. Apps's choice to
  surface a visible, dismissable error (`error()` + `clearError()`) is strictly more transparent
  than the harness's silent drop and is not itself a defect — a user who sees "still starting, try
  again" is better served than one whose message vanishes with zero feedback. Neither
  implementation queues the message for automatic resend; that is a UX choice the plan does not
  mandate (implementation-plan.md's failure-behaviour section for Component 4, :470-476, specifies
  only "`chat:continue` failure: error signal only" — it does not distinguish "session not yet
  resolved" as a case needing a queue). Recorded as a Moderate UX gap (no auto-retry, no draft
  preservation) but not a logic defect against the written contract; queuing would be a reasonable
  enhancement, not a required fix.

### 7. A failed `start()` resets the whole slice, including `userBubbles`

- Ruling: **ACCEPT**
- Evidence: `apps-session.service.ts:441-453` (`rollBackFailedStart` calls
  `this.patch(key, () => ({ ...createAppsWorkspaceSlice(), error: message }))`, which replaces
  every field including `userBubbles`); the bubble was written by `startAppsSlice` at
  `apps-workspace-slice.ts:150-161` before the failed RPC.
- Reasoning: implementation-plan.md:471 states the failure behaviour for `chat:start` in exactly
  two words: "full rollback" — not "rollback the claims but keep the transcript". "Full" is not
  qualified anywhere in the plan to exclude the UI-visible draft/bubble state, and the harness
  precedent (`rollBackFailedStart`, `harness-workflow.service.ts:341-357`) does the equivalent
  full reset of its own started/mode/workspaceRoot state on the same failure. Given the explicit
  "full rollback" wording and the precedent's matching behaviour, the literal reading is that
  the whole slice — including the bubble the user typed — is meant to be undone, on the theory
  that a conversation that never actually started should leave no visible trace of having
  started. This is a legitimate UX trade-off (recommend: Batch 15's composer should keep the
  typed text in the input field, since the *service* clearing its own bubble list does not
  preclude the UI-level draft text surviving in the composer's own local state) but not a
  deviation from the written rollback contract. Ruled ACCEPT against the plan text as written;
  flagged as a UX recommendation, not a fix requirement, for Batch 15.

### 8. `apps-session.service.spec.ts` uses a fake/stub `StreamRouter` but the real registry, inbox, and claims machinery

- Ruling: **ACCEPT** — acceptable test boundary; does not hide integration risk relevant to this
  batch's logic.
- Evidence: `apps-session.service.spec.ts:217-229` provides `StreamRouter` via a factory that
  injects the **real** `StreamingSurfaceRegistry` and wires `onSurfaceClosed` to call
  `surfaces.unregister(id)`, with an explicit comment: "Mirrors stream-router.service.ts:271-283:
  closing a surface unregisters its adapter." `onSurfaceCreated` is a bare spy (no real side
  effect needed for anything this batch asserts).
- Reasoning: the logic under test in this batch is session lifecycle ordering (claim-before-start,
  full rollback, discard, workspace partitioning, push routing) — every assertion that depends on
  `StreamRouter`'s real behaviour (unregistering the adapter on close) is faithfully reproduced by
  the stub, and every assertion about `StreamRouter` itself (`onSurfaceCreated` called with the
  right surface id, `onSurfaceClosed` called on rollback/discard) is a direct call-site check, not
  a behaviour the stub needs to fake. `StreamRouter`'s own internal logic (wiring `chat:*` stream
  events to a surface) is genuinely out of scope for this batch and is exercised by
  `chat-routing`'s own suite (Batch 1) and will be exercised end-to-end once Batch 13's operations
  service and Batch 15's page component exist. Using the real `SurfaceUpdateInbox`,
  `StreamingSurfaceRegistry`, and `WorkflowSessionClaimService` is exactly right, because those
  are the collaborators whose *ordering and release* this batch's contract is about
  (implementation-plan.md :401-403). No integration risk is hidden by this boundary that this
  batch is responsible for covering.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking or serious found; the residual risk is UX-level (a user's typed prompt
  is lost, with only an error message as evidence, on a failed `start()` or an unresolved-session
  `send()`) and belongs to Batch 15's composer design, not this batch's service logic.
- What a robust implementation would add: (1) a spec that exercises `expectRevision` with a real
  time gap between two acks on the same surface, to make the "re-armed rather than multiplied"
  behaviour an explicit, intentional pin rather than an artifact of same-tick test calls; (2) a
  diagnostic `console.warn` when `reconcileExpected` drops an expectation for a surface id that was
  never observed (as opposed to one that existed and was removed), to make a future caller's bug
  visible in logs; (3) for Batch 15, a composer that preserves the typed draft across a failed
  `start()`/unresolved-session `send()` rather than relying on the user to notice the error and
  re-type.
