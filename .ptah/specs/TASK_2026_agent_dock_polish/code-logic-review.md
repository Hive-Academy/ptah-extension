# Code Logic Review — `TASK_2026_agent_dock_polish`

Review family: claude (reviewer) vs codex (implementer)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED (with moderate follow-ups) |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 4 |
| Failure modes found | 4 |

Scope: full read of dock-overflow.ts, canvas-lane-tabs.component.ts, agent-dock-menu.component.ts, plus the diff of specs; grep of styles.css for tablist/glass rules. I did not run `npm run verify` (optional); no test result is claimed.

## Five logic questions

1. Silent failure: if the roster has no `orchestrator` entry and every agent is finished, `selectedKey` falls back to `'orchestrator'` (canvas-lane-tabs.component.ts, selectedKey computed), nothing is pinned, `visible` is empty and the dock shows only the menu trigger (dock-overflow.ts:107-116). Unlikely (the roster normally has an orchestrator) but not guarded.
2. Unexpected user action: a keyboard user focused on a running chip whose agent finishes sees the chip vanish from the DOM (moved into the menu); focus drops to body. Likewise, arrow-key navigation emits `laneSelected` per step (onKeydown); when the user moves off a selected finished agent, that chip disappears, so ArrowLeft cannot return to it and chip indices shift mid-navigation.
3. Wrong answer from data: agents with `status` null are ranked with queued in the menu (dock-overflow.ts menuRank default 3) and are kept inline (not finished). That is consistent with the spec; no wrong result found. Duplicate keys would break `chosen` Set logic but roster keys are unique.
4. Dependency failure: `width` NaN/Infinity is handled (`!Number.isFinite(capacity)` -> eligible-only branch, finished agents still go to the menu, correct). capacity 0: slots=1, `Math.max(slots, pinnedCount)` keeps both pinned agents (dock-overflow.ts:117-129). Correct.
5. Missing: no test for focus retention when a chip moves to the menu; hover card (`cardKey`) for an agent that just moved to the menu keeps rendering from `agents()` (cardAgent) while its tab no longer exists, so `openCard`'s `document.getElementById` returns null and the card is unpositioned until it is closed by timer/escape.

## Verified correct

- planDockOverflow: pinned = orchestrator or selected, even if finished; non-pinned finished are never in `eligible`, so never chosen; both pinned always sort first (rank 0/1), so `slice(0, max(slots, pinned))` always includes them. Empty roster and one-agent roster return empty/one visible, no hidden. `Infinity` capacity and `<= DOCK_INLINE_MAX` rosters share one branch, hidden = agents minus eligible, dock order preserved.
- Selected hidden-agent pill: the selected agent is always in `visible`, so the pill path (`!rail() && chip.selected`) and `tabIndex 0` roving stop still work; the menu's `onMenuSelect` -> `pick` -> `focusTab` is unchanged.
- Menu renders only if `hidden.length > 0`; tablist keyboard (Arrow/Home/End) only covers visible chips, the same as before. Menu is the only route to finished agents, which is the intended design; the trigger is a real button reachable by Tab.
- Menu: `orderedAgents` is a stable sort (index tiebreak); keyboard nav, `checkedKey` and `choose` all use the same ordered list, so DOM order and key order agree. `menuitemradio` with `aria-checked` inside `role="menu"` is valid; removing `role="presentation"` headings leaves no orphaned roles. Selected is always in the list, so exactly one item is checked.
- Gradient: `:host > [role='tablist']:not(.flex-col)` sets only `background-image`; the glass-on overrides set `background-color`/border/shadow only, and I found no `background` shorthand for the tablist in styles.css, so the gradient survives glass-on and reads from `--bc` (a theme variable that is set for dark and light, styles.css:153-156, 2896). Rail tablist excluded via `.flex-col`.
- Padding: pt-1 / pt-0.5 (rail) with pb-0.5 reproduces the old py-0.5 for the rail.

## Findings

1. Moderate — Focus loss when a focused chip moves into the menu. canvas-lane-tabs.component.ts layout/template (chips are `@for ... track chip.key`); the chip is destroyed when the agent turns done/stopped and is neither selected nor orchestrator. Impact: keyboard/screen-reader users lose their place. Fix: if `document.activeElement` was that tab, focus the selected tab (or menu trigger) after the layout change.
2. Moderate — Arrow navigation can strand the user. onKeydown (canvas-lane-tabs.component.ts) selects each step; moving off a selected finished agent removes it from the strip, so you cannot arrow back to it and positions shift. Fix: accept it and document, or keep the previously selected finished agent visible until focus leaves the dock.
3. Moderate — Hover/focus card for a chip that moved to the menu: `cardAgent` still resolves from `agents()` while the tab is gone; positioning silently no-ops (openCard null guard). Fix: clear `cardKey` when the key is not in `layout().groups` chips.
4. Moderate — Dead/stale code and wording: agent-dock-menu.component.ts:48-53 `hidden().length === 0` Users-icon branch (and `usersIcon`/`Users` import) is now unreachable because the parent only renders the menu when hidden is non-empty; the trigger text `{{ agents().length }} agents` counts all agents (including inline ones) while the pile shows only hidden ones, which can mislead ("6 agents" with 2 avatars). Also `planDockOverflow` fallback when no orchestrator exists (see Q1).

Minor: the gradient stays in forced-colors / high-contrast modes (fine, it is a background-image and is dropped in forced-colors by the UA); `menuRank` and `overflowRank` duplicate status ordering knowledge; the new one-line `switch` cases look unformatted for prettier (style, route to style review).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 1. Small top padding | COMPLETE | none |
| 2. Left-to-right theme-aware gradient, glass on/off | COMPLETE | not visually verified by me |
| 3. Finished agents go to the menu; orchestrator and selected stay; small rosters too | COMPLETE | focus/hover handling on transition (findings 1-3) |
| 4. Menu order running, waiting, failed, queued, done, stopped, ties dock order | COMPLETE | null-status agents sit with queued (reasonable) |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty roster | YES | no chips, no menu | none |
| One agent, finished orchestrator | YES | pinned | none |
| Finished selected agent | YES | pinned, shown as pill | disappears when selection moves |
| capacity 0 / Infinity / NaN | YES | max(slots, pinned); finite check | none |
| All finished, no orchestrator in roster | NO | empty strip, menu only | unlikely |
| Rail | YES | rail overrides visible/hidden | unchanged |

## Verdict

- Recommendation: APPROVE (follow-ups optional)
- Confidence: MEDIUM (static review, tests not run, no visual check)
- Top risk: a chip leaving the strip while it holds focus or a hover card.
- A robust implementation would add: focus restoration on chip removal, clearing the card key for departed chips, a spec for the finished-selected-then-deselected transition, and removal of the unreachable Users-icon branch.

## Re-review (round 1)

Review family: claude (reviewer) vs codex (implementer). Scope: the changed code only (canvas-lane-tabs.component.ts freeze/focus logic, agent-dock-menu.component.ts trigger). Static read; I did not rerun the coordinator's verify (3/3 passed, as reported).

Verdict: APPROVE. Confidence MEDIUM. 0 blocking, 0 serious, 3 moderate/minor follow-ups. Round-0 findings 1-4 are resolved.

### Checked and correct

- Popup placement: `native-dropdown.component.ts` renders content in place, not in a portal, so the menu popup is inside the tablist DOM. Focus moving from a chip to the trigger or a menu row has a `relatedTarget` inside the dock, so `onDockFocusOut` returns early and the freeze is neither cleared too early nor held after the menu closes by itself.
- Menu select: choosing a row removes the focused row; focusout has a null `relatedTarget`, so the freeze clears, then `focusTab` refocuses the chosen chip, `focusin` re-freezes on the new visible set (the chosen agent is in `keep` through `selected`). Net result is correct, with one extra layout recompute.
- Keyboard arrows: `pendingTabFocusKey` is set before the select and cleared in the `afterNextRender` focus callback, and freeze keeps the previously selected finished chip in the strip, so ArrowLeft can return to it (round-0 finding 2).
- Agent finishing while frozen stays inline, so the focused chip is not destroyed (finding 1). Selection changing while frozen is covered by `keep = frozen + selected`.
- Effects: both effects write no signals (`restoreDockFocus` only sets plain fields), so no loop. `focusRecoveryPending` always resets inside the callback, and the callback bails unless `document.activeElement` is body, so it does not steal focus from a deliberate move. `afterNextRender` is created with `{ injector }`, so it is torn down with the component.
- Hover card: cleared when the key leaves `visibleKeys` and `openCard` refuses non-visible keys (finding 3).
- Accessible name: aria-label "N more agents[, waiting/failed]" contains the visible text "N more" (compact shows the bare count), satisfying label-in-name (finding 4). Users-icon branch removed.

### New findings

1. Moderate — Freeze can last as long as focus rests on the dock. canvas-lane-tabs.component.ts `onDockFocusIn`/`onDockFocusOut` (about lines 503-519) and `layout` (about line 322). A mouse click on a chip focuses it, so the freeze holds until the user clicks elsewhere (typically the composer, which clears it). During that time: new agents (including `waiting`/`failed`, which normally rank first) are forced into the menu instead of inline, newly finished agents stay inline, and width changes are ignored. The menu trigger pip still signals waiting/failed, so attention is not lost. Suggestion: freeze only for keyboard focus (`:focus-visible`), or let `waiting`/`failed` agents join the frozen set.
2. Minor — Stale `focusedChipKey` plus focusout with null `relatedTarget`: when focus leaves the dock to a non-focusable target while the remembered chip is no longer visible (rail, or the agent left the roster), `restoreDockFocus` pulls focus back to the dock (`document.activeElement === body` test passes). Narrow, since freeze normally keeps the chip visible. Suggestion: clear `focusedChipKey` when focus moves to a non-chip element inside the dock (trigger, menu row).
3. Minor — The menu still lists every agent while the trigger says "N more"; the checked row can be an inline agent. Acceptable and consistent with the requirement; noted for wording only.

Remaining uncertainty: browser differences in whether `focusout` fires when a focused element is removed (both paths, `focusout` and the effect, lead to `restoreDockFocus`, so it is covered), and no manual keyboard run was done.

## Re-review (round 2)

Review family: claude (reviewer) vs codex (implementer). Scope: changed code in canvas-lane-tabs.component.ts (input-modality tracking, frozen-set merge, `@HostListener('document:keydown')`) and the new spec titles. Static read; I did not rerun verify.

Verdict: APPROVE. Confidence MEDIUM. 0 blocking, 0 serious, 2 minor follow-ups. Round-1 finding 1 (freeze outliving a mouse click) and finding 2 (stale `focusedChipKey`) are resolved.

### Checked and correct

- Event order: `pointerdown` (sets `pointer`) precedes the focus the click causes, so `onDockFocusIn` sees `pointer` and does not freeze; `click` then releases any existing freeze. Touch and pen also emit `pointerdown`, so they behave like the mouse.
- Keyboard path: the document `keydown` handler (about line 520) sets `keyboard` and freezes when the active element is a tab inside the dock. The chip's own `onKeydown` calls it first because it calls `stopPropagation` on handled keys, which would otherwise starve the document listener; the arrow handler therefore reads a frozen `visibleKeys`. Tab or Shift+Tab from outside: the keydown fires before focus moves (no freeze), sets `keyboard`, and the following `focusin` on the tab freezes. Correct.
- Programmatic focus after a menu choice: a mouse pick leaves modality `pointer`, so no freeze; an Enter pick leaves `keyboard`, so `focusTab` re-freezes. Both are intended.
- Frozen merge: `keep = frozen + selected + waiting/failed`; visible and hidden are produced by filtering `agents()`, so chip order stays in dock order (stable). Because non-rail tabs other than the selected one have `tabIndex -1`, a focused chip is always the selected one and therefore always kept, so the focus-recovery path is not triggered by the merge.
- Cleanup: `@HostListener` is removed by Angular on destroy; no manual listeners were added. `dock()` is only read after the cheap short-circuits, so a keystroke before view init cannot throw. `focusedChipKey` is cleared when focus lands on a non-tab element (trigger, menu rows).

### Findings

1. Minor — Document-wide `keydown` listener per dock instance (canvas-lane-tabs.component.ts about line 520). Every keystroke in the app (including typing in the composer) runs the handler for both the chat dock and the rail dock. The work is a few property reads and returns early, so cost is negligible, but `onDockKeydown` is also invoked directly from `onKeydown`, so it runs twice for handled keys. Optional: scope to focus events instead (the `focusin` path already covers Tab in), and keep the explicit call only for the arrow path. Style note for the style reviewer: mixing `@HostListener` with the `host:` metadata block.
2. Minor — Modality is a sticky plain field, initial value `keyboard`. Assistive-technology activation (virtual cursor click with no `pointerdown` or `keydown`) after a prior keyboard use, or a programmatic focus into the dock at startup, will freeze the strip until focus leaves. Impact is limited to a temporarily unchanged chip set (waiting/failed agents still appear). No change required; consider resetting to `pointer` on `focusout` leaving the dock.

Remaining uncertainty: no manual run with a screen reader or touch device; the freeze interplay with the rail was only read, not exercised.
