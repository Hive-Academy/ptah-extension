# A4/B3a code-logic fix round

## Findings

1. **A4: finished summary missing.** Cause: canvas passed only `agentNode().children`, while the node's `summaryContent` was rendered by the removed agent execution wrapper. Fix: pass the summary separately and render it with the existing `ptah-agent-summary` renderer, leaving one execution header and the child tree. Source: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:146`; `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts:79`. Specs: `canvas-lane-view.component.spec.ts:323` and `subagent-lane.component.spec.ts:107` cover visible summary and one header.

2. **B3a: replay leaked global effects.** Cause: six lifecycle cases and `sessionManager.registerAgent` ignored `skipStoreEffects`; registration could drain shared pending deltas. Fix: guard registration, background store calls, and agent monitor lifecycle calls while retaining `agent_start` state event insertion and callback. Source: `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:511,605-626`. Specs: `accumulator-core.service.spec.ts:978-1030` asserts replay retains `agent_start`, never registers or drains pending deltas, and touches none of the listed stores.

3. **A4: contradictory empty state.** Cause: the lane's `@empty` branch rendered even when canvas showed the saved transcript. Fix: suppress lane empty text whenever the canvas has no live node and shows its own fallback; summary content also suppresses empty text. Source: `canvas-lane-view.component.ts:147`; `subagent-lane.component.ts:86-89`. Specs: `canvas-lane-view.component.spec.ts:370` and `subagent-lane.component.spec.ts:117` cover completed agents with fallback.

4. **A4: steer keyboard behavior.** Cause: the toggle lacked a control link and focus management. Fix: add `aria-controls`, focus the input after it renders, close on Escape, stop Escape from closing the canvas lane, and restore focus to the toggle. Source: `subagent-lane.component.ts:47-51,69-72,139-152`. Spec: `subagent-lane.component.spec.ts:183` covers the linked target and both focus moves.

5. **A4: duplicate Stop/Background requests.** Cause: the lane called tray methods that discard the monitor's promises, so it could not track in-flight actions. Fix: call the existing monitor methods with the tray context's owning session and IDs, guard with per-action pending signals, and disable each button until settlement. Source: `subagent-lane.component.ts:34-44,154-171`. Spec: `subagent-lane.component.spec.ts:124` holds both promises and checks disabled state and one call per action.

## Decisions

- Render the node summary through `AgentSummaryComponent` as a separate lane input. Alternative: pass the whole agent node through `ptah-execution-node`, which would restore the duplicate agent chrome. Evidence: plan component 4 calls for child nodes with one shared header; `agent-execution.component.ts` uses the summary renderer. Reversible: yes.
- Use the monitor's Stop and Background promises directly in the lane. Alternative: change `SessionAgentTrayService` to return promises, which is outside this batch's file ownership. Evidence: tray methods return `void` and discard the monitor promises. Reversible: yes.
- Keep the saved-transcript fallback while Phase A is active and suppress the lane's empty text when it is displayed. Evidence: plan component 4 retains fallback until B5. Reversible: yes.

## Verification and scope

- No test, typecheck, lint, build, serve, or e2e command was run, per lane brief. `git diff --check` passed.
- Scoped `ptah_get_diagnostics` initially found new typing issues in the replay event fixtures and steer focus query; those were corrected. The subsequent scoped result reported 394 errors, including three pre-existing mock typing errors in `accumulator-core.service.spec.ts:351,364,372` and unrelated sibling errors. The last diagnostics call after the final focus correction was unavailable because its TypeScript check exceeded 45 seconds; this is not a passing diagnostics result.
- Only these six owned source/spec files were changed: `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.ts`, `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts`, `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.ts`, `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.spec.ts`, `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts`, `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\accumulator-core.service.spec.ts`.
- Parallel backend/shared edits visible in the working tree were left untouched. No git mutation was made.
