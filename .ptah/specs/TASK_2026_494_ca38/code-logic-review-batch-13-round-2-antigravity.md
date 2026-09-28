# Code Logic Review — `TASK_2026_494` (Batch 13, Round 2)

## Summary

| Metric              | Value      |
| ------------------- | ---------- |
| Overall score       | 9/10       |
| Assessment          | APPROVED   |
| Blocking issues     | 0          |
| Serious issues      | 0          |
| Moderate issues     | 0          |
| Failure modes found | 0          |

Scope reviewed in full:
- `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts` (664 lines)
- `libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.ts` (659 lines)
- `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.ts` (449 lines)
- `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts` (lines 140–175, `ownedRoutingIds`)
- `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.spec.ts` (440 lines, new)
- `libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.spec.ts` (new describe blocks, lines 563–638)
- `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.spec.ts` (700 lines)
- `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts` (lines 655–676)

Verification executed:
- `npx jest -c libs/frontend/mcp-apps-page/jest.config.ts`: 11 test suites, 211 tests, all passed.
- `npx nx run @ptah-extension/mcp-apps-page:typecheck`: exit code 0, clean.
- `npx nx run @ptah-extension/mcp-apps-page:lint`: exit code 0, clean.
- Zero `chat:*` invocations present repo-wide in Batch 13 code.
- File ceiling compliance: all source files remain below 700 lines.

---

## Prior Findings Rulings (Round 1)

| Finding ID | Source Review | Severity | Description | Ruling | File:Line Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Defect 1** | Antigravity R1 | Major / Serious | Premature dispatch on held base after 11.5 s causes self-inflicted `stale-revision` | **RESOLVED** | `apps-surface-lanes.ts:377-380, 401-444, 451-477`. On wait timeout (`APPS_ECHO_WAIT_LIMIT_MS` = 21.5 s), `dropQueue` drops queued mutations unsent, retires overlays, and shows `APPS_CHANGE_TEXT.notSynced`. Base is never dispatched below acknowledged revision. Pinned in `apps-surface-lanes.spec.ts:295-327`. |
| **Defect 2** | Antigravity R1 | Medium | Asymmetric in-flight mutation serialization between `AppsSubmitFlow` and `AppsSurfaceLanes` | **RESOLVED** | `apps-surface-lanes.ts:364-367`, `apps-submit-flow.ts:302-308, 635`, `apps-surface-operations.service.ts:379-380, 413`. `AppsLaneHost.isSubmitting` blocks lane sends during `sending` and `polling` phases; `submitEnded()` triggers `lanes.pumpAll()`. Pinned in `apps-submit-flow.spec.ts:563-609`. |
| **Defect 3** | Antigravity R1 | Minor / Moderate | Inactive workspace removal leaves routing record in `AppsSurfaceOperations` | **RESOLVED** | `apps-session.service.ts:154-166`, `apps-surface-operations.service.ts:124-130, 258-275`. `ownedRoutingIds` computed tracks active and inactive conversation routing IDs. Removed/discarded conversations trigger `release(id)` immediately. Pinned in `apps-submit-flow.spec.ts:611-636`. |
| **Other S1** | Reviewer 1 | Serious | Grace-read failure reopens self-inflicted stale-revision (lane did not request read) | **RESOLVED** | `apps-surface-lanes.ts:439`. While behind, every tick after the initial grace period requests its own read (`this.host.requestRead()`). Pinned in `apps-surface-lanes.spec.ts:267-293`. |
| **Other M1** | Reviewer 1 | Moderate | `apps-surface-lanes.ts` has no dedicated spec | **RESOLVED** | `apps-surface-lanes.spec.ts:1-440`. Dedicated 440-line spec covers queueing, wait ticks, grace-read recovery, timeout drop, workspace switch, surface deletion, and symmetric submit serialization. |
| **Other M2** | Reviewer 1 | Moderate | Untested workspace switch pause/resume and surface-gone lane-deletion branches | **RESOLVED** | `apps-surface-lanes.spec.ts:342-364` (workspace switch pause/resume) and `apps-surface-lanes.spec.ts:366-388` (surface gone lane deletion). |

---

## Deviations Rulings

### Deviation 1: Echo-wait limit raised to 21.5 s (`APPS_ECHO_GRACE_MS + 2 * APPS_SURFACE_READ_TIMEOUT_MS`)
- **Ruling**: **ACCEPT**
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts:55-56`
- **Rationale**: The previous 11.5 s limit (`1.5 s + 10 s`) allowed only a single read timeout to elapse before giving up, leaving no time for a follow-up recovery read. The 21.5 s limit allows the initial grace read and one follow-up read to each utilize their full 10 s timeout window without being truncated.

### Deviation 2: First wait tick skips read request in `onWaitTick`
- **Ruling**: **ACCEPT**
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts:439` (`if (waited >= 2 * APPS_ECHO_GRACE_MS) this.host.requestRead();`)
- **Rationale**: An expectation entering the lane was already accompanied by an immediate read request (or the sync's Rule 3 grace timer). Skipping the read on the first tick (`waited < 3,000 ms`) prevents issuing a duplicate concurrent read request during the active grace period.

### Deviation 3: Symmetric serialization via `AppsLaneHost.isSubmitting` and `AppsSubmitHost.submitEnded`
- **Ruling**: **ACCEPT**
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts:113, 364-367`, `apps-submit-flow.ts:302-308, 635`
- **Rationale**: During `phase === 'waiting'`, `isSubmitting` returns `false`, allowing lanes to drain without circular deadlock. When the submit transitions to `sending` and `polling`, `isSubmitting` returns `true`, holding mutations until `finish()` invokes `submitEnded()`.

### Deviation 4: `AppsSessionService.ownedRoutingIds` computed replacing `routingByKey` discard detection
- **Ruling**: **ACCEPT**
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:154-166`, `apps-surface-operations.service.ts:124-130, 258-275`
- **Rationale**: Tracks all slice conversation IDs across active and background workspaces without inverting dependencies (`AppsSessionService` does not import `AppsSurfaceOperations`). Reconciles discards and workspace removals cleanly.

---

## Five Logic Questions

### 1. How does this fail silently?
None found. In all failure paths:
- In `apps-surface-lanes.ts:451-477`, expired echo waits drop the queue, retire overlays, and visibly inform the user via `APPS_CHANGE_TEXT.notSynced` on inputs or `role="status"` notices on selections.
- In `apps-surface-lanes.ts:368-375`, a surface removed while shown cleans up its lane and overlays. A switched workspace pauses mutations and resumes cleanly when displayed again.
- In `apps-submit-flow.ts:638-647`, any caught error in submit transitions to `finish()` with either `unknown` or `notSynced` status; nothing is swallowed.

### 2. What user action produces unexpected behaviour?
None found.
- Rapid editing across multiple inputs queues and coalesces appropriately without out-of-order execution (`apps-surface-lanes.ts:247-262`).
- Submitting while editing is in flight waits for changes to settle before dispatching `surface:action` (`apps-submit-flow.ts:380-392`).
- Editing while a submit is in flight holds mutations and dispatches them only after the submit completes on the new materialized base (`apps-surface-lanes.ts:364-367`, `apps-submit-flow.spec.ts:564-591`).
- Switching workspace tabs pauses queues without timer leaks and resumes on tab reactivation (`apps-surface-lanes.spec.ts:342-364`).

### 3. What input data produces a wrong answer?
None found.
- Strict boundary guards (`readMutationOutcome`, `readSubmitActionResult`, `readSubmitOperationResult`) parse RPC payloads defensively (`apps-surface-lanes.ts:177-197`, `apps-submit-flow.ts:193-248`).
- Invalid shapes or unexpected statuses default to `unknown` or trigger single-probe verification (`surface:operation`), never silent synthetic success.
- `afterEach` assertions verify that no mutation revision is sent below acknowledged revisions (`apps-surface-lanes.spec.ts:251-258`).

### 4. What happens when a dependency fails?
- `surface:change` / `surface:select` RPC transport failure: calls `surface:operation` once. If unresolved, retires overlay, preserves local unsynced state, and triggers `requestRead()` (`apps-surface-lanes.ts:537-563`).
- `surface:action` RPC transport failure: initiates polling every 3 s (up to 150 s or 3 consecutive transport failures) before settling as `unknown` (`apps-submit-flow.ts:504-577`).
- `surface:read` failure: the lane's `onWaitTick` retries `requestRead()` every grace period until `APPS_ECHO_WAIT_LIMIT_MS` is reached, at which point the queued mutation is safely retired without corrupting the host state (`apps-surface-lanes.ts:433-440`).

### 5. What is missing that the requirements never mentioned?
None. All requirements from `batches.md:547-575` and `implementation-plan.md:514-646` are honoured. The edge cases surrounding grace-read failure, multi-workspace routing retention, and submit-mutation interleaving are fully handled and covered by specs.

---

## Failure Modes

No active failure modes found.

- Scope reviewed: all four service/lane implementations and four test suites.
- Evidence read: full source lines of `apps-surface-lanes.ts`, `apps-submit-flow.ts`, `apps-surface-operations.service.ts`, `apps-session.service.ts`, and test logs.
- Residual uncertainty: visual integration of rendered components in the webview, which is tested in Batch 15.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

None.

---

## Data Flow

1. **User Input / Commit**: `AppsSurfaceOperations.change()` / `select()` validates draft value (`checkDraftValue`) $\rightarrow$ OK (`apps-surface-operations.service.ts:175-228`).
2. **Overlay Ledger & Enqueue**: Creates Rule 4 overlay in `AppsOperationOverlays`, pushes operation to surface lane queue, coalescing any existing un-sent mutation $\rightarrow$ OK (`apps-surface-lanes.ts:228-289`).
3. **Serialization Gate**: `pump()` checks `controller.signal.aborted`, `lane.inFlight`, `isSubmitting()`, and whether `expectedRevision > materializedRevision` $\rightarrow$ OK (`apps-surface-lanes.ts:354-380`).
4. **Echo Wait / Read Recovery**: If behind, arms timer; after 2 grace periods, issues `requestRead()`; past 21.5 s, drops queue with user notice $\rightarrow$ OK (`apps-surface-lanes.ts:402-477`).
5. **RPC Dispatch**: Dispatches with `base = materializedRevision` (guaranteed $\ge$ expected) $\rightarrow$ OK (`apps-surface-lanes.ts:387, 486-508`).
6. **Result Settlement**:
   - `applied`: settles overlay, sets `expectedRevision` $\rightarrow$ OK (`apps-surface-lanes.ts:478-485, 518-524`).
   - `stale-revision`: `select` re-sends once on new base; `change` retires overlay and notifies user $\rightarrow$ OK (`apps-surface-lanes.ts:526-554, 585-602`).
   - Host refusal / transport error: retires overlay, shows notice, never resends $\rightarrow$ OK (`apps-surface-lanes.ts:514-523, 537-563`).
7. **Submit Flow**:
   - Pre-condition (`!isProcessing`) $\rightarrow$ Flush $\rightarrow$ Wait for lane `settled` $\rightarrow$ Pre-check scope/values $\rightarrow$ OK (`apps-submit-flow.ts:320-464`).
   - Send `surface:action` (blocks lanes via `isSubmitting`) $\rightarrow$ on timeout/transport, polls `surface:operation` $\rightarrow$ OK (`apps-submit-flow.ts:466-577`).
   - Settle (`finish`) $\rightarrow$ updates UI state, notifies `submitEnded()`, waking held lanes $\rightarrow$ OK (`apps-submit-flow.ts:628-636`).

---

## Requirements Fulfilment

| Requirement | Status | Gap |
| :--- | :--- | :--- |
| One in-flight mutation per surface | COMPLETE | Handled in `apps-surface-lanes.ts:357` |
| Base = materialized revision | COMPLETE | Handled in `apps-surface-lanes.ts:387` |
| Queue coalescing, replaced overlay retired | COMPLETE | Handled in `apps-surface-lanes.ts:247-262` |
| `applied` settles + `expectRevision`, never materializes | COMPLETE | Handled in `apps-surface-lanes.ts:478-485` |
| All result branches handled (plan :548-575) | COMPLETE | Handled in `apps-surface-lanes.ts:566-662` |
| Transport failure vs host refusal by `errorCode` | COMPLETE | Handled in `apps-surface-lanes.ts:514-523`, `apps-submit-flow.ts:487-496` |
| `surface:operation` called once, never resent | COMPLETE | Handled in `apps-surface-lanes.ts:537-563` |
| Stale-revision: select re-sends once, change does not | COMPLETE | Handled in `apps-surface-lanes.ts:585-602, 627-647` |
| Req 6.6 unsynced-selection notice | COMPLETE | Handled in `apps-surface-lanes.ts:657-661` |
| Submit wait, pre-check, 30 s timeout, polling | COMPLETE | Handled in `apps-submit-flow.ts:380-577` |
| Zero `chat:*` calls from any mutation | COMPLETE | Verified across codebase and specs |
| No payload values in logs | COMPLETE | Verified across codebase and specs |
| Dedicated spec for `apps-surface-lanes.ts` | COMPLETE | `apps-surface-lanes.spec.ts` (440 lines) |
| Non-active workspace routing record cleanup | COMPLETE | Handled in `apps-surface-operations.service.ts:258-275` |

Implicit requirements not addressed: None.

---

## Edge Cases

| Case | Handled | How | Concern |
| :--- | :--- | :--- | :--- |
| Grace read succeeds within 1.5 s | YES | Materializes revision; lane clears wait and pumps | None |
| Grace read fails, follow-up read succeeds | YES | Lane requests read after 3 s; sends on new base | None |
| Reads keep failing past 21.5 s limit | YES | `dropQueue` drops mutations, retires overlays, shows notices | None |
| Change committed while submit is in flight | YES | Lane holds change; sends on materialized base after submit ends | None |
| Submit initiated while lane is draining | YES | Submit waits for `syncState === 'settled'` without blocking lane | None |
| Non-active workspace closed/discarded | YES | `ownedRoutingIds` transition triggers `release(routingId)` | None |
| Workspace switched away and back with queued edit | YES | Paused via `isShown()`, resumed on return without timer leak | None |
| Surface deleted while edits queued | YES | Lane deleted, queue dropped unsent | None |
| Service disposal during active wait or polling | YES | Timers cleared, RPCs aborted, zero lingering handles | None |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: None remaining in service logic. Downstream transcript integration in Batch 15 must consume `submittedBubbles` correctly.
- What a robust implementation would add: The implementation and test coverage are exemplary. No further additions needed for Batch 13.
