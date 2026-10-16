# Visual "before" capture, items 11-17 - TASK_2026_681_738f

Base: `dist/apps/ptah-electron` in this worktree (built from 75ce4a6d1, not rebuilt). Screenshots: `.ptah/specs/TASK_2026_681_738f/screenshots/before-11-17/` (22 PNGs, dark = `anubis`, light = `anubis-light`).

## How captured

- Launched `D:\projects\ptah-extension\node_modules\electron\dist\electron.exe dist/apps/ptah-electron/main.mjs --remote-debugging-port=9333`, `NODE_ENV=development`, Ptah Dev profile (PID 29708). No build, test or e2e run; no source edited. Page confirmed as `file:///D:/projects/ptah-extension/.claude-worktrees/clean-session-followups/dist/apps/ptah-electron/renderer/index.html`.
- Playwright `connectOverCDP`, `page.setViewportSize` 1440 / 760 / 400 x 900. Themes via `document.documentElement.dataset.theme`. No prompt sent; only the existing session "S4" (workspace `ptah-final-run-ws`, two finished codex lanes) was opened. Workspace and Sessions sidebars closed (the canvas "Sessions" board column stays; it is part of the canvas).
- Scripts: `.ptah/tmp/b1117-lib.mjs`, `b1117-run.mjs` (focus-header, lane-view), `b1117-run2.mjs` (inspector, compact), log `run-b1117-2.log`.
- Lane selection: the codex lane tab (`ptah-canvas-lane-tabs [role=tab][aria-label*="codex"]`) at 1440 and 760; at 400 the lane tabs collapse into the "3 agents" overflow dropdown (`ptah-agent-dock-menu`), and the codex entry was picked there. The lane hover card (`role=tooltip`, id `rail-left-lane-panel-agent-card`) was dismissed (hover then move away) so no shot shows it. It covers the lane card at 760 and 400 if the pointer stays on the tab.
- The lane opened is the first codex lane (cli id `d40efc39...`, session `01a136d5...`, task "pong").
- Data drift: elapsed times tick (about 66h 27m to 66h 47m across the shots); Cost tile shows `$0.55` (it showed "cost unavailable" in an early probe before the data loaded).

## Shot list (all in `screenshots/before-11-17/`)

| Screen | 1440 | 760 | 400 |
| --- | --- | --- | --- |
| focus-header (items 11, 12) | `focus-header-1440-dark.png`, `-light.png` | `focus-header-760-dark.png`, `-light.png` | `focus-header-400-dark.png`, `-light.png` |
| lane-view (items 14, 17) | `lane-view-1440-dark.png`, `-light.png` | `lane-view-760-dark.png`, `-light.png` | `lane-view-400-dark.png`, `-light.png` |
| inspector-agents (items 13, 15) | `inspector-agents-1440-dark.png`, `-light.png` | not requested | sheet top `inspector-agents-400-dark.png`, `-light.png`; sheet scrolled to AGENTS `inspector-agents-400-scrolled-dark.png`, `-light.png` |
| compact (item 16) | `compact-1440-dark.png`, `-light.png` | not requested | `compact-400-dark.png`, `-light.png` |

## DOM facts

### Focus header (`ptah-canvas-focus-header`)
- 1440 text: `S4 claude-opus-5-5 done ▣ Compact ⋯ × Close`.
  - Model chip: `<span class="truncate rounded bg-base-200 px-1.5 text-xs">claude-opus-5-5</span>`, box x=754 y=93 109x16. It exists only at 1440; at 760 and 400 it is not rendered (header text `S4 done ▣ ⋯ ×`).
  - Buttons at 1440 (all text buttons, no icon components):

| Button | Text | title | aria-label | data attr | Box (x, y, w, h) |
| --- | --- | --- | --- | --- | --- |
| Compact | `▣ Compact` (glyph + word) | `Switch to compact view` | `Switch to compact view` | `data-compact` | 919, 89, 70x24 |
| More | `⋯` | `More session actions` | `More session actions` | `data-header-menu` | 998, 89, 20x24 |
| Close | `× Close` | `Close session` | `Close session` | none | 1026, 89, 50x24 |

  - The Compact button class is `btn btn-ghost btn-xs`.
- 760: the same three buttons are glyph-only (`▣`, `⋯`, `×`, 19/20/17 px wide), same titles and aria-labels.
- 400: glyph-only plus an extra details toggle (`ⓘ`, title `Session details`, aria-label `Open details`, attr `data-details`, sr text "Context unknown."). Buttons: `▣` 318,89 19x24; `ⓘ` 345 22x24; `⋯` 375 20x24; `×` 403 17x24.
- The glyph characters are Unicode text, not lucide SVGs.
- At 400 `document.documentElement.scrollWidth > innerWidth` is true (page-level horizontal overflow; the top nav tabs and "New Session" are clipped in every 400 shot). The 760 and 1440 layouts have no overflow. This pre-exists the change.

### Lane view (`ptah-canvas-lane-view`, codex lane selected)
- Text: `Back to conversation codex completed 66h 27m 01a136d5... ctx — — 66h 27m Task Parent: 18e50e43… ↑ 11.9k ↓ 56 pong`.
- Back button: `<button type="button" aria-label="Back to conversation" class="btn btn-ghost btn-xs m-2">Back to conversation</button>` (above the card).
- Structure: `div.rail-focus-fade` > `ptah-agent-card` (frame `border border-base-content/10 rounded-lg overflow-hidden bg-base-100 flex flex-col h-full`; computed border `1px solid oklch(.. / 0.1)`, radius 8px, bg `oklch(0.97788 0.004 56.375)` in light) > `ptah-agent-card-header` + `ptah-cli-lane-usage-summary` + `ptah-cli-agent-output`.
- Card header: collapse chevron button (`aria-label="Collapse codex"`, `aria-expanded="true"`), name badge `badge badge-sm badge-outline font-mono` "codex", status badge `badge-success` "completed", resume button (title `Resume session`), elapsed "66h 37m", CLI session id badge `01a136d5...` (title `CLI Session: 01a136d5-22fb-7f41-b6c8-a314083dc65e`).
- Stats bar in `ptah-cli-agent-output`: `div.flex ... bg-base-200/50 border-b` with `↑ 11.9k` (`text-info/70`) and `↓ 56` (`text-accent/70`), 9px mono. Below it the output: `p-2 space-y-1` > `ptah-execution-node` > prose "pong".
- Also in the card: "ctx — ... 66h 27m" usage row (`ptah-cli-lane-usage-summary`) and "Task / Parent: 18e50e43…" row.

### Inspector (`ptah-session-inspector`, 1440 aside and 400 sheet `[data-compact-sheet]`)
- Children: `ptah-inspector-orchestrator-card`, `ptah-inspector-session-stats`, `ptah-inspector-agents-section`, `ptah-inspector-limits-lanes`, `ptah-inspector-task-section`, `ptah-inspector-todos-section`, `ptah-inspector-git-section`.
- Stats text: `SESSION Context — Window unknown Tokens 467.0k of 50.0M budget Cost $0.55 Agents 1 ModelOpus 5.5`.
- Model row (item 13), exactly: `<div class="col-span-2 min-h-10 rounded-md border border-surface-border bg-surface-1 p-2.5 text-xs"><span class="text-base-content-muted">Model</span><span title="claude-opus-5-5">Opus 5.5</span></div>`. `textContent` = `ModelOpus 5.5` (no gap between label and value, both regular weight, no flex layout; in the shots "Model" and "Opus 5.5" touch).
- AGENTS section text: `AGENTS 0 active · 2 finished codex done · 66h 35m CLI lane Usage: 11869 input (7040 cached), 56 output tokens codex done · 66h 46m CLI lane`.
  - Row 1 (the lane that has usage): name `codex`, right `done · 66h 35m`, then a `CLI lane` chip (`rounded border bg-surface-3 text-[10px]`) and the activity line `<span class="min-w-0 truncate">Usage: 11869 input (7040 cached), 56 output tokens</span>`. It is truncated with an ellipsis ("Usage: 11869 input (7040 cac...") at 1440 and ("...56 outpu...") at 400.
  - Row button aria-label: `codex, CLI lane, done 66h 35m. Usage: 11869 input (7040 cached), 56 output tokens`.
  - Row 2: `codex done · 66h 46m`, `CLI lane` chip, no activity line.
  - No stat badges (tokens, cost, duration) exist in the rows.
- 400 sheet: same sections; `inspector-agents-400-*` shows the top (Orchestrator, SESSION tiles), `-scrolled-*` shows Model row, AGENTS, PLAN LIMITS, LANES, TODOS, GIT.

### Compact (item 16)
- Click `ptah-canvas-focus-header [data-compact]`: the header changes from `▣ Compact` (title `Switch to compact view`) to `▣ Full` (title/aria-label `Switch to full view`). At 400 the glyph-only button keeps `▣` and only its title changes.
- Nothing else renders: the body stays the orchestrator chat. The visible element set after clicking is the same as before (`ptah-canvas-lane-tabs`, `ptah-canvas-lane-view` > `ptah-canvas-detail-transcript` > `ptah-session-embed` > `ptah-chat-view` > `ptah-chat-transcript`, `ptah-chat-input`). No compact card (`ptah-compact-session-card` content visible in the focus pane) appears; the only `ptah-compact-session-card` in the DOM is the S2 rail card. `compact-1440-*` and `focus-header-1440-*` differ only in the header label and a slightly shifted transcript scroll.
- Switching back: clicking the `Switch to full view` button restores `▣ Compact` / `Switch to compact view`. Restored at both widths.

## Not captured, and why
- 760 for inspector-agents and compact: not requested.
- The 1440 inspector AGENTS section sits in the 320 px aside next to SESSION (visible in the same shot); no separate scrolled shot was needed at 1440.
- No pixel diff base: this set is the "before"; the after set must account for time-ticking elapsed values and the profile data (cost known `$0.55`).
- A truncated long model name for the chip was not exercised (only `claude-opus-5-5`).
- Another Electron-type process set (6 processes, none with the Ptah Dev profile or this worktree in its command line) is running on the machine and was left alone; port 9333 is free and my PID 29708 tree is stopped.
