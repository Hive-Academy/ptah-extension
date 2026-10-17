# Phase 4 re-review — TASK_2026_684_a11d

Commit: `c131cae8a` · Round 2 of 2 · Reviewer family: codex · Implementer family: claude

| Prior defect | Status | Evidence |
| --- | --- | --- |
| 1. SERIOUS — malformed save response shown as success | **FIXED** | The unchanged save path requires literal `success === true`; malformed replies take the failure path (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:733-749`). |
| 2. MODERATE — stored key blocks keyless HTTP at another origin | **FIXED** | The unchanged origin binding counts a stored key only for the draft's saved origin (`decision-model-row.component.ts:533-545`). D4 permits keyless HTTP at another origin (`.ptah/specs/TASK_2026_684_a11d/context.md`, D4). |
| 3. MODERATE — contradictory catalog accepted as ready | **FIXED** | `libs/frontend/chat/src/lib/settings/providers/decision-model-suggestions.ts:138-159` rejects unavailable results with models or undetermined count, applied results with undetermined count, and partial results without one. These are the shared filter meanings (`libs/shared/src/lib/types/rpc/rpc-decision-model-catalog.types.ts:35-49`) and match backend `UNAVAILABLE` and `resultOf` (`libs/backend/lane-routing/src/lib/decision-model/decision-model.catalog.ts:144-148,577-585`). Contradictory cases are covered at `decision-model-row.endpoint.spec.ts:269-294`. |

## New defects

None identified in this correction.

## Five logic questions

1. **Silent failure:** A contradictory catalog reply becomes an error suggestion with no IDs (`decision-model-suggestions.ts:109-110,153-159`), rather than a ready list.
2. **Unexpected user action:** Opening the picker for a partial result with zero eligible IDs still shows the partial explanation (`decision-model-row.endpoint.spec.ts:215-230`); it does not silently imply a complete filter.
3. **Wrong answer from input data:** An unavailable result containing a model, or an applied result with a positive undetermined count, is rejected (`decision-model-suggestions.ts:143-159`; `decision-model-row.endpoint.spec.ts:269-294`).
4. **Dependency failure:** Malformed RPC catalog data falls back to the unavailable help state (`decision-model-suggestions.ts:109-110,153-159`); malformed save data follows the fixed failure path (`decision-model-row.component.ts:737-749`).
5. **Missing requirement:** Cross-field consistency was implicit in the filter contract; the parser now checks it (`rpc-decision-model-catalog.types.ts:35-49`; `decision-model-suggestions.ts:134-159`).

## Verification and score

**8/10.** The remaining contract gap is closed and table cases cover each contradictory relationship (`decision-model-suggestions.ts:138-159`; `decision-model-row.endpoint.spec.ts:269-294`). This is sound logic, above the 5–6 band; a 9–10 score would require successful scoped diagnostics or execution evidence. No tests or builds were run under the read-only instruction. Scoped `ptah_get_diagnostics` returned unavailable after two 45-second TypeScript checks.

## Decisions

- **Treat backend filter relationships as the parser contract.** Options: validate fields independently, or also validate their relationship. The shared definitions and backend emissions support the latter (`rpc-decision-model-catalog.types.ts:35-49`; `decision-model.catalog.ts:144-148,577-585`). Reversible: yes.

Verdict: APPROVED
