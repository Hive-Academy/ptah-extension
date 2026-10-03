# Code Logic Review — `TASK_2026_555` (Batch 15b)

## Round 2

Scope of this pass: only the changed lines (`git diff`) in `native-autocomplete.component.ts` (+ `.spec.ts`)
and `provider-model-search-field.component.spec.ts`, against the "## Review fixes" section of
`batch-15b-report.md` and the two moderate findings below.

**Finding 1 (Enter silently inert after typing from a suppressed reopen) — FIXED.**
`native-autocomplete.component.ts`'s `configure()` effect (constructor, first `effect()` block) now runs
`this._noActiveItem.set(false)` unconditionally before `this.keyboardNav.configure(...)`, so any suggestion-list
change — which fires whenever the parent's filtered array gets a new reference, i.e. every keystroke — clears
the suppression and (via `configure()`'s own `itemCount > 0 → index 0` rule) makes the first match active.
Traced the effect ordering for the one case that matters: opening the panel and changing the list on the same
tick. `applyOpenActiveIndex()` (effect 2, gated to the false→true transition) runs after effect 1 in
declaration order, so it can still re-suppress (`openActiveIndex === -1`) after effect 1 clears it — verified
directly by the new spec "should keep no row active on open when openActiveIndex is `-1`" still passing
unchanged, and by the new "should activate the first match when suggestions change while suppressed"
(`native-autocomplete.component.spec.ts`) which opens suppressed, then mutates the host's `suggestions` signal,
and asserts `activeIndex()` becomes `0` and Enter selects that row. The field-level case (typing after a
suppressed reopen because the pinned id isn't in the catalogue) is pinned by "selects the first match when
typing clears the suppressed state" in `provider-model-search-field.component.spec.ts`, which types `kimi` and
asserts Enter emits `'kimi-k2'` rather than staying inert. Fixed, and correctly distinguished from the
already-passing "-1, no typing, Enter is inert" case (both still hold).

**Finding 2 (report overstated reopen-highlight persistence) — FIXED.**
This is no longer a defect to fix in code — Round 1 already flagged it as "by design, not a regression, just
misleading wording" — so the fix here is documentation plus deliberate test coverage: the `openActiveIndex`
doc comment now states "The requested state holds only until the suggestion list changes... including after a
`-1` open" (`native-autocomplete.component.ts:216-219`), the report's "Reopen now highlights…" bullet was
rewritten to say the highlight is not sticky, and two new specs pin the hand-off explicitly: "should hand the
reopen highlight over to the first match when suggestions change" (primitive: opens at index 2, narrows the
list, asserts `activeIndex()` becomes `0` and Enter selects the new first row) and "holds the reopen highlight
until the user types, then targets the first match" (field: reopens on `kimi-k2` (row 3), types `k`, asserts
the active row moves to the sentinel row and Enter emits `''` rather than `'kimi-k2'`). Both specs read as
intentional-behaviour pins, not defect regressions. Fixed.

**Regression check (unique ids, `aria-controls` → listbox, `aria-activedescendant`, reset-on-reopen).** No
regression found:
- Per-instance id generation is untouched except a doc comment (`nextAutocompleteInstanceId` counter,
  `native-autocomplete.component.ts:56-62`); the "two instances on one page" and "never collides ids with a
  second field" spec blocks are present unchanged and pass.
- `[attr.id]="listboxId()"` on the panel and the `aria-controls` assertions in both spec files are unchanged
  and pass (`provider-model-search-field.component.spec.ts`'s "names the combobox..." test now also asserts
  `[role="listbox"][id="${controls}"]` directly, slightly tighter than before, still green).
- `getActiveDescendantId()` still returns `null` when `activeIndex() < 0` and `${optionIdPrefix()}-${index}`
  otherwise — unchanged logic, only the new unconditional `_noActiveItem.set(false)` in the configure effect
  changes *when* suppression is active, not how the descendant id is derived from it.
- The three original reopen specs ("reset to first row", "mark the requested row active on open and on
  reopen", "keep no row active on open when openActiveIndex is `-1`") are present unmodified and still pass,
  confirming the new unconditional clear in the configure effect did not disturb the no-typing reopen path.
- Minor 4 (id counter climbing by two per instance) was addressed with a doc comment only, as expected — no
  behaviour change, so nothing to regress.
- Minor 3 (no spec for Home/End from the suppressed state) remains open; explicitly deferred in the report and
  out of scope for this fix round.

**Verification.** Ran in the foreground from the worktree root:
`npx jest --config libs/frontend/ui/jest.config.ts --testPathPatterns "native/(autocomplete|provider-model-picker)"`
→ 3 suites, **118/118 passed** (up from 114 in Round 1, matching the report's count for the four added specs).

**Round 2 verdict:** APPROVED. Both moderate findings are fixed with direct, targeted specs (not just
assertions of absence of regression), and no regression was found in the id/aria/reset behavior verified in
Round 1. Outstanding: Minor 3 (Home/End-from-suppressed spec) remains unaddressed but was explicitly
out-of-brief and is not a defect — carry it forward only if a future batch touches this file again.

---

Scope: `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts` (+ `.spec.ts`) and
`libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.ts` (+ `.spec.ts`),
authored by a Glm CLI lane per `batch-15b-report.md`. Reviewed against the two Batch 15 moderate findings
(`batch-15-code-logic-review.md`: "stale active index across reopen", "`suggestion-N` id collisions") and
`batches.md` "## Batch 15b".

## Summary

| Metric              | Value  |
| -------------------- | ------ |
| Overall score        | 8/10   |
| Assessment           | APPROVED |
| Blocking issues      | 0      |
| Serious issues       | 0      |
| Moderate issues      | 2      |
| Failure modes found  | 2      |

## Five logic questions

### 1. How does this fail silently?

No case found where a failure produces a success-looking result. `applyOpenActiveIndex()`
(`native-autocomplete.component.ts:339-349`) treats every invalid/out-of-range `openActiveIndex` (including
programmer errors like passing `NaN` or a float) as "no active row" rather than throwing, which is the
documented and tested contract, not a silent failure — `getActiveDescendantId()` correctly returns `null` in
that state (`:468-471`) instead of a dangling id.

### 2. What user action produces unexpected behaviour?

- Typing while the panel is in the "no active row" state (opened with `openActiveIndex=-1`, e.g. the
  `provider-model-search-field`'s pinned-but-uncatalogued selection) narrows the filtered list but never
  highlights a row, even though `KeyboardNavigationService`'s internal index silently advances to `0` via the
  `configure()` effect (`native-autocomplete.component.ts:290-293`). This matches the documented contract
  ("Hover and arrow/Home/End navigation clear the suppression") — typing is deliberately excluded — but it is
  not stated anywhere as a requirement, and a user who types to find their pinned model and presses Enter
  before touching an arrow key gets no selection, with no visible reason. See Failure mode 1.
- None found for the id-prefix change: two `ptah-provider-model-search-field` instances (or two raw
  `ptah-native-autocomplete` instances) on the same page produce disjoint `listboxId`/`optionIdPrefix` values
  (module-level counters `nextAutocompleteInstanceId` at `:63` and `nextPopupId` at
  `provider-model-search-field.component.ts:49`, each a field initializer that runs once per instance
  construction), verified by the "two instances on one page" and "never collides ids with a second field"
  spec blocks.

### 3. What input data produces a wrong answer?

- None found in the reviewed diff for id generation or reopen semantics. `applyOpenActiveIndex()` correctly
  treats `requested < 0`, `requested >= count`, and `count === 0` all as "invalid" (`:342`), so a stale
  `openActiveIndex` computed from a shrunk catalogue (e.g. `provider-model-search-field.component.ts:167-169`'s
  `findIndex` returning `-1` when the pinned id drops out of the catalogue) degrades to "no active row" rather
  than mis-highlighting an unrelated row.

### 4. What happens when a dependency fails?

`KeyboardNavigationService` is a per-component-provided collaborator (`providers: [FloatingUIService,
KeyboardNavigationService]`, `:79`), not a remote dependency; its `configure()`/`reset()`/`setActiveIndex()`
are synchronous and cannot fail or return a wrong shape by construction (all consumers are covered by its own
spec, `keyboard-navigation.service.spec.ts`, unaffected by this batch). Not applicable beyond that; no network
or async collaborator is touched by this batch.

### 5. What is missing that the requirements never mentioned?

- Batch 15b's validation notes ask for arrow-entering-from-ends coverage but do not ask for Home/End coverage
  from the suppressed (`_noActiveItem`) state. The code handles it correctly (`_noActiveItem.set(false)` runs
  unconditionally before the Arrow-specific branch in `navigateActiveRow()`, `native-autocomplete.component.ts
  :356-369`, so Home/End also fall through to `keyboardNav.handleKeyDown()` with suppression already cleared),
  but no spec exercises Home/End from that state (Failure mode 2 below is a coverage gap, not a defect).
- No spec exercises "typing narrows the list while a row is highlighted from a prior `openActiveIndex`", i.e.
  whether a valid initial highlight survives the first keystroke. Tracing the effects: `effect(() => {
  configure(...) })` (`:290-293`) only re-fires when the autocomplete's own `suggestions` input signal changes
  reference, which happens whenever the parent's filtered list recomputes (every keystroke in
  `provider-model-search-field.component.ts:194-205`). Since `_noActiveItem` is untouched by `configure()`, a
  valid initial highlight (e.g. index 3) is silently overwritten to index 0 by the pre-existing configure
  effect on the very next keystroke. This reproduces the pre-15b default-tier behaviour (first match
  highlighted while typing) and is not a regression this batch introduced — the effect and its firing
  condition predate the diff — but it means "reopen highlights the selected model's row" only survives until
  the user's first keystroke, which the report's "Reopen now highlights the selected model's row" claim does
  not qualify.

## Failure modes

### 1. No highlight recoverable by Enter after typing from a suppressed reopen

- Trigger: field reopens with `openActiveIndex=-1` (pinned model not in catalogue), user types to filter, then
  presses Enter without ever pressing an arrow key or hovering a row.
- Symptom: Enter does nothing (`selectFocused()` reads `activeIndex()`, still `-1` because only
  `navigateActiveRow()`/`handleHover()` clear `_noActiveItem`, not typing) — no error, no toast, the user must
  notice nothing happened and press an arrow key or click instead.
- Evidence: `native-autocomplete.component.ts:339-349` (`_noActiveItem` set once on open, based only on
  `openActiveIndex`), `:426-432` (`selectFocused()`), `provider-model-search-field.component.ts:228-231`
  (`onInput` only sets `_query`/`_open`, never clears the parent's suppression signal — it cannot, since
  `_noActiveItem` is private to the child).
- Current handling: matches the documented contract in the class doc comment (`:215-220`) and is covered for
  the *non-typing* Enter-is-inert case (`native-autocomplete.component.spec.ts:440-458`), but the "user types
  then presses Enter" path is untested and the resulting inertness is not surfaced to the user in any way
  (no placeholder text, no visual "no match highlighted" cue beyond the absent highlight itself).
- Recommendation: either state this as an accepted UX tradeoff in the batch report (so a future reviewer does
  not re-flag it as a new defect), or have `onInput`/typing also clear suppression once the filtered list is
  non-empty, matching the "first row highlighted while typing" behaviour used everywhere else in this
  component.

### 2. Reopen-highlight is overwritten by the first keystroke (coverage gap, not a regression)

- Trigger: field reopens with a valid `openActiveIndex` (pinned model present in the catalogue, highlighted
  correctly), then the user types one character.
- Symptom: the highlighted row jumps from the selected model to the first filtered match, which may not be the
  previously-selected model, before any arrow key is pressed.
- Evidence: `native-autocomplete.component.ts:290-293` (pre-existing `configure()` effect, unmodified by this
  diff per `git diff`), interacting with the new `openActiveIndex` feature which only asserts the highlight
  "on open" (`native-autocomplete.component.spec.ts:426-438` only checks state immediately after
  `isOpen.set(true)` and after a stale `handleHover`, never after a keystroke).
- Current handling: none; behaviour is arguably correct (typing legitimately changes what "the active row"
  should mean) but the batch report's phrasing ("Reopen now highlights the selected model's row") reads as
  though the highlight is sticky, which it is not once the user types.
- Recommendation: no code change required; tighten the batch report wording, or add a one-line spec asserting
  the intentional hand-off from "reopen highlight" to "type-ahead highlight" so a future reader does not
  mistake the interaction for a regression.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. MODERATE — Failure mode 1: Enter is silently inert after typing from a suppressed reopen, with no spec
   coverage and no user-facing cue (`native-autocomplete.component.ts:339-349`,
   `provider-model-search-field.component.ts:228-231`).
2. MODERATE — Failure mode 2: batch report overstates reopen-highlight persistence; it does not survive the
   first keystroke, by design of a pre-existing effect this batch did not touch
   (`native-autocomplete.component.ts:290-293`).
3. MINOR — no spec exercises Home/End from the `_noActiveItem` suppressed state, even though the code path is
   correct by inspection (`native-autocomplete.component.ts:356-369`).
4. MINOR — `optionIdPrefix`/`listboxId` default generators each advance the same module counter
   (`nextAutocompleteInstanceId++` at `:203` and `:212`) even when a consumer always overrides both (as
   `provider-model-search-field.component.ts:61-62` does), so the counter climbs twice as fast as instances
   mounted. Harmless (ids stay unique and readable), but worth a one-line comment if a future reader tries to
   correlate the numeric suffix with an instance count.

## Data flow

1. Component construction: `optionIdPrefix`/`listboxId` inputs evaluate their default-value field initializers
   once per instance (`nextAutocompleteInstanceId++`), giving each mounted `NativeAutocompleteComponent` a
   unique pair even without an explicit binding — OK, confirmed unique and stable (no re-evaluation on change
   detection, since `input()` defaults are captured once at declaration).
2. Parent (`ProviderModelSearchFieldComponent`) constructs `popupId`/`listboxId`/`optionIdPrefix` as plain
   readonly string fields from its own module counter (`nextPopupId`), also once per instance — OK, and binds
   them explicitly, overriding the child's own generated defaults (harmless double-generation, item 4 above).
3. `isOpen` false→true transition: `effect()` at `:295-306` detects the transition via the `panelWasOpen`
   plain field (not a signal — correctly read only inside the effect that also writes it, no torn reads
   possible in Angular's single-threaded execution) and calls `applyOpenActiveIndex()` `untracked`, so the
   effect does not also subscribe to `openActiveIndex()`/`suggestions()` as reactive deps — OK, this is
   intentional (the reset must apply once per open, not on every later suggestions change).
4. `applyOpenActiveIndex()` reads the current `openActiveIndex()` and `suggestions().length()`, computes
   validity, and either calls `keyboardNav.setActiveIndex(requested)` or `keyboardNav.reset()`, plus sets
   `_noActiveItem` — OK, all branches produce a value in `[-1, count)` for the externally visible
   `activeIndex` computed.
5. Keyboard/hover interaction clears `_noActiveItem` and delegates to `KeyboardNavigationService` — OK,
   `KeyboardNavigationService.configure()`/`handleKeyDown()` keep the index within `[0, itemCount)`
   independent of the suppression flag, verified by the untouched `keyboard-navigation.service.spec.ts`.
6. Typing (search field `onInput`) changes `_query`, recomputing `suggestions()`, propagating a new array
   reference into the child's `suggestions` input, re-firing the pre-existing `configure()` effect — this
   silently overwrites a valid reopen highlight (Failure mode 2) and does not touch `_noActiveItem` (Failure
   mode 1's root cause) — gap, not a defect, documented above.
7. `getActiveDescendantId()` / template `[attr.id]` on each `ptah-native-option` both derive from the same
   `optionIdPrefix()` signal read in the same change-detection pass — OK, cannot desync within one tick.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Per-instance unique, stable ids (SSR not relevant) | COMPLETE | none |
| `aria-controls` points at the listbox element's id | COMPLETE | none — verified in both components' specs |
| `aria-activedescendant` always resolves to an existing option id, or is absent | COMPLETE | none found in the reviewed code path; see Data flow step 7 |
| Active index resets correctly on every closed→open transition (selected/first/none) | COMPLETE | verified by 3 spec cases (`:407-458`) |
| Arrows enter from the ends when reopened with no active row | COMPLETE | verified (`:454-458`) |
| Enter inert while none active | PARTIAL | inert immediately after open (tested), but not re-verified after a keystroke while still suppressed (Failure mode 1) |
| Stale duplicate `activeIndex` member removed cleanly | COMPLETE | only one declaration remains (`grep` confirms), no consumer depended on the old field identity beyond calling it as a function |
| Existing consumers of `NativeAutocompleteComponent` keep working with defaults | COMPLETE | only consumer in `libs/frontend` is `provider-model-search-field.component.ts`, which overrides both new ids explicitly; no other library imports the component |

Implicit requirements not addressed: batch report's claim that reopen highlighting is durable through
subsequent typing (see Failure mode 2 — cosmetic documentation gap, not a code defect).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Two autocompletes/fields mounted at once | YES | disjoint module counters, per-instance field initializers | none |
| Reopen with valid selected index | YES | `applyOpenActiveIndex` sets it via `keyboardNav.setActiveIndex` | overwritten by first keystroke (Failure mode 2, by design) |
| Reopen with `-1`/out-of-range index | YES | `_noActiveItem` suppression, `getActiveDescendantId()` returns `null` | Enter stays inert even after typing (Failure mode 1) |
| Reopen with `null` (default) | YES | `keyboardNav.reset()` — first row if any, else `-1` | none |
| Empty suggestions on open | YES | `count===0` makes any non-null requested index invalid, `reset()` yields `-1` | none |
| Home/End from suppressed state | YES (by inspection) | `_noActiveItem.set(false)` runs unconditionally before the Arrow-specific branch | no direct spec (Minor 3) |
| Hover while suppressed | YES | `handleHover()` explicitly clears `_noActiveItem` | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a user who types to search after reopening a field whose current selection isn't in the catalogue
  gets no visible highlight and Enter does nothing, with no affordance explaining why (Failure mode 1). It is
  consistent with the documented contract, not a crash or data-loss risk, and is easily deferred to a follow-up
  batch or accepted as-is by the team-leader.
- What a robust implementation would add: (1) a spec asserting Home/End correctly recovers from the suppressed
  state, (2) either a design decision to highlight the first filtered match while suppressed-and-typing (so
  Enter is never a no-op once a match exists) or an explicit acceptance note in the batch report, (3) a spec
  pinning that a reopen highlight is expected to hand off to type-ahead highlighting on the first keystroke, so
  the report's wording cannot be misread as "sticky through typing" by a later reviewer.
