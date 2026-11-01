# Correction review: dock overflow menu lists only hidden agents

Review family: claude (reviewer) vs codex (implementer)

Score: 8/10
Verdict: APPROVED (no Blocking or Serious findings)

## Findings

1. Moderate. `canvas-lane-tabs.component.ts:413-417`, `:230`. Focus recovery on "hidden set becomes empty" only runs when the menu is open (`menuOpen()`). If the menu is closed and its trigger button holds keyboard focus (after Escape, or after tabbing to it), and the hidden set empties (an agent revives, or the dock widens), the `@if (view.hidden.length > 0)` removes the trigger and focus drops to `document.body`. Neither the `focusedChipKey` effect (line 409; `onDockFocusIn` nulls it when focus lands on a non-tab, line 540) nor the `menuOpen` effect covers this. The user's rule only names the open case, so this is not a requirement miss, but it is the same failure with the menu closed. Fix: track focus on the trigger (or `focusin` target with `aria-haspopup`) and call `restoreDockFocus()` when it disappears. No test covers it.

2. Moderate. `agent-dock-menu.component.ts:176`, `dock-overflow.ts:89-94`. Rows are re-sorted live by status while the menu is open. A running agent finishing, or an agent entering `waiting`, moves rows under a pointer that is about to click. Keyboard is safe because roving focus is tracked by key (`rovingKey`, line 177). The backdrop blocks the dock but not status updates. This follows the user-chosen flat status order. Optional mitigation: snapshot the order while open and apply changes only on close. Otherwise accept and note it.

3. Minor. `agent-dock-menu.component.ts:97-123` (`menuitemradio`, `aria-checked`, check icon). The selected agent is always pinned inline: `planDockOverflow` retains `selectedKey` (`dock-overflow.ts:108,118`), and the frozen branch adds `selected` to `keep` (`canvas-lane-tabs.component.ts:332`). It can therefore never be in `hidden`. `aria-checked` is always false, the selected-marker branch is dead, and `checkedKey()` always falls back to `agents[0]`. A radio menu with no checked item is misleading to screen readers. `role="menuitem"` and dropping the check/`selectedKey` input would match the new semantics. `rovingKey` and `checkedKey` still work.

4. Minor. `canvas-lane-tabs.component.ts:237,414`. If `rail()` flips true while the menu is open, the component is destroyed without `openChange(false)`. `menuOpen` stays `true` until hidden later reaches 0, when the effect fires a harmless `restoreDockFocus()`, which is guarded by `activeElement === body`. No user-visible bug.

5. Minor. Formatting: `dock-overflow.ts:75-94` (one-line `case`s, long signature) and the `@for` body indentation in the menu template (line 94 onward) are not prettier-clean. This is a style matter for the style reviewer.

## Checked

- Count equals rows: trigger label, compact badge, `pile` and the rows all derive from `hidden()` (`agent-dock-menu.component.ts:67,71,150,154,176`). The parent passes `view.hidden` only, and the old `agents` input is gone. The `view.hidden` contract holds in all three branches: `planDockOverflow`, frozen (`canvas-lane-tabs.component.ts:337`) and rail (not rendered).
- The `hidden` set from `planDockOverflow` is the complement of `visible` in both branches (`dock-overflow.ts:111-114,134-137`). Finished agents (done/stopped) still go to the dropdown unless they are the orchestrator or selected. The rule is unchanged.
- Order: `menuRank` gives running, waiting, failed, queued/null, done, stopped, stable by dock index. There are no kind headings.
- Menu visibility: it now renders whenever `hidden.length > 0` and not in rail mode. A small roster with only finished agents hidden gets a menu, and a roster with none hidden gets no trigger.
- Roving focus and aria: `tabIndex` follows `rovingKey`. The arrow, Home/End-style, Enter/Space, Tab and Escape handlers use `orderedAgents` and `rovingKey`. If the active row vanishes, `rovingKey` falls back to a remaining row and the effect (`:185-195`) refocuses it only when focus was lost to `body`, so it does not steal focus. When `keys` is empty the keydown handler returns early.
- Empties while open: the menu is destroyed by `@if`. `NativeDropdown.ngOnDestroy` hides the layer and cleans up (`native-dropdown.component.ts:411-417`). The parent effect resets `menuOpen` and `restoreDockFocus()` focuses the selected inline tab. The guard in `restoreDockFocus` (`:598`) correctly skips when focus is already inside the dock.
- `choose()` and the parent `onMenuSelect` still pick and focus the tab after the menu closes. If the pick empties the hidden set, `setOpen(false)` has already fired, so there is no stale `menuOpen`.
- `setOpen` emits `openChange` only on change, so there are no duplicate emissions.
- The spec (`canvas-lane-tabs.component.spec.ts:928`) covers focus on a remaining row and restore-to-selected-tab on empty. Earlier tests cover order and count equality. I did not run tests (the coordinator runs verify). The correction report states lint, test and typecheck passed.
- Not verified: real Electron rendering. The report says none was done.
