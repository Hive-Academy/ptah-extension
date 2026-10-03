# Batch 15b report — TASK_2026_555

**Executor**: frontend-developer
**Status**: complete

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\autocomplete\native-autocomplete.component.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\autocomplete\native-autocomplete.component.spec.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\provider-model-picker\provider-model-search-field.component.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\provider-model-picker\provider-model-search-field.component.spec.ts` (modified)

## What each change does

### `native-autocomplete.component.ts`

Fixes both Batch 15 review findings in the primitive itself:

- **Per-instance option-id prefix** (review finding: `suggestion-{i}` id collisions).
  New input `optionIdPrefix` with a generated per-instance default
  (`ptah-native-autocomplete-option-{n}`). The rendered options bind
  `[optionId]="optionIdPrefix() + '-' + i"`, and `getActiveDescendantId()`
  reports the same prefixed id, so two autocompletes on one page never
  produce colliding DOM ids.
- **Listbox id exposed**: new input `listboxId` with a generated per-instance
  default. The panel now renders `role="listbox" [attr.id]="listboxId()"`,
  so a consumer's `aria-controls` can point at the listbox itself.
- **Active index reset on reopen** (review finding: stale active index).
  New input `openActiveIndex` (`number | null`, default `null`). On each
  false-to-true transition of `isOpen`, the component applies it: a valid
  index becomes the active row (so reopen highlights the selected item),
  `null` resets to the first row (previous default behaviour, unchanged),
  and `-1` or any out-of-range index leaves the panel with no active row.
  `KeyboardNavigationService` cannot hold index `-1`, so a private
  `_noActiveItem` signal merges into an `activeIndex` computed. Hover,
  arrow/Home/End navigation and a changed suggestion list (the user typed)
  clear the suppression; arrows enter from the
  list ends (ArrowDown -> first row, ArrowUp -> last row); Enter on a
  suppressed panel emits nothing, so a stray Enter cannot pick a row the
  user never navigated to.

### `provider-model-search-field.component.ts`

- Wires the new inputs: `[listboxId]`, `[optionIdPrefix]`, and
  `[openActiveIndex]` bound to a computed that finds the selected model's
  row (`-1` when the pinned id is not in the catalogue, so the sentinel row
  is not falsely active).
- The combobox input's `aria-controls` now points at the listbox id
  (previously it pointed at a wrapper id that the panel did not carry).
- `aria-activedescendant` comes from the autocomplete's
  `getActiveDescendantId()` and therefore uses the prefixed ids.
- Reopen now highlights the selected model's row until the first
  keystroke, which also fixes the optional review finding 3: a stray
  Enter after a close/reopen no longer clears a pinned model to the
  sentinel. The highlight is not sticky: when the user types and the
  filtered list changes, the first matching row becomes active (the
  pre-existing `configure()` effect, now pinned by a spec).

### Spec files

- Primitive spec: `HostComponent` gained an `openActiveIndex` binding; new
  describes cover per-instance ids (listbox id rendered, option ids from the
  prefix, two mounted instances with disjoint listbox/option ids, each
  activedescendant resolving only inside its own panel) and the reopen
  contract (default reset to first row, requested row honoured across
  reopen, `-1` leaving no active row, Enter emitting nothing, arrows
  entering from the ends). Existing assertions updated from the old
  `suggestion-{i}` ids to the prefix form.
- Field spec: updated keyboard and aria assertions to the new prefixed ids
  and the listbox-owning `aria-controls` target; new tests cover reopen
  highlighting the selected model, the sentinel row when nothing is pinned,
  no active row when the selection is not in the catalogue, and id
  disjointness across two mounted fields.

## Risks handled

- **Default behaviour preserved**: `openActiveIndex` defaults to `null`,
  which resets to the first row on open — identical to the pre-existing
  `configure()` initial state. All pre-existing primitive tests pass
  unchanged in substance; only id-string assertions were updated.
- **Duplicate class member**: an intermediate edit left both the new
  `activeIndex` computed and the old `readonly activeIndex =
  this.keyboardNav.activeIndex` in the class. The stale second declaration
  shadowed the computed and made the `-1` suppression inert. It was
  removed; only the computed remains.
- `KeyboardNavigationService` is outside this batch's file list, so the
  `-1` state was built in the primitive without touching the service.

## Verification

Command (Batch 15b verify, run in the foreground):

```
npx nx run-many -t typecheck,test,lint -p @ptah-extension/ui @ptah-extension/chat @ptah-extension/memory-curator-ui @ptah-extension/skill-synthesis-ui
```

Result: **pass** — "Successfully ran targets typecheck, test, lint for 4
projects", 12/12 tasks successful, 0 failed.

Targeted suites for the changed code
(`src/lib/native/autocomplete`, `src/lib/native/provider-model-picker`):

```
Test Suites: 3 passed, 3 total
Tests: 117 passed, 117 total
```

(One jest worker-exit warning appears; it is a pre-existing teardown warning
in the harness, not a failure.)

## Review fixes

Source: `batch-15b-code-logic-review.md`, moderate findings 1 and 2 (plus minor 4).

Behaviour after the fixes: the reopen state (a highlighted selected row, or
no active row for `-1`) lasts only until the user types. A changed
suggestion list makes the first match active, so Enter selects it. Earlier
wording in this report that implied the reopen highlight was durable is
corrected above.

**What the Glm lane did before hitting its usage limit:**

- `native-autocomplete.component.ts`: the `configure()` effect now clears
  `_noActiveItem` whenever the suggestion list changes. That fixes finding 1
  (Enter stayed inert after typing from a `-1` reopen). It also makes
  finding 2 deliberate: typing moves the highlight to the first match.
  `applyOpenActiveIndex()` runs after that effect on an open tick, so the
  open contract still applies when the list changes on the same tick.
- Primitive spec: added "activate the first match when suggestions change
  while suppressed" (reopen with `-1`, change the list, Enter selects the
  first match). Added "hand the reopen highlight over to the first match
  when suggestions change".
- Field spec: added "selects the first match when typing clears the
  suppressed state" (pinned model not in the catalogue, type `kimi`, Enter
  emits `kimi-k2`).
- Report: rewrote the "Reopen now highlights…" bullet to say the highlight
  is not sticky.

**What I did to finish it:**

- Checked every lane edit against the review. The code fix and its specs
  were complete and correct. I found no half-applied change.
- Field spec: added "holds the reopen highlight until the user types, then
  targets the first match". It reopens on `kimi-k2` (row 3), types `k`, and
  checks two things: the active row moves to the first match (the
  sentinel), and Enter emits `''`, not the old highlight.
- `native-autocomplete.component.ts`: extended the `openActiveIndex` doc to
  say the requested state holds only until the list changes. Added a
  comment that the id counter advances twice per instance (minor 4).
- Report: this report said only hover and arrow keys cleared the
  suppression. I corrected it to include typing, and added this section.
- Batch 15b behaviour is unchanged: per-instance unique ids,
  `aria-controls` pointing at the listbox id, `aria-activedescendant` from
  the prefixed option ids, and the reset on reopen. The existing specs for
  all of these still pass.

Verification (foreground):
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/ui @ptah-extension/chat @ptah-extension/memory-curator-ui @ptah-extension/skill-synthesis-ui --parallel=2`:
"Successfully ran targets typecheck, test, lint for 4 projects". Targeted
uncached run (`nx test @ptah-extension/ui --skip-nx-cache`,
autocomplete + provider-model-picker suites): 3 suites, 118/118 tests passed.

Not addressed: minor 3 (no spec for Home/End from the suppressed state).
The code path is correct by inspection, and the fix brief did not include it.

## Not done

Nothing from the batch scope. The review's optional finding 3 (Enter after
reopen clears a pinned model) is also fixed and covered by tests, since the
reopen contract required the same code path.