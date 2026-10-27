# Code-logic review — Revision 3 (working tree)

**Scope**: uncommitted diff on `feat/chat-layout-declutter` (worktree `.claude-worktrees/chat-layout-declutter`): the `@defer` rail in the inspector dock, the Session-details title row, the `send-to-messaging` `trigger` input, `canvas-board-focus.ts`, the canvas/chat unit specs, and the Electron e2e specs and showcase scenes. `HANDOFF.md` ignored as instructed. `design-spec.md` `## Revision 2` was read as the requirement source.

**Score: 6/10 — verdict: APPROVED WITH FIXES** (1 blocking, 0 serious, 2 minor).

The implementation matches the Revision 2 decision (title-row controls, icon Hand off, no `⋯` in the expanded sidebar) and the unit specs drive the defer blocks correctly. One named acceptance criterion fails at runtime with no test to catch it.

---

## Findings

### 1. BLOCKING — `closeCompactSheet()` can never focus the rail expand button; focus falls to `<body>` on every compact-sheet close

`libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts:391-404` (with the defer block at `:130-164`).

**Failure scenario.** While the compact sheet is open (`detailsOpen && compactSheet`, board width < 400 px), the outer guard `@if (dockShown() && !compactSheetOpen())` at `canvas-inspector-dock.component.ts:130` is false, so the rail's `@defer (on immediate)` block is **destroyed**. The sheet's own defer test confirms this: while the sheet is shown, `getDeferBlocks()` returns 1 block, not 2 (`canvas-inspector-dock.component.spec.ts:207-230`).

When the user closes the sheet (the X button, Escape via `onDocumentEscape` at `:406-409`, or `openLaneFromCompactSheet`), `closeCompactSheet()` sets `detailsOpen` false and registers one `afterNextRender` that queries `[data-inspector-rail] [data-inspector-expand]`. That callback runs after the *first* render, which only re-creates the defer block and shows the `@loading` div (`:160-164`). The rail content mounts in a *later* render, after the cached `import()` promise resolves. So the query finds nothing, `?.focus()` is a no-op, and the focused sheet close button was just unmounted — `document.activeElement` is `<body>`. This is deterministic on every sheet close, not a rare race.

This breaks the acceptance criterion "focus on the rail expand button still works after closeDock()/closeCompactSheet()" and re-introduces exactly the focus-to-`<body>` regression class this task set out to fix (item 3). No test covers it: the unit specs force defer completion with `completeDeferBlocks()` (`canvas-inspector-dock.component.spec.ts:135-141`), which hides the ordering, and no e2e spec exercises the compact sheet at all.

Note the asymmetry that proves the pattern was available: the two other deferred focus targets in the same file handle the delay with a `MutationObserver` (`focusDetailsShell`, `:359-384`; `focusDock`, `:512-536`). `closeDock()` (`:473-488`) survives in practice only because its defer block stays alive while the dock is open, so the rail renders in the same render as the collapse. On a cold first load where the user collapses before the `on immediate` chunk finishes, `closeDock()` has the same miss; the same fix covers that edge.

**Suggested fix.** In `closeCompactSheet()` (and `closeDock()` for the cold-load edge), do not rely on one `afterNextRender`. Either reuse the `MutationObserver` pattern from `focusDock()`: focus a stable ancestor (or nothing) and move focus onto `[data-inspector-expand]` when it appears, respecting "only move focus if the user has not moved it elsewhere"; or use a bounded `afterNextRender` retry like `restoreBoardFocus` (`canvas-board-focus.ts:48-64`). Add a unit spec that does NOT call `completeDeferBlocks` first, so the ordering is actually exercised.

### 2. MINOR — showcase stale-cleanup can close the wrong session when a split is open

`apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:126-128`, `chat-code-edit.scene.ts:225-227`, `lane-console-review.scene.ts:102-105`.

**Failure scenario.** The cleanup clicks

```ts
page.locator('ptah-canvas-rail-board:visible')
  .getByRole('group', { name: 'Session controls' })
  .getByRole('button', { name: 'Close session' }).first();
```

scoped to the whole board. In split view each pane's floating control group also has `aria-label="Session controls"` and a "Close session" button (`canvas-focus-header.component.ts:37,146-154`), and the panes precede the sidebar in DOM order (`canvas-rail-board.component.ts:280` panes, `:346` dock). If a previous scene left a split open and the stale session took the *right* pane (the card click gives it the active pane), `.first()` resolves to the left pane's live session and the cleanup closes the wrong session. The stale session survives and can corrupt the rest of the recording; the `.catch(() => undefined)` swallows it. The old code located Close inside the matched tile, so it could not misfire.

**Suggested fix.** Scope the locator to the sidebar, as the e2e spec already does elsewhere: `.locator('[data-inspector-rail], [data-inspector-dock]').getByRole('group', ...)`.

### 3. MINOR — the icon Hand-off button carries no `title` of its own

`libs/frontend/chat/src/lib/components/molecules/send-to-messaging/send-to-messaging.component.ts:112-125`.

The text variant gets its hover explanation from the wrapping `<span trigger [title]="triggerTooltip()">`; the icon variant relies on that inherited span title, while every other icon button added in this diff (Stop `canvas-focus-header.component.ts:47`, view toggle `:62-66`, collapse `session-inspector.component.html:133`) sets `title` directly. A mouse user hovering the title-row icon gets the tooltip only because the span wraps it — this works, but the button's accessible name ("Hand off session") and the tooltip ("Hand off session to…") come from different elements, and any future re-parenting of the trigger loses the tooltip. Not a behavior break today; the spec pins the current arrangement (`send-to-messaging.component.spec.ts:549-552`).

**Suggested fix.** Add `[title]="triggerTooltip()"` (or `HANDOFF_LABEL`) to the icon button for parity with its neighbours.

---

## The five logic questions

1. **How does this fail silently?** Finding 1: the `?.focus()` no-op is silent by construction, and every unit test forces the defer block to complete first, so the suite is green while production drops focus to `<body>`.
2. **What user action produces unexpected behaviour?** Narrow canvas (< 400 px): open Session details (sheet), close it with Escape or the X. Keyboard and screen-reader users land on `<body>`; the rail expand button is never focused, contradicting the task's own acceptance check.
3. **What input data makes this produce a wrong answer rather than an error?** None found. The `@loading` div correctly holds `occupiedWidth()` (56 px) so widths cannot double-subtract; `closeLabel` correctly separates sheet (X, "Close session details") from dock/rail presentations (PanelRightClose, "Compact session details", `session-inspector.component.html:93-96,136-138`), and the rail template never renders the title row.
4. **What happens when a dependency fails, times out, or returns an odd shape?** If the inspector chunk is slow, `restoreBoardFocus` retries at most 5 renders and then gives up silently (focus stays on `<body>`). In practice the `on immediate` block loads when a session first focuses, long before any pane can be closed, so 5 renders is enough — but this is a bounded-silence design worth knowing. The dock/sheet `MutationObserver` paths keep working. No crash path found: the fallback chain `group → [data-compact] → first enabled button → expand/close` always ends in a null-safe no-op.
5. **What is missing that the requirements never mentioned?** No test at any level covers the compact-sheet close focus path (finding 1), and nothing pins that the rail's `@loading` placeholder keeps 56 px in the real browser (only asserted after forced completion, `canvas-inspector-dock.component.spec.ts:183-194`).

---

## What was checked and passed

- **Defer wrapping (criterion 1).** The block wraps `@if (!dockOpen())` so the chunk loads while the dock is open, and `closeDock()` then renders the rail synchronously (`canvas-inspector-dock.component.ts:132-164`). `@loading` holds the exact width. Spec block counts updated correctly (dock 2, sheet 1) and `completeDeferBlocks` completes *all* blocks, including the rail's (`canvas-inspector-dock.component.spec.ts:135-141,207-230`).
- **Title row (criterion 2).** Order verified in the template: Stop (running only) → view toggle → Hand off icon → Close session (`canvas-focus-header.component.ts:41-77,146-154`), then the inspector's own `data-inspector-close` collapse button last (`session-inspector.component.html:124-142`), exactly once per row. `sendToInMenu` excludes Hand off from every menu in embedded mode (`:181-183`), and the dock never binds `splitDisplayed` to the header, so the expanded sidebar has no `⋯` at all. The old `inspectorActions` slot has no remaining source consumer (only spec documents mention it), so removing it strands nothing. Status/workflow/branch render under the title (`:110-122`). The `trigger` input defaults to `'text'`; the text variant is byte-identical to before, so the rail `⋯` menu is unchanged; the only other live caller is the new icon instance (`grep`: no other `<ptah-send-to-messaging>` in the repo).
- **Focus helper (criterion 3).** `restoreBoardFocus` re-checks `focusLost` on every retry, so focus the user moved elsewhere is never stolen (`canvas-board-focus.ts:54-60`); retries are bounded at 5 one-shot `afterNextRender` callbacks, with no timers or observers to leak; queries are scoped to the board element, so several boards cannot steal from each other; `side()` is re-read per retry so a flipped `activeSide` after `focusTile(survivor)` targets the survivor's controls. `canvas-rail-board.component.ts` is 1172 lines (≤ 1241). Both changed board-spec tests assert the new targets with the split's per-pane controls gone (`canvas-rail-board.component.spec.ts:2871-2945`).
- **e2e specs (criterion 4).** `data-testid="canvas-tile"` and the pane `aria-label` sit on the same `<section>`, so the scene locators match (`canvas-rail-board.component.ts:280-306`); `paneLabel` values ("Focused session: X", "Left session: X, active") both satisfy `/^\w+ session: /`. `COMPOSER` matches a real `textarea[role="combobox"]` (`chat-input.component.ts:317,336`), and the click still activates the pane through the section's `(click)`/`(focusin)`. The compaction spec's `exact: true` "Compact session details" matches only the collapse button, not the title-row "Close session". The "Close pane" focus assertion (`canvas.spec.ts:246-248`) retries until focus lands inside the sidebar group and fails if focus stays on `<body>` — it proves the original intent. Each renamed test still proves its original claim (floating controls clear of the rail; details opens from the rail; swap/close-split/close-pane tab semantics).
- **Rev 2 review follow-ups.** The rev2 duplication defect (Hand off twice) is gone (icon in the title row, menu item suppressed); the "actions lost when identity is empty" defect is gone with the slot (the controls row renders unconditionally, `session-inspector.component.html:124-125`, pinned by the new spec at `session-inspector.component.spec.ts:270-279`).

## Decisions

- **Severity of finding 1: blocking, not serious.** Evidence: the task objective names "focus on the rail expand button still works after closeDock()/closeCompactSheet()" as a check; the failure is deterministic on every sheet close and invisible to the suite. Options considered: serious (limited to < 400 px layouts) — rejected because a named acceptance criterion fails and the fix is small. Reversible: one function, plus a spec.
- **Pre-existing behaviours unchanged by this diff were not scored**: closing a whole session from the rail (sidebar unmounts, focus falls to `<body>`), and `toggleDetails()` not restoring focus in compact mode. Both predate the diff; flagging them as new defects would misattribute them.
- **Angular defer timing was reasoned from the loading contract** (dynamic `import()` always resolves after the current render; the `afterNextRender` registered before that render fires first). This could not be executed here; the MutationObserver paths in the same file show the authors of the surrounding code assumed the same ordering.

## Could not check

- The bundle size itself — instructed not to rebuild; 3.96 MB taken as given.
- The e2e suite and showcase scenes were **not run** (coordinator verified only chat-ui/chat/canvas unit targets); the e2e/scene review is static, so runtime selector drift is still possible.
- Exact microtask interleaving of `afterNextRender` vs a cached defer load in the production bundle — analyzed, not measured; the conclusion holds for every interleaving because the callback is one-shot and the rail mounts in a strictly later render.
- `canvas-rail-board.component.spec.ts` (~3000 lines) was reviewed via its diff hunks plus targeted reads, not in full.