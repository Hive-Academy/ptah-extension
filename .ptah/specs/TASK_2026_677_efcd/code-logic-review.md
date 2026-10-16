# Code-logic review - phase clean-session-view (codex)

Score: 5/10  
Verdict: REVISE  
Review family: reviewer codex; implementers Claude, grok (C-3), orchestrator fixes  
Scope: 35c80dfa0..833914b34, excluding B-5

The score is above 3-4 because the inspected paths have real session ownership checks, tab-close pruning, and shared observer/timer cleanup. It is below 7-8 because failed agent actions can look successful and a task response can be displayed for the wrong workspace. No source was edited and no build or test was run.

## Findings

### Serious

1. **A failed Steer closes the input as if the message was sent.** `libs/frontend/chat/src/lib/services/session-agents/session-agent-tray.service.ts:83-85` awaits `sendMessageToAgent` but discards its `Promise<boolean>` result (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:2447-2451`). `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:376-384` then closes the steer input on any resolved promise. When the RPC returns `false` (for example, the session has gone away or the host rejects the send), the user's text disappears, the input closes, and no failure is announced by this surface. Return the boolean from the tray service; close only on `true`, and keep the text with a visible retry state on `false` or rejection.

2. **The Orchestrator says `idle` while background agents are still running.** `libs/frontend/chat/src/lib/services/session-inspector/session-inspector.store.ts:91-100` permits `waiting on N agents` only for `streaming` or `resuming`; `awaiting-background` is excluded by the set at `:30-33`. A session that has yielded to background agents therefore reports `idle` even when `liveAgents > 0` (`:234-239`). The same status maps to `done` in `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-status.ts:100-104`. Treat `awaiting-background` as waiting when agents remain active; keep the status mapping consistent with the actual running state.

### Moderate

3. **A task read can be accepted after a workspace change.** `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-task-reader.ts:60-69` treats workspace root as part of the link, so changing it triggers a new read. The result cache and stale response guard compare only `taskId` (`:101-105`, `:139-148`, `:261-264`). If a tab changes to another workspace containing the same task ID (for example, a copied repository), the old workspace's task details remain visible under the new link; `openDocument` then combines the new root with the old task's folder (`:209-215`). Key the held result and in-flight guard by normalized workspace root plus task ID, or by a request generation.

4. **Answer navigation cannot reach an unmounted question card.** `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1015-1027` searches the current DOM once and once more after a fixed one-second timeout. The transcript deliberately unmounts scrolled-away bubbles (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:36-45`), so an older pending question can exist in session state while its card is absent from the DOM. Clicking its inspector Answer row only shows a miss after one second; it never scrolls/mounts the message. Resolve the request to its message, scroll it into the render window, and focus after mount; retain the explicit miss state when no matching message exists.

## Style pass (new public API)

- **Moderate — registration type does not enforce its documented input.** `libs/frontend/chat/src/lib/tokens/session-workflow-addons.token.ts:20-25` documents a required `tabId` signal input, but exposes `component: Type<unknown>`. A caller can register an arbitrary component through the public `SESSION_WORKFLOW_ADDONS` export (`libs/frontend/chat/src/index.ts:56-62`), with no type check for the required input. A mistaken registration reaches the outlet and receives an input it cannot consume. Give the component contract an explicit typed interface or validate registrations at the outlet boundary. This is a public API precision finding, not a formatting issue.

## Five logic questions

1. **Silent success:** a `false` Steer result is treated as success and closes the input (finding 1).
2. **Unexpected user action:** Answer on an older, unmounted question does not navigate to it (finding 4).
3. **Wrong answer from input data:** identical task IDs in different workspace roots can display the first workspace's task under the second (finding 3).
4. **Dependency failure or bad shape:** `sendMessageToAgent` can resolve `false` or reject; the inspector Steer path lacks a failure state (finding 1). Scoped diagnostics were unavailable because the TypeScript service remained busy after two calls.
5. **Missing requirement case:** a session yielding to background agents needs an explicit Orchestrator state; the current state logic falls through to `idle` (finding 2).

## Checked and clean

- `SESSION_EMBED_CHROME = 'bare'` gates both the header and inspector via `hostsInspector` (`libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1097-1106`; template `:26-40`, `:271-302`).
- `SessionInspectorStore` removes per-tab computed entries on tab close and on destroy (`libs/frontend/chat/src/lib/services/session-inspector/session-inspector.store.ts:150-172`).
- The shell has one `ResizeObserver` and disconnects it on destroy (`libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.ts:170-178`, `:194-213`); the canvas dock likewise disconnects its observer and clears its card timer (`libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:285-294`, `:424-428`).
- The turn-chip key uses `node.toolCallId` with both `sub:` and `bg:` variants (`libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-contexts.ts:123-136`), matching the parsed key used by `openSubagentLane` (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:937-958`).
- Status switches in `agent-status.ts:18-113` are exhaustive at the TypeScript level; `paused` maps to `queued` at `:47-49`. I found no changed tool-row rendering path in the inspected transcript hunks.
- The D-1 diff does not edit strip spec files. The R2 renamed spec's case-count parity and the full 102-file phase surface were not independently verified here. Batch reports describe checks as deferred; no test result was treated as evidence for these failure paths.

## Decisions

- Treat `awaiting-background` plus live agents as a waiting state. The alternatives were `idle` or `waiting`; the status name, live-agent count, and the requested `waiting on N agents` state support waiting. This is reversible in the state mapping.
