# Batch 47a executor report: background subagent transcript ("Transcript is not available yet")

Scope: the primary frontend fix from `bug-subagent-transcript-research.md` (§ Minimal fix "Primary"), plus the pending-identity case. No backend change. No git operations.

## Files changed

- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`
  - New `onBackgroundAgentStarted(event: BackgroundAgentStartedEvent)`. It fills `agentId`, `teammateName` and `parentSessionId` (through `knownSessionId(event.sessionId)`) on `_subagents[event.toolCallId]`, but only fields the record does not have yet (`existing.x ?? event.x`). It never creates a record and never touches `status`. When nothing changes, the signal is not written.
  - Event before the record (`background_agent_started` arrives before `agent_start`): the identity goes into a private `_pendingBackgroundIdentity` map. The four lifecycle reducers (`onAgentStart`, `onAgentProgress`, `onAgentStatus`, `onAgentCompleted`) now store `this.withPendingIdentity(key, merged)`. That fills any missing fields from the pending entry and removes the entry. The map is cleared in `ngOnDestroy`, the same as `_subagentRequestUsage`.
  - New module-local `BackgroundIdentity` type and `fillIdentity()` helper (fill-only; returns the same reference when nothing is filled).
- MODIFIED `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts`: the `background_agent_started` case now calls `agentMonitorStore.onBackgroundAgentStarted(event)` right after `backgroundAgentStore.onStarted(event)`.
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts`
  - New `selectedTranscriptSessionId` computed. It uses `parentSessionId`, then the panel's `sessionId()` input, then `tabManager.activeTabSessionId()`, each passed through `knownSessionId`.
  - The template gate (formerly `sub.agentId && sub.parentSessionId`), the loader effect key and `loadTranscriptFor(sub, sessionId)` / `reloadTranscript()` now use that resolved session id.
- MODIFIED specs:
  - `agent-monitor.store.spec.ts`: new `describe('onBackgroundAgentStarted (identity merge)')` with 5 tests:
    - merge onto an existing record with `status` unchanged;
    - fills a missing `parentSessionId`;
    - never overwrites existing fields;
    - does not create a record;
    - an identity that arrived before `agent_start` is applied when the record is created.
  - `accumulator-core.service.spec.ts`: the mock gains `onBackgroundAgentStarted`, and a new test checks the forward.
  - `agent-monitor-panel.component.spec.ts`: 2 new tests.
    - A record with `agentId: 'a1b2c3'` and `parentSessionId: 'sess_bg'` renders `ptah-subagent-transcript-viewer` rather than the "not available" text. `getSubagentTranscript('sess_bg', 'a1b2c3')` is called exactly once.
    - With no `parentSessionId` and an active tab session, the panel falls back and calls `getSubagentTranscript('sess_active', 'd4e5f6')` once.
  - `execution-tree-builder.service.spec.ts`, `history-message-builder.service.spec.ts`: their hand-rolled `AgentMonitorStore` mocks gain `onBackgroundAgentStarted: jest.fn()`, needed because the core now calls it.

Batch 46/47 code in these files is unchanged. The only edits are the additions above and the replacement of `next.set(key, merged)` in the four reducers.

## Checks

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/chat-routing ptah-extension-webview`: "Successfully ran targets typecheck, lint for 4 projects". Re-run for chat-streaming after the spec-mock fix with `--skip-nx-cache`: success.
- `npx nx run-many -t test -p <same 4> --maxWorkers=2`:
  - First run: chat-streaming had 2 failures (`onBackgroundAgentStarted is not a function` in two spec mocks); chat, chat-routing and webview passed.
  - After the mock fix, EXIT=0: "Successfully ran target test for 4 projects".
- `npx nx run degradation-audit:lint`: EXIT=0. Its report lists `accumulator-core.service.ts:196` and `agent-monitor-panel.component.ts:1183` (`catch-return-sentinel`). Both are existing catches; the panel one is the unchanged `loadTranscriptFor` catch on shifted lines. No new findings from this batch.

## Deviations

- Panel session fallback: the plan asked for "active tab session id". I resolve `parentSessionId`, then the panel's own `sessionId()` input, then the active tab. In a canvas tile the tile's session is the right owner, and this matches the visibility fallback already in `sessionSubagents` (`:781-791`). Without a `sessionId` input it behaves exactly as asked.
- The pending-before-record case was small and in the same store, so I implemented it rather than reporting it.

## Not covered (as the research notes)

- Foreground subagents with no `background_agent_started` event still have no `agentId`. That needs the optional backend fix in `subagent-hook-handler.ts`.
- Steer and stop RPCs for these agents still depend on the backend registry.
- A pending identity whose record is never created stays in the map until the store is destroyed. It is bounded by the number of background agents, like `_subagentRequestUsage`.
