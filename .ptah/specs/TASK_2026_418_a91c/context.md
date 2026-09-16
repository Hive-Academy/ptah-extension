# Remaining Codex proxy session statistics after PR #490

## User intent

Preserve the Claude Agent SDK harness and PR #490 behavior while fixing four confirmed accounting and presentation defects: process-cumulative costs counted as turn costs; main-session token versus tree-cost scope mismatch; unverified context-window capacity; and misleading compaction measurements. Cover live streams, process reuse/restart, resume, duplicate JSONL events, background-subagent completion, and history reload across direct Claude, Codex proxy, and OpenRouter where applicable. Use sanitized fixtures only. Do not claim accounting changes improve cache efficiency, subscription quota, or provider billing.

## Worktree

- Branch: `fix/task-418-codex-session-statistics`
- Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-418-codex-session-statistics`
- Base: current `origin/main` after PR #490 (`cdab18267`)
- CLI delegation: Codex CLI allowed as a junior helper. Ollama forbidden because quota is exhausted.

## Coordination

- TASK_2026_408 worktree is the merged PR #490 head and is behind current main; do not reuse it.
- TASK_2026_411 has extensive unrelated uncommitted profile-startup/storage work; do not touch its worktree.
- TASK_2026_414 is active in `fix/compaction-ui-consistency`, focused on boundary-safe reload, compaction timers, marker wording, and post-compaction context seeding. Coordinate overlapping compaction presentation; do not duplicate or overwrite its work.
- Root checkout has unrelated uncommitted orchestration/canvas changes and remains untouched.

## Evidence

Private runtime and JSONL logs named by the user are read-only evidence. No private log content may be committed. Duplicate assistant usage records must be deduplicated by `message.id`. Cost figures are estimated/reported telemetry, not invoices or subscription consumption. Absolute latest-request context usage is trustworthy when present; capacity is unknown unless authoritative metadata for the configured provider/model establishes it.

## Required workflow

Investigate code and evidence, produce a focused plan for user approval, delegate implementation, then independently verify. No commit, push, merge, or release without explicit authorization.
