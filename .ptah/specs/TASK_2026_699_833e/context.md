# Task Context - TASK_2026_699_833e

## User Request
New task: session inspector ("This session" stats panel) as a resizable side dock.
- Open/close it with the same vertical ptah-sidebar-tab as the Workspaces and Git rails
  (chat-ui sidebar-tab.component.ts; see electron-shell.component.ts:323).
- Add a drag resize handle like the git dock (ptah-electron-resize-handle +
  ElectronLayoutService width/drag state; split-handle for the VS Code webview), with a
  persisted width clamped to min/max.
- Give it a wider default on large screens. Keep the sheet/modal presentation on narrow widths.
- Inspector: libs/frontend/chat/.../session-inspector, mounted in chat-view.component.html:295
  (.cs-inspector). Screenshots dark + light at 1440 and 760.

## Task Type
FEATURE

## Complexity
Medium

## Strategy
FEATURE, Partial depth. PM (task-description + parity-inventory) → designer → prototype →
Gate 1.7 → architect → team-leader → frontend-developer → QA (code-logic review + visual review
with dark/light screenshots at 1440 and 760).

## Worktree
D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock (branch feat/inspector-side-dock)

## CLI Lanes
- Preference source: ptah_memory_search — "orchestration-executor-preference" (lanes-first, codex
  first) and "agent-lane-review-workflow" (frontend: Claude subagents write code, CLI lanes review).
  The frontend-specific memory wins for this frontend task.
- Mode: enabled. Approval mode: lane-review.
- Roster (2026-10-19): codex confirmed room (weekly 27%); opencode near limit (monthly 93%);
  antigravity unknown; Glm (ptah-cli) unknown; grok AT LIMIT; copilot disabled; cursor, pi not installed.
- Reviewer lane: codex (different family from Claude implementers).

## Conversation Summary
- No user clarifications needed; request is specific.
- Added by user (2026-10-19, after Gate 1 review started), with a screenshot of the inspector
  "PLAN LIMITS" section: "convert this section to cards and let the center item take a full row
  to show the text and progress bar properly". Today each window row (5-hour, Weekly) is a
  3-column row: label | center (status text "unknown · resets today 02:40 GMT+3 · in 2h 30m" or
  progress bar + "50% used" + reset text, plus a source badge like "Live event"/"Provider API") |
  right badge ("? Usage unknown") + expand chevron. The center column is cramped and wraps badly.
  Requested: each window becomes a card; the center item (status text + progress bar + reset
  text) spans its own full-width row inside the card.
  Likely files: libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/ (plan-limit-tile*,
  plan-limit-tiles.ts, plan-window-detail*) and
  libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts.
- Peer note (session 685): branch fix/chat-column-alignment changes chat-transcript.component.css/html,
  message-bubble.component.css/html and chat-input.component.ts; not chat-view.component.html or the
  inspector. Do not edit those files here; the dock-side handle hit area does not depend on them.
- Electron dev app is shared: announce "Electron: 699 launching" to peers before screenshots and
  "Electron: free" after.
