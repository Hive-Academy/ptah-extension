# Code logic review — Batch F correction (round 3)

Review family: grok (reviewer) / codex (implementer)

## Verdict

REVISE. Score 5/10.

The three filed fixes land on the paths their tests name. A direct child of one root Task is removed from `tab.messages`, reinstalled as the only streaming root, and finalized once. An overflow return resets the tab before `release`. A retired filter stays registered and reconciles a changed history `tool_result`. That is not the whole seed shape this batch is for. The repair keys off the first qualifying `agent_start` and gives up unless that tool's immediate `message_start` is already a top-level row. A still-open subagent whose parent tool sits inside another subagent takes that fallback, `finalizeSessionHistory` has already cleared streaming state, and the continuation is parented into a tree with no root. The user sees the history snapshot and none of the live tail.

Why not 4: the A-2 root-Task path, the overflow order, and retired rule T match the decisions and are pinned by tests that fail if those branches are removed. Why not 6: the missed owner is the same silent loss as round 2's defect 1, on a seed the host can actually emit (only the still-open inner message remains in the live seed).

## Per-defect verification

| Defect | Fixed? | Evidence file:line | Test pins it? |
| --- | --- | --- | --- |
| 1. Seeded subagent tail invisible | partial | Root owner: `session-history-replayer.service.ts:336-390` removes `ownerStart.id` and installs that message's history state before `closeFence` (`732`). Assistant row ids are the `message_start` id (`message-node.fn.ts:45`, `history-message-builder.service.ts:169-209`), so the A-2 id matches. Nested or second owner: `336-338` and `350-352` (defect A). | yes for one root Task — `A-2 keeps the Task owner live through a seeded subagent continuation` (`session-loader.resync-live-seed.spec.ts:278`). It would fail if O stayed in `messages` or the later delta were missing from the Task node. It never builds a nested parent tool. Missing-owner warn: `session-history-replayer.service.spec.ts:878`. |
| 2. Overflow release onto old tab | yes | `session-loader.service.ts:926-931` calls `resetResyncTabBeforeSeed` (`1177-1185`) and returns while `loadCompleted` is still false. `release` is in the `finally` at `1146`, so the seed is applied after the empty write. The same helper is the failed-load path at `1128-1129`. | yes — `resets an overflowed resync before seed and buffered live release` (`session-loader.service.spec.ts:2575`) expects `reset`, `seed`, `live`. Without the call the order is `seed`, `live`. The failed-load test at `2553` is unchanged. |
| 3. Retired rule T lost | yes | `terminalFilters` / `filterToolIds` at `173-175` and `830`. After a terminal event, `exclusions` (`902-918`) consults the filter only for a `tool_result` whose id is in that set. `decide` on a retired filter reconciles a different output and returns `keep` (`persisted-content-filter.ts:108-111`). Any other event leaves `consulted` false, so `deferLiveEvent` (`683`) does not drop it. `retirePersistedFilter` (`273-276`) still deletes the map entry on claim, close, rebind, and a throwing `decide`. | yes — `keeps retired rule T for changed and repeated history tool results` (`session-history-replayer.service.spec.ts:850`). Without the map entry the history card stays `old`. `filters a persisted block after close and retires at the terminal` (`831`) still expects the following `text_delta` to return false. |

## Defects

### 1. serious — a nested Task owner is treated as missing, so the live tail is not shown

`session-history-replayer.service.ts:336-352`. `seed.events.find` keeps the earliest `agent_start` whose `parentToolUseId` is in `historyToolIds`. The owner is that tool's own `message_start`. `history-message-builder.service.ts:167` does not emit a row for a `message_start` that has `parentToolUseId`, so `tab.messages.some(message => message.id === ownerStart.id)` is false. The branch warns and does not install a live root. `finalizeSessionHistory` has already run (`342`) and `applyFinalizedHistory` (`tab-manager.service.ts:2010-2014`) has set `streamingState` to null and frozen the outer card. `closeFence` (`751-779`) then applies the seed onto that empty state. `execution-tree-builder.service.ts:319` skips every `message_start` with `parentToolUseId`, so `buildTree` has no root and `chat-transcript.component.ts:434-437` paints nothing from the seed.

Failure: history contains root `message_start` `root-start` / `root`, Task `toolu_outer` on `root`, then subagent `message_start` `sub-start` / `sub` with `parentToolUseId: toolu_outer`, and Task `toolu_inner` on `sub`. The live seed, ordered by sequence (`live-message-projection.ts:129-139`), contains only the still-open inner turn: `agent_start` with `parentToolUseId: toolu_inner` plus that child's `text_delta`. `find` selects `toolu_inner`. Its owner row is not in `tab.messages`. The warn path runs. The transcript keeps the frozen outer Task and does not show the inner delta. No error is raised. The same `find` drops a second root Task when the seed's first matching `agent_start` belongs to a different top-level message: only that first owner is removed (`389`), and the other parent's later deltas are applied into a state that has no `tool_start` for them (`376-377`), so they are parented orphans too.

Suggested fix: resolve the owner by walking `parentToolUseId` to the root `message_start` that history actually materialized, and include every seed `agent_start` whose parent tool lies in that root's tool closure. Keep the warn-and-leave-seed path only when no materialized root contains the tool.

### 2. moderate — turn-end finalization appends a non-last owner after the messages that followed it

`session-history-replayer.service.ts:354-390` keeps only O and the descendants reached through its tool ids, then `message-finalization.service.ts:69-80` looks for a user anchor in that filtered state. The descendant walk (`365-368`) adds a `message_start` only when it has a `parentToolUseId`, so the root user prompts that sit after O are not in the live state. `firstAnchor` stays undefined and `placeFinalizedTrees` returns `[...existing, ...newMessages]`. While the subagent is still streaming, `mergeByTime` (`chat-transcript.component.ts:87-105`, `470`) places O by `streamingState.startTime` (`transcript-change-set-anchors.ts:25-27`). After `finalizeCurrentMessage` (`message-finalization.service.ts:249-251`) the streaming list is empty and the transcript uses the array order.

Failure: history rows are `[user-1, O, user-2, assistant-2]`, and the seed's `agent_start` parents to O's Task. During the continuation, O renders between `user-1` and `user-2`. When that turn finalizes, O is appended, and the transcript becomes `[user-1, user-2, assistant-2, O]`. O's text is still present once. It is no longer in the turn it belongs to. A-2's history is only O, so the test passes.

Suggested fix: remember O's index among the frozen rows and pass that index into the finalization placement, or leave the root user messages in the live state's `messageEventIds` so `placeFinalizedTrees` still has an anchor. Do not append when a frozen row with a later `startTime` exists.

## Five logic questions

1. Silent success: defect 1. Resync resolves `{ staleSnapshot: false }`, the outer Task card stays the history snapshot, and the inner delta sits on `streamingState` with no transcript root.
2. User action: switch away and back while a nested Task is the open stream (defect 1). Let that continuation reach a terminal `turn_state` when a later history row already exists (defect 2).
3. Wrong answer without an error: the nested seed is applied and then omitted from `allMessages`. A non-last O is stored once at the bottom after finalization.
4. Dependency failure: overflow and a rejected `session:load` both call `resetResyncTabBeforeSeed` before `release` (`926-931`, `1128-1129`, `1146`). A throwing `decide` still retires the filter and delivers (`909-912`). A retired filter that is removed by `retirePersistedFilter` no longer consults rule T; claim, close, and rebind still remove it (`199`, `273-276`, `796`, `899`).
5. Not written down as a criterion: one seed can name more than one historical Task, and the open tool's owner is not always a top-level row. Finalization placement was specified only as "append O once."

## Decisions

- A-2's id check is the history builder's id. `buildMessageNode` sets the node id to `startEvent.id`, and the assistant row copies `treeNode.id`. The removal at `389` matches that row for a root assistant. User rows use `messageId` (`history-message-builder.service.ts:189`); a Task owner is an assistant row.
- `belongs` (`372-373`) keeps `AccumulatorKeys` text, thinking, and tool-input keys (`chat-types.ts:814-819`), which are `${id}-…`. Agent summary and content-block maps are keyed by `agentId` (`chat-lifecycle.service.ts:31-36`). History replay does not fill those maps (`accumulator-core.service.ts` has no writer), so dropping them on this path does not remove text the tree would have painted. Not filed.
- The persisted seed loop (`759-779`) still runs `decide` for owner and subagent events that `liveSeedBlocks` names. Historical owner text stays on the restored root and is dropped from the seed when the filter matches it. Subagent text that is not in the history index is kept once. Fail-open duplicates stay the accepted ones from round 2.
- Rule T after retirement returns `keep` even when the output is unchanged (`persisted-content-filter.ts:108-111`). The new test expects that delivery and expects no second `setMessages`. That is the round's "never drop," not a new defect. Non-tool events after the terminal are not consulted.
- True missing owner (no `message_start`, or the id is absent) warns and leaves the seed live (`350-352`). `session-history-replayer.service.spec.ts:878` pins that. Defect 1 is the false miss, where the owner exists only as a nested message.
- Not reopened: rule R turn boundary, A-B2 failure, page edge, older host without `liveSeedBlocks`, filter exceptions failing open.
- No Jest, Nx, or lint was run here. The fix report's scoped Jest pass is noted and does not render a nested owner or a non-last O.
