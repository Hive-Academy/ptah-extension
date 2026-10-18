# Phase 3 final independent check — TASK_2026_684_a11d

Commit: `72def3853` · Final check after round 2 · Reviewer family: codex · Implementer family: claude

| Prior defect | Status | Evidence |
| --- | --- | --- |
| L3 — text-only catalog body bypassed the byte cap and abort | **FIXED** | `libs/backend/lane-routing/src/lib/decision-model/bounded-body-reader.ts:11-13,26-33` requires a stream or `null` and removes the `text()` branch. Its reader counts bytes before decoding and cancels on oversize or abort (`:40-69`). `decision-model.catalog.ts:58-62,474-478` uses that seam for catalog responses; its default is Node global `fetch` (`:165-174`), whose `Response` has a `ReadableStream` body. Test replies now supply streams (`decision-model.catalog.spec.ts:62-71,112-145`), and the never-settling body case checks timeout and cancellation (`:751-770`). |

## New defects

None identified in this bounded correction. `SystemOneFetch` retains its `text()` response contract (`libs/backend/lane-routing/src/lib/decision-model/system-one.client.ts:26-38`); only the catalog's separate fetch return type changed (`decision-model.catalog.ts:58-62`).

## Five logic questions

1. **Silent failure:** An oversized or unreadable body becomes an unavailable catalog, with a warning from `decision-model.catalog.ts:479-502`; it cannot appear as a successful filtered list.
2. **Unexpected user action:** Opening the picker while the tag body stalls returns the unavailable result at the call budget; the stream is cancelled (`decision-model.catalog.ts:181-204,453-456`; `decision-model.catalog.spec.ts:751-770`).
3. **Wrong answer from input data:** The byte limit uses `Uint8Array.byteLength` before UTF-8 decoding (`bounded-body-reader.ts:50-63`), including multibyte bodies.
4. **Dependency failure:** A stream error or abort cancels the reader and removes the abort listener (`bounded-body-reader.ts:64-69`); `sendJson` maps it to a failed catalog answer (`decision-model.catalog.ts:491-502`).
5. **Missing requirement:** The fetch seam must expose a stream to enforce both limits; it now does so at the catalog type boundary (`decision-model.catalog.ts:53-62`). A malformed runtime seam can still return an unavailable result, which is the catalog's failure behavior (`:195-204,491-502`).

## Verification and score

**8/10.** The prior resource and deadline gap is closed and the new stalled-stream case checks the key failure path (`bounded-body-reader.ts:26-69`; `decision-model.catalog.spec.ts:751-770`). This is sound logic, above the 5–6 band; a 9–10 score would require successful scoped diagnostics or execution evidence. No tests or builds were run under the read-only instruction. Scoped `ptah_get_diagnostics` returned unavailable after two 45-second TypeScript checks.

## Decisions

- **Accept the stream-only catalog seam.** Options: keep a text fallback, or require a stream. The byte cap and abort contract cannot be enforced during `text()`; the new type requires a body stream (`bounded-body-reader.ts:11-13`; `decision-model.catalog.ts:58-62`). Reversible: yes.

Verdict: APPROVED
