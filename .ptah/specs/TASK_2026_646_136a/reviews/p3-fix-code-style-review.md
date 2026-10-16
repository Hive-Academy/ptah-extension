# P3 fix code style re-review — `TASK_2026_646_136a`

Scope: Batch 37, commit `8d29af556`, `libs/backend/lane-routing` only. This reviews structure and consistency, not runtime failure modes. The supplied checks passed: lane-routing 18 suites / 385 tests, lint, typecheck, consumer typechecks, three host container smokes, DI lint, and degradation audit (296, no FAIL). Scoped `ptah_get_diagnostics` reports zero errors. I did not run Nx, Jest, or a build.

## Summary

| Metric | Result |
| --- | --- |
| Score | **6/10** |
| Verdict | **NEEDS_REVISION** |
| Blocking / Serious / Moderate / Minor in this fix scope | **0 / 1 / 0 / 0** |

The fix removes the ranking, rotation, matrix, classifier, and test-seam exports that made the original barrel a 190-line implementation catalog (`src/index.ts:10-72`). The remaining issue is narrower, but the public contract still includes internal probe and persistence details. That keeps the score below the sound 7–8 band; the clean split, local dependency direction, and passing checks keep it above the 3–4 band.

## Findings status

| Original finding / fix area | Status | Evidence and impact |
| --- | --- | --- |
| Serious 1 — public barrel | **PARTIAL (Serious)** | All names imported from `@ptah-extension/lane-routing` outside this lib remain exported, including the DI pair, service, route args/result, decision-model settings/status, and structured port (`src/index.ts:10-72`). The remaining exports at `src/index.ts:20-29,32-33,38` include the unsupported-mark storage key and schema, probe timeout/recheck constants, probe result types, and control path. `src/lib/decision-model/decision-model.types.ts:59-91` identifies these as probe and persisted-mark internals; no external import uses them. Publishing them creates compatibility obligations for storage and probe refactors. **Fix:** trim those names from the barrel; keep their local module exports for internal use. Keep the service, ports, schemas and DTO types that form the agreed host contract. |
| FE-12a — config file split | **CLOSED** | `src/lib/decision-model/decision-model.config.ts:8-18,89-120,490-538` retains state, fetch and budget ownership; `src/lib/decision-model/decision-model.probe.ts:23-29,31-87,95-229` owns pure answer classification and URL helpers. The config is 634 lines, below the 700-line new-code guideline. |
| New deadline helpers | **ACCEPTED** | `src/lib/pipeline/model-call.ts:259-302` and `src/lib/failure-class/decision-model-failure-classifier.ts:416-456` have matching race mechanics, but only two current uses. The repository's simplicity rule defers a shared abstraction until a third use establishes the shared shape. Call-specific budgets and late-rejection logging remain at their call sites (`model-call.ts:107-125`; `decision-model-failure-classifier.ts:175-185`). |
| Rotation lock | **ACCEPTED** | `src/lib/ranking/rotation.store.ts:147-149,189-231` keeps serialization and merge inside the store that owns persistence. The small `enqueue` method has one responsibility and does not widen the public API. |
| Original Moderate 1 and Minor 1 | **DEFERRED BY SCOPE** | Positional pipeline APIs and `openSystemOne` are assigned to LT-P3-2 / LT-P3-3 under decision #93. They are not rescored here. |

## New issues

None in the new probe file, deadline code, or rotation lock beyond the residual barrel finding above. The two deadline implementations are a maintenance watch point: if a third call needs the same race semantics, extract the common primitive then.

## Five style questions

| Question | Answer |
| --- | --- |
| What breaks when requirements change in six months? | Changing probe timing or the unsupported-mark storage format could look like a public API change while `src/index.ts:20-29,32-33,38` exports those internals. |
| What would a new team member misread? | The barrel suggests `DecisionModelUnsupportedMarkSchema` is a supported host contract, although its definition describes persisted internal state (`decision-model.types.ts:71-91`). |
| What extra maintenance does this shape cost? | The unused exports require compatibility review when probe and storage details change; the narrower barrel would not. |
| Where does it differ from sibling patterns? | The prior comparison's adjacent `lane-outcomes/src/index.ts:1-63` exposes a smaller domain surface; this barrel still includes private state machinery (`src/index.ts:20-29`). |
| What would I do differently, and why? | Keep only observed host contracts in `src/index.ts`, while retaining local exports for the config and probe. This leaves internal refactors local without altering current consumers. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the barrel fix as partial | Close because the large helper blocks are gone / keep open for unused probe and storage exports | `src/index.ts:20-29,32-33,38`; external imports use none of those names; `decision-model.types.ts:59-91` defines their internal role | Yes |
| Keep the two deadline races local for now | Extract one shared helper / retain two call-local functions | `model-call.ts:259-302`; `decision-model-failure-classifier.ts:416-456`; two uses and the repository's third-use simplicity rule | Yes |
| Accept the store-local queue | Add a lock utility / retain `enqueue` in `RotationStore` | `rotation.store.ts:147-149,189-231`; only this store coordinates its writes | Yes |
