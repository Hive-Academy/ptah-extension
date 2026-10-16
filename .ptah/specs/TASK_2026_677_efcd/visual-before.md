# Visual BEFORE capture - TASK_2026_677

Baseline screenshots of the session view at base `c57a9a1e7` (worktree product code unchanged), for a later after-review. This is a capture log, not a review. Observations are factual notes only.

## How it was captured

- Build: `node .ptah/tmp/check-run.mjs before-electron -- npx nx run ptah-electron:build-dev --parallel=1 --skip-nx-cache` (passed), then `before-copy` for `copy-renderer-dev` (first two attempts failed, see "Environment notes"; `before-copy3` passed). Output was `dist/apps/ptah-electron` inside the worktree, so the renderer is built from this worktree.
- Launch: `electron.exe dist/apps/ptah-electron/main.mjs --remote-debugging-port=9333` with `NODE_ENV=development` (profile `%APPDATA%\Ptah Dev`, separate from the installed Ptah.exe). PID 22724, stopped by that PID with `taskkill /PID 22724 /T`.
- Drive: Playwright `connectOverCDP` on port 9333 (scripts `.ptah/tmp/before-*.mjs`). Width set with `page.setViewportSize` (the window itself stayed 892x735). Height 900 in every shot.
- Theme: `document.documentElement.dataset.theme` set to `anubis` (dark) or `anubis-light` (light) (the two ThemeService names, `libs/frontend/core/src/lib/services/theme.service.ts`). Not set through the theme picker UI.
- Data: existing sessions of the Ptah Dev profile only. No prompt was sent, nothing cost money.
  - "rich" session: workspace `ptah-final-run-ws`, session "can you generate html stats and some infor cards about this repo" (one finished turn, 14 tool calls, 4 files, long markdown final answer, token and cost badges, Turn summary chip).
  - "short" session: workspace `task623-pop`, "You are working in the current..." (2 tools, `ptah-ui` Recap card, Turn summary).
  - "lanes" session: `ptah-final-run-ws` / `S4` (Orchestrator tab plus two codex CLI lane tabs, AGENTS 1).
- Layout modes. Shell panels are collapsible (Workspaces and Sessions side tabs). Two modes were captured:
  - default (`<surface>-<w>-<theme>`): Workspaces sidebar and the Sessions list pane both open, as the app starts.
  - `panelsclosed`: both collapsed, so the focus area gets the width. At 1440 this mode also shows the "Session details" inspector column.
- Panel state was restored to open/open after the run.

## Files

All in `.ptah/specs/TASK_2026_677_efcd/screenshots/before/`. Every item exists as `-dark.png` and `-light.png` unless stated. 60 PNGs.

| Surface | File stem | Widths | What it shows |
|---|---|---|---|
| 1. Finished turn, rich | `chat-turn-top-<w>-<theme>` | 1440, 760, 400 | Default shell. Transcript scrolled to top: user bubble, assistant card with collapsed header ("14 tools", "4 files"), first tool rows interleaved with prose. |
| 1. | `chat-turn-end-<w>-<theme>` | 1440, 760, 400 | Default shell. Transcript scrolled to bottom: long final answer, copy action, `29.7k tokens` and `$1.56` badges, Turn summary chip, composer. |
| 1. | `chat-turn-top-panelsclosed-<w>-<theme>`, `chat-turn-end-panelsclosed-<w>-<theme>` | 1440, 760, 400 | Same two scroll positions with Workspaces and Sessions panes collapsed (the fair comparison of the chat panel itself). |
| 1. | `chat-turn-toolexpanded-panelsclosed-1440-<theme>` | 1440 | One Bash tool row expanded (Command + Result blocks, "Show full output"). |
| 1. Finished turn, short | `chat-turn-short-<w>-<theme>` | 1440, 760, 400 | Default shell, `task623-pop`: 2-tool card (Edit, Bash), `Recap two` ptah-ui card, token and cost badges, Turn summary chip. |
| 3. Session header | `session-header-<w>-<theme>` | 1440, 400 | Crop of focus-area top 175 px (panelsclosed): title, model chip, done pill, Compact / Close, lane tabs, MODEL / CONTEXT / TOKENS / COST stats strip. |
| 3. | `stats-strip-expanded-panelsclosed-1440-<theme>` | 1440 | Stats strip expanded (SESSION line, PLAN LIMITS "unknown account", Usage "Unavailable"). Tool row from the previous capture is still expanded in this frame. |
| 3. Composer | `composer-<w>-<theme>` | 1440, 400 | Crop of the composer and its footer row: placeholder, `+`, model selector (Opus 5.5), effort (High / Medium), mic, send, Full Auto (YOLO), Peer, "Claude CLI". |
| 3. | `composer-typed-1440-<theme>` | 1440 | Composer with text typed (not sent): focus ring, enabled send button. |
| 4. Canvas focus / lane tabs | `canvas-focus-orchestrator-1440-<theme>` | 1440 | Default shell, `S4`, Orchestrator tab: session rail board, focus header, tabs (Orchestrator, CLI LANES, codex, codex), stats strip with LANES 2 and AGENTS 1, transcript, composer. |
| 4. | `canvas-focus-lane-1440-<theme>` | 1440 | Same, codex lane tab selected: "Back to conversation", lane card (`completed`, ctx, Task, tokens, "pong"). |
| 4. | `canvas-focus-orchestrator-panelsclosed-<w>-<theme>`, `canvas-focus-lane-panelsclosed-<w>-<theme>` | 1440, 760, 400 | Same two states with panels collapsed. At 1440 the Session details inspector (Context, Tokens, Cost, Turns, Todos, Git, Changes) is visible. |

Widths: 1440 (wide), 760 (intermediate) and 400 (narrow) are an audit selection matching the task request, not a support contract. 760 and 400 only for surfaces 1 and 4 (and header/composer at 1440 and 400).

## Not captured, and why

- Streaming turn (surface 2): not reachable without sending a prompt to a provider. The board shows `0 / 9 running`, so no live session existed. Skipped by instruction; no fake was built.
- Composer chips (attachments, pasted-file chips, suggestion chips): none present in the existing data and creating them needs a send or file attach. Only the footer controls (model, effort, mode, Peer, provider label) are captured.
- Hover and keyboard-focus states of message actions: not captured (the copy action is visible only in the `end` shots).
- Non-Electron chat (VS Code webview): out of scope, not run.
- Window resize through the browser window was not possible: CDP `Browser.getWindowForTarget` is not available from Playwright on this Electron, so widths are viewport emulation, not a resized window.

## Baseline observations (facts, no judgement)

- The chat panel is not alone in the shell. Default shell at 1440: Workspaces (220 px), Sessions list pane, session rail board (272 px) and then the focus area, which gets about 552 px of text column. At 760 the Sessions pane shrinks to chips and the focus column is about 330 px, at 400 about 270 px (`composer-400-*`: 244 px wide composer).
- In the default shell at 400 and 760 the top nav items are clipped (labels cut at the nav bar, "Setup hub" shown as "Setup"), and the Sessions list pane stays open and squeezes the chat to a few characters per line in the older short-session shots (`chat-turn-short-400-*`, `chat-turn-short-760-*`). Those were taken before the panel-mode detection was fixed, so their panel state is "Sessions pane open"; the `chat-turn-top/end-*` default shots show the rail collapsed to chips.
- Work log: assistant turn is a single bordered card. Header line shows the first sentence of the turn plus "N tools" and "N files" chips; tool rows (green left bar, tool name, description, chevron) are listed inside the card with prose between them. No separate "Worked for" summary. Final answer text sits inside the same card.
- Message actions: copy icon plus token and cost badges below the card (`29.7k tokens`, `$1.56`); a separate "Turn summary" chip row sits below.
- Session header in the focus area at 1440 panelsclosed: title, model name chip, `done` pill, Compact, `...`, Close; at 1440 default shell the same header shows only `done`, icon buttons.
- Light theme uses `anubis-light`; the active Chat tab and rail borders render turquoise there.

## Environment notes

- The worktree has no `node_modules`; the first renderer build failed on unresolved CSS imports (`prismjs/themes/prism-tomorrow.css`, `daisyui/dist/themes.css`). The fix was a directory junction `node_modules` to the main checkout's `node_modules` (git-ignored, created with `mklink /J`). It was removed after the run (`rmdir`, which removes only the link). Build outputs `dist/` (git-ignored) remain in the worktree.
- `git status` shows modified and untracked task-spec docs that this run did not touch (decisions, parity-inventory, plan-part-a2, task-description, implementation-plan*). Only `screenshots/before/*.png`, `visual-before.md` and `.ptah/tmp/before-*.mjs` are from this run. Nothing was committed.
- Scripts used (kept in `.ptah/tmp/`): `before-lib.mjs`, `before-s1.mjs` (chat turn), `before-s2.mjs` (header, composer), `before-s3.mjs` (canvas focus), `before-s4.mjs` and `before-s5.mjs` (tool row, stats strip). They connect to CDP port 9333 and need the app launched as above.
