# Code Logic Review: Batch 13 — UI Mutations and Submit Flow

**Reviewer**: Antigravity (Independent Code-Logic Reviewer)  
**Date**: 2026-09-25  
**Worktree**: `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772`  
**Task Folder**: `.ptah/specs/TASK_2026_494_ca38`  
**Files Under Review**:
- `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.ts`
- `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.spec.ts`
- `libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.ts`
- `libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.spec.ts`
- `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts`

---

## 1. Executive Summary & Verdict

- **Score**: 8 / 10
- **Verdict**: **NEEDS_REVISION**

Batch 13 implements the UI mutation and submit pipeline for the MCP Apps Page, spanning `surface:change`, `surface:select`, `surface:action`, and `surface:operation` (polling). The implementation is modular, typed cleanly, adheres strictly to Angular 22 OnPush/signals standards, and introduces zero `chat:*` calls. All 199 library unit tests pass.

However, the review identified a critical concurrency defect in Deviation 4 (`apps-surface-lanes.ts:375-385`), where an un-echoed queued mutation is forcefully dispatched on a held base after 11.5 s. This directly causes a self-inflicted `stale-revision` rejection on the host, violating the core serialization guarantee of `implementation-plan.md:535-537`. Additionally, mutation serialization between `AppsSubmitFlow` and `AppsSurfaceLanes` is asymmetric: while submit waits for changes to drain, changes are not blocked while a submit is in flight, allowing concurrent mutations on the same surface.

---

## 2. Per-Deviation Rulings

### Deviation 1: 5th File `apps-surface-lanes.ts` has no dedicated spec
- **Ruling**: **ACCEPT**
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts:200-570`
- **Rationale**: Combining `AppsSurfaceLanes` into `apps-surface-operations.service.ts` exceeded the 700-line ceiling (917 lines). Extracting it adheres to the SOLID Facade Pattern (`Coding Standards`). `apps-surface-lanes.ts` is fully exercised end-to-end through `apps-surface-operations.service.spec.ts:260-680` using the real reducer, inbox, and mocked RPC. All queueing, coalescing, echo waiting, retry, and settlement pathways are covered across 17 spec cases. A separate mock-heavy unit spec would duplicate test assertions without added behavioral confidence.

### Deviation 2: `submittedBubbles` exposed as a Signal on `AppsSurfaceOperations` rather than written to `AppsWorkspaceSlice`
- **Ruling**: **ACCEPT**
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.ts:101-109`, `apps-submit-flow.ts:569`
- **Rationale**: `batches.md:589-590` explicitly forbade Batch 13 from modifying `apps-workspace-slice.ts` and `apps-session.service.ts` because Batch 14 was executing concurrently on those files. Exposing `submittedBubbles: Signal<readonly AppsUserBubble[]>` allows `AppsPageComponent` in Batch 15 to merge submitted bubbles into the transcript by timestamp without breaking the parallel batch constraint.

### Deviation 3: Cleanup on discard is detected via effect rather than called directly
- **Ruling**: **ACCEPT** (Temporary Decouple for B13), with **Required Action for B14/B15**
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.ts:94, 252-256`
- **Rationale**: B13 could not wire `release(routingId)` directly into `AppsSessionService.discard()` or `dropSlice()` because `apps-session.service.ts` was locked by B14. The effect detects routing ID transitions for the active workspace. However, if a non-active workspace is removed (`removedWorkspace$`), its `RoutingRecord` remains in memory until service destruction. The call should live in `AppsSessionService.discard()` and `dropSlice()` (tracked in Fix List below).

### Deviation 4: Un-echoed mutation sends after 11.5 s; submit wait times out after 30 s
- **Ruling**:
  - **Submit 30 s sync timeout (`APPS_SUBMIT_SYNC_LIMIT_MS`)**: **ACCEPT**. Defensively prevents submit from stalling indefinitely if the surface fails to settle (`apps-submit-flow.ts:387-391`).
  - **Queued mutation send after 11.5 s on held base (`APPS_ECHO_WAIT_LIMIT_MS`)**: **REJECT**.
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts:375-385`
- **Detailed Finding (Self-Inflicted Stale Revision)**:
  `apps-surface-lanes.ts:380-382`:
  ```ts
  console.warn(`${WARN_PREFIX} echo not seen; sending on the held base`);
  lane.expected = null;
  this.pump(lane);
  ```
  **Can the 11.5 s send cause a self-inflicted stale revision? YES.**
  Suppose Mutation A commits on the host, advancing stored revision from 1 to 2. The host replies with `applied(2)`. Rule 1 sets `expectedRevision = 2`, while `materializedRevision` remains 1. The user then queues Mutation B (to the same input or another input). If the echo ops or grace read is delayed past 11.5 s, `armWait` clears `lane.expected` and calls `pump(lane)`. Mutation B is dispatched with `revision: 1`.
  On the host, `checkSurfaceConflict` (`libs/shared/src/mcp-apps-contracts/surface-concurrency.ts:186-193`) checks `entry.revision (2) > base (1)`. Because Mutation A wrote to the surface at revision 2, Mutation B conflicts and is rejected with `stale-revision`.
  Because Mutation B was a change, `settleChange` (`lanes.ts:492-508`) retires the overlay without resending and marks the input with "This field changed while you were editing. Your value was not saved." The user's edit is lost due to a client-side premature send on a base known to be older than the host's acked revision.
  This violates `implementation-plan.md:535-537`:
  > *"Consequence: own writes never conflict with each other. That removes the only self-inflicted stale-revision (two quick changes to one path, surface-concurrency.ts:186-193)."*
  Rather than sending on the stale held base, the lane must re-request a read (`this.host.requestRead()`) or, after a read timeout/failure, mark the mutation unconfirmed/failed without dispatching with a corrupt base.

### Deviation 5: Optional N5 spec skipped
- **Ruling**: **ACCEPT**
- **Evidence**: `batches.md:541-542`
- **Rationale**: B12 carry-forward note N5 stated: *"add one spec covering start -> real onSurfaceCreated -> sessionFor resolving, if B13 touches that path."* Batch 13 did not touch that path or edit `apps-session.service.ts`.

---

## 3. Detailed Area Reviews

### 3.1 Revisions and Overlays
- **Can an RPC ack ever become the materialized revision?**
  **No. Rule 1 is strictly enforced.**
  In `apps-surface-lanes.ts:480-484` and `:520-523`, `applied` acks only call `overlays.settle(opId, revision)` and `this.expect(surfaceId, revision)`. In `apps-submit-flow.ts:566-567`, submit acks only call `this.host.expectRevision(active.surfaceId, outcome.revision)`. Neither service assigns to `materializedRevision`. Only pushes and reads processed through the reducer advance `materializedRevision`.
- **Is there one in-flight mutation per surface, with base = materialized?**
  Within `AppsSurfaceLanes`, `lane.inFlight !== null` enforces single in-flight mutation for `change` and `select`, and `base` is read from `entry.materializedRevision` at the moment of send (`lanes.ts:361`).
  *However*, `AppsSurfaceLanes` does not track whether `AppsSubmitFlow` has a submit in flight on that surface (see Defect 2 below).
- **When a queued change is coalesced, is the replaced overlay retired?**
  **Yes.** In `apps-surface-lanes.ts:230-244`:
  ```ts
  const queued = lane.queue.findIndex(...);
  const replaced = queued >= 0 ? lane.queue[queued].operationId : null;
  ...
  this.host.updateOverlays(surfaceId, (overlays) =>
    (replaced === null ? overlays : overlays.retire(replaced)).add(...)
  );
  ```
  The replaced overlay is retired unsent, and the new overlay is added. Pinned by `apps-surface-operations.service.spec.ts:377`.

### 3.2 Result Handling
- **Are all result branches handled as plan lines 548-575 specify?**
  **Yes.**
  - `applied`: settles overlay/selection, raises expected revision (`lanes.ts:478-485, 518-524`).
  - `stale-revision`: on select, re-sends once with new ID and new base (`lanes.ts:534-554`); on change, overlay is retired, read requested, input notice shown (`lanes.ts:486-508`).
  - `invalid-value`, `undeclared`, `budget`, `too-many-operations`, `operation-expired`, `operation-conflict`: overlay retired, detail notice shown without retry (`lanes.ts:486-508, 555-569`).
  - `not-found`: overlay retired, read requested (`lanes.ts:494-500, 528-533`).
  - `pending`: treated as transport failure (`lanes.ts:418-420`).
- **Is a transport failure told apart from a host refusal by `errorCode`?**
  **Yes.** In `apps-surface-lanes.ts:421-430` and `apps-submit-flow.ts:469-478`, `result.errorCode !== undefined` branches to host refusal (retires overlay/fails action, shows detail, no `surface:operation` check, no polling). A missing `errorCode` (e.g., RPC timeout) branches to transport failure handling (`checkOperation` or polling).
- **Is `surface:operation` called exactly once, with no resend?**
  **Yes.** `checkOperation` in `apps-surface-lanes.ts:444-470` calls `surface:operation` exactly once. Unresolved responses retire the overlay and trigger a read. Mutations are never resent.
- **Does a stale-revision select re-send once with a new ID?**
  **Yes.** `apps-surface-lanes.ts:534-554` checks `!op.retried`. It mints a new ID with `createSurfaceOperationId()`, sets `retried: true`, patches the override ID, and pushes to queue. A second `stale-revision` marks the selection unsynced with notice (`lanes.ts:563-568`).

### 3.3 Submit and Polling
- **Does submit wait for the queue and echo, requesting its own read?**
  **Yes.** In `apps-submit-flow.ts:365-374`, submit verifies `syncState === 'settled'`. If `behind`, `onWaitTick` (`flow.ts:377-396`) fires every 1,500 ms (`APPS_ECHO_GRACE_MS`) and issues `this.host.requestRead()`, directly resolving Carry-forward B12 N1.
- **Are polling parameters exact?**
  **Yes.**
  - Action timeout: 30 s (`APPS_SUBMIT_TIMEOUT_MS = 30_000`, `flow.ts:39`).
  - Poll interval: 3 s (`APPS_SUBMIT_POLL_INTERVAL_MS = 3_000`, `flow.ts:41`).
  - Poll timeout: 10 s per call (`APPS_SUBMIT_POLL_TIMEOUT_MS = 10_000`, `flow.ts:43`).
  - Max polling duration: 150 s (`APPS_SUBMIT_POLL_LIMIT_MS = 150_000`, `flow.ts:45`).
  - Consecutive failures limit: 3 (`APPS_SUBMIT_POLL_MAX_FAILURES = 3`, `flow.ts:47`), settling as `unknown`.
  Pinned by `apps-submit-flow.spec.ts:348, 381, 402`.

### 3.4 Lifecycle and Security
- **Are there timers or queues after `dispose()` or `discard()`?**
  **No.** `dispose()` on both `AppsSurfaceLanes` and `AppsSubmitFlow` clears all timers (`clearWait`, `clearTimer`) and calls `this.controller.abort()` (`lanes.ts:315-319`, `flow.ts:341-346`). Discard releases the routing record. Specs assert `jest.getTimerCount() === 0` (`apps-surface-operations.service.spec.ts:653`, `apps-submit-flow.spec.ts:430`).
- **Can a stale queue send for a discarded or removed conversation?**
  **No.** `controller.signal.aborted` stops pump immediately (`lanes.ts:338`). `entryFor` checks `session.routingId() === routingId` (`apps-surface-operations.service.ts:319`). If the conversation is no longer active, `isShown()` is false and nothing sends (`lanes.ts:347`).
- **Are there any `chat:*` calls?**
  **Zero.** Neither service nor lane invokes `chat:start` or `chat:continue`. Pinned by `apps-surface-operations.service.spec.ts:623` and `apps-submit-flow.spec.ts:528`.
- **Do logs include payload values?**
  **No.** All `console.warn` statements strictly log method/step names, `errorCode`, `reason`, or `errorName(error)`. Pinned by `apps-surface-operations.service.spec.ts:608`.

---

## 4. Verification of Reconciliation Cases 1–6

The specs in `apps-surface-operations.service.spec.ts:260-366` pin Cases 1–6 for real against the integrated system:

| Case | Scenario | Spec Location | Verdict |
| :--- | :--- | :--- | :--- |
| **Case 1** | Result before echo: ack never materialized; overlay settles, retires at echo | `spec.ts:261-288` | **REAL PIN** |
| **Case 2** | Echo before result: echo applies rev; result only settles without read/re-apply | `spec.ts:290-301` | **REAL PIN** |
| **Case 3** | Gap from lost agent push between base & commit: read replaces view | `spec.ts:303-313` | **REAL PIN** |
| **Case 4** | Newer push arrives before older result/read: materialized revision preserved | `spec.ts:315-325` | **REAL PIN** |
| **Case 5** | Lost echo: exactly one `surface:read` after 1,500 ms recovers view | `spec.ts:327-342` | **REAL PIN** |
| **Case 6** | Older op settles while newer edit to same input is pending: overlay preserved | `spec.ts:344-366` | **REAL PIN** |

---

## 5. Behavioural Defects Found

### Defect 1 (Major): Premature dispatch on held base after 11.5 s causes self-inflicted `stale-revision`
- **Location**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts:375-385`
- **Problem**: When `lane.waitTimer` expires at 11.5 s, `lane.expected` is cleared and `pump` sends the queued mutation on `base = entry.materializedRevision`. Because the host already committed the previous operation (producing `revision = expected > materializedRevision`), the host will reject the mutation with `stale-revision` if the write footprints overlap. The mutation is then permanently dropped without resending.
- **Fix**: Replace the forced dispatch with a read request (`this.host.requestRead()`). If the read fails or times out, the queued mutation should fail gracefully as `unconfirmed`, rather than sending on a known-stale base.

### Defect 2 (Medium): Asymmetric in-flight mutation serialization between `AppsSubmitFlow` and `AppsSurfaceLanes`
- **Location**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.ts:162-189`, `apps-surface-lanes.ts:336-342`
- **Problem**: `AppsSubmitFlow.advance()` waits for `lanes.syncState() === 'settled'`, preventing submit while changes are draining. However, `AppsSurfaceLanes.pump()` does NOT check whether `AppsSubmitFlow` is actively sending or polling a submit. If a user commits an input change while `surface:action` is in flight (which can take up to 30 s), `surface:change` is dispatched concurrently. If `surface:change` commits first, the host increments stored revision, causing the in-flight `surface:action` to be rejected with `stale-revision`.
- **Fix**: Expose `flow.isSubmitting(surfaceId)` (or `isPendingAction`) to `AppsLaneHost`. In `AppsSurfaceLanes.pump()`, defer sending and wait while an action is in flight on that surface.

### Defect 3 (Minor): Inactive workspace removal leaves routing record in `AppsSurfaceOperations`
- **Location**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.ts:94, 252-256`
- **Problem**: `reconcile` only tracks routing ID transitions for the active workspace (`this.session.workspaceKey()`). If an inactive workspace slice is closed, `release(routingId)` is never called for it until `AppsSurfaceOperations` is destroyed.
- **Fix**: When B14/B15 touches `AppsSessionService`, wire `operations.release(routingId)` into `AppsSessionService.discard()` and `dropSlice()`.

---

## 6. Exact Fix List

1. **Fix 11.5 s lane timeout in `apps-surface-lanes.ts`**:
   - In `apps-surface-lanes.ts:375-385` (`armWait`):
     - Remove `lane.expected = null;` and `this.pump(lane);`.
     - When the timer fires and `lane.expected > entry.materializedRevision`, invoke `this.host.requestRead()`.
     - If the read does not resolve within a secondary safety window, fail the queued mutation with `APPS_CHANGE_TEXT.unconfirmed` and retire its overlay, instead of dispatching with a corrupt base revision.
2. **Prevent concurrent `change`/`select` while submit is in flight**:
   - In `apps-surface-lanes.ts` (`AppsLaneHost`), add `isSubmitting(surfaceId: string): boolean`.
   - In `apps-surface-operations.service.ts:341-367` (`laneHost`), implement `isSubmitting: (surfaceId) => this.records.get(routingId)?.flow.isActive ?? false`.
   - In `apps-surface-lanes.ts:336-342` (`pump`), check `if (this.host.isSubmitting(lane.surfaceId)) return;`.
   - In `apps-submit-flow.ts:610-616` (`finish`), call `this.host.syncState(...)` / notify lanes so waiting changes pump immediately upon submit settlement.
3. **Wire explicit cleanup in `AppsSessionService` (Batch 14/15 carry-forward)**:
   - In `apps-session.service.ts`, inject `AppsSurfaceOperations` and call `this.operations.release(routingId)` inside `discard()` and `dropSlice()`.
