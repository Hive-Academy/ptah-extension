# Code Logic Review R9a — TASK_2026_629_c0b3

Review family: Claude reviewing codex
Scope: `canvas-layout-persistence.service.ts` (read in full) and its `.spec.ts` (read in full), plus the store caller (`canvas.store.ts:262-286,562-575,699-705`) for write-to-read tracing.
Spec run via the lock runner: 1 suite, 25/25 passed.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED (no blocking or serious issues) |
| Blocking / Serious / Moderate / Minor | 0 / 0 / 2 / 3 |

## Verified

- **Grid normalizes to Rail at the schema seam** (`service.ts:47`). `mode` accepts `rail`, `grid` and any garbage value (via `.catch`) and always emits `'rail'` (zod 4.6.5). Only `board.mode` changes. `railCollapsed`, `railDensity` and `railScrollTop` keep their `.catch` defaults. The tile schema (`:29-39`) and `v3Schema` (`:53-57`) are untouched, so ids, order, width, `rowBreakBefore`, `.max` and `uniqueIds` are all still enforced.
- **No v2 or v1 Grid path exists.** Both schemas carry no board and return `board: null` (`:226-245`). The store then uses the in-memory board or `DEFAULT_BOARD_STATE` (`store:575`), which is Rail. No data loss.
- **A stored v3 Grid record is never rewritten on read.** `load` returns `needsWrite:false` and `lastWritten` is set to the raw bytes (`:222`). The next real change differs from those bytes, so the persisted `grid` is replaced with `rail` on the first write. This is the intended lazy upgrade.
- **Newer-version guard intact** (`:211-218`). Versions 99, 2.5 and 3.5 give `writable:false` and `readOnlyPaths`. `markHydrated(false)` blocks writes.
- **Write-then-read round trip.** The same `storageKey` is used for write (`:327`) and read (`:192`). The stored value is the JSON v3 record. `railScrollTop` is rounded and clamped by the store (`store:280`), so it satisfies the schema's `.int().nonnegative()` and does not silently decay to 0.
- **Spec honesty.** The v3-Grid case is built from a raw JSON string containing `"mode":"grid"` (`spec:51`). The expected value comes from the separate typed fixture, which is now Rail (`:18`). It asserts that tiles and board options are preserved and that the stored bytes are unchanged, so it is not a tautology. The typed `mode:'grid' as const` is gone (Minor 1 resolved). The two new v3 malformed cases (`:81-82`) pin the strict tile schema (bad span, missing `rowBreakBefore`).

## Findings

1. **Moderate, untested write normalization.** `service.ts:322` forces `mode:'rail'` on every write, but no spec exercises it. Every `schedule` call uses the Rail `board` fixture, so deleting `:322` leaves all 25 tests green. A Grid-typed snapshot from the in-memory store could then be re-persisted unnoticed.
   Fix: add a test that schedules `{ tiles: intent, board: { ...board, mode: 'grid' } }`, flushes, and asserts `JSON.parse(localStorage.getItem(key)!).board.mode === 'rail'`.

2. **Moderate, lazy-upgrade path unasserted.** Nothing proves that a loaded v3-Grid record is replaced with Rail on the next write. The behaviour rests on `lastWritten` holding the raw bytes (`:222`) and `:325` seeing a different serialized string.
   Fix: extend the `:50` test. After the load, call `markHydrated(path, true)`, `schedule` a changed board, and `flush`. Then assert the stored JSON has `board.mode === 'rail'` and the same tiles.

3. **Minor, weak assertion.** `spec:185`, `loaded.board ?? DEFAULT_BOARD_STATE` compared to `DEFAULT_BOARD_STATE`, is true by construction because `board` is already asserted null on `:184`. The real "v2 opens as Rail" guarantee lives in `store:575`.
   Fix: drop `:185`, or move the assertion to a store test (`board(path).mode === 'rail'` after hydrating a v2 record).

4. **Minor, type-level gap.** `CanvasLayoutLoadResult.board` and `CanvasBoardState.mode` still allow `'grid'` (`canvas-board-mode.ts:1`). The Rail-only guarantee is runtime-only. In-memory state from `store:575` (`existing ?? DEFAULT`) can still hold `grid` if some other code sets it. Persisted state is safe because of `:322`.
   Fix: a later batch should narrow `CanvasBoardMode` to `'rail'` once the Grid toggle is removed (R9b).

5. **Minor, pre-existing and out of this diff.**
   - A non-numeric, zero or negative `version` (for example the string `"4"`) skips the newer-version guard (`:211-213`). It fails all three schemas and returns `tiles:null`, `writable:true`, so the next write can overwrite a foreign record.
   - A v3 record with an unknown extra key inside `board` (strictObject) fails entirely and drops the tiles (`:46`, `:246-247`).
   Neither is a regression, but both silently turn a recoverable state into data replacement.

## Five logic questions

- **Silent failure:** none new. Parse failure warns once per kind (`:337`); `writeFailed` is surfaced. Finding 5 is the pre-existing silent path.
- **User action:** reopening a workspace stored as Grid yields Rail with collapse, density and scroll kept. Reverting to an older client would see `rail` and continue to work.
- **Wrong-answer input:** `mode` garbage or `grid` gives Rail (intended). Fractional or oversized `railScrollTop` gives 0 from the schema (`:50`), but the store rounds on write, so this is unreachable via the app.
- **Dependency failure:** `localStorage` throws on read, write and remove, and each is caught and warned. Only the unchanged-bytes `lastWritten` shortcut can mask a retry; after a failed write nothing is recorded, so it retries.
- **Missing:** the tests in findings 1 and 2.
