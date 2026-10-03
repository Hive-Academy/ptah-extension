# Code Logic Review — `TASK_2026_555` Batch 15

Scope: the 4 files of the picker extension only.

- `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts` (modified)
- `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.spec.ts` (modified)
- `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.ts` (new)
- `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.spec.ts` (new)

Evidence read: both components in full, both specs in full,
`native-autocomplete.component.ts` and `native-option.component.ts` in full,
`keyboard-navigation.service.ts` in full, `batches.md` "## Batch 15",
`implementation-plan.md` Component 9 (§9, D12), `git diff` of the picker,
consumer assertions in `provider-consumer-assignments.component.spec.ts` and
`skills-lane-pickers.e2e.spec.ts`. Test run:
`npx jest --config libs/frontend/ui/jest.config.ts --rootDir libs/frontend/ui src/lib/native/provider-model-picker`
— **2 suites, 79 tests, all pass**.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues    | 2        |
| Failure modes found | 5        |

## Five logic questions

### 1. How does this fail silently?

The keyboard path can emit a model the user never navigated to in the current
panel session. `KeyboardNavigationService.activeIndex` persists across
close/reopen (finding 1), so Enter after a reopen picks the row highlighted in
the *previous* session. The emit is visible in the field text, so it is not
fully silent, but a keyboard user who expects Enter to confirm the first row
gets a different model. For screen reader users, `suggestion-N` id collisions
(finding 2) make `aria-activedescendant` announce an option of another
autocomplete instance with no visual symptom at all.

### 2. What user action produces unexpected behaviour?

Open the panel, browse with ArrowDown/ArrowUp, press Escape, reopen with
focus or click, press Enter: the row highlighted in the previous session is
selected (finding 1). Also: open the panel and press Enter with no navigation —
row 0 is the `''` sentinel, so a pinned model is cleared to "default tier"
(finding 4). The highlight is visible in both cases, which bounds the harm.

### 3. What input data makes this produce a wrong answer?

- Two `NativeAutocompleteComponent` instances on one page: both render
  options with `id="suggestion-0..N"` (`native-autocomplete.component.ts:124`,
  `native-option.component.ts:51`). The new field's own `popupId` is unique,
  the option ids are not.
- A catalogue larger than 50: correctly capped by
  `suggestions().slice(0, MAX_MODEL_SUGGESTIONS)` and covered by a test
  (`provider-model-search-field.component.spec.ts:128-141`). Not a defect.
- Empty catalogue: summary is null, select shows only the sentinel, error row
  unchanged. Covered (`provider-model-picker.component.spec.ts:962-966`).

### 4. What happens when a dependency fails?

- Loader rejects or returns `error`: unchanged pre-existing path — error row +
  Retry, `_models` emptied on rejection; generation counter discards stale
  responses. Regression-tested (`provider-model-picker.component.spec.ts:339-388`).
- Floating UI: mocked in both spec files because jsdom has no layout; the
  panel starts `visibility: hidden` until positioned. Not exercised here —
  pre-existing primitive contract, out of batch scope.
- `NativeAutocompleteComponent` API drift: the field calls
  `onKeyDown(event)`, `getActiveDescendantId()`, `activeIndex()` — all exist
  and are pinned by the keyboard test
  (`provider-model-search-field.component.spec.ts:178-186`).

### 5. What is missing that the requirements never mentioned?

- No reset of the keyboard navigation index when the panel opens (finding 1).
  The plan references the primitive (`native-autocomplete.component.ts:144-208`)
  but does not state the reopen contract, and the primitive has no public
  reset the field could call.
- Unique option ids were never required; the primitive hardcodes the
  `suggestion-` prefix (finding 2).
- The batches.md note "the `<select>` is byte-for-byte unchanged in
  behaviour" is imprecise: option labels gained a ` · tool use` suffix and a
  summary pill renders in both modes. The plan itself mandates this
  ("Always (both modes)", implementation-plan.md Component 9), so it is an
  intended change with an imprecise validation note, not a drift (finding 6).

## Failure modes

### 1. Stale active index across panel sessions

- Trigger: open the panel, navigate with arrows, close with Escape (or an
  outside click), reopen, press Enter.
- Symptom: Enter selects the row that was active in the previous session —
  possibly an index from a *filtered* list, so on reopen it points at an
  unrelated model in the full list.
- Evidence: `provider-model-search-field.component.ts:201-205` (`openPanel()`
  resets only the query) and `:207-210` (`close()` likewise);
  `native-autocomplete.component.ts:237-240` calls
  `keyboardNav.configure(...)` only when the `suggestions` input changes
  identity — and `suggestions` is a cached `computed` whose dependencies did
  not change between the two sessions, so `configure` (the only thing that
  resets the index, `keyboard-navigation.service.ts:configure`) never runs on
  reopen. Nothing else touches `activeIndex` between sessions.
- Current handling: none; the stale row is visibly highlighted and announced.
- Recommendation: reset the active index when the panel opens — either in the
  primitive's `isOpen` effect (`native-autocomplete.component.ts:241-247`,
  call `keyboardNav.reset()` on the opening branch) or by having the field
  re-seed the suggestions array on open. Add a spec: navigate, Escape, reopen,
  assert `aria-activedescendant` is `suggestion-0`.

### 2. `suggestion-N` DOM id collisions across autocomplete instances

- Trigger: any second `NativeAutocompleteComponent` on the same page as the
  search field (the redesigned Settings hosts several pickers; the primitive
  has other consumers).
- Symptom: duplicate `id` attributes (invalid HTML) and
  `aria-activedescendant="suggestion-N"` resolving to the first match in the
  document, which can belong to the other instance — a screen reader announces
  the wrong option text.
- Evidence: `native-autocomplete.component.ts:123-125`
  (`[optionId]="'suggestion-' + i"`), `native-option.component.ts:50-51`
  (host `'[id]': 'optionId()'`); the field relies on it via
  `provider-model-search-field.component.ts:94-96`.
- Current handling: the field makes only its `popupId` unique
  (`provider-model-search-field.component.ts:48-53,153`); option ids stay
  colliding.
- Recommendation: an inherited primitive defect — add an `optionIdPrefix`
  input to `NativeAutocompleteComponent` (default `'suggestion-'`), pass
  `` `${popupId}-suggestion` `` from the field. File it against the primitive,
  not this batch.

### 3. Enter on a freshly opened panel selects the sentinel

- Trigger: open the panel (focus/click) and press Enter without navigating.
- Symptom: emits `''` ("default tier") because `activeIndex` starts at 0 and
  row 0 is the sentinel — a pinned model is cleared. A native `<select>` opens
  on the *current* selection, so a user migrating from the select mode expects
  Enter to keep it.
- Evidence: `provider-model-search-field.component.ts:170-175` (sentinel
  first in `allOptions`), `keyboard-navigation.service.ts` (`configure` sets
  index 0 on first run), `native-autocomplete.component.ts:306-308` (Enter
  selects the active suggestion).
- Current handling: the highlight is visible; WAI-ARIA APG permits first-item
  focus on open, so this is compliant but a UX deviation from the control it
  replaces.
- Recommendation: on open, set the active index to the index of
  `selectedId()` in the rendered list (fall back to 0). Optional.

### 4. Escape closes through two listeners

- Trigger: Escape while the input is focused and the panel open.
- Symptom: `closed` is emitted twice — once from the input's keydown path
  (`native-autocomplete.component.ts:310-312`) and once from the host
  `(document:keydown.escape)` (`:71`, `:399-403`), because the `isOpen`
  input has not propagated yet when the document listener runs.
- Evidence: `provider-model-search-field.component.ts:232` and
  `native-autocomplete.component.ts:399-403`.
- Current handling: `close()` is idempotent, so there is no user impact.
- Recommendation: none required for this batch; the primitive could stop
  handling Escape in `onKeyDown` since the host listener already covers it.

### 5. `onInput` opens without the disabled guard

- Trigger: an `input` event reaching the element while `disabled()` is true —
  only possible programmatically, since the DOM input is disabled.
- Symptom: `_open` becomes true for a disabled field
  (`provider-model-search-field.component.ts:212-215`), unlike `openPanel()`
  which guards (`:202`).
- Evidence: as cited.
- Current handling: unreachable for a real user; inconsistent guard only.
- Recommendation: add the same `if (this.disabled()) return;` for symmetry.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. MODERATE — stale active index across reopen
   (`provider-model-search-field.component.ts:201-205`;
   `native-autocomplete.component.ts:237-247`). Fix in failure mode 1.
2. MODERATE — `suggestion-N` id collisions
   (`native-autocomplete.component.ts:123-125`). Inherited primitive defect;
   fix in failure mode 2.
3. MINOR — Enter-on-open selects the sentinel
   (`provider-model-search-field.component.ts:170-175`). Failure mode 3.
4. MINOR — `aria-controls` references the autocomplete host wrapper, not the
   `role="listbox"` element (`provider-model-search-field.component.ts:59,93`).
   The deviation is documented (`:148-152`) and asserted as a containment
   relation (`provider-model-search-field.component.spec.ts:204-214`). Acceptable;
   the primitive would need a listbox-id input to do better.
5. MINOR — double `closed` emission on Escape (failure mode 4).
6. MINOR — `onInput` missing the disabled guard (failure mode 5).
7. MINOR — test gaps: no reopen/stale-index test, no Home/End test, no
   Tab-closes-panel test, no Enter-with-no-match test
   (`provider-model-search-field.component.spec.ts`). The covered behaviour is
   otherwise behavioural (DOM reads, emission, ARIA attributes), not
   implementation-coupled.
8. OBSERVATION — "byte-for-byte unchanged" wording. The `searchable=false`
   render is **not** byte-for-byte: option labels gained
   ` · tool use` (`provider-model-picker.component.ts:106,235`) and the summary
   pill renders in both modes (`:243-264`). The plan mandates exactly this
   ("Always (both modes)", implementation-plan.md Component 9), and the
   user's "Settings-only" decision covers the *search* only, so there is no
   contradiction and no scope violation. Interaction behaviour (inputs,
   outputs, testids, selection semantics, disabled, retry, manual entry) is
   unchanged, and no downstream spec asserts exact model-option text
   (`provider-consumer-assignments.component.spec.ts:380-467` asserts
   `.value`; `skills-lane-pickers.e2e.spec.ts:435-443` uses `toHaveValue` and
   asserts text only on the *provider* option). The team leader should read the
   batches.md note as "interaction behaviour unchanged", not bytes.

## Data flow

Picker, searchable mode, user types and picks:

1. Host sets inputs `provider`/`model` → constructor effect syncs
   `_provider`/`_model` and starts `loadModels` — OK (pre-existing).
2. `loadModels` generation counter discards stale responses — OK
   (`provider-model-picker.component.ts:579,652-672`; regression test at spec
   `:355-388`).
3. `modelOptions` computed builds catalogue + pinned out-of-catalogue entry
   with `supportsToolUse: null` — OK (`:490-510`).
4. Field receives `options`, prepends the sentinel in `allOptions` — OK
   (`provider-model-search-field.component.ts:170-175`).
5. `suggestions` filters case-insensitively by name or id (id `''` excluded
   from id matching), caps at 50 — OK (`:178-189`).
6. Keyboard: field `onKeyDown` → primitive `onKeyDown` →
   `KeyboardNavigationService`; `aria-activedescendant` stays reactive because
   the template binding reads the `activeIndex` signal through
   `getActiveDescendantId()` — OK (`:94-96`; test `:178-186`) — EXCEPT the
   stale-index gap at step 6 on reopen (failure mode 1).
7. `choose()` closes and emits only when the id differs from `selectedId()` —
   matches native select change semantics — OK (`:235-238`; tests `:155-176`).
8. `selectModel` sets `_model` and emits `{provider, model}` — OK
   (`provider-model-picker.component.ts:604-607`).
9. `toolUseSummary` counts only the loaded catalogue — OK (`:517-524`; tests
   `:913-977`).

## Requirements fulfilment

| Requirement (batches.md 15.1 / plan §9) | Status | Gap |
| --- | --- | --- |
| `searchable = input(false)`, internal search field | COMPLETE | — |
| Default `false` keeps the native select (Memory, Thoth) | COMPLETE | Interaction unchanged; labels gained the plan-mandated suffix (issue 8) |
| Filter by name or id in a `computed`, capped at 50 | COMPLETE | — |
| Always-on per-option tool-use marker + summary, both modes | COMPLETE | — |
| Existing inputs, outputs, testids unchanged | COMPLETE | Spec pins all three (injector-surface, rendered-selection, labelling blocks) |
| New testids `provider-model-picker-search`, `provider-model-picker-tooluse-summary` | COMPLETE | Both asserted |
| Pinned "not in catalog" option kept (both modes) | COMPLETE | Tests `:840-853`, `:1103-1118` |
| Manual-entry `<details>` kept | COMPLETE | Tests `:837-905` |
| Picker under 700 counted lines | COMPLETE | 673 total lines |
| Search field not exported from the barrel | COMPLETE | `provider-model-picker/index.ts` omits it |
| No new injection (loader port unchanged) | COMPLETE | Source-scan test pins the single `inject()`; the field injects nothing |
| Stale-load handling | COMPLETE | Generation counter + regression test |
| memory-curator-ui / skill-synthesis-ui specs pass unchanged | PARTIAL | Not executed in this review (cost ceiling); 79/79 ui picker tests pass and a static sweep found no consumer assertion on model-option text |
| `dependency-boundaries.spec.ts` stays green | PARTIAL | Not executed here; no import outside `type:ui` was added (both files import only `@angular/core`, `@ptah-extension/shared`, and sibling ui files) |

Implicit requirements not addressed: reopen contract for the keyboard index
(failure mode 1); unique option ids (failure mode 2). Both live in the
primitive the plan pointed at without specifying these contracts.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty catalogue | YES | Summary null, sentinel only | None |
| Catalogue > 50 | YES | `slice` in computed + test | None |
| Pinned out-of-catalogue id, both modes | YES | Prepended option + tests | None |
| No match for the query | YES | `emptyMessage` "No models match" | Enter then does nothing (no test) |
| Rapid provider switch (stale load) | YES | Generation counter + test | None |
| Disabled while loading | YES | `[disabled]` on the input + tests | `onInput` guard asymmetry (issue 6) |
| Reopen after browsing | NO | Nothing resets `activeIndex` | Failure mode 1 |
| Two autocompletes on one page | NO | Option ids collide | Failure mode 2 |
| Enter immediately after open | YES (compliant) | Row 0 active | Selects the sentinel, clears a pin (issue 3) |
| Escape close | YES | Closes, no emit | Double emission, harmless (issue 5) |

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: a keyboard user reopening the search panel inherits the previous
  session's active row, so Enter can pick an unintended model (failure mode 1)
  — bounded by the visible highlight and the Settings-only opt-in.
- What a robust implementation would add:
  1. Reset the keyboard navigation index on panel open (primitive
     `isOpen` effect or field-side re-seed), with a reopen regression test.
  2. `optionIdPrefix` input on `NativeAutocompleteComponent`; the field passes
     its unique `popupId` so `aria-activedescendant` cannot cross instances.
  3. On open, move the active index to the currently selected option instead of
     row 0.
  4. Specs for Tab-close, Home/End, Enter-with-no-match, and reopen.
  5. Team leader wording fix: batches.md note should say "interaction behaviour
     unchanged", not "byte-for-byte", since option labels gained the
     plan-mandated suffix in the default mode.

Score rationale: 7/10 (sound). Every stated requirement is implemented and
behaviour-tested; stale-load, sentinel, cap and emission semantics are correct,
and 79/79 tests pass. The two moderate findings are keyboard/a11y edge cases
rooted in the shared primitive rather than in a broken requirement, which keeps
the batch out of the 5-6 band; the absence of any reopen contract and the
id-collision exposure keeps it below 8-9.