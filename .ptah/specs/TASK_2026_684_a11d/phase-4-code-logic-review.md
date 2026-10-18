# Phase 4 Code Logic Review — TASK_2026_684_a11d

Review family: codex; implementer family: claude

## Summary

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 2 |
| Failure modes | 3 |

The Ollama Cloud row has no key field and routes setup to `ollama-cloud` (`decision-model-row.component.ts:209-225,664-667`). Its suggestions use `agent:listDecisionModels`, never write the draft model, and use a request counter (`decision-model-suggestions.ts:42-47,102-110`; `decision-model-row.component.ts:749-765`). The custom key uses the correct write-only field and `''` for removal (`decision-model-row.component.ts:681-685,703-715`). The frontend loopback list matches the backend's `keyTransportAllowed` list (`decision-model-row.view.ts:393-426`; `decision-endpoint.url.ts:23-35,132-138`). The defects below concern origin-specific key state and malformed RPC responses. A 6 reflects working principal paths with real gaps; 7 would understate the false success case, while 5 would overstate the impact of the two malformed catalog/key-state cases.

## Numbered defects

1. **SERIOUS — A malformed save response can show success without a confirmed write.** `decision-model-row.component.ts:732-746` checks `!result.data.success` by truthiness after `isSuccess()`. A response such as `{ success: 'false' }` or `{ success: {} }` passes and returns `{ ok: true }`; `settings-save-feedback.service.ts:168-177` then shows “Saved decision model.” The RPC boundary is untrusted at runtime, and the row already parses its status and catalog replies but does not parse this one. **Fix:** Require `result.data` to be a record with `success === true`; accept `success === false` only as a failure and map its error through the existing fixed-sentence allowlist. Treat every other shape as the fixed failed/uncertain response. Add a malformed-success response spec.

2. **MODERATE — A key stored for origin A blocks a keyless HTTP endpoint at origin B.** `decision-model-row.component.ts:514-539` treats `status.apiKeyStored === true` for the saved custom selection as a key for every edited custom URL. After a user changes `https://a.example` to `http://b.example`, `endpointFieldError` disables Save (`decision-model-row.view.ts:371-380`; `decision-model-row.component.ts:540-547`). The backend checks whether a key is bound to the *new* selection's origin (`decision-model-writer.ts:166-175`) and would allow B when none is bound. This violates D4's keyless HTTP case and leaves a false field error. **Fix:** Count the stored key for D4 only when the draft URL has the same normalized origin as the saved custom URL; still count a newly typed key. Test same-origin path edits and different-origin HTTP edits with `apiKeyStored: true`.

3. **MODERATE — Partly malformed catalog data is presented as a valid filtered list.** `decision-model-suggestions.ts:127-135` accepts any array for `models`, silently drops non-string/empty entries, and marks the response `ready` with the host's `filter`. For `{ models: [null], filter: 'applied' }`, the row says “No decision models found” (`decision-model-suggestions.ts:65-72`) although the host returned an invalid catalog. This is a success-looking wrong answer on a dependency shape failure. **Fix:** Validate every model ID and the complete result contract before returning `ready`; show the unavailable hint on an invalid response. Extend the malformed catalog spec beyond the non-array case in `decision-model-row.endpoint.spec.ts:243-250`.

## Five logic questions

1. **How does this fail silently?** A truthy non-boolean `success` produces a saved toast without proof of a save (`decision-model-row.component.ts:735-746`; `settings-save-feedback.service.ts:168-177`). A mixed-type catalog silently loses entries and appears `ready` (`decision-model-suggestions.ts:127-135`).
2. **What user action produces unexpected behaviour?** Edit a saved, keyed custom endpoint to keyless HTTP on a different origin: Save remains disabled (`decision-model-row.component.ts:514-547`).
3. **What input data produces a wrong answer?** `{ models: [null], filter: 'applied' }` yields “No decision models found” (`decision-model-suggestions.ts:65-72,127-135`), rather than an unavailable result.
4. **What happens when a dependency fails or returns an invalid shape?** Rejected catalog RPCs become an unavailable hint (`decision-model-row.component.ts:766-772`); invalid catalog arrays are not rejected (`decision-model-suggestions.ts:131-135`); malformed save success is trusted (`decision-model-row.component.ts:735-746`).
5. **What is missing from the requirements?** They define HTTPS by whether a key will travel, but the editor does not account for the secret's origin binding when changing the custom URL (`decision-model-row.component.ts:514-539`; `decision-model-writer.ts:166-175`).

## Scope and verification

Read the four changed source files in full, the Batch 17 diff and plan section 13, the relevant backend URL/key writer and save-feedback paths, and focused changed specs. The existing specs cover a later-kind suggestions race (`decision-model-row.endpoint.spec.ts:252-270`), stored-key D4 at the saved URL (`:407-430`), and a non-array catalog (`:243-250`); they do not cover the three scenarios above. No tests were run as requested. Scoped `ptah_get_diagnostics` was unavailable because its TypeScript check exceeded 45 seconds. No source or git state was changed.

## Decisions

- **Use backend origin binding to interpret `apiKeyStored`.** Options: count it for all custom drafts, or only for the saved origin. Evidence: `decision-model-writer.ts:166-175` checks the new origin. Reversible: yes.
- **Reject malformed RPC success and catalog shapes.** Options: coerce/filter them, or fail closed with the existing fixed messages. Evidence: the row already validates status (`decision-model-row.view.ts:330-351`) and uses fixed failure text (`decision-model-row.component.ts:64-65,735-743`). Reversible: yes.
