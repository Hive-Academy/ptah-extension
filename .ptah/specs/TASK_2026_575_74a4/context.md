# Task Context - TASK_2026_575_74a4

## User Request
"create a separate worktree of main and lets orchestrate a fix for this issue and please make sure its correct this time and properly reflect the actual costs of the model being used and make sure the total is being shown correctly in the stats not only the last message cost, and proper testing to avoid degrading again please"

Original complaint: pricing keeps breaking; stats never show proper accumulated pricing as before; regression appeared after fixing Codex pricing as main agent; broken for Claude and Codex; the analytics page cost is also wrong. Screenshot: header COST $8.32 / TOKENS 14.7M / AGENTS 4 / MODELS 2, and the last message footer "12.9k tokens $8.32".

## Task Type
BUGFIX

## Complexity
Medium

## Strategy
BUGFIX, Partial: research (done, see research-report.md) -> team-leader Mode 1 (plan-free) -> developers -> reviewers -> QA.

## Worktree
D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost (branch fix/task-575-session-cost-accounting, base 722d921ab). node_modules is a junction to the main checkout.

## CLI Lanes
Gate 0.1: subagents implement; CLI lanes (codex preferred) do cross-side code reviews. Available: codex, antigravity, opencode, Glm (ptah-cli).
Update: codex hit its usage limit (until 2026-10-03). User decision: use Glm (ptah-cli pc-355b645d-35af-4974-84cf-9cf961ea0164) or antigravity (agy) for cross-side reviews.

## Conversation Summary
- Investigation (3 researcher agents + orchestrator checks) found 4 defects; see research-report.md.
- User requires: correct per-model pricing, correct accumulated totals in the stats header (not only the last message), regression tests that prevent recurrence.
- research-addendum.md settled open questions. Orchestrator scope decisions:
  1. Defect 1 (per-message cost cumulative): FIX. Derive the per-turn delta in SessionStatsOwnerService.replaceRun (previous = run.current ?? run.base) and publish it as the message cost; never publish the cumulative value as message cost. Rejected/stale results publish no message cost. Separate the field names/types for turn cost vs session total so they cannot be aliased again.
  2. Defect 2 (live header omits subagents): NOT a defect for SDK Task subagents (modelUsage/total_cost_usd include them per sdk.d.ts:5373-5376). No double-add. Instead add a parity test: for the same fixture session, the live owner total (from cumulative modelUsage, unreported/self-priced path) equals the disk aggregator total (parent + subagent ledgers). recordAgent stays count-only.
  3. CLI lanes cost: OUT OF SCOPE (no usage/model data recorded). Must not be shown as $0 or mixed into totals.
  4. Defect 3 (analytics drops partially priced sessions): FIX. Aggregate knownCost of every session; show partial coverage explicitly (partial marker + count of partially priced sessions / unpriced tokens). No silent drop, no $0 for unknown.
  5. Defect 4 ([1m] unpriced): FIX. Share one exported model-id normalizer (from stream-transformer normalizeModelKey) in libs/shared pricing: exact match first, then strip trailing [..] tags, then provider prefix, then date suffix. Long-context per-call tiering (>200K) is NOT implemented (rates not verified; SDK reported dollars already cover the native route) - record as a follow-up.
  6. Regression guard: contract tests - (a) multi-turn run with non-zero restored base: sum of per-message costs == session total delta, last message cost != session total; (b) Claude reported path and Codex unreported path both; (c) analytics totals include partial sessions; (d) [1m] and provider-prefixed ids price at base-model rates; (e) live-vs-disk parity; (f) agent-stats.service sums deltas correctly.
  7. UI touched only for the analytics partial marker (no new surface): before/after screenshots dark+light of the analytics page are required.
