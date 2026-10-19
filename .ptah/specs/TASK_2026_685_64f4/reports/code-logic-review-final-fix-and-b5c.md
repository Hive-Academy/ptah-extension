# Code Logic Review - TASK_2026_685_64f4, final fix round (cb2a26f16) and B5c (e12dcc246)

Scope: read-only static review. Nothing was run (no tests, typecheck, lint or build), per instruction.
Files read in full or in the relevant regions: subagent-execution.store.ts, history-message-builder.service.ts (accumulate),
subagent-lane.component.ts, inline-agent-bubble.component.ts (retain, history, template reads), subagent-tile.component.ts,
transcript-agent-facts.ts, chat-transcript.component.ts and transcript-ptah-ui-host-sources.ts (revision reads),
agent-monitor-panel.component.ts (B5c diff), subagent-execution-retention.ts.

## Verdict: NEEDS_REVISION (no Blocking; 2 Major; 5 Minor)

## Prior findings, verified

| Finding                                   | Status                                                                                                              | Evidence                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 history replay drops parent after Task | FIXED                                                                                                               | history-message-builder.service.ts:140-146 exempts `agent_start`. A nested `agent_start` carries the child message id, which is already in `subagentMessageIds` from the child's `message_start`, so it still routes to scratch. This is consistent with live `claim()` (store.ts:213-222). |
| N1 retain without session / Load button   | FIXED for the lane and the panel. Bubble fallback has a residual (m3).                                              | store.ts `retain(key, sessionId)` and `ensureHistory` surface a visible error when no session.                                                                                                                                                                                              |
| N2 clipped/truncated accumulation         | FIXED                                                                                                               | store.ts:577-578 assigns instead of accumulating.                                                                                                                                                                                                                                           |
| N3 late event after terminal              | FIXED, with a cost caveat (m4)                                                                                      | store.ts:266-269                                                                                                                                                                                                                                                                            |
| M1 lane retain churn                      | PARTLY. The lane's `untracked` is right, but `retain` itself does a tracked signal read (see Major 2).              |                                                                                                                                                                                                                                                                                             |
| M2 session pinning                        | See m3.                                                                                                             |                                                                                                                                                                                                                                                                                             |
| M3 bubble history states                  | NOT EFFECTIVE at runtime (see Major 1).                                                                             |                                                                                                                                                                                                                                                                                             |
| M4 nested agents under background agents  | FIXED. transcript-agent-facts.ts:109 walks `spawnToolCallIds` and no longer skips turns with zero foreground nodes. |                                                                                                                                                                                                                                                                                             |
| M5 per-key revisions                      | WORKS, with the caveats below.                                                                                      |                                                                                                                                                                                                                                                                                             |

## Store API check: revisionFor / entryFor

- Signal created inside a computed read (store.ts:154-161): acceptable. `signal()` creation is not a write, and `Map.set` on a plain Map is not reactive. There is no write during a reactive read.
- `publish()` bumps the per-key signal only if one exists (store.ts:146-149). A consumer that subscribes before the entry exists reads 0, then `open()` publishes and bumps, so no missed update. A consumer that subscribes later sees the current entry. Correct.
- `remove()` bumps the key (store.ts:471), so tile, lane and facts consumers recompute to `[]` on eviction or `clearSession`. No stale consumer found.
- Leak: `keyRevisions` is never pruned (m1). It grows by one signal per distinct key ever read, including `''` from the bubble (`?? ''`). Small, but unbounded over a long session.
- LRU side effect: `treeFor` no longer touches `lastRead`. Only `retain` does (store.ts:405). Entries that are only displayed by non-retaining tiles or chips keep `lastRead` 0 and are the first evicted once more than 20 non-live entries exist (retention.ts:20-23). The tile then degrades to the record summary. Acceptable, listed as m2.

## Major

### Major 1. Bubble history state changes do not re-render (M3 fix is inert)

- File: inline-agent-bubble.component.ts (`historyEntry`, `storeTree`, `displayChildren`, `canLoadHistory`, around lines 982-1005). The component is `OnPush` (line 631).
- `historyEntry` is `computed(() => executionStore.entryFor(key))`. `entryFor` returns the same mutable object every time (store.ts:163-166). A computed that returns the identical reference does not notify its consumers, so the template is not dirtied when `history` changes from `loading` to `error`, `not-found` or `unresolved`.
- `storeTree` does produce a new array on every bump, but while the history is unresolved the tree is empty. `displayChildren` then falls back to the stable `node().children`, and `canLoadHistory` stays `false`, so nothing the template reads changes.
- Scenario: the user clicks "Load saved output". `idle` to `loading` flips `canLoadHistory` and renders "Loading saved output". The RPC then returns `not-found` or `error` (or no session). The UI stays on "Loading saved output" forever, and the error text and Retry button from M3 never render. The success path is unaffected because the tree becomes non-empty.
- The lane avoids this because `nodes` returns a fresh array on each bump (lane.ts:283-286). The bubble specs use a mocked store, so they cannot catch it.
- Fix direction (not a new round, just the defect): make the bubble template depend on a value that changes, for example `historyState` as a computed of `entry.history` plus `historyError`, instead of the object reference.

### Major 2. `retain()` does a tracked signal read inside the component effects, which reintroduces release/retain churn and aborts in-flight loads

- File: store.ts:398-402 (`syncedRecords.get(key) ?? agentMonitorStore.subagents?.().get(key)`), called from effects at inline-agent-bubble.component.ts:722-733 and subagent-lane.component.ts constructor. Only the sessionId argument is wrapped in `untracked`, not the `retain` call.
- When no synced record exists for the key, `subagents()` is read inside the effect, so the effect re-runs on every monitor-store change. Each re-run calls the cleanup `release`, then `retain`.
- Release with `refs === 0` and `history === 'loading'` calls `abort` (store.ts:381-382), which sets history back to `idle` and invalidates the in-flight load.
- Scenario: a bubble for a historical agent with no monitor record starts "Load saved output". Any subagent event in any other running tab changes the monitor map, the effect re-runs, the load is aborted and the button silently reappears. It also publishes the global entries map twice per change.
- Lane records normally exist in the monitor store, so the lane is mostly safe, but the same hazard applies the first time before the store effect syncs.
- Fix direction: call `retain` inside `untracked` in both components, or make the terminal check in `retain` use only `syncedRecords`.

## Minor

- m1. store.ts:112, 154-161: `keyRevisions` (and `syncedRecords` on the `remove()` path other than `clearSession`, store.ts:486) are never pruned for evicted keys. Slow unbounded growth.
- m2. store.ts:405 and retention.ts:20: LRU read order is only updated by `retain`. Entries shown only by tiles or chips are evicted first, so a tile can lose its preview after 20 other finalized entries.
- m3. inline-agent-bubble.component.ts:722-733 and store.ts `open()` (`sessionId && !entry.sessionId`): the bubble's active-session fallback pins a wrong session id permanently when no monitor record exists and the bubble is not in the active session. Later correct ids never override it, and `not-found` is sticky (`ensureHistory` returns early). The visible error now appears, but the user cannot recover without a reload. Rated an acceptable residual only because backgrounded tabs rarely render bubbles. Treat as Minor.
- m4. store.ts:266-269 (N3): while a record is terminal, `finalize` runs after every late event. If an agent is resumed and events arrive before the record sync flips the status back to running, each event pushes another rebuilt tree into `finalized` (continuation re-seeding), which can duplicate nodes and costs a tree build per event.
- m5. B5c, agent-monitor-panel.component.ts (lane at the `@if (selectedWorkflowSubagent(); as sub)` block): the lane instance is reused when the selected record changes, so `steerOpen`, `steerFailed`, `stopPending` and the steer draft carry over to the next agent. Only reachable if selection can switch without leaving the detail view; if it can, a message drafted for agent A is sent to agent B. The usage summary (cost/model detail from `SubagentUsageSummaryComponent`) was also dropped; the lane shows only a token count. Also `getPermissionForTool` is not bound, so permission prompts for a workflow sub-agent's tools cannot be answered from this lane (the old viewer could not either).
- Lane effect 3 (subagent-lane.component.ts, history effect) reads `entry()` which is identity-stable, so it never re-fires when `live` flips to false or `history` goes back to `idle` after a spill; a record that ended with zero captured events shows "No output recorded" instead of loading history until the user clicks Load.

## Residuals named in the lane report

- Nested chips need the parent entry resident or loaded: acceptable. Eviction degrades to the existing unavailable notice, and removal bumps the key so the chips recompute.
- Update of one referenced key still recomputes all turn facts: acceptable. It no longer fires on unrelated publishes (store.ts:146-149 bumps per key). Cost is one pass over the referenced trees.
- Active-session bubble fallback differs for background tabs: a defect, but Minor (m3), because it pins the wrong session id permanently rather than only failing once.

## Five logic questions (short)

1. Silent failure: the bubble stays on "Loading saved output" after a failed history load (Major 1). A load aborted by effect churn returns to idle without any message (Major 2).
2. Unexpected user action: reload of a history load by changing another tab's agents; switching the selected agent in the panel with the steer box open (m5).
3. Wrong answer from data: a bubble opened with the wrong active-session id gets `not-found` permanently (m3). Resumed agents produce duplicated nodes after late-event refinalize (m4).
4. Dependency failure: the RPC failing paths are handled in the store (`error` state set and published), but the bubble does not render them (Major 1). Missing session now yields a visible error in the store.
5. Missing: no pruning of per-key signals; no re-fetch trigger when a lane's entry becomes non-live with an empty tree.

## Requirements fulfilment

| Requirement                                              | Status   | Gap                                            |
| -------------------------------------------------------- | -------- | ---------------------------------------------- |
| B1 replay keeps parent message after Task                | COMPLETE | none found                                     |
| N1-N3 store fixes                                        | COMPLETE | m4 cost caveat                                 |
| M1 lane retain stable                                    | PARTIAL  | Major 2                                        |
| M3 bubble history states                                 | PARTIAL  | state set in the store, not rendered (Major 1) |
| M4 background nested agents                              | COMPLETE | none found                                     |
| M5 per-key revisions                                     | COMPLETE | leak m1, LRU m2                                |
| B5c panel renders `ptah-subagent-lane`, Back action kept | COMPLETE | m5                                             |

Confidence: HIGH for Major 1 and Major 2 from the code paths cited; MEDIUM for m4 and m5 (depend on runtime ordering and navigation I could not run).
