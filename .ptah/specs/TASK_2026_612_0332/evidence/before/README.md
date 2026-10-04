# TASK_2026_612 BEFORE evidence

Source: base commit 77f99a687, built and run ONLY from the detached worktree
`D:/projects/ptah-extension/.claude-worktrees/task-612-before-base`
(the main checkout was not built, run or modified).

## Method
Real Electron app (dev build) driven by Playwright (`_electron.launch`) using the
existing apps/ptah-electron-e2e harness (`UiDriver.mockRpc`). Real renderer, real
Angular code; only backend RPC is mocked:
- `session:list` returns the child session 4bb0a19d-7f5b-43ca-b10e-12c147d3e4cb,
  name "TASK 531 canvas gating", `hasTranscript: false` (what the base backend returns
  when the transcript is not under the workspace's ~/.claude/projects dir), plus one
  normal session (`hasTranscript: true`) for contrast. messageCount 14 / "2m ago" are invented.
- `chat:agent-sessions` returns no sessions.
- After a parent tile exists on the Orchestra Canvas (canvas layout active), an
  `agentSession:opened` push is sent (parentTabId = the real tab id read from
  localStorage `ptah.tabs.*`, child tab id 9f0c1c3e-..., branch
  fix/task-2026-531-canvas-surface-active, label "TASK 531 canvas gating").
Themes: `data-theme` set to `anubis` (dark) / `anubis-light` (light) on `<html>`.
Window 1600x950.

## Files
- sidebar-child-dark.png / sidebar-child-light.png : session rail; child row greyed (opacity-50), "transcript expired".
- canvas-after-adopt-dark.png / canvas-after-adopt-light.png : full window after the child was adopted; still ONE tile.
- facts.json : measured facts. childTabAdoptedInTabManager=true (child tab id is in persisted tab state)
  but canvasTilesBefore=1 -> canvasTilesAfter=1 (gridstack-item count): no tile for the child.
  sidebarChildRow.nameOpacity="0.5", class includes `opacity-50`.
- harness/ : the spec + playwright config used (copy of what was added to the before-base worktree).

## Could not capture / caveats
- The `Agent` badge from the task description does not exist in the base sidebar template
  (app-shell.component.html renders only name, relative time, msgs, "transcript expired");
  none was rendered, so none is shown.
- Data is mocked, not a live ptah_session_start run. The adoption path (TabManager) was
  exercised for real; the canvas not creating a tile is observed, not simulated.
- Light screenshot: the app applies `anubis-light` via data-theme directly (not ThemeService),
  so a few surfaces may look slightly different from a user-selected light theme.

## Commands (before; repeat in a worktree for "after")
Prereq in a worktree without node_modules: junction to the main one
(PowerShell: `New-Item -ItemType Junction -Path <wt>\node_modules -Target D:\projects\ptah-extension\node_modules`).
```
cd <WORKTREE>
export NX_DAEMON=false
npx nx build-dev ptah-electron --skip-nx-cache
npx nx copy-renderer-dev ptah-electron --skip-nx-cache
mkdir -p apps/ptah-electron-e2e/src/evidence-612
cp <before>/harness/child-session-visibility.evidence.ts apps/ptah-electron-e2e/src/evidence-612/
cp <before>/harness/evidence-612.config.ts apps/ptah-electron-e2e/
cd apps/ptah-electron-e2e
EVIDENCE_OUT=<abs>/evidence/after EVIDENCE_COMMIT=<sha> npx playwright test -c evidence-612.config.ts
```
(~3 min build, ~35 s run.)
