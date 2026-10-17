# Code Logic Review, Batch 5 (TASK_2026_690_a5c0)

Review family: claude reviewing codex

Score: 8/10. Verdict: APPROVED (no Blocking or Serious findings; moderate and minor items optional).

Scope: uncommitted diff in the worktree, whole files read for `display-sheet.component.ts` and the `canvas-lane-view.component.ts` template. Collaborators read: `display-dock.state.ts` (`open`, `close`, `toggle`), bubble scroll code. Nothing was run, per instruction.

## Fix A: hide the Display bar when the tab is empty

`display-sheet.component.ts:20,77`: `visible = open || surfaces.length > 0 || summaries.size > 0`, bound to `[style.display]` on the host. `null` removes the inline style, so `:host { display:flex }` applies and the open/full host classes are unaffected. `display:none` also removes the bar from the tab order and the accessibility tree.

Open paths:
- Auto-open on a new surface: sets `surfaces`, so the sheet is visible.
- Summary chip: a summary exists, so the sheet is visible.
- Inline "open in display" (`execution-node.component.ts:475` -> `openSurface`): `openedState` sets `open`, so the sheet is visible. No path needs the bar first.
- Keyboard: the bar keydown handlers only fire on a visible bar. Programmatic `dock.open` makes `open` true, so the sheet is visible. The spec "shows the bar when explicitly opened without content" covers this.
- Tab switch: `tab(tabId)` is per tab, so an empty tab hides the sheet and switching back shows it. `everOpened` and the pulse effect are untouched, so the 683 session-switch motion is not affected.

Findings:
1. Minor, `display-sheet.component.ts:107` (`collapse()`): focus goes to the bar, and if the tab has no surfaces or summaries the host then becomes `display:none`. This is reachable only if content was cleared while the sheet was open or opened programmatically. Focus falls to `body`. Low probability.
2. Minor, `chat-view.dock.spec.ts:~624`: on switching back to tab-1 the spec only asserts that the region exists. It no longer asserts that the host is shown or `aria-expanded` is true. The old tab-2 `aria-expanded=false` assertion was replaced by `display:none`. This is adapted, not removed: the component spec covers visibility directly, and every other dock-spec test now seeds a surface first. A single `expect(dockEl().style.display).not.toBe('none')` after switching back would close the gap.
3. Minor, keepalive spec: the added `setSurfaces` seeds `{ key: 'id:a' } as DisplaySurface` casts. That is fine for visibility but fragile if the sheet starts reading other surface fields.

Spec verdict: coverage is adapted, not weakened. Four new component-spec cases cover empty (hidden), surface, summary-only and open-only. The existing open, Escape, focus and defer-failure tests now seed content before clicking the bar.

## Fix B: fill-height in the Canvas sub-agent lane

`fillHeight` defaults to false at every layer (`execution-node.component.ts:481`, `inline-agent-bubble.component.ts:645`). It is set to true only at `canvas-lane-view.component.ts:180`. The bubble children rendered via `bubbleChildTemplate` and the other hosts (transcript, mcp-apps, wizard) do not pass it, so `max-h-80` is kept. The bubble spec asserts both states (`max-h-80` by default, `flex-1` when filled).

Findings:
4. Moderate, `inline-agent-bubble.component.ts:87-88,549-554`: in fill mode the outer card is `flex-1`, regardless of collapse. When the user collapses the agent (grid `0fr`), the card still stretches over the whole lane and shows a large empty `surface-1` block under the header. The grid collapse animation itself works: `.fill-height:not(.agent-collapsed)` only adds `flex:1` when expanded. Only the card stretch looks odd. Suggestion: apply the `flex-1` classes only when `fillHeight() && !isCollapsed()`.
5. Minor, `inline-agent-bubble.component.ts:86`: the `my-3` vertical margin remains in fill mode, so the card is inset 12px top and bottom inside the lane. Likely acceptable, but the measurement report should confirm it.
6. Auto-scroll is OK: `#contentContainer` is still the single `overflow-y-auto` element. It is `flex-1 min-h-0` inside a flex-col `.agent-collapse-inner` that sits in a grid with a definite height. `scrollHeight` and `scrollTo` (lines 735-751) are unchanged, and the MutationObserver is attached to the same element.
7. Minor, `canvas-lane-view.component.ts:102`: the new `h-full min-h-0 flex flex-col` on `rail-lane-enter` applies to every lane.
   - CLI: its inner div is already `h-full flex flex-col`, so there is no change.
   - Background strip: it becomes a flex-col item, so it stretches full width and is still intrinsic in height. It is also now shrinkable (`flex-shrink:1`, min-height auto), which is harmless.
   - Saved-transcript fallback: the inner div changed from `space-y-2` to `flex gap-2`. The viewer is a flex item with default `min-height:auto`, so it will not shrink below its content and overflows as before. The panel has no overflow of its own, so the scroll owner is unchanged.
   - The `transform` animation was already applied to this wrapper, so there is no new stacking-context change.
   - Without a browser run I rate the risk of a visible change as low. Please confirm with a screenshot of the CLI and background lanes.
8. Minor, `execution-node.component.ts:423`: the selector `:host(.fill-height), .exec-fill-height` is correct under emulated encapsulation. The wrapper div is the only flex participant between the host and the bubble host, which is correct for the agent branch. Other branches are not given fill classes, which is intended.

## Five logic questions (brief)

1. Silent failure: none new. A tab that is hidden but has `open=true` cannot occur, because `open` forces `visible`.
2. Unexpected user action: collapse on a sheet whose content was cleared strands focus (finding 1).
3. Wrong output from data: `summaries.size > 0` with an empty `Map` is correctly hidden. Summaries with no surfaces show "Display · 0" (acceptable, matches D2 "turn summary").
4. Dependency failure: unchanged.
5. Missing: no test asserts the collapsed fill-mode appearance (finding 4).

## Requirements

| Requirement | Status |
| --- | --- |
| D2 hide until content or open | COMPLETE |
| Every open path still visible | COMPLETE |
| Per-tab state / 683 motion intact | COMPLETE |
| D3 Canvas sub-agent lane fills, single scroller | COMPLETE (collapsed look, finding 4) |
| Other hosts keep max-h-80 | COMPLETE |
| CLI/background unchanged | PARTIAL: reasoned, not visually verified |
| Specs adapted not weakened | COMPLETE (finding 2 is a small gap) |

Verdict: APPROVED. Confidence: MEDIUM-HIGH. The layout claims are reasoned from CSS only. The top risk is finding 4, the large empty card when collapsed in the Canvas lane.
