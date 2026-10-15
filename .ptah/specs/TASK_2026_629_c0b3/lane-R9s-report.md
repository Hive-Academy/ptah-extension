# Lane report R9s

**Status: COMPLETE.** `compactHeightUnits` is dropped from `TabState`, every write of the
field is removed (restore stamping + save write-back), old stored payloads are tolerated
(stripped on restore, never re-enters memory or a later save), and `viewMode`
persist/restore/sanitize handling — including the `'compact-tall'` → `'compact'`
migration — is preserved exactly as today. Both contracted spec runs are green.

## Per-file changes

1. **libs/frontend/chat-types/src/lib/chat-types.ts**
   - `TabState.compactHeightUnits?: number` deleted together with its comment (was at
     :732-737 pre-edit; `viewMode?: TabViewMode;` now at :724 flows straight into
     `compactionCount`).
   - `TabViewMode` doc comment: the paragraph linking `TabState.compactHeightUnits`
     removed; the `'compact-tall'` migration note stays (:446-447). Type body untouched.
   - `isCompactViewMode` doc comment: the "height is deliberately NOT derived here /
     canvas clamps `compactHeightUnits`" paragraph removed (was :463-464). Function
     body untouched (:460).

2. **libs/frontend/chat-state/src/lib/tab-persistence.ts**
   - Import block (:51-56): added the `TabViewMode` type import.
   - Removed the legacy height constants `LEGACY_COMPACT_TALL_HEIGHT_UNITS` (3) and
     `LEGACY_COMPACT_HEIGHT_UNITS` (2) with their comments (was :159-170), the
     `isPositiveInteger` helper and the `restoredCompactView` function — the only
     code that still wrote `compactHeightUnits` onto restored tabs (both on the
     compact/compact-tall paths and the pass-through path for `full`).
   - New `restoredViewMode` (:163-174): viewMode-only validation; the retired
     `'compact-tall'` value migrates to `'compact'`, every other value passes through
     unchanged — the preserved half of the old behavior, now as a single-purpose
     helper in the same file-local pattern as `restoredAgentOrigin`/`legacyTitleOrigin`.
   - `sanitizeRestoredTab` (:232-269): builds the result into a local typed
     `TabState & { compactHeightUnits?: unknown }` with `viewMode: restoredViewMode(tab)`
     replacing the old `...restoredCompactView(tab)` spread (:238), then
     `delete sanitized.compactHeightUnits;` (:266) — the legacy-tolerance strip. This
     closes both writes named by `code-logic-review-R9r.md` Minor 2: the restore
     stamping is gone, and because the field is gone from `TabState` and the strip
     removes it from anything an old blob carries, `projectTabForPersist`'s spread can
     no longer write it back. Strip mechanism follows the repo's established
     spread-then-`delete` precedent (`skill-synthesis-tab.component.ts:1037-1042`) and
     never mutates the object it was handed.
   - `LEGACY_COMPACT_TALL_VIEW_MODE` kept (:160-161) — it serves the preserved
     `viewMode` migration only.

3. **libs/frontend/chat-state/src/lib/tab-restore-sanitize.spec.ts**
   - `LEGACY_COMPACT_HEIGHT_UNITS` / `LEGACY_COMPACT_TALL_HEIGHT_UNITS` imports removed.
   - :209-213 `migrates a legacy compact-tall tab to compact (TASK_2026_583)` —
     viewMode assertion only (the height assertion went with the field).
   - :216-222 `preserves the stored view mode on compact and full tabs` — the
     viewMode half of the old "keeps a valid stored height" case.
   - :224-260 new named case **`old payload with compactHeightUnits loads and the
     field is dropped`** — old payloads with a stored height on `compact`, `full`,
     `compact-tall` tabs and one garbage value (`'4'`) restore without error;
     asserts every stored mode survives (incl. the migration), the key is absent
     (`in`) from every restored tab, and absent from `projectTabForPersist(tab)` —
     the direct regression proof for the R9r Minor 2 finding. Runs inside
     `describe.each(readers)`, so it is proved on BOTH readers.
   - :262-265 `leaves a tab with no view mode without a mode` (height assertion
     dropped).
   - Deleted: `gives a legacy compact tab without a height 2 units`,
     `keeps a valid stored height ...`, and the `drops an invalid stored height %p`
     `it.each` — all height-only coverage, intentionally gone with the field; the
     garbage-value tolerance lives on inside the named case.

4. **libs/frontend/chat-state/src/lib/tab-persistence.backoff.spec.ts** — no change
   needed: it exercises the pure back-off helpers only and has no
   `compactHeightUnits` reference. Regression run only (below).

## rg proof

`rg -n "compactHeightUnits" libs/frontend/chat-state libs/frontend/chat-types` — only
the legacy-tolerance strip and the old-payload spec fixture remain:

- `tab-persistence.ts:233` (the strip's `TabState & { compactHeightUnits?: unknown }`
  local type), `:263` (the single comment naming the legacy key), `:266`
  (the `delete` strip itself)
- `tab-restore-sanitize.spec.ts:224, 228, 232, 236, 241` (the old-payload fixture),
  `:255, 258` (the key-absence assertions)

`rg -n "compactHeightUnits" libs apps -g "*.ts" -g "*.html"` — the same hits and
**nothing else**: no other remaining hit anywhere in `libs`/`apps`
(`canvas-layout-intent.ts` and `chat-view.component.ts` both currently have zero
hits; nothing outside the four contracted files needs reporting).

`rg -n "LEGACY_COMPACT|restoredCompactView|isPositiveInteger" libs apps -g "*.ts"` —
only `LEGACY_COMPACT_TALL_VIEW_MODE` (:161, used at :171 by the preserved viewMode
migration); zero dangling references to the removed constants/helpers.

## Spec results (through the lock runner, one at a time)

1. `node .ptah/tmp/check-run.mjs r9s-sanitize -- npx nx test @ptah-extension/chat-state --testFile=tab-restore-sanitize.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
   → `[r9s-sanitize] waited 0s for the lock, exit 0` ·
   `Test Suites: 1 passed, 1 total` · `Tests: 40 passed, 40 total`
2. `node .ptah/tmp/check-run.mjs r9s-backoff -- npx nx test @ptah-extension/chat-state --testFile=tab-persistence.backoff.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
   → `[r9s-backoff] waited 0s for the lock, exit 0` ·
   `Test Suites: 1 passed, 1 total` · `Tests: 9 passed, 9 total`

## Decisions

- **Strip mechanism.** Spread into a typed local, then `delete` the legacy key —
  the repo's established "copy then delete unwanted keys" precedent — rather than a
  destructure-rest omit. Keeps `sanitizeRestoredTab` non-mutating w.r.t. its input
  (the `does not mutate the object it was handed` case still passes) and needs no
  lint exception for an unused sibling. The local is typed
  `TabState & { compactHeightUnits?: unknown }` so the `delete` is type-honest about
  external input from `JSON.parse`.
- **`restoredViewMode` helper kept (renamed from `restoredCompactView`).** The
  `'compact-tall'` migration is `viewMode` behavior the contract says to preserve
  exactly, and the file's local pattern is documented single-purpose restore
  validators; inlining the ternary would drop the "persisted JSON is external input"
  documentation for `viewMode`.
- **No defensive strip on the persist path.** The field no longer exists on
  `TabState`, R9r removed its only in-memory writer, and both readers pass every
  stored tab through `sanitizeRestoredTab`, so the strip at restore is the single
  place the legacy key can enter and it never reaches a save. The named spec case
  asserts exactly this (`'compactHeightUnits' in projectTabForPersist(tab)` is
  `false` for all restored tabs).
- **`sanitizeRestoredTab` still assigns `viewMode` explicitly** (possibly
  `undefined`), matching the old spread's behavior bit-for-bit.
- **`PERSISTED_TAB_STATE_VERSION` stays 2** — the projection only drops a field no
  reader restores, so old and new blobs are read identically.
- **Old spec coverage mapping.** Height-only assertions were deleted with the
  field; the "load without error on garbage heights" tolerance moved into the named
  old-payload case, and the viewMode half of the deleted cases is preserved by
  `preserves the stored view mode on compact and full tabs` plus the named case.

## Clarifications Needed

None.
