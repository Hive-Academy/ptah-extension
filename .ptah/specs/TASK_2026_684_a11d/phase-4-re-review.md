# Phase 4 re-review — TASK_2026_684_a11d

Commit: `4ccf9f4a8` · Round 1 re-review · Reviewer family: codex · Implementer family: claude

| Prior defect | Status | Evidence |
| --- | --- | --- |
| 1. SERIOUS — malformed save response shown as success | **FIXED** | `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:734-743` accepts only `success === true`; other shapes return the fixed failure, with malformed-success cases in `decision-model-row.endpoint.spec.ts:530-553`. A missing `data` throws into the fixed failure catch at `decision-model-row.component.ts:745-749`. |
| 2. MODERATE — stored key blocks keyless HTTP at another origin | **FIXED** | `decision-model-row.component.ts:533-540` counts a stored key only if `storedKeyBoundTo` matches the draft and saved origins. `decision-model-row.view.ts:405-415,423-431` uses the same WHATWG `URL.origin` as backend `libs/backend/lane-routing/src/lib/decision-model/decision-endpoint.url.ts:147-153` and `decision-model.keys.ts:67-77`: scheme and host case normalize, default ports collapse, trailing dots remain significant, and paths are ignored. The backend writer checks the draft origin (`libs/backend/rpc-handlers/src/lib/handlers/decision-model-writer.ts:176-185`). The rewritten same-origin path and changed-scheme/host specs match that behavior (`decision-model-row.endpoint.spec.ts:432-503`). |
| 3. MODERATE — malformed catalog shown as ready | **PARTIAL** | `libs/frontend/chat/src/lib/settings/providers/decision-model-suggestions.ts:127-143` now rejects blank/non-string IDs, invalid filters, and invalid counts; table cases cover those shapes (`decision-model-row.endpoint.spec.ts:240-281`). It still accepts `{models:['m'],filter:'unavailable',undetermined:0}` and `{models:[],filter:'applied',undetermined:1}` as `ready` (`decision-model-suggestions.ts:138-143`). The former exposes an option while the hint says support could not be checked (`decision-model-row.component.ts:326-330`; `decision-model-suggestions.ts:65-72`); the latter claims a complete filter despite an undetermined model. Enforce the result's filter/count/model relationship before returning `ready`, and add contradictory-shape cases. |

## New defects

None identified in the fix. The catalog consistency gap is part of prior defect 3.

## Five logic questions

1. **Silent failure:** Contradictory catalog data can still become `ready` (`decision-model-suggestions.ts:138-143`), with a misleading hint (`:65-72`).
2. **Unexpected user action:** Editing a saved keyed URL to keyless HTTP on another origin now permits Save, while a same-origin path edit remains blocked (`decision-model-row.component.ts:533-545`; `decision-model-row.endpoint.spec.ts:432-503`).
3. **Wrong answer from input data:** `filter:'applied'` with positive `undetermined` is accepted as complete (`decision-model-suggestions.ts:141-143`), contrary to the filter contract (`libs/shared/src/lib/types/rpc/rpc-decision-model-catalog.types.ts:35-49`).
4. **Dependency failure:** Malformed save replies now yield a fixed failed response (`decision-model-row.component.ts:737-749`); malformed catalog members are rejected, but contradictory metadata is not (`decision-model-suggestions.ts:127-143`).
5. **Missing requirement:** The parser checks field types but not the catalog's documented cross-field invariants (`rpc-decision-model-catalog.types.ts:35-49`; `decision-model-suggestions.ts:138-143`).

## Verification and score

**7/10.** Literal save success and backend-equivalent origin binding resolve the serious defect and one moderate defect, above the earlier 6. The remaining catalog contract gap prevents a 9–10 assessment. No tests or builds were run under the read-only instruction. Scoped `ptah_get_diagnostics` was unavailable after its 45-second TypeScript check.

## Decisions

- **Treat catalog filter/count consistency as part of the full result contract.** Options: accept field types alone, or require `applied` to have zero undetermined models, `partial` to have a positive count, and `unavailable` to expose no models. Evidence: shared contract comments (`rpc-decision-model-catalog.types.ts:35-49`) and backend result construction (`libs/backend/lane-routing/src/lib/decision-model/decision-model.catalog.ts:573-581`). Reversible: yes.

Verdict: REVISE
