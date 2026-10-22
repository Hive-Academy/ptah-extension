# CI revision 1 — TASK_2026_710 PR #805

Revision round 1 of 2. Fallback implementer. Two serious findings from
`code-logic-review-ci.md`. No local test, typecheck, lint, build, serve, or
e2e was run (lane has no check authorization).

## Files changed

1. `libs/frontend/core/src/lib/services/theme.service.ts`
   `initializeAccent` state-write condition only.
2. `libs/frontend/core/src/lib/services/theme.service.spec.ts`
   one second-boot regression in `describe('accent initialization')`.
3. `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
   dock `shrink-0` removed; workspace sidebar `shrink-0` added; glass-yield
   comment updated to match the flex behaviour.
4. This file.

Not touched: popover lift, theme e2e expectations, `theme-boot-lists.spec.ts`,
`.gitignore`, `styles.css`, layout service clamps, git-rail width assertions.

## 1. Default gold hint must not write state on the second boot

### Change

`setState('ptah-accent', …)` now runs only when:

- the authoritative key is present and not a valid accent, or
- the authoritative key is absent and the `localStorage` hint is a valid
  non-default accent (`rose` or `moonstone`).

Absent key + hint `gold`, and absent key + no hint, do not call `setState`.
The mirror write `localStorage['ptah-accent'] = resolved` is unchanged, so the
pre-paint hint still exists. `setAccent` still persists a user choice.

### Persisted write → runtime reader

Verified this round in source:

1. `initializeAccent` reads `VSCodeService.getState('ptah-accent')`
   (`vscode.service.ts:225-241`: Electron `pendingElectronState` for the
   current workspace root, otherwise `vscode.getState()[key]`), then
   `localStorage['ptah-accent']`.
2. Resolve order is unchanged: valid state, else valid hint, else `gold`
   (`theme.service.ts:294`). Stored `gold` therefore still beats a rose or
   moonstone mirror, because a valid state never falls through to the hint.
3. The repair `setState` is the only boot write. `VSCodeService.setState`
   (`vscode.service.ts:254-275`) copies the current snapshot, sets one key,
   calls `vscode.setState` with the whole object, and stores that object as
   `pendingElectronState`. A later renderer merge builds on that snapshot.
4. The first boot of a fresh profile still sets the signal to gold and writes
   the hint, and now does not call `setState`. The second boot sees an absent
   key and hint `gold` and also does not call `setState`.

IPC replace behaviour was not re-read this round. `ci-fixes.md` already traces
preload `set-state` → `IpcBridge` whole-record replace, and `get-state` →
`pendingWebviewStates` then the storage cache. That is the clobber the skipped
write avoids. The pre-paint reader (`index.html`, cited by the logic review:
state key, then hint, `data-accent` only for rose and moonstone) was not
re-read this round; the service no longer depends on a state key to mean gold.

### Spec

`does not write state on a second boot when the only hint is default gold`
constructs the service (fresh profile, hint becomes `gold`, `setState` not
called), calls `TestBed.resetTestingModule()`, clears the mock, constructs
again, and asserts accent `gold`, `getState('ptah-accent')` still
`undefined`, and `setState` still not called. Existing cases kept: stored
moonstone with no rewrite, fresh profile unwritten, rose mirror repaired,
invalid stored accent repaired (`violet` + rose hint).

## 2. Git tab at 1200px with the sidebar open

### Change

`.electron-git-dock` is `min-w-[300px]` with default `flex-shrink: 1` again
(`shrink-0` removed). `ptah-workspace-sidebar` is `shrink-0`. The glass chat
floor stays `min-width: 384px`. The bound `[style.width.px]` is still
`editorPanelWidth` (default 700). No assertion was relaxed.

### Why removing `shrink-0` does not bring back the 695px dock

The chat host is `flex-1` (`flex: 1 1 0%`). Its scaled shrink factor is
`flex-shrink × flex-base-size = 1 × 0 = 0`, so it never donates pixels below
its hypothetical main size. That hypothetical size is the min-width, because
the base is 0 and is clamped up to the min. The glass rule
(`:host-context([data-glass='on']) … [data-test='configuration-surface-host']`,
emulated encapsulation, no `encapsulation` override) beats the utility
`min-w-[400px]`, so the hypothetical chat size is 384, not 400. The dock's
base size is its definite `width` (flex-basis `auto`), so the dock is the item
that shrinks when the line is short.

Measured line width, from the CI failure (chat floor was still 400, dock
flex-shrink 1, used dock width 695):

| Piece | px |
| --- | --- |
| Left tab `w-8` | 32 |
| Glass margin-inline-end on that tab | 8 |
| Chat at the old floor | 400 |
| Handle (6px + glass margin-inline 1+1) | 8 |
| Dock used width | 695 |
| Dock glass margin-inline-end | 8 |
| Right Git tab, last child, no end margin | 32 |
| Sum = body inner width | 1183 |

Fixed chrome besides the chat and dock widths is 88px. A 1200px content box
with 8px root padding on each side would be a 1184px body; the measurement
is 1px tighter. Both figures are used below as 1183 (measured) and the
surplus only grows if the body is 1184.

Hidden sidebar, glass, dock requested 700, chat floor 384:

`88 + 384 + 700 = 1172`. Free space `1183 − 1172 = 11`. The line is not
short, so the dock does not shrink. Used dock width stays 700. The chat
grows by those 11px. `git-rail-collapse.spec.ts` hides the workspaces sidebar
before it reads `ptah-review-shell`'s box and expects 699–701. The dock's
`border-l` is inside the 700px border box, so the shell inside it can be 699
and still pass. The old 5px miss was `1188 − 1183` when the chat floor was
400 (`88 + 400 + 700 = 1188`).

Sidebar open, glass, default sidebar 220, dock requested 700:

The sidebar host's inner width is 220 (`workspace-sidebar.component.ts`
`[style.width.px]`). Glass sets `overflow: hidden` on that host, which makes
`min-width: auto` resolve to 0, so a default `flex-shrink: 1` would let the
sidebar share the deficit and clip its rows. `shrink-0` keeps it at 220.
Non-glass does not set that overflow, so the sidebar's min-content was
already about 220; `shrink-0` does not change the non-glass used width.

`228 (220+8 margin) + 88 + 384 + 700 = 1400`. Deficit `1400 − 1183 = 217`.
Only the dock has a non-zero shrink factor. Used dock width
`max(300, 700 − 217) = 483`. The Git tab's 32px stays inside the body.
`overflow-hidden` on the body no longer has to clip it.

Same row after `setEditorPanelWidth` clamps to `innerWidth * 0.5` (600 when
`innerWidth` is 1200): deficit `1300 − 1183 = 117`, used dock
`600 − 117 = 483`, still above 300.

Non-glass, sidebar open, content width 1200, no root padding and no 8px
gutters, chat floor 400, handle 6: sum
`220 + 32 + 400 + 6 + 700 + 32 = 1390`, deficit 190, used dock 510. Sidebar,
both tabs, and the chat floor stay. Hidden sidebar non-glass sums to 1170,
so the dock stays 700.

Max sidebar 400 at this same 1183px glass body: deficit 397, used dock 303,
still on the 300px floor. Below that (the 800px window minimum, both panes
open) the floors cannot all fit; that window was already short before this
patch and is outside the 1200px finding.

## Decisions

1. Skip `setState` when the key is absent and the hint is missing, invalid,
   or `gold`. Repair a present invalid value, and repair an absent key from
   a rose or moonstone hint.
   - Options: (a) this condition; (b) never write on boot; (c) keep writing
     for every valid hint, including gold.
   - Evidence: the first boot writes the gold hint itself
     (`theme.service.ts:311`); gold is `DEFAULT_ACCENT`; the logic review's
     failure mode A is exactly absent key + that hint. (b) would drop the
     rose/moonstone mirror repair the previous fix kept and the spec covers.
   - Reversible: the condition is one boolean.

2. Restore dock flex-shrink, and stop the sidebar from shrinking, instead of
   clamping `editorPanelWidth` or leaving `shrink-0` on the dock.
   - Options: (a) dock shrinks, sidebar `shrink-0`, chat floor stays 384;
     (b) keep dock `shrink-0` and clamp the 700 signal so the open-sidebar
     row fits; (c) dock `shrink-0` only, as in the previous patch.
   - Evidence: the hidden-sidebar sum is 11px under the measured body once
     the chat hypothetical size is 384, so flex-shrink does not move a 700px
     dock in the CI setup. Clamping the signal (b) would change the width the
     hidden-sidebar spec reads and would fail 699–701. (c) clips either the
     Git tab or, under glass `overflow: hidden`, the sidebar.
   - Reversible: put `shrink-0` back on the dock and remove it from the
     sidebar.

## Checks not run

No `nx test`, Jest, tsc, lint, build, serve, or Electron/webview e2e. The
second-boot spec and the flex arithmetic are source-level only. CI still has
to run unit `core` (the new theme spec) and Electron `git-rail-collapse`.

## Remaining uncertainties

- The 1183px body is inferred from the previous 695px dock measurement, not
  from a new paint. A 1px difference versus `1200 − 16` does not change the
  sign of the 11px surplus or the 217px deficit.
- `min-width: 384px` beating `min-w-[400px]` is specificity under default
  emulated encapsulation, as the previous review stated. It was not confirmed
  in a browser. If the utility won, the hidden-sidebar dock would shrink by
  about 5px again and `git-rail-collapse` would fail at 695.
- `ptah-review-shell` is assumed to fill the dock's content box, which is
  what made the earlier 695px measurement equal the dock's used width.
- No Electron paint of the open-sidebar row. The 483px used dock and the
  unclipped 32px tab follow from the flex factors above.
- `index.html` pre-paint and `IpcBridge` were not re-read this round.
- At the 800px minimum window with both panes open, the 300px dock floor
  still does not fit. Not part of this finding.
