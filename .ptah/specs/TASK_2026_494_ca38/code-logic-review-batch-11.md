# Code Logic Review — `TASK_2026_494` Batch 11 (intake, reducer, system prompt)

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 8/10                                 |
| Assessment            | APPROVED                             |
| Blocking issues       | 0                                     |
| Serious issues        | 0                                     |
| Moderate issues       | 2                                     |
| Failure modes found   | 3                                     |

Scope reviewed: `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.ts` (+spec),
`state/apps-surface-reducer.ts` (+spec), `apps-system-prompt.ts` (+spec), and
`state/apps-operation-overlays.ts` (Batch 10, read for context only, not re-reviewed). Cross-checked
against implementation-plan.md:404-453, 482-494, 236-244, 504-505, 540-582, 616-636, and
`handoff-494.md` (a) item 2, (c). Verification: `npx nx run-many -t test -p @ptah-extension/mcp-apps-page
--skip-nx-cache` — 5/5 suites, 97/97 tests pass, matching the report's numbers.

## Deviation verdicts

1. **Ops on a rejected surface returns `needsRead`, not discard (plan:434).** ACCEPT.
   Evidence: `apps-surface-reducer.ts:244-248`. The plan's literal text (`implementation-plan.md:434`)
   says discard. But `applyOps` never advances `materializedRevision` on discard, so a rejected surface
   that keeps receiving `ops` pushes at the same `fromRevision` would discard forever — no path back to
   a valid document, contradicting the plan's own "a rejected surface shows the mono fallback" (Req 3.5)
   recovery expectation and Rule 3 (`fromRevision` gap → read). The executor's reasoning that "re-reading
   returns the same document" (the plan's actual justification for *snapshot* rejects, `:428`) does not
   hold for ops applied on the host's own valid copy. Pinned by "asks for a read for ops on an unknown or
   rejected surface" (`apps-surface-reducer.spec.ts:339-357`). No rule (1-4) is violated; this is a
   legitimate fix of a plan gap.

2. **A read retires overlays via `retireSettledUpTo(resultRevision)`, not `retireAllSettled()`
   (plan:582).** ACCEPT. Evidence: `apps-surface-reducer.ts:404-412` (`newEntry` → `retireSettledUpTo`)
   and `apps-surface-reducer.ts:462-463` (`updateSurfaceOverlays`). Plan line 582 (Component 5,
   `apps-operation-overlays.ts` responsibilities) says "a read retires every settled overlay of that
   surface," but the plan's own case-4 definition at `implementation-plan.md:625-626` states: "a push at
   R+1 is applied, then a result for rev R arrives. The materialized revision stays R+1. **The same holds
   for a stale `surface:read` answer**." An unconditional `retireAllSettled()` on every read would drop a
   confirmed, ack'd user edit and show stale host data whenever the read that recovers an operation is
   itself stale relative to a later push — a direct contradiction of the plan's own case-4 guarantee.
   `retireSettledUpTo` is a strict subset of `retireAllSettled` (identical behaviour whenever
   `ackRevision <= materializedRevision`, which is the common case; more conservative only in the stale
   case). Pinned by "case 4: a stale read keeps a settled overlay whose ack is above what it materializes"
   (`apps-surface-reducer.spec.ts:609-621`). On "can this leave a settled overlay stuck forever": no
   observed mechanism does so. `applyDelete` removes the entry (and its overlays) unconditionally
   regardless of revision (`apps-surface-reducer.ts:290-313`, "terminal whatever its revision"), so an
   eviction or agent-delete after the ack does not leave an orphaned overlay — it removes the whole entry.
   Because the ack revision is itself a host-committed revision, any future genuine push or read for that
   surface will carry a revision `>=` the ack, so retirement resolves on the next real update. The only
   residual scenario is total loss of future updates (connection permanently dead), which is a Batch-12
   sync/connectivity concern, not a reducer defect — noted under Failure modes below.

3. **`readSeq` comparison uses `lastAppliedSeq <= readSeq`, not the plan's literal `< readSeq`
   (plan:452).** ACCEPT. Evidence: `apps-surface-reducer.ts:112-114` (`surfaceReadSeq` captures
   `state.seq` at send time, i.e., *after* the triggering push has already incremented it) and
   `apps-surface-reducer.ts:421-423` (removal test). Given that capture point, an entry whose
   `lastAppliedSeq === readSeq` was applied in the exact update that triggered the read send and was
   therefore known to the host at send time; its absence from a subsequent read result means it was
   genuinely deleted server-side, so it must be removed. Using the plan's literal `<` would let that
   entry survive incorrectly. Verified directly: `apps-surface-reducer.spec.ts:480-488` ("keeps entries
   pushed after the read was sent and removes the rest") sends the read at `readSeq = 1` (the seq right
   after surface `a`'s snapshot) and correctly removes `a` when absent from the result — which only holds
   under `<=`, not `<`. Confirmed as a genuine off-by-one fix, not a rule violation.

4. **Additions: `guardSurfaceReadResult`, `updateSurfaceOverlays`, `APPS_TOMBSTONE_LIMIT` (64),
   `AppsSurfaceNotice`.** ACCEPT, bounded and free of new failure modes.
   - `guardSurfaceReadResult` (`apps-surface-intake.ts:153-170`): necessary because `applySurfaceRead`
     takes `unknown`; rejecting the whole result on one unusable view is correct — silently skipping a
     view would look like the surface was deleted (Rule: absence from a read removes it).
   - `updateSurfaceOverlays` (`apps-surface-reducer.ts:455-469`): the only write path to overlays; never
     touches `materializedRevision` (Rule 1 respected), no-ops on an unknown surface id
     (`apps-surface-reducer.spec.ts:649-656`), and always re-applies `retireSettledUpTo` after the
     caller's update, so it cannot leave a now-covered settled overlay behind.
   - `APPS_TOMBSTONE_LIMIT = 64` (`apps-surface-reducer.ts:93,124-139`): `withTombstone` evicts oldest by
     insertion order after `delete()+set()` (which moves the touched key to the end of Map iteration
     order), so this is a correct LRU, not a naive cap that could evict the most recently touched
     tombstone. With at most 8 surfaces per routing id, 64 is generous headroom against premature
     eviction of a tombstone that a genuinely in-flight late push still needs.
   - `AppsSurfaceNotice`: a straightforward typed carrier for the eviction text the plan already names
     (`APPS_EVICTED_NOTICE`); no new risk.

5. **A read keeps `viewState` of an already-held surface (`apps-surface-reducer.ts:336-355`, `newEntry`).**
   ACCEPT. The plan's "reset from the pushed state" instruction (`implementation-plan.md:430`) is written
   inside the *snapshot* transition only; nothing in the plan's `applyRead` bullets (`:448-453`) mentions
   `viewState`, and `implementation-plan.md:683` ("destroy and re-create restores the transcript,
   surfaces, view state and overlays") frames view state as durable client-local presentation state, not
   something a host resync should clear. A read is explicitly framed as recovery (lost echo, gap,
   rehydration), not an agent replace, so preserving sort/page/drafts across a recovery read is the
   behaviour a user would expect and is not contradicted by any plan rule. Pinned by "replaces a held
   surface from a newer view and keeps its view state" (`apps-surface-reducer.spec.ts:466-478`) and "ops
   apply only from a matching fromRevision and keeps view state" for the parallel ops case
   (`apps-surface-reducer.spec.ts:261-273`). A surface first *seen* through a read still starts with
   `EMPTY_VIEW_STATE` (`newEntry`, `previous === undefined` branch), so there is no cross-surface leakage.

## Five logic questions

### 1. How does this fail silently?

- `apps-surface-reducer.ts:299-302`: `AppsSurfaceState.notice` is a single slot, not per-surface. If two
  surfaces are evicted in quick succession before the UI consumes/dismisses the first notice, the second
  `applyDelete('evicted')` unconditionally overwrites `state.notice` (`notice: reason === 'evicted' ? {
  kind: 'evicted', surfaceId, text: APPS_EVICTED_NOTICE } : ...`). The first eviction's notice is silently
  lost — the user is told an app was removed, but never learns a second one also was. No test exercises
  two evictions in the same reduce chain without an intervening notice-consuming read. Moderate: no data
  loss (the surface itself is tombstoned correctly), but a real informational silent failure.
- `acceptLastSubmit` (`apps-surface-intake.ts:236-238`) passes `SurfaceSubmitRecord` through after only an
  `isRecord` check — no field-level validation, unlike every other host value in this file. The executor
  flags this explicitly as deferred to Batch 15 ("Out-of-scope observations"), which is a reasonable
  phasing, but until that batch lands this is a partially-validated boundary that would show malformed
  `lastSubmit` fields to the renderer without warning.

### 2. What user action produces unexpected behaviour?

- Two apps evicted back-to-back (see above): the user only ever sees one eviction notice.
- None of the reducer's own transitions are reachable directly by "user action" in this batch (all
  transitions are driven by host pushes or reads); UI-triggered mutation behaviour belongs to Batch 13,
  out of this review's scope.

### 3. What input data produces a wrong answer?

- A `deleted` push is applied "whatever its revision" (`apps-surface-reducer.ts:283-313`, matching
  `implementation-plan.md:440-441` verbatim) with no ordering check against `materializedRevision`. If
  transport ever delivered an out-of-order `deleted` push for a surface that a later, legitimately newer
  snapshot had already superseded, the newer content would be destroyed. This is explicitly the plan's own
  design ("an eviction can carry a revision equal to the one held") and is not a batch-11 deviation, but it
  is worth naming as a residual assumption: correctness depends on push ordering being preserved by the
  transport. Not flaged as an issue since it is plan-mandated and out of this batch's control.
- `viewBreach`/`changeBreach` (`apps-surface-intake.ts:83-122`) check shape only, not semantic bounds
  beyond `SURFACE_LIMITS` (id length, op count). A `snapshot` push with `state.content` an empty object
  passes the guard (`isRecord({})` is true) and is only rejected later by `acceptSurfaceView` — correct
  per the documented two-stage design (structural guard, then content validation), not a defect.

### 4. What happens when a dependency fails?

- `acceptSurfaceView` wraps the whole-document validation call in `try/catch` specifically to fail closed
  against a throwing getter from an "exotic in-process value" (`apps-surface-intake.ts:261-271`), verified
  by the "never throws on a throwing getter" spec (`apps-surface-intake.spec.ts:307-319`) — an unusual and
  well-targeted defensive measure given the contract validators are documented to never throw on their own
  (`surface.validator.ts:655`, cited in the plan).
- `applySurfaceOps` failure (`applied.ok === false`) returns `ops-failed` + `needsRead`
  (`apps-surface-reducer.ts:258-261`) with a fixed-string warning; no payload logged. Correctly fails
  closed and asks for recovery rather than silently keeping stale content.
- A malformed `surface:read` result (`guardSurfaceReadResult` returns `null`) leaves the whole state
  untouched (`applySurfaceRead` returns `outcome: 'malformed'`), which is safe but means a
  partially-good, partially-malformed read is thrown away entirely — intentional per the guard's own
  comment ("one unusable view rejects the whole result").

### 5. What is missing that the requirements never mentioned?

- No requirement specifies what happens if two evictions race the notice slot (see Q1). A queue or list of
  pending notices was never asked for, but the single-slot design silently drops information a user might
  reasonably need.
- No requirement specifies `lastSubmit` field validation at this layer (correctly deferred, per the
  executor's own note, to Batch 15).
- `trimToBound` (`apps-surface-reducer.ts:358-373`) is only invoked from `applySurfaceRead`, never from
  `applySnapshot`'s overflow path. That is consistent with the plan ("the host pushes the eviction delete
  after this commit push, so the overflow is transient; a read settles it either way") and is spec-pinned
  ("accepts a 9th surface and asks for a read" — `apps-surface-reducer.spec.ts:415-432`), so this is not a
  gap, just worth confirming was intentional.

## Failure modes

### Eviction notice overwritten by a second eviction

- Trigger: two `deleted` pushes with `reason: 'evicted'` for different surfaces, applied before the UI
  consumes/clears the first notice.
- Symptom: the user sees only the second surface's "This app was removed to free memory" notice; the
  first eviction is never surfaced.
- Evidence: `apps-surface-reducer.ts:299-302`, `AppsSurfaceState.notice` type at `:58` (single nullable
  slot, not per-surface or a list).
- Current handling: unconditional overwrite.
- Recommendation: either keep a small bounded list/queue of pending eviction notices, or accept this as a
  known UX simplification and document it — currently undocumented.

### Settled overlay outlives a permanently unreachable surface

- Trigger: an operation settles (`ackRevision`) while `materializedRevision` is behind, and no further
  push or read for that surface ever arrives (e.g., a dead connection Batch 12's sync never recovers from).
- Symptom: the optimistic overlay value is shown indefinitely instead of retiring.
- Evidence: `apps-surface-reducer.ts:404-412`, `:462-463` (retirement only happens on a future push/read).
- Current handling: none within this batch; relies on Batch 12's `AppsSurfaceSync` grace-timer/retry to
  eventually deliver a qualifying read.
- Recommendation: no change needed in this batch; flag for Batch 12/13 review to confirm the grace-timer
  retry actually guarantees eventual delivery or surfaces a "could not refresh" notice, since this batch's
  correctness depends on that guarantee holding.

### `lastSubmit` passed through unvalidated

- Trigger: any host push or read whose `content.lastSubmit` is a well-formed object but has malformed or
  unexpected field values.
- Symptom: the renderer receives an unvalidated `SurfaceSubmitRecord`; no immediate crash risk is evident
  in this batch, but no bound is enforced either.
- Evidence: `apps-surface-intake.ts:236-238`.
- Current handling: `isRecord` check only; explicitly deferred by the executor to Batch 15.
- Recommendation: none for this batch; confirm Batch 15 actually adds the validator before this ships to
  users, since the plan's own quality bar ("content is not trusted") is only partially met for this one
  field today.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: single-slot eviction notice can silently drop information on a second eviction
  (`apps-surface-reducer.ts:299-302`) — see Failure modes.
- Moderate: `lastSubmit` passed through with only an `isRecord` check, no field validation
  (`apps-surface-intake.ts:236-238`) — acknowledged and deferred, tracked here for follow-up
  verification at Batch 15.
- Minor: the executor's report cites the case-4 stale-read justification as if quoted from `handoff-494.md`
  ("reconciliation case 4"); the actual verbatim sentence ("The same holds for a stale `surface:read`
  answer") lives in `implementation-plan.md:626`, not the handoff. The underlying reasoning is correct and
  verified independently (Deviation 2 above); only the citation's source document is imprecise.

## Data flow

1. Raw WS payload → `guardSurfacePush` / `guardSurfaceReadResult` (`apps-surface-intake.ts`): structural,
   zod-free, fails closed to `null`, logs field name only. OK.
2. `applySurfacePush` dispatches by `change.kind` to `applySnapshot` / `applyOps` / `applyDelete`
   (`apps-surface-reducer.ts:319-334`). OK — exhaustive switch, TypeScript enforces coverage.
3. `applySnapshot`/`applyOps` call `acceptSurfaceView` (whole-document zod validation, fail-closed) before
   ever writing `materializedRevision`; the write and the renderable change atomically in the same `Map`
   entry replace. OK — no window where revision and content disagree.
4. `applyOps` re-derives `selection`/`lastSubmit` from `applySurfaceOps`'s output before re-validating
   the whole document, so a selection invalidated by the same op batch is caught by the same
   `acceptSelection` fail-closed path used for pushes and reads. OK.
5. `applySurfaceRead` merges `found`/`not-found` results against `readSeq`, correctly distinguishing
   entries known at send time (`lastAppliedSeq <= readSeq`, removable if absent) from entries changed
   after send (survive). OK, verified by dedicated spec.
6. `updateSurfaceOverlays` is the sole overlay write path outside the reducer's own read/push
   housekeeping, and always re-runs `retireSettledUpTo(materializedRevision)` after the caller's mutation,
   so Rule 1 (ack never materializes) cannot be violated by a future caller forgetting to re-retire. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------------------------ | --------------- |
| Pure, never throws | COMPLETE | `acceptSurfaceView` explicitly catches exotic throws; spec-pinned |
| Zod-free structural guard | COMPLETE | verified field-by-field against `implementation-plan.md:404-413` |
| Whole-document re-validation, fail-closed | COMPLETE | both snapshot and post-ops paths |
| Selection cleared, not surface rejected | COMPLETE | `acceptSelection` |
| `console.warn` without payload values | COMPLETE | all call sites checked, static strings only |
| Rule 2 (only push/read advances revision) | COMPLETE | verified across all three transitions |
| Rule 1 (ack never materialized) | COMPLETE | `updateSurfaceOverlays` never writes revision |
| `applyRead` never lowers revision | COMPLETE | spec-pinned, code-verified |
| Eviction at EQUAL revision terminal + tombstone | COMPLETE | spec-pinned |
| 9th surface → `needsRead` | COMPLETE | spec-pinned |
| System prompt names the three tools, omits selection context | COMPLETE | spec-pinned, real assertions |
| Eviction notice is informative across concurrent evictions | PARTIAL | single-slot notice can drop a second eviction's message |
| `lastSubmit` boundary validation | PARTIAL | deferred to Batch 15, currently shape-only |

Implicit requirements not addressed: a queued/list eviction notice for concurrent evictions; none of the
plan's own text asks for this, so it is a gap in the requirements, not the implementation.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | ----------- | ------- |
| Stale read below materialized revision | YES | ignored, overlays retire only up to current materialized revision | none |
| Read older than an ack'd-but-unmaterialized overlay | YES | overlay survives (`retireSettledUpTo`) | none, spec-pinned |
| Ops on a rejected surface | YES | `needsRead` (deviation 1) | none, improves on plan |
| Two evictions before UI consumes the first notice | NO | second overwrites first | see Moderate finding |
| 9th+ surface via snapshot | YES | `needsRead`, transient overflow | none |
| 9th+ surface via read | YES | `trimToBound` keeps highest revisions | none |
| Malformed read result with one bad view | YES | whole result rejected | none, by design |
| Throwing getter in content | YES | caught, fails closed | none |
| `lastSubmit` malformed fields | NO (shape only) | passthrough after `isRecord` | deferred to Batch 15 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the single-slot eviction notice can silently drop a second, closely-timed eviction's message
  — low likelihood, low severity (informational only), not blocking.
- What a robust implementation would add: a bounded queue for eviction notices instead of one slot; an
  explicit test exercising two evictions in one reduce chain; and, once Batch 15 lands, confirmation that
  `lastSubmit` gets the same field-level validation as every other host value this module trusts.
