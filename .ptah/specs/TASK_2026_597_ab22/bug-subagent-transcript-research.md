# Bug research: "Transcript is not available yet" for background named subagents

## Root cause

The panel's `SubagentRecord` (frontend `AgentMonitorStore._subagents`) is built only from `agent_start` / `agent_progress` / `agent_status` / `agent_completed` events (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1622-1760`). Each copies `agentId` from the event. The backend fills that field from the backend `SubagentRegistryService` record (`system-message.transformer.ts:253, 335, 387`; `assistant-message.transformer.ts:262`).

That registry record is created only by the `SubagentStart` hook, and only if the hook callback receives a `toolUseId` (`subagent-hook-handler.ts:259`, `if (toolUseId && resolvedParentSessionId)`). `SubagentStartHookInput` has no `tool_use_id` field (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:9085-9089`: only `agent_id`, `agent_type`). The handler's own warn names this case ("no toolUseId on the SubagentStart hook", `subagent-hook-handler.ts:279-285`). The spec treats a missing id as a known case (`subagent-hook-handler.spec.ts:461-480`, `:590`).

So when the hook has no `toolUseId`, the registry never gets an `agentId` for that tool_use. Every lifecycle event then ships `agentId: undefined`, and `SubagentRecord.agentId` stays empty for the whole run and after completion. Tokens still show because `task_progress` carries `usage` without needing the id (`system-message.transformer.ts:332-334`).

The one place the real id is recovered is the background placeholder text. `background-started-event.ts:56,68` regex-parses `agentId: <hex>` into `background_agent_started.agentId`. That event is consumed only by `backgroundAgentStore.onStarted` (`accumulator-core.service.ts:591-593`). It is never merged into the `agentMonitorStore` SubagentRecord that the panel reads. The panel therefore has no `agentId`, and the gate at `agent-monitor-panel.component.ts:566-567` is false. The loader effect (`:1043-1048`) and `loadTranscriptFor` (`:1141-1147`) also bail out on the missing `agentId`.

Confidence: the mechanism is verified from source. That the hook actually passes no `toolUseId` at runtime for these agents is inferred from the SDK types and the existing warn/spec. Confirm by looking for "Subagent NOT registered ... no toolUseId on the SubagentStart hook" in the host log for a "reviewer-pr2" run.

## Answers to the three questions

1. **Where `agentId` / `parentSessionId` are set.**
   - Backend registry: `subagent-registry.service.ts:113-134` spreads the registration. The only caller is `subagent-hook-handler.ts:260-268`, plus history replay at `subagent-history-registrar.ts`.
   - `teammateName` and `taskId` are merged in later from pending maps (`:103-111`).
   - Frontend record: `agentId = event.agentId ?? existing?.agentId`, and `parentSessionId = knownSessionId(event.sessionId) ?? existing` (`agent-monitor.store.ts:1632, 1649`, and the progress/status/completed twins).
   - The background named subagent record is created by `agent_start`. The `task_started` path (`system-message.transformer.ts:239-260`) and the assistant `Task` tool_use path (`assistant-message.transformer.ts:249-268`) both leave `agentId: record?.agentId`, which is undefined at that point.
   - `parentSessionId` is probably present, since it comes from the stream's `sessionId`. The missing piece is `agentId`. If `parentSessionId` is also empty, the cause is `knownSessionId('')` returning undefined (`session-scope.ts:25`).
2. **Does a later event fill them?** No.
   - `SubagentStop` (`subagent-hook-handler.ts:326-461`) only updates the backend registry and notifies the stop callbacks. It never emits anything to the frontend record, and its `getToolCallIdByAgentId` fallback (`:351-369`) finds nothing because the registry never held the id.
   - `task_notification` yields `agent_completed` with `agentId: registry?.agentId` (`system-message.transformer.ts:653`), which is also undefined.
   - `background_agent_started` carries the regex-recovered id but goes to the wrong store (see above).
3. **Transcript loader.**
   - `loadTranscriptFor` → `AgentMonitorStore.getSubagentTranscript(sessionId, agentId)` → RPC `subagent:transcript` (`agent-monitor.store.ts:2033-2046`, `subagent-rpc.handlers.ts:352-380`) → `dispatcher.getSubagentTranscript(sessionId, agentId)`.
   - The SDK transcript read is keyed by `(sessionId, agentId)`. `toolUseId` and `teammateName` alone cannot load it, so the fix must obtain the `agentId`, not change the loader key.

## Regression check

`git log origin/main -5` on the relevant files shows `8510dd995` and `cde5bbc94` (2026-09-30, SendMessage resume), then older commits. Those commits only touched the `task_started` / background announcing paths. This looks like a long-standing gap rather than a recent regression; no commit was identified that removed an `agentId` merge. Not bisected.

## Minimal fix

Primary (frontend, small): in `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` add `onBackgroundAgentStarted(event)`. It merges `agentId`, `teammateName` and `parentSessionId` (via `knownSessionId(event.sessionId)`) into `_subagents[event.toolCallId]` when a record exists, using `event.agentId ?? existing.agentId`. It must not create a record or change status. Call it from `accumulator-core.service.ts:591-593` next to `backgroundAgentStore.onStarted(event)`.

Also in `agent-monitor-panel.component.ts:1046`, fall back to the active tab session when `parentSessionId` is missing, so a missing session id does not block the transcript.

Backend belt-and-braces (optional): `subagent-hook-handler.ts:handleSubagentStart`. When `toolUseId` is absent, stash `{agent_id, agent_type}` and bind it to the registry record later. Use the `agentId:` line in the placeholder tool_result, or a unique `agentType` + `taskId` match, so progress and completed events carry `agentId` too. This also fixes steer/stop (`subagent:send-message`, `subagent:stop`) for these agents, which depend on the registry. It is riskier because the correlation is heuristic.

Not covered by the primary fix: foreground subagents with no `background_agent_started` event, and records already created before the placeholder is parsed. The backend fix covers those. Task-tool placeholder text for foreground agents may not contain `agentId:`.

## Regression test idea

- Store spec: dispatch `agent_start` (no `agentId`, with `toolCallId` T, `sessionId` S), then `background_agent_started` with `agentId: 'a1b2c3'`, `teammateName`, and the same `toolCallId` T. Assert `getSubagent(T)` has `agentId === 'a1b2c3'` and `parentSessionId === S`, and that `status` is unchanged.
- Panel spec: with that record selected, the template renders `ptah-subagent-transcript-viewer` (not the "Transcript is not available yet" span), and `getSubagentTranscript(S, 'a1b2c3')` is called once.
- Transformer spec: SubagentStart with `toolUseId` undefined followed by `task_progress` should still emit an `agentId` (only if the backend belt-and-braces fix is taken).

## Risk

- The frontend merge is low risk. It is additive and only fills undefined fields. The one hazard is a `toolCallId` collision on SendMessage resume, which files under a different tool_use id with no agentId, so the merge simply no-ops.
- Records restored from history may lack `agentId` and stay unavailable.
- The backend correlation is heuristic. A wrong bind would show another agent's transcript, so gate it on an exact `agentId:` match from the tool_result text.

## Unknowns

- Whether the user's runtime hook really omits `toolUseId` (log line above) and whether `parentSessionId` is populated. The smallest check is to log `record.agentId` and `parentSessionId` of the selected SubagentRecord in the panel.
