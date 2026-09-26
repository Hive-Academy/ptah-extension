# Code Logic Review — `TASK_2026_494_ca38` (Batch 20, round 1)

## Summary

| Metric              | Value          |
| -------------------- | -------------- |
| Overall score        | 6/10           |
| Assessment            | NEEDS_REVISION |
| Blocking issues       | 0              |
| Serious issues        | 1              |
| Moderate issues       | 3              |
| Failure modes found   | 5              |

Scope examined: full diff of `libs/frontend/core/src/lib/services/electron-layout.service.ts` (+`.spec.ts`),
`libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts`, and the new
`apps-page-splitter.spec.ts` (374 lines, 11 tests). Independently re-read `ElectronResizeHandleComponent`
and `RESIZE_HANDLE_STYLES` (unchanged, `libs/frontend/chat-ui/src/lib/atoms/`), and the sole other consumer
pattern (`electron-shell.component.ts:224-236`). Ran both spec files directly (not trusting the report's
numbers): `apps-page-splitter.spec.ts` 11/11 green, `electron-layout.service.spec.ts` 97/97 green.
`ptah_get_diagnostics` scoped to the two changed files shows no new production error (all reported
diagnostics are pre-existing, in sibling spec/testing files the diff never touches). Grepped the whole repo
for `LAYOUT_STATE_KEY` and every `.setState(` call under `libs/frontend` to verify the write-path trace
independently rather than trust `batch-20-report.md`'s claim of "exactly one writer" — confirmed true.

The implementation is well-built on almost every axis the batch brief named: pointer/grab-offset math is
exact, the write-path trace holds up under independent grep, clamping and non-finite rejection are layered
correctly (page then service), ARIA wiring is complete and reactive, the ResizeObserver is disconnected on
destroy, and B15's "no width state on the page" guarantee is honestly kept (the page holds only a measured
container width and two ephemeral per-gesture fields). It falls to NEEDS_REVISION on one real, silent,
easily-reachable defect (below) that the test suite does not cover, plus a design gap in the
commit-on-destroy symmetry between keyboard and pointer gestures.

## Check table

| # | Check item | Status | Evidence |
| - | ---------- | ------ | -------- |
| 1 | Pointer-offset / grab-offset math, no jump on pointer-down | PASS | `apps-page.component.ts:337-349`; verified algebraically (`onSplitPointerDown` offset = `clientX0 - left - width0`; `onSplitDragMoved` then recovers `width0` at `pointerX == clientX0`) and against `apps-page-splitter.spec.ts:241-250` |
| 2 | Escape/blur restores drag-start width; restoring does not persist | PARTIAL | Restore itself is exact (`apps-page.component.ts:345-349`, spec `:284-299`), but `onSplitDragEnded` (`:351-354`) unconditionally calls `commitAppsSplitWidth()` on every `dragEnded`, including a restore. The write is idempotent in value but is a real `vscodeService.setState` + IPC round trip on every Escape/blur/no-op click. See Moderate M-2. |
| 3 | Persist on commit only, never per drag frame, via `persistLayout()` without dropping fields | PASS | `setAppsSplitWidth` (`electron-layout.service.ts:215-220`) only updates the signal; `persistLayout()` (`:612-624`) rebuilds the whole state object including `appsSplitWidth`. Drag frames and keydown never call it. |
| 4 | Independent write-path trace: no other writer drops/is-dropped-by the new field; missing/non-numeric restore falls back to default | PASS | `grep -rn "LAYOUT_STATE_KEY"` and `grep -rn "\.setState\(" libs/frontend` (run directly, not taken from the report) show exactly one writer of the key (`electron-layout.service.ts:623`) and confirm `VSCodeService.setState` (`vscode.service.ts:237-248`) merges by spreading current state and replacing only `[key]`; `theme.service.ts` and `git-review.service.ts` use different keys. `restoreLayout()` (`:660-665`) gates on `typeof === 'number'`; `setAppsSplitWidth` rejects non-finite; both confirmed green in `electron-layout.service.spec.ts` (97/97, includes the new fallback/round-trip cases at `:1217,2099-2127`). |
| 5 | ResizeObserver/listeners disconnected on destroy, no leak across destroy/re-create | PASS with a gap | `apps-page.component.ts:317-330` registers two `DestroyRef.onDestroy` hooks (flush pending key resize; disconnect observer). `ElectronResizeHandleComponent.ngOnDestroy` (`electron-resize-handle.component.ts:132-134`) cleans its own document listeners. No leak. But see Moderate M-3: an in-progress **pointer drag** has no destroy-time flush, unlike the keyboard path. |
| 6 | `aria-valuenow/min/max` reactive; separator role/orientation/label/focusable; arrow + Shift steps | PASS | `apps-page.component.ts:246-263` binds all three to computeds; `splitMinWidth` is a constant, `splitMaxWidth`/`splitWidth` are computed and recompute on `containerWidth`/`layout.appsSplitWidth` changes. Steps confirmed 16/64px, `apps-page-splitter.spec.ts:301-318`. |
| 7 | Clamping when the saved width exceeds available space; non-finite rejected; panel ≥ ~360px, conversation min respected | FAIL (narrow band aside) | Display-side clamping to the container is correct and does not itself rewrite the stored preference (`apps-page-splitter.spec.ts:341-351` proves a resize alone does not call `setState`). **But any subsequent drag or arrow-key interaction while the display is clamped writes the clamped value back into the service, permanently truncating a wider stored preference — see Serious S-1.** The already-accepted 481-605px "both floors can't hold" band is out of scope here (coordinator-deferred to visual review, `batches.md:929`) and is not re-raised. |
| 8 | Hidden/stacked ≤ 480px and in the embedded sidebar | PASS | `@if (!stacked())` (`:246`) plus the CSS `@container` rule (`:104-117`); `stacked` computed at `:290-294`; spec `:353-365` proves absence at 480 and presence at 481, including the nested `ptah-electron-resize-handle` element. |
| 9 | B15 guarantees intact: page holds no width state; B8 sync viewState write-back; interaction via computed; no `innerHTML` | PASS | Page's only fields are `containerWidth` (measurement), `dragGrabOffset` and `keyResizePending` (per-gesture bookkeeping) — none is a width preference (`:288,313-315`). `apps-surface-panel.component.ts` was not touched by this diff. No `innerHTML` in either changed file. |

## Five logic questions

### 1. How does this fail silently?

- **Container-clamped resize truncates the stored preference (the main finding, S-1).** `onSplitKeydown`
  (`apps-page.component.ts:357-364`) computes the new target from `this.splitWidth()` — the already
  container-clamped **display** value — not from `this.layout.appsSplitWidth()`, the true stored preference.
  When the container is narrower than the stored preference (e.g. stored `900`, container `700` ⇒
  `splitMaxWidth()` = `334`), `splitWidth()` reports `334`. Pressing `ArrowRight` computes `334 + 16 = 350`,
  `applySplitWidth` (`:377-384`) clamps it back to `334`, and `layout.setAppsSplitWidth(334)` overwrites the
  in-memory `900` with `334` even though nothing visibly moved. `commitKeyResize()` on `keyup` then persists
  `334` via `commitAppsSplitWidth()` → `persistLayout()`. When the window is later widened again, the user's
  original `900px` preference is gone — replaced by whatever the narrowest container they touched the
  control in happened to allow. Nothing errors, logs, or warns; the UI looks identical before and after the
  key press because the rendered width was already clamped to `334`.
- **The same truncation via a drag, not only a key press.** `onSplitDragMoved` (`:345-349`) calls
  `applySplitWidth` unconditionally on every `dragMoved` frame, with no check for "did the intended target
  actually change from what's stored." Grabbing the handle at its clamped position and moving the pointer
  even one pixel writes the clamped value into the service on the very first frame; releasing commits it.
  There is no way to merely *inspect* the clamped position via mouse without overwriting the wider stored
  preference on the first frame.
- **Non-finite fallbacks give no diagnostic.** `Number.isFinite` guards in both `applySplitWidth`
  (`apps-page.component.ts:378`) and `setAppsSplitWidth` (`electron-layout.service.ts:216`) silently drop bad
  values with no `console.warn`. This is consistent with the rest of the file (no other setter warns either)
  and is deliberate defensive coding, not a defect — noted for completeness, not flagged as a finding.

### 2. What user action produces unexpected behaviour?

- Resize the window (or embedded sidebar) narrower than a previously-saved wide split, then tab to the
  separator and press an arrow key once (even one that can't visibly move the handle further, because it's
  already at the container ceiling). The keypress is a no-op visually, but it silently overwrites and
  persists the true stored preference down to the momentary container maximum (S-1 above).
- A plain click on the 6px handle (mousedown immediately followed by mouseup with zero pointer movement, the
  ordinary way a user gives it keyboard focus) still fires `dragEnded` → `commitAppsSplitWidth()`
  (`:351-354`), because `ElectronResizeHandleComponent.onMouseDown`'s `endDrag()` always emits `dragEnded`
  regardless of whether any `mousemove` occurred. This is a harmless-but-wasteful `vscodeService.setState` +
  main-process IPC write on every focus click (M-2/M-1, merged below), not a data-loss bug on its own since
  the committed value equals what was already stored.
- Escape or window-blur mid-drag restores the exact starting width (verified, matches the report) but then
  commits that same value again through the identical `dragEnded` → `commitAppsSplitWidth()` path — a
  redundant persist rather than a true cancel-without-side-effect.

### 3. What input data produces a wrong answer?

- A `containerWidth` narrower than `SPLIT_HANDLE_WIDTH + SURFACE_MIN_WIDTH` (366px) forces `splitMaxWidth()`
  to its floor of `splitMinWidth` (240) via the `Math.max(this.splitMinWidth, …)` guard
  (`apps-page.component.ts:299-305`), so the clamp never inverts — correct defensive coding. But per Check 7,
  this same clamp is what feeds the truncation bug: any container narrower than the stored preference plus
  the fixed 366px overhead is enough to trigger S-1 on the next keyboard or pointer interaction. This is not
  confined to the already-accepted 481-605px band; it reproduces at any container width where
  `container - 366 < storedAppsSplitWidth`, which is common (e.g. the spec's own `mount(700)` case, max
  `334`).
- Fractional pixel values: the service never rounds (`electron-layout.service.ts:215-220`), while the page
  rounds only the **displayed** value (`splitWidth()`, `:308-310`). A fractional `appsSplitWidth` (possible
  from a sub-pixel `getBoundingClientRect().left`, e.g. at non-integer zoom levels) is persisted verbatim
  while the DOM/ARIA shows a rounded neighbour. Cosmetic only — flagged as Minor.

### 4. What happens when a dependency fails?

- `ResizeObserver` unavailable (non-browser test env): the constructor returns early after the first
  `DestroyRef.onDestroy` registration (`:322`), `containerWidth` stays `null`, `stacked()` stays `false`, and
  `splitMaxWidth()` falls back to the static `1200` — the splitter renders unclamped by container but the CSS
  `@container` rule still stacks visually. Handled deliberately and documented.
- `VSCodeService.setState` with no `window.vscode` (VS Code-only guard, not reachable on the Electron-only
  Apps page but shared code): logs a `console.warn` and returns (`vscode.service.ts:238-243`) without
  throwing; in-memory layout signals are unaffected. Pre-existing behaviour, not changed by this batch.
- `ElectronResizeHandleComponent` destroyed mid-drag (see M-3): its own `ngOnDestroy` cleans up its document
  listeners correctly, but it never emits `dragEnded` on teardown, so the parent's commit path is skipped —
  see Moderate M-3 below.

### 5. What is missing that the requirements never mentioned?

- A way to distinguish "the user genuinely wants the container-clamped value as their new preference" from
  "the display just happens to be clamped and no real gesture occurred yet." The brief specifies clamping the
  *display*, but never says the *stored* value should be silently rewritten to the clamp ceiling merely
  because an interaction (of any kind, even a no-op one) touched the control while clamped.
- A destroy-time flush for an in-progress pointer drag, symmetric to the one that already exists for a
  pending keyboard resize (`commitKeyResize()` registered in `DestroyRef.onDestroy` at `:319`, but nothing
  equivalent for a live `dragGrabOffset`/mid-drag state).
- No spec exercises "stored preference wider than the container, then a keyboard or pointer interaction, then
  widen the container again" — the only round-trip spec (`apps-page-splitter.spec.ts:341-351`) tests a bare
  resize with **no** interaction in between, which is exactly the one path that does not trigger S-1. The
  gap in the implementation and the gap in the test suite are the same shape.

## Failure modes

### FM-1 (= Serious S-1): Keyboard/drag interaction while container-clamped truncates a wider stored preference

- Trigger: `layout.appsSplitWidth()` (true preference) exceeds `splitMaxWidth()` (container-derived ceiling);
  user presses an arrow key on the focused separator, or performs any drag (even a sub-pixel one), while in
  that state.
- Symptom: no visible change (the display was already at the clamp ceiling), but the true stored preference
  is silently overwritten to the ceiling value and persisted on `keyup`/`dragEnded`. Widening the window
  later does not restore the original preference — it is gone.
- Evidence: `apps-page.component.ts:357-364` (keyboard path reads `this.splitWidth()`, the clamped display,
  as its base instead of `this.layout.appsSplitWidth()`); `:345-349` (drag path has the identical
  unconditional write); `electron-layout.service.ts:215-220` (`setAppsSplitWidth` has no "only write if this
  actually differs from the meaningfully-intended value" guard — it cannot, since the caller already lost the
  distinction).
- Current handling: none. `applySplitWidth` clamps and writes through every time, whether or not the
  resulting value is materially different from an artifact of the container ceiling.
- Recommendation: base the keyboard step (and the drag-frame width) off `this.layout.appsSplitWidth()`
  (the true stored value) rather than `this.splitWidth()` (the clamped display value), so a key/drag that
  cannot move the display further because of the container ceiling leaves the underlying preference
  untouched. Concretely: `const base = this.layout.appsSplitWidth(); this.applySplitWidth(base + direction * step);` and equivalently compute the drag target relative to the stored base rather than
  re-deriving purely from clamped pointer math. Add a spec: set a wide stored width, mount in a narrow
  container, press an arrow key, widen the container back, assert the original stored width returns.

### FM-2: Escape/blur restore and no-op clicks always commit

- Trigger: any `dragEnded` emission — including one produced by `Escape`, window `blur`, or a plain click
  with zero pointer movement.
- Symptom: `vscodeService.setState` (and the async main-process `set-state` IPC write) fires even though no
  intentional resize occurred; value is idempotent (no data changes) but the write-path is exercised far more
  often than the "persist on commit only" intent suggests.
- Evidence: `apps-page.component.ts:351-354` (`onSplitDragEnded` unconditionally calls
  `commitAppsSplitWidth()`); `apps-page-splitter.spec.ts:284-299` pins this as the intended behaviour ("keeps
  the handle's Escape restore exact, then commits the restored width").
- Current handling: intentional per the batch report, but check item 2's wording ("restoring does not
  persist") is only true in the narrow sense that no *drag frame* persists — the gesture-end commit still
  fires on a pure cancel.
- Recommendation: track the width at `onSplitPointerDown` and skip `commitAppsSplitWidth()` in
  `onSplitDragEnded` when the ending value equals it. Low priority — no data-correctness impact, just an
  avoidable IPC round trip.

### FM-3: No destroy-time flush for a pointer drag in progress

- Trigger: `AppsPageComponent` (or its splitter slot, via `@if (!stacked())`) is torn down while a pointer
  drag is active and no `mouseup`/`blur` has fired yet to end it naturally (e.g. the container itself crosses
  the 480px stacking threshold mid-drag because of an independent resize, or the page is routed away from
  by a non-pointer trigger while the mouse button is still down).
- Symptom: the drag's live width was already written into `ElectronLayoutService._appsSplitWidth` by the
  in-progress `dragMoved` frames, but because `ElectronResizeHandleComponent.ngOnDestroy` only calls its own
  `cleanup()` (never emits `dragEnded`), `onSplitDragEnded`/`commitAppsSplitWidth()` never runs for that
  gesture. The next `restoreLayout()` reads the last value that *was* committed — i.e. from before this
  drag — silently dropping the in-progress change.
- Evidence: `apps-page.component.ts:317-330` (only `commitKeyResize()` is wired to `DestroyRef.onDestroy`,
  nothing for a pending drag); `electron-resize-handle.component.ts:132-134` (`ngOnDestroy` → `cleanup()`,
  no `dragEnded.emit()`).
- Current handling: none; asymmetric with the keyboard path, which does flush on destroy.
- Recommendation: track a `dragPending` boolean set in `onSplitPointerDown`/cleared in `onSplitDragEnded`,
  and flush it (`commitAppsSplitWidth()`) from the same `DestroyRef.onDestroy` hook that already flushes
  `keyResizePending`. Likelihood is low (requires an unusual interleaving), so this is Moderate, not Serious.

### FM-4: Sub-pixel value stored, rounded value displayed

- Trigger: a fractional pixel arrives from pointer math (e.g. non-integer `getBoundingClientRect().left`
  under browser zoom) or from a corrupted persisted value.
- Symptom: `layout.appsSplitWidth()` can hold e.g. `360.75` while the CSS custom property and
  `aria-valuenow` show the rounded `361` (`apps-page.component.ts:308-310`). Cosmetic only — the two never
  visibly diverge by more than half a pixel, and CSS accepts fractional `px` values.
- Evidence: `electron-layout.service.ts:215-220` (no `Math.round`).
- Current handling: none.
- Recommendation: `Math.round` inside `setAppsSplitWidth`, matching how `splitWidth()` already rounds for
  display. Minor.

### FM-5: Nested `role="separator"` elements

- Trigger: none — static markup.
- Symptom: the batch adds `role="separator"` with full interactive ARIA (`aria-valuenow/min/max`,
  `tabindex="0"`) on the outer slot (`apps-page.component.ts:249-250`), which wraps
  `ElectronResizeHandleComponent`'s own inner `<div class="resize-handle" role="separator"
  aria-orientation="vertical">` (`electron-resize-handle.component.ts:34-38`, unchanged). The inner one has no
  value/focus properties, so most assistive tech will not expose it as a second stop, but a nested
  `separator`-in-`separator` is an unusual pattern some screen readers may double-announce.
- Evidence: `apps-page.component.ts:246-263`; `electron-resize-handle.component.ts:31-39`.
- Current handling: acknowledged as a deliberate decision in `batch-20-report.md` ("Separator children are
  presentational, so this nesting is allowed"), not something the team-leader has ruled on.
- Recommendation: low priority; worth a screen-reader spot check at the visual review rather than a code
  change here. Not scored as a logic defect — flagged for awareness.

## Blocking issues

None.

## Serious issues

### Container-clamped interaction silently truncates a wider stored split preference

- File: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:357-364` (keyboard),
  `:345-349` (drag)
- Scenario: user has a wide `appsSplitWidth` preference from a previous session; resizes the window (or
  embedded sidebar) narrower than that preference plus the fixed 366px overhead; then either taps an arrow
  key on the focused separator or performs any drag, without ever intending to shrink the true preference.
- Impact: the user's saved column width is silently and permanently replaced by whatever the narrowest
  container they interacted with the control in happened to allow. No error, no visible change at the moment
  it happens (the display was already clamped there); the only symptom is that widening the window later does
  not restore the old width. This is the exact write-path the batch was designed to protect (per the "Known
  band" and "the stored value stays 900" claims in `batch-20-report.md`), but that guarantee only holds for a
  bare resize with no interaction — it breaks the moment the user touches the keyboard or mouse while
  clamped.
- Fix: derive both the keyboard step target and the drag target from `this.layout.appsSplitWidth()` (the true
  stored preference) rather than `this.splitWidth()` (the container-clamped display value), so a gesture that
  cannot visibly move the handle further leaves the underlying preference untouched. Add a spec covering:
  wide stored width → narrow mount → key/drag interaction → widen container again → original width returns.

## Moderate and minor issues

- **M-2 (Moderate, merges FM-2/FM-3 write-path waste):** `onSplitDragEnded` (`apps-page.component.ts:351-354`)
  commits unconditionally on every `dragEnded`, including Escape/blur restores and no-op clicks. No data
  correctness impact, but a real, avoidable `vscodeService.setState` + IPC write on paths that check item 2
  implies should be no-ops.
- **M-3 (Moderate, FM-3):** no destroy-time flush for a pending pointer drag, asymmetric with the keyboard
  path's `commitKeyResize()` `DestroyRef.onDestroy` hook (`apps-page.component.ts:317-330`). Low likelihood,
  real gap.
- **M-4 (Minor, FM-4):** `setAppsSplitWidth` does not round; `electron-layout.service.ts:215-220`. Cosmetic
  sub-pixel mismatch with the rounded display value.
- **M-5 (Minor/awareness, FM-5):** nested `role="separator"` elements, `apps-page.component.ts:249-250` +
  `electron-resize-handle.component.ts:34-38`. Flag for the visual/a11y review, not a code defect.
- **Carried forward, not re-raised (already ruled by the coordinator, `batches.md:926-932`):** the 481-605px
  band where the surface panel gets less than 360px (deferred to the R10 visual review); the 822-line service
  length (accepted); `persistLayout()` never writing `workspaceFolders`/`activeWorkspaceIndex` (pre-existing,
  tracked as a follow-up); the flaky `apps-submit-flow.spec.ts` timing tests (unrelated file, not touched by
  this batch, already re-run green per the report).

## Data flow

1. **Restore (app boot):** `restoreLayout()` reads `LAYOUT_STATE_KEY` → gates `appsSplitWidth` on
   `typeof === 'number'` → `setAppsSplitWidth` gates on `Number.isFinite` and clamps to `[240, 1200]` — OK,
   independently verified green (97/97, including the new fallback/round-trip cases).
2. **Mount:** `AppsPageComponent` constructor observes its own host via `ResizeObserver`; `containerWidth`
   starts `null` (splitter renders un-stacked, unclamped-by-container, until first callback) — OK, documented
   deliberate first-frame gap, not re-flagged.
3. **Drag frame:** `dragMoved` → `onSplitDragMoved` → `applySplitWidth` clamps to `[splitMinWidth,
   splitMaxWidth()]` and calls `layout.setAppsSplitWidth` — writes the signal only, no persistence — OK for
   the "no persistence on drag frames" requirement, but this same unconditional write is the root of S-1 when
   the clamp ceiling is below the true stored value.
4. **Gesture end (drag/key):** `commitAppsSplitWidth()`/`commitKeyResize()` → `persistLayout()` → rebuilds
   the whole `LAYOUT_STATE_KEY` object from every signal, including `appsSplitWidth` → `vscodeService.setState`
   — OK, confirmed the sole writer and confirmed it never drops the field.
5. **Destroy:** key-resize flush and ResizeObserver disconnect are wired to `DestroyRef.onDestroy` — OK for
   keyboard; **gap** for an in-progress pointer drag (FM-3/M-3).

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Reuse `ptah-electron-resize-handle`, no fork | COMPLETE | None. |
| Subtract container left offset; no jump on pointer-down | COMPLETE | None. |
| Clamp, reject non-finite | PARTIAL | Clamping and non-finite rejection are correct in isolation, but the clamp silently overwrites the true stored preference on interaction (S-1). |
| Escape/blur restore | COMPLETE (with a caveat) | Restore itself is exact; the "restoring does not persist" half of the pin is only true for drag frames, not for the gesture-end commit (M-2). |
| Keyboard resize + ARIA | COMPLETE | None. |
| Persist on commit only, in `LAYOUT_STATE_KEY` | COMPLETE for the write-path shape; INCOMPLETE for correctness | The write-path itself is correct (single writer, all fields preserved, fallback works); what gets written can be wrong per S-1. |
| Page holds no width state | COMPLETE | None. |
| Hidden/stacked ≤480px and embedded sidebar | COMPLETE | None. |

Implicit requirements not addressed: a round-trip test for "stored preference wider than the container, then
an interaction, then widen again" (the one scenario that actually exercises S-1); a destroy-time flush for a
pending pointer drag.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Stored width exceeds container fit, no interaction | YES | Display clamps via `splitWidth()`; stored value untouched (spec `:341-351`) | None |
| Stored width exceeds container fit, then a key/drag interaction | NO | — | S-1: stored value silently truncated to the clamp ceiling |
| Non-finite drag coordinate (NaN/Infinity) | YES | `Number.isFinite` in both page and service | None |
| Escape/blur mid-drag | YES (restores exact width) | Handle re-emits start width | Also re-commits (M-2), wasteful but not incorrect |
| Repeated/held arrow key | YES | `keyResizePending` + single commit on `keyup` | None |
| Component destroy mid key-resize | YES | `commitKeyResize()` on `DestroyRef.onDestroy` | None |
| Component/handle destroy mid pointer-drag | NO | `ngOnDestroy` cleans listeners but never emits `dragEnded` | M-3: the in-progress drag's width is never committed |
| Malformed/missing persisted `appsSplitWidth` | YES | `typeof`/`Number.isFinite` gates, falls back to 360 | None |
| Container ≤480px | YES | `@if (!stacked())` + CSS `@container` | None |
| 481-605px band | Partially (accepted) | Conversation min wins, surface gets 115-239px | Deferred to visual review per coordinator ruling, not re-raised here |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a user's saved Apps-page split width is silently and permanently lost the first time they resize
  the window narrower than their preference and then touch the separator (keyboard or mouse) — no error, no
  visible symptom until the window is widened again and the old width does not come back.
- What a robust implementation would add:
  1. Base keyboard-step and drag-frame targets on the true stored `layout.appsSplitWidth()`, not the
     container-clamped `splitWidth()`, so an interaction that cannot move the display further leaves the
     underlying preference untouched (fixes S-1).
  2. A spec for "wide stored width, narrow mount, interact, widen again, original width returns" — the one
     round trip the current suite does not cover.
  3. A destroy-time flush for an in-progress pointer drag, symmetric to the existing keyboard flush (fixes
     M-3).
  4. Skip the gesture-end commit when the ending value equals the pre-gesture value, so Escape/blur/no-op
     clicks are true no-ops on the write path (fixes M-2).
