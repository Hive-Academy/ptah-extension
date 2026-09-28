# Code-logic review, Batch 11 (GLM) — intake, reducer, system prompt

Reviewer: code-logic-reviewer (read-only). Date: 2026-09-25.
Worktree: `feat-task-494-apps-page-98c5a1802772`.

**Score: 9 / 10. Verdict: APPROVED.**

No behavioural defect was found in the revision state machine. Every hunted
question (Section 3) passes. The findings in Section 5 are low-severity edges
and one small robustness gap in the guard. The five deviations are all ACCEPT
(Section 4), with reasoning. The specs pin reconciliation cases 1-5 with real,
observable assertions.

## 1. Scope and method

Files under review (all new):

- `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.ts` (+ spec)
- `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.ts` (+ spec)
- `libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts` (+ spec)

Committed dependency (context): `apps-operation-overlays.ts`.

Method: line-by-line read of the three modules and both specs against
implementation-plan.md:404-453, 482-494, 236-244, 504-505, 571-582;
handoff-494.md (a) item 2 and (c); batches.md Task 11.1. Contract spot-checks:
`applySurfaceOps` (libs/shared/src/mcp-apps-contracts/surface-patch.ts:258-321,
including its own fail-closed catch at :317-321) and
`SURFACE_LIMITS` / `SURFACE_STORE_LIMITS` (surface-catalog.ts:84-133,
`maxSurfacesPerRoutingId` = 8, `maxPatchOps` = 100).

Test run (worktree root):

```
npx nx run-many -t test -p @ptah-extension/mcp-apps-page --skip-nx-cache
Test Suites: 5 passed, 5 total
Tests:       97 passed, 97 total
```

This matches the executor report (batch-11-report.md:160).

## 2. Report accuracy

Every claim in batch-11-report.md that I could check against source holds:

- Rule 1/Rule 2 write sites: `materializedRevision` is written only in
  `applySnapshot` (apps-surface-reducer.ts:197-199), `applyOps`
  (apps-surface-reducer.ts:273-279) and `newEntry`
  (apps-surface-reducer.ts:346-347, reached only from `applySurfaceRead`).
  `updateSurfaceOverlays` never writes it (apps-surface-reducer.ts:455-469).
- `applySurfaceOps` really is fail-closed on any input, including exotic
  objects (surface-patch.ts:317-321), so the reducer's unvalidated op records
  (the guard checks only that each op is a record, apps-surface-intake.ts:113)
  cannot make it throw.
- Warnings name only fields, fixed phrases or `error.name`
  (apps-surface-intake.ts:74-77, 226, 230, 252, 264-266).

## 3. Hunted questions — rulings

**Can a revision ever be lowered? No.**
`applySnapshot` refuses `revision <= materializedRevision` as stale
(apps-surface-reducer.ts:182-183); `applyOps` refuses `revision <= materialized`
(apps-surface-reducer.ts:241) and then writes a strictly higher one
(:276); `applySurfaceRead` replaces a held entry only when
`view.revision > existing.materializedRevision` (:403) and otherwise leaves the
revision alone (:406-411); `newEntry` is called only under those same guards
(:404, :418). Deletes remove the entry and record
`max(revision, materializedRevision, previous tombstone)` (:294-298), which
never lowers a tombstone. Pinned by spec: "never lowers a materialized
revision" (apps-surface-reducer.spec.ts:454-464) and case 4 (:591-607).

**Can an RPC ack revision become the materialized revision? No.**
The reducer exposes no path by which an RPC result reaches a revision field.
The only overlay write path is `updateSurfaceOverlays`
(apps-surface-reducer.ts:455-469), which replaces `overlays` and then retires
settled overlays at or below the CURRENT materialized revision (:462-464). It
never reads or writes `materializedRevision`. Pinned by case 1
(spec:540-555): after `settle(OP, 5)` the materialized revision stays 4 and the
overlay still displays.

**Can out-of-order or stale reads corrupt state? No.**
A read view at or below the materialized revision is ignored (:403-411). An
absent entry is removed only when `lastAppliedSeq <= readSeq` (:421-422), so an
entry pushed after the read was sent always survives. I checked the late-stale-
read case: read1 sent at seq 5, an entry applied at seq 6, a newer read applied,
then read1's result arrives late — the entry has `lastAppliedSeq` 6 > 5, so
read1 cannot remove it. Sequential host revisions (an accepted commit is
always `current + 1`, handoff-494.md:178) mean a stale read can never push the
materialized revision into a state that blocks a later echo as a gap: the echo
carries `fromRevision` equal to the read's revision in the worst case.
`updateSurfaceOverlays` does not bump `seq`, which is correct: overlay updates
are not pushes.

**Are fromRevision gaps detected? Yes.**
`fromRevision !== existing.materializedRevision` → outcome `gap`, `needsRead`
(apps-surface-reducer.ts:242-243), for both `fromRevision` above and below the
materialized revision. Ops for an unknown id above any tombstone return
`unknown-surface` + `needsRead` (:236-239); at or below the tombstone they are
`tombstoned` (:236-238). Pinned by spec:275-282 (gap) and spec:339-357.

**Is eviction at an equal revision terminal with a tombstone, and does a later
higher snapshot recreate? Yes.**
`applyDelete` is applied whatever its revision and records the tombstone at
`max(revision, held materializedRevision, previous)`
(apps-surface-reducer.ts:283-313). A snapshot for a tombstoned id at or below
the tombstone is refused (:184-190); above it, the entry is created and the
tombstone deleted (:192-209). A read view at or below the tombstone cannot
revive it (:415-416). Pinned by spec:361-398, including the late-push
tombstone assertions and the recreate.

**Is the 9-surface cap handled with needsRead? Yes.**
A snapshot past `maxSurfacesPerRoutingId` (8) is applied and returns
`needsRead` (apps-surface-reducer.ts:223-224); the host's eviction delete then
settles it (spec:415-432). `applySurfaceRead` enforces the bound itself with
`trimToBound`, keeping the highest revisions and tombstoning the rest
(:357-373, :431). Pinned by spec:415-432 and spec:434-450.

**Does whole-document re-validation fail closed? Yes.**
`applyOps` always re-runs `acceptSurfaceView` on the post-ops document
(apps-surface-reducer.ts:262-270); a rejection becomes the `rejected` renderable
(text fallback) while the revision advances. This matches the plan's snapshot
rule and its cost bar ("one whole-document validation per applied push",
plan:480). `acceptSurfaceView` validates the whole v2 document (structure plus
data model) or the v1 spec, and catches everything
(apps-surface-intake.ts:246-272). Pinned by spec:302-313 and intake spec
:261-320.

**Does a checkSurfaceSelection failure clear only the selection? Yes.**
`acceptSelection` returns null on either failure; the surface stays `accepted`
(apps-surface-intake.ts:217-234). Pinned by intake spec:375-411 (both malformed
and unresolvable selections).

**Does any console.warn leak payload values? No.**
All warn sites log a field name, a fixed phrase, or `error.name`
(apps-surface-intake.ts:74-77, 225, 229, 252, 264-266;
apps-surface-reducer.ts:259). The specs plant `SECRET` in the rejected values
and assert no warn argument contains it (intake spec:114-118, used by 17
reject cases, plus :307-319). Residual note: `error.name` is attacker-named in
principle; over the wire this is unreachable (deserialized data has no crafted
Error instances), so I record it under F1, not as a defect.

**Can anything throw? One gap (F1).**
`applySurfaceOps` catches everything itself (surface-patch.ts:317-321);
`acceptSurfaceView` catches everything (intake.ts:261-272); `countJsonBytes`'s
`JSON.stringify` can throw on a circular value but runs inside that try. The
Map/sort logic in the reducer is safe. The gap is the two guards, which access
raw properties without a net — see F1.

## 4. Per-deviation rulings

**Deviation 1 — ops on a rejected surface triggers a read. ACCEPT.**
The plan says discard (plan:434). The executor's reasoning is correct: this page
rejected the document at revision N, but the HOST validated and committed the
ops onto its own copy, so the post-ops document at N+1 can be valid. The
"re-reading returns the same document" argument (plan:428) holds for a snapshot
of the same revision, not for ops that change the document. Discarding would
leave the surface on the text fallback until a full agent replace — no recovery
path. The read is bounded: one per ops push, and `applySurfaceRead` never
returns `needsRead` (apps-surface-reducer.ts:437-446), so no loop. Rule 2 is
untouched. Evidence: apps-surface-reducer.ts:244-248; pinned by
spec:339-357.

**Deviation 2 — a read calls `retireSettledUpTo(readRevision)`, not
`retireAllSettled`. ACCEPT. No settled overlay can get stuck forever.**
The plan contradicts itself: line 550 says the overlay stays "until the echo or
a read reaches `revision >= result.revision`, then retires", while line 582
says a read retires every settled overlay. The executor implements the precise
line-550 rule. The two differ only for a read that is STALE relative to an
acknowledged commit (case 4). `retireAllSettled` there would retire an overlay
whose value is not yet in the materialized state — the display would revert to
the older host value until the echo arrives, losing the user's committed value
from view. That is a real display regression; the executor's choice avoids it.

Stuck-forever analysis, per retirement route:
1. The echo push applies → `retireSettledUpTo(revision)` at
   apps-surface-reducer.ts:278 retires it (case 1, spec:540-555).
2. Any newer snapshot replaces the entry and retires up to the new revision
   (:202-205).
3. Any read whose view is above the materialized revision goes through
   `newEntry`, which retires up to `view.revision` (:341-344) (case 5,
   spec:623-637).
4. A surface delete drops the entry and its overlays with it (:292-293); a
   recreate starts from `AppsOperationOverlays.empty()` (:202-204).

The host committed at the ack revision, so the host high-water revision is at
or above it. A lost echo is recovered by Rule 3's grace read (Batch 12,
plan:461-464), and that read's view must be above the materialized revision,
retiring the overlay through route 3. The only way a settled overlay persists
is a lost echo AND no read ever firing — and in that state the overlay's value
equals the host's committed value, so the display is correct, not corrupt.
Stale-read retention is pinned by spec:609-621. ACCEPT.

**Deviation 3 — readSeq semantics. ACCEPT.**
`surfaceReadSeq(state)` returns `state.seq` at send time
(apps-surface-reducer.ts:107-114); the removal condition
`lastAppliedSeq <= readSeq` (:422) removes exactly the entries nothing was
applied to after the send. The plan's literal `<` (plan:452) pairs with a
different definition of `readSeq` (the seq the read application would claim);
the executor's pair (send-seq, `<=`) is coherent, is documented at both
:107-111 and :375-385, and behaves correctly on the edges I traced (Section 3,
third question). Pinned by spec:480-496.

**Deviation 4 — the additions. ACCEPT, all four.**
- `guardSurfaceReadResult`: justified and necessary. A read result crosses the
  same boundary as a push, and the reducer's absent-means-removed semantics
  (apps-surface-reducer.ts:421-429) force whole-result rejection: silently
  skipping one unusable view would delete a surface the host still holds. The
  code comments say this (apps-surface-intake.ts:148-152). Pinned by intake
  spec:238-249.
- `updateSurfaceOverlays`: the single write path to an entry's overlays. It
  enforces Rule 1 by construction (never touches the revision) and gives case 2
  its immediate retirement (echo applied, then settle → retire at once,
  :462-464). Pinned by spec:557-570 and :649-656.
- `APPS_TOMBSTONE_LIMIT` = 64 with FIFO eviction (apps-surface-reducer.ts:89-93,
  :124-139): tombstones only need to outlive pushes still in flight for a
  deleted id, so evicting the oldest after 64 is safe and bounds a long-lived
  root service. ACCEPT.
- `AppsSurfaceNotice`: the plan itself requires the eviction notice text
  (plan:442). ACCEPT.

**Deviation 5 (brief) / executor deviation 6 — a read keeps the view state of
an already-held surface. ACCEPT.**
The plan reserves the view-state reset for the snapshot transition, "reset from
the pushed state, never by assumption" (plan:430); a read is recovery (gap,
lost echo, hydration), not an agent replace, so keeping sort, page and drafts is
the user-preserving reading. The risky case — a read that replaces a held
entry which is actually a NEW incarnation after a lost delete push — keeps
drafts keyed against old component ids; drafts are local presentation values the
renderer tolerates for unknown ids, and the next agent snapshot resets them. A
surface first seen through a read starts empty
(apps-surface-reducer.ts:336-354). Pinned by spec:466-478.

**Executor deviation 5 (bonus, not in the brief's list) — tombstone value is
`max(delete revision, held materializedRevision, previous tombstone)`. ACCEPT.**
For the documented cases the value equals the plan's bare `revision`
(handoff-494.md:240-245: an eviction carries the store high-water revision; an
agent delete carries `current + 1`; a recreate starts above every issued
revision). The max additionally makes a reordered delete below the held
revision terminal up to what the page actually saw, which is strictly safer
and cannot block a legitimate recreate. Evidence: apps-surface-reducer.ts:294-298.

## 5. Findings

**F1 (low, should fix) — the guards can throw on a hostile in-process object.**
`guardSurfacePush` (apps-surface-intake.ts:128-146) and
`guardSurfaceReadResult` (:153-170) read raw properties
(`raw['routingId']`, `raw['change']`, `change['kind']`, ...) with no
try/catch, while `acceptSurfaceView` catches the same hazard class and the
batch's own spec pins it (intake spec:307-319, throwing getter). The batch
quality bar says the guard never throws (batches.md:442). A payload that
arrives over the wire is deserialized data, so no getter can survive — this is
not reachable from a host push. But the executor accepted the in-process
exotic value as a threat for content, so the envelope deserves the same net.
Failure scenario: an in-process caller passes an object whose `routingId`
getter throws; `applySurfacePush` propagates and the push loop of Batch 12
crashes instead of dropping.
Fix: wrap each guard body in try/catch and `return drop(kind, 'payload')` on
any throw.

**F2 (low, optional) — `fromRevision` may be negative.**
The guard checks `Number.isSafeInteger` only (apps-surface-intake.ts:107-109),
so a negative `fromRevision` passes and lands in the gap branch, spending a
read (apps-surface-reducer.ts:242-243). Harmless — a read is safe — but
inconsistent with `isRevision` (:57-59), which the payload `revision` uses.
Fix: use `isRevision(change['fromRevision'])`.

**F3 (low, optional) — the eviction notice fires even for a surface the page
never held, and one notice slot is shared.**
`applyDelete` sets the notice for `reason: 'evicted'` whether or not
`existing` was defined (apps-surface-reducer.ts:288-302). A reordered eviction
delete for an id whose pushes were all dropped shows "This app was removed to
free memory" for an app the page never displayed. Two evictions in one
overflow overwrite the first notice (single `notice` field, :58). The plan
does not forbid either; flag for the Batch 12/13 UX pass.

**F4 (info) — the read result's `surfaces` array is unbounded.**
No cap analogous to `maxPatchOps` (apps-surface-intake.ts:159-164). A hostile
host can force one large transient validation loop and Map build before
`trimToBound` cuts back to 8. The host store is bounded at 8, so this is
trust-boundary noise only; noting for the record.

**F5 (info) — pending (unsettled) overlays survive an agent snapshot replace,
while drafts are reset.**
`applySnapshot` resets `viewState` but carries `overlays` forward
(apps-surface-reducer.ts:197-207); a pending user value keeps displaying over
the replaced document until its echo or a read retires it. This is coherent
(a sent value may still commit; an unsent draft is stale), but it is a
conscious choice — confirm it at the Batch 13 review, and pin it if agreed.

**F6 (info) — a no-op read still returns `applied` and increments `seq`.**
`applySurfaceRead` bumps `seq` and returns `applied` even when nothing changed
(apps-surface-reducer.ts:393, :437-446). Cosmetic; keeps `seq` monotone and
does not affect correctness.

**F7 (info) — out-of-order reads are safe only under the one-read-in-flight
contract.**
Two overlapping reads with results applied out of order can disagree about
absent-entry removal (the older read's result can remove an entry the newer
read just kept, when `lastAppliedSeq` falls between the two send seqs). The
plan assigns serialization to Batch 12 ("at most one `surface:read` in flight
per slice", plan:455-456). The reducer cannot defend alone; no change needed
here, but Batch 12's spec must pin the single-in-flight rule.

## 6. Do the specs pin reconciliation cases 1-5 for real?

**Yes.** Every case asserts observable outputs, not re-derivations of the
inputs:

- Case 1 (spec:540-555): after the ack, the materialized revision stays 4 AND
  `pendingValues().get('form.name')` still returns 'Grace' (the overlay is
  still displayed); after the echo, revision 5, shown name 'Grace', overlay
  count 0.
- Case 2 (spec:557-570): after the echo the overlay is still pending (size 1);
  after the settle, the renderable object is IDENTICAL (`toBe`) to the
  pre-settle one — direct Rule 1 evidence — and the overlay count is 0.
- Case 3 (spec:572-589): the echo is refused as `gap` with `needsRead`, state
  object unchanged, and the read then replaces the content ('Agent title').
- Case 4, two pins (spec:591-607, :609-621): a newer push then an older
  settle/read never moves the revision back; and a stale read KEEPS a settled
  overlay whose ack revision is above what the read materializes — this is the
  pin for Deviation 2.
- Case 5 (spec:623-637): the read recovers the lost echo, retires the settled
  overlay and shows the committed value.

Minor coverage gap: case 3 does not carry a pending overlay through the
gap→read sequence. "Keeps a pending overlay across a read" (spec:639-647)
covers the read half; the gap half is one assertion away. Non-blocking.

The system-prompt spec is thinner (substring checks, apps-system-prompt.spec.ts)
but the prompt content itself matches plan D4 line for line
(apps-system-prompt.ts:9-27 vs plan:236-244), including the dropped
`[SYSTEM CONTEXT - DASHBOARD SELECTION]` sentence.

## 7. Fix list

1. **F1 (should fix, small):** wrap the bodies of `guardSurfacePush`
   (apps-surface-intake.ts:128-146) and `guardSurfaceReadResult` (:153-170) in
   try/catch; on any throw, `return drop('surface push'|'surface read',
   'payload')`. Add one spec case each with a throwing `routingId` getter.
2. **F2 (optional):** change the `fromRevision` check at
   apps-surface-intake.ts:108 to `isRevision(change['fromRevision'])`, and add
   a negative case to the reject table (intake spec:147-222).
3. **F3 (defer to Batch 12/13 UX):** decide whether an eviction notice for a
   never-held surface should be shown, and whether one notice slot is enough.
4. **F5 (defer to Batch 13 review):** confirm that pending overlays surviving
   an agent snapshot replace is intended; pin it in the spec if so.
5. **F7 (Batch 12 must pin):** the sync spec must assert at most one
   `surface:read` in flight per slice, since reducer correctness for
   out-of-order reads rests on it.

None of these block the batch. The state machine itself is correct as
delivered.

## 8. Verdict

**APPROVED — 9 / 10.** The revision rules (1-4) hold at every write site, the
tombstone and bound logic is terminal and recoverable as specified, all five
deviations improve on the plan with sound reasoning, and the specs pin the
behaviour with real assertions. The one point off is F1: the "never throws"
guarantee is asymmetric between the two intake halves, and the fix is a
two-line try/catch.