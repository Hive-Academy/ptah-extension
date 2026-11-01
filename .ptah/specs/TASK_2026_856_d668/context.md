# Task Context - TASK_2026_856_d668

## User Request
we have a couple of issues in our calculations and clients side date and timers, basically all of them should be moved in a more persistenant state specially all calculations for sessions like the context , tokens costs, cache , start time and everything we make in frontend or technically specaking in angular components life cycle that gets distroyed after navigations or something should be spotted and handled systematically

## Task Type
REFACTORING (with BUGFIX traits; broader flow chosen — see decisions.md)

## Complexity
Complex

## Strategy
Full: researcher-expert (audit inventory) → software-architect (plan) → Gate 2 → team-leader → QA.
Worktree: D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics
Branch: fix/persistent-session-metrics. Electron first.

## CLI Lanes
- Preference source: memory `orchestration-executor-preference` (01M4TT…, newer than the
  `cli-lane-token-burn` 01M40W… entry): lanes-first, codex first, different-family reviews.
- Mode: enabled. Approval mode: lane-review.
- ptah_agent_list (2026-10-30): codex installed, confirmed room (Weekly 37%); grok near limit
  (95%); Glm near limit (90% weekly); kimi code available (limits unknown); antigravity installed
  (reader failed); opencode AT LIMIT; copilot/claude disabled; cursor/pi not installed.

## Conversation Summary
- Scope: every session metric/date/timer computed in Angular component lifecycle (context usage,
  token counts, cost, cache tokens, start time, elapsed timers) that resets or drifts on
  component destruction. Fix systematically.
- User approved all four Proposed Removals (decisions.md #5).
- User agreed: host stays the single source of truth for totals; add host `turnCount`; and
  context % plus every calculation and timer must be verified correct and persisted, not only
  moved out of components (decisions.md #6, #7).
