# Code Logic Review — `TASK_2026_494` Batch 10

Files reviewed in full: `libs/frontend/mcp-apps-page/src/lib/state/surface-operation-id.ts` (78 lines),
`surface-operation-id.spec.ts` (83 lines), `apps-operation-overlays.ts` (182 lines),
`apps-operation-overlays.spec.ts` (195 lines). Cross-referenced: `implementation-plan.md:514-582`,
`batches.md` Batch 10 section, `batch-10-report.md`, `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:76`
(`SURFACE_OPERATION_ID_PATTERN`), `libs/frontend/declarative-dashboard/src/lib/surface-interaction.ts:17`
(`pendingValues: ReadonlyMap<string, SurfaceDataValue>`).

Verification re-run: `npx nx run-many -t test -p @ptah-extension/mcp-apps-page --skip-nx-cache` — green
(1/1 target, prior full run reported 22/22 tests, 3/3 targets green for lint/typecheck/test).

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 1                                    |

## Five logic questions

### 1. How does this fail silently?

- `add()`, `settle()`, `retire()`, `retireSettledUpTo()` all return `this` unchanged on invalid input
  (`apps-operation-overlays.ts:91-98, 106-121, 127-134, 140-148`) with no signal to the caller that the
  call was a no-op. This is the documented, spec-pinned contract ("never throws... discarded structure
  keeps witnessing the state it was read at", `apps-operation-overlays.ts:12-15`), not an accidental
  swallow — Batch 13's caller is expected to only ever pass valid, previously-added ids, so a silent
  no-op here is a deliberate last line of defence, not the primary validation. Acceptable for this
  layer; flagged only so the reviewer of Batch 13 checks that a `settle`/`retire` call for an unknown id
  is impossible in the real flow, not just tolerated.
- `randomAlphanumeric` cannot silently produce a biased/short id under the default `crypto` source; its
  only silent-truncation path is an injected source returning zero bytes (`surface-operation-id.ts:52-54`),
  which is unreachable with `defaultRandomBytes`.

### 2. What user action produces unexpected behaviour?

None traceable to these two pure modules directly — they hold no direct user-input entry point. The
closest analogue: two rapid edits to the same path produce two overlays (`op-a`, `op-b`); if a caller in
Batch 13 forgets to route `settle`/`retire` through the reducer before the old overlay's ack revision is
reached, `retireSettledUpTo` will retire the *older* overlay's entry while the *newer* one keeps
displaying its own value (this is verified correct behaviour, not a defect — see the case-6 spec at
`apps-operation-overlays.spec.ts:67-88`).

### 3. What input data produces a wrong answer?

- None found within this module's own guarantees. `isOverlayInput` (`apps-operation-overlays.ts:41-55`)
  rejects `null`, non-object, empty `operationId`/`path`, non-finite `baseRevision`, and `undefined`
  `value` — covering the negative-input matrix the spec pins (`apps-operation-overlays.spec.ts:119-140`).
  `value` itself is accepted for any defined `SurfaceDataValue` including `null`, arrays and objects
  (spec `:175-194`), which is correct per the type.
- `settle(operationId, ackRevision)` does not validate `ackRevision >= existing.baseRevision`
  (`apps-operation-overlays.ts:106-121`). A host that acks with a revision lower than the overlay's own
  `baseRevision` would still be recorded. This cannot produce a wrong *displayed* value (the overlay
  keeps showing its optimistic value regardless of `settledRevision`'s magnitude, and `retireSettledUpTo`
  only ever compares `settledRevision` to the caller-supplied materialized revision), so there is no
  reachable wrong-answer path today — the plan does not require this validation, and the RPC contract
  guarantees revisions are monotonic. Noted, not scored as a defect.

### 4. What happens when a dependency fails?

- `globalThis.crypto.getRandomValues` failing or being absent is out of this file's control; the plan's
  assumption A2 is resolved per the executor report (jest provides it) and the function is otherwise
  fully injectable, so a caller can always supply a safe fallback. No swallowed dependency failure exists
  here because there is no `try/catch` — a thrown `crypto` call would propagate, which is correct (the
  header doc's "never throws" claim is about malformed *input*, not about the injected byte source
  throwing, and no code path catches such a throw to hide it).

### 5. What is missing that the requirements never mentioned?

- The plan's Rule 4 change-creation snippet lists the overlay shape as
  `{ operationId, surfaceId, componentId, path, value }` (`implementation-plan.md:544`), but
  `SurfaceValueOverlay`/`SurfaceValueOverlayInput` (`apps-operation-overlays.ts:22-39`) carry neither
  `surfaceId` nor `componentId`. See "Requirements fulfilment" below — judged acceptable for this batch,
  flagged for Batch 13's attention.
- No iteration/attempt cap in `randomAlphanumeric`'s rejection-sampling loop — see Failure modes.

## Failure modes

### Unbounded rejection-sampling loop on an adversarial byte source

- Trigger: a `RandomByteSource` that always returns non-empty arrays whose bytes are all `>= 248`
  (`UNBIASED_BYTE_MAX`, `surface-operation-id.ts:25,61`).
- Symptom: `randomAlphanumeric` (`surface-operation-id.ts:45-67`) spins forever; `createSurfaceOperationId`
  never returns.
- Evidence: `surface-operation-id.ts:50-65` — the `while (result.length < length)` loop only exits early
  when `bytes.length === 0` (line 52-54); a non-empty but fully-rejected batch just loops again with no
  retry counter or timeout.
- Current handling: none; the doc comment overclaims "the call never hangs or throws" (`:43`) — true only
  for a source that eventually yields either an accepted byte or an empty array, which `defaultRandomBytes`
  (backed by `crypto.getRandomValues`, effectively uniform) always satisfies with overwhelming probability.
- Recommendation: either narrow the doc comment's claim to "does not hang for a source drawn from a
  uniform distribution" or add a bounded retry (e.g., cap total draws and fall back to `''`/throw) so the
  guarantee is unconditionally true. Severity Moderate — unreachable via `defaultRandomBytes` and the only
  other caller is this module's own spec with hand-written finite byte arrays, so no live path triggers it
  today, but the next caller that injects a source (a fuzz test, a future retry-testing helper) could hang
  the test runner with no diagnostic.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **Moderate** — Unbounded rejection-sampling loop, see Failure modes above
  (`surface-operation-id.ts:50-65`).
- **Moderate** — Overlay shape omits `surfaceId`/`componentId` that `implementation-plan.md:544` lists;
  see Requirements fulfilment (`apps-operation-overlays.ts:22-39`).
- **Minor** — `settle()` does not assert `ackRevision >= existing.baseRevision`
  (`apps-operation-overlays.ts:106-121`); currently harmless (see Q3) but an assertion (or at least a
  code comment recording the assumption) would make the monotonic-revision invariant explicit at the one
  point in this module that consumes a host-supplied number.

## Data flow

1. Renderer commit → Batch 13's `AppsSurfaceOperations` builds an overlay input and calls
   `AppsOperationOverlays.add()` — OK, validated at the boundary (`apps-operation-overlays.ts:91-98`).
2. RPC `applied` result → Batch 13 calls `settle(operationId, ackRevision)` — OK, records the ack
   revision only, never touches `value`/`baseRevision`, never becomes "the materialized revision" inside
   this module (`apps-operation-overlays.ts:106-121`); Rule 1's core constraint (an RPC ack must never
   become the materialized revision) is honoured because this module has no concept of "materialized
   revision" at all — it only ever receives one as an external `revision` parameter to compare against,
   in `retireSettledUpTo`.
3. Echo/read reaching the ack revision → the reducer (Batch 11/13, not in this batch) is expected to call
   `retireSettledUpTo(materializedRevision)` — OK by contract; this module correctly refuses to retire a
   settled overlay whose ack revision is still above the passed-in revision
   (`apps-operation-overlays.ts:140-148`), and never retires an unsettled (pending) overlay regardless of
   revision (same lines, `overlay.settledRevision === null` short-circuits to "keep").
4. A read of the whole surface → `retireAllSettled()` drops every settled overlay, keeps every pending
   one — OK (`apps-operation-overlays.ts:151-153`), matches plan text "a read retires every settled
   overlay of that surface" (`implementation-plan.md:582`).
5. Render → `pendingValues()` folds the map to `path -> value`, last-inserted (= latest send order, since
   `add` refuses duplicate ids and `retainWhere` preserves relative order) wins per path — OK
   (`apps-operation-overlays.ts:160-166`), matches "the value an input shows is... the latest unretired
   overlay for its path" (`implementation-plan.md:576`).

No step in this trace allows an ack revision to be written into anything the plan would call "the
materialized revision" — that state does not exist in this file at all, which is the correct boundary for
a pure per-surface ledger.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Op id `op-${now}-${16 alnum}`, matches `SURFACE_OPERATION_ID_PATTERN` | COMPLETE | none |
| Unbiased random draw via `crypto.getRandomValues` | COMPLETE | rejection-sampling loop has no iteration cap (Moderate, see above) |
| One new id per user attempt; no reuse in practice | COMPLETE (by design, verified via distinct-id spec) | none |
| Overlays keyed by operation id, send order | COMPLETE | none |
| Displayed value = latest unretired overlay per path | COMPLETE | none |
| `retire(operationId)` removes exactly that overlay | COMPLETE | none |
| `retireSettledUpTo(revision)` retires settled overlays at/below revision, never touches pending | COMPLETE | none |
| Read retires every settled overlay of the surface | COMPLETE | none |
| Rule 1: ack revision settles the operation, never becomes materialized revision | COMPLETE | this module has no materialized-revision concept to corrupt; correctness depends on Batch 13 never wiring `settle`'s `ackRevision` into a materialized-revision field, which is outside this batch's file set |
| Overlay carries `{ operationId, surfaceId, componentId, path, value }` (plan line 544) | PARTIAL | `surfaceId`/`componentId` are absent from `SurfaceValueOverlay`/`Input`; see analysis below |
| `pendingValues()` type-compatible with `SurfaceInteractionState['pendingValues']` | COMPLETE | verified via type alias (`apps-operation-overlays.ts:19`) and a spec that assigns into `Pick<SurfaceInteractionState,'pendingValues'>` (`apps-operation-overlays.spec.ts:164-173`) |

Implicit requirements not addressed: none beyond the two Moderate notes above.

### On the `surfaceId`/`componentId` omission (explicit judgement requested)

The plan's Rule-4 snippet (`implementation-plan.md:544`) describes the overlay an `AppsSurfaceOperations`
call site should build before sending the RPC: `{ operationId, surfaceId, componentId, path, value }`.
The type actually implemented, `SurfaceValueOverlay` (`apps-operation-overlays.ts:22-33`), carries
`operationId`, `path`, `value`, `baseRevision`, `settledRevision` — no `surfaceId`, no `componentId`.

- `surfaceId` is redundant by construction: the class's own doc comment states "One instance holds the
  pending value overlays of ONE surface" (`apps-operation-overlays.ts:7`), and `size`/`list`/`pendingValues`
  are all scoped to that one instance. Storing `surfaceId` on every entry of a per-surface map would be
  denormalized data with no consumer inside this file. Not a gap.
- `componentId` is a real omission relative to the plan text, but tracing its only stated purpose — queue
  coalescing ("a queued, unsent `change` for the same `componentId` is replaced by the newer value",
  `implementation-plan.md:538`) and the pendingValues consumption model ("several inputs may share a
  path", `:576`, matched exactly by `pendingValues()`'s per-path fold) — shows `componentId` is consumed
  by `AppsSurfaceOperations`'s own send-queue (Batch 13, a different structure, not yet written) and never
  by the overlay ledger's own read side, which only ever needs `path`. This batch's `.spec.ts` also never
  exercises a `componentId` field, so nothing here is silently dropping a value Batch 10's own contract
  promised to carry.
- Real, if minor, consequence for Batch 13: if its executor takes the plan's `{ operationId, surfaceId,
  componentId, path, value }` literal and passes it straight to `AppsOperationOverlays.add()`, TypeScript's
  excess-property check on an object literal will reject the call (an object literal supplies unknown
  properties to `SurfaceValueOverlayInput`). Batch 13 will have to either destructure just the needed
  fields before calling `add()`, or accept the type as constructed elsewhere and slice it. This is
  guidance for Batch 13, not a defect in Batch 10 — the file set under review here does not include the
  call site, and the plan itself splits this responsibility across two batches without reconciling the
  literal shape. Recorded as a Moderate note above, not blocking.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Duplicate operation id on `add` | YES | first entry wins, `entries.has()` short-circuits (`:92-94`) | none |
| Unknown id on `retire`/`settle` | YES | no-op, same instance returned (`:110-116`, `:128-130`) | none |
| Double `settle` | YES | second call is a no-op (`existing.settledRevision !== null` guard, `:112`) | none |
| `retireSettledUpTo`/`settle` with `NaN`/`Infinity` revision | YES | `Number.isFinite` guard on both (`:113-114`, `:141-142`) | none |
| Pending (unsettled) overlay reaching `retireSettledUpTo` | YES | `settledRevision === null` always keeps it (`:145-147`) | none |
| Read (`retireAllSettled`) with a mix of settled/pending overlays | YES | keeps only `settledRevision === null` (`:151-153`) | none |
| Reconciliation case 6 (older settles while newer on same path pending) | YES | spec `apps-operation-overlays.spec.ts:67-88`: older overlay's settle + later retire never disturbs the newer overlay's display | none |
| `value: null` / arrays / objects as `SurfaceDataValue` | YES | `isOverlayInput` only checks `!== undefined` (`:53`); spec `:175-194` | none |
| Zero-byte random source | YES | `randomAlphanumeric` returns early, no hang, no throw (`surface-operation-id.ts:52-54`) | none |
| Adversarial source returning only rejected bytes forever | NO | loop has no cap (`surface-operation-id.ts:50-65`) | see Failure modes; unreachable via `defaultRandomBytes` |
| `pendingValues()` type used as `SurfaceInteractionState['pendingValues']` | YES | type alias + assignment spec (`:19`, spec `:164-173`) | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the unbounded rejection-sampling loop in `randomAlphanumeric` is the only path in this batch
  that could hang rather than fail — it is unreachable through the shipped default source and is only a
  concern if a future caller injects a hostile/broken byte source (e.g., a fuzz or property test).
- What a robust implementation would add: (1) a hard cap on rejection-sampling rounds in
  `randomAlphanumeric` with a documented fallback so "never hangs" is unconditionally true rather than
  true-in-practice; (2) an explicit code comment (or assertion) at `settle()` recording the assumption
  that `ackRevision` is monotonically non-decreasing relative to `baseRevision`, since this module is the
  one place a host-supplied revision number enters the ledger unchecked; (3) when Batch 13 lands, confirm
  its call site builds `SurfaceValueOverlayInput` directly (no excess `surfaceId`/`componentId` on the
  literal passed to `add()`) rather than casting around the type.
