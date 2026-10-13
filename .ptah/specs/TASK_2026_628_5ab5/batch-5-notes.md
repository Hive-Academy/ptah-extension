# Batch 5 notes — hot spot 5 (tab/presentation copies per frame)

Worktree `D:\projects\ptah-wt-628`, branch `fix/task-628-renderer-memory`. Nothing is committed.

## Files changed per sub-batch

### 5a — TabManager (`@ptah-extension/chat-state`)
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.ts`. Only `updateTabInternal` and its doc comment changed.
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`. New `describe('no-op updates (updateTabInternal)')` with 4 tests.

### 5b — StreamPresentationStore (`@ptah-extension/chat`)
- MODIFIED `libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts`
- CREATED `libs/frontend/chat/src/lib/services/stream-presentation-store.service.spec.ts` (4 tests). This spec did not exist before.

### 5c — one `tab-<id>` tree key (`@ptah-extension/chat`)
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts`. New `describe('one buildTree per published tab snapshot')` with 2 tests.

### 5d — shared tool-input parse cache (`@ptah-extension/chat-types`, `@ptah-extension/chat-execution-tree`)
- CREATED `libs/frontend/chat-types/src/lib/tool-input-parse-cache.ts`
- MODIFIED `libs/frontend/chat-types/src/index.ts` (one export line)
- MODIFIED `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts`. It now calls `parseToolInputCached`. The local `parseToolInput` and `ParseResult` are deleted.
- CREATED `libs/frontend/chat-execution-tree/src/lib/builders/tool-input-parse-cache.spec.ts` (4 tests). It sits here because of A4.
- MODIFIED `libs/frontend/chat-execution-tree/src/lib/builders/builders.spec.ts`. One assertion was added: rebuilding a completed tool returns the same `toolInput` object.

## Design summary

**5a.** `updateTabInternal` does one `findIndex`, and it runs inside the `_tabs.update` updater. Two local flags, `found` and `changed`, decide what happens next:
- If the tab is not in the active list, the call goes to `updateBackgroundTab`, as before.
- If every key in `updates` is `Object.is`-equal to the tab's current value (checked with `for…in`, so no array is allocated), the updater returns the same array. There is no tab copy, no `lastActivityAt` bump and no `saveTabState()`.
- Any changed value publishes a new tab and a new array, bumps `lastActivityAt` and saves. That includes a new `streamingState` object and every `status` change, turn-in-flight included, as the 629 binding requires.

The `claudeSessionId` reverse-index registration still runs before the no-op exit. That keeps today's side effect for every update that names a session id. It is a `Map.set`.

**5b.** All memo state lives in `TabRecords`, so it is released with the tab and on destroy. No timers or observers were added.
1. The closed-tab release runs from an effect on a private `computed` of tab ids, with `equal: sameRefs`. It fires when the id list changes, not on every streaming flush.
2. Finalized memo. `filterCompactionNoise` and the finalized-id `Set` are recomputed only when `tab.messages` changes reference.
3. Streaming-message memo, `Map<treeId, {tree, stats, sessionId, message}>`. The previous `ExecutionChatMessage` is reused when the tree reference, the `pendingStats` reference and `claudeSessionId` are all unchanged. Entries for tree ids missing from the current build are pruned. If the build is empty, the memo is cleared.
4. Merge memo. When the finalized list and every streaming message are reference-identical to the last merge, the merged array and its id list are reused, and the record-signal pass is skipped. The structural check, including `isStreaming`, still runs on every sync. The memo has its own fields rather than reusing `records.previous`, because `previous` is only updated on a structural change and can be stale.

The class doc now says that every transcript surface must use `structureFor`/`sync` and must never call `buildTree` with a key of its own.

**5c.** `_executionTrees` always uses `` `tab-${tabId}` ``. `_sessionContext` had no other reader in the component (grep: only the injection and the key branch), so the injection and the now-unused `SESSION_CONTEXT` import were removed. `SESSION_FOCUSED` is kept. No template, layout or canvas change.

**5d.** `parseToolInputCached(toolCallId, raw)` returns `{ success: true; data: Readonly<Record<string, unknown>> } | { success: false; error; raw }`.
- The cache is a module-level `Map` with LRU order kept by delete-and-reinsert, capped at `TOOL_INPUT_PARSE_CACHE_LIMIT = 256`. It uses no timer.
- An entry is a hit only when the raw string is identical. The same id with a different raw string is parsed again and replaces the entry.
- Non-object JSON returns `'Not an object'`. Arrays still count as success, which is today's behaviour.
- `clearToolInputParseCache()` exists for spec isolation.
- I grepped `libs/frontend` for writes to `toolInput` (index or property assignment, `delete`, `Object.assign`). There are none, so sharing `data` is safe.

## Assumptions A1–A4 (verified)

- **A1: holds, but the save is kept for streamingState-only changes.**
  - `streamingState` is not persisted (`NON_PERSISTED_TAB_KEYS`, `tab-persistence.ts:82-88`), and `persistNeeded` already skips the `localStorage` write during a turn.
  - `_doSaveTabState` also runs `workspacePartition.syncActiveWorkspaceState(tabs, activeTabId)` on every call (`tab-manager.service.ts:2755`). The comment there says that letting the mirror drift "would hand a stale tab set to the next workspace switch".
  - `lastActivityAt` is persisted at a 30 s granularity (`tab-persistence.ts:91-100`), and it relies on these calls.
  - So `saveTabState()` is skipped only on true no-ops. A real `streamingState` change still re-arms the debounce timer (see Decisions).
- **A2: holds.** `TreeCacheEntry` holds only memos derived from state: `nodesById`, `fingerprintsById`, `nodeByRoot`, `digestByRoot`, indexes and `agentNodeByToolCall` (`execution-tree-builder.service.ts:906-914`, Batch 2 version). It holds no UI state per surface, so the `tile-` key could be dropped.
- **A3: holds.** `eslint.config.mjs:376-381` lets `sourceTag: 'type:feature'` depend on `type:util`, and `chat-types` is `type:util`. `chat-execution-tree` already imported `@ptah-extension/chat-types`. Lint is clean.
- **A4: does not hold.** `libs/frontend/chat-types/project.json` has only `lint` and `typecheck`, and there is no `jest.config.ts`. Following the plan's fallback, the helper stays in `chat-types` (A3 holds) and its spec lives in `libs/frontend/chat-execution-tree/src/lib/builders/tool-input-parse-cache.spec.ts`. I did not add Jest infrastructure to `chat-types`.

## Hand-offs (files owned by Batch 2 and others; not edited)

After 5c nothing writes a `tile-<tabId>` tree key, so these clears do nothing:
1. `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:929`: `this.clearCache(\`tile-${tabId}\`)` in `clearForClosedTab`. The doc comment at `:920-926` also mentions the tile entry and why `clearForTab` is main-panel-scoped. Both should be updated: `clearForTab` now drops the entry the tile shares, which costs at most one rebuild on the next read.
2. `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:508`: `this.treeBuilder.clearCache(\`tile-${t.id}\`)`.

Parse-cache adoption (team-leader ordering): `agent-monitor-tree-builder.service.ts` (Batch 4) and `compact-session-summary.ts` (Batch 6) can now import `parseToolInputCached` from `@ptah-extension/chat-types`. Compact-summary must map a failure back to returning `input`.

## Check results

Every check was run from `D:\projects\ptah-wt-628` while holding `.ptah\tmp\heavy-check.lock`, one at a time.

| Command | Result |
|---|---|
| `npx jest -c libs/frontend/chat-execution-tree/jest.config.ts …/builders/builders.spec.ts …/builders/tool-input-parse-cache.spec.ts --coverage=false --maxWorkers=2` | 2 suites, 21 tests passed |
| `npx jest -c libs/frontend/chat-state/jest.config.ts libs/frontend/chat-state/src/lib/tab-manager --coverage=false --maxWorkers=2` | 8 suites, 274 tests passed |
| `npx jest -c libs/frontend/chat/jest.config.ts …/services/stream-presentation-store.service.spec.ts …/components/organisms/transcript/ --coverage=false --maxWorkers=2` | 17 suites, 199 tests passed (includes `chat-transcript.display.spec.ts`) |
| `npx nx typecheck <p> --parallel=1` for `chat-types`, `chat-execution-tree`, `chat-state`, `chat` | all 4 succeeded |
| `npx nx lint <p> --parallel=1` for the same 4 | all 4 succeeded, 0 errors |

All lint warnings found were already there before this batch:
- `tab-manager.service.ts` `max-lines`: 1546 counted lines against a 700 limit. The file was already over; the batch adds 4 lines.
- `chat-transcript.component.spec.ts:457` unused `h`. This is an existing test; the new tests are appended at the end of the file.
- The rest of the 34 warnings in the `chat` project are in other files.

Files I edited that were under 700 lines stay under: the store is about 330 lines. `chat-transcript.component.ts` was already over 700 and gets shorter (−9 lines). `tool-node.fn.ts` gets shorter.

The `ptah_get_diagnostics` tool was unavailable: it reported that the worktree is outside its workspace root.

## Decisions

| Decision | Reason |
|---|---|
| Skip only when every `Object.is` value is equal; a status change always publishes | Binding from 629. No caller loses a real change. |
| Keep `saveTabState()` on streamingState-only changes (A1) | `_doSaveTabState` syncs the partition mirror, and the 30 s `lastActivityAt` persistence depends on it. The remaining cost is timer churn per real flush, not a write. |
| Run `registerSessionForWorkspace` before the no-op exit | Before this batch, every multi-key update ran it. A tab restored with an id that was never registered would otherwise lose the registration from a repeated `attachSession`. |
| Merge memo stores its own inputs instead of reading `records.previous` | `previous` changes only on a structural change, so it can be stale. |
| One `sameRefs` helper is the computed `equal` and the merge check | Both are positional identity comparisons. |
| Remove the `_sessionContext` injection from the transcript | It had no remaining reader. The plan allowed removing it in that case. |
| The "one build per published snapshot" test is new, not extended | No such test existed in this tree. It mounts two `ChatTranscriptComponent` surfaces of one tab, not two `ChatViewComponent`s. The transcript is the component that builds, and a ChatView harness would only add providers that don't affect the assertion. It asserts exactly one `buildTree` per published snapshot over two frames, with key `tab-tab-1`. |
| Parse-cache spec lives in `chat-execution-tree` | A4: `chat-types` has no Jest target. That is the plan's fallback. |

## Out-of-scope observations

- `TabWorkspacePartitionService.updateBackgroundTab` (`tab-workspace-partition.service.ts:380-384`) still has the old single-key fast path. Background-workspace tabs therefore still copy on no-op updates. That file is not in Batch 5's list.

## Review round 1 (`code-logic-review-batch-5.md`, CHANGES REQUESTED 5/10)

### Defect 1: stale structural message list in turn snapshots

**Finding.** `records.structure.messages` changes only on a structural change. A tree that grows under the same id updates its record signal alone. Before Batch 5, the structure was also published only on a structural change, so the stale list predates this batch. It is fixed here anyway.

**Where it reaches a snapshot.** `TranscriptTurnSnapshots.buildSnapshots` returns the constant `PENDING_TURN_SNAPSHOT` for unfinalized turns. So the stale list reaches a built snapshot when streaming messages count as finalized, which is the `historyReplaying()` path (`streamingBoundary = totalCount`).

**Fix: option (b), the per-record data.** `ptahUiSnapshots` in `chat-transcript.component.ts` now passes `view.slots.map((slot) => slot.record())` instead of `view.messages`. That is the rule `TranscriptDisplayFeed.candidates` already follows (`transcript-display-feed.ts:56-62`).
- The snapshot cache keys on message identity, so only the turn whose message changed rebuilds.
- Snapshots are computed only on Electron.

**Why not option (a).** Publishing a new structure whenever any message object changed would make the structure, `vm`, the content-follow effect, the prepend-anchor directive and `changeSetAnchors` recompute on every streaming frame. Batch 5 exists to remove that churn.

**Other `vm().messages` readers.** I checked each one, and none reads tree content:
- `anchorChangeSets`: role, id and the root `startTime`, which is stable per id.
- The content-follow effect: count and role.
- `ptahUiOrderKeys`: the structure's `orderKeys`, from the root `startTime`.
- The prepend anchor: ids.

They keep the structural list.

**Test.** `chat-transcript.ptah-ui.spec.ts` › "reflects a tool added to a replaying tree under the same id". It uses a real store and `historyReplaying = true`; the tree `live` gains a Bash node under the same id, and the test asserts that the bubble's snapshot is a new object whose `tests.runs` contains the command.

**Regression check.** I swapped the line back to `view.messages` and ran only this test: `Tests: 1 failed, 11 skipped`. With the fix restored, the suite gives 12 passed.

### Defect 2: parse cache had a count bound only

`chat-types/src/lib/tool-input-parse-cache.ts` now uses the same three-way policy as Batch 6 (`compact-session-summary-cache.ts`):
- An input longer than `TOOL_INPUT_PARSE_CACHE_MAX_ENTRY_CHARS = 32_768` is parsed fresh on every call and never cached. Any older entry for that id is dropped.
- A total budget of `TOOL_INPUT_PARSE_CACHE_MAX_RETAINED_CHARS = 1_048_576` characters applies. Each entry's size is `raw.length × 3`: the raw string plus a 2× estimate for the parsed object.
- The 256-entry cap stays.
- Eviction is oldest first (LRU order is kept by delete-and-reinsert on a hit). A private `retained` counter is kept in step by `forget`. There are no timers.
- `clearToolInputParseCache()` also resets the counter.

New tests in `chat-execution-tree/src/lib/builders/tool-input-parse-cache.spec.ts`:
- An oversized input is not retained: two calls give two result objects and two `JSON.parse` calls.
- An input exactly at the cap is cached.
- Budget eviction drops the oldest: with 30 000-char inputs, the entry that overflows the budget evicts only `call-0`.

### Round 1 checks

All run from `D:\projects\ptah-wt-628` while holding the lock, one at a time.

| Command | Result |
|---|---|
| `npx jest -c libs/frontend/chat-execution-tree/jest.config.ts …/builders/builders.spec.ts …/builders/tool-input-parse-cache.spec.ts --coverage=false --maxWorkers=2` | 2 suites, 24 tests passed |
| `npx jest -c libs/frontend/chat/jest.config.ts …/services/stream-presentation-store.service.spec.ts …/components/organisms/transcript/ --coverage=false --maxWorkers=2` | 17 suites, 200 tests passed (includes `chat-transcript.display.spec.ts`) |
| `npx nx typecheck <p> --parallel=1` for `chat-types`, `chat-execution-tree`, `chat` | all succeeded |
| `npx nx lint <p> --parallel=1` for the same 3 | all succeeded, 0 errors |

The `chat` project still shows the same 34 warnings as before round 1, so this round adds none. `chat-state` was not changed in this round and was not re-run.

### Round 1 decisions

| Decision | Reason |
|---|---|
| Move the turn-snapshot consumer to per-record data rather than republish the structure | Least churn, and correct. It matches the display feed's existing rule. |
| Size estimate is `raw × 3`, and the over-cap check uses the raw length only | Same policy as the Batch 6 memo. The parsed object is estimated at 2× its raw text. |

### Not touched this round

`batched-update.service.ts`, `streaming-handler.service.ts` and `chat-lifecycle*` belong to Batch 3. The review also notes that `buildTree` can throw after `records.source` is assigned (`stream-presentation-store.service.ts`). That predates Batch 5, was not scored, and was left as is.
