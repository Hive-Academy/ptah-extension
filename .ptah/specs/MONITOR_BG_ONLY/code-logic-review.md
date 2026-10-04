# Code Logic Review — MONITOR_BG_ONLY

Verdict: APPROVED (score 8/10). 0 blocking, 0 serious, 2 moderate, 2 minor. Read-only review of the uncommitted diff (3 files).

## Answers to the five checks

### 1. Key correctness (BackgroundAgentStore key vs SubagentRecord.parentToolUseId) — OK
- `isBackgroundAgent(toolCallId)` scans entries by their `toolCallId` field, not the map key (background-agent.store.ts:215-220), so it is correct whether the entry is keyed by the real agentId or by the toolCallId fallback (`resolveKey`, :190-203; `adoptRealAgentId` keeps `toolCallId`, :258-290).
- `SubagentRecord.parentToolUseId` is the `agent_start` event's `toolCallId` (agent-monitor.store.ts:1650); `onBackgroundAgentStarted` keys on `event.toolCallId` (:1688-1695). Same identity space as `BackgroundAgentStore.onStarted` (background-agent.store.ts:326-345, called from accumulator-core.service.ts:591-593).
- The only writer of BackgroundAgentStore entries is the accumulator (grep: `onStarted/onCompleted/onStopped` only at accumulator-core.service.ts:592-601). Live start and mid-run Ctrl+B both reach it, because `backgroundAgent()` (agent-monitor.store.ts:2203-2255) deliberately does not mutate and relies on the `background_agent_started` push. I did not trace the backend emit for Ctrl+B; the code comment at :2194 asserts it.
- History replay and reload: `history-message-builder.service.ts:126` and the tree builders only READ the store. Neither SubagentRecords nor BackgroundAgentStore entries are created from history, so there is no path where a record exists but its background entry is missing. On reload neither exists, as before the change. No regression.
- Ordering gap: `agent_start` can precede `background_agent_started` (the placeholder tool_result path, accumulator-core.service.ts:446-456). The record is hidden until the entry lands, then appears reactively. The new spec covers this (store.spec "backgrounded reactively").

### 2. Lifecycle — OK
- `clearSession` (stream-router.service.ts:948) runs only on tab `close`/`reset`, together with `agentMonitorStore.forceClearSessionAgents(sid)` (:947). Both stores drop the session together, so no still-visible background agent loses its entry.
- `clearCompleted` / `evictOldCompleted` (background-agent.store.ts:420-440, 480-500) only remove non-running entries. A running background agent keeps its entry. If a record were left `running` after its entry was cleared, it would now vanish from the panel instead of sitting stuck-running. That is acceptable.
- Reactivity: `revision()` is bumped only when the map identity changes (:157-175). The extra `revision()` read is redundant, because `isBackgroundAgent` already reads `_agents()` inside the computed, but it is harmless. No loop is possible, since the selector does not write either store. The computed has no custom equality, so it emits a new array on every BG-store mutation. This is the same pattern as before, and the store is bounded at about 50 entries.

### 3. Unchanged surfaces — OK
- Only consumer of both selectors: agent-monitor-panel.component.ts:755-756 (grep over libs/ and apps/). No other users. The panel is embedded by chat-view.component.html:265 and tribunal-panel vendor-card.component.ts:25.
- `sessionSubagents` (panel :767-801), `totalCount` (:831-835), the badge (:231, 285) and the empty state (:596) all derive from the filtered list, so they stay mutually consistent. The new panel spec asserts `totalCount` = CLI + background (panel.spec ~:439-456).
- The explicit-selection preservation (panel :779-799) still works. It only re-adds a selected record that is no longer listed (terminal or non-listed) via `getSubagent`. A foreground subagent can no longer be selected from the panel, so nothing is stuck.
- CLI lane agents (`standaloneAgents`) and workflow groups (`effectiveWorkflowSubagents`) go through different selectors that are untouched. `!workflowRunId` is still enforced (store :794). Permissions are routed through MonitoredAgent/WorkflowPermissionPresenter, which are not touched.

### 4. Foreground still visible and nothing panel-only lost — OK
- Foreground subagents render inline via `inline-agent-bubble` (execution-node / chat-transcript / agent-execution). The bubble carries steer/send-input, stop and "send to background" (inline-agent-bubble.component.ts:934, 1007-1022). Canvas tiles embed the same chat view (chat-view.component.html:265 uses the same panel plus the transcript).
- The panel's SubagentRecord detail has no card, permissions or continue input (panel.component.ts:562-566 comment). Only the usage summary and transcript viewer exist, and the transcript viewer is kept for the background agents that remain listed. The only loss is the panel's transcript/usage view for a foreground subagent, which matches the request.

### 5. Tests — mostly meaningful
- store.spec "excludes foreground subagents and workflow subagents", "excludes foreground status: running/pending/paused" and "includes ... backgrounded reactively" would fail on base (running was included). "excludes a completed record while backgrounded" guards the status gate and passes on base too.
- The panel spec test "counts the background session subagent with the CLI lane, not a foreground subagent" does NOT test the behaviour. The selector is mocked (`activeSessionSubagentsSig`), so it passes on base and its name is misleading (see finding 2).

## Findings

1. MODERATE — dead branch, agent-monitor.store.ts:795-797. `status === 'background'` is never assigned anywhere (only the type union at :445; grep of 'background' finds no writer). Background membership therefore depends entirely on `BackgroundAgentStore`. The `status === 'background'` short-circuit is a latent bypass: any future writer of that status would skip the store check. The tests lean on it (store.spec "includes a record whose status is background", and the scope tests switched to status 'background' because it needs no BG-store seeding), so they exercise a state production never produces. Failure scenario: none today. Suggestion: either drop the status shortcut and seed `BackgroundAgentStore` in the tests, or keep it and note it as a forward-compat guard.

2. MODERATE — test gap, agent-monitor-panel.component.spec.ts ~:439-456. The new test mocks the selector signal, so it cannot detect a regression in foreground filtering. The real coverage is the store spec. Suggestion: rename the test or add an integration-style test with the real store.

3. MINOR — private helper uses `['running','pending','paused','background'].includes(r.status)` (store :795), allocating an array per record per recompute. Trivial, but the previous module-level helper avoided this. Hoist it to a const `Set`.

4. MINOR — transient hide window: a `run_in_background` Task is invisible in the panel between `agent_start` and `background_agent_started`, and also invisible inline? No: it is inline as a foreground bubble during that window. So no information is lost.

Not verified: whether a background SubagentRecord is terminalized when its BackgroundAgentStore entry completes. If not, behaviour is identical to base (a stuck `running` record stays listed while its entry exists). I did not trace `handleSubagentEnded`.

## Verdict
APPROVED. The key identity space is correct on every creation path, lifecycle clears are symmetric across the two stores, consumer surface is limited to the one panel, and no panel-only capability for foreground subagents is lost. Address findings 1-2 as cleanup.
