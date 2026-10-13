# R9a persistence report

## Files changed

- `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts`: v3 board schema accepts stored `grid` and emits `rail` at parse time. New v3 writes serialize `rail` while retaining collapse, density, scroll and the strict tile schema.
- `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts`: removed the typed Grid board fixture; added a raw stored v3 Grid case, v3 malformed tile cases, and asserted the v2 Rail default at the store fallback boundary.

## Named spec cases and results

Command: `node .ptah/tmp/check-run.mjs R9a -- npx nx test @ptah-extension/canvas --testFile=canvas-layout-persistence.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`

Result: `Test Suites: 1 passed, 1 total`; `Tests: 25 passed, 25 total`; `NX Successfully ran target test for project @ptah-extension/canvas`.

- v3 Grid → Rail preserving collapse/density/scroll and tile order/width/row break: passed (`opens a stored v3 Grid board as Rail without changing tiles or Rail options`). Raw stored bytes remained unchanged on read.
- v2 opens as Rail: passed (`opens v2 as Rail defaults without scheduling an upgrade`); v2 returns `board: null`, then the store applies `DEFAULT_BOARD_STATE`.
- v1 read: passed (`migrates v1 %s losslessly into durable rows` for auto/1/2/3; `loads v1 with null board and a pending migration`).
- Malformed: passed (`rejects malformed boundary records`, including strict v3 tile width and required row break; `defaults invalid board fields while preserving valid tiles`).
- Newer version stays read-only: passed (`preserves future-version %s bytes and disables writes` for 99/2.5/3.5).
- Write-then-read round-trip: passed (`round-trips v3 per encoded workspace and panel`).

## Decisions

- Kept v2 `board: null`: `canvas.store.ts` uses `loaded.board ?? this._workspaceBoard().get(path) ?? DEFAULT_BOARD_STATE` (line 575), so it opens as Rail without changing the persistence result contract.
- Normalized writes to Rail too: the present `CanvasBoardState` type still permits Grid, while the parsed v3 type is now Rail-only. This resolves the write type mismatch and prevents a legacy Grid snapshot from being newly persisted.
- Kept the v3 tile schema untouched and the newer-version guard in place.

## Not done

- No full suite, typecheck or lint, per batch instructions. Scoped `ptah_get_diagnostics` after the final edit was unavailable: the TypeScript check remained running past its 45-second limit on two attempts. The locked Jest spec passed.

## Fix round

Review: `code-logic-review-R9a.md` findings 1-3. Changed only `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts`.

1. Untested write normalization → added `writes Rail mode even when the snapshot still has Grid mode`: schedules a Grid snapshot, flushes, parses stored JSON, and checks Rail board plus unchanged tiles. Passed.
2. Lazy upgrade path → extended `opens a stored v3 Grid board as Rail without changing tiles or Rail options`: confirms read leaves raw bytes intact, then hydrates, changes scroll position, flushes, and checks stored Rail board plus identical tile ids, order, width and row breaks. Passed.
3. Tautological v2 assertion → removed `loaded.board ?? DEFAULT_BOARD_STATE` equality; retained the concrete v2 persistence result assertion. Passed.

Command: `node .ptah/tmp/check-run.mjs R9a-fix -- npx nx test @ptah-extension/canvas --testFile=canvas-layout-persistence.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
Result: `Test Suites: 1 passed, 1 total`; `Tests: 26 passed, 26 total`; `NX Successfully ran target test for project @ptah-extension/canvas`.

No service change was needed. No other checks were run, as requested.
