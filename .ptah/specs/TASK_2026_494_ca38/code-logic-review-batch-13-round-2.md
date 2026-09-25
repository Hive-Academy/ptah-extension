# Code Logic Review — Batch 13, Round 2 (FINAL) — `TASK_2026_494`

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 9/10                                 |
| Assessment            | APPROVED                             |
| Blocking issues       | 0                                     |
| Serious issues        | 0                                     |
| Moderate issues       | 1                                     |
| Failure modes found   | 1 (timing nit, not correctness-affecting) |

Scope reviewed in full: `apps-surface-lanes.ts` (663 lines), `apps-submit-flow.ts` (658
lines), `apps-surface-operations.service.ts` (448 lines), the `ownedRoutingIds` diff in
`apps-session.service.ts` (lines 149-166 plus the surrounding `discard()`/`dropSlice()`
paths at 367-378 and 576-585), the new `apps-surface-lanes.spec.ts` (439 lines) in full,
and the new blocks in `apps-submit-flow.spec.ts` (:563-637) and
`apps-session.service.spec.ts` (:655-675). Ran
`npx jest -c libs/frontend/mcp-apps-page/jest.config.ts` against all four spec files:
4 suites, 87 tests, all green.

## Prior-findings rulings

| # | Round-1 finding | Source | Ruling | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Grace-read failure reopens self-inflicted stale-revision (Serious) | Both reviews (Defect/Serious 1) | **RESOLVED** | `apps-surface-lanes.ts:411-444` (`onWaitTick`): past `APPS_ECHO_WAIT_LIMIT_MS` the lane calls `dropQueue(lane)` (`:435`), never sends. A queued mutation is now provably never sent on a base below the highest acknowledged revision — enforced by the `afterEach` invariant in `apps-surface-lanes.spec.ts:251-258` (`revision >= ackedAtSend`) across every test, and directly exercised by "reads keep failing until the limit" (`:295-327`), which asserts zero further `surface:change`/`surface:select` calls, overlay retirement, and both notices. |
| 2 | Untested `apps-surface-lanes.ts` branches (Moderate / Deviation 1) | Both reviews | **RESOLVED** | New `apps-surface-lanes.spec.ts` (439 lines) exercises: echo-wait with a failed grace read (`:267-327`), an echo landing during the wait (`:329-339`), workspace-switch pause/resume (`:342-364`), surface-gone lane deletion (`:366-388`), submit-in-flight holding for both change and select (`:390-420`), and dispose (`:422-438`). All previously-cited coverage gaps are closed. |
| 3 | Discarded-conversation queue memory retention (Moderate) | Batch-13 review | **RESOLVED** | `apps-session.service.ts:149-166` adds `ownedRoutingIds`; `apps-surface-operations.service.ts:123-129,258-269` releases every routing id (`records`, `_ui`, `_submitted`) not in the owned set, covering discard, failed start, and workspace removal regardless of whether the workspace was active — closing the gap the round-1 review left open for inactive-workspace removal. Verified by `apps-session.service.spec.ts:655-675` and `apps-submit-flow.spec.ts:611-637`. |
| 4 | Asymmetric submit/lanes serialization (Antigravity Defect 2) | Antigravity review | **RESOLVED** | `AppsLaneHost.isSubmitting` (`apps-surface-lanes.ts:112-113`) gates `pump()` (`:361-367`); `AppsSubmitHost.submitEnded` (`apps-submit-flow.ts:96`) is called from every normal `finish()` (`:627-636`) and re-pumps the lanes. `isSubmitting` is false during the submit's own `waiting` phase (`apps-submit-flow.ts:302-308`), so the submit's own wait for the lanes cannot deadlock against a lane waiting for the submit. Verified by `apps-surface-lanes.spec.ts:390-420` and `apps-submit-flow.spec.ts:563-608`. |
| 5 | Inactive workspace removal leaves routing record (Antigravity Defect 3) | Antigravity review | **RESOLVED** | Same `ownedRoutingIds` mechanism as #3 — a routing id belonging to a non-active, removed workspace is dropped from the set the moment `dropSlice()` removes the slice (`apps-session.service.ts:576-585`), and the reconcile effect releases it. Verified end-to-end (poll timer included) at `apps-submit-flow.spec.ts:611-637`, which asserts `jest.getTimerCount() === 0` after removal. |
| 6 | `too-many-operations`/`operation-expired` after a stale send (batch-13 failure mode) | Batch-13 review | **RESOLVED (moot)** | This failure mode was downstream of finding #1 (the stale send no longer happens, so the reopened path that could additionally surface these reject reasons under load no longer exists). |

## Deviation rulings

1. **`APPS_ECHO_WAIT_LIMIT_MS` raised from 11.5 s to 21.5 s (`GRACE + 2 × READ_TIMEOUT`).**
   ACCEPT. The new value gives the sync's automatic grace read and the lane's own
   follow-up read each a full `APPS_SURFACE_READ_TIMEOUT_MS` (10 s) before giving up,
   matching the design comment at `apps-surface-lanes.ts:50-56`. This is a budget
   increase paired with a correctness fix (drop instead of stale-send), not a new risk:
   worst case the user waits longer before the "not saved" notice appears; they were
   never at risk of a silent stale write. Tests reference the symbol, not the literal,
   so the value can move again without touching specs.

2. **No read requested on the first wait tick.** ACCEPT, with a residual timing note
   (see Moderate issue below). The first tick is skipped on the assumption that it
   coincides with the sync's own automatic grace read, which is true when `armWait` is
   first invoked in the same call stack as `expect()` (the common case: an `applied`
   ack settles an already-queued mutation, `settleChange`/`settleSelect` calls
   `this.expect()` then `this.pump(lane)` synchronously, `:397-398`, `:532-533`,
   `:576`, `:616`). It is directly verified by the "grace read fails, a later tick
   reads" spec (`apps-surface-lanes.spec.ts:267-293`).

3. **`AppsLaneHost.isSubmitting` / `AppsSubmitHost.submitEnded`.** ACCEPT. This is the
   correct, minimal seam: `isSubmitting` is read-only and surface-scoped
   (`apps-surface-operations.service.ts:379-380`), `submitEnded` is a one-way
   notification with no return value (`:413`), and neither introduces a new dependency
   direction — both are wired through the existing `AppsLaneHost`/`AppsSubmitHost`
   interfaces the facade already owned. Traced end to end against both new symmetric-
   serialization spec blocks; no deadlock or stuck submit is reachable (see analysis
   below).

4. **`ownedRoutingIds` computed on `AppsSessionService`, replacing the `routingByKey`
   discard-detection the round-1 review examined.** ACCEPT. `apps-session.service.ts
   :149-166` is a pure derivation over `_slices()` with no new outbound dependency (the
   session still imports nothing from `apps-surface-operations.service.ts` — grep-
   confirmed absent). The custom `equal` (member-set comparison) is mathematically
   sound for detecting a real membership change: two same-size sets where every member
   of the first is in the second cannot have a member of the second absent from the
   first, so this cannot mask a real change (see analysis under "ownedRoutingIds
   equality" below). Verified instance-stability directly:
   `apps-session.service.spec.ts:665-667` asserts the same `Set` instance survives an
   unrelated patch (`recordFocusKey`).

## New findings

### Moderate: a mutation queued well after its `applied` ack delays the lane's own compensating read by one grace period

- File: `apps-surface-lanes.ts:402-409` (`armWait`), `:418-444` (`onWaitTick`).
- Scenario: mutation A is acknowledged (`applied`) with no queue behind it —
  `pump()` returns at the `lane.queue.length === 0` guard (`:358-360`) before reaching
  `armWait`, so the lane's own wait timer is not armed yet even though
  `host.expectRevision()` already armed the sync's grace timer. Several seconds later
  (well past the sync's 1.5 s grace read, which has already fired and possibly already
  failed, since the sync does not re-arm after a failed read), the user edits the same
  field again. `change()` queues the new mutation and calls `pump()`, which now arms
  the lane's wait timer for the first time (`waitStartedAt ??= Date.now()` sets it to
  *now*, not to when the expectation was raised).
- Impact: the "skip the first tick's read because the sync's own grace read is already
  covering it" assumption (documented at `:411-417`) no longer holds in this ordering —
  the sync's grace read already ran (and possibly already failed) before the lane ever
  started waiting. The lane's first tick still skips requesting its own read, so the
  actual compensating read is deferred to the second tick, one extra
  `APPS_ECHO_GRACE_MS` (1.5 s) after the lane starts waiting.
- Why this is Moderate, not Serious: the "own writes never conflict" invariant is
  unaffected — `pump()` re-checks `lane.expected > entry.materializedRevision` before
  every send regardless of tick timing (`:377-380`), and `APPS_ECHO_WAIT_LIMIT_MS` is
  measured from `waitStartedAt`, i.e. from when the lane actually starts waiting, not
  from when the expectation was raised — so the deadline moves later along with the
  late start, giving strictly *more* wall-clock budget, never less. No stale send, no
  premature drop. The only externally visible effect is a slightly later first own-
  read request in this specific ordering, within a budget that already has slack (a
  10 s follow-up-read timeout inside a scenario that typically resolves in
  milliseconds).
- Recommendation: none required for correctness. If tightened, `armWait` could record
  `waitStartedAt` at the moment `expect()` raises the expectation (in `expect()`
  itself) rather than at the moment a queue first becomes non-empty, which would also
  make the "skip first tick" assumption hold unconditionally. Not a release blocker.

## Regression hunt (explicit)

- **Deadlock between a waiting submit and held lanes**: not found.
  `AppsSubmitFlow.isSubmitting` is false while `phase === 'waiting'`
  (`apps-submit-flow.ts:302-308`), so a lane never holds against a submit that is
  itself waiting for that lane to drain — `pump()`'s `isSubmitting` check
  (`apps-surface-lanes.ts:364-367`) only fires once the submit has moved to `sending`
  or `polling`, at which point the submit is no longer waiting on `syncState()`. Traced
  through `advance()` → `preCheckAndSend()` → `send()` (`apps-submit-flow.ts:380-464`)
  and `pump()` → `armWait()`/`send()` (`apps-surface-lanes.ts:354-399`); no cycle where
  each side is blocked on the other.
- **Lane held forever if `submitEnded` is missed**: not found. Every path that ends
  `active` (`finish()` at `apps-submit-flow.ts:628-636`, called from `settle()`,
  `onWaitTick`'s sync-timeout branch, and `fail()`) calls `this.host.submitEnded()`
  except `dispose()` (`:359-364`), which sets `this.active = null` directly.
  `isSubmitting()` reads `this.active !== null` (`:303-307`), so it is false
  immediately after `dispose()` regardless of whether `submitEnded()` ran — and
  `dispose()` is only called from `AppsSurfaceOperations.release()`
  (`apps-surface-operations.service.ts:249-250`), which disposes the lanes for the
  same routing id in the same call, so there is nothing left to hold. Traced all
  `this.active = null` assignment sites; none leaves `isSubmitting()` stuck `true`.
- **Timer leaks**: not found by inspection or by spec. `clearWait`/`clearTimer` are
  called on every early-return branch that stops a wait (`apps-surface-lanes.ts:365`,
  `:372`, `:381`, `:428`, `:454`) and on `dispose()`
  (`apps-surface-lanes.ts:332-336`, `apps-submit-flow.ts:359-364`). Both new spec
  blocks assert `jest.getTimerCount() === 0` after dispose/release
  (`apps-surface-lanes.spec.ts:434`, `apps-submit-flow.spec.ts:631`).
- **`ownedRoutingIds` equality masking a real change**: not found. The comparator
  (`size` equal + every member of `a` in `b`) is a correct set-equality test for two
  sets of equal size — it cannot mask an addition or removal, only a membership-
  preserving mutation elsewhere in the slice (which is the intended behaviour, proven
  at `apps-session.service.spec.ts:665-667`).
- **Drop path leaving overlays/notices inconsistent**: not found. `dropQueue`
  (`apps-surface-lanes.ts:451-477`) retires the overlay of every dropped change and
  sets `APPS_CHANGE_TEXT.notSynced`; for a dropped select it calls `markUnsynced`,
  which is itself guarded by an `operationId` match in the facade
  (`apps-surface-operations.service.ts:372-377`), so a notice can never attach to a
  selection the user has since replaced.
- **Send on a base below the acknowledged revision**: not found. Enforced structurally
  (`pump()` never takes an op off the queue while `lane.expected > materializedRevision`,
  `apps-surface-lanes.ts:377-387`) and independently verified by the `afterEach`
  invariant present in both `apps-surface-lanes.spec.ts:251-258` and the equivalent
  blocks added to `apps-surface-operations.service.spec.ts`/`apps-submit-flow.spec.ts`
  per the fix report — all 87 tests across the four re-run spec files pass this check.
- **`chat:*` from a mutation**: not found. Grep-confirmed zero `chat:*` call sites in
  `apps-surface-lanes.ts`, `apps-submit-flow.ts`, `apps-surface-operations.service.ts`
  (the only matches are doc comments).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Late-armed wait timer defers the lane's own compensating read by one grace period in
  a specific ordering (queue empties, then refills well after the ack) — see "New
  findings" above. `apps-surface-lanes.ts:354-360,402-409`. Not correctness-affecting.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none rises to Serious or Blocking. The one residual Moderate note (deferred
  first own-read in a specific queue-empties-then-refills ordering) cannot produce a
  stale send or a premature drop, because the send gate and the drop deadline are both
  re-derived from live state (`materializedRevision`, `waitStartedAt`) rather than from
  a value cached at expectation time.
- What a robust implementation would add: record `waitStartedAt` at the moment
  `expect()` raises the expectation rather than at the moment the lane's queue next
  becomes non-empty, so the "skip the first tick's read" assumption holds
  unconditionally instead of only in the common case. Not required before merge.
