# Code Logic Review: Batch B7 (Session tabs) and motion tuning revise round 2

Review family: claude (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | REVISE (one moderate defect: the glass cut-exit selector never matches) |
| Tuning round 2 verdict | APPROVED, 8/10 (A1 and A2 fixed with real tests) |
| Blocking / Serious / Moderate / Minor | 0 / 0 / 1 / 3 |

Evidence: I read the full diffs of the in-scope files. I compiled `chat-transcript.component.css` through Angular's own `encapsulateStyle` (`@angular/compiler`) to read the emulated-encapsulation output. I ran `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="chat-view|chat-transcript|session-inspector"` and it passed (1 of 1 task, 0 cached).

## Defects

### 1. Moderate: the glass cut exit never matches (`chat-transcript.component.css:30`)

The rule is `:host-context([data-glass='on']):host(.ptah-pane-switch-overlap):has(...) { animation: none; display: none; }`. Angular compiles it to ONE selector:

`[data-glass='on'].ptah-pane-switch-overlap[_nghost-x]:has([data-glass-surface], [class*='backdrop-blur'])`

It has no `[data-glass='on'] [_nghost]` descendant form. `data-glass` is on `:root`, not on the transcript host, so the rule never matches.

- Result: under `data-glass='on'` the old transcript gets the normal `ptahMotionLeave`, which animates opacity. That puts an opacity Backdrop Root over a `backdrop-filter` descendant, which `user-decisions.md` forbids ("glass = cut exit").
- The enter rules are fine. `:host-context(X) .child` compiles to both forms: `X[_nghost] .child, X [_nghost] .child`. Only the combined `:host-context():host()` selector breaks.
- Non-glass themes are correct. Every glass rule needs `[data-glass='on']`, so they get the plain preset.
- The spec asserts the CSS text with a regex (`chat-view.session-enter.spec.ts`, "cuts glass exits"), so it passes while the selector is dead.
- Fix: write the rule as `:host-context([data-glass='on']) :host(.ptah-pane-switch-overlap)`. If that does not compile either, add the glass rule to global `styles.css` next to the other glass rules (around :996). Replace the text-only assertion with a check of the compiled selector, for example a test that runs `encapsulateStyle`.

### 2. Minor: the session inspector does not follow the selected preset

`session-inspector.component.ts:87-122` hard-codes a rise plus fade through its own keyframes (18px, -6px). It ignores `data-motion-style`, `--ptah-motion-enter-*` and the glass scoping. The stats grid children animate opacity, and the glass downgrade does not apply.

It is inside the old tuning scope and not required by the B7 plan row, so I do not block on it. Under a Slide or Scale preset the inspector moves differently from the transcript beside it.

### 3. Minor: `previousStats` is retained for the component's lifetime

`session-inspector.component.ts` keeps a full stats snapshot across null gaps, by design. The cost is one small object. The first A to null to B always cross-fades from stats that may be stale. That is acceptable and is covered by a test.

### 4. Minor: `directional` has no back direction on session tabs

The transcript is outside any `.ptah-motion-stage`, so `--ptah-motion-sign` falls back to 1 (forward). This matches plan component 8 ("sign is 1") and the B7 report. A tab to the left of the current one still enters from the right. This is a deliberate decision; recorded for completeness.

## B7 checks

| Check | Result |
| --- | --- |
| Uses the selected preset | OK. Enter uses `ptahMotionEnter` with `--ptah-motion-switch`; leave uses `ptahMotionLeave` with `--ptah-motion-out`. The old `ptahPaneSwitch*` keyframes are removed. |
| Default Rise | OK, via the global defaults at `styles.css:49-55`. |
| Direction by tab order | By design none (plan component 8), see defect 4. |
| Non-glass themes get the normal preset | OK (compiled output checked). |
| Glass entrance, transform only | OK for the `.ptah-pane-switch-enter` content root. The fade and scale offsets (18px, 6px) mirror `styles.css:985-991`. |
| Glass cut exit | BROKEN, defect 1. |
| Reduced motion | OK. Enter animation is none; the leave host is `display:none`. With glass on, the glass rule sets only `animation-name` and the later shorthand zeroes the duration, so nothing is visible. |
| Stuck classes on rapid switching | OK. A to B to C: `startLeave` clears the leave timer and replaces `leavingTabId`, and A's pane drops to `hidden`. A to B (unready) to A: B leaves, A enters. Both timers are cleared in `ngOnDestroy`. `overlapping` requires `enteringTabId === resolvedTabId`, so an entering-B pane never marks C as overlapped. |
| Leaving pane isolation | OK. `inert`, `aria-hidden` and `pointer-events:none` are set, and `active` is false. |

## Tuning round 2

### A1: session-inspector A to null to B (FIXED)

- The null branch no longer resets `previousSessionId` or `previousStats` (`session-inspector.component.ts:241-258`). A to null to B animates from A's snapshot, and A to null to A does not replay.
- The null branch clears the timer and `leavingStats`, so no stale leave node is left.
- Window: `statsSwitchWindowMs` reads `--ptah-motion-switch` at each switch, plus 40ms. A new switch clears the previous timer, and `destroyRef.onDestroy` clears the last one.
- Tests: "animates A to null to B and reads the current switch token" and "does not animate when the same session returns after null stats". The first changes the token to 0.7s and asserts the window is 739ms, then 740ms. That is a real test.

### A2: chat-view leave timer (FIXED)

- `startLeave` now arms the safety timer (`chat-view.component.ts:1127-1148`). The window is `clamp(1000, switchMs + leaveMs + 40, 2000)`, derived from the tokens.
- It is cleared by the next `startLeave`, by `startEnter` (which replaces it with the leave-window timer), and by `ngOnDestroy`.
- A null tab id calls `startLeave(null)`, which clears the timer and `leavingTabId`.
- Tests:
  - "ends a pending leave when a resuming tab never becomes ready" asserts leave at 999ms, then not leaving at 1000ms.
  - "ends a pending leave when the active tab id becomes null" asserts the leave clears and stays cleared after 1s.
  - "reads updated motion tokens for entrance and leave windows" checks that both windows follow the tokens.
- Residual note: if a tab becomes ready after the safety timeout, its entrance still plays late with no leaving pane. That is acceptable.

### Tuning verdict

APPROVED, 8/10. Neither moderate defect remains. The defect above is a B7 glass defect, not a tuning defect.

## Five logic questions

1. Silent failure: the glass cut exit silently falls back to the opacity exit (defect 1). The text-only CSS test hides it.
2. Unexpected user action: rapid tab switching and a tab that never loads end cleanly through the timers.
3. Wrong output: `directional` never reverses on session tabs (defect 4, by design).
4. Dependency failure: if the computed style is unavailable (SSR or jsdom), the code falls back to constants. A stuck history replay is bounded by the safety timer.
5. Missing: a compiled-selector test for Angular-encapsulated glass rules, and inspector preset consistency (defect 2).


## Re-review round 1

Review family: claude (implementer: codex)

| Metric | Value |
| --- | --- |
| Score | 9/10 |
| Verdict | APPROVED |
| Blocking / Serious / Moderate / Minor (new) | 0 / 0 / 0 / 2 |

Evidence: I compiled the real `chat-transcript.component.css` through Angular's `encapsulateStyle` (from `@angular/compiler`) and read the output. I read the inspector inline styles and the specs. `npm run verify -- -p @ptah-extension/chat` passed (3/3 tasks, cache hits, so it reflects the current inputs).

### Per-defect table

| r0 defect | Status | Evidence |
| --- | --- | --- |
| 1 Moderate: glass cut exit never matches | FIXED | `chat-transcript.component.css:30` is now `:host-context([data-glass='on']) :host(.ptah-pane-switch-overlap):has(...)`. It compiles to `[data-glass='on']   .ptah-pane-switch-overlap[_nghost-test]:has([data-glass-surface], [class*='backdrop-blur'])`. This is the root attribute as an ancestor and the host class on the host element. `data-glass` is on `:root`, so it matches the real DOM. The rule comes after the `:host(.ptah-pane-switch-overlap)` leave rule and has higher specificity, so `animation: none; display: none` wins. |
| 2 Minor: inspector ignores the preset | FIXED | `session-inspector.component.ts:~100-122` uses `ptahMotionEnter` and `ptahMotionLeave` with the `--ptah-motion-*` variables. The glass entrance is `ptahMotionEnterGlass`. The fade and scale glass offsets follow `styles.css:987-995`. The glass exit is `animation: none; display: none`. Reduced motion sets the leave node to `display:none` and the enter animation to none. |
| 3 Minor: `previousStats` retained | UNCHANGED (accepted) | By design. |
| 4 Minor: no back direction on session tabs | UNCHANGED (accepted) | By design (plan component 8). |

### Specific checks

- **Compiled selector (check 2).** The transcript output has all of these:
  - the cut exit as described above;
  - the entrance as `[data-glass='on'][_nghost-test] .enter..., [data-glass='on'] [_nghost-test] .enter...`;
  - the fade and scale offsets in the same dual form.
- **Spec tests the compiled output.** `chat-view.session-enter.spec.ts:319` calls `encapsulateStyle(css, 'test')`. Lines 329-332 assert the compiled selectors with regexes such as `\[data-glass='on'\]\s+\.ptah-pane-switch-overlap\[_nghost-test\]`. That regex would not match the r0 output, which had `[data-glass='on'].ptah-pane-switch-overlap[_nghost-x]` with no space. The source-text regex at line 324 is only a supplement. The inspector spec (`session-inspector.component.spec.ts:~79-85`) also compiles the inline styles it extracts from the source. These tests are real.
- **Reduced motion (check 3).**
  - The Electron Motion setting is only a style picker (`motion-style-picker.component.ts`); there is no separate "off" mode, so `prefers-reduced-motion` is the sole gate.
  - Transcript: `chat-transcript.component.css` has the media query. The enter and overlap animations are none, and the leave host is `display:none`.
  - Inspector: the same behaviour.
  - Under glass, the global rule `styles.css:2971` also forces 0.01ms.
- **Fast switches and double enter (check 4).** The transcript timers are unchanged from r0, which verified them as OK. The inspector keeps its one `statsSwitchTimer`, which each new switch clears, plus `destroyRef.onDestroy`. A to B to C replaces `leavingStats` and restarts the enter on the same element, because the `[class.inspector-stats-enter]` binding stays true. A restart needs the class to toggle, so a rapid second switch does not replay the animation. The leave node, however, is re-created with new stats, so it is not stale.

### New defects

1. Minor: inspector glass rules (`session-inspector.component.ts` inline styles, the glass enter and leave rules) apply without the `:has([data-glass-surface], [class*='backdrop-blur'])` gate that the transcript and `styles.css` use. Under glass, the stats section loses its fade and its leave opacity exit even when it has no blur descendant. This is harmless and conservative (never produces a Backdrop Root artifact), and it is only a visual inconsistency.
2. Minor: B7 has no jsdom or browser test of real `getComputedStyle` cascade behaviour. Selector matching is only verified by compiled-text regexes. The reasoning above is sound, but the cut exit has not been seen in a real browser (the implementer's report states no screenshot).

No double enter was found. No leave node sits outside the transcript or inspector host: the transcript leave pane is a sibling `ptah-chat-transcript` host, and the transcript is not a child of `.ptah-motion-stage` (`--ptah-motion-sign` falls back to 1, as in r0).

### Verdict

APPROVED, 9/10. The one moderate r0 defect and the inspector minor are fixed, with tests that exercise the compiled selector.
