# Task Context - TASK_2026_698_4146

## User Request

Start a new FEATURE task: an estimated prompt-cache expiry timer in the right sidebar
(session inspector) for Claude Agent SDK sessions.

### Goal
Show, per Claude session, how long the prompt cache is expected to stay alive, so the user knows
when the next message will re-read the full context uncached. Example: "Cache expires in 42 min
(estimated)". When idle compaction is armed for the session, also show "Idle compaction in N min".
After expiry show "Cache expired". Hide the tile for sessions without cache data (Codex, Cursor,
other non-Claude providers).

### Background (already on main)
PR #755 (merge commit f09b336b4, TASK_2026_692_f748) added idle compaction. Records:
.ptah/specs/TASK_2026_692_f748/ (implementation-plan.md, decisions.md, completion-report.md).
Reuse its data instead of building a second tracker:
- libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-request-tracker.ts
  (MainRequestTracker: per-request time and 1h/5m cache-write classification, main thread only)
- libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts
  (knows when an armed idle compaction will fire)
- libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts
- libs/shared/src/lib/types/messages/session-stats-live.ts (session:stats-live wire + parser)
- libs/frontend/chat/src/lib/services/session-stats/session-stats-source.ts
- libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts and
  session-stats-summary.component.ts (existing sidebar stats UI)

### Proposed design (validate in the plan, do not treat as final)
- Expiry = end of the LAST main-thread request + TTL (a cache hit refreshes the TTL). It is not
  the first write time. Subagent requests use a different prefix and do not refresh the main cache.
  TTL comes from the last confirmed cache write (1h subscription, 5m API key).
- Add an optional `cache` field to the existing session:stats / session:stats-live payloads:
  ttl ('1h' | '5m'), lastRequestAt, expiresAt, and idleCompactAt (only when armed). Extend the
  hand-written parser with validation (finite, >= 0). No new RPC method and no polling.
- The webview counts down locally from expiresAt with one shared timer that runs only while the
  panel is visible. OnPush and signals, following the existing session stats components.
- Label the value as an estimate, because the server can evict the cache early.

### Process
- Worktree .claude-worktrees/cache-expiry-timer on feat/cache-expiry-timer, node_modules junction.
- Lanes: codex for implementation. Claude subagents for the plan review and the code reviews.
- Scoped checks only, NX_NO_CLOUD=true, Jest --coverage=false --maxWorkers=2, Nx --parallel=1.
- Degradation-audit comment on intentional catches; never raise the baseline.
- UI: before/after screenshots in dark and light themes; Electron allowed, announce to other
  sessions, private APPDATA copy, "Electron: free" after.
- At the end push in the background and open a PR to main; report the PR link.

## Task Type
FEATURE

## Complexity
Medium (shared wire type + backend aggregation + frontend tile; 3 libs)

## Strategy
FEATURE, Full depth with the user's design brief as the requirements input.
Flow: codex lane writes task-description.md + implementation-plan.md → Claude subagent
cross-side review → codex implementation lanes per batch → orchestrator scoped checks + commits →
Claude code-logic review on the phase diff → one fix round → visual review (before/after,
dark + light) → PR.

## CLI Lanes
- Preference source: user request this turn (codex for implementation, Claude subagents for
  reviews) + memory "orchestration-executor-preference" (lanes-first, codex first).
- Mode: enabled. Approval mode: lane-review.
- ptah_agent_list at 2026-10-18 ~18:00 UTC: codex installed, confirmed room (Weekly 18%);
  opencode near limit (Monthly 93%); grok near limit (Weekly 98%); antigravity unknown (reader
  failed); Glm (Ollama Cloud ptah-cli) unknown; copilot disabled; cursor, pi not installed.
- The global CLAUDE.md "TEMPORARY CLI lanes instead of Claude subagents" section expired on
  2026-10-16; today is 2026-10-18, so Claude subagents are allowed for reviews.

## Conversation Summary
See decisions.md.
