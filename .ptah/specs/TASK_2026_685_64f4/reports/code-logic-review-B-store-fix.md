# Code Logic Review - TASK_2026_685_64f4, B-store fix round (6205bae6b)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION (fix-round cap reached: findings go to the user) |
| Blocking | 1 (new, introduced by the M3 fix) |
| Moderate | 3 new, 1 earlier item PARTIAL |
| Minor | 6 |

Scope: whole of `subagent-execution.store.ts` (552 lines), the three new sibling modules, the `history-message-builder.service.ts` diff, the `stream-router.service.ts` diff, `AgentMonitorStore.onTaskToolResult` / `forceClearSessionAgents` / `clearSessionAgents`, `accumulator-core` tool_result path, and the consumers (`subagent-lane`, `inline-agent-bubble`, `subagent-tile`, `chat-transcript`, `transcript-ptah-ui-host-sources`). Backend history shape checked in `session-replay.service.ts` and `history-event-factory.ts`. Ran `subagent-execution.store.spec.ts` + `history-message-builder.service.spec.ts`: 27/27 pass. Prettier check on the changed files is clean. No typecheck run.

## Earlier Moderates

| Item | Status | Evidence |
| --- | --- | --- |
| Logic M1 finalization unreachable | RESOLVED for the main paths, with two residuals (see N3, N4) | `store.ts:124-133` effect over `agentMonitorStore.subagents()` calls `syncRecord` once per changed record identity; `:168-180` finalizes on `completed/failed/killed/stopped` (`:42-47`), leaves running/pending/background/paused live. Foreground Task result: `accumulator-core.service.ts:441-466` -> `onTaskToolResult` (`agent-monitor.store.ts:2432`) flips pending/running to completed/failed, never overrides a real status, skips backgrounded results -> record changes -> effect -> finalize. A running agent is not finalized. No feedback loop: the effect only reads `subagents()`; `syncRecord`/`finalize` write `_entries` and mutable maps, never the monitor store; the `syncedRecords` identity check stops re-entry. Cost: O(records) Map lookups per monitor change plus one `new Map(entries)` per synced record; no teardown needed (root-scoped effect). |
| Logic M2 stale in-flight promise | RESOLVED | `abort` (`:388-394`) deletes the key's `inFlight` entry and bumps generation; `ensureHistory` finally-block compares identity (`:462-466`); old load fails `valid()` (`:476-479`, `:496`). Reopen-after-release starts a fresh load. |
| Logic M2 truncated reload path | PARTIAL | `:433-438` allows reload when `loaded && truncated`. Works for the lane's "Load full output". But `entry.clipped += clipped` (`:517`) accumulates on every reload, so the clipped count inflates; and `truncated` never resets, so each click re-downloads up to 10k events (see N2). |
| Logic M3 multi-page replay ownership | NOT RESOLVED, replaced by a Blocking regression | See B1. The per-session set (`history-message-builder.service.ts:133-135`) does survive chunks and pages, but the new rule at `:139` is wrong for the root `agent_start`. |
| Logic M4 truncated flag | PARTIAL | Paging now has a 100-page cap and cycle guard (`store.ts:494-507`), a tail splice at 10,000 (`:503-506`) and the merge returns `fresh.events.size < snapshot.length` (`history-merge.ts:102`). Heuristic: false positives when the private dedup drops a duplicate; false negative when live events refill the 2,000 cap (e.g. snapshot 1,900 + 300 live, size ends at 2,000, returns false). Minor. |
| Logic M5 spec gaps | RESOLVED | Specs now cover 10,800-event spill, 4,001 owners, abort during page two, release/reopen, truncated reload (spec passes 27/27). The spec for the builder misses the root `agent_start` case, which is how B1 got through. |
| Style 1 god file | PARTIAL | Ownership, retention, merge extracted; store is still 552 lines with five parallel maps (`continuationStarts`, `continuationTools`, `lastRead`, `syncedRecords`, `overflowWarned`) to clean in `remove` (`:431-441`). |
| Style 2 writable signal | RESOLVED | `_entries` private, `entries` is `asReadonly()` of a view type (`:104-108`). Type-level only; the objects are still the mutable entries. |
| Style 3 wide public API | NOT RESOLVED | `index.ts` still exports legacy `SubagentExecutionEntry` with internal fields (generation, refs, idAlias, revision); the lane report defers this. |
| Style 4 prettier | RESOLVED | `prettier --check` clean on all changed files. |
| Style 5 magic numbers | PARTIAL | Constants are named (`HISTORY_*`, `ENTRY_EVENT_CAP`, `OWNER_CAP`), none carries a rationale comment. |
| Style 6 growth in large files | NOT RESOLVED | `streaming-handler.service.ts` unchanged at 781 lines; the builder only gained a small helper. |

## Blocking

### B1. History replay now swallows the parent message after any Task/Agent tool call (new, regression from the M3 fix)

- File: `libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts:139-141` (rule `if (scopedEvent.parentToolUseId) subagentMessageIds.add(scopedEvent.messageId)`).
- Evidence the premise is wrong: the backend replay emits the ROOT `agent_start` with the parent assistant message's id and `parentToolUseId = toolCallId` (`libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:347-357`, `history-event-factory.ts:268-289`: `messageId: currentMessageId`, `parentToolUseId: toolCallId`). The live path exempts it (`store.ts:188-197`, root `agent_start` returns false); the replay path has no such exemption.
- Scenario: restore any session whose assistant message contains an Agent/Task call. The `agent_start` registers the PARENT message id as sub-agent-owned. That event and every later event with that message id (parallel tool_starts, text after the call, `message_complete`) go to `subagentScratch` and are dropped from the tab state. The agent node, sibling parallel sub-agents and the message completion are missing from the restored transcript, with no error. `registerAgent` / monitor side effects still run, so the roster looks right while the transcript is wrong.
- Why tests pass: the new specs use child `message_start`s only; the existing `agent_start` spec (`history-message-builder.service.spec.ts:155-165`) has no `parentToolUseId`.
- Fix: only own ids from non-`agent_start` events (or from `message_start`/delta/tool events whose messageId differs from the owning tool's parent message), mirroring `claim`'s `agent_start` rule; add a spec with a root `agent_start` that carries `parentToolUseId` and the parent `messageId` followed by a text delta in the same message.

## Moderate (new)

### N1. LRU eviction now strands a viewed finalized agent (consequence of making finalization work)

- Files: `store.ts:396-405` (`evictFinalized`), `:431-441` (`remove`), `:125-133` (`syncedRecords` never cleared on LRU eviction), `inline-agent-bubble.component.ts:680` / `:923-928`.
- Scenario: a session with more than 20 finalized, unreferenced sub-agents (workflow runs). The oldest entry is removed; its record is unchanged, so the effect never re-opens it. Later the bubble calls `retain(key)`, which creates an entry with no `sessionId` (`:364-368` -> `open(key)`), and `ensureHistory` returns silently on `!entry.sessionId` (`:430-436`). `canLoadHistory` stays true, so the "load history" button does nothing: empty tree, no error state. The lane component hides this because its own effect calls `syncRecord` (`subagent-lane.component.ts:166`); the bubble has no such call.
- Fix: delete `syncedRecords` on any `remove` so the next monitor change re-opens it, and/or have `retain` accept the record's session id; make `ensureHistory` set `unresolved` instead of returning silently.

### N2. Truncated reload accumulates `clipped` and never settles

- File: `store.ts:517-519`. Every `ensureHistory` call on a truncated entry re-pages, then does `entry.clipped += clipped` and `entry.truncated ||= truncated`. The "N clipped" figure grows with each click, and a genuinely truncated entry offers an endless reload. Fix: assign `entry.clipped = clipped` on a full reload, and let `truncated` be recomputed from the reload.

### N3. Late events after a terminal status resurrect a permanently live entry

- File: `store.ts:230-232` (`claim` sets `entry.live = true`) vs `:174-176`. `finalize` runs once per record change. If stream events for that agent arrive after the record turned terminal, the entry returns to `live` with a state and is never refinalized until the record object changes again. A `live` entry is excluded from `oldestFinalized` (`retention.ts:19-24`) and is only reclaimable by the live spill or `clearSession`. Bounded in practice, but it re-opens the M1 leak for late-event cases. Fix: refinalize on idle (e.g. when `claim` touches an entry whose record is terminal) or keep `live` derived from the record.

## Minor

- `subagent-lane.component.ts:166` still calls `syncRecord` in its own effect, now duplicating the store-level effect (idempotent but double publish per change).
- `store.ts:371-386` / non-force `clearSessionAgents` path (`stream-router.service.ts:296-301`) leaves monitor records in place while `clearSession` deletes `syncedRecords` (`store.ts:451-452`); the next unrelated monitor change recreates empty entries for those records. `syncedRecords` is also never pruned for records the monitor drops.
- `history-message-builder.service.ts:133`: `replayOwners` is keyed per session and never released (lane-reported), so a reloaded session keeps old ownership.
- `ownership.ts:11,42,51-53`: evicted-message tombstones are unbounded until the entry is removed; `drop` is O(tombstones) per removal.
- `history-merge.ts:51`, `:89`: `accumulator.process` results (`replacementState`) are ignored in the merge, unlike `claim` (`store.ts:224-228`).
- `store.ts:138`, `:136`: `publish` copies the whole map per call; still O(entries) per event.

## Five logic questions

1. Silent failure: B1 (restored transcript silently loses content); N1 (button that does nothing).
2. Unexpected user action: clicking "Load full output" repeatedly inflates the clipped count (N2); viewing an old agent after the 20-entry LRU shows an empty lane (N1).
3. Wrong answer from valid data: root `agent_start` carrying `parentToolUseId` plus the parent message id (B1).
4. Dependency failure: RPC rejection, non-ok status, page cap, cursor cycle and abort all end in explicit states; verified `:471-545`.
5. Missing: a spec for the real backend `agent_start` shape; a re-finalize path for late events.

## Data flow

record update -> effect (`store.ts:125`) -> `syncRecord` (OK) -> terminal -> `finalize` (OK; builds tree, clears state, LRU) -> viewer `treeFor` (OK) -> LRU eviction -> `retain` without session id (GAP, N1).
History replay -> `accumulate` -> ownership set (GAP, B1) -> tab state.
Load full output -> `ensureHistory` (OK) -> paging with caps (OK) -> merge (heuristic truncated, clipped double-counts, N2).

## Consumers

`subagent-lane`, `subagent-tile.component.ts:65-67`, `inline-agent-bubble` (`:915-928`), `chat-transcript.component.ts:725-727` and `transcript-ptah-ui-host-sources.ts:62-65` use `entries()` / `treeFor` / `retain` / `release` / `ensureHistory` / `syncRecord` consistently with the new signatures; the readonly view type compiles for read access. Only the inline bubble depends on a pre-existing session id (N1). `canvas-lane-view.component.ts` and `transcript-agent-facts.ts` do not reference the store directly in `libs/frontend` greps (they read via the trees above).

## Verdict

- Recommendation: REVISE (no further fix round per the cap; user decides).
- Confidence: HIGH on B1 (backend shape and builder rule both read), MEDIUM on N1/N3 (static reasoning, not executed).
- Top risk: B1, a fix-introduced regression that silently drops post-Task content from every restored session with sub-agents.
- Robust version would add: the root `agent_start` exemption plus spec; `syncedRecords` cleanup on every remove and session id on `retain`; `clipped` assignment on reload; refinalize for late events.
