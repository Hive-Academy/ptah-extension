# Code Logic Review — Batch 13 (`TASK_2026_494`)

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 7/10                                 |
| Assessment            | NEEDS_REVISION                       |
| Blocking issues       | 0                                     |
| Serious issues        | 1                                     |
| Moderate issues       | 3                                     |
| Failure modes found   | 4                                     |

Scope reviewed: `apps-surface-operations.service.ts` (432 lines), `apps-submit-flow.ts`
(638 lines), `apps-surface-lanes.ts` (570 lines, new, undeclared), both spec files (681 +
539 lines) in full, plus the committed context files `apps-session.service.ts` and
`apps-surface-sync.ts` to verify the discard/release race and the N1 grace-read fix.
`npx nx run-many -t test -p @ptah-extension/mcp-apps-page --skip-nx-cache` was run: 10
suites, 199 tests, all green (no B14-fix failures present to discount).

## Five logic questions

### 1. How does this fail silently?

- `apps-surface-lanes.ts:375-385` (`armWait`): when a queued mutation is waiting for its
  expected revision to materialize and the sync's own grace-timer read fails (transport
  error), nothing re-requests a read. After `APPS_ECHO_WAIT_LIMIT_MS` (11.5 s) the lane
  gives up silently and sends the queued mutation on the **stale** materialized revision.
  The user sees no indication that the wait failed to resolve — the mutation is sent as
  if nothing were wrong, and only the host's `stale-revision` rejection (arriving later)
  surfaces the problem, dropping the user's edit with "Your value was not saved" for
  `change` (`apps-surface-lanes.ts:502`). See Failure mode "Self-inflicted stale-revision
  after a failed grace read" below.
- `apps-surface-lanes.ts:346-351` (`pump`): when a surface's `entry()` returns null and
  `isShown()` is also false (the routing id was discarded or the workspace was switched
  away), the lane silently returns without pumping and — critically — **without deleting
  itself** unless the surface was locally "gone" while still shown. A queue for a
  workspace the operator switched away from sits in memory, appearing to have "done
  nothing", until the routing id becomes active again or `release()` is eventually
  called.

### 2. What user action produces unexpected behaviour?

- Editing a field, having the edit's echo delayed past 1.5 s while the network blips
  during the grace read, then editing a second field before 11.5 s elapses: the second
  field's mutation queues behind the first (same lane), and when the wait limit expires,
  it is sent on the stale base together with the first's already-in-flight retry path.
  If the host's conflict window includes the second field's path, the user loses both
  edits with generic notices, even though nothing else touched the surface.
- Switching workspace tabs away and back while a mutation is queued (not yet sent): the
  queue silently resumes on return (`isShown()` becomes true again) — this is correct
  per the design comment, but it is **entirely unverified by any spec** (see Deviation 1
  below), so a regression here would not be caught.

### 3. What input data produces a wrong answer?

- None found that produces a *wrong* answer (an accepted value shown as something other
  than what was sent). The boundary guards (`readMutationOutcome`,
  `readSubmitActionResult`, `readSubmitOperationResult`) are conservative: an
  unrecognized `status` becomes `null`/`unknown`, which is then treated as a transport
  failure or `unknown` terminal state — never silently accepted as success. This is
  verified by `apps-surface-operations.service.spec.ts:608-621` (no payload leak) and the
  `result handling` describe block (`:528-621`).

### 4. What happens when a dependency fails?

- `surface:change`/`surface:select` transport failure → exactly one `surface:operation`
  check, never resent (`apps-surface-lanes.ts:393-434`, `:444-470`), verified at
  `apps-surface-operations.service.spec.ts:575-593`.
- `surface:action` transport failure or its own 30 s timeout → polling every 3 s (10 s
  per-call timeout), capped at 150 s or 3 consecutive poll failures → `unknown`
  (`apps-submit-flow.ts:484-559`), verified at `apps-submit-flow.spec.ts:381-414`.
- `surface:read` (the sync's automatic grace read) failure → **no automatic retry**
  (`apps-surface-sync.ts:225-236`, comment "the next trigger retries"). The submit flow
  compensates by requesting its own read on every wait tick
  (`apps-submit-flow.ts:377-397`, tested at `apps-submit-flow.spec.ts:296-320`, the
  documented B12 N1 fix). **`AppsSurfaceLanes.armWait` does not carry the same fix** — it
  never calls `host.requestRead()`, so a failed grace read during a queued mutation's
  wait is never retried before the mutation is sent anyway. This is the asymmetry at the
  centre of Deviation 4.

### 5. What is missing that the requirements never mentioned?

- The plan's per-surface serialization is justified explicitly (implementation-plan.md
  :536-537) as "the only self-inflicted `stale-revision`" and removed by construction.
  The lane's 11.5 s give-up-and-send path reopens exactly that scenario when the read
  that was supposed to resolve it fails. The plan does not mention a give-up path at all
  (see Deviation 4) — this is added behaviour, not documented behaviour, and its failure
  interaction with N1 is unaddressed.
- No spec exercises the "not shown" (workspace switched away, queue paused) or "gone"
  (surface removed while shown, lane deleted) branches of `pump()`
  (`apps-surface-lanes.ts:343-351`) even indirectly through the facade.

## Failure modes

### Self-inflicted stale-revision after a failed grace read

- Trigger: a change/select is queued behind an `applied` result whose echo has not
  arrived; the sync's automatic grace read (1.5 s) fails (transport error); no further
  read is requested by the lane.
- Symptom: at 11.5 s the queued mutation is sent on the stale materialized revision, the
  host rejects it `stale-revision`, and for a `change` the user's edit is discarded with
  "Your value was not saved. This field changed while you were editing." — a self-
  inflicted loss the serialization design (implementation-plan.md:536-537) was built to
  prevent.
- Evidence: `apps-surface-lanes.ts:375-385` (no `requestRead` call in `armWait`'s
  timeout branch), contrasted with the fixed submit-flow equivalent at
  `apps-submit-flow.ts:387-393`.
- Current handling: silent give-up and send-anyway, "the host's conflict check decides"
  (`apps-surface-lanes.ts:29-30`, doc comment — an intentional but undocumented-in-plan
  design point).
- Recommendation: on `armWait`'s timeout, call `this.host.requestRead()` (mirroring the
  submit flow's own-read compensation for N1) before re-pumping, or re-arm a bounded
  number of read attempts within the 11.5 s window instead of a single silent give-up.

### Discarded-conversation queue memory retention

- Trigger: `AppsSessionService.discard()` (`apps-session.service.ts:348-359`) or a
  workspace removal resets the slice's `conversation` to `null` synchronously (via the
  `_slices` signal), but `AppsSurfaceOperations.release(routingId)` is only invoked
  reactively, from the `effect()` in its constructor
  (`apps-surface-operations.service.ts:111-118`) watching `session.workspaceKey()` /
  `session.routingId()`, which Angular schedules asynchronously.
- Symptom: between the synchronous discard and the effect firing, `AppsSurfaceLanes` and
  `AppsSubmitFlow` for the discarded routing id remain allocated; any lane with a
  non-empty queue is *not* deleted by `pump()` (it only deletes a lane when the surface
  is locally "gone" while the routing id is still shown, not when the whole routing id is
  discarded — `apps-surface-lanes.ts:343-351`). The map entry, and per-surface queues,
  persist until the effect runs (or, for a submit's poll timer, up to 150 s).
- Evidence: `apps-surface-operations.service.ts:250-265` (`reconcile`, called from the
  effect, calls `release(previous)` only when it observes the workspace key's tracked
  routing id changed) vs. `apps-session.service.ts:348-359` (`discard`, no call into
  `AppsSurfaceOperations`).
- Current handling: memory is not correctness-affecting here (see ruling on Deviation 3
  below — every send site re-reads `entry()`/`isShown()` fresh off the `computed()`
  signals, which recompute synchronously on read regardless of effect timing, so no RPC
  is actually sent for a discarded routing id). It is a genuine but non-blocking resource
  retention window, not a data-corruption path.
- Recommendation: no fix required for correctness. If tightened, have `discard()` (and
  the workspace-removal path) call `AppsSurfaceOperations.release()` directly instead of
  relying on the reactive effect — but that would require `AppsSessionService` to depend
  on `AppsSurfaceOperations`, inverting today's clean one-way dependency
  (`apps-surface-operations.service.ts:24` imports `AppsSessionService`;
  `apps-session.service.ts` imports nothing from `apps-surface-operations.service.ts` —
  confirmed by grep). Keeping release reactive, as now, avoids that cycle; the
  alternative (an explicit "discarded" callback registry) is available if the
  memory-retention window becomes an observed problem.

### Untested `apps-surface-lanes.ts` branches

- Trigger: none — this is a coverage gap, not a runtime trigger.
- Symptom: a regression in the "not shown" pause/resume path, the "gone" lane-deletion
  path, or the grace-read-failure give-up path would not be caught by any test in the
  batch.
- Evidence: no occurrence of "workspace" in
  `apps-surface-operations.service.spec.ts` (grep confirmed); `APPS_ECHO_WAIT_LIMIT_MS`
  is only ever advanced *after* a successful read already retired the wait (case 5,
  `:327-342`), never in a scenario where the read fails first.
- Current handling: the file is otherwise well covered indirectly (reconciliation cases
  1–6, queue coalescing, stale-revision retry for both operation kinds, Req 6.6, every
  result branch, `console.warn` payload-safety, dispose/release semantics).
- Recommendation: see Deviation 1 ruling.

### `too-many-operations` / `operation-expired` after `armWait`'s stale send

- Trigger: the stale send from the failure mode above can, in principle, also surface
  `too-many-operations` or `operation-expired` rather than `stale-revision`, since the
  lane's own delayed sends inflate the per-routing-id operation-id cadence during network
  trouble.
- Symptom: same generic "retire + notice" handling
  (`apps-surface-lanes.ts:557` bucket) applies; no special-casing needed, this is
  correctly generic. Recorded here only because the design comment claims the
  serialization "removes the only self-inflicted `stale-revision`" — the failure mode
  above shows that claim no longer holds once the grace read itself can fail, and the
  same reopened path can also produce these other reject reasons under sustained network
  trouble.
- Evidence: `apps-surface-lanes.ts:552-559`.
- Current handling: correct generic handling; not a defect in itself, just further
  evidence for Deviation 4.
- Recommendation: covered by the Deviation 4 fix.

## Blocking issues

None.

## Serious issues

### Grace-read failure reopens the self-inflicted stale-revision the design claims to prevent

- File: `apps-surface-lanes.ts:375-385` (`armWait`), contrasted with the parallel fix at
  `apps-submit-flow.ts:377-397`.
- Scenario: the automatic 1.5 s grace read fails once (any transport hiccup); a queued
  change or select is waiting behind it.
- Impact: after 11.5 s the mutation sends on a stale base; the host is likely to reject
  it `stale-revision`; for a `change`, the user's edit is discarded and they must
  re-enter it — a self-inflicted data-loss path the serialization design exists to
  prevent, per implementation-plan.md:536-537's own stated rationale, and inconsistent
  with the fix already applied to the sibling submit flow for the identical underlying
  issue (B12 carry-forward N1).
- Fix: call `this.host.requestRead()` in `armWait`'s timeout branch before re-pumping
  (or otherwise ensure at least one additional read attempt happens within the wait
  window when the automatic grace read failed), matching the submit flow's own-read
  compensation.

## Moderate and minor issues

- `apps-surface-lanes.ts` (570 lines, new) has no dedicated spec file, unlike every
  other file in this batch and the two prior batches' pure-state files. Coverage is
  real but partial (see Deviation 1 ruling) — file:
  `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.ts`.
- Discarded-conversation queues are retained in memory until the reactive effect fires
  or timers naturally expire (up to 150 s for a submit's poll) — `apps-surface-lanes.ts
  :343-351`, `apps-surface-operations.service.ts:111-118`. Not correctness-affecting
  (see Failure mode above), but worth a follow-up note if profiling ever flags it.
- No spec exercises the workspace-switch pause/resume or surface-removal lane-deletion
  branches of `pump()` — `apps-surface-lanes.ts:343-351`.

## Data flow

1. Renderer `inputCommit` → `AppsSurfaceOperations.change()` validates via
   `checkDraftValue`, clears the input's issue, delegates to
   `AppsSurfaceLanes.change()` — OK, validated at the boundary
   (`apps-surface-operations.service.ts:162-190`).
2. `AppsSurfaceLanes.change()` creates a fresh operation id, replaces any queued unsent
   change for the same component (retiring its overlay unsent), adds the new Rule-4
   overlay, pumps — OK (`apps-surface-lanes.ts:215-249`), matches plan:538 and B10
   carry-forward overlay shape.
3. `pump()` re-reads `entry()`/`isShown()` fresh on every call, so a discarded or
   not-shown routing id never actually sends — OK, this is the safety net that makes
   Deviation 3's "detected, not called" release pattern non-blocking
   (`apps-surface-lanes.ts:336-373`).
4. `send()` calls `surface:change`/`surface:select` with `revision: base` where `base`
   is read from `entry.materializedRevision` at send time (never cached across the
   queue wait) — OK, matches "base = materialized" (`apps-surface-lanes.ts:361,398`).
5. Result routed through `readMutationOutcome` (a boundary guard, `null` on anything
   unrecognized) into `settleChange`/`settleSelect` — every plan-listed reject reason is
   covered by a generic bucket except `stale-revision` (special-cased per operation
   kind) — OK except for the gap described above in the wait-before-send step (step 3
   is only safe once the mutation is *sent*; the wait *before* sending is where the
   grace-read-failure gap lives, at `armWait`, not in `send`/`pump` themselves).
6. `applied` outcome settles the overlay ledger and raises the *expected* (never
   materialized) revision via `this.expect()`, which forwards to
   `AppsSessionService.expectSurfaceRevision` → `AppsSurfaceSync.expectRevision` — OK,
   Rule 1 correctly never writes `materializedRevision` directly
   (`apps-surface-lanes.ts:478-484`, `:518-524`).
7. Submit: precondition → flush (renderer's own responsibility, not re-verified here,
   per plan) → wait for `lanes.syncState()` to report `settled`, requesting its own read
   on each tick while behind → local pre-check
   (`collectSubmitScope`/`checkSubmitValues`) → `surface:action` → result or polling →
   `finish()` — OK end to end, matches plan:583-615 and the state table at plan:604-614.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| One in-flight mutation per surface | COMPLETE | `apps-surface-lanes.ts:336-373` (`inFlight` guard) |
| Base = materialized revision | COMPLETE | `apps-surface-lanes.ts:361,398` |
| Queue coalescing, replaced overlay retired | COMPLETE | `apps-surface-lanes.ts:230-244`, tested `:377-394` |
| `applied` settles + `expectSurfaceRevision`, never materializes | COMPLETE | `apps-surface-lanes.ts:478-484` |
| Every result branch (plan:548-575) | COMPLETE | `apps-surface-lanes.ts:472-569`, tested `:528-621` |
| Transport failure vs host refusal by `errorCode` | COMPLETE | `apps-surface-lanes.ts:417-434`, `apps-submit-flow.ts:466-483` |
| `surface:operation` called once, never resent | COMPLETE | `apps-surface-lanes.ts:443-470`, tested `:575-593` |
| Stale-revision: select re-sends once, change does not | COMPLETE | `apps-surface-lanes.ts:489-509` (change), `:526-554` (select) |
| Req 6.6 unsynced-selection notice | COMPLETE | `apps-surface-lanes.ts:563-568`, tested `:485-527` |
| Submit precondition / wait / pre-check / 30 s / polling | COMPLETE | `apps-submit-flow.ts:301-559`, tested throughout `apps-submit-flow.spec.ts` |
| Zero `chat:*` calls | COMPLETE | grep-confirmed absent from all three files |
| No payload values in logs | COMPLETE | tested `apps-surface-operations.service.spec.ts:608-621` |
| Per-surface serialization prevents self-inflicted stale-revision | PARTIAL | grace-read-failure path reopens it (Serious issue above) |
| Dedicated spec for every new file | PARTIAL | `apps-surface-lanes.ts` has none (Deviation 1) |

Implicit requirements not addressed: none beyond the above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Grace read succeeds within 1.5 s | YES | reconciliation case 5 | none |
| Grace read fails, wait limit elapses | NO (design gap) | sends on stale base | Serious issue above |
| Discard mid-queue | YES (by re-check, not by prompt release) | `entry()`/`isShown()` fresh reads | memory retained, not correctness |
| Workspace switch away/back with queued mutation | YES (by code inspection) | `isShown()` gate | untested |
| Surface removed while routing id still shown | YES | lane deleted in `pump()` | untested directly, plausible via reducer specs |
| `stale-revision` on select | YES | one re-send, new id, new base | tested `:421-460` |
| `stale-revision` on change | YES | retire, notice, no resend | tested `:461-484` |
| Submit's own grace-read compensation (N1) | YES | `apps-submit-flow.ts:377-397` | tested `:296-320` |
| Poll timer released on `dispose`/`release` | YES | `apps-submit-flow.ts:341-346` | tested `:430-443` |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `AppsSurfaceLanes.armWait`'s 11.5 s give-up-and-send-anyway path does not
  request its own read the way the sibling submit flow does for the identical B12 N1
  gap, so a single failed automatic grace read can reproduce the exact self-inflicted
  `stale-revision` the plan's per-surface serialization is designed to eliminate,
  discarding a user's in-progress edit.
- What a robust implementation would add: (1) a `requestRead()` call in `armWait`'s
  timeout branch, mirroring the submit flow's fix; (2) a dedicated
  `apps-surface-lanes.spec.ts` (or, at minimum, added cases in the existing operations
  spec) covering the workspace-switch pause/resume, surface-gone lane deletion, and
  failed-grace-read-then-timeout paths, none of which are exercised today.

## Deviation rulings

1. **`apps-surface-lanes.ts` (570 lines) with no dedicated spec.** ACCEPT WITH
   CONDITION. The file's public surface (`change`, `select`, `pumpAll`, `isPending`,
   `syncState`, `expect`, `dispose`) is reached and exercised through
   `apps-surface-operations.service.spec.ts`'s reconciliation cases 1–6, queue
   coalescing tests, stale-revision retry tests (both operation kinds), Req 6.6 tests,
   and the full result-handling matrix — real coverage, not incidental. It is not,
   however, *adequate*: the workspace-switch pause/resume branch, the surface-gone
   lane-deletion branch, and — most importantly — the failed-grace-read-then-timeout
   branch are all untested. Given the file's size and that it holds the serialization
   invariant the whole batch exists to guarantee, a dedicated spec (or the missing cases
   added to the existing one) should be required before this batch is considered fully
   verified, prioritizing the failed-grace-read case since it is also the Serious issue
   above.

2. **`submittedBubbles` signal instead of a direct transcript write.** ACCEPT.
   `AppsSurfaceOperations` does not own the transcript (that lands in Batch 15's
   `AppsPageComponent`/`AppsTranscriptComponent`, per implementation-plan.md:648-659);
   exposing a `computed()` signal of pending bubbles for the active routing id
   (`apps-surface-operations.service.ts:106-109`) is the correct seam for a consumer that
   does not exist yet in this batch. It is tested for content and ordering at
   `apps-submit-flow.spec.ts:375-377`.

3. **Discard cleanup detected, not called; stale-queue send risk; dependency
   direction.** ACCEPT the design, with the memory-retention gap noted non-blocking.
   Verified by code reading: `AppsSessionService.discard()`
   (`apps-session.service.ts:348-359`) does not import or call into
   `AppsSurfaceOperations` (grep-confirmed — no such import exists), so there is **no
   dependency cycle**; `AppsSurfaceOperations` depends one-way on `AppsSessionService`
   (`apps-surface-operations.service.ts:24`). Release is instead detected reactively by
   an `effect()` watching `session.workspaceKey()`/`session.routingId()`
   (`apps-surface-operations.service.ts:111-118`, `:250-265`). Because Angular
   `computed()` signals recompute synchronously on read (not only when the effect
   scheduler runs), every send-site guard (`entry()`, `isShown()` in
   `apps-surface-lanes.ts:343-351`, `:397`) observes the discard immediately, before any
   RPC for the discarded routing id can be sent — confirmed by tracing `entryFor`
   (`apps-surface-operations.service.ts:314-321`), which reads `session.routingId()`
   fresh on every call. So: **no**, a stale queue cannot send a mutation or
   `surface:action` for a discarded/removed conversation; the correctness property holds.
   What is real is the *memory* gap: lanes/flow for a discarded routing id are not
   disposed until the effect fires (an async microtask) or their own timers naturally
   expire (up to 150 s for a stuck poll). Recommendation: keep `release(routingId)`
   where it is (reactive, in `AppsSurfaceOperations`) rather than adding a call from
   `AppsSessionService`, which would invert the dependency direction for no correctness
   gain — the send-site guards already make the timing of disposal a resource question,
   not a correctness one.

4. **11.5 s queued-mutation send and 30 s submit timeout vs. plan:548-646.** SPLIT
   RULING. The 30 s submit-precondition timeout (`APPS_SUBMIT_SYNC_LIMIT_MS`,
   `apps-submit-flow.ts:49`) is ACCEPT: it is bounded, it requests its own read on every
   tick while behind (the B12 N1 fix, tested), and it fails closed with a clear "did not
   finish syncing" notice (`apps-submit-flow.ts:387-390`) rather than sending stale data.
   The 11.5 s queued-mutation wait limit (`APPS_ECHO_WAIT_LIMIT_MS`,
   `apps-surface-lanes.ts:46-47`) is REJECT as implemented: unlike its submit-flow
   sibling, it never requests its own read when the automatic grace read fails, so
   "sending after 11.5 s with base = materialized" **does** risk exactly the
   self-inflicted `stale-revision` the plan's serialization exists to prevent (plan
   :536-537), specifically in the failure case where the automatic grace read itself
   fails — see Serious issue above. This is the batch's one required fix.

5. **Optional N5 spec skipped.** ACCEPT. N5 (batches.md:541: "add one spec covering
   start -> real onSurfaceCreated -> sessionFor resolving, if B13 touches that path")
   was conditional on Batch 13 touching that path. Batch 13's files (
   `apps-surface-operations.service.ts`, `apps-submit-flow.ts`, `apps-surface-lanes.ts`)
   inject `AppsSessionService` for slice access but do not modify or exercise its
   `start`/`onSurfaceCreated`/`sessionFor` internals; `apps-session.service.ts` is
   committed context from Batch 12, not part of this batch's diff. Skipping N5 here is
   correctly scoped.
