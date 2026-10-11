# Task Context - TASK_2026_626_7b3e

## User Request
"why the calculation of our stats have to wait all the way long until the main agent send his first
message ? i mean i have a session where the main agent is working and spawning subagents without
showing any stats why is that and how to fix" — then: "lets create a new worktree and fix this
properly please"

## Task Type
BUGFIX

## Complexity
Complex (crosses shared RPC types, agent-sdk, cli-agent-runtime wiring, frontend chat store)

## Strategy
BUGFIX with an architect phase inserted (broader flow, see decisions.md D1):
software-architect → cross-side plan review → Gate 2 → team-leader → developers → QA.
Worktree: `.claude-worktrees/fix-live-session-stats-a1634d3869cb`, branch `fix-live-session-stats`.

## CLI Lanes
Gate 0.1: `auto`. Installed lanes: codex, antigravity, opencode, grok, Glm (ptah-cli).
Approval mode: `lane-review` (cross-side reviewer for the plan runs on a CLI lane).

## Conversation Summary
Diagnosis (orchestrator):
- `SessionStatsOwnerService` state changes only through `replaceRun` / `markRunIncomplete`, both called
  from the `result` branch of `stream-transformer.ts`.
- `onResultStats` → `cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:409` broadcasts `SESSION_STATS`.
- `subagent-hook-handler.ts:101` records only the subagent ID.
- `LiveUsageTracker` already sees `message_start` / `message_delta` usage, used only for compaction.
- Frontend treats `SESSION_STATS` as the authoritative completion signal
  (`chat-message-handler.service.ts:367`, TASK_2025_101) — interim stats must use a NEW message type.
