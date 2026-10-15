# Mode 2 — Wave 4b — Batch R9r — TASK_2026_629_c0b3

Verdict: **R9r COMPLETE**. Commit `cea73f11f`.

## Inputs read

- `batches-rail-r9.md` "## Batch R9r" and "## Execution rules"
- `lane-R9r-report.md` (opencode writer; 3 SPEC runs green: 60 / 23 / 94 tests)
- `code-logic-review-R9r.md`: APPROVED 9/10, 0 Blocking/Serious/Moderate, 2 Minor, no fix round

## On-disk verification

- `git diff --stat -- libs/frontend/chat-state`: exactly the 4 contracted files, +11 / -123.
- `tab-manager.service.ts`: `setCompactHeight` and `getTabCompactHeightUnits` deleted with their docs. Height
  prose removed from the `toggleTabViewMode` and `setViewMode` docs. `toggleTabViewMode`, `setViewMode` and
  `getTabViewMode` bodies are unchanged.
- `tab-manager.persistence.spec.ts`: the height round-trip case was rewritten as a `viewMode` round-trip
  (stored value, a single write on a mode-only change, then a restore via `loadTabState`).
- Two spec files: only the height-specific cases were removed.
- `rg -i "compactHeightUnits|compact height|CompactHeight"` over the 4 files: 0 hits (exit 1).

## Checks (from W, serial, via `.ptah/tmp/check-run.mjs`)

| Step | Label | Result |
| --- | --- | --- |
| rg `setCompactHeight\|getTabCompactHeightUnits` over `libs` `apps` (`*.ts`, `*.html`) | — | 0 hits (exit 1) |
| FULL(@ptah-extension/chat-state) | w4-cs-full | exit 0. `Test Suites: 24 passed, 24 total`, `Tests: 566 passed, 566 total` |
| TC(@ptah-extension/chat-state) | w4-cs-tc | exit 0. `Successfully ran target typecheck` |
| LINT(@ptah-extension/chat-state) | w4-cs-lint | exit 0. `2 problems (0 errors, 2 warnings)` |

Each run waited 0s for the lock. Logs are `%TEMP%/629-check-w4-cs-{full,tc,lint}.log`.

The 2 lint warnings were already there before R9r:

- `tab-manager.service.ts:1417` `max-lines` (1522 > 700). The file was already over the limit, and R9r made it
  29 lines shorter.
- `tab-manager.cross-workspace.spec.ts:115` `no-non-null-assertion`. R9r did not touch this file.

R9h's uncommitted `libs/frontend/chat/**` changes did not affect these checks. chat-state does not import chat.

## Commit

- `cea73f11f refactor(chat-state): batch R9r - drop grid tile height from tab manager`
- Staged with `git add -- <4 paths>`. `git diff --cached --name-only` listed exactly those 4 paths.
- Committed in the foreground, and the lint-staged pre-commit hook passed. `--no-verify` was not used. Nothing
  was pushed.
- Left unstaged: the R9h chat files, the `.ptah/specs/**` docs, and the canvas changes that showed up during this
  run (canvas-layout service and spec, deleted board-toggle and layout-controls). Those canvas changes belong to
  another writer (R9k scope) and were not touched.

## batches-rail-r9.md updates

- The R9r heading and Task R9r.1 are now COMPLETE (`cea73f11f`), with a Mode 2 result line.
- R9s has a carry-over bullet for review Minor 2.

## Minors recorded (no fix round)

1. The rewritten reload case cannot tell a real restore from a no-op `loadTabState`, because the in-memory tab is
   already `compact` when it runs. This is an optional strengthening: flip the in-memory mode, or clear `_tabs`,
   before `loadTabState`. It is not a regression, since the old case had the same shape.
2. Carry-over for R9s: `sanitizeRestoredTab`/`restoredCompactView` (`tab-persistence.ts:188-208`, `:272`) still
   stamps `compactHeightUnits: 2` onto restored compact tabs. The `projectTabForPersist` spread then writes it back.
   R9s must delete the restore injection and the legacy constants. This is recorded on the R9s section of
   batches-rail-r9.md.

## Next

The phase-diff code-logic review runs once after the last R9 batch (execution rule 3), so no review is due now.
Remaining in Wave 4: R9h, which is in review. R9s comes in Wave 5 and depends on R9r, which is now satisfied.
