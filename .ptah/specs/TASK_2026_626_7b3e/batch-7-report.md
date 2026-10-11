# Batch 7 report: routing and aggregation (chat), TASK_2026_626_7b3e

Executor: frontend-developer (sub-agent). No git commands were run, and the code is not committed.
Heavy checks (jest, typecheck, lint) were not run, as instructed. The team-leader runs the Batch 7
verification commands.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat/src/lib/services/chat.store.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts`

No files were created. Nothing under `libs/backend/**`, `chat-state` or `shared` was touched.

## Task 7.1: ChatMessageHandler route (COMPLETE)

- `MESSAGE_TYPES.SESSION_STATS_LIVE` is in `handledMessageTypes`, directly after `SESSION_STATS`.
  `handleMessage` has a `case` for it that calls the new `handleSessionStatsLive(payload)`.
- `handleSessionStatsLive` runs `parseSessionStatsLivePayload`. When the parser returns `null`, the
  handler logs one `console.warn('[ChatMessageHandler] session:stats-live payload rejected — dropped', { sessionId })`
  and returns. That warning carries only the payload's `sessionId`: the string value if there is one,
  otherwise `undefined`. It never includes snapshot figures or the payload's shape. When the parser
  succeeds, the handler calls `chatStore.handleSessionStatsLive(parsed)`.
- Header comment list: added the `SESSION_STATS_LIVE` line. The `SESSION_STATS` routing and
  `handleSessionStats` are unchanged.
- Spec (`describe('session:stats-live')`):
  - the type is handled;
  - a provisional payload with its context is forwarded to `handleSessionStatsLive` only, and
    `handleSessionStats` is not called;
  - an authoritative payload with a stray `context` reaches the store with no `context` key. This pins
    the parser strip that the plan (:944-946) asks for;
  - `it.each` drops a non-object payload, a missing snapshot, `provisional: false` and a missing
    revision. Each case asserts no store call and exactly one warning with `{ sessionId }`;
  - `session:stats` routing is unchanged.

## Task 7.2: ChatStore facade (COMPLETE)

`ChatStore.handleSessionStatsLive(event: SessionStatsLiveWire)` delegates only to
`statsAggregator.handleLiveSessionStats(event)`. It follows the facade pattern at `chat.store.ts:532-534`.
`SessionStatsLiveWire` is imported as a type from `@ptah-extension/shared`.

## Task 7.3: `SessionStatsAggregatorService.handleLiveSessionStats` (COMPLETE)

- Tab resolution: extracted `private tabsForSession(sessionId)`, which does the active-workspace
  `findTabsBySessionId` and then the `findTabBySessionIdAcrossWorkspaces` fallback. `handleSessionStats`
  now uses the same method, so the two paths cannot drift apart. `handleSessionStats` behaves exactly
  as before: it still calls `SessionId.from`, and all existing assertions, including the background
  workspace case, still hold.
- Validation: `snapshotFor` now takes `{ sessionId, sessionStats? }` and a handler label, so the live
  path's warnings name `handleLiveSessionStats`. The existing `handleSessionStats` warning strings are
  byte-identical.
- No tab: the update goes to `surfaceStats.record(sessionId, { live: null, snapshot })`, and only when
  `streamRouter.surfacesForSession` is non-empty. An unknown session is dropped with no warning.
- With tabs: calls `tabManager.installLiveSessionStats(tab.id, snapshot, event.context)` once per tab.
  Admission and the context gate happen in that single call.
- The method never calls `handoverClient.record`, `clearCompactionState`,
  `streamingHandler.handleSessionStats`, `loadSessions`, `sendQueuedMessage`, `setLiveModelStats` or
  `deriveLiveModelStats`.
- Spec: new top-level describe `session:stats-live (TASK_2026_626)` that uses the real
  `TabManagerService`, `TabWorkspacePartitionService`, `ConversationRegistry`, `TabSessionBinding` and
  `SurfaceSessionStatsRegistry`. This is the same harness shape as
  `closed-tab-session-ender.service.spec.ts:307-333`. The streaming handler, loader, compaction,
  dispatch and handover client are spies. Each tab starts with a same-model 40 000-token fill. Cases,
  mapped to plan :921-956:
  - the live install updates `sessionStats` and the fill (90 000);
  - "never calls" `it.each`: {provisional, authoritative} × {streaming tab, finalized tab with queued
    content}. The streaming-handler spy returns queued content, so a wrong call would also trigger a
    send. All six result-path spies are asserted uncalled, and status, queue and messages are unchanged;
  - out of order: `session:stats` r10, then live r8 with context 90 000. `sessionStats` and
    `liveModelStats` keep the same references;
  - settle: provisional r5, then authoritative live r6 with no `session:stats`. The tab shows r6 with no
    `provisional`;
  - a later `session:stats` replaces a live snapshot;
  - both arrival orders at r6, after provisional r5 with fill 90 000. In (a), `session:stats` then the
    settle gives r6, no `provisional` and fill 60 000. In (b), the settle then `session:stats` gives the
    same result. A third case sends a stray context of 90 000 on authoritative r6 after `session:stats`,
    and the fill stays 60 000;
  - Stop on an open tab: provisional r5 shows the marker, then authoritative r6 with no `session:stats`,
    no turn state and no resume read. The tab still exists, `status` stays `'streaming'`, `messages` and
    `streamingState` are unchanged, and no result-path spy fires;
  - background-workspace resolution (cross-workspace lookup, then `installLiveSessionStats('bg-tab', snapshot, context)`);
  - a snapshot that names another session, and a malformed snapshot: each gets one warning with only the
    session and leaves the tab unchanged;
  - surface path: the snapshot is recorded and the stored `live` reading is kept even though the payload
    had a context. A lower-revision live update after an authoritative one changes nothing. An unrouted
    session records nothing and logs no warning.

## Risks and edge cases from the plan validation

| Risk or edge case | How this batch handles it |
| --- | --- |
| A live estimate arrives after the authoritative snapshot and overwrites figures or context (HIGH) | Every tab write goes through `installLiveSessionStats` (revision floor and context gate together). The surface path passes `live: null`, so only the registry floor applies. Pinned by the out-of-order, both-arrival-orders and stray-context specs. |
| The live path triggers result-path side effects (HIGH) | The method has no call to any of the six collaborators. Pinned by spies for provisional and authoritative payloads on streaming and finalized-with-queue tabs, and in the order, Stop and surface cases. |
| Stop strands an estimate (HIGH, frontend half) | The release-settle (authoritative r6) clears `provisional` on an open tab without changing tab status. Pinned by the Stop spec. |
| Live payload for an unknown session during teardown | Silent drop, with no warning and no record (spec). |
| Malformed payload | The parser returns `null` and the handler logs one warning naming only the session (handler spec). A malformed or foreign snapshot that passes the envelope check gets one aggregator warning naming only the session (aggregator spec). |
| A live `sessionId` that is not a UUID | Edge case I added. `handleSessionStats` throws through `SessionId.from`. The live path uses `SessionId.safeParse` and logs one warning and drops the update, so a bad live payload cannot throw out of `handleMessage`. |
| Model mismatch, no prior reading, or `contextTokens: 0` | Handled by Batch 6 `installLiveSessionStats`. The aggregator passes `event.context` through unchanged. |
| Background-subagent spend after a result | No status gating anywhere on the live path. The revision floor is the only gate (Stop and finalized-tab specs). |
| Parallel tracks exhausting RAM | No jest, typecheck or lint was run. |

## Verification

- `mcp__ptah__ptah_get_diagnostics` scoped to the five files: no errors in any line this batch added
  or changed. It still reports 4 errors in `session-stats-aggregator.service.spec.ts` at lines 148,
  175, 290 and 500. All four are in pre-existing tests that this batch did not touch, as `git diff -U0`
  hunk headers confirm (added hunks are only at :16-18, the import block and :1114-1590). They are
  `TurnModelUsage` and `TabId` literal typings that the diagnostics tool's tsconfig flags.
- `npx prettier --write` was run on the five files. It also reformatted four unrelated pre-existing
  lines (in `chat.store.ts:419`, `chat-message-handler.service.ts:564-565` and `:582`, and the
  `StreamFlushScheduler` `useValue` in the handler spec). Those lines were reverted by hand, so the
  diff contains only Batch 7 changes.
- Not run, by instruction (team-leader runs these):
  `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts --coverage=false --maxWorkers=2`,
  `npx nx typecheck @ptah-extension/chat --parallel=1`, `npx nx lint @ptah-extension/chat --parallel=1`.

## Plan deviations

- Small refactor: `tabsForSession` was extracted so both handlers share one resolution path, which the
  plan requires as "exactly as `handleSessionStats`". `snapshotFor` gained a handler-label parameter.
  The public behaviour of `handleSessionStats` is unchanged.
- The aggregator validates the snapshot before resolving tabs, so a malformed snapshot is rejected with
  a warning even for an unknown session. An unknown session with a valid snapshot is still silent.

## Out-of-scope observations

- The pre-existing spec type errors above (aggregator spec :148/:175/:290/:500 and several sibling
  chat specs) come from the diagnostics tool's tsconfig. If `nx typecheck @ptah-extension/chat`
  includes specs, they predate this batch.
