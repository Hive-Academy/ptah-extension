# Code Logic Review — Batch 7 (`TASK_2026_494`, surface input components)

## Summary

| Metric              | Value      |
| -------------------- | ---------- |
| Overall score         | 8/10       |
| Assessment             | APPROVED   |
| Blocking issues        | 0          |
| Serious issues         | 0          |
| Moderate issues        | 2          |
| Failure modes found    | 2          |

Scope: `surface-text-input.component.ts` (+spec), `surface-choice-input.component.ts` (+spec),
`surface-checkbox-input.component.ts` (+spec), all under
`libs/frontend/declarative-dashboard/src/lib/components/`. Re-ran
`npx nx run-many -t test -p @ptah-extension/declarative-dashboard --skip-nx-cache`: green, matching the
report's 114-passed claim.

## Rulings

### (a) `draftChange` output (`SurfaceDraftWrite`) — ACCEPT

`inputCommit` alone cannot satisfy plan:767 ("Draft on every keystroke into `viewState.drafts`"): it only
fires on blur/Enter/600 ms, never per keystroke
(`surface-text-input.component.ts:150-154`). A per-keystroke write has to leave the component some other
way, and it has to land in *shared* view state rather than local component state, because (1) the plan
explicitly says drafts survive a destroy (batch-7-report.md item 4, "unsent text drafts stay in view state
after a destroy, and no commit fires" — consistent with `handoff-494.md`'s Rule 4 wording that a draft is a
display overlay dropped only on echo/read, not on unmount) and (2) `handoff-494.md:143` notes several
inputs may bind the same path and must show one value, which only a shared store can guarantee. A
purely-local buffer could not do either. The output's shape (`componentId`, `value | undefined` to remove)
is the minimum the B8 renderer needs to fold into `SurfaceViewState.drafts` and `viewStateChange`. Choice
and checkbox correctly have no such output since they never draft (`surface-choice-input.component.ts:98`,
`surface-checkbox-input.component.ts:58` have no `draftChange`).

### (b) Choice/checkbox snap-back — ACCEPT, with one caveat carried to B8

`restoreDom()` (`surface-choice-input.component.ts:159-164`) and the checkbox `toggle()`
(`surface-checkbox-input.component.ts:92-99`) unconditionally reset the control's DOM state to
`displayedValue()` after every native change, whether or not `inputCommit` fired. This is pinned directly:
"keeps the DOM on the displayed value until the parent applies the commit"
(`surface-choice-input.component.spec.ts:95-101`, `surface-checkbox-input.component.spec.ts:68-74`) and
"restores the checked radio when the parent does not apply the commit"
(`surface-choice-input.component.spec.ts:166-171`), both exercised with `applyCommits` held false. No value
is lost: the DOM reverts to whatever `displayedValue()` still is, which is the last value the parent
actually accepted. There is a real, brief flicker for the case where `checkDraftValue` *does* pass and
`inputCommit` *is* emitted (native `checked`/`selectedIndex` moves the instant the browser processes the
click, then the synchronous `change` handler snaps it back before the parent's pending overlay lands) — this
is the standard "controlled input" pattern and is deliberate, matching Rule 4's "display overlay, not host
state" framing. What is not covered by this batch, because the pending-overlay/host-rejection machinery
does not exist yet, is what the user sees when the host itself later rejects the commit (`stale-revision`,
`busy`, etc. per `handoff-494.md`'s state table): `errorText` is driven by `checkDraftValue`, which already
passed locally, so no error text will appear even though the value silently reverts. That is out of this
batch's scope (B8/B13 own the reject-to-view-state wiring) but should be an explicit carry-item so the
revert is not permanently silent.

### (c) `role="radiogroup"` on the fieldset — ACCEPT

`fieldset` + `legend` natively expose an implicit ARIA role of `group`, which the ARIA in HTML AAM has no
support for `aria-required`/`aria-invalid`. Setting `role="radiogroup"`
(`surface-choice-input.component.ts:62`) is exactly the documented technique for putting a fieldset-based
radio group into a role that accepts those states, and the `legend` continues to supply the group's
accessible name regardless of the explicit role (HTML-AAM's fieldset/legend name computation is unaffected
by an ARIA role override here). This is not a double announcement: the role is a single group-role
assignment, and the legend text is read once as that group's name, not as separate content. The spec at
`surface-choice-input.component.spec.ts:142-154` confirms the legend text, `aria-required` on the fieldset,
and unique per-option ids/labels/names, which is the observable surface a screen reader would use.

### (d) Duplicated label/error/issue helpers — CARRY-TO-B8

`plainText`/`errorText`/`issueTexts`/`describedBy`/`issueId` are near-identical across all three files (for
example `errorText` at `surface-text-input.component.ts:130-136`, `surface-choice-input.component.ts:126-131`
and `surface-checkbox-input.component.ts:75-80` differ only in whether a `plainText` description exists).
This is real duplication but not a behavioural defect — each copy is independently correct and independently
spec-pinned. B8 is the batch that next touches all three components together (composing them into
`SurfaceNodeComponent`), so it is the natural point to extract a shared helper (as the report itself
proposes) without re-opening this batch's already-reviewed, already-green files. Not blocking here.

### (e) Neutral error text — ACCEPT

The prototype's own rollback-form error line is neutral: `prototype/index.html:336`, `<p id="fReasonErr"
class="text-[11px] text-base-content mt-1 is-hidden">Reason is required before submitting.</p>` — no
`text-error`/`text-red-*` class. The component's `text-xs font-medium text-base-content`
(`surface-text-input.component.ts:71`, and the equivalent lines in the other two files) matches that
choice and is consistent with the same call already made and accepted for submit status text in Batch 6
(`batches.md:341`, "The submit status is neutral text, not the prototype's green 'Sent'"). Carried, like
Batch 6's, to the R10 visual gate for a design-intent check, not a logic defect.

## Executor's claimed draft fixes — confirmed

1. **Last typed text commits even before the parent writes the draft back.** `commitDraft()` reads
   `this.typedText ?? this.drafts()[node.id]` (`surface-text-input.component.ts:183`), and `typedText` is
   set on every `draftInput` call (`:151`) independent of the `drafts` input round-trip. Directly exercised
   by "commits once 600 ms..." (`surface-text-input.component.spec.ts:87-100`), which advances fake timers
   without ever forcing a `drafts()` re-render before the debounce fires, and the commit still carries the
   typed value.
2. **`inputCommit` before the draft removal.** `commitDraft()` emits `this.inputCommit.emit(...)` at
   `:187` strictly before `this.draftChange.emit({ componentId: node.id, value: undefined })` at `:188`.
   Both are synchronous `output()` emits handled in source order by whatever the parent wires to each, so a
   parent that raises its pending overlay on `inputCommit` will have done so before the draft disappears —
   no frame where neither the draft nor the overlay is present.
3. **Enter during IME composition does not commit.** `commitOnEnter` returns early when
   `event instanceof KeyboardEvent && event.isComposing` (`:157-160`), pinned by
   `surface-text-input.component.spec.ts:111-118`, which dispatches a `KeyboardEvent` with
   `isComposing: true` first (no commit) then a plain Enter (commits). Confirmed by the actual test run in
   this review (green).

## Five logic questions

### 1. How does this fail silently?

- Choice/checkbox: if the parent applies `inputCommit` to a `pendingValues` overlay but that mutation is
  later rejected by the host (a state this batch does not yet wire), the control silently reverts with no
  error text, because `checkDraftValue` already passed locally and is the only source `errorText` consults
  (`surface-choice-input.component.ts:126-131`, `surface-checkbox-input.component.ts:75-80`). See ruling
  (b). This is a real "success-looking" gap, but it is explicitly deferred state that B8/B13 own; nothing in
  this batch claims to handle it.
- None of the three components swallow an exception from `checkDraftValue`/`readSurfacePath` — those are
  pure functions from the verified contract, called synchronously and never wrapped in a try/catch that
  could hide a throw.

### 2. What user action produces unexpected behaviour?

- Pressing Enter and then immediately blurring (for example via a script-driven Tab, or an Enter handler
  elsewhere that also moves focus) could, in principle, re-read a `drafts()[node.id]` value that has not
  yet been cleared by the parent's change-detection cycle, since `commitDraft()` falls back to the shared
  `drafts` input once `typedText` is cleared (`:183`). In practice this is guarded by Angular's own
  change-detection scheduling (zone or signal-based CD flushes between distinct native DOM event
  dispatches), and by the fact that a real parent's `inputCommit` handler is expected to update
  `pendingValues` synchronously too, which would make the "unchanged" comparison at `:187` fail on the
  second attempt even if `drafts()` were stale. No spec exercises this interleaving directly. See Moderate
  issue #1.
- Selecting the same select/radio value the control already displays never emits an event a user could
  trigger through the UI (the control is already at that state), so this is not reachable through normal
  interaction; the specs only reach it by force-dispatching a `change` event, which the "unchanged" check
  correctly absorbs (`surface-choice-input.component.spec.ts:162-164`).

### 3. What input data produces a wrong answer?

- A stored data-model value of the wrong type (`form.reason: 42`, `form.notify: 'yes'`, `form.env: 'mars'`)
  is turned into the kind's empty value plus a `draftError`, upstream in `surface-view-model.ts:63-70`, and
  each component surfaces that error until a valid draft replaces it — pinned in all three specs (for
  example `surface-checkbox-input.component.spec.ts:92-99`). No component re-derives or second-guesses that
  upstream decision.
- A malformed `options` entry (wrong types, non-array) is filtered by `isOption`
  (`surface-choice-input.component.ts:27-31`) rather than thrown; `displayedIndex` correctly returns `-1`
  for a value no longer present in the filtered list, so a stale selection does not silently point at the
  wrong (shifted) option index — the index mapping is always derived from the *filtered* `options()`, not a
  raw array position.

### 4. What happens when a dependency fails?

- `checkDraftValue` and `readSurfacePath` are pure, verified, and cannot themselves fail with a thrown
  exception under contract; if they ever did, nothing in these three components would catch it and the
  whole node would fail up to `SurfaceNodeComponent`'s `@default`/`renderFailed` path (per plan:753) — out
  of this batch's scope, correctly.
- There is no host RPC dependency reachable from these components at all; every emitted event
  (`inputCommit`, `draftChange`) is fire-and-forget from the component's own point of view by design — the
  parent (B8/B13) owns delivery, retry, and timeout. That is the documented seam, not a gap in this batch.

### 5. What is missing that the requirements never mentioned?

- No mechanism ties a text input's local `typedText` buffer to an *external* clearing of
  `drafts()[node.id]` (i.e., the shared draft disappearing without this component's own `commitDraft()`
  having run). Today nothing in the documented design clears a draft except the owning component itself, so
  this is inert under the current contract, but it is an assumption worth stating explicitly for B8, since a
  future "discard draft" affordance or a wholesale `viewState` reset during a submit flush would silently
  resurrect the old buffer on the next blur/Enter/debounce. See Moderate issue #2.
- No visual distinction (only neutral text) between a local validation error and a host-side rejection once
  B8 wires the latter in — acceptable for now (ruling (e)), but worth flagging so B8 doesn't assume
  `errorText` already covers host rejections.

## Failure modes

### Stale local buffer outlives an externally-cleared shared draft

- Trigger: something other than the component itself clears `viewState.drafts[componentId]` while the
  component is still mounted and its debounce timer is armed (not possible with the code in this batch or
  the plan's documented behaviour today, but plausible once B8 wires a resync/read path that touches view
  state).
- Symptom: the displayed value reverts (draft gone from `drafts()`), yet a subsequent blur/Enter/debounce
  fire still commits the old typed text, because `commitDraft()` only clears `typedText` on its own commit
  path (`surface-text-input.component.ts:180-189`), never on an external draft change.
- Evidence: `surface-text-input.component.ts:94, 151, 183-186` (no `effect()` or similar observing
  `drafts()` transitions to invalidate `typedText`).
- Current handling: none; the design implicitly assumes only this component ever writes or clears its own
  draft entry.
- Recommendation: either document this invariant explicitly as a B8 contract ("nothing but the owning
  input's own `draftChange` ever removes its entry"), or add a defensive `effect()` that resets `typedText`
  to `undefined` whenever `drafts()[node.id]` becomes `undefined` without this component having just
  performed the commit that caused it.

### Silent revert on a host-level rejection (choice/checkbox/text alike)

- Trigger: the parent applies a `pendingValues` overlay on `inputCommit`, then the host later rejects that
  mutation (e.g. `stale-revision`, `busy`) — a state this batch cannot produce on its own, since it has no
  RPC access.
- Symptom: once the parent removes the overlay (per its own future rejection handling), the control reverts
  to the host value with no explanation. `errorText` in all three components is driven solely by
  `checkDraftValue`, which already passed before the commit was even sent
  (`surface-choice-input.component.ts:126-131`, `surface-checkbox-input.component.ts:75-80`,
  `surface-text-input.component.ts:130-136`), so a host-side rejection has no text to attach itself to.
- Evidence: no `issues()`/rejection channel is consulted anywhere for a *change*-type rejection (only
  `issues()` for submit-time issues, which is a different flow).
- Current handling: none in this batch; deferred by design to B8/B13, which own the RPC and rejection
  reducers.
- Recommendation: when B8 wires host rejections for `change`/`select`, either surface a transient notice
  through the same `issues` channel these components already read, or add a dedicated `rejection` input
  down this same path.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate #1: Enter-then-immediate-blur (or any two same-tick DOM events) is not spec-covered for the text
  input's double-commit safety; the safety currently relies on Angular's CD timing plus an assumed
  synchronous `pendingValues` write by the real parent (`surface-text-input.component.ts:113-116, 183-188`).
  Recommend a regression spec once B8 exists to drive both signals through a realistic parent.
- Moderate #2: see "Stale local buffer outlives an externally-cleared shared draft" above.
- Minor: `plainText`/`describedBy`/`issueTexts`/`issueId` duplication across the three files (ruling (d)),
  non-blocking, recommended for B8's extraction pass.
- Minor: the report's own note 3 in `batch-7-report.md` ("`fieldset` carries `role="radiogroup"`") is
  correctly reflected in code; no discrepancy found between the report and the diff.

## Data flow

1. `node()` input arrives from the (not-yet-built) B8 renderer, itself produced by
   `buildSurfaceViewModel`/`mapInput` (`surface-view-model.ts:72-91`) — OK, verified upstream in Batch 6.
2. `drafts()`/`pendingValues()`/`issues()` inputs default to shared empty constants
   (`NO_DRAFTS`/`NO_PENDING_VALUES`/`NO_ISSUES`) so an unwired host renders safely — OK.
3. `displayedValue()` applies Rule 4 order (draft ?? pending ?? host) in all three components identically —
   OK, matches plan:775 and is spec-pinned per component.
4. User input (`draftInput`/`chooseIndex`/`toggle`) either writes a local draft (text) or evaluates
   `checkDraftValue` + an equality gate before emitting `inputCommit` (choice/checkbox) — OK, matches the
   "never per keystroke", "invalid draft never committed", "unchanged not committed" pins.
5. On commit, the text input clears its own debounce and local buffer, emits `inputCommit` then
   `draftChange(undefined)` — OK, order matches the no-flash requirement (plan:770-771).
6. Choice/checkbox restore the DOM to `displayedValue()` unconditionally after every native change — OK,
   matches the controlled-input contract, with the caveat in ruling (b)/failure mode 2 about what happens
   after this batch's boundary (host rejection) — GAP, but out of scope by design.
7. `DestroyRef.onDestroy` clears the text debounce; choice/checkbox have no timers to clear — OK, matches
   "one debounce timer per instance, cleared on commit and on destroy".

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| No `inputCommit` per keystroke | COMPLETE | None |
| Commit on blur, Enter, 600 ms (text) | COMPLETE | None |
| Commit on change (choice/checkbox) | COMPLETE | None |
| Invalid draft never committed | COMPLETE | None |
| Unchanged value not committed | COMPLETE | None |
| One debounce timer per instance, cleared on commit/destroy | COMPLETE | None |
| Displayed value = draft ?? pending ?? host | COMPLETE | None |
| Select "—" maps to `null` | COMPLETE | None |
| `fieldset` + `legend` | COMPLETE | None |
| `label for`, `aria-required`, `aria-invalid`, `aria-describedby` | COMPLETE | None |
| Per-instance ids | COMPLETE | None |
| `data-apps-focus-key` | COMPLETE | None |
| No style | COMPLETE | None |
| Literal text (no markup execution) | COMPLETE | None |
| Malformed options skipped, never throw | COMPLETE | None |
| IME-safe Enter commit | COMPLETE | None |
| Draft-into-`viewState.drafts` output contract | COMPLETE (plan-silent, judged ACCEPT) | B8 must wire `draftChange` into `viewState.drafts`/`viewStateChange` |

Implicit requirements not addressed: a rejection channel for `change`/`select` commits (deferred to B8/B13
by design, tracked above); shared helper extraction for the duplicated label/error/issue logic (deferred to
B8 by design).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Blur fires before parent's draft round trip | YES | `typedText` local cache read first | None (fix #1 confirmed) |
| Parent never applies a commit (choice/checkbox) | YES | DOM restored to `displayedValue()` | No error surfaced (deferred, see ruling b) |
| Enter ends IME composition | YES | `event.isComposing` guard | None (fix #3 confirmed) |
| Malformed `options` entries | YES | `isOption` filter, index computed off filtered list | None |
| Two instances of the same component | YES | module-scope incrementing counters per file | None |
| Host value wrong type | YES | upstream `draftError` shown until valid draft | None |
| Enter immediately followed by blur (same tick) | NOT SPEC-COVERED | Relies on Angular CD timing + assumed synchronous parent overlay write | Moderate #1 |
| External clearing of a component's own shared draft | NOT APPLICABLE TODAY | No such clearer exists in the current design | Moderate #2, latent |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the anti-double-commit guarantees for the text input (Enter-then-blur, and any future external
  clearer of `viewState.drafts`) are correct only under assumptions this batch cannot itself verify, because
  the parent that would exercise them (B8) does not exist yet. Neither is a defect in the code reviewed
  here; both are carry-items for B8's specs.
- What a robust implementation would add: a regression spec (in B8, once a real parent exists) that fires
  Enter immediately followed by blur without an intervening change-detection tick, to prove no double
  `inputCommit`; and either a documented invariant or a defensive `effect()` guarding `typedText` against an
  externally-cleared shared draft.
