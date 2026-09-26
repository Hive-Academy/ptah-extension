# Task Context - TASK_2026_562_4b1d

## User Request

(2026-09-26, during TASK_2026_559) The user asked which open token-audit items need their own task, and to commit
every such task to the TASK_2026_559 PR so work starts after that PR merges. Tokaudit Waves 2 and 4 are open and are
not compaction (TASK_2026_561_9e57 owns compaction), so they get this task.

## Order

Start after TASK_2026_559_8ca9 merges. Independent of TASK_2026_561_9e57; coordinate with TASK_2026_560_2ae5 (per-caller
tool sets), because Wave 2.1 uses the `/agent` tool profile that 560 builds.

## Source

`.ptah/specs/TASK_2026_557_tokaudit/research-report.md` (committed on the TASK_2026_559 branch). Line numbers below are
in that file; the file:line anchors inside it are as of 2026-09-25 and must be re-checked at planning time. Savings are
the audit's estimates, not measurements.

## Already covered elsewhere — do not repeat

- Wave 2.2, resume part (skip systemPrompt / projectGuidance on resume): TASK_2026_559 Batch 14
- Wave 1.7 per-caller profiles: TASK_2026_560_2ae5
- Wave 1.8 status throttle: TASK_2026_559 Batch 13
- Wave 3 compaction: TASK_2026_561_9e57

## Wave 2 — proxy and prompt assembly (:248-268)

1. Proxied sessions (localhost / ollama / moonshot base URL): allow only the `ptah` MCP server (disabledMcpServers path
   or `strictMcpConfig: true`). Up to about 28-33k tokens per proxy request
2. Codex lane prefix: keep `tool_search_always_defer_mcp_tools: false`; add an `enabled_tools` allowlist for the ptah
   server; run lanes with an isolated CODEX_HOME or no desktop plugins
3. Effort precedence: `agentOrchestration.<cli>ReasoningEffort` wins when set ('inherit' opts into the chat effort);
   optional `effort` on the ptah_agent_spawn schema, medium default for reviewers/testers; log the effective effort
4. Responses translator: send the system prompt once (not as both `instructions` and a developer item); stable
   `prompt_cache_key` = session id; log terminal input and cached tokens at INFO
5. Usage accounting: `input_tokens` in message_start; dedupe subagent metrics by message.id; count cache tokens in
   skill-budget.store; weighted cost per request in session-usage-ledger
6. Trim injected text: skill_listing, agent_listing_delta, duplicated Ptah-CLI project guidance, lane preambles

## Wave 4 — orchestration and background jobs (:303-324)

1. Spec format + lane brief: `batches/batch-N.md` plus a small batches.md index; ptah_agent_spawn inlines a lane brief of
   at most 8-12k chars; update agent Inputs sections and templates
2. Resume gate: spawn fresh instead of resuming when the lane context is over 60k or it was idle more than 10 min
3. Blocking waits: `ptah_agent_wait` and `ptah_run_check` with compact summaries; set `tool_timeout_sec` for the ptah
   server in Codex
4. Enforced budgets: count tool calls per lane, steer at 40, stop at 60; repeat detector; block known-looping free models;
   forbid nested Codex spawn_agent in lanes
5. Agent definitions: `tools` / `disallowedTools` / `maxTurns` frontmatter; review the opus pins; reviewer output-size
   contract; scale the cross-side review mandate to task size

## Tokaudit Wave 0 — owners (user request 2026-09-26: expose as UI settings Ptah writes)

Agents never edit user-owned files; Ptah features may, after explicit user opt-in with a diff preview.

| Wave 0 item                                                               | Owner                                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 0.1-0.3 Codex auto-compact tokens, tool-output limit, effort / web search | TASK_2026_561_9e57 A9 (UI setting + harness-sync write to `~/.codex/config.toml`) |
| 0.4 `ptah.compaction.threshold`                                           | already a Ptah setting; TASK_2026_561_9e57 A1 makes it take effect                |
| 0.5 MCP allowlist in `.claude/settings.local.json`                        | TASK_2026_560_2ae5 (per-workspace MCP server toggles)                             |
| 0.6 curator pause / cheap curator model                                   | already a Ptah setting (`curatorProvider`); UI hint in TASK_2026_561_9e57 A9      |
| 0.7 lane effort workaround                                                | this task, Wave 2.3 (effort precedence)                                           |

## Decisions needed before planning

1. Wave 4.1 changes the orchestration skill and every agent template — confirm the spec-format change before design.
2. Wave 4.4 stops lanes automatically — confirm the thresholds (40 / 60 calls) and the looping-model block list.
3. Wave 4.5 opus pins and the scaled review mandate change the team's review policy — user decision.
