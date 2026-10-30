# Evidence for the context-budget redesign (read-only pass, 2026-10-29)

Records what the read-only investigation found after the parent's direction update. Paths are
relative to the repo root; line numbers are as read on this branch.

## Mid-turn per-request context figure: none today

- `recordRequestContext` (`agent-process-manager.service.ts` ~1437) reads only `usage.inputTokens`
  and always labels it `estimate`.
- Codex `exec --experimental-json`: usage only on `turn.completed`. The rollout reader
  (`codex-rollout-usage.reader.ts`) gives a true per-request `last_token_usage`. Each call does one
  directory walk with no cache and a 64 KiB tail read, growing to 1 MiB and then 16 MiB windows.
  It is cheap enough to poll at a modest interval. Codex app-server `thread/tokenUsage/updated` is
  mid-turn, but `CodexLaneEvents` that consumes it is not wired anywhere.
- OpenCode: `step_finish` is skipped unless `reason === 'stop'`, so in practice it is per turn.
- Copilot: `assistant.usage` per event, which is probably per API call (unverified).
- Antigravity: per turn (`DONE` step).
- Ptah CLI / claude-cli: usage comes only from `result` (per turn). Assistant `message.usage` is
  available in the stream but not emitted.
- Cursor, Pi, Grok, ACP: no usage at all.

## Native compaction

- Codex `codexAutoCompactTokens` defaults to 120_000 and is passed as
  `-c model_auto_compact_token_limit`.
- Claude / Ptah CLI lanes keep Claude Code's own auto-compact by default.
- Copilot compacts on its own, with no knob.
- No other adapter has a compaction knob.

## Notice attachment point

`handleToolsCall` in `vscode-lm-tools/.../mcp-core/protocol-dispatcher.ts` ~880 wraps every
tools/call, including `ptah_agent_report`. It runs inside the request context, where
`getCallerAgentId()` is available. The agent id comes from the `/agent/{id}` URL.

- Skip `approval_prompt`.
- Telemetry keys `budgetOutcomes` by the response object, so mutate the response in place.
- Stdio MCP carries no agent id.

## Layering

- cli-agent-runtime → agent-sdk: allowed and used. agent-sdk → cli-agent-runtime: none.
- vscode-lm-tools → cli-agent-runtime: yes.
- Not exported from agent-sdk's index: `SubagentNoticeQueue`, `SubagentHandoffRecords`,
  `renderRecord`, `recordFileName`, `SubagentHandoffIndex`, `handoffMessage`.

## Handoff record reuse

A record written to `<ws>/.ptah/subagent-handoffs/` with `owner = ownerHash(parentSessionId)` and
`tool = lane agent id` would be listed by the existing `SubagentHandoffIndex` pointer, with
conditions:

- `parentSessionId` must already be the resolved SDK UUID, not the tab id.
- The workspace must match.
- The pointer surfaces on the parent's next user prompt only, not on host-injected turns.

The completion envelope is therefore still needed to name the record path.

Session `HANDOFF.md` sections: Goal, Done, In progress, Open problems and decisions, Key files,
Background work, Next steps.

## Subagent defaults

- `compaction.subagentHandoffTokens`: 150_000.
- `compaction.subagentStopWeightedTokens`: 3_000_000.
- `NEAR_BUDGET_RATIO`: 0.85.
