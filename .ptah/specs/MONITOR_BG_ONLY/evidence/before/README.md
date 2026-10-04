# MONITOR_BG_ONLY BEFORE evidence

Source: origin/main at c179f3eb5, built and run ONLY from the detached worktree
`D:/projects/ptah-extension/.claude-worktrees/task-612-before-base` (main checkout untouched).

## Method
Real Electron dev build driven by Playwright (`_electron.launch`, apps/ptah-electron-e2e harness,
`UiDriver.mockRpc`). Real renderer and stores; only backend RPC is mocked (`session:list` empty,
`chat:agent-sessions` empty). Window 1600x950, Orchestra Canvas (1 gridstack tile), AGENTS rail open
(it auto-opened). Subagents were injected through the REAL push path, not by poking stores:
- `session:id-resolved` {tabId, realSessionId} binds the tab to session 7d2c1f0e-5b3a-4c8d-9e1f-2a3b4c5d6e7f.
- `chat:chunk` {tabId, sessionId, event} -> ChatMessageHandler -> StreamRouter -> AccumulatorCore:
  `message_start`, `text_delta`, then per subagent `tool_start` (Task, isTaskTool) + `agent_start`.
  - FOREGROUND: toolu_fg_0001, name fg-reviewer. No background event.
  - BACKGROUND: toolu_bg_0002, name bg-watcher, plus `background_agent_started` (BackgroundAgentStore.onStarted).
- CLI lane: `agent-monitor:spawned` (AgentProcessInfo, cli codex, parentSessionId = the session).
Themes: `data-theme` = `anubis` (dark) / `anubis-light` (light) set on `<html>`.

## Result (base behaviour)
Panel header badge shows total **3**; chips listed: `Codex` (CLI lane), `fg-reviewer`, `bg-watcher`.
The foreground subagent is listed in the panel AND renders inline in the chat tile
("fg-reviewer ... Streaming" card; bg-watcher also inline with a "Background" badge).
So the foreground agent is duplicated. After the change expect total 2: Codex + bg-watcher
(fg-reviewer gone from the panel, still inline).

## Files
- monitor-panel-window-dark.png / -light.png: full window (chat tile with inline cards + AGENTS panel).
- monitor-panel-dark.png / -light.png: the `ptah-agent-monitor-panel` element only.
- facts.json: per theme `observed.{dark,light}`: `totalCountBadge`, `listedChips`, `badges`, `panelText`,
  `canvasTiles`, `chatTextHasFgDesc/BgDesc` (inline rendering present), plus what was injected and how.
- harness/: monitor-panel.evidence.ts + evidence-monitor-bg.config.ts (copies).

## Caveats / not captured
- At base, the store never sets `status: 'background'` (type only; agent_status cannot carry it).
  "Background" is identified by `background_agent_started` in BackgroundAgentStore, so the
  bg subagent record's status is `running`. If the change keys off a different signal
  (e.g. a new status), the AFTER harness may need that event added.
- The Codex chip is selected by default and its detail pane is shown; fg/bg detail panes
  were not opened (not requested).
- Mocked data; CLI lane task text and timing are invented. Light theme via data-theme attribute,
  not ThemeService.

## Re-run for AFTER (against .claude-worktrees/monitor-panel-background-only)
Prereq: node_modules junction exists in that worktree (PowerShell:
`New-Item -ItemType Junction -Path <wt>\node_modules -Target D:\projects\ptah-extension\node_modules`).
```
cd D:/projects/ptah-extension/.claude-worktrees/monitor-panel-background-only
export NX_DAEMON=false
npx nx build-dev ptah-electron --skip-nx-cache
npx nx copy-renderer-dev ptah-electron --skip-nx-cache
mkdir -p apps/ptah-electron-e2e/src/evidence-monitor-bg
E=.ptah/specs/MONITOR_BG_ONLY/evidence
cp $E/before/harness/monitor-panel.evidence.ts apps/ptah-electron-e2e/src/evidence-monitor-bg/
cp $E/before/harness/evidence-monitor-bg.config.ts apps/ptah-electron-e2e/
cd apps/ptah-electron-e2e
EVIDENCE_OUT=D:/projects/ptah-extension/.claude-worktrees/monitor-panel-background-only/$E/after EVIDENCE_COMMIT=<sha> npx playwright test -c evidence-monitor-bg.config.ts
```
(~3 min build, ~20 s run.) Remove the two copied harness files before committing.
