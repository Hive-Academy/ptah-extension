# TASK_2026_LANE_CONTROL — context

## User direction (2026-11-06)
- "Focus very deeply on our CLI tools management and enhancing agent-to-agent communications,
  beside the other enhancements. Make sure you have a good taste of design and user experience."
- Full authority, full auto: implement, verify, validate, open PRs.

## Source
A local maintainer comparison note (not in the repository). Items in scope here: 2 (capability
manifest), 3 (per-spawn permission/network), 4 (limit readers), 5 (predictable lane control).
MCP caller authentication is a separate task and PR.
Routing items 1-8 are in a separate worktree/PR: `.claude-worktrees/routing-learning`
(branch `fix/routing-learning`).

Out of scope this run: item 1 (needs external signing/store accounts), items 9-10 (bigger bets,
PR #928 covers remote control), items 6-8 (large new features; revisit later).

## Research artifacts
- `comms-investigation.md` (codex) — flow map, capability matrix, 7 defects.
- `verification-tier1.md` (kimi code) — items 2, 3, 4, 11.
- `verification-routing.md` (grok) — routing items (copied to the routing worktree).

## Confirmed by orchestrator (spot-checks)
- `agent-message-router.service.ts:152` refuses explicit steer for every CLI except codex; Pi
  supports steer but can never receive it.
- `lane-completion-notifier.service.ts:359` remembers the dedupe key before delivery; an
  inactive parent or send failure (`:406-431`) makes the completion permanently undeliverable.
- The renderer has no RPC that goes through the message router. The UI uses `agent:continue`,
  `agent:stop`, `agent:resumeCliSession` (`libs/shared/src/lib/types/rpc.types.ts:1765-1800`).
  So a user message and a parent-agent message to the same lane can behave differently.
- Existing UI surfaces: `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.ts`,
  `background-agent-strip.component.ts`, `libs/frontend/chat/src/lib/components/organisms/
  subagent-lane/*`, `agent-monitor/agent-lane-grid.component.ts`, `molecules/agent-card/*`,
  `session-inspector/inspector-agents-section.component.ts`.

## Plan
1. Research (done / in progress).
2. Architecture: `implementation-plan.md` — one capability manifest per CliAdapter (potential +
   effective), unified message router for UI and MCP, delivery receipts
   (accepted/started/settled/failed/expired), durable completion envelopes, Pi steer, per-spawn
   permission/network, MCP auth hardening if needed. Reviewed in-process by the orchestrator.
3. Design: `design-spec.md` + `prototype/` — one Send / Send now / Stop / Resume control on every
   lane surface, showing before press what will happen (steer / queue / interrupt+resume /
   restart) and after press the receipt state. Electron first, dark + light themes.
4. Implementation in file-disjoint batches on CLI lanes; review by a different family.
5. Visual review in Electron; verify; commit; PR; watch CI.

## Lane limits recorded this run
- antigravity (family antigravity): confirmed usage limit, `RESOURCE_EXHAUSTED (429) Individual
  quota reached`, resets in ~132h (about 2026-11-11 15:15 UTC). Its plan-limit reader had failed,
  so the spawn was not refused. Skip this lane for the rest of the run.
- Glm (ollama-cloud): at weekly limit until 2026-11-09 00:00 UTC.
- kimi code: 5-hour window near 99% at 03:11 UTC, resets 06:43 UTC.
- grok (family grok): confirmed usage limit at 03:51 UTC, `402 Payment Required: Grok Build usage
  balance exhausted`, reset unknown (balance-based). Its reader showed "Weekly 53%", so the reader
  measures a window while the binding limit is a balance. Skip grok for the rest of the run.
- Observed list defect (06:22 UTC): kimi code row shows "at limit, window unknown, reset unknown
  [error-derived]" while the same row's provider-api 5-hour window says "resets 06:43 UTC". The
  error-derived state should adopt the known window reset instead of "reset unknown", or routing
  skips the lane for the whole run (agent-lanes §5). Candidate follow-up for the limit readers.
