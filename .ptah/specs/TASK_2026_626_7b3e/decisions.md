# Decisions — TASK_2026_626_7b3e

| ID | Decision | Evidence | Step |
| -- | -------- | -------- | ---- |
| D1 | Classify as BUGFIX but insert a software-architect phase before team-leader. | User said "fix"; the change adds a new message channel across 4+ projects, so a plan-free BUGFIX is too narrow. | Evidence |
| D2 | Use a new `session:stats-live` message; do not emit interim `SESSION_STATS`. | `chat-message-handler.service.ts:367` — SESSION_STATS is the end-of-turn signal (TASK_2025_101). | Evidence |
| D3 | The SDK `result` value stays authoritative and replaces the live estimate. | `replaceRun` already replaces the run with the cumulative `modelUsage`. | Evidence |
| D4 | Approval mode `lane-review`; plan reviewed cross-side on a CLI lane. | Gate 0.1: codex and others installed. | Evidence |
| D5 | (architect) Late live events are rejected by the existing revision floor, not by turn status; the authoritative snapshot always gets a higher revision. | `session-stats-snapshot.ts:77-89`; status gating would hide background-subagent spend. | Evidence |
| D6 | (architect) `recordAgent` unchanged; `task_started` frames trigger a live flush that reads the agent count. | Hook handler has no stream handle (`subagent-hook-handler.ts:89-102`). | Evidence |
| D7 | (architect) Accumulate from `assistant` frames (deduped per `message.id`), not `stream_event`, because stream events are main-loop only. | `stream-transformer.ts:517-523`. | Evidence |
| D8 | (architect) Host-source registry baseline unchanged. | New name does not match the baseline test pattern; changing it needs the TASK_2026_610 Gate 2 exception. | Evidence |
