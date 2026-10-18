# Phase 3 re-review — TASK_2026_684_a11d

Commit: `249d625a1d1877a6f09f35c14af6260a4b149ffe` · Round 1 of 2 · Reviewer family: codex · Implementer family: claude

| Prior defect | Status | Evidence |
| --- | --- | --- |
| L1 — key write persists then rejects | **FIXED** | The writer snapshots before either kind of key write (`libs/backend/rpc-handlers/src/lib/handlers/decision-model-writer.ts:143-148`), restores on a rejected write (`:217-230,262-281`), and returns the slot-specific uncertainty message if restoration rejects (`:270-280`). Mutating store, key-only, delete, and failed-restore cases are covered in `agent-rpc.handlers.decision-endpoint.spec.ts:573-651`; both key slots are exercised in `agent-rpc.handlers.decision-model.spec.ts:805-825,991-1010`. |
| L2 — one caller's deadline aborts another's shared lookup | **FIXED** | A shared lookup owns its own controller (`libs/backend/lane-routing/src/lib/decision-model/decision-model.catalog.ts:294-307`). Callers join separately, and the request aborts only after every joined signal has aborted (`:511-526`); each caller races its own deadline (`:243-253`). The staggered caller case is covered in `decision-model.catalog.spec.ts:563-597`. |
| L3 — unbounded host listing/body work | **PARTIAL** | The code limits JSON parsing to 1,048,576 UTF-16 code units and classifies at most 256 tags (`libs/backend/lane-routing/src/lib/decision-model/ollama-catalog.schema.ts:15-26`; `decision-model.catalog.ts:412-424,458-470`). However, `response.text()` consumes the entire response **before** the length check at `decision-model.catalog.ts:458-459`, so an arbitrarily large or never-ending body can still consume memory/time. The check also counts code units rather than bytes, so it does not enforce a 1 MiB transfer cap. The new test supplies an already materialized string (`decision-model.catalog.spec.ts:600-624`) and cannot catch this. Read the response stream with a byte counter, stop and cancel at 1 MiB, then decode and parse the bounded buffer. |
| S1 — duplicated catalog source/filter contract | **FIXED** | The source tuple and both unions live in `libs/shared/src/lib/types/rpc/rpc-decision-model-catalog.types.ts:18-41`. The catalog imports the unions (`decision-model.catalog.ts:32-37`), and the RPC schema uses the shared tuple (`libs/backend/rpc-handlers/src/lib/handlers/decision-model-catalog-rpc.handlers.ts:19-25,34-36`). |
| S2 — duplicate and misplaced error classification | **FIXED** | `loggableErrorName` and its fixed categories live in `libs/shared/src/lib/utils/loggable-error-name.ts:11-39`, exported from `libs/shared/src/lib/utils/index.ts:9-12`. The writer and RPC handler import it from shared (`decision-model-writer.ts:20-27`; `decision-model-catalog-rpc.handlers.ts:19-25`). The lane-routing barrel no longer exports the old helper (`libs/backend/lane-routing/src/index.ts:16-29`); custom names map to `other` as required by R2-1 (`loggable-error-name.ts:34-43`). |

## New defects

None identified in the fix. L3 above remains a prior defect, not a new one.

## Five logic questions

1. **Silent failure:** A failed key restore is surfaced as the fixed “may have changed” response (`decision-model-writer.ts:262-281`). The remaining silent resource risk is the unbounded body read before the size check (`decision-model.catalog.ts:458-459`).
2. **Unexpected user action:** Staggered picker opens now retain independent deadlines over a shared lookup (`decision-model.catalog.ts:243-253,511-526`); the spec exercises this (`decision-model.catalog.spec.ts:563-597`).
3. **Wrong answer from input data:** Tags past 256 are counted as undetermined instead of reported as a fully applied filter (`decision-model.catalog.ts:412-424,555-565`). A body larger than the check is rejected after being read (`:458-470`).
4. **Dependency failure or malformed response:** Key-store rejection triggers restoration (`decision-model-writer.ts:222-230`), and restoration failure gets a specific response (`:268-281`). HTTP/body failures become unavailable or undetermined (`decision-model.catalog.ts:329-345,449-483`), subject to the L3 body-read gap.
5. **Unspecified requirement:** The original plan sets a 4-second request budget and 5 concurrent lookups (`implementation-plan.md:371-379`) but no transport-byte cap. The attempted 1 MiB cap is only a post-read parsing limit (`ollama-catalog.schema.ts:15-20`; `decision-model.catalog.ts:458-470`).

## Verification and score

**7/10 — Verdict: REVISE.** L1, L2, S1, and S2 have direct source and regression-spec evidence. L3 remains incomplete at the network/body boundary, which keeps this below an exemplary 9–10; the bounded parse and fan-out, rollback, and caller-deadline fixes support a sound 7 rather than the earlier 5–6 band. No tests or builds were run under this read-only review. Scoped `ptah_get_diagnostics` was unavailable after its 45-second check, so there is no compiler pass to cite.

Verdict: REVISE
