# Code Logic Review R9s — `TASK_2026_629_c0b3`

Review family: Claude (reviewer) vs opencode (implementer)

Batch: R9s (drop `compactHeightUnits` from current `TabState`; tolerate old blobs; preserve `viewMode`).
Scope read in full: `libs/frontend/chat-state/src/lib/tab-persistence.ts`, `tab-restore-sanitize.spec.ts` (both readers section), the `TabState`/`TabViewMode`/`isCompactViewMode` hunk in `libs/frontend/chat-types/src/lib/chat-types.ts`, `tab-manager.service.ts:2785-2805`, `tab-workspace-partition.service.ts:571-620`. Compared against `git show HEAD:...tab-persistence.ts`. No tests, typecheck or nx run (per instructions).

## Verdict

- Score: 8/10
- Verdict: APPROVED (APPROVE-WITH-FIXES not needed; one Minor, one optional hardening note)
- Blocking 0, Serious 0, Moderate 0, Minor 3

Why 8 and not 9: the logic is correct and complete for the contract, but the "field never re-enters a later save" guarantee rests on a single choke point (the restore) with nothing at the save side, and the spec proves the save side only via an in-memory projection, not via real storage bytes.

## Write-path trace

Every persisted tab-state write, to its reader:

1. Writers. `TabManagerService._doSaveTabState` (active workspace, key `ptah.tabs` or `ptah.tabs.<panelId>`) and `TabWorkspacePartitionService._saveWorkspaceTabsToStorage` (`tab-workspace-partition.service.ts:616-618`, key `ptah.tabs.ws.<encodedPath>[.<panelId>]`). Both serialize `buildPersistedTabState(tabs, activeTabId)` -> `{ tabs: tabs.map(projectTabForPersist), activeTabId, version: 2 }` (`tab-persistence.ts:111-138`). Key, scope and envelope (`PERSISTED_TAB_STATE_VERSION = 2`, line 77) are untouched by the diff. `projectTabForPersist` is untouched: it still spreads `...tab` and does not name `compactHeightUnits`. Value format is therefore identical except that no live tab carries the field any more.
2. Who could put the field in a live tab. `rg compactHeightUnits` over `libs` and `apps` (`.ts`, `.html`) now hits only `tab-persistence.ts` (the strip, lines 233/263/266) and `tab-restore-sanitize.spec.ts`. There is no remaining writer: no `updateTabInternal({compactHeightUnits})`, no tab factory, no canvas setter. The only way the key enters memory is the stored JSON itself.
3. Readers. Both readers end in `sanitizeRestoredTabs` -> `sanitizeRestoredTab`: `tab-manager.service.ts:2799` (`loadTabState`, legacy/active key) and `tab-workspace-partition.service.ts:585` (`_loadWorkspaceTabsFromStorage`, reached via `switchWorkspace`). `rg` for `ptah.tabs` / `PersistedTabState` in libs and apps finds no third reader (harness-builder hit is a comment only). So the single strip covers all entry points.
4. Strip behaviour. `sanitizeRestoredTab` builds a fresh object (`...tab` spread into `sanitized`, line 233-260), then `delete sanitized.compactHeightUnits` (line 266). It runs unconditionally on any value: number, garbage string (`'4'`), `null`, `0`, missing. There is no validation branch left that could throw on a bad value; the old `isPositiveInteger` gate is gone and nothing replaces it because nothing reads the value. `delete` acts on the fresh copy, never on the parsed input object. Return type stays `TabState`. Old blob with the field loads -> field absent in memory -> `projectTabForPersist` spreads a tab without it -> the next save omits it. R9r Minor 2 (restore stamped `compactHeightUnits: 2`, save wrote it back) is closed: a plain compact tab no longer gets any stamp, and a stored field is removed instead of preserved.
5. Persisted blob lifecycle. An old blob keeps the field in storage until the first save under that key. The first save after restore always happens for the active key (`persistNeeded` returns true with a null snapshot); a background workspace blob that is never loaded keeps the stale key on disk, harmless because only `sanitizeRestoredTab` ever reads it. `tabPersistEqual` is key-driven over both tabs' keys, so it does not misfire: restored tabs (sanitized) are compared with the snapshot of what was written.
6. `viewMode`. HEAD: `...restoredCompactView(tab)` returned `viewMode: 'compact'` for `'compact-tall'` and for `'compact'`, and `tab.viewMode` unchanged otherwise (incl. `undefined`, `'full'` and any unknown string). Now: `viewMode: restoredViewMode(tab)` returns `'compact'` for `'compact-tall'`, else `tab.viewMode`. Observable `viewMode` is identical in every branch, including the explicit `viewMode: undefined` key for absent mode. The legacy-mode constant `LEGACY_COMPACT_TALL_VIEW_MODE` is retained. `TabViewMode` is imported as a type (line 55) for the return annotation. Key order in the returned object is unchanged (viewMode position), which matters to nothing here.

Result: key, scope, envelope, version and format unchanged; the field is tolerated on read and gone from every subsequent write. Trace is clean.

## Removed constants and helpers

- `LEGACY_COMPACT_TALL_HEIGHT_UNITS`, `LEGACY_COMPACT_HEIGHT_UNITS`, `isPositiveInteger`, `restoredCompactView`: `rg` over `libs` and `apps` (`.ts`, `.md`) finds no reference outside this file's own prose. They were `export`ed (the two constants) but not re-exported through the chat-state barrel as far as the grep shows (no importer anywhere, including the barrel and the old spec, which the diff updates). No dangling consumer.
- `restoredCompactView` did two things only: legacy-mode migration and height stamping/validation. The migration lives on in `restoredViewMode`; the stamping and validation are the intended removal. Nothing else was lost.
- `isNonEmptyString` is still defined and used by `restoredAgentOrigin` (lines 176-178, 188-213); it is not a casualty of the `isPositiveInteger` removal.

## Type removal (chat-types)

`compactHeightUnits?: number` is removed from `TabState` (`chat-types.ts` ~726) together with its doc block, and two comment mentions in `TabViewMode`/`isCompactViewMode` are rewritten to drop the height story. Repo-wide `rg compactHeightUnits` over `.ts`/`.html` (libs and apps) leaves no reader, so there is no new compile error and no silently-undefined consumer. The `TabState & { compactHeightUnits?: unknown }` intersection at `tab-persistence.ts:233` is a deliberate local widening so `delete` typechecks and documents the legacy key.

Related, not in R9s scope: `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:32` (`clampCompactHeightUnits`) and `:122-133` (`tileViewConstraint(tabId, compact, storedCompactHeight)`) still exist and have no caller outside `canvas-layout-intent.spec.ts` (rg of `libs` shows only those two files). That is R9k territory (uncommitted canvas changes); flagged only so the R9k reviewer/team-leader can confirm the leftovers are intentionally dead or removed.

## Five logic questions

1. Silent failure: the only quiet path is a stale `compactHeightUnits` left in a never-loaded background workspace blob; it is inert. A restore cannot throw because of the field (no value inspection).
2. Unexpected user action: toggling compact/full no longer remembers a height; that is the intended R9 behaviour (Grid removed). A user with a previously-tall compact tab sees it as plain compact. Intended per contract.
3. Wrong-answer input: `viewMode` of an unknown string (e.g. `'banana'`) passes through unvalidated, exactly as at HEAD (see Minor 3). `compactHeightUnits` of any type is dropped.
4. Dependency failure: storage unreadable / JSON malformed are handled by the unchanged outer try/catch in the readers.
5. Missing but unstated: no on-disk migration is needed or performed; see Minor 2 for the defence-in-depth gap.

## Spec discrimination (review focus 4)

`'old payload with compactHeightUnits loads and the field is dropped'` runs under `describe.each(readers)`, so it exercises both `loadTabState` and `switchWorkspace`. It asserts:

- viewModes `['compact','full','compact','compact']` for inputs compact/4, full/5, compact-tall/5, compact/`'4'` -> proves load success and the migration, and that garbage `'4'` does not throw.
- `'compactHeightUnits' in tab` is false for all four restored tabs -> discriminating. Removing the `delete` makes the key present (spread keeps it) and the test fails; making restore throw yields an empty/partial tab list and fails the map assertions. `'in'` (not `=== undefined`) correctly distinguishes a deleted key from an explicit `undefined`.
- The `projectTabForPersist` assertion is weaker: it is derived from the already-clean restored tab, so it would pass trivially for any tab lacking the key, and does not pin that `projectTabForPersist` strips anything (it does not). It is a corollary, not independent evidence.

Other cases checked: `'preserves the stored view mode on compact and full tabs'` and the retained `compact-tall -> compact` case pin `viewMode` parity; `'leaves a tab with no view mode without a mode'` pins `undefined`.

## Findings

1. Minor, `tab-restore-sanitize.spec.ts:257-259`: the "next save cannot write it back" claim is asserted via `projectTabForPersist(tab)` on the in-memory restored tab, not on the bytes written by a save. It would not catch a future second restore path or a writer that bypasses `sanitizeRestoredTab`. Suggest asserting `JSON.parse(localStorage.getItem(<key>)).tabs[i]` has no `compactHeightUnits` after triggering a save (the harness already writes/reads these keys). Not blocking: the read-side assertion is the real guard.
2. Minor (hardening), `tab-persistence.ts:111-126`: the "never re-enters a later save" guarantee depends solely on the restore strip. `projectTabForPersist` does not drop the retired key, whereas it does drop other retired/ephemeral fields. Today no writer exists, so it is unreachable; if a future change hydrates tabs through a path that skips `sanitizeRestoredTab`, the key would be persisted again and nothing would flag it. Optional: add `compactHeightUnits` handling on the save projection too, or a comment at `projectTabForPersist` pointing to the restore strip. Weigh against "Replace, do not accumulate": one choke point is defensible and is what the contract asked for.
3. Minor, pre-existing and unchanged from HEAD, `tab-persistence.ts:170-174`: an unrecognised `viewMode` string is passed through unvalidated into a `TabViewMode`-typed field. `isCompactViewMode` then treats it as non-compact, so the effect is a safe fallback to full rendering, but the stored value would be re-persisted verbatim. Out of scope for R9s; noted because the new docstring says "validated" while only `'compact-tall'` is actually handled. Consider rewording to "migrated" to avoid overstating.

## Data flow

1. `localStorage` blob (old, with `compactHeightUnits`) -> `JSON.parse` in reader: OK.
2. Version gate `state.version !== 2` -> return: unchanged, OK.
3. `sanitizeRestoredTabs` -> per tab fresh copy, `viewMode` migrated, `compactHeightUnits` deleted: OK.
4. Signals `_tabs.set(...)`: tabs without the key: OK.
5. Any later `updateTabInternal` spreads `{ ...existingTab, ...updates }`: key stays absent: OK.
6. `saveTabState` -> `projectTabForPersist` -> `JSON.stringify` -> `setItem`: no key: OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Drop `compactHeightUnits` and its comments from current `TabState` | COMPLETE | none (field + doc block + two cross-reference comments removed) |
| Remove current writes | COMPLETE | no writers remain in libs/apps |
| Tolerate the old stored field | COMPLETE | stripped unconditionally on both readers, any value type |
| Preserve `viewMode` incl. `compact-tall -> compact` | COMPLETE | behaviour identical to HEAD for every input |
| Case: old payload with `compactHeightUnits` loads | COMPLETE | spec is discriminating, runs on both readers |
| Parity row 114 | COMPLETE | no consumer of the field left |
| R9r Minor 2 carry-over | COMPLETE | no stamp on restore, no write-back on save |

Implicit requirements not addressed: none material (see Minor 2).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Blob field is a number | YES | deleted | none |
| Blob field is garbage string / null / 0 / negative | YES | deleted, never inspected | none |
| Blob field missing | YES | `delete` on absent key is a no-op | none |
| `viewMode` `'compact-tall'` with field | YES | -> `'compact'`, field dropped | none |
| `viewMode` undefined | YES | key present as `undefined` as at HEAD | none |
| Unknown `viewMode` string | PASS-THROUGH | unchanged from HEAD | Minor 3 |
| Background workspace blob never loaded | YES | stale key stays on disk, inert | none |
| Input object mutated by restore | NO (good) | `delete` on fresh copy | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH (small diff, both readers and every consumer traced; not executed per instructions)
- Top risk: the guarantee that the retired key never returns to storage is enforced at one point (restore) and asserted only in memory, so a future restore bypass would resurrect it silently.
- What a robust implementation would add: an end-to-end spec assertion on persisted bytes after a save; optionally a defensive omit in `projectTabForPersist`; wording tweak "migrated" in the `restoredViewMode` doc.
