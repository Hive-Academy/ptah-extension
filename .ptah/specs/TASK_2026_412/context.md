# TASK_2026_412: Observation notifications and multi-session performance

User requests a fix in a new worktree and assessment of six or more open sessions. Built-in subagents only; Ollama quota exhausted. No commits or pushes authorized.

Workspace and all deliverables: D:/projects/ptah-extension/.claude-worktrees/fix-observation-session-performance
cli_delegation: disabled

Task was atomically allocated through Ptah as TASK_2026_412. Related independent tasks: TASK_2026_410 (background-agent live views), TASK_2026_411 (startup stalls/analytics). Do not change their artifacts or duplicate scope.

Prior verified investigation: PostToolUse passively captures observations, not extra model-issued tool calls. Queue batches synchronous SQLite; activity toast repeats via incoming observations and rotating history. Generic click opens Thoth remembered tab, default Memory. bootThothRuntime adds unowned onCapture callbacks per qualifying workspace boot to singleton store. Full input/output serialization precedes truncation. Observation IPC flushes pending chat stream batches. Hidden Memory panel does not refresh per capture; mounting it initiates overlapping initial loads. No runtime lag measured or recursive capture loop established.

Scope: preserve capture, quiet routine telemetry, fix subscription ownership, reduce IPC/renderer overhead, handle workspace origin, consolidate duplicate Memory mount loads as appropriate. Inspect six idle vs background-active vs visible-streaming sessions separately. Use bounded synthetic verification, never mutate live user database. Avoid DB-worker redesign without measurements.

Workflow: research and architecture plan, user review, team-leader batches, specialist implementation, tests and independent review. All writes confined to this worktree.
