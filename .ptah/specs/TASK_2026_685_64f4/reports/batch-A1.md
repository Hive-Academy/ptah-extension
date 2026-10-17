# Batch A1 implementation report

## Changed files

- `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-duration.ts`
- `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-duration.spec.ts`
- `libs/frontend/chat-ui/src/index.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow-duration.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts`
- `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts`
- `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts`
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts`

## Plan coverage

- Shared `agentRunDurationMs` and `agentRunLabel` implement running, finished, reported, invalid and subsecond behavior in `agent-duration.ts`; focused unit specs cover each branch. The public index exports both.
- `dock-overflow.ts` delegates duration calculation to the rule; its new spec covers running, finished and absent end times.
- Inspector rows call the rule for both kinds and format through `formatAgentDuration`. The CLI-only aria-label handling and `formatElapsed` import are removed. Inspector specs cover the new format and a restored lane with no end time.
- CLI card stats use `formatAgentDuration` and hide a duration under one second. `stats-bar.utils.ts` delegates its retained idle-time formatter to the same formatter for second-and-above values; the CLI spec expects the new display.
- `session-agent-roster.ts` exports `cliActivity` and copies subagent start/end times; the roster spec checks those fields.
- The inline bubble footer uses the shared duration rule and hides missing and subsecond values.
- `SubagentRecord` stores first-event and terminal timestamps. The store captures `agent_start`, progress/status fallback, completion/status and task-result times; `loadCliSessions` parses `completedAt` and keeps older or invalid references without it. Store specs cover event times and restored references.

## Decisions

- Retained `formatDuration` because `subagent-usage-summary.component.ts` still calls it and that file is outside A1 ownership. Options were to edit that caller or retain a wrapper. The wrapper is reversible and avoids an out-of-scope edit. Thus the handoff acceptance item “no `formatDuration` caller left” remains unmet.
- A finished lane with no end time has no inspector duration badge; `agentRunLabel` yields `Worked` for the same data. The inspector's existing accessible status wording is preserved.

## Verification and limits

- No Nx, Jest, build, serve or e2e command ran, per the lane instruction. The orchestrator owns those checks and screenshots.
- `ptah_ast_analyze` parsed representative changed source/spec files without syntax errors. Two scoped `ptah_get_diagnostics` calls timed out while TypeScript was still running, so type diagnostics are unavailable.
