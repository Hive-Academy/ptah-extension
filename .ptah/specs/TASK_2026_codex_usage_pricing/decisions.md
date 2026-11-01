# Decisions — TASK_2026_codex_usage_pricing

Source: user answers on 2026-11-01, after research-codex-usage-pricing.md (copied from
TASK_2026_714_c8a2, PR #881).

Goal: Codex pricing, token accounting, and plan usage/limits on the native Codex App Server
runtime must be advanced and predictable. Electron first. Native UI contracts identical to
Claude's; fixes in the backend translation layer; no frontend Codex special case; never strip MCP.

- U1 Subscription (ChatGPT-plan) Codex sessions: cost the tokens at the published per-token rate
  (the shared pricing table / OpenRouter catalog, `pricing.utils.ts`) and label the figure
  "covered by subscription" (`FindPricingOptions.subscriptionCovered`). Do not use the zero
  placeholders in `codex-provider-entry.ts`.
- U2 API-key Codex sessions: show an estimate in the existing cost chip, marked as an estimate.
  Show "unavailable" when the model or any used token class has no exact rate. Never present an
  estimate as an actual charge.
- U3 Session totals include: native child-thread (sub-agent) usage, usage before a context
  compaction, and tokens used by failed or interrupted turns.
- U4 Timing: separate task and PR, in parallel with PR #881 (D9 + Removal A). Branch
  `feat/codex-usage-pricing`, worktree `.claude-worktrees/codex-usage-pricing` from main
  b84d0e2f6. Expect merge overlap with PR #881 in
  `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts` and
  `codex-chat-turn-stream.ts` (PR #881 added `CODEX_FAILURE_NOTICE`); keep edits there small.
- Open (decide in the plan, ask the user only if it changes scope): credits and per-limit buckets
  in the Plan limits section and `ptah_agent_list`; ordering of multiple `limitId` buckets.
- Live/paid checks need explicit user authorization with a turn cap.
