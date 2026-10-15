# B8a lane tabs and lane view report

## Files changed

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts` and `.spec.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` and `.spec.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-panel.component.ts` and `.spec.ts`
- `.ptah/specs/TASK_2026_629_c0b3/lane-B8a-report.md`

## A5 and A6

- A5: `BackgroundAgentStore` has no session-scoped public signal. Its `agents` computed is at `libs/frontend/chat-streaming/src/lib/background-agent.store.ts:100`; `agentsForSession` at `:307` uses tolerant visibility. Tabs and view filter `agents()` by exact `entry.sessionId === sessionId`. CLI and subagent records use exact `parentSessionId === sessionId`.
- A6: `AgentCardComponent` gates output on `agent().expanded` at `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:67`. Public `AgentMonitorStore.toggleAgentExpanded` is at `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1517`. The view calls it only for a selected collapsed CLI agent and does not collapse on close.

## Decisions

Groups render Orchestrator, Sub-agents, CLI lanes, Background; empty groups are hidden. Terminal records remain while stores retain them. Missing keys fall back to Orchestrator. The tablist uses roving focus and Left/Right/Home/End navigation. The view has one switch keyed by lane, destroying a previous CLI card on switch. CLI uses the shared `AgentCardComponent` unchanged. Subagent uses the shared usage summary and transcript viewer. Stop passes the task ID and owning session ID. CLI Allow/Deny uses `AgentPermissionResponder.respondLane`. Background uses the shared strip for standalone records. The panel passes its tab's `claudeSessionId`.

## Checks

- Focused canvas specs with the prescribed `npx nx test @ptah-extension/canvas --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: tabs 3/3, view 3/3, panel 1/1 passed.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed, with an existing NG8107 warning in chat.
- `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed, 0 errors and 12 warnings, including test fixture `any` warnings.
- `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed, with the existing NG8107 warning.
- `rg -n 'selector:.*ptah-agent-card' libs/frontend/canvas/src`: no matches.
- Prettier ran only on changed TypeScript files.

## Open items

- Subagent session `PermissionRequest` entries are not rendered. Only CLI `AgentPermissionRequest` entries are handled; `respondLane` does not take a tab ID. Full subagent Allow/Deny via `respondSession(request, decision, tabId)` remains open for AC5.6.
- Standalone background entries are presented read-only in the strip; Stop and transcript actions are not connected.
- The final view spec reran after replacing a test stub with the shared card override. Final canvas typecheck and lint ran immediately before that test-only change.
