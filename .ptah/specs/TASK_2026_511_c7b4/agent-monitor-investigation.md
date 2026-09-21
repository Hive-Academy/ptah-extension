# Agent Monitor Collapse Investigation

## Answer

The Agents panel is **not** keyed by CLI session id. Both the backend registry and the frontend store index agents by `agentId`, and the panel renders one tile per `agentId`. The collapse of the three Codex spawns into a single "Codex CLI" entry is caused by the frontend store's deliberate resume-deduplication: when a new spawn arrives with the same `cliSessionId` as an existing **non-running** card, `AgentMonitorStore` removes the old card and replaces it with the new one. Because the three Codex calls shared the same `cliSessionId` and the earlier Codex cards were no longer running when the later resumes arrived, the UI was left with one Codex card plus the separate Ptah CLI card.

## Evidence

### 1. Where a spawned agent is registered

The MCP tool surface is in `protocol-dispatcher.ts`, which validates the call and forwards it to `ptahAPI.agent.spawn(...)`:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:729`
  ```ts
  case 'ptah_agent_spawn': {
    ...
    result = await ptahAPI.agent.spawn({
      task,
      cli: spawnArgs.cli,
      ...
      resumeSessionId: spawnArgs.resume_session_id,
      parentSessionId: request._callerSessionId,
      ...
    });
  ```

The API namespace is built by `agent-namespace.builder.ts`. For rival CLIs (including Codex) it calls `agentProcessManager.spawn(...)`:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:290-299`
  ```ts
  const enrichedRequest = {
    ...requestFields,
    ...(workingDirectory && { workingDirectory }),
    ...(activeSessionId && { parentSessionId: activeSessionId }),
    ...(roleDefinition && { roleDefinition }),
    ...(projectGuidance && { projectGuidance }),
    ...(systemPrompt && { systemPrompt }),
    ...(pluginPaths && pluginPaths.length > 0 && { pluginPaths }),
  };
  return agentProcessManager.spawn(enrichedRequest);
  ```

The actual registry is `AgentProcessManager`, which stores records in a `Map` keyed by `agentId`:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:134`
  ```ts
  private readonly agents = new Map<string, TrackedAgent>();
  ```
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:496`
  ```ts
  this.agents.set(agentId, tracked);
  ```

**Key used:** `agentId`.

### 2. How the monitor is fed and what key builds each row

Backend lifecycle events are broadcast to the webview as push messages:

- `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:167-176`
  ```ts
  agentProcessManager.events.on('agent:spawned', (info: AgentProcessInfo) => {
    webviewManager
      .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_SPAWNED, info)
      .catch(...);
    ...
  });
  ```

The frontend message handler routes `AGENT_MONITOR_SPAWNED` directly into the store:

- `libs/frontend/chat/src/lib/services/agent-monitor-message-handler.service.ts:30-34`
  ```ts
  case MESSAGE_TYPES.AGENT_MONITOR_SPAWNED:
    this.store.onAgentSpawned(message.payload as AgentProcessInfo);
    break;
  ```

The store indexes by `agentId`:

- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:269-275`
  ```ts
  private readonly _byId = computed(() => {
    const map = new Map<string, MonitoredAgent>();
    for (const a of this._agents()) {
      map.set(a.agentId, a);
    }
    return map;
  });
  ```

And the panel renders one tile per `agentId`:

- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:334`
  ```ts
  @for (agent of standaloneAgents(); track agent.agentId) {
  ```

**Key used for rows:** `agentId`.

### 3. Where the collapse happens

The collapse happens in `AgentMonitorStore.onAgentSpawned` when it cannot find the new `agentId` and then calls `findReplacementCard`. If the new spawn carries a `cliSessionId` that matches an existing **non-running** card, the old card is removed and replaced by the new one:

- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:685-724`
  ```ts
  const oldCard = this.findReplacementCard(list, info, parentSessionId);
  if (oldCard) {
    ...
    return insertAgentSorted(
      list.filter((a) => a.agentId !== oldCard.agentId),
      replacement,
    );
  }
  ```

The matching rule is in `findReplacementCard`:

- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1028-1041`
  ```ts
  if (info.cliSessionId) {
    for (const a of list) {
      if (a.cliSessionId !== info.cliSessionId) continue;
      if (a.status === 'running') continue;
      if (
        a.parentSessionId !== undefined &&
        parentSessionId !== undefined &&
        a.parentSessionId !== parentSessionId
      ) {
        continue;
      }
      return a;
    }
  }
  ```

This behavior is explicitly covered by tests that assert replacement by `cliSessionId`:

- `libs/frontend/chat-streaming/src/lib/agent-monitor.empty-session-id.spec.ts:150-187`
  ```ts
  it('replaces the interrupted card instead of duplicating it when the old card has no owner', () => {
    store.onAgentSpawned(processInfo({ agentId: 'agent-old', cliSessionId: 'cli-session-1', parentSessionId: '' }));
    store.onAgentExited(processInfo({ agentId: 'agent-old', cliSessionId: 'cli-session-1', parentSessionId: '', status: 'interrupted' }));
    store.onAgentSpawned(processInfo({ agentId: 'agent-new', cliSessionId: 'cli-session-1', parentSessionId: ACTIVE_SESSION }));

    const ids = store.agents().map((a) => a.agentId);
    expect(ids).toEqual(['agent-new']);
  });
  ```

**Collapse point:** `findReplacementCard` removes the prior non-running card with the same `cliSessionId` and keeps only the newest one.

### 4. Whether a resumed spawn emits a creation event

Yes. A resumed spawn follows the same path and emits the same `agent:spawned` event.

In `doSpawnSdk`, a `resumeSessionId` is recorded on the info object:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:304-306`
  ```ts
  ...(request.resumeSessionId
    ? { cliSessionId: request.resumeSessionId }
    : {}),
  ```

The same method then tracks the new SDK handle, stores it under a freshly minted `agentId`, and emits the event:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:496`
  ```ts
  this.agents.set(agentId, tracked);
  ```
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:582`
  ```ts
  this.events.emit('agent:spawned', tracked.info);
  ```

The `spawnFromSdkHandle` entry point (used for Ptah CLI agents and some resumed paths) also pre-sets `cliSessionId` from `resumeSessionId` and enters the same tracking path:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:418`
  ```ts
  ...(meta.resumeSessionId ? { cliSessionId: meta.resumeSessionId } : {}),
  ```

**Conclusion:** the resume path does **not** skip the creation announcement. It announces a new `agentId` carrying the same `cliSessionId`.

### 5. Intended or accidental

This is **intended** grouping, not an accidental keying bug.

The backend explicitly sets `cliSessionId` from `resumeSessionId` so the frontend can deduplicate by CLI session:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:378-380`
  ```ts
  /** Resume session ID. Pre-sets cliSessionId on the agent:spawned event
   *  so the frontend can deduplicate agent cards by CLI session. */
  resumeSessionId?: string;
  ```

The store comment describes the same design goal:

- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1005-1016`
  ```ts
  * Strategy 2: Match by cliSessionId (MCP-triggered respawn during session resume —
  *   the MCP spawn path doesn't know the old card's agentId, but the same CLI session
  *   ID is reused). Only matches non-running agents.
  *
  * `cliSessionId` is the CLI-native conversation id, so equality on it already
  * means "the same conversation". ... It used
  * to be a plain `===`: an interrupted card created before the session UUID
  * resolved never matched the resume spawn that carried the real UUID, so
  * `onAgentSpawned` built a SECOND card, left the interrupted one behind, and
  * never wrote the resume key — a duplicate instead of a resumption.
  ```

The test suite also treats this as desired behavior (see the `resuming an interrupted CLI agent` block in `agent-monitor.empty-session-id.spec.ts:149-251`).

## Is it a bug

No — the grouping is **intentional**. The system treats multiple sequential turns of the same CLI-native conversation as one visible agent card once the previous turn has finished. That prevents the monitor from filling up with stale, interrupted cards every time a session is resumed.

If the desired behavior were to show every `ptah_agent_spawn` call as a distinct card regardless of session reuse, the fix would touch:

1. `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1018-1044` — remove or gate the `cliSessionId` replacement logic in `findReplacementCard`.
2. The panel rendering path (`agent-monitor-panel.component.ts:334`) already supports multiple `agentId` rows, so no panel keying change is needed.
3. Optionally, persistence / session metadata (`persistCliSessionReference` in `agent-events.ts`) would need to handle multiple live records for the same `cliSessionId` if it currently assumes one.

I did not implement any change.

## What I could not determine

- I could not confirm the exact runtime timing of the three Codex turns. For the observed two-card result, the earlier Codex card(s) must have been non-running (`status !== 'running'`) when the later resumed spawns arrived. If they had still been running, `findReplacementCard` would have skipped them and the UI would have shown more than one Codex card.
- I did not verify live backend event logs, so I cannot prove that all four `agent:spawned` events were actually emitted versus the Codex SDK suppressing some overlapping turn. The code path, however, emits one event per successful `AgentProcessManager.spawn` call, each with a distinct `agentId`.
