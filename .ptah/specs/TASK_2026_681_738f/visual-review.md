# Visual Review - TASK_2026_681_738f

Verdict: PASS (score 9/10, no visual-breaking, serious or moderate findings)

## Summary

| Metric            | Value                                                                     |
| ----------------- | ------------------------------------------------------------------------- |
| Overall score     | 9/10                                                                      |
| Assessment        | APPROVED                                                                  |
| Visual breaking   | 0                                                                         |
| Serious           | 0                                                                         |
| Moderate          | 0                                                                         |
| Viewports tested  | 3 (1440, 760, 400 wide, 900 high) in dark (`anubis`) and light (`anubis-light`) |
| Screenshots taken | 14 (12 matching the "before" set, plus 2 for the deferred activity panel)  |
| Components tested | 6 (rail chat view, dock hover card, compact inspector sheet, git row, details toggle description, turn activity panel) |

Score: 9 rather than 10 because the item 6 non-zero needs-you count and the item 10 dot in a live state could not be reached with existing data (see "Not captured").

## Environment

- Build verified: from `D:\projects\ptah-extension\.claude-worktrees\clean-session-followups` (branch `fix/clean-session-followups`), `npx nx run ptah-electron:build-dev --parallel=1 --skip-nx-cache` exit 0 (35.7 s), then `npx nx run ptah-electron:copy-renderer-dev --parallel=1 --skip-nx-cache` exit 0 (1m 25s). No other build, test or e2e was run.
- Launched `D:\projects\ptah-extension\node_modules\electron\dist\electron.exe dist/apps/ptah-electron/main.mjs --remote-debugging-port=9333`, `NODE_ENV=development`, Ptah Dev profile, PID 8860. Before launch another worktree's (`command-center`) Electron was holding port 9333 and the profile; it exited on its own before I launched, and I did not stop it.
- Confirmed the loaded page is this worktree's renderer: `file:///D:/projects/ptah-extension/.claude-worktrees/clean-session-followups/dist/apps/ptah-electron/renderer/index.html`.
- Playwright `connectOverCDP`, viewport via `page.setViewportSize` at 1440, 760 and 400 by 900. Existing sessions only; no prompt sent. Themes switched with `document.documentElement.dataset.theme` (`anubis`, `anubis-light`), exactly as the "before" capture did.
- Stopped with `Stop-Process` on PID 8860 and checked: no `electron.exe` process and no listener on 9333 remain.
- Scripts (copied from the clean-session-view worktree, read-only there, adapted here): `.ptah/tmp/after-fix4.mjs`, `after-lib.mjs`, `check-run.mjs`; run logs `.ptah/tmp/run2.log` (final run), `run1.log`; comparison helpers `cmp.py`, `stitch.py`.
- Prototype: not applicable. This is a before/after regression pass on an existing surface, using the FIX-4 captures as "before".
- Accessibility standard: none declared in the task; no new contrast or target-size claims are made. The pass is a regression comparison.

## How captured

Same script flow as FIX-4 (`visual-recheck-FIX-4.md`, "How captured"): 1440 with the `ptah-final-run-ws` workspace and the "can you generate html st" session, sidebars closed; 760 with the S4 session and a hover on the second lane tab; 400 with the details opener, compact sheet, Tab, Escape, then the overflow menu. File names are identical to the before set. Extra steps added for the item checks and the activity panel (DOM probes, one extra click on `[data-testid="turn-show-activity"]`).

## Before/after shots

Before directory: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\.ptah\specs\TASK_2026_677_efcd\screenshots\after-fix4\`
After directory: `D:\projects\ptah-extension\.claude-worktrees\clean-session-followups\.ptah\specs\TASK_2026_681_738f\screenshots\after\`

Every pair has the same pixel size. A pixel diff flagged all pairs, so each was inspected visually side by side (dark of all six scenes; light of the escape shot; the others from the same layout). Every difference traced to data that changed in the Ptah Dev profile between the two captures, none to layout, spacing, colour or component choice.

Data drift between captures (applies to the rows below):

- The sessions list now holds more sessions (extra "Command Center" cards; the header counter is "5 1" instead of "3"), and S2/S4 cards now list their lanes ("Lanes 1 done / codex done").
- Elapsed times moved on (48h 13m is now 66h 20m).
- S4 cost is now known: the card and the inspector Cost tile show `$0.55` (the existing `ptah-cost-badge`) instead of "cost unavailable". The session list card, a component this change does not touch, shows the same `$0.55`. The diff to the inspector stats components only changes the expansion key (`expansion.sessionKey(...)`), not cost rendering.

| Shot | Before | After | Difference |
| --- | --- | --- | --- |
| chat-turn-top-panelsclosed-1440-dark | `.../after-fix4/chat-turn-top-panelsclosed-1440-dark.png` | `.../after/chat-turn-top-panelsclosed-1440-dark.png` | Header, transcript, Turn summary, composer and the 320 px aside (SESSION, PLAN LIMITS, TODOS) identical. Only the sessions list data drifted. |
| chat-turn-top-panelsclosed-1440-light | `.../after-fix4/chat-turn-top-panelsclosed-1440-light.png` | `.../after/chat-turn-top-panelsclosed-1440-light.png` | Same as dark; only data drift. |
| dock-focus-760-dark | `.../after-fix4/dock-focus-760-dark.png` | `.../after/dock-focus-760-dark.png` | Hover card still x=344-600 inside the focus pane x=336-684, clear of Sessions; same content. Sessions list data drift only. |
| dock-focus-760-light | `.../after-fix4/dock-focus-760-light.png` | `.../after/dock-focus-760-light.png` | Same as dark. |
| dock-overflow-400-dark | `.../after-fix4/dock-overflow-400-dark.png` | `.../after/dock-overflow-400-dark.png` | Overflow popover (ORCHESTRATOR, CLI LANES 2) identical in layout; the left rail shows more numbered sessions (4, 5, 6 instead of 1-3 and blank). Data drift. |
| dock-overflow-400-light | `.../after-fix4/dock-overflow-400-light.png` | `.../after/dock-overflow-400-light.png` | Same as dark. |
| inspector-sheet-escape-400-dark | `.../after-fix4/inspector-sheet-escape-400-dark.png` | `.../after/inspector-sheet-escape-400-dark.png` | Sheet closed, focus on the Open details opener; elapsed time and left-rail count drift only. |
| inspector-sheet-escape-400-light | `.../after-fix4/inspector-sheet-escape-400-light.png` | `.../after/inspector-sheet-escape-400-light.png` | Same as dark (viewed side by side). |
| inspector-sheet-tab-400-dark | `.../after-fix4/inspector-sheet-tab-400-dark.png` | `.../after/inspector-sheet-tab-400-dark.png` | Sheet bounds x=0-400, close x=364-392 unchanged; Cost tile now `$0.55`, elapsed times moved. |
| inspector-sheet-tab-400-light | `.../after-fix4/inspector-sheet-tab-400-light.png` | `.../after/inspector-sheet-tab-400-light.png` | Same as dark. |
| inspector-toggle-400-dark | `.../after-fix4/inspector-toggle-400-dark.png` | `.../after/inspector-toggle-400-dark.png` | Same as the Tab shot (the diff region is the same Cost tile and elapsed times). |
| inspector-toggle-400-light | `.../after-fix4/inspector-toggle-400-light.png` | `.../after/inspector-toggle-400-light.png` | Same as dark. |
| activity-panel-1440-dark (new) | none | `.../after/activity-panel-1440-dark.png` | New shot, no before. See the activity panel check. |
| activity-panel-1440-light (new) | none | `.../after/activity-panel-1440-light.png` | New shot, no before. Viewed: renders correctly. |

Behavioural checks from the same run (`run2.log`): `TAB_TRAP dark PASSED`, `TAB_TRAP light PASSED` (30 further Tabs stay inside the sheet, which matters because `onSheetKeydown` was changed in this diff), `CLOSE_BUTTON dark PASSED`, `CLOSE_BUTTON light PASSED`, Escape closes the sheet and returns focus to the outside opener.

## Item checks (DOM evidence)

### Item 5: git branch title in the 400 px compact sheet

Probe `sheet-open-400-*` (400 px, sheet open, dark and light):

```
git: [{"text":"main","title":"main","clientW":29,"scrollW":29}, {"text":"main","title":"main","clientW":0,"scrollW":0}]
```

The visible `ptah-session-inspector span.font-mono.truncate` has `title="main"`, equal to the branch name text. The second entry is the hidden inspector copy (width 0). Source: `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-git-section.component.ts:59` binds `[attr.title]="branch()"`. Visual: unchanged (see inspector-toggle-400 pair). PASS. Limit: the only branch available is `main` (29 px, not truncated), so the full-name-on-truncation case was verified by the binding and the title equality, not by an actually truncated long name.

### Item 6: closed-details toggle description includes the needs-you count

The toggle with the description exists in the canvas focus header (`[data-details]`, `aria-describedby` to the sr-only span `rail-details-description-N`) only while details are closed, and it is rendered only in the compact layout (400 px), not at 1440 or 760. Probe `details-closed-400-*` on the opened session ("can you generate html st"):

```
details: [{"exp":"false","dot":null,"describedby":"rail-details-description-1","descText":"Context unknown."}]
```

I also read that toggle at 400 px for the six distinct sessions of the profile: S2 "Context unknown.", S4 "Context unknown.", "can you generate html st" "Context unknown.", Command Center (idle) no description, Command Center "Context 5%.", Command Center "Context unknown.". None has a pending request, so every needs-you count is 0 and `inspectorToggleDescription` (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/session-limit-summary.ts:52`) correctly omits the "N need you." sentence; the text equals what the old hard-coded `0` produced. The code path now reads `this.inspectorStore.modelFor(id)().needsYouCount` (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:335-341`). Accepted per the brief (count 0 case). A non-zero count was not exercised live (see "Not captured"). PASS for the count-0 case.

### Item 10: selected-indicator dot ink equals `--ptah-gold`

The `ptah-session-header` is in the DOM but hidden in this build (it sits in a `display:none` chat view; the canvas focus header replaces it), so no live `[data-dot='sel'] > .session-header-dot` exists. I exercised the real compiled rule on the app's own session-header toggle: set `data-dot="sel"`, appended a `.session-header-dot` span carrying the component's `_ngcontent` attribute, read the computed colour, then removed both. Probe `DOTPROBE` (with `data-theme-mode` set to match each theme, since the app derives light gold from `[data-theme-mode='light']`, not from `data-theme`):

| Theme | Shipped rule | Dot computed background-color | Computed `var(--ptah-gold)` | Equal |
| --- | --- | --- | --- | --- |
| dark (`anubis`, mode dark) | `[data-dot="sel"] > .session-header-dot { background-color: var(--ptah-gold, oklch(var(--s))); }` | `rgb(212, 175, 55)` | `rgb(212, 175, 55)` (`#d4af37`) | yes |
| light (`anubis-light`, mode light) | same rule | `oklch(0.58 0.132 75)` | `oklch(0.58 0.132 75)` | yes |

The old rule was `var(--sel, var(--ptah-gold, ...))`; `--sel` is not defined anywhere in `libs` or `apps/ptah-extension-webview/src` (grep), so the old rule already resolved to `--ptah-gold`, which is why the rendered colour matches the before behaviour. No before screenshot shows this dot (it is not visible in any captured state), so "matches the before shot" is established by that equivalence and not by a pixel comparison. PASS.

### Turn activity panel (@defer)

At 1440 in the "can you generate html st" session, clicking `[data-testid="turn-show-activity"]` produced:

```
ACTIVITY {"present":true,"text":"Tokens 56 in · 29.6k out Cost $1.56 Tool calls 14 Files changed 4","box":{"x":376,"y":566.5,"w":670,"h":54},"panelIds":["turn-activity-afdc7a2d-...:DL"]}
```

`ptah-turn-activity-panel` rendered with its stats (the panel id element is the `dl`, so the `aria-controls` target exists after the defer resolves). Screenshots `activity-panel-1440-dark.png` and `activity-panel-1440-light.png` show a clean, correctly styled stats strip above the Turn summary, no empty gap or layout shift. The panel was toggled closed again afterwards. PASS. The placeholder/loading frame (`<div [id]="panelId()">`) was not observed separately because the block resolved before the first screenshot.

## New issues

None. No horizontal scroll, overlap, clipped element, focus trap break or colour change was observed at 1440, 760 or 400 in either theme.

## Findings by severity

Visual breaking: none. Serious: none. Moderate and minor: none.

## Prototype fidelity

- Approved prototype: not applicable (no new surface); `prototype/` was not part of this pass.
- Fidelity assessment: NOT APPLICABLE
- Before/after comparison: dark and light pairs listed in "Before/after shots" above; every pair compared, no regression.

## Not captured, and why

- A non-zero needs-you count in the closed-details description: needs a pending permission or question request, which requires sending a prompt; the brief forbids it. Covered by the added unit specs only, not by this run.
- A live `session-header` selected dot: the header is not displayed in this build and no state produced a `sel` dot; evidence is the injected real rule (above).
- A truncated long branch name: only `main` is available.
- 760 px light/dark shots for sheet states, other browsers and widths: outside the requested set.
- A pixel-identical before/after: impossible because the profile data moved on (sessions, elapsed times, S4 cost); differences were attributed by inspection, not by a clean pixel diff.

## Decisions

- Attributed every pixel difference to profile data drift rather than failing the pass: evidence is the untouched session-list card showing the same `$0.55` and moved elapsed times, with identical geometry in all pairs. Reversible by re-capturing "before" from the base commit.
- Set `data-theme-mode` together with `data-theme` for the item 10 probe only (the app's gold depends on it); screenshots keep the FIX-4 method (`data-theme` only) so they stay comparable.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for items 5, 10 and the activity panel and layout regressions; MEDIUM for item 6 (count-0 only)
- Key concern: none; the only gap is a non-zero needs-you count, not exercisable without sending a prompt.
