# Code Logic Review - visual fix round, TASK_2026_702

Review family: Anthropic (independent reviewer, code-logic). Scope: uncommitted diff on 759339e44. No tests/tsc run (heavy check in flight); static review only.

Score: 7/10. Verdict: REVISE (0 blocking, 2 serious... see list; both fixable in minutes).

## Findings

1. SERIOUS - `block line-clamp-2` likely does not clamp (F4). `canvas-rail-board.component.ts:195`. Tailwind 3.4 (`package.json:286`) emits `line-clamp-N` before display utilities, so `.block` (display:block) overrides line-clamp's `display:-webkit-box` and the title shows in full / un-clamped. Existing usages of line-clamp in the repo omit `block` (agent-card.component.ts:97, inline-agent-bubble.component.ts:434). The spec at canvas-rail-board.component.spec.ts:1204 only asserts the class name, so it cannot catch this. Fix: drop `block` (use `line-clamp-2` alone, or `min-w-0 break-words`), and verify visually at 169px card width.

2. SERIOUS - F7 Escape is not fixed in the real canvas. `orchestra-canvas.component.ts:124-129`: the popover has no `[trigger]` projection; the anchor (hero/dock button) lives outside `<ptah-native-popover>`, so the host `(keydown)` handler (native-popover.component.ts:80, 330-335) never sees Escape when focus is on the anchor (reachable via Shift+Tab out of the input, as the visual review observed). The added spec (native-popover.component.spec.ts:280) uses a projected trigger, so it passes while the real topology is uncovered. Removal of the input `(keydown.escape)` is fine (the host handler covers the input and panel; the `(closed)` -> `handleCancelSession` path at line 128/588 restores anchor focus). Fix: either handle Escape in orchestra-canvas scoped to `sessionPopoverOpen()` (document keydown while open, not in the shared popover), or move focus management so focus cannot sit on the anchor; add a spec with an external anchor.

3. MODERATE - Open Library removal is not what the report says. Report claims "Skills still provides Open Library before readiness"; that is true only in the not-ready branch (`project-setup-card.component.ts:26`, `openLibrary()` line 66). In `allReady()` (lines 13-17) the strip has no marketplace entry. Still reachable: the app-shell Marketplace button (`app-shell.component.html:205-213`, `app-shell.component.ts:343` -> `setCurrentView('marketplace')`), which opens the hub but not the `skills`/`ptah-plugins` deep link that `openLibrary()` used. Judgment: acceptable (matches the approved prototype, capability not lost, one extra hop), but the report decision text is inaccurate and the deep link is lost for ready users. Note it in decisions.md.

4. MODERATE - `recentActivity` (`canvas-rail-board.component.ts:329-341`): logic is correct for midnight (calendar-day compare), yesterday (setDate, DST-safe), future timestamps (falls through to a short absolute date, no "-5m"), and NaN (returns ''). Gaps: (a) `null` timestamp becomes epoch -> "Jan 1, 1970" (new Date(null)); (b) a method called from the template is not time-reactive, so "2h ago" goes stale until the next change detection; (c) hardcoded English "ago"/"Yesterday" beside a locale-formatted date; (d) a non-finite value that reaches `| date:'medium'` as NaN returns null (handled by `?? ''`), but a string value would throw InvalidPipeArgument (pre-existing, `mediumDate` had the same). Tooltip `title` on a span inside a button is mouse-only and the button's `aria-label` hides the date from AT; minor. The spec at line 1204 uses a loose regex `/2h ago|Yesterday/` (passes by design near midnight but is the only time case; no future/invalid/yesterday cases).

5. MODERATE - F1 inspector gating is correct. `focusedId()` (line 412-418) is null only when `orderedTiles()` is empty, identical to `isEmptyBoard` (line 411), so no inconsistent state; both inspector branches (261, 296) and the sm toggle button are gated. First session created: the aside appears and the stage narrows (an expected, one-time reflow; board `compactSheet` branch unaffected). Spec at line 595 asserts the absence of `canvas-wide-inspector` only on an empty board; no assertion that the inspector returns when a session is focused (existing test at ~592 does cover tabId). Residual risk only: the sm "Open details" toggle is now hidden on an empty board, which is right.

6. MINOR - F2 satisfied: no `btn-primary` remains in the card (spec lines 52-53, 63-64 assert none in two states); the only filled primary on the start screen is the hero `btn btn-primary` (`canvas-rail-board.component.ts:168`). Not asserted for the loading/unavailable/allReady states, but the template has no primary in any branch. The Create button in the popover is primary but only while the popover is open (acceptable).

7. MINOR - F6 popover a11y. `role="dialog"` + `aria-labelledby`/`describedby` (orchestra-canvas.component.ts:134-137) resolve to unique ids when one canvas renders (the popover is outside the per-workspace `@for`, so it renders once). But the input keeps `aria-label="Session name"` (line ~148), which overrides the new `<label for>` text "Session name (optional)", so AT loses "optional"; remove the aria-label. The dialog is non-modal with a transparent backdrop and no focus return on Tab-out (see 2). Placeholder "New session" implies the default name, consistent with the helper text.

8. MINOR - F5: `:host-context([data-theme='anubis-light']) section` (project-setup-card.component.ts:40) works only if `data-theme` is on an ancestor (webview sets it on html/body; chat-empty-state spec sets it on the host element, which also matches). Component styles with `:host-context` are supported under emulated encapsulation. Uses existing tokens (`--elev-shadow`, `--surface-highlight`, styles.css:155-157). Source `section` selector would also hit nested sections if added later. No spec; visual follow-up pending.

9. MINOR - Copy: the Project scan row text "Run setup to scan this workspace" and the hero copy changed; spec asserts eyebrow/Setup tools/3 icons (project-setup-card spec 49-51). The aria-label="Setup tools" on a plain div (project-setup-card.component.ts:31) without a role is ignored by AT (pre-existing); now there is also a visible "Setup tools" text, so use `role="group"` or `aria-labelledby`.

## Verdict
REVISE: fix items 1 and 2 (real behavioural gaps masked by specs asserting the wrong thing), record item 3 in decisions.md; the rest are optional.

## Re-review after revise round 1

Verdict: APPROVED (0 blocking, 0 serious, 3 minor). Source read only; no tests run.

Fixed:
- 1 Line clamp: `block` removed, `line-clamp-2` on the title span (`canvas-rail-board.component.ts:195`); spec asserts class and no `block`.
- 2 Escape on external anchor: `onSessionAnchorEscape` (`orchestra-canvas.component.ts:238-244`) added in `openNewSessionPopover` (:564) and removed in `closeSessionPopover` (:604), on re-open (:563) and in `ngOnDestroy` (:617). It guards on `sessionPopoverOpen()`, calls `stopPropagation`, and `handleCancelSession` is guarded by `wasOpen`, so the cancel and focus return run once. `handleCreateSession` now closes through `closeSessionPopover`, which removes the listener. No leak found. The spec (`orchestra-canvas.rail.spec.ts:364`) asserts close, one focus call and no second call. The input's own `(keydown.escape)` was dropped and the popover host handler (`native-popover.component.ts:331`) takes over; the existing closed-emit spec covers that.
- 3 Relative dates: null, undefined and NaN return '' (`:329-332`) and the tooltip is suppressed for null (:195). The relative date is in the card's aria-label, which still contains the visible title. The spec covers yesterday, older, future, null and undefined.
- 7 Input label: visible `<label for>` with `id="canvas-session-name"`, `aria-label` removed, spec asserts both.
- 9 `role="group"` with name "Setup tools" (`project-setup-card.component.ts:30`), spec-asserted.
- Open Library wording: the report text is now accurate (`visual-fix-report.md:17`). The not-ready card keeps Open Library and the spec checks both states.

New minor findings:
- M1 `canvas-rail-board.component.ts:335-340`: `recentActivity` is evaluated at change detection, so "5m ago" can go stale until the next render. Acceptable.
- M2 The "2h ago" spec (`canvas-rail-board.component.spec.ts` ~1210) accepts `Yesterday` to survive the midnight crossing. It is robust but weak. A fake clock would be stricter.
- M3 A future timestamp on the same day falls through to an absolute date, which is intended and tested. A very recent clock-skewed timestamp (negative elapsed under 1 minute) is shown as an absolute date. Edge case only.
