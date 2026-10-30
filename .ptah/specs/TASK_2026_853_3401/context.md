# Context — TASK_2026_853_3401

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-artifact-display-window-be2e973df42f`
Branch: `feat/artifact-display-window` (from `main` at 6fa7c21b5). Strategy: FEATURE, Full workflow, Electron first.
Session: child session "Artifact display window" (unattended; no AskUserQuestion — decisions are recorded here).

## User request (2026-10-30, verbatim intent)

An agent published an HTML report with `ptah_artifact_publish` (TASK_2026_710_html, PR #789). The user saw nothing:

1. The artifact card rendered only inside the `ptah_artifact_publish` tool-call row
   (`libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts:103`),
   buried under ~20 other tool calls. The assistant's reply did not show it.
2. Clicking **Open** on the card opened the Display panel with only the "Turn summary" tab and the
   text "The artifact could not be displayed. It is not loaded in this tab." This is a BUG: find the
   root cause and pin it with a regression test.
3. The Display panel opens as an overlay at the TOP of the chat and covers the transcript.

### Goals
- A. Fix the "not loaded in this tab" bug so Open and Full screen always show the artifact the card belongs to.
- B. On publish, open the artifact automatically in the display surface (Claude desktop / Codex artifact pane). The user can turn this off.
- C. Show the artifact card in the assistant's reply flow (end of the turn), not only inside the tool-call row.
- D. Display surface redesign: a right-side sidebar next to the chat (resizable, collapsible) instead of an overlay.
  It can be DETACHED into a separate Electron window (child BrowserWindow) that shows the display tabs
  (artifacts, turn summary, ptah-ui display surfaces) and stays in sync; it can be re-attached. Chat and other UI are
  not affected while detached. Remember window bounds. Close the detached window cleanly on app quit.
- E. Optional, decide with evidence: a lazy, height-capped inline preview of the latest artifact in the transcript.
  TASK_2026_710 decided "one live iframe, never in the transcript" for renderer memory; only reverse that with a
  bounded design (e.g. only the latest 1-2 previews live, others static cards).

### Constraints
- Keep the TASK_2026_710 sandbox: script-only iframe, no network, CSP, nonce-checked postMessage bridge (theme, height,
  open-link with http(s) allowlist). A detached window keeps the same isolation: contextIsolation, no nodeIntegration,
  sandbox, validated IPC sender, no new preload surface beyond what is needed.
- Host↔UI through the RPC contract in `libs/shared/src/lib/types/rpc.types.ts` and handlers in `libs/backend/rpc-handlers`;
  Electron IPC in `ipc-bridge.ts` validates the sender. Update the DI/RPC guard specs when registering anything.
- New host capability (open a detached window) = a port in `libs/backend/platform-core` + Electron adapter; VS Code and CLI
  adapters return a clear "desktop app only" result. Keep every host compiling.
- Angular: standalone, OnPush, signals, `inject()`, no `[innerHTML]` with untrusted content.
- Read `.ptah/specs/TASK_2026_710_html/` and `TASK_2026_539_67f5` before planning.

## Decisions log

- 2026-10-30: Plan approved by the parent session (user said: do not ask, continue to PR). Accepted as planned:
  root-cause fix (panelArtifacts + Open uses its own view's tab + records rebuilt from transcript publish results,
  regression tests incl. resumed session and app restart), `display.autoOpenArtifacts` default on, end-of-turn cards
  with a compact tool-row line, right resizable sidebar + `IDisplayWindowHost` port + Electron child window with the
  same isolation, E deferred (no frame-memory measurement exists; B + C remove the "buried" problem).
- Coordination: parallel sessions "Per-session git view" (`feat/session-git-view`, git dock in `libs/frontend/git-ui`,
  may touch the right-side chat-shell layout) and "Auto-link sessions, tasks, todos" (`feat/session-auto-links`,
  session organization and session card). Check at plan approval: both branches at 6fa7c21b5 (= main), no source
  changes in their worktrees. Keep the layout change inside the display surface and a named slot; re-check both
  branches before batches 10-11 and note overlap in the PR body.

## Orchestrator findings so far (2026-10-30)

Hypothesis for bug A (to be confirmed by the architect with exact evidence):
- `ArtifactStore` (`libs/frontend/chat/src/lib/services/artifact.store.ts`) buckets records by `record.sessionId`.
- The publish scope id is `deps.getSessionTabId?.(callerSessionId) ?? callerSessionId`
  (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:2365-2387`).
- The tool-row card finds its record with `recordById` across ALL buckets
  (`tool-call-item.component.ts:178-181`), so it renders Open/Full screen.
- `openArtifact` uses `TabManagerService.activeTabId()` (`tool-call-item.component.ts:183-191`), and the sheet passes
  only `records()[tabId]` to the panel (`display-sheet.component.ts:115-117`). The panel shows
  "not loaded in this tab" when the selected id is not in that list (`display-panel.component.ts:164,221`).
- So whenever `record.sessionId !== activeTabId` (child session, external MCP caller, SDK id that the registry does not map
  to the frontend tab id, tab id renamed after resume, ...) the card opens but the panel cannot show it. The exact
  producing path must be identified.
