# Code Logic Review — `TASK_2026_575_74a4`

## Summary

| Metric              | Value       |
| ------------------- | ----------- |
| Overall score       | 9/10        |
| Assessment          | APPROVED    |
| Blocking issues     | 0           |
| Serious issues      | 0           |
| Moderate issues     | 0           |
| Failure modes found | 0           |

## Five logic questions

### 1. How does this fail silently?

- **Unknown turn cost (`turnCost: null`)**:
  - In [streaming-handler.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L564-L568) and [streaming-handler.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L656-L661), `stats.turnCost` (`null`) is written to `pendingStats.cost` or `messages[lastAssistantIndex].cost`.
  - In [cost-badge.component.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts#L64-L69), `knownCost` evaluates `typeof cost === 'number' && Number.isFinite(cost)` to `null`. The template renders `<span data-testid="cost-unavailable">cost unavailable</span>` (lines 37-45). This is explicitly displayed to the user as unavailable rather than silently showing `$0.00` or carrying over an older turn/session value.
- **Session without a bound tab**:
  - In [session-stats-aggregator.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L143-L152), if `targetTabs.length === 0` (e.g., workflow surface session), `recordSurfaceStats` installs the header stats in `SurfaceSessionStatsRegistry` and early-returns without calling `streamingHandler.handleSessionStats`. If the session is also not in `StreamRouter`, it logs a warning (`dropping event`, lines 208-213).
- **Tab with no assistant messages on post-finalization merge**:
  - In [streaming-handler.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L645-L653), if `mergeStatsOntoLastAssistant` is called on a tab without an assistant message (`messages = [user]`), `lastAssistantIndex` remains `-1` and the function returns early without error.

### 2. What user action produces unexpected behaviour?

- **User submits a new prompt before turn stats arrive**:
  - If the previous turn finalized, the tab has `messages = [user1, assistant1, user2]` and `streamingState === null`. In [streaming-handler.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L645-L652), `mergeStatsOntoLastAssistant` scans backward from `messages.length - 1` and stops at the first message with `role === 'assistant'`. It correctly targets `assistant1` and does not attach the cost to `user2`.
- **User switches workspaces during a streaming turn**:
  - Handled cleanly. [session-stats-aggregator.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L124-L128) and [streaming-handler.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L557-L576) use `findTabBySessionIdAcrossWorkspaces(stats.sessionId)`. The partitioned background tab is found and its `bgState.pendingStats` (or message cost if finalized) is updated.

### 3. What input data produces a wrong answer?

- **Legitimately free turn (`turnCost: 0`)**:
  - In [session-stats-aggregator.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L68-L76), `isSnapshotOnly` tests `stats.turnCost === undefined`. Because `0 !== undefined`, it is recognized as a result event.
  - In [cost-badge.component.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts#L64-L69), `Number.isFinite(0)` is true, wrapping it in `{ value: 0 }`, and formats as `$0.00` rather than falling into the "cost unavailable" branch.
- **Snapshot-only event (`turnCost: undefined`)**:
  - `isSnapshotOnly` returns `true`. In [session-stats-aggregator.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L130-L139), it installs the snapshot on the tab/surface and returns immediately, never calling `streamingHandler.handleSessionStats` and never touching message costs.
- **Non-finite/NaN/negative cost**:
  - Validated and rejected upstream in `stream-transformer.ts` (`validateStats`). If corrupted in-memory, `Number.isFinite(cost)` in `CostBadgeComponent` guards the display, falling back to "cost unavailable".

### 4. What happens when a dependency fails?

- **Shared wire contract drift**:
  - `SessionStatsResultEvent` in [session-stats-aggregator.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L38-L45) is defined directly from `ResultStatsPayload` (`Omit<ResultStatsPayload, 'sessionId' | 'modelUsage'> & { readonly sessionId: string; readonly modelUsage?: TurnModelUsage[]; }`).
  - `SessionStatsFooter` in [streaming-handler.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L48-L52) is defined as `Pick<ResultStatsPayload, 'turnCost' | 'tokens' | 'duration'> & { readonly sessionId: string }`.
  - Any future rename or type change on `ResultStatsPayload` causes an immediate compilation failure in both frontend services.
- **`sessionLoader.loadSessions()` failure**:
  - In [session-stats-aggregator.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L181-L183), the promise rejection is caught and logged (`console.warn`) without aborting tab stats or dispatch.

### 5. What is missing that the requirements never mentioned?

- **Multi-message turns (tool use cycles with multiple assistant bubbles)**:
  - In [message-finalization.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/message-finalization.service.ts#L215-L239), only the last newly finalized assistant message (`isLast`) is decorated with `cost`, `tokens`, and `duration`. Intermediate assistant messages omit `cost`. If stats arrive after finalization, `mergeStatsOntoLastAssistant` in [streaming-handler.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L645-L663) only updates the last assistant message. Turn cost is never doubled or distributed across multiple assistant bubbles.
- **Subagent spend accounting**:
  - `turnCost` on `ResultStatsPayload` includes Task-subagent costs for the turn, while `tokens` reflects main-loop usage. The frontend does not recompute or reprice tokens locally, preserving exact equality between message-cost sums and the backend snapshot total.

## Failure modes

None found in the reviewed scope.

- **Scope reviewed**: Full `git diff HEAD -- libs/frontend/chat libs/frontend/chat-streaming`, plus full call paths through `session-stats-aggregator.service.ts`, `streaming-handler.service.ts`, `message-finalization.service.ts`, `chat-transcript.component.ts`, `history-message-builder.service.ts`, and `cost-badge.component.ts`.
- **Evidence verified**: Scoped unit tests (`npx jest -c libs/frontend/chat-streaming/jest.config.ts -t "TASK_2026_575"` and `npx jest -c libs/frontend/chat/jest.config.ts -t "TASK_2026_575"`), language server diagnostics (`ptah_get_diagnostics`), and `npx nx run-many -t typecheck,lint -p @ptah-extension/chat,@ptah-extension/chat-streaming` all pass with 0 errors.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### Minor 1: Pre-existing activeTab fallback in `handleSessionStats`
- File: [streaming-handler.service.ts:580-596](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L580-L596)
- Scenario: If `stats.sessionId` matches neither active workspace tabs nor background workspace tabs, lines 591-595 fall back to `primaryTab = activeTab` if `activeTab.status === 'streaming' || activeTab.status === 'loaded'`.
- Mitigation: In practice, [session-stats-aggregator.service.ts:143-152](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L143-L152) checks `targetTabs.length === 0` first and delegates to `recordSurfaceStats`, early-returning before `streamingHandler.handleSessionStats` is invoked. Thus, unmapped session stats never reach this fallback branch in production.

## Data flow

1. **Wire Event Arrives**: IPC event `session:stats` delivers `SessionStatsEvent` to [session-stats-aggregator.service.ts:112](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L112). [OK]
2. **Tab Resolution**: `findTabsBySessionId` searches active workspace; fallback to `findTabBySessionIdAcrossWorkspaces` for background workspace tabs. [OK]
3. **Snapshot-Only Check**: `isSnapshotOnly(stats)` checks if `turnCost`, `tokens`, and `duration` are `undefined`. If so, installs header snapshot via `installSessionStats` / `recordSurfaceStats` and returns early. Message costs are untouched. [OK]
4. **Header Snapshot Installation**: If `stats.sessionStats` is present, `tabManager.installSessionStats(t.id, snapshot)` installs backend snapshot directly. The webview never sums message costs. [OK]
5. **Context Gauge Derivation**: `deriveLiveModelStats` updates `liveModelStats` from `stats.modelUsage`. [OK]
6. **Footer Forwarding**: `streamingHandler.handleSessionStats(stats)` receives `stats: SessionStatsFooter`. [OK]
   - *If tab is still streaming*: Stashes `{ cost: stats.turnCost, tokens: stats.tokens, duration: stats.duration }` onto `state.pendingStats` (lines 564, 618).
   - *If tab is already finalized*: Calls `mergeStatsOntoLastAssistant(tab, stats)`, setting `cost: stats.turnCost` on the last assistant message (line 659).
7. **Streaming Transcript Display**: [chat-transcript.component.ts:378-382](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts#L378-L382) applies `pendingStats.cost` to active streaming tree node. [OK]
8. **Finalization Consumption**: [message-finalization.service.ts:160-171](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/message-finalization.service.ts#L160-L171) consumes `pendingStats.cost` onto the final message bubble of the turn. [OK]
9. **UI Badge Rendering**: [cost-badge.component.ts:64-69](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts#L64-L69) formats `0` as `$0.00`, positive numbers with 2 or 4 decimal places, and `null`/`undefined` as "cost unavailable". [OK]

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Derive `SessionStatsResultEvent` from `ResultStatsPayload` | COMPLETE | None. Defined using `Omit<ResultStatsPayload, 'sessionId' \| 'modelUsage'> & { readonly sessionId: string; readonly modelUsage?: TurnModelUsage[]; }`. |
| `SessionStatsSnapshotEvent` has `turnCost?: undefined` | COMPLETE | None. [session-stats-aggregator.service.ts:51-58](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L51-L58). |
| `isSnapshotOnly` checks `turnCost` | COMPLETE | None. [session-stats-aggregator.service.ts:68-76](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L68-L76). |
| `StreamingHandlerService` writes `turnCost` to `pendingStats.cost` | COMPLETE | None. Both bound tabs and background tabs write `stats.turnCost` to `pendingStats.cost`. |
| `StreamingHandlerService` writes `turnCost` to last assistant message | COMPLETE | None. [streaming-handler.service.ts:659](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L659). |
| Webview never sums message cost into header (TASK_2026_533) | COMPLETE | None. Grep confirmed 0 sums of message costs in `libs/frontend`; header reads directly from `tab.sessionStats`. |
| `turnCost: null` renders as "cost unavailable", never `$0.00` | COMPLETE | None. Pinned by unit test in aggregator spec mounting `CostBadgeComponent`. |
| Regression tests pin behaviour and are not tautological | COMPLETE | None. 7 new tests across both specs verify per-turn costs, pendingStats, null cost handling, and snapshot-only isolation. |

Implicit requirements not addressed: None.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| `turnCost: 0` (free turn) | YES | `0 !== undefined` in `isSnapshotOnly`; `Number.isFinite(0)` formats `$0.00` | None |
| `turnCost: null` (unpriced model) | YES | Flows as `null` through pending stats and message; renders "cost unavailable" | None |
| Snapshot-only event | YES | `isSnapshotOnly` returns true; installs header without calling streaming handler | None |
| Background workspace tab | YES | `findTabBySessionIdAcrossWorkspaces` routes stats to background tab | None |
| Turn with multiple assistant messages | YES | `message-finalization.service.ts` and `mergeStatsOntoLastAssistant` update only the last assistant message | None |
| Result arrives after user message sent | YES | `mergeStatsOntoLastAssistant` iterates backward to find the last assistant message | None |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: An out-of-order `session:stats` arrival after a subsequent turn starts streaming could overwrite `pendingStats` if the backend violated turn sequencing (prevented by backend `turn_state` barrier).
- What a robust implementation would add: The current implementation completely fulfills all contracts and requirements for Batch 3. A potential future hardening item would be scoping `pendingStats` with a turn revision or turn identifier to make race conditions between successive turns structurally impossible.
