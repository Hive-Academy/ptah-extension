# Code Logic Re-review (Rail fix round) — TASK_2026_629_c0b3

Scope: commit 039dfc5a7 only. Read statically (no tests, typecheck or build run). Reviewed whole files for the card, board, rail, focus area, store and persistence paths, the compact smart card and the compact rail card.

## Verdict: APPROVED WITH FIXES

All five original findings are closed. The S1 fix introduced one new Serious regression, in keyboard navigation of the collapsed rail. One Minor visual item is also new.

## Per finding

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 collapsed state frozen | CLOSED (with new Serious N1) | `canvas-rail-card.component.ts:76-86` mounts a hidden smart card in the collapsed branch. `compact-session-card.component.ts:453` emits `railState` from an effect, and the board consumes it through `canvas-rail.component.ts:170` and `canvas-rail-board.component.ts:351`. `effectiveCollapsed` (board `:171-175`) covers both user collapse and the narrow-with-details auto-collapse, and both feed `[collapsed]`, so both modes produce state. No extra live views or transcripts: lane views are mounted only by the focus area (`canvas-focus-area.component.ts:55`), and the hidden card is the same summary-only card the expanded branch runs, so per-tile cost is unchanged. No duplicate announcements: the compact rail card has no `aria-live`, and the only announcements come from the board's `onRailState`, which dedupes on `previous === state` (`:353`). Not in the tab order or a11y tree: `display:none` plus `aria-hidden`. Expanding does not double-mount: the collapsed and expanded cards sit in opposite arms of one `@if/@else`. Swapping re-emits the same state, which the dedupe drops, so no spurious announcement. |
| S2 branch and model | CLOSED | `canvas-focus-area.component.ts:39-40` uses `agentOrigin?.branch ?? null` and `liveModelStats?.model ?? sessionModel ?? null`. These are identical to `compact-session-card.component.ts` (`branch` at `:208`, `metrics.model` at `:398`). |
| S3 `+N more` clipped | CLOSED (Minor N2 remains) | The button is now on the 16 px `h-4` counts line (`compact-rail-card.component.ts:~283-301`). Lane rows are `h-[18px]`, so 16 + 3 x 18 = 70 matches the grid row. The aria-label and the `moreLanes` output are unchanged. |
| M6 live-views count | CLOSED | The team-leader note does not hold. The lane view is mounted only when `focusedTabId()` is non-null (`canvas-focus-area.component.ts:34,54-60`). The board's `focusedId` is non-null exactly when `orderedTiles()` is non-empty, because it falls back to `tiles[0]` (`board:163-169`). Both `orderedTiles()` and `visible()` are read in the after-render effect (`:238`; `visible` at `:237`), so every transition between 0 and 1 mounted views re-runs it. A focus swap A to B stays at 1 (the `@for track` destroys and recreates within one render). The count could be one render behind only if mounting depended on focus alone, and it does not. The `ptah-canvas-lane-view` in the grid-mode detail panel lives outside this host. The write is guarded by `!==`, so there is no loop. |
| M1 implicit `''` path | CLOSED | `orchestra-canvas.component.ts:427-431` passes `activeWorkspacePath() ?? ''`, and `''` is the real implicit partition (`canvas.store.ts:75,177`). The store writes `_workspaceBoard['']`. Persistence guards: `load('')` returns `writable:false` early (`canvas-layout-persistence.service.ts:~188`), `markHydrated('')` refuses (`:251-255`), `schedule` skips paths not in `writable` (`:272`), and `''` is never added to `readOnlyPaths` (it is only added after a real `load`). The implicit board is carried to the first real workspace by `moveIn` (`store:~545`). If `activeWorkspacePath()` is still `null`, the write lands in `''` while `activeBoard` shows the default until hydrate. This is a benign pre-hydrate edge. |
| Alpha classes | CLOSED | `text-base-content/60|70` has no matches in canvas non-spec sources. The replacements use `text-base-content-muted`, for example `canvas-rail.component.ts:77,108,150,192` and `canvas-focus-area.component.ts:64`. |

## New findings

### N1 (Serious) Arrow-key and Escape focus movement is dead in the collapsed rail

- Files: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:265` and `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:422`.
- Both call `card?.querySelector('.rc-select, button')?.focus()`. In collapsed mode the first match in document order is now the `.rc-select` or a button inside the `display:none` hidden smart card, which precedes the collapsed button (`canvas-rail-card.component.ts:76-101`). `.focus()` on a `display:none` element does nothing.
- Scenario: the rail is collapsed (user collapse or below 1120 px with details open). The user presses ArrowDown on the focused dot button. `ctx.focus(id)` updates the store focus, but DOM focus stays on the old card's button. The next ArrowDown resolves `card` from the old button, so `currentId` is unchanged and the key lands on the same neighbour again. Keyboard traversal gets stuck one step away. Escape-to-select is also dead.
- This was working before the S1 fix, because the collapsed button was the only `button` in the card. No spec covers it.
- Fix: in both sites pick the first match outside the hidden producer, for example `[...card.querySelectorAll<HTMLElement>('.rc-select, button')].find(el => !el.closest('[aria-hidden="true"]'))?.focus()`. Alternatively give the collapsed button a `data-rail-select` attribute and prefer it. Add a collapsed-mode keyboard spec.

### N2 (Minor) `+N more` button is 1 px taller than its line and loses its focus ring

- File: `compact-rail-card.component.ts` (`.rc-action` is `height:18px`; the header line is `h-4` with `.rc-line { overflow:hidden }`).
- The button is clipped by about 1 px top and bottom, and its focus outline is largely clipped. It is clickable and visible. This is cosmetic, but it is a keyboard focus-visibility concern. Browser re-check needed. Fix: use `height:16px; line-height:16px` for `.rc-action` inside the header line, or allow `overflow:visible` there.

## Residual uncertainty

N1 is established by static reading (DOM order and `display:none` focus behaviour), not by running it. The Electron visual re-check should include collapsed-rail arrow navigation and the `+N more` focus ring.
