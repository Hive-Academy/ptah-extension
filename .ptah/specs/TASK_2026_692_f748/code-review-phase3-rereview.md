# Phase 3 Re-review (logic + style) - TASK_2026_692_f748, commit 2fd53158e

Verdict: APPROVED. Blocking 0, Serious 0, Moderate 0, Minor 1.

Scope: `git show -w 2fd53158e -- libs/`, plus reads of the surrounding code. Heavy checks were not run; the orchestrator reported that all changed specs and six typechecks pass.

## Findings from the Phase 3 reviews

| Finding | Status | Evidence |
| --- | --- | --- |
| Style S1: named shared type | FIXED | `IdleCompactionNotice` is declared with a doc comment at `libs/shared/src/lib/types/execution/stream.ts:288-299`. It reaches the public barrel through `execution/index.ts:5` (`export * from './stream'`) and then `libs/shared/src/index.ts:9`. `CompactionCompleteEvent` uses it. |
| S1: every inline shape replaced | FIXED | The type is used in `conversation-registry.service.ts` (lines 45 and 284), `accumulator-core.service.ts`, `streaming-handler.service.ts` (two places), `compaction-lifecycle.service.ts` (two places), `compaction-marker.component.ts` and the marker spec. A grep for `idleCompaction?: {` over `libs` and `apps` finds only object literals in specs (test values), no type declarations. No inline type remains in the backend either. |
| Style M1: spec pins idle sentence and token line, stable test id | FIXED | The label span carries `data-testid="compaction-marker-label"` (`compaction-marker.component.ts:27-30`). The existing idle test now selects by that id instead of the first `span`. A new test asserts the whole chip text: idle sentence, then `· shrank 12,345 → 3,000 tokens`. It collapses whitespace first, so template line wrapping does not break it. |
| Logic M1: `invalidateMarkerMeasurement` clears the notice | FIXED | `conversation-registry.service.ts:424-430` now sets `idleCompaction: undefined`. Both call sites (`markCompactionStart` at line 196, `setCompactionState` at line 242) are guarded by `r.compactionInFlight`, so re-entrant starts do not clear again and do not rewrite the marker. `writePersisted` goes through JSON, which drops the undefined key; the new spec asserts this on the stored value. |

## New spec

`conversation-registry.service.spec.ts` adds "clears an idle notice when a later compaction starts and fails". It seeds a marker with a notice, calls `markCompactionStart`, then `setCompactionState(inFlight:false)`. It asserts that `idleCompaction` and `boundaryId` are both undefined in the signal, and that `idleCompaction` is undefined in localStorage. This is the failure path the Phase 3 finding described.

## Regression check

- `setCompactionMarkerTokens` and `setCompactionMarkerSummary` keep the notice only when the boundary id matches, so a later boundary cannot inherit it. A successful later compaction replaces the whole marker, so no stale notice survives.
- The `readPersisted` validation of the token count is unchanged.
- The change to the marker type is type-only for the component. The template and input behaviour are unchanged apart from the added attribute.

## Minor

- M-1 (Minor): `compaction-marker.component.spec.ts` (test "always renders the Context compacted title") drops `expect(...).not.toContain('manual')`. The idle test still asserts the no-manual wording, and the removal is harmless because the default chip has no such wording. If the intent was to keep the default path guarded against "manual", restore the line. This is optional.

## Five logic questions (scoped to the diff)

1. Silent failure: none new. The previously stale-notice case is now cleared.
2. Unexpected user action: a compaction started while the notice is showing clears it immediately. That is the intended behaviour (decisions.md row 14).
3. Wrong output from input: a persisted notice with an invalid token count is still rejected by `readPersisted`.
4. Dependency failure: a failed later compaction leaves a marker without a boundary or notice. This is covered by the new spec.
5. Missing: nothing material.
