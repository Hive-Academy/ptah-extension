# Batch B7a report

## Files changed

Modified:

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\session-inspector\inspector-agent-actions-menu.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\session-inspector\inspector-agents-section.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\services\session-agents\session-agent-tray.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\services\session-agents\session-agent-tray.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\templates\app-shell.previous-sessions.spec.ts`

Deleted:

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\subagent-transcript-overlay.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\subagent-transcript-overlay.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\services\subagent-transcript-viewer.service.ts`

Created:

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B7a.md`

## Evidence

### B7a.1

Removed the `View transcript` menu item, `Eye` import, and `transcript` action type. Removed the corresponding inspector action branch. The existing steer, background, and stop cases remain. The inspector row's lane activation (`activate`) remains. No dedicated action-menu spec exists; the existing inspector section spec contains only CLI usage-badge cases and required no change.

### B7a.2

Removed the tray's viewer injection and `viewTranscript` method, and removed the obsolete test provider while retaining the other tray tests. Removed the app-shell overlay import, component registration, service injection, deferred template block, and previous-sessions test provider. Deleted the overlay and its spec and the viewer service. `libs/frontend/chat/src/index.ts` had no export of any deleted symbol, so it needed no edit.

### Search output

Command: `rg -n "viewTranscript|SubagentTranscriptOverlay|SubagentTranscriptViewerService|subagent-transcript-overlay|subagent-transcript-viewer.service" libs/frontend/chat`

Output: no matches (`rg` exit code 1).

`canViewTranscript` remains at `session-agent-tray.ts:177,234` for B7b. B7b's background strip and canvas lane and B7c's chat-streaming and chat-ui files were untouched. The confirmation dialog and previous-sessions overlay remain in app-shell.

### Verification and risks

`ptah_get_diagnostics` was run on the changed TypeScript files. It reported no errors in the changed production files. It reported an error at untouched `app-shell.previous-sessions.spec.ts:517` (`HTMLElement.focus` spy instance inferred as `void`) and numerous sibling spec errors; this batch did not edit those lines or sibling files. No test, typecheck, lint, build, serve, e2e, or package command was run, per lane instructions. The spawning session owns those checks. The requested string search is clear. No unrelated inspector, tray, or app-shell action was removed.

## Decisions

- **Leave the inspector section spec unchanged.** Its current tests cover CLI usage badges and contain no transcript case to delete. A separate action-menu spec does not exist. Evidence: `inspector-agents-section.component.spec.ts` and the session-inspector file search. Reversible: yes.
- **Leave `canViewTranscript` producers and other transcript-related batch files intact.** B7b and B7c explicitly own them. Evidence: batch assignment and remaining producer lines in `session-agent-tray.ts`. Reversible: yes.
- **Do not edit the chat barrel.** It contains no export of the removed overlay or service. Evidence: search of `libs/frontend/chat/src/index.ts`. Reversible: yes.
