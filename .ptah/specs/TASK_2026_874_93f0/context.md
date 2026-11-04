# TASK_2026_874_93f0 — Context

## Request
Investigate why the Electron welcome screen does not get its data reliably (read-only first,
then smallest correct fixes). Scope: libs/frontend/chat/src/lib/services/vitals/
(welcome-vitals.store.ts and the stores it injects). Exclude UsageVitalsCache ->
analytics:spendSummary (TASK_2026_870 / PR #912).

Sources:
1. PlanLimitsStore (libs/frontend/core/src/lib/services/plan-limits.store.ts, RPC
   provider:getPlanLimits) — plan limit tile does not always show the main providers.
2. RecentWorkspacesStore — data source, load and refresh timing.
3. HostInventoryCache (skillsSh:listInstalled, agent:detectClis) — timing, caching, failures.

## Workflow
- Type: BUGFIX (research-first), depth Partial, full auto mode (user).
- Gate 0.1: lanes enabled (memory: lanes-first). Approval: lane-review.
- Lanes: grok (confirmed room) for investigation + implementation; review by a different
  family (antigravity, else codex). opencode, Glm, kimi at limit; copilot/claude disabled.
- Worktree: .claude-worktrees/welcome-vitals-data, branch fix/welcome-vitals-data.
