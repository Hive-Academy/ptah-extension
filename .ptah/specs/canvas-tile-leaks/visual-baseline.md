# Visual baseline ("before") - canvas-tile-leaks

Base: `D:\projects\ptah-extension\.claude-worktrees\canvas-base` (detached at origin/main 518caa996).
Screenshots: `.ptah/specs/canvas-tile-leaks/visual/before/` (112 PNGs + 4 `_skipped-*.txt`, all empty = nothing skipped).

## Harness used
The repo's Playwright-Electron e2e harness (`apps/ptah-electron-e2e`): real Electron main + built Angular renderer, with
the `ui` fixture (`UiDriver`) intercepting the renderer's RPC channel so state is fully mocked (models, session list,
`chat:resume` transcripts incl. `cliSessions` for agent cards). The VS Code webview is not served standalone; Electron
is the only reachable host, and it forces grid layout.

## Throwaway script (outside source dirs)
- `D:\projects\ptah-extension\tmp\visual-capture\capture.spec.ts` + `playwright.config.ts`
- It `require()`s the fixtures from `$PTAH_BASE/apps/ptah-electron-e2e/src/support/fixtures`, so the Electron entry
  (`$PTAH_BASE/dist/apps/ptah-electron/main.mjs`) and renderer come from that worktree.

## Build (base worktree)
Pre-existing problem: origin/main 518caa996 fails to compile the renderer:
`chat-view.component.ts:1162  requestCanvasTab(tabId)` is missing the required `workspacePath` argument (TS2554).
To get a build I applied a ONE-LINE transient patch `requestCanvasTab(tabId, null)`, ran the build, then
`git checkout`-reverted it (canvas-base working tree is clean again). The dist therefore contains that fix (it only
affects the "hand off" flow, not any captured surface). **The "after" build will hit the same TS error unless the
fix branch already resolves it; if it does not, apply the same patch for parity.**
```
cd D:\projects\ptah-extension\.claude-worktrees\canvas-base
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true npx nx build-dev ptah-electron
NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true npx nx copy-renderer-dev ptah-electron   # ~3.5 min
```
(`NX_ISOLATE_PLUGINS=false` was needed: the default plugin workers crash with the junctioned node_modules.)

## Capture command
```
cd D:\projects\ptah-extension\tmp\visual-capture
PTAH_BASE='D:\projects\ptah-extension\.claude-worktrees\canvas-base' \
PTAH_OUT='D:\projects\ptah-extension\.claude-worktrees\canvas-tile-leaks\.ptah\specs\canvas-tile-leaks\visual\before' \
npx playwright test --config=playwright.config.ts
# optional: PTAH_ONLY=dark-1440x900,light-900x800   (subset)
```
**For the "after" run:** build the tile-leaks worktree the same way (it needs `dist/apps/ptah-electron`), then run with
`PTAH_BASE=D:\projects\ptah-extension\.claude-worktrees\canvas-tile-leaks` and `PTAH_OUT=...\visual\after`.
Filenames are identical, so diff before/after pairwise. Run only one Electron instance at a time.

Determinism: themes `anubis` (dark) / `anubis-light` via `localStorage ptah-theme`; windows set with
`BrowserWindow.setContentSize` to 1440x900 and 900x800 (verified via `innerWidth`); CSS injected to kill animations,
transitions and caret blink; fixed transcripts (timestamps fixed). `retries: 1` because the first Electron launch
occasionally fails to load the renderer (`ERR_FAILED`), unrelated to the app under test.

## Known non-deterministic regions (mask when diffing)
- Agent card elapsed time ("25316h 45m"): running agent, wall-clock derived from a 2023 `startedAt`.
- Sidebar/tile header relative times if any; the OS scrollbar is fine.

## Screenshots (each as `<name>-<dark|light>-<1440x900|900x800>.png`)
- `00-canvas-empty` - canvas, no tiles, sessions sidebar
- `06-single-tile-bottom|top` - ONE tile (session B) filling the grid (stand-in for single layout)
- `01-grid-2tiles-bottom|top` - two tiles (A with agents, B), markdown transcript
- `01-code-block-wide`, `01-code-block-scrolled-x` - wide code block (scrollWidth 1351 vs clientWidth ~295/241, scrolled 150px)
- `01-wide-table`, `01-wide-table-scrolled-x` - 8-column table (renders wrapped; no horizontal scroll container found)
- `02-message-hover`, `02-message-nohover` - hover toolbar (`group-hover`) on tile B message
- `03-input-empty|1line|5lines`, `03-input-18lines-capped|scrolled` - composer growth; 18 lines capped at 160px (scrollHeight 426)
- `04-model-selector[-tile]`, `04-effort-selector[-tile]` (bar indicator), `04-slash-picker[-tile]` ("No matches found" - command list not mocked), `04-at-picker[-tile]`
- `05-agent-monitor-tile|window`, `05-agent-card-expanded` - tile A: Agents panel with a running gemini and a completed codex card, agent output segments
- `99-final-window`

Markdown/input/overlay shots use tile B (at 900px tile A's Agents panel overlays its chat); the agent monitor uses tile A.

## Skipped / caveats
- **True single (non-grid) chat layout**: not reachable. Electron's shell calls `setLayoutMode('grid')` unconditionally
  (see canvas.spec.ts note); the VS Code single-chat host is not runnable here. Substituted by `06-single-tile-*`.
- Tooltips (native `title`) cannot be screenshotted; not captured.
- Slash picker shows empty-state because `command:*` RPC is unmocked (default `{}`); @ picker likewise has no file results.
- Table does not scroll horizontally in the base (cells wrap); recorded as-is.
