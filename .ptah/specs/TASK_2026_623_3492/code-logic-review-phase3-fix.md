# Phase 3 fix re-review — Batch 15F

**Score: 8/10**  
**Verdict: APPROVED**

## Serious #1 status: CLOSED

The renderer now rejects malformed successful override output before any node is handed to a template. `hasRenderableAtomFields()` requires an avatar's nonblank string name and string-or-absent subtitle, and requires each present stat trend and spark to satisfy the shared closed predicates (`libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts:137-145`). `attemptBuild()` evaluates the whole result inside its catch-all boundary, returning `null` for a malformed result, throwing getter/proxy, or malformed descendant (`surface-renderer.component.ts:182-198`). The effect emits `renderFailed` only when that per-renderable computed attempt is null (`surface-renderer.component.ts:302-305,352-355`), so no component subtree is rendered and a stable failed input is not repeatedly signalled.

The shared predicates retain the default mapper's previous constraints: closed direction/polarity sets, finite non-negative amount, boolean `percent`, finite bounded spark arrays, nonblank avatar name, and string-or-absent subtitle (`libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts:186-212`). The mapper still throws exactly `Invalid surface stat trend.`, `Invalid surface stat spark.`, `Invalid surface avatar name.`, and `Invalid surface avatar subtitle.` through its original checks (`surface-view-model.ts:214-244`); the diff only delegates their predicates. No rendering/polarity code changed, so decision #51's `bad` polarity behaviour is unchanged.

The new override tests cover rich-text and blank avatar fields; invalid trend direction/polarity, NaN/negative amount, nonboolean percent, and nonobject trend; and NaN/Infinity, below-minimum, above-maximum, and nonarray sparks (`surface-renderer.component.spec.ts:201-223`). They assert empty renderer content and one failure after a repeat detection. The valid-avatar/valid-stat positive control renders both atom kinds and reports no failure (`surface-renderer.component.spec.ts:225-235`). These are real regressions: at `5bfbb8b00`, `isRenderableNode()` did not inspect any avatar or stat atom field, so these successful override results passed its known-kind/id/selectable test and were rendered (baseline `surface-renderer.component.ts`, shown by `git show 5bfbb8b00`, `isRenderableNode`).

## New findings

None. No TODO, PLACEHOLDER, or STUB marker exists in the three scoped files. The new helper functions are not added to a package barrel; their exports remain module-local imports used only by the renderer (`surface-renderer.component.ts:25-32`; `surface-view-model.ts:187-211`).

## Five logic questions

1. **Silent failure:** Closed. A malformed successful override now becomes `null`, produces no DOM subtree, and emits `renderFailed` (`surface-renderer.component.ts:182-198,352-355`) rather than looking like a successful render.
2. **Unexpected user action:** No new action-path defect found. The successful override positive control still types, flushes its draft, and invokes submit (`surface-renderer.component.spec.ts:181-189`).
3. **Wrong-answer input:** The malformed `/4` inputs enumerated above fail closed via the shared predicates (`surface-renderer.component.ts:141-145`; `surface-view-model.ts:186-212`).
4. **Dependency failure/shape:** A builder throw and getter/proxy failure are caught by the `try/catch`; a failed or malformed result follows the same `renderFailed` path (`surface-renderer.component.ts:182-198`).
5. **Requirement gap:** No new unaddressed requirement gap in this fix scope. Direct tests do not construct hostile getters/proxies, but the existing whole-attempt catch is the repository's stated handling for them and covers property/array operations in the guard.

## Verification and confidence

The required focused Jest invocation passed: 3 suites, 93 tests (`surface-renderer.component.spec.ts` and `view-model` scope). `ptah_get_diagnostics` did not return scoped diagnostics because its compiler run remained unavailable after 45 seconds; no source mutation was made to compensate. This is an 8 rather than a 9–10 because that diagnostic service was unavailable and the hostile getter/proxy guarantee is reasoned from the existing catch boundary rather than directly exercised. It is above 7 because the actual defect cases, failure-once behaviour, baseline regression condition, and positive control are all covered and passed.
