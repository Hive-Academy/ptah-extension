# Code Logic Review, R9 phase fix A (scoped re-review) - TASK_2026_629_c0b3

Review family: Claude; implementer family: codex. Read-only review.

| Metric | Value |
| --- | --- |
| Score | 8.5/10 |
| Verdict | APPROVE (no blocking or serious issues; 3 minor notes, none needs a correction round) |
| F1 status | FIXED |
| New findings | 0 blocking, 0 serious, 0 moderate, 3 minor |

Scope: `git diff HEAD -- libs/frontend/canvas` (canvas-rail-board.component.ts hunks at :507-520 and :648, plus the new spec case at canvas-rail-board.component.spec.ts:769-802). I read the full class logic (effects :294-390, `activeId` :479, `paneTab` :486, `activatePane` :507, `openBeside` :522, `closeSplit`/`closePane` :556-580, `focus` :642, `close` :700ff), the real `CanvasRailCardComponent.openSession` (canvas-rail-card.component.ts:273) and `CanvasStore.focusTile` (canvas.store.ts:424).

Check run (through the lock): `canvas-rail-board.component.spec.ts` gave `Test Suites: 1 passed, 1 total`, `Tests: 70 passed, 70 total`, no `●` failures. The lock wait was 20 s. Log: `%TEMP%\629-check-phaseA-rev.log`.

## 1. F1: FIXED

Defect trace (before the fix). `openSession` (card:273-276) calls `canvasStore.focusTile(B)` and only then emits `focusRequested`. `CanvasRail` forwards it (canvas-rail.component.ts:192), and the board binds `(focusRequested)="focus($event)"`. `focus(B)` takes the `id === otherTabId()` branch (:643) and calls `activatePane`. That method used to read `current = activeId()`. `activeId()` is store-focus-first (:479), so it returned B. The result was `otherTabId.set(B)`, `activeSide` flipped and store focus B, so both panes showed B.

After the fix. `activatePane` reads the board-owned `lastFocusedId` (:513). Trace for the spec scenario:

1. `openBeside('b')` sets other=a, side=right, last=b.
2. `activatePane('left')` sets other=b, side=left, last=a.
3. The card writes store focus=b synchronously.
4. `focus('b')` runs (:643) and calls `activatePane('right')`.
5. `current = last = a`, `id = b`. `otherTabId.set(a)`, side=right, last=b, `focusTile(b)`.

Result: sides swapped, ids distinct (right=b, left=a), store focus=b, two hosts. The effect then sees `focused === lastFocusedId` and returns at :372, so there is no double swap.

Click and keyboard. The card has three entry points, and all converge on `openSession()`: the host click (:292), the child `expandToFull` (:133) and the host Enter (:312). A real click on the compact select button can fire both `expandToFull` and the host `onClick`. The second call is benign: `focus(b)` now takes the normal branch, `id === lastFocusedId`, so there is no announcement and `focusTile(b)` is idempotent. Enter and Space on the select button are native button-to-click, so they follow the same path.

Would the new spec fail if the fix were reverted? Yes. It mounts the real `CanvasRailCardComponent` (only the compact child is swapped for `SelectCardStub`), wires its real `focusRequested` output to the real `board.focus`, and runs the real `openSession()` (spec:781-790). With the old code, `current = activeId() = b = id`, so `otherTabId` becomes b with the active side right, and `paneTab('left')` is `b`. The assertion `paneTab('left') === 'a'` (spec:795) fails, and `assertDistinct` (:336, dev mode) would also throw. I reasoned this from the code and did not run the revert, because I am read-only. The test passes 3 of 3 parameter cases on the fix (click, Enter, Space).

Bonus effect. The same early store write happens in `CanvasFocusAreaComponent.stop` (focus-area:122) from the inactive pane. There, the button click writes store focus first and then bubbles to the section `(click)="activatePane(side)"`. That path had the same duplicate-pane failure and is fixed by this change too. It is untested.

## 2. `lastFocusedId` staleness audit

Steady-state invariant: while split, `lastFocusedId` equals the active pane's tab.

Where it is written:
- `openBeside` :543
- `activatePane` :517
- `focus` :649
- `closeSplit` and `closePane` :559 and :575
- `close` :711 and :715
- the reconciliation effect: :345, :351, :360, :368, :379

Every transition into a split sets it, and every external store-focus change is mirrored by the effect (:372-379).

| Case | Result |
| --- | --- |
| External removal of the active tab | Effect :364 collapses the split, so `activatePane` returns at `!otherTabId`. No stale use. |
| External removal of the other tab | Same collapse. The `paneTab` guard (:491, `orderedTiles().some`) means a removed id is never mounted. |
| Hydration with null focus | Only reachable un-split. :357-361 seeds `lastFocusedId` and `activeId()` falls back to it. A later `openBeside` makes `lastFocusedId = active`. OK. |
| C1 surface-inactive repair deferral | The effect still updates `lastFocusedId` without the store write (:360, :372-379), and `activeId()` falls back to it. `activatePane` therefore sees the same tab as before. The unconditional `focusTile` in `activatePane`/`openBeside` is pre-existing and not changed here. |
| Cancelled close | `close()` (:700ff) touches `lastFocusedId` only after a confirmed removal (:368 returns early). OK. |
| Workspace switch back | `visible() === false` collapses the split (:349-354). On return the board is un-split, so `activatePane` is not reachable. The effect re-syncs `lastFocusedId` (:372-379). OK. |
| `lastFocusedId === null` while split | Not reachable: all split-entering and split-keeping paths assign a non-null id. |
| `lastFocusedId === otherTabId` | Not reachable: `openBeside` guards `id === current`, and the effect swap sets last to the new focus and other to the old one. |

Could `activatePane` set `otherTabId` to null, stale or equal to the id? Null and equal are blocked by the new guard (:514). A stale value is possible only in the transient window described in N2.

Invariants:
- Never the same tab twice: improved. The pre-fix duplicate is gone, and the guard blocks `current === id`.
- Never a third host: `paneTab` still gates on `orderedTiles` membership and on `activeId()`. `activatePane` only assigns a previously displayed id.
- S1: unchanged.
- C1: no new store write, and the existing gates are intact.
- B2 and M2/M3: untouched.
- Swap only changes `visualOrder`: `activatePane` does not touch `visualOrder`.

`announceReplaced` change (:648). Using `lastFocusedId` is an improvement. When a card writes store focus first, `id !== activeId()` was false and the replace announcement was suppressed. Now it is announced correctly.

## 3. New findings (all Minor; none needs a correction round)

N1. Minor. canvas-rail-board.component.ts:513-514. The guard `if (!current || current === id) return;` is a silent no-op. If it were ever hit after a card had already written store focus, the split would be left with store focus equal to the other tab. `paneTab` would return null for the inactive side (:489-491), and the effect would also return (`focused === lastFocusedId`, :372). Nothing would announce or repair it. By the invariants above this is unreachable today, so it is a defensive guard without a self-heal. Fix, optional: in the guard branch, collapse or re-sync instead of returning, or assert in dev mode.

N2. Minor. canvas-rail-board.component.ts:513. Transient window. If an external writer moves store focus to a third tab C (replacing the active pane) and an `activatePane` call arrives in the same task before the reconciliation effect flushes, the old active tab A is kept and C is dropped. Previously the opposite happened. The user's own events are separate tasks, so effects flush between them, and the result is a valid, distinct state either way. Impact is cosmetic; no fix needed.

N3. Minor (test coverage). spec:769-802. The regression is a real-card test wired to the real board handler. It does not cover the full Rail DOM chain: the board spec replaces the Rail with `RailStub`, and the compact child is stubbed. Enter and Space are emulated by `keydown.enter` and `keydown.space` handlers on the stub, whereas the real child relies on a native button click. The lane-action path (`CanvasDetailService.open`, which also writes store focus first) and the focus-area `stop` path are not covered by their own case. The report's claim that the board fix covers them rests on code reading, which I confirmed above. The fix report discloses the stub limits honestly. A defensive-guard negative test (N1) is also absent.

## Five logic questions (fix scope)

1. Silent failure: only the N1 guard no-op, which is unreachable.
2. Unexpected user action: click, Enter and Space on the inactive pane's card now swap correctly. The inactive pane's `stop` button also works. The double `expandToFull` plus host click is idempotent.
3. Wrong-answer inputs: none found. A stale `lastFocusedId` occurs only in the same-task window (N2).
4. Dependency failure: `focusTile` always synchronously writes the signal (canvas.store.ts:424-428). A cancelled or failed `removeTile` leaves `lastFocusedId` untouched.
5. Missing: no negative or defensive-branch test, and no direct test for the lane and stop routes (N3).

## Verdict

Score 8.5/10. APPROVE. F1 is FIXED at the root: the board no longer trusts a store value that other callers are allowed to write before the board's own event arrives. The change is small, is covered by a regression that fails without it, and holds the R9w/R9x invariants. The remaining notes are minor and may be recorded without a correction.
