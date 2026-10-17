# Phase 3 re-review — TASK_2026_684_a11d

Commit: `046532cae665b55eb079f308a609050f2ef4f32d` · Round 2 of 2 · Reviewer family: codex · Implementer family: claude

| Prior defect | Status | Evidence |
| --- | --- | --- |
| L3 — unbounded catalog body read and UTF-16 size check | **PARTIAL** | The production stream path counts `Uint8Array.byteLength`, cancels after 1 MiB, and releases the reader and abort listener in `libs/backend/lane-routing/src/lib/decision-model/bounded-body-reader.ts:53-76`; `decision-model.catalog.ts:470-485` uses it before JSON parsing. But the supported `body === undefined` path still awaits the entire `text()` result and allocates its UTF-8 encoding before testing the cap (`bounded-body-reader.ts:32-37`). It never observes `signal`, so a large or stalled text-only source retains the original resource/deadline defect. The existing fetch seam intentionally supplies text-only responses (`decision-model.catalog.spec.ts:122-126,137-141`). Reject a non-streaming body or supply a genuinely bounded reader; test a large and never-settling text-only body. |

## New defects

None. The remaining text-only gap is the same L3 defect.

## Five logic questions

1. **Silent failure:** `requestJson` can return the timeout result while a text-only `source.text()` remains pending (`decision-model.catalog.ts:449-452`; `bounded-body-reader.ts:32-37`).
2. **Unexpected user action:** Opening a picker backed by a text-only fetch seam can leave body work alive after its 4-second deadline (`decision-model.catalog.ts:173-203,449-452`; `bounded-body-reader.ts:32-37`).
3. **Wrong answer from input data:** A multibyte streamed body is checked by bytes before decoding (`bounded-body-reader.ts:63-70`); the regression spec covers that boundary (`decision-model.catalog.spec.ts:675-693`).
4. **Dependency failure:** A stream read failure or abort cancels the reader, removes the listener, and releases the lock (`bounded-body-reader.ts:58-76`); `sendJson` maps it to an unavailable or timed-out answer (`decision-model.catalog.ts:487-499`). The text-only path has no cancellation (`bounded-body-reader.ts:32-37`).
5. **Missing requirement:** The fetch seam allows a body without a stream (`bounded-body-reader.ts:9-13`), yet a strict transfer-byte cap cannot be enforced through `text()` after it resolves (`:32-37`).

## Verification and score

**7/10.** The streamed transport closes the principal L3 resource hole and its new specs exercise over-cap, multibyte, and stalled streams (`decision-model.catalog.spec.ts:642-745`), placing this above the 5–6 band. The text-only seam leaves the stated byte-cap and cleanup contract incomplete, below 9–10. No tests or builds were run under the read-only instruction. Scoped `ptah_get_diagnostics` was unavailable after its 45-second TypeScript check.

## Decisions

- **Keep L3 partial.** Options: treat the production stream path as sufficient, or require the exported text-only fallback to honor the same cap and abort contract. Evidence: the fallback is an explicit source variant (`bounded-body-reader.ts:9-13,32-37`) and the catalog's test fetch uses it (`decision-model.catalog.spec.ts:122-126,137-141`). Reversible: yes.

Verdict: REVISE
