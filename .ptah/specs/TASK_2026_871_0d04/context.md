# TASK_2026_871_0d04 — Tasks UI revamp

## User request (2026-11-03)

> Revamp and fix the task manager styling. It is very poor, looks very disconnected from the
> actual spec folders, does not follow our application design language, and lacks proper
> markdown rendering. Also target and include TASK_2026_606_b6b7 and TASK_2026_358.

## Scope

1. **Tasks UI revamp** (`libs/frontend/tasks-ui`): restyle to the app design language
   (Tailwind + DaisyUI tokens used by the chat / settings surfaces), make the detail view show
   the real spec folder (`task.md` carrier, `context.md`, and the other artifacts such as
   `task-description.md`, `implementation-plan.md`, reviews), and render markdown with
   `marked` + DOMPurify.
2. **TASK_2026_606_b6b7** (XS): `task-agent-discovery.service.ts` shows the raw `--version`
   line; reuse the Settings `cliVersionLabel` normaliser.
3. **TASK_2026_358** (XL): Ptah-owned resumable fleet runner (SQLite run/stage state,
   content-hash stage cache, lane dispatch) plus a Tasks-board surface to launch, watch and
   resume a run. Planned as a later phase because its backend is independent of the restyle;
   the revamp design must reserve a place for the run surface.

## Orchestration

- Type: FEATURE. Depth: Full. Redesign of an existing surface → `parity-inventory.md` required.
- Worktree: `D:\projects\ptah-extension\.claude-worktrees\tasks-ui-revamp`, branch
  `feat/tasks-ui-revamp`.
- Gate 0.1: lanes `enabled`. Approval mode: `lane-review`.
  - Preference source: memory `orchestration-executor-preference` (lanes first, codex first) and
    `agent-lane-review-workflow` (frontend code is written by Claude; CLI lanes review it).
  - `ptah_agent_list` (16:00 UTC): codex installed, confirmed room (weekly 37%); Glm near limit
    (96%); grok and opencode at limit; kimi code and antigravity limits unknown; copilot and
    claude lanes disabled.
- Planned sequence: PM (codex) → designer + prototype → Gate 1.7 → architect → team-leader →
  frontend implementation (Claude) → codex review → visual review in Electron.
