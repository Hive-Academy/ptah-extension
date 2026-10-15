# Code Logic Review — CodeRabbit canvas fixes (PR #730)

Review family: Claude reviewing codex

Scope: uncommitted diff of `apps/ptah-extension-webview/tailwind.config.js`, `base-content-muted.spec.ts`, and `libs/frontend/canvas` (6 comments: 4277283760, 797, 810, 818, 828, 841). Other writers' changes ignored. Source read in full for the touched functions; electron e2e spec `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` read (read only). I re-ran `canvas-rail-keyboard.spec.ts` myself: 17/17 pass.

Score: 8/10. Verdict: APPROVE-WITH-FIXES (one Moderate, three Minor; none blocking).

## Per-comment result

| Comment | Fixed? | Evidence |
| --- | --- | --- |
| 4277283760 anubis idle ink | Yes | `tailwind.config.js:115` `#6b7280` -> `#9ca3af`. I computed contrast: 7.30:1 on base-100, 6.82:1 on base-200, 6.04:1 on base-300. Only the anubis token changed; consumers (`canvas-rail.component.ts:63`, `canvas-focus-header.component.ts:16`, `canvas-rail-card.component.ts:67`, `compact-rail-card.component.ts:84`) read the var with a fallback, nothing hardcodes the old hex. Test `base-content-muted.spec.ts:54` reads the live config and asserts >= 4.5 on both surfaces named in the comment; it would fail on the old value. |
| 4277283797 bg<->sub mapping | Yes | `canvas-lane-tabs.component.ts:168-171` maps both directions and only returns the alternate when it is actually in the tab keys, else `orchestrator`. Cannot choose a wrong key: `groups()` (lines 120-160) gives a given agent id exactly one key (sub tab only when status != background; bg tab excludes any id that has a sub record), so `sub:x` and `bg:x` are never both present. Test `canvas-lane-tabs.component.spec.ts:119` goes bg -> completed and asserts emit `sub:x`, no emit `orchestrator`, and aria-selected; fails on the old code. |
| 4277283810 expand once | Yes | `canvas-lane-view.component.ts:294-300` per-instance `previousCliId` closure; effect returns when the id is unchanged. Re-select after switching away works: leaving the cli lane makes `selectedCli()` undefined, so `id` becomes null and the baseline resets; re-selecting yields id != null and expands again. A collapse by the user (same id, expanded flips) no longer retriggers. Test `canvas-lane-view.component.spec.ts:152` proves collapse is not re-expanded (call count stays 1; old code would reach 2). |
| 4277283818 aria-label | Yes | `canvas-rail-card.component.ts:113` suffix only when `focused()`; consistent with `aria-current`. Test `canvas-rail-card.component.spec.ts:316` covers both states on the same button. |
| 4277283828 keyboard scope | Yes, with a trade-off (finding 1) | `canvas-rail-keyboard.ts:63-82`; `orchestra-canvas.component.ts:265` supplies the viewport as host. Card branch untouched (the guard sits only in the non-card `else`), so card ArrowUp/Down/Home/End and the Escape path are unchanged. Body/documentElement targets bypass the guard (Revision 1), which keeps the "no focused element" case working. Outside-host targets and scrollable ancestors are rejected. The rail's own `ul` handler (`canvas-rail.component.ts:292`) passes no host, but any target inside the `ul` resolves to a card, so the walk is not reached there. Tablists/menus/dialogs/inputs are still excluded earlier (lines 36-41, 49). e2e only uses `Escape` and `Tab` (`canvas.spec.ts:151, 201`), both unchanged. |
| 4277283841 tile-bound message | Yes | `orchestra-canvas.component.ts:397-398` sets `TILE_BOUND_MESSAGE` when `addTile` returns null. `addTile` returns null only when `tiles().length >= MAX_TILES` (`canvas.store.ts:312`), so the text is accurate. On the normal path the id is truthy and no message is set. The message persists because the clearing effect (line 405) tracks `canAddTile()`, which is false at the bound. Test `orchestra-canvas.rail.spec.ts:399` asserts the status text. |

## Findings

1. **Moderate** — `canvas-rail-keyboard.ts:72-82`: the scrollable-region test treats a vertically scrolling ancestor as a reason to ignore ArrowLeft/ArrowRight. Those keys have no native effect on a region that only scrolls vertically, so the guard is wider than the comment asked for. In this layout the session pane `section` is `overflow-y-auto` (`canvas-rail-board.component.ts:142`) and the lane view host is `overflow-auto` (`canvas-lane-view.component.ts:50`). Whenever the transcript overflows vertically (the common case), board-level Left/Right is dead for any focused non-card, non-input control inside the pane (pane header buttons, a transcript button, etc.). Before the change those keys switched sessions. Suggested fix: pass the key into the walk and check only `overflowX`/`scrollWidth > clientWidth` for Left/Right. The spec only exercises a horizontal scroller (`canvas-rail-keyboard.spec.ts` new case), so it would not catch the over-block either way.
2. **Minor** — `canvas-lane-view.component.spec.ts:152`: no test for "re-select the same agent after switching away expands again". The implementation handles it (traced above) but nothing pins it.
3. **Minor** — `canvas-lane-tabs.component.spec.ts:119`: only the new bg -> sub direction and no negative case (`bg:x` with neither key present still falls to `orchestrator`; a sub record for a different id is not matched). The code is correct; coverage is thin.
4. **Minor** — `orchestra-canvas.rail.spec.ts:399`: the test leaves `canAddTile` true while `addTile` returns null, which is not the real state at the bound; it passes because the clearing effect has no reason to rerun. Setting `canAddTile` false would make it faithful. There is also no assertion that the normal path leaves `headerMessage` empty.

## Checks against the requested risk list

- Rail card branch, tablists, body target: preserved (see table).
- Split panes: the pane container is `overflow-x-auto` (`canvas-rail-board.component.ts:139`); when two 360px panes overflow, Left/Right inside panes is ignored, which matches the comment's intent. Combined with finding 1 the inside-pane case is broader than needed.
- Transcript scroll regions: ignored when overflowing in either axis (finding 1).
- Electron e2e: nothing asserts "in focus" labels, idle ink, arrow-key navigation or tile-bound messages. No breakage expected.

## Verdict

APPROVE-WITH-FIXES. All six comments are genuinely addressed and the tests would fail on the old code. Narrow the keyboard guard to the horizontal axis (finding 1); the remaining items are test-coverage polish.
