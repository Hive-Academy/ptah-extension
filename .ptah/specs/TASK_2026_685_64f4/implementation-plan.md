# Implementation Plan - TASK_2026_685 (tasks A + B) with TASK_2026_633

One plan, two phases. Phase A (685 task A) is frontend plus one small backend field and can ship
first. Phase B (685 task B + 633) moves SDK subagent output into its own live execution tree,
keeps it live after the parent turn, rebuilds earlier subagents from structured history, and
then executes the approved removals.

All `file:line` references are from the worktree
`D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream` (branch
`feat/lane-execution-stream`, base `71820e0c0`, PR #739 merged) unless a path says otherwise.
Line numbers in `canvas-lane-view.component.ts` and `canvas-rail-board.component.ts` shift when
TASK_2026_683 B6 lands; re-verify them after the rebase.

## Inputs and constraints

- Requirements used:
  - `.ptah/specs/TASK_2026_685_64f4/task.md`, `context.md` (this worktree).
  - `D:\projects\ptah-extension\.claude-worktrees\docs-lane-header-proof-451ab2d3f2f3\.ptah\specs\TASK_2026_685_64f4\visual-proof.md`
    ("User decision", duplication map, duration finding, "Proposed Removals" items 1-8 approved
    2026-10-17, task A / task B split), its `context.md`, `prototype/index.html` (approved header,
    `ptah-execution-header kind="cli" | "subagent"`), `screenshots/capture-report.md`.
  - `.ptah/specs/TASK_2026_633_21fa/task.md`, `context.md`.
  - The user scope decisions of 2026-10-17 quoted in the spawn prompt (binding).
- Corrections applied:
  - The "View transcript" lines quoted in the decision still match after PR #739
    (`inline-agent-bubble.component.ts:322-330`, `:963-981`; `inspector-agent-actions-menu.component.ts:38`;
    `session-agent-tray.service.ts:101-108`; `background-agent-strip.component.ts:331-346`).
  - The lane fallback is `canvas-lane-view.component.ts:155-163`; its load logic is `:236-244`
    (signals), `:302-329` (effect) and `:332-364` (`loadTranscript`).
  - **Correction to decision 4:** structured subagent events are already persisted. The Claude
    Agent SDK writes every subagent's full message log (text, thinking, `tool_use`,
    `tool_result`) to `<session>/subagents/agent-<id>.jsonl`, and the backend already replays
    those files into `FlatStreamEventUnion` with `parentToolUseId`
    (`jsonl-reader.service.ts:813-847`, `session-replay.service.ts:88-93`, `:366-374`,
    `:496-520`). Only the `subagent:transcript` RPC flattens them to text
    (`subagent-message-dispatcher.ts:480-506`). No second persistence store is needed; the plan
    adds a per-agent structured read instead (Decision D3).
    **Gap (round 1):** the agent-message converter `processAgentMessages` branches only on
    `text` and `tool_use` (`session-replay.service.ts:528-581`); thinking blocks are dropped,
    although the root converter handles them (`:310-320`, factory `createThinkingDelta`
    `history-event-factory.ts:157-175`). Component 6 adds the thinking branch.
  - **Correction to 633 context:** the backend does not stop forwarding after the parent
    `result` (`stream-transformer.ts:695-698` continues the loop). The output is lost in the
    webview: a late subagent event lands in a fresh empty tab `StreamingState`
    (`streaming-handler.service.ts:417-431`), finds no owning `tool_start`, builds nothing and is
    discarded at the next finalize (`message-finalization.service.ts:219-251`).
  - The background-agent tray chip named in 633 no longer exists (`background-agent-tray`
    has no source file left; the strip was collapsed in `d92a27a2a`); its role is taken by the
    inspector AGENTS row (`inspector-agents-section.component.ts:389-397`, emits
    `laneRequested`), the turn agent chips (`turn-agent-chips.component.ts:96`) and the
    subagent tile (`subagent-tile.component.ts:99`), all routed through
    `SESSION_CARD_ACTIONS.openLane`. Disposition of the 633 acceptance line: see
    "633 tray-chip criterion" under Architecture decision (covered, not a removal).
- Design handoff used: `prototype/index.html` (sections 1-3) and `visual-proof.md` "Prototype".
  Component name `ptah-execution-header` is used verbatim.
- Missing decision-critical input: none. The user-visible side effects of decision 2 that the
  approved list did not cover (P1-P4) were decided by the user on 2026-10-17; see
  `## Proposed Removals` and `## Clarifications (resolved 2026-10-17)`.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| CLI lane renders `ptah-agent-card presentation="flat"` | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:107-112` | The CLI header can change inside `AgentCardComponent` with no lane-view edit (no 683 B6 overlap) |
| Subagent lane = usage summary + main-tree agent node in `ptah-execution-node` (bubble), text fallback | `canvas-lane-view.component.ts:144-171` | Subagent lane needs its own component; fallback is removal item 8 |
| Lane finds the subagent node by walking the tab's finalized trees plus a live `buildTree` | `canvas-lane-view.component.ts:245-257` | Couples the lane to the main tree; replaced in Phase B |
| Tree builder skips messages with `parentToolUseId` as roots; subagent messages nest under the agent node | `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:314-322`; `libs/frontend/chat-execution-tree/.../builders/agent-node.fn.ts:44-58` | A subagent tree needs a "root parent" option, not a new builder |
| Subagent events go into the tab `StreamingState` like root events; no separate buffer | `accumulator-core.service.ts:227-235, :272, :497-498, :537-538` (Explore trace) | Router seam must claim them before the tab path |
| Store-only events already run the accumulator on a discarded scratch state | `streaming-handler.service.ts:408-435` | Precedent for "update the stores, keep the tab state untouched" |
| Accumulator has an `onStateChanged` hook for non-tab states (wizard/harness surfaces) | `accumulator-core.service.ts:63-86` | A per-subagent `StreamingState` can reuse the main accumulator unchanged |
| Late events after finalize are discarded | `tab-manager.service.ts:2299-2310`; `message-finalization.service.ts:219-251`, `:72` | Root cause of 633 "output stops after the parent turn" |
| Backend keeps forwarding after `result` | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:695-698`, `:1013-1036` | 633 needs no new push channel |
| Broadcaster resets `turnCompleteSent` on ANY `message_start` and sends `chat:complete` on ANY `message_complete`, without reading `parentToolUseId` | `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:269-271`, `:284-296` | Background subagent messages after the parent result re-send `chat:complete`; fix to root events only |
| Every subagent event carries `parentToolUseId`; `agent_start.parentToolUseId` = its own Task id | `sdk-message-transformer` family: `stream-event.transformer.ts:44,52`, `assistant-message.transformer.ts:250-273` | Ownership can be derived per event; nested agents resolve through a tool-owner map |
| Main history replay reads `subagents/agent-*.jsonl` (not `subagents/workflows/`) and nests them with synthetic ids `agent_msg_<toolCallId>_<n>_<ts>` and synthetic timestamps | `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:813-847`; `session-replay.service.ts:496-520` | Per-agent structured read reuses this code; merge with live output needs real message ids (Assumption A3) |
| Agent converter drops thinking; root converter keeps it | `session-replay.service.ts:528-581` (text, `tool_use` only) vs `:310-320`; `history-event-factory.ts:157-175` (`createThinkingDelta`, no `parentToolUseId`), `:338-358` (`createAgentTextDelta` pattern) | Component 6 adds `createAgentThinkingDelta` and a thinking branch |
| Live message id = `message.id`, else `uuid`, else `stream-msg-<now>`; a synthesized id is kept after the real start; live timestamps are `Date.now()` | `stream-event.transformer.ts:158-159`, `:180-190`, `:205-216`; complete message uses `message?.id \|\| uuid` with `blockIndex = contentIndex` (`assistant-message.transformer.ts:88`, `:119-149`) | Merge keys on the SDK `message.id` plus block index; synthesized ids need a fallback match (component 7) |
| `complete` and `history` sources replace a block's text instead of appending | `accumulator-core.service.ts:273-275` (pending clear on an existing start), `:314-319` (`setBlockAccumulator`) | Feeding a full snapshot message over a partial live one restores its prefix; live `stream` deltas fed after it would append, so they are filtered (component 7) |
| Accumulator store side effects inside content events | `accumulator-core.service.ts:449-456` (`onTaskToolResult`), `:497-498` (`onAgentStart`), `:537-538` (`onSubagentMessageComplete`, usage) | A merge rebuild that re-feeds events must not re-apply them |
| `EventDeduplicationService` has no injected dependencies | `event-deduplication.service.ts:20-21` | The merge rebuild can use its own instance |
| Task → agent-file correlation exists (resume id, else timestamp window) | `agent-correlation.service.ts:172-240`; used by `session-replay.service.ts:113-121`, `:342-358` | The history read can resolve `agentId` from `toolCallId` when the record lacks it |
| Single history file read cap 50 MB; whole JSONL text block becomes one event | `jsonl-reader.service.ts:113-118`; `session-replay.service.ts:531-542` | One event can exceed the 256 KB RPC cap; per-event caps are required |
| Out-of-canvas lane requests route through `SESSION_CARD_ACTIONS.openLane`; the single chat view opens the agent node in place and renders it with `ptah-execution-node` | `chat-transcript.component.ts:258-269`, `:933-958`, `:992-1001`; `single-chat-subagent-view.component.ts:79-80`; `chat-view.component.ts:1009-1013` | The 633 tray-chip role is served by the same bubble body that Phase B moves onto the store tree |
| DI guard specs per host | `apps/ptah-extension-vscode/src/di/{rpc-surface,surface-composition,container.smoke}.spec.ts`; `apps/ptah-electron/src/di/{rpc-surface,surface-composition,container.smoke}.spec.ts`; `libs/backend/cli-engine/src/lib/surface-composition.spec.ts`; `subagent` manifest entry `requires: []` (`manifest.ts:326-331`) = all hosts | All seven run for B2 and B6 |
| Workflow agents live under `subagents/workflows/<runId>/` | `libs/backend/agent-sdk/src/lib/helpers/workflow-transcript-reader.ts:51`, `:87` | The per-agent read must use this locator too (parity with today's transcript) |
| `subagent:transcript` reads the same JSONL and drops tools/thinking | `subagent-message-dispatcher.ts:427-506` | The text path is redundant once the structured read exists |
| CLI lanes already render a flat event array with `ptah-execution-node` | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:107-111`, `:161-176` | Same renderer for lanes and main agent is already the CLI pattern |
| CLI lane persisted output pattern: one bulk key per agent + paged RPC, 128 KB default page, 256 KB RPC cap | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:180`, `:902-1029`, `:260`; `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1075-1102` | Page-size and error conventions for the new per-agent read |
| Retention constants | `agent-output-retention.ts:399` (`MAX_AGENT_STREAM_EVENTS = 2000`, not exported), `:472` (`capStreamEventsInPlace`); `chat-types.ts:207` (`STREAMING_EVENT_CAP = 5000`); `execution-tree-retention.ts:74, :84, :95, :157` (24 KB / 16 KB / 256 KB, `capFinalizedTree`); `agent-monitor.store.ts:88` (`MAX_COMPLETED_AGENTS = 20`); `history-page.utils.ts:10` (`HISTORY_PAGE_MAX_EVENTS = 2000`) | All retention numbers below reuse existing constants |
| Subagent record keyed by `parentToolUseId`; pending identity already merged | `agent-monitor.store.ts:531-545`, `:727`, `:2057-2104`, `:2698-2713` | 633 identity: key everything by `toolCallId`; `agentId` is needed only for the history read |
| `SubagentRecord` has `durationMs` (SDK) but no start/end time | `agent-monitor.store.ts:580`; roster sets `startedAt: null` for subagents `session-agent-roster.ts:144-145` | Subagent chip/hover show no duration; add timestamps from event `timestamp` (`stream.ts:66`) |
| Duration bug: restored CLI lane has no end time; card ticks `Date.now() - startedAt` | `agent-card.component.ts:157-164`; `inspector-agents-section.component.ts:329-342`; `agent-monitor.store.ts:1708-1736`; `CliSessionReference` `agent-process.types.ts:502-533` | One helper; finished-without-end shows `Worked` |
| `AgentProcessInfo.completedAt` exists and is stamped at exit | `agent-process.types.ts:133`; `agent-process-manager.service.ts:1946`, `:2186`, `:2345-2358` | Persisting it in the reference is one optional field |
| Reference built in one place; restore passes unknown fields through | `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:422-441`; `session-metadata-store.ts:381-397` | Additive field needs no migration |
| Shared formatter and main-chat label rule | `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-duration.ts:11-23`; `libs/frontend/chat/src/lib/utils/turn-facts.utils.ts:233-251` | Label rule `Working · X` / `Worked for X` / `Worked` |
| Second formatter in use | `agent-card.utils.ts:13-26` (`formatElapsed`); callers `agent-card.component.ts:160,163`, `inspector-agents-section.component.ts:342`; `stats-bar.utils.ts:41` (`formatDuration`) | Retire both for `formatAgentDuration` |
| Tab chip / hover card helper lives in canvas | `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts:92-104` | Move the rule to chat-ui so chat and canvas share it (canvas depends on chat, not the reverse) |
| Disclosure row component | `libs/frontend/chat/src/lib/components/molecules/turn/turn-disclosure-row.component.ts:28-152` | Reuse for the header row; extend meta with optional inputs |
| Subagent actions already shared outside the bubble | `session-agent-tray.service.ts:83-98` (steer/stop/background), `session-agent-tray.ts:160-182`, `:207-240` (flags); `ptah-agent-steer-input` `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.ts:24`, used at `inspector-agents-section.component.ts:240-253` | Lane header actions reuse the tray service + steer input; no copy of bubble logic |
| Shared 1 s tick | `agent-monitor.store.ts:798` (`tick`), read at `agent-card.component.ts:162` | Header live timer needs no new timer |
| Consumers of agent-node children | `message-summary.utils.ts:83-104` (turn tool/file counts), `subagent-tile.component.ts:77-96`, `inline-agent-bubble.component.ts:853-873`, `transcript-agent-facts.ts:93-100` | Children leave the main tree; each consumer is re-sourced or listed as a proposed removal |
| `AGENT_SUMMARY_CHUNK` writes subagent text into the tab state | `chat-lifecycle.service.ts:32-37`; `message-constants.ts:197`; `agent-node.fn.ts:84` | Parallel subagent-content path; kept (proposed removal P3) |
| Session/tab cleanup site | `libs/frontend/chat-routing/src/lib/stream-router.service.ts:292-293`, `:957-959` | New store clears here |
| RPC registration via manifest, `subagent:` prefix allowed, all hosts | `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:326-331`; `rpc-handler.ts` `ALLOWED_METHOD_PREFIXES` (`'subagent:'`, per Explore at `:85`); `rpc-allowlist.spec.ts:41-80`; `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:203-215` | A new `subagent:*` method needs only `METHODS`, registry entry and `RPC_METHOD_ENTRIES` |
| History reader token registered in the shared SDK registration | `libs/backend/agent-sdk/src/lib/di/tokens.ts:29`; `di/register.ts:203` | No new DI service; `container.smoke` / `expected-resolvable` unchanged |
| Host-source baseline guard only checks names matching `turn|recap|ptah-?ui|change-?set|host-?source|turn-?tests|usage` | `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-55` | New method name must avoid those words; baseline file is not edited (Gate 2 rule, `host-source-registry.baseline.ts:1-5`) |
| 683 B6 edits in lane view: style block, outer panel `div` classes, `fade` signal and its rAF effect | `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion` working diff of `canvas-lane-view.component.ts` | Phase A/B edits stay inside the `@case` bodies, the `#subagentLane` template, imports and the transcript members |

## Architecture decision

- Chosen approach:
  - **Phase A.** One presentational `ptah-execution-header` (disclosure row from
    `TurnDisclosureRowComponent` + one action place + a details region). The CLI lane gets it
    through `AgentCardComponent` in `flat` presentation; the subagent lane gets it through a new
    `ptah-subagent-lane` component. One duration rule (`agentRunDurationMs` / `agentRunLabel`)
    in chat-ui next to `formatAgentDuration`, used by the lane header, tab chip, hover card,
    inspector, agent card and the main chat bubble footer. `CliSessionReference.completedAt` is
    persisted.
  - **Phase B.** A root `SubagentExecutionStore` (chat-streaming) owns one `StreamingState` per
    SDK subagent, keyed by the Task `toolCallId`. `StreamingHandlerService` claims every
    subagent-owned event before the tab path and the store feeds it to the existing
    `AccumulatorCoreService` (same dedup, same accumulation as the main agent). The tree is
    built by the existing `ExecutionTreeBuilderService` with a new root-parent option and
    rendered by `ptah-execution-node` in the lane, in the main chat bubble and in the agent
    monitor panel. Finished subagents are finalized like a main turn (`capFinalizedTree`) and
    LRU-retained; restored or evicted subagents are rebuilt on demand from the SDK JSONL through
    a new paged RPC `subagent:history-page`. Then the approved removals run.
- Rationale: decision 1 (same stream and renderer as the main agent) is met by reusing the main
  accumulator and tree builder rather than the CLI-lane builder, which ignores
  stream/complete dedup (`agent-monitor-tree-builder.service.ts:500-564` handles no `source`).
  Decision 2/5 (out of the main tree, memory) is met because subagent events never enter the
  tab state, finished trees are capped and count-bounded, and restored subagents are not
  materialized until opened. Decision 4 is met from the SDK's own JSONL, which already holds
  the structured events, so no second copy is stored. 633 is met because the store does not
  depend on the tab's turn lifecycle.
- Rejected alternatives:
  - *Persist subagent events in `ptah.agentOutput:<id>` like CLI lanes.* Duplicates data the SDK
    already writes, adds a write at subagent exit and cannot cover subagents from sessions that
    predate the change, which is the case decision 4 names.
  - *Buffer subagent events as a flat array and build with `AgentMonitorTreeBuilderService`.*
    SDK subagents emit both `stream` deltas and `complete` messages; that builder has no
    replacement logic, so text would double.
  - *Keep subagents in the main tree and only find them faster.* Violates decision 2.
  - *Materialize restored subagents from the `chat:resume` / `chat:history-page` payload.* Pages
    can split one subagent's events, and every restored subagent would be held in memory.
  - *A separate `transcriptDelta` push* (633 prior proposal). Not needed: events already arrive.
- Assumptions (each has a check in the owning component):
  - A1 `computeTreeDigests` attributes a root message whose `parentToolUseId` has no
    `tool_start` in the same state to itself.
  - A2 `EventDeduplicationService.isMessageAlreadyFinalized` / `handleDuplicateMessageStart`
    behave correctly when one session's events are split over the tab state and several
    subagent states.
  - A3 Live subagent `messageId`s equal the Anthropic `message.id` stored in the subagent JSONL,
    except a synthesized start (`stream-event.transformer.ts:158-159`, `:205-216`), whose
    stream events keep `uuid` / `stream-msg-*` while its `complete` events use `message.id`
    (`assistant-message.transformer.ts:88`). The merge does not depend on A3 holding (component
    7 fallback match); A3 only decides how often the fallback runs.
  - A4 Workflow-run subagent events carry `parentToolUseId` equal to the record key.
  - A5 `ClaudeRpcService.call` enforces a timeout for the new RPC.
  - A6 Subagent JSONL stores one line per content block, in content order, all lines of one
    API message sharing `message.id`, and a block line is written only when the block is
    complete. Check: the fixtures in `libs/backend/agent-sdk/src/lib/helpers/history/__fixtures__`
    and one real `subagents/agent-*.jsonl`; if a line holds several blocks, the block index is
    the running position across the lines of that `message.id` either way.
  - A7 Live `stream` deltas carry the SDK content-block index as `blockIndex`, equal to
    `contentIndex` of the `complete` message (`assistant-message.transformer.ts:119-149`).
    Check: `stream-event.transformer` spec for `content_block_delta`.
  - A8 `SessionManager.registerAgent` is idempotent for a repeated `toolCallId` (the merge
    rebuild re-feeds a nested `agent_start`). Check its spec; if not, the merge context skips
    `agent_start` re-registration too.
  - A9 (withdrawn in round 2: no merge rule uses timestamps for identity any more; JSONL
    timestamps only order snapshot events.)
  - A10 (withdrawn in round 3: no rule depends on stream/complete ordering any more.)
- 633 tray-chip criterion ("outside the canvas, the background-agent tray chip opens or
  focuses the same view"): **covered, no removal proposed.** The tray chip itself is gone; the
  outside-canvas entry points that replaced it are the turn agent chips
  (`turn-agent-chips.component.ts:96`), the subagent tile (`subagent-tile.component.ts:99-102`)
  and the inspector AGENTS row (`inspector-agents-section.component.ts:389-397` →
  `chat-view.component.ts:1009-1013`). All call `SESSION_CARD_ACTIONS.openLane(key)`: in the
  Rail it focuses the canvas lane (component 9 lane), in the single chat view it opens the
  agent node in place (`chat-transcript.component.ts:933-958`, rendered by
  `single-chat-subagent-view.component.ts:79-80` through `ptah-execution-node` → the bubble).
  Phase B makes both targets render `SubagentExecutionStore.treeFor(toolCallId)` (component 9),
  so every entry point opens the same live view, pending identity included (the store is keyed
  by `toolCallId`). Verification: component 9 adds a `chat-transcript.component.spec.ts` case
  (chip click → in-place view shows store output that arrived after the parent turn) and keeps
  the canvas lane case. No code change to the entry points themselves.
- Effect on existing code: the main tree keeps the agent node (header, status, summary) but no
  longer contains subagent messages. `subagent:transcript`, the overlay, the viewer service and
  component, the lane fallback and every "View transcript" action are deleted. Agent card `card`
  presentation (agent monitor sidebar, tribunal vendor card) keeps its header; only `flat`
  changes. CLI lanes (including ptah-cli nested subagents) keep their data path.

## Component specifications

### Phase A

### 1. Agent run duration rule (`agentRunDurationMs`, `agentRunLabel`)

- Purpose: one duration value and one label rule for every agent surface.
- Responsibilities:
  - `agentRunDurationMs({ running, startedAt, endedAt, reportedMs }, now)`: running → `now -
    startedAt`; finished with both ends → `endedAt - startedAt`; finished without end →
    `reportedMs` when finite, else `null`. Never `now - startedAt` for a finished run.
  - `agentRunLabel(run, now)`: `Working · X` / `Working` while running, `Worked for X` /
    `Worked` when finished, `X` from `formatAgentDuration` (null under 1 s), same wording as
    `turnElapsedLabel` (`turn-facts.utils.ts:233-251`).
  - `agentDurationMs` / `agentDurationText` in `dock-overflow.ts:92-104` delegate to it.
  - Inspector rows use it for both kinds and `formatAgentDuration` only
    (`inspector-agents-section.component.ts:329-349`); the CLI-only `aria-label` special case
    goes away.
  - `AgentCardComponent.elapsedDisplay` (`agent-card.component.ts:157-164`) and the card-mode
    stats bar (`cli-agent-output.component.ts:71-75`, `stats-bar.utils.ts:41`) use
    `formatAgentDuration`. `formatElapsed` (`agent-card.utils.ts:13-26`) and `formatDuration`
    are deleted once they have no caller.
  - `SubagentRecord` gains `startedAt?` (from `agent_start` / first event `timestamp`) and
    `completedAt?` (from `agent_completed`, `onTaskToolResult` or background completion
    timestamp) in `agent-monitor.store.ts`; the roster fills `startedAt` / `endedAt` for
    subagent rows (`session-agent-roster.ts:144-145`). `loadCliSessions` maps
    `ref.completedAt` (component 2).
  - Main chat bubble footer duration (`inline-agent-bubble.component.ts:519-521`) reads the
    record through the rule; it hides at `null` (fixes the `3ms` / `0ms` capture defect).
- Verified contracts and entry points: `formatAgentDuration` `agent-duration.ts:11`;
  `SessionAgent.startedAt/endedAt` `session-agent-roster.ts:34-35`; `AgentStartEvent`
  `stream.ts:179`, `FlatStreamEvent.timestamp` `stream.ts:66`.
- Dependencies: chat-ui (no new deps); canvas and chat import from `@ptah-extension/chat-ui`
  (already allowed: canvas imports chat-ui at `canvas-lane-view.component.ts:29-32`).
- Integration points: lane header (3), tab chip `canvas-lane-tabs.component.ts:230-268`, dock
  menu `agent-dock-menu.component.ts:200`, hover card, inspector, agent card, bubble footer.
- Failure behaviour: non-finite or negative input → `null` → label `Worked` / no badge.
- Quality requirements: no new timer; ticking surfaces keep their existing tick sources.
- Verification seam: unit specs for the two functions (running, finished with end, finished
  without end with and without `reportedMs`, < 1 s); inspector spec
  (`inspector-agents-section.component.spec.ts:101-102` switches to `formatAgentDuration`);
  dock-overflow spec; roster spec for subagent timestamps; regression spec "restored CLI lane
  without end time shows `Worked`, not lane age".
- Files:
  - MODIFY `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-duration.ts` (+ spec)
  - MODIFY `libs/frontend/chat-ui/src/index.ts` (export, if not already exported)
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts` (+ spec)
  - (`agent-card.component.ts` `elapsedDisplay` is done by component 3a's batch A3, which owns
    that file; A3 runs after A1. `formatElapsed` is deleted in A3 once its last caller there is
    gone; A1 deletes only the inspector caller.)
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts`, `stats-bar.utils.ts` (+ specs)
  - MODIFY `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts` (+ spec;
    also exports `cliActivity` for component 3a, so A3 does not touch this file)
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts` (footer only)
  - MODIFY `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` (+ spec)

### 2. Persisted CLI run end time (`CliSessionReference.completedAt`)

- Purpose: a restored CLI lane shows its real run time.
- Responsibilities: add optional `readonly completedAt?: string` (ISO) to
  `CliSessionReference` (`agent-process.types.ts:502-533`); set it from
  `info.completedAt` in the reference literal (`agent-events.ts:422-441`) when present;
  `loadCliSessions` maps it to `MonitoredAgent.completedAt` (epoch ms, `NaN` → absent).
- Verified contracts: `AgentProcessInfo.completedAt` `agent-process.types.ts:133`; reference
  writer `agent-events.ts:333-477`; restore pass-through `session-metadata-store.ts:381-397`.
- Dependencies: shared ← cli-agent-runtime, chat-streaming (existing direction).
- Integration points: `session:cli-sessions` result (no schema validation of the reference
  exists; `CliSessionReferenceSchema` not found).
- Failure behaviour: absent or unparsable → card has no `completedAt` → label `Worked`.
  Older sessions keep working.
- Quality requirements: field is a 24-char string; the blob size rule in
  `session-metadata-store.ts:20-30` (ids and status only) still holds.
- Verification seam: `agent-events` spec asserts the field on exit persistence;
  `agent-monitor.store` spec asserts the mapping and the absent case.
- Files:
  - MODIFY `libs/shared/src/lib/types/agent-process.types.ts`
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts` (+ its spec)
  - MODIFY `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` (`loadCliSessions`; owned by the same batch as component 1, see handoff)

### 3. Execution header (`ptah-execution-header`)

- Purpose: the one disclosure-row header for CLI lanes and subagents (prototype section 1-2).
- Responsibilities:
  - Row: `ptah-turn-disclosure-row` (label, pulse dot while live, chevron, live-only peek,
    meta). Extend `TurnDisclosureRowComponent` with two optional inputs, defaults keeping the
    main chat identical: `extraMeta: readonly string[]` (appended after tools/files, e.g.
    `48.2k tokens`, `≥ 108.0k tokens`, `Background`, `Resumed`, `Interrupted`) and
    `metaTone: 'muted' | 'warning'` (guard stop reason). Accessible name includes them.
  - Action place: projected `[executionHeaderActions]` slot to the right of the row button
    (sibling, not nested, as in the prototype `.actions`).
  - Details: projected default content inside a region with the row's `controlsId`, shown when
    open; closed by default.
  - Inputs: `kind: 'cli' | 'subagent'`, `label`, `live`, `peek`, `toolCount`, `filesChanged`,
    `extraMeta`, `metaTone`, `controlsId`; model `open`.
- Verified contracts: `TurnDisclosureRowComponent` inputs `turn-disclosure-row.component.ts:102-127`,
  meta `:140-151`.
- Dependencies: chat molecules only.
- Integration points: `AgentCardComponent` (flat) and `SubagentLaneComponent` (4).
- Failure behaviour: presentational; empty meta hides the meta span.
- Quality requirements: 30 px row (`h-[30px]`); keyboard: row button toggles, actions are
  buttons with `aria-label` naming the agent (`Stop codex`, `Resume codex session`, `Send
  Explore to background`, `Message Explore`); ticking timer and peek stay `aria-hidden`
  (already in the row); reduced motion respected by the row's chevron rule. No animation added
  (683 owns lane motion).
- Verification seam: component spec (label/meta/tone/open/aria-controls); main chat
  `turn-disclosure-row` spec proves defaults unchanged.
- Files:
  - CREATE `libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/turn/turn-disclosure-row.component.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/components/index.ts` (export)

### 3a. CLI lane header (inside `AgentCardComponent`, `presentation="flat"` only)

- Purpose: CLI lane uses component 3; card presentation unchanged.
- Responsibilities (flat only):
  - Replace `ptah-agent-card-header`, the top-level `ptah-cli-lane-usage-summary` and the
    `Task` `<details>` (`agent-card.component.ts:54-105`) with `ptah-execution-header`.
  - Label from component 1 (`running` ↔ `status === 'running'`, `startedAt`, `completedAt`).
  - Peek: `cliActivity` from `session-agent-roster.ts:74` (export it).
  - Meta: tools/files from the lane tree (new pure `summarizeExecutionNodes(nodes)` next to
    `extractMessageSummary` in `message-summary.utils.ts`, same walker `:83-104`); tokens from
    `usageTotals` or `usageTotalsFromSegments` (`stats-bar.utils.ts:76`) with `≥` when partial;
    guard stop reason from `laneGuardStopText` (`agent-card-header.component.ts:29`) with
    `metaTone="warning"`.
  - Actions: Stop while running, Resume when finished with `cliSessionId` (existing
    `stopAgent` / `resumeAgent`, `agent-card.component.ts:203-233`).
  - Details: `ptah-cli-lane-usage-summary` (moved; its `duration` input is removed, the card
    path keeps its own elapsed in the header), facts list Model, Task, CLI session, Parent.
  - The tree for meta comes from `AgentMonitorTreeBuilderService.buildTree(agentId, events)` /
    `buildTreeFromSegments`, which memoizes per agent (`agent-monitor-tree-builder.service.ts:173-233`),
    so the card and `CliAgentOutputComponent` share one build.
- Failure behaviour: no usage → no token meta (never `0`); no model → fact omitted.
- Verification seam: `agent-card-unified.spec.ts` / new flat-header spec: no status badge, one
  duration, Resume/Stop in the action place, details hold usage, model, task, parent, CLI
  session; card presentation snapshot unchanged.
- Files:
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts` (+ specs; includes component 1's `elapsedDisplay` change for card presentation)
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.utils.ts` (+ `agent-card.utils.spec.ts`; delete `formatElapsed` here)
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/utils/message-summary.utils.ts` (+ spec)
  - (`cliActivity` is exported from `session-agent-roster.ts` by batch A1.)

### 4. Subagent lane (`ptah-subagent-lane`)

- Purpose: the subagent lane body without bubble chrome, with component 3 as header.
- Responsibilities:
  - Inputs: `record: SubagentRecord`, `sessionId: string | null`; Phase A also `nodes:
    readonly ExecutionNode[]` (the agent node's children found by the lane view); Phase B
    replaces `nodes` with the store (component 7).
  - Label from component 1 (live = `running | pending | background`); peek from a pure
    `subagentProgressText(record)` (logic of `inline-agent-bubble.component.ts:925-932`).
  - Meta: tools/files from `summarizeExecutionNodes(nodes)`, falling back to
    `record.toolUses`; tokens from `record.totalTokens`; `Background` when
    `status === 'background'`.
  - Actions: from `SessionAgentTrayService.contextsFor(sessionId).get(record.parentToolUseId)`;
    Background when `entry.canBackground`, Stop when `entry.stoppable`, Message when
    `entry.steerable` (opens `ptah-agent-steer-input` below the row; submit →
    `tray.steer`); command failures show the store's `subagentRpcError` for this key
    (`agent-monitor.store.ts:593-603`) under the row, as the bubble does today
    (`inline-agent-bubble.component.ts:363-372`).
  - Details: `ptah-subagent-usage-summary` (moved), facts Model (`record.usage?.model`),
    Task (`record.description`), Parent (`record.parentSessionId`, first 8 chars + title).
  - Body: `@for (node of nodes)` → `ptah-execution-node` with `getPermissionForTool` and
    `permissionResponded` passed through (as `canvas-lane-view.component.ts:149-154`).
- Dependencies: chat (tray service, steer input from chat-ui, `ExecutionNodeComponent`).
- Integration points: `canvas-lane-view.component.ts` `#subagentLane` (`:144-171`) renders it;
  Phase A keeps the transcript fallback branch beside it until batch B5.
- Failure behaviour: no tray context (finished) → no actions; empty `nodes` while running →
  "Starting agent" line; finished and empty → "No output recorded".
- Quality requirements: same keyboard and aria rules as component 3; steer input keeps its
  existing focus behaviour.
- Verification seam: component spec (actions by flags, steer success/failure, error line,
  details content); lane-view spec updated for the new element.
- Files:
  - CREATE `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts` (+ spec)
  - CREATE `libs/frontend/chat/src/lib/utils/subagent-progress.utils.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/components/index.ts`, `libs/frontend/chat/src/index.ts` (exports, as needed)
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (`#subagentLane` only; + spec)

### Phase B

### 5. Root-only turn boundary in the broadcaster (backend, 633)

- Purpose: background subagent messages after the parent `result` must not re-send
  `chat:complete` nor reset the turn gate.
- Responsibilities: at `chat-stream-broadcaster.service.ts:269-271` reset `turnCompleteSent`
  only for `message_start` without `parentToolUseId`; at `:284` send `CHAT_COMPLETE` only for
  `message_complete` without `parentToolUseId`. Subagent events are still published (`:262`).
- Verified contracts: `MESSAGE_TYPES.CHAT_COMPLETE` `message-constants.ts:130`.
- Failure behaviour: unchanged; the end-of-stream fallback `:299-307` still sends one complete.
- Verification seam: broadcaster spec: (a) subagent `message_start`/`message_complete` after the
  parent's complete send no second `chat:complete`; (b) a subagent `message_complete` before the
  parent's does not complete the turn early; (c) root behaviour unchanged.
- Files: MODIFY `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts` (+ spec)

### 6. Per-agent structured history read (`subagent:history-page`, backend)

- Purpose: rebuild one subagent's structured events from the SDK JSONL, paged; replaces the
  text-only `subagent:transcript` for UI use.
- Contract (types in `libs/shared/src/lib/types/subagent-registry.types.ts`, registry entry in
  `rpc.types.ts` next to the `subagent:*` block `:1176-1195` and `RPC_METHOD_ENTRIES` `:3865-3869`):
  - `SubagentHistoryPageParams { sessionId: string; toolCallId: string; agentId?: string;
    cursor?: string; maxBytes?: number }` (`agentId` optional: finding 4)
  - `SubagentHistoryPageResult { status: 'ok' | 'not-found' | 'unresolved'; agentId: string |
    null; events: FlatStreamEventUnion[]; nextCursor: string | null; done: boolean;
    truncated: boolean; clippedEvents: number }`. `not-found` = agent id known but no JSONL
    (never written or pruned); `unresolved` = no `agentId` given and correlation found none;
    `truncated` = older events dropped (tail kept); `clippedEvents` = events on this page whose
    payload was shortened by the per-event caps below.
  - Name check: contains none of the host-source words, so the baseline contract spec stays green.
- Responsibilities:
  - Handler `registerHistoryPage()` in `SubagentRpcHandlers`, added to `METHODS`
    (`subagent-rpc.handlers.ts:83-90`) and `register()` (`:108-119`); zod schema in
    `subagent-rpc.schema.ts` beside `SubagentTranscriptSchema` (`:86-95`) with
    `toolCallId` and the optional `agentId` restricted to `^[A-Za-z0-9_-]{1,128}$` (the agent id
    becomes a file name; a correlated id is checked against the same pattern before the join), `sessionId` validated like other session params, `maxBytes` 1024..262144
    (`session-rpc.schema.ts:65-72` precedent), default 128 KB.
  - `SessionHistoryReaderService.readSubagentEvents(sessionId, toolCallId, agentId?)`:
    - Agent id: use `agentId` when given; otherwise resolve it from `toolCallId` with the
      existing `AgentCorrelationService.correlateAgentsToTasks` over the parent session's
      Task tool uses and agent files (`agent-correlation.service.ts:172-240`, same inputs as
      `session-replay.service.ts:113-121`). No match → `status: 'unresolved'`. The resolved id
      is returned in `agentId` so the frontend stores it on its entry.
    - Locate `<session>/subagents/agent-<agentId>.jsonl`, then legacy flat, then
      `findWorkflowAgentTranscript` (`workflow-transcript-reader.ts:51`); none →
      `status: 'not-found'`. Parse with the existing JSONL reader.
    - Convert with a new public
      `SessionReplayService.replayAgentToStreamEvents(sessionId, toolCallId, messages)` that
      reuses `processAgentMessages` (`session-replay.service.ts:496`) with three changes, all
      behind a private per-call option so main-history replay keeps its ids and timestamps:
      (a) `messageId` = JSONL `message.id`, and consecutive JSONL lines that share it form one
      message (one `message_start`); (b) `blockIndex` = the block's running position across
      those lines (Assumption A6), so it lines up with live `blockIndex` (A7); (c) event
      `timestamp` = JSONL `timestamp` when present. Synthetic ids/timestamps only as fallback.
    - **Thinking (finding 1):** `processAgentMessages` gains a `thinking` branch in content
      order, using a new `HistoryEventFactory.createAgentThinkingDelta` (same shape as
      `createThinkingDelta` `history-event-factory.ts:157-175` plus `parentToolUseId`, as
      `createAgentTextDelta` `:338-358`). This branch is unconditional: main-history replay
      also gains subagent thinking, matching the live tree (live subagent thinking arrives via
      `assistant-message.transformer.ts:121-133`). After component 8 the webview discards
      those main-history events anyway. Empty `thinking` is skipped like empty text.
  - **Per-event caps (finding 3; serialized-size rule from r2 finding 2).** All sizes are
    the UTF-8 byte length of the JSON encoding, measured as the existing CLI output page does
    (`new TextEncoder().encode(JSON.stringify(...)).length`, `session-metadata-store.ts:342-352`),
    never a character count of the raw string (JSON escaping can grow text up to 6×, e.g.
    `` for each control character; non-ASCII grows in UTF-8).
    1. Content budgets first (display fidelity, character-based, as the finalized tree does):
       a `tool_result` output above 24 KB and a `tool_start` input whose JSON exceeds 16 KB keep
       head + 2 KB tail with an inline `… [N characters omitted]` marker (budgets and tail of
       `MAX_RETAINED_TOOL_OUTPUT_CHARS` / `MAX_RETAINED_TOOL_INPUT_CHARS` /
       `RETAINED_PAYLOAD_TAIL_CHARS`, `execution-tree-retention.ts:74`, `:84`, `:104`; backend
       constants with a comment naming those, since the backend cannot import the frontend
       lib); a `text_delta` / `thinking_delta` above 96 K characters keeps head + 2 K tail.
    2. Hard byte cap second: `MAX_HISTORY_EVENT_BYTES = 96 KB` on the serialized event. If an
       event still exceeds it, the clip is recomputed on the serialized form: binary-search the
       kept head/tail character counts of the event's largest string field (`delta`, `output`,
       or the largest string inside `toolInput`) until the encoded event fits; if no string
       field remains to shrink, `toolInput` becomes `{ omitted: true, characters: N }` and an
       `output` becomes the marker alone. The search always terminates because an empty field
       plus marker is a few hundred bytes. Each clipped event counts once in `clippedEvents`.
  - Paging (r3 finding 2: full wire envelope). Events in source order; the page unit is the
    event, not the message (the store accumulates every page into one state before it merges,
    component 7, so a message split over two pages is harmless). The budget follows the CLI
    output page exactly (`session-metadata-store.ts:260-262`, `:342-353`, `:991-1005`,
    `:1025-1027`):
    - `rpcBytes = min(maxBytes, MAX_RPC_RESPONSE_BYTES = 256 KB)`.
    - The measured shape is the emitted response, `{ success: true, data: result,
      correlationId }`, with `correlationId` reserved as a 64-character string
      (`RPC_CORRELATION_ID_BUDGET`) and the cursor as a 32-character string
      (`RPC_CURSOR_RESERVATION`); `result` carries every field of
      `SubagentHistoryPageResult` (`status`, `agentId` at its 128-character maximum, flags,
      `clippedEvents`). Measure = UTF-8 bytes of `JSON.stringify` via `TextEncoder`.
    - `envelopeBytes` = that shape with `events: []`; `eventBudget = rpcBytes - envelopeBytes`;
      `eventBudget <= 0` throws (same as `:1001-1005`).
    - Add events while the running total of encoded event bytes plus one comma per event stays
      ≤ `eventBudget` and the count ≤ `HISTORY_PAGE_MAX_EVENTS` (2000). A page always holds at
      least one event: one ≤ 96 KB event plus the envelope (< 1 KB) is < 256 KB, so it may pass
      a small `maxBytes` but never the hard cap.
    - Final check before return: re-measure the exact page with the same reservations; if it is
      over `rpcBytes` (only possible for a page of more than one event), drop events from the
      end and recompute `nextCursor` / `done` from the new last index until it fits; a
      one-event page is over only if the hard cap is (cannot happen: logged as a bug and the
      error `Agent output page exceeds RPC budget` is raised, matching `:1025-1027`).
    The cursor (opaque event index) always advances, also for a page of one clipped event, and
    no event is skipped. `truncated` when the source had more than 10 000 events (5 × 2000);
    the newest 10 000 are paged, matching the live cap's tail bias.
  - Inject `SDK_TOKENS.SDK_SESSION_HISTORY_READER` into `SubagentRpcHandlers` (token
    `tokens.ts:29`, registered `register.ts:203`).
- Failure behaviour: invalid params → `RpcUserError('INVALID_PARAMS')`; file not found or
  pruned by SDK retention → `{ status: 'not-found', events: [], done: true }` (not an error,
  and not the same as an agent that wrote nothing: `status: 'ok'` with no events); no agent id
  resolvable → `status: 'unresolved'`; read/parse failure → `RpcUserError` with a user-safe
  message (`Could not read agent output`), logged with session/agent ids only; never a path in
  the message. A malformed JSONL line is skipped by the existing reader and does not fail the
  page.
- Quality requirements: response ≤ 256 KB (`MAX_RPC_RESPONSE_BYTES`); file size limit follows
  `MAX_SESSION_FILE_SIZE` (50 MB, `jsonl-reader.service.ts:118`); no cache beyond the reader's
  existing transcript cache (`:167`, `:184`).
- Verification seam: reader spec with fixtures (subagents dir, legacy flat, workflows dir,
  missing file → `not-found`, oversized file, no `agentId` resolved by correlation, no `agentId`
  and no match → `unresolved`); replay spec: a JSONL fixture with thinking, text, `tool_use`
  and `tool_result` in one message yields, in order, `message_start`, `thinking_delta`,
  `text_delta`, `tool_start`, `tool_result` with the real `message.id`, running block indices
  and JSONL timestamps; the same fixture through main-history replay now contains the thinking
  event under the agent and is otherwise unchanged; handler spec: schema rejects `../`, paging
  advances on a single 300 KB text block, a single 1 MB tool result, and an escape-heavy text
  block of 90 000 `` control characters (below the 96 K character budget, ~540 KB
  encoded) plus one of 90 000 multi-byte characters: each is one page, clipped on its encoded
  size, `clippedEvents: 1`, encoded envelope ≤ 256 KB (asserted with the same
  `TextEncoder`/`JSON.stringify` measure), `nextCursor` moves on; a `maxBytes: 1024` request
  still returns one event per page and terminates; a page whose events nearly fill 256 KB
  (many 20-30 KB events, default `maxBytes` 256 KB) measured with a real 36-character and a
  64-character `correlationId` stays ≤ 256 KB in both, and the final-check cut-back path
  (tested on the pure page-assembly function with a small `rpcBytes`) drops the last event
  and recomputes `nextCursor`; a page of one 96 KB encoded event plus the full envelope is < 256 KB; status `ok` empty vs
  `not-found` vs `unresolved` vs error. Guard specs: see Verification points (seven specs).
- Files:
  - MODIFY `libs/shared/src/lib/types/subagent-registry.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` (+ spec)
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` (+ spec)
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts` (+ `history-event-factory.spec.ts`)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts`, `subagent-rpc.schema.ts` (+ `subagent-rpc.handlers.spec.ts`)

### 7. Subagent execution store (`SubagentExecutionStore`, frontend, 633 core)

- Purpose: one independent live execution tree per SDK subagent, outside the tab tree, bounded.
- Responsibilities:
  - Entry per key (`toolCallId`): `{ state: StreamingState | null; finalized: ExecutionNode[];
    sessionId?; agentId?; live: boolean; truncated: boolean; spilled: boolean; clipped: number;
    history: 'idle' | 'loading' | 'loaded' | 'not-found' | 'unresolved' | 'error';
    historyError?: string; generation: number; lastEventAt: number; refs: number;
    idAlias: Map<string, string>; revision: number }`, exposed through signals. `agentId` is
    taken from `record.agentId`, else from a history result's `agentId`.
  - `claim(event): boolean` — ownership rules:
    1. `message_start` with `parentToolUseId = P` → owner = `toolOwner.get(P) ?? P`.
    2. Any event whose `messageId` has an owner → that owner; a `tool_start` inside an owned
       message records `toolOwner[toolCallId] = owner`.
    3. `agent_start` whose `toolCallId` is owned → claimed (nested agent); a root
       `agent_start` is NOT claimed (it builds the main-tree agent node) but opens the entry.
    4. Otherwise, a non-store-only event with `parentToolUseId = P` where `P` has an entry or
       an owner → claimed (covers events arriving mid-message after a webview reload).
    5. Store-only types (`streaming-handler.service.ts:66-75`) are never claimed.
  - Claimed events run through `AccumulatorCoreService.process(entry.state, event, ctx)` with the
    shared `deduplication`, `backgroundAgentStore`, `agentMonitorStore`, and an
    `onStateChanged` that bumps the entry revision; this keeps the store side effects of
    `:227-235`, `:449-456`, `:497-498`, `:537-538` unchanged.
  - Per-entry event cap 2000 (same value as `MAX_AGENT_STREAM_EVENTS`): add optional
    `eventCap?: number` to `StreamingState` (`chat-types.ts:64-178`), read by
    `setStreamingEventCapped` (`:259-303`), default `STREAMING_EVENT_CAP`. FIFO eviction sets
    `truncated`.
  - `treeFor(key)`: `[...finalized, ...builder.buildTree(state, 'subagent-' + key, { rootParentToolUseId: key })]`.
  - Finalize when the record is terminal (`completed | failed | killed | stopped`) or the
    Task `tool_result` arrived for a foreground agent: build once, `capFinalizedTree` each
    root, drop `state`, `builder.clearCache('subagent-' + key)`. A late event re-opens a
    fresh `state`; `treeFor` concatenates.
  - Retention (finding 5). Three bounds, all count-based and checked on the write that would
    exceed them (no timer):
    1. Finalized entries: at most 20 (`MAX_COMPLETED_AGENTS` precedent,
       `agent-monitor.store.ts:88`), LRU by last read. Eviction drops tree, owner maps,
       aliases and builder cache; the entry metadata goes too.
    2. Live (unfinalized) states: per entry ≤ 2000 events (FIFO, sets `truncated`); across
       the store ≤ 10 000 live events (`MAX_LIVE_SUBAGENT_EVENTS = 2 × STREAMING_EVENT_CAP`,
       `chat-types.ts:207`). When an append would pass the store total, the unpinned live
       entry with the oldest `lastEventAt` that is not the one receiving the event is
       **spilled**: its `state` is dropped, `spilled = true`, `history = 'idle'`; its later
       events open a fresh state (bounded again by rule 2). A record that stays `running`
       forever without events (abandoned, e.g. capture S4) is therefore the first spilled. A
       spilled entry shows "Earlier output trimmed — Load full output" (`ensureHistory`).
    3. Pinned entries (`refs > 0`; views call `retain(key)` / `release(key)`) are never spilled
       or evicted. Their number is bounded by mounted views (canvas lanes, open bubbles, the
       in-place single-chat view), and each is still bounded by rule 2's per-entry cap. If only
       pinned entries remain over the total, the store logs once per key and keeps them.
    Worst case retained live payload: 10 000 events + pinned entries × 2000, against today's
    5000-event tab cap per tab that held these same events; the plan no longer claims "no
    surface holds more than before" for live data (see Quality requirements).
  - Owner maps: ≤ 4000 ids per entry (FIFO), released with the entry; `clearSession` and
    eviction release them.
  - History: `ensureHistory(key)` — single flight per key; needs `record.parentSessionId`;
    sends `agentId` when known, else lets the backend correlate (component 6). Abort and stale
    commit guard (finding 5): the call captures `generation`; `clearSession`, eviction, spill,
    and `release` to `refs === 0` while `history === 'loading'` increment `generation` and set
    `history = 'idle'`. Before requesting each next page and before the merge commit, the loader
    checks `entries.get(key) === entry && entry.generation === captured`; on mismatch it
    stops paging (no further RPC) and discards its partial state. An RPC already in flight is
    not cancellable (Assumption A5 covers only its timeout); its late response is ignored by
    the same check. Result `status` maps to `history`: `ok` → `loaded`, `not-found` →
    `not-found`, `unresolved` → `unresolved`; a returned `agentId` is stored on the entry.
    Pages are accumulated into a merge-local state (below) and merged once at `done`.
  - Snapshot/live merge (633, finding 2). Identity is the SDK message (`message.id`) plus the
    content-block index; a snapshot message from the JSONL is complete per block (A6). The merge
    builds a fresh state `F` with a **merge context**: its own `new EventDeduplicationService()`
    (`event-deduplication.service.ts:20-21`, no deps) and a new optional
    `AccumulatorContext.skipStoreEffects: true` that suppresses the store calls at
    `accumulator-core.service.ts:449-456`, `:497-498`, `:537-538` and `onAgentStart`, so a
    rebuild never double-counts usage or re-terminates records (A8 for `registerAgent`).
    1. Feed every snapshot event into `F` in snapshot order.
    2. Match live messages to snapshot messages: (a) same `messageId`; else (b) a shared
       `tool_start.toolCallId` (the SDK tool-use id on both sides; the stream path keeps the real id even for a
       synthesized message, `stream-event.transformer.ts:213-215`);
       otherwise **no match**. A match under (b) records `idAlias[liveId] = snapshotId`.
       Identity is never inferred from timing or text (r2 finding 1, r3 finding 1): a
       text-only live message with a synthesized id is never aliased to a snapshot message or
       to a later `complete` message, so its live text can never be suppressed. When
       identity is unproven, both copies stay visible (see step 6 and Risks 3).
    3. Re-feed the live state's retained events into `F` in their order, rewriting `messageId`
       through `idAlias`, and skipping only `stream`-sourced `message_start`, `text_delta`,
       `thinking_*` and `tool_*` events of a matched message whose block index (or
       `toolCallId`) already exists in the snapshot — the snapshot holds those blocks whole,
       and a `stream` delta fed after a `history` block would append to it
       (`accumulator-core.service.ts:314-319`). Live blocks the snapshot does not have yet
       (the in-flight tail) are kept. `complete`-sourced live events are always re-fed: they
       replace block text (`:273-275`), so they are idempotent. Unmatched live messages are
       re-fed whole; if their prefix was missed before the webview subscribed, the message's
       own `complete` event restores it when it arrives (same replacement rule).
    4. Commit synchronously (single JS turn, after the generation check): `entry.state = F`,
       clear the builder cache for the key; later live events go into `F` with their ids
       rewritten through `idAlias`. Events that arrived while pages were loading are in the
       live state at step 3, so none is lost.
    5. A finished entry with no live state (`state === null`, truncated or spilled) takes the
       snapshot tree as its `finalized` content: the JSONL is complete once the agent ended.
    6. No late alias (r3 finding 1). The round-2 content-prefix alias at `complete` is
       removed: it ran at the complete message's `message_start`, before any of that message's
       deltas (`assistant-message.transformer.ts:354-363`, `:413-430`; text enters the
       accumulator only per delta, `accumulator-core.service.ts:297-321`), and equal text
       cannot prove that two messages are one (the stream id is cleared at stream stop,
       `stream-event.transformer.ts:306-334`, and the complete id is chosen independently,
       `assistant-message.transformer.ts:88`). Visible-duplicate case, accepted: a live message
       with a synthesized id `S` and no tool call, whose real id `X` reaches the store through
       the snapshot or through the live `complete`, shows as two messages for the life of the
       entry. The live-only part is the same as the tab shows today for the same events (same
       accumulator); the snapshot adds no third copy, because the snapshot `X` and the live
       `complete` `X` share an id and merge by the replace rule (`:273-275`). No step of the
       store keys work to a completion point, so no event-order point remains to define.
    Order: snapshot messages first in file order, then live-only messages in arrival order
    (tree root order is `messageEventIds` insertion order,
    `execution-tree-builder.service.ts:313-321`). Deltas are never de-duplicated by content, so
    legitimate repeated deltas (two equal `text_delta`s of one block) survive in both sources.
  - `historyEventsSeen(event)` for history replay: history-sourced subagent events are not
    retained (records and usage are still updated by component 8); `ensureHistory` reloads them
    on demand.
  - `clearSession(sessionId)`: drops entries, owner maps and aliases of that session and bumps
    each dropped entry's `generation` (any in-flight `ensureHistory` then discards its result).
  - Accumulator change (B3, same file as the store's dependency): optional
    `skipStoreEffects?: boolean` on `AccumulatorContext` (`accumulator-core.service.ts:63-86`),
    default false; read only at the store-call sites listed above. Every existing caller is
    unchanged.
- Verified contracts: `AccumulatorContext` `accumulator-core.service.ts:63-86`;
  `ExecutionTreeBuilderService.buildTree` `execution-tree-builder.service.ts:279-296`,
  `clearCache` `:889`; `capFinalizedTree` `execution-tree-retention.ts:157`;
  `createEmptyStreamingState` (imported at `streaming-handler.service.ts:32`).
- Tree builder change: `buildTree(state, cacheKey, options?: { rootParentToolUseId?: string })`;
  at `:314-322` roots = message starts whose `parentToolUseId === rootParentToolUseId` when the
  option is set; nested agents build as today via `agent-node.fn.ts:44-58`. Assumption A1:
  verify `computeTreeDigests` (`execution-tree-cache.ts`) attributes those roots to themselves,
  else extend it with the same option.
- Dependencies: chat-streaming internal (store → accumulator, tree builder, AgentMonitorStore,
  ClaudeRpcService from `@ptah-extension/core`, already a chat-streaming dependency per
  `agent-monitor.store.ts` imports); chat-types (state field).
- Failure behaviour: history RPC error → entry `history: 'error'` with the message; a retry
  calls `ensureHistory` again; no automatic retry loop. Missing `agentId` (finding 4) is not
  "empty": while running, live output still renders (the store is keyed by `toolCallId`, not
  `agentId`); when history is needed the backend correlates from `toolCallId`. If it cannot,
  `history: 'unresolved'` and the view says "Saved output for this agent could not be linked"
  with Retry (a later retry can succeed once `agent_start` or correlation data arrives).
  `not-found` shows "No saved output for this agent"; only `loaded` with zero events shows "No
  output recorded". Claim exceptions are caught and logged; the event then follows the old tab
  path (fail open to today's behaviour, never drop silently).
- Quality requirements (numbers): ≤ 2000 events per live entry and ≤ 10 000 live events per
  store excluding pinned entries; finished entry ≤ `capFinalizedTree` budgets (24 KB tool
  output, 16 KB tool input, 256 KB tool payload per root message; consecutive assistant
  messages merge into one root, `execution-tree-builder.service.ts:271-273`), so 20 finished
  entries ≈ ≤ 5 MB of retained tool payload; restored subagents hold 0 bytes until opened; one
  history request in flight per key and none after a clear, eviction, spill or last release;
  page ≤ 256 KB. Finished data: today the same events are copied into each finalized message
  tree of the tab, so finished retention does not grow. Live data: the store total (10 000)
  can exceed one tab's 5000-event cap when several subagents run at once; that is the price of
  not losing output after the parent turn, and it is bounded.
- Verification seam (pure store specs, no DOM): ownership (root, nested, mid-message
  `parentToolUseId`, store-only), two concurrent agents isolated, events after the parent
  `chat:complete` and after a new parent turn still retained, close/reopen view no duplication
  (views read only), finalize + late event, LRU eviction with pinning, owner-map release,
  `clearSession`; bounds: store total over 10 000 spills the oldest unpinned live entry and
  never a pinned one, an abandoned `running` entry with no events is spilled first; abort:
  `clearSession`, eviction, spill and last `release` during a two-page load stop the second page
  request and the commit (RPC mock asserts one call, entry unchanged); history single flight;
  merge: (1) same id, live stream started before the first page returns: the message keeps
  its full prefix exactly once; (2) id mismatch (synthesized live id, real snapshot id) with a
  shared tool id: one message, tail block kept, later live `complete` replaces without
  duplicate; (3) id mismatch, text-only, fed one event at a time in the real order
  (`message_start`, deltas, `message_complete`): two distinct text-only messages A (in the
  snapshot) and B (synthesized live id, not yet in the JSONL) both stay fully visible and B's
  later deltas keep appending to B; two distinct messages with identical text both stay; the
  same message seen as synthesized `S` live and real `X` (snapshot and/or live `complete`)
  shows as two messages and stays two after `message_complete` (no content-based alias,
  pinned so a later change cannot start hiding text); (4) live tail block not in the snapshot kept; (5) repeated
  equal deltas kept; (6) usage counted once (`skipStoreEffects`); (7) finished entry with no
  live state takes the snapshot; states `loaded`-empty vs `not-found` vs `unresolved` vs
  `error` vs waiting.
- Files:
  - CREATE `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts` (+ spec)
  - MODIFY `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts` (+ spec)
  - MODIFY `libs/frontend/chat-streaming/src/lib/execution-tree-cache.ts` (only if A1 fails)
  - MODIFY `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts` (`skipStoreEffects`; + spec)
  - MODIFY `libs/frontend/chat-types/src/lib/chat-types.ts` (+ spec of `setStreamingEventCapped`)
  - MODIFY `libs/frontend/chat-streaming/src/index.ts` (export)

### 8. Claim seams (streaming handler, history builder, session cleanup)

- Purpose: subagent events never enter a tab `StreamingState`.
- Responsibilities:
  - `StreamingHandlerService.processStreamEvent`: call `subagentExecution.claim(event)` once per
    event before tab resolution, background routing (`:294-307`) and fan-out (`:314-330`);
    claimed → return `null` (no tab mutation, no state minted at `:417-431`).
  - `HistoryMessageBuilderService.accumulate` (`history-message-builder.service.ts:117-143`):
    subagent-owned history events go to `historyEventsSeen` (records/usage updated through a
    scratch accumulator run, not retained) and are not added to the scratch tab state.
  - `StreamRouterService`: call `subagentExecution.clearSession(sid)` beside
    `forceClearSessionAgents` (`stream-router.service.ts:957-959`) and beside
    `clearSessionAgents` (`:292-293`).
- Failure behaviour: see component 7 (fail open).
- Verification seam: `streaming-handler.service.spec.ts` and `streaming-handler.background.spec.ts`
  (claimed event does not create tab state; a late subagent event after finalize is retained
  in the store and nothing is minted on the tab); `history-message-builder.service.spec.ts`
  (restored tree has the agent node without subagent children; records still get usage);
  `message-finalization.service.spec.ts:731-751` stay green; stream-router spec for cleanup.
- Files:
  - MODIFY `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts` (+ specs)
  - MODIFY `libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts` (+ spec)
  - MODIFY `libs/frontend/chat-routing/src/lib/stream-router.service.ts` (+ spec)

### 9. Renderers on the independent tree

- Purpose: lane, main chat bubble and agent monitor panel render the subagent's own tree with
  `ptah-execution-node`.
- Responsibilities:
  - `SubagentLaneComponent`: drop the `nodes` input; read `store.treeFor(key)`; `retain` on
    mount; call `ensureHistory` when the entry is not live and not loaded (opening a lane is an
    explicit action); show states: live / "Starting agent" (running, empty) / loading / error
    with Retry / "No output recorded" (`loaded`, empty) / "No saved output for this agent"
    (`not-found`) / "Saved output for this agent could not be linked" with Retry
    (`unresolved`) / "Earlier output trimmed — Load full output" (truncated or spilled; the
    button calls `ensureHistory`) / "Some long outputs were shortened" (`clipped > 0`). Each
    state line is text in the lane body, announced through the lane's existing live region if
    one exists, else plain text (no new live region per item).
  - `canvas-lane-view.component.ts`: `#subagentLane` passes only `record` and `sessionId`;
    delete `agentNode` (`:245-257`), `findAgentNode`, the tree-builder and tab-manager reads used
    only by it, and the transcript members (removal R8f). Do not touch the style block, the
    outer panel `div`, `fade` or its effect (683 B6).
  - `InlineAgentBubbleComponent` (main chat keeps the bubble): body stamps
    `store.treeFor(toolCallId)` roots through the existing `nodeTemplate` (no new import, so the
    `ExecutionNode ↔ bubble` cycle stays broken, `execution-node.component.ts:349-378`); live
    entries render at once; restored entries show a "Load agent output" button that calls
    `ensureHistory` (Decision D7, P2 user-approved 2026-10-17). `hasChildren` / `childStats`
    (`:853-873`) read the tree when present, else `record.toolUses`. The bubble's "View
    transcript" removal rows (parity inventory, item 8) are executed here, in the same batch,
    because this batch owns the file (finding 6). P3 (kept, user decision 2026-10-17): the
    bubble shows the agent node's summary-chunk text only while `store.treeFor(toolCallId)`
    is empty, so the same text never renders twice.
  - Single chat in-place view (633 tray-chip criterion): no code change;
    `single-chat-subagent-view.component.ts:79-80` renders the agent node through the bubble,
    which now stamps the store tree. `retain`/`release` come from the bubble.
  - `SubagentTileComponent` (`subagent-tile.component.ts:77-96`): tool count and latest
    activity from the store tree when present, else `record.toolUses` / `record.lastToolName`.
  - `AgentMonitorPanelComponent` workflow-subagent detail (`agent-monitor-panel.component.ts:569-598`,
    `:970-977`, `:1206-1247`): render `ptah-subagent-lane` (keeps usage summary, adds the tree)
    instead of the transcript viewer; delete its transcript signals and loader (its parity row
    is executed here, same file ownership reason).
- Failure behaviour: per component 7 states; Retry is a button, never a loop.
- Quality requirements: no per-item timer or observer (no auto-load on scroll); one
  `retain`/`release` per mounted view with release on destroy.
- Verification seam: subagent-lane spec (states), bubble spec (live tree, load button, counts),
  tile spec, agent-monitor-panel spec, canvas-lane-view spec (no `subagent:transcript` call, no
  main-tree walk), `chat-transcript.component.spec.ts` (turn agent chip → in-place view shows
  store output that arrived after the parent `chat:complete`; pending identity before
  `agent_start`). Screenshots dark + light, 1440 + 760: running subagent lane, finished
  subagent lane, restored subagent lane after Load, main chat turn with a subagent bubble.
- Files:
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts` (+ spec)
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts` (+ spec)
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts` (+ `agent-monitor-panel.component.spec.ts`, `agent-monitor/agent-lane-panel.spec.ts`)
  - MODIFY (spec only) `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts`

### 10. Approved removals (Phase B, last)

- Purpose: delete the transcript workarounds once component 9 replaces them.
- Responsibilities: every row marked `remove-approved` in the parity inventory below, in two
  steps: frontend first (callers), then shared/backend (contract), so every intermediate commit
  compiles. Rows whose file is owned by component 9 (`inline-agent-bubble.component.ts`,
  `canvas-lane-view.component.ts`, `agent-monitor-panel.component.ts`) are executed in B5;
  component 10 covers the remaining files only.
- Failure behaviour: not applicable (deletion); the compile and the guard specs prove no caller
  remains.
- Verification seam: grep for `subagent:transcript`, `SubagentTranscript`, `viewTranscript`,
  `canViewTranscript` returns no source hit (the generated `host-source-registry.baseline.ts`
  keeps its entry; not edited, see P4); `rpc-allowlist.spec.ts`, VS Code and Electron
  `rpc-surface.spec.ts`, `host-source-registry.contract.spec.ts` green.
- Files: see parity inventory and the handoff file list.

## Parity inventory (approved removals and moves)

Line numbers re-verified on `71820e0c0`.

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| CLI lane status badge (`completed`) | `agent-card-header.component.ts:74-85` (flat path) | none | remove-approved (item 1) | Tab chip `canvas-lane-tabs.component.ts:124-128`, hover card, inspector `inspector-agents-section.component.ts:171-173`, avatar dot | flat-header spec asserts no badge; existing chip/inspector specs |
| Subagent status-row badge in the lane | `inline-agent-bubble.component.ts:192-264` (lane renders the bubble today) | none | remove-approved (item 2) | Chip / hover / inspector; actions → header action place; progress → row peek | subagent-lane spec |
| Separate CLI duration text in lane header | `agent-card-header.component.ts:142-148` | none | remove-approved (item 3) | Row label `Worked for X` | flat-header spec |
| Subagent footer duration in lane | `inline-agent-bubble.component.ts:519-521` (lane) | none | remove-approved (item 3) | Row label | subagent-lane spec |
| `formatElapsed` formatter | `agent-card.utils.ts:13-26`; callers `agent-card.component.ts:160,163`, `inspector-agents-section.component.ts:342` | none | remove-approved (item 3) | `formatAgentDuration` via component 1 | inspector spec, utils spec |
| Subagent bubble header (chevron, avatar, name, badges) in the lane | `inline-agent-bubble.component.ts:103-186` (lane) | none | remove-approved (item 4); main chat keeps it | Chip / inspector; Streaming → pulse dot; Background/Resumed/Interrupted → row meta | subagent-lane spec |
| Subagent footer tokens / cost in the lane | `inline-agent-bubble.component.ts:502-523` (lane) | none | remove-approved (item 5) | Row meta (tokens) + details (cost) | subagent-lane spec |
| Top-level usage rows | `agent-card.component.ts:68-74`; `canvas-lane-view.component.ts:147` | none | move (item 6) | Behind the disclosure (components 3a, 4) | flat-header spec, subagent-lane spec |
| Parent session id | `agent-card.component.ts:86-93` | none | move (item 7) | Details facts | flat-header spec |
| Task text, CLI session id, model badge | `agent-card.component.ts:95-103`; `agent-card-header.component.ts:96-104` | none | move (map rows) | Details facts | flat-header spec |
| Guard stop reason | `agent-card-header.component.ts:87-94` | none | keep (moved into row meta, warning tone) | Header meta | flat-header spec |
| Resume / Stop (CLI) | `agent-card-header.component.ts:106-140` | `agent:resumeCliSession`, `agent:stop` | keep (moved) | Header action place | flat-header spec |
| Subagent Background / Stop / Message | `inline-agent-bubble.component.ts:281-355` (lane) | `subagent:background`, `subagent:stop`, `subagent:send-message` | keep (moved) | Header action place via `SessionAgentTrayService` + `ptah-agent-steer-input` | subagent-lane spec |
| "View transcript" button in the bubble | `inline-agent-bubble.component.ts:322-330`, `canViewTranscript` `:963-966`, `onViewTranscript` `:969-981`, injection `:52`, `:608` | `subagent:transcript` | remove-approved (item 8; executed in B5) | Bubble body shows the subagent's own tree; lane tab | bubble spec: no `subagent-transcript-button` |
| "View transcript" in inspector menu | `inspector-agent-actions-menu.component.ts:27`, `:38-39`; `inspector-agents-section.component.ts:408-410` | `subagent:transcript` | remove-approved (item 8) | Inspector row click opens the lane (`:389-397`) | inspector specs |
| Tray service transcript action | `session-agent-tray.service.ts:8`, `:34`, `:100-108`; `canViewTranscript` producers `session-agent-tray.ts:177`, `:234`; doc `:27` | `subagent:transcript` | remove-approved (item 8) | — | `session-agent-tray.service.spec.ts`, `session-agent-tray.spec.ts` |
| "View transcript" in background strip | `background-agent-strip.component.ts:79-81`, `:331-346`, `:434-435`, `:474` | `subagent:transcript` | remove-approved (item 8) | — | `background-agent-strip.component.spec.ts` |
| Lane fallback "Live agent unavailable. Showing saved transcript." | `canvas-lane-view.component.ts:31`, `:44`, `:155-163`, `:236-244`, `:302-329`, `:332-364` | `subagent:transcript` | remove-approved (item 8; executed in B5) | Lane renders the store tree with load/error/empty states (component 9) | canvas-lane-view spec |
| Transcript overlay | `subagent-transcript-overlay.component.ts` (whole); `app-shell.component.html:7-11`; `app-shell.component.ts:54`, `:69`, `:144`, `:185`; `subagent-transcript-viewer.service.ts` (whole) | `subagent:transcript` | remove-approved (item 8) | — | delete `subagent-transcript-overlay.component.spec.ts`; app-shell spec |
| Transcript viewer component | `libs/frontend/chat-ui/src/lib/molecules/subagent-transcript-viewer.component.ts`; export `chat-ui/src/index.ts:45` | — | remove-approved (item 8, renderer of the overlay and fallback path) after the agent monitor panel move | — | `agent-lane-panel.spec.ts:18`, `:158` updated |
| Workflow-subagent output in the agent monitor panel (sidebar, tribunal vendor card) | `agent-monitor-panel.component.ts:569-598`, `:970-977`, `:1206-1247` | `subagent:transcript` | move (not removed; B5) | `ptah-subagent-lane` on the store tree + `subagent:history-page` (workflows dir supported, component 6) | agent-monitor-panel spec |
| Store transcript read | `agent-monitor.store.ts:2502-2521`; doc `:541` | `subagent:transcript` | remove-approved (item 8) | `SubagentExecutionStore.ensureHistory` | agent-monitor.store spec |
| `subagent:transcript` RPC | contract `rpc.types.ts:88-89`, `:1192-1195`, `:3869`; types `subagent-registry.types.ts:265-297`; schema `subagent-rpc.schema.ts:86-95`; handler `subagent-rpc.handlers.ts:12`, `:78`, `:89`, `:114`, `:340-381`; dispatcher `subagent-message-dispatcher.ts:49-71`, `:413-506+` (`getSubagentTranscript`, `normalizeTranscript`, `renderMessageText`) | itself | remove-approved (item 8, "the `subagent:transcript` overlay path"; last caller moved above) | `subagent:history-page` | handler and dispatcher specs updated; allowlist / rpc-surface specs |
| Subagent content inside the main execution tree | `execution-tree-builder.service.ts:319` + `agent-node.fn.ts:44-58`; finalized copies `message-finalization.service.ts:177-187` | `chat:chunk` | move (decision 2) | `SubagentExecutionStore` per subagent | components 7-8 specs |
| Live output after the parent turn (currently lost) | `streaming-handler.service.ts:417-431`; `message-finalization.service.ts:219-251` | `chat:chunk` | keep (fixed, 633) | Store entry outlives the turn | component 7-8 specs |

`workflow-transcript-reader.ts` stays (used by component 6).

## Proposed Removals

**Decided by the user on 2026-10-17; binding.** Each row changes as a consequence of decision 2;
the last column records the chosen option and the batch that carries it.

| # | Capability that changes | Where today | Effect if accepted | Alternative that keeps it | Decision |
| --- | --- | --- | --- | --- | --- |
| P1 | Main turn meta `N tools · N files` counts subagent tools and files | `message-summary.utils.ts:83-104` walks agent children | Counts become the parent's own tools/files; subagent counts show in the subagent's lane header and bubble | Add `record.toolUses` per agent node to the count (files not available from records) | **User-approved 2026-10-17: accept, parent-only counts.** The parent turn shows its own tools/files; subagent counts show in the lane header and bubble. Carried by B4 (children leave the main tree) and B5 (bubble/tile counts from the store tree) |
| P2 | Restored subagent output shown at once in the main chat bubble | Bubble body stamps `node().children` (`inline-agent-bubble.component.ts:459-464`) from history replay | Restored bubbles show "Load agent output"; one click fetches `subagent:history-page` | Auto-load all restored subagents on session open (memory and N RPCs per session) | **User-approved 2026-10-17: accept, "Load agent output" on click.** Carried by B5 (bubble) |
| P3 | `agent:summary-chunk` push writing subagent text into the tab state | `chat-lifecycle.service.ts:32-37`; `agent-node.fn.ts:84-107` | Remove later; the store tree has the same text | Keep as is (this plan keeps it) | **User-approved 2026-10-17: keep `agent:summary-chunk` in this task** (no removal). B5 must not show its text twice: the bubble renders the summary-chunk text only while the store has no tree for the key |
| P4 | `subagent:transcript` entry in the generated host-source baseline | `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:361` | Stale entry remains (the contract spec checks only host-source names) | Regenerate the baseline (needs a Gate 2 exception, TASK_2026_610) | **User-approved 2026-10-17: leave the generated baseline untouched.** No batch edits `host-source-registry.baseline.ts` |

## Integration architecture

- Data flow (live): SDK → `SdkMessageTransformer` (sets `parentToolUseId`) → broadcaster
  `chat:chunk` (component 5 gate) → webview `StreamRouterService` → `StreamingHandlerService`
  → `SubagentExecutionStore.claim` → per-subagent `StreamingState` via
  `AccumulatorCoreService` (+ `AgentMonitorStore` side effects) → `treeFor(key)` →
  `ptah-execution-node` in lane / bubble / monitor panel. Root `agent_start` and the Task
  `tool_start/tool_result` still go to the tab state, so the main tree keeps the agent node.
- Data flow (restored / evicted / backfill): view `ensureHistory(key)` → `subagent:history-page`
  → `SessionHistoryReaderService.readSubagentEvents` → JSONL (`subagents/`, legacy, `workflows/`)
  → `SessionReplayService.replayAgentToStreamEvents` (text, thinking, tools, results; per-event
  caps) → pages → merge-local state → generation check → store merge (component 7 steps 1-5)
  → finalize when terminal.
- Data flow (header, Phase A): `MonitoredAgent` / `SubagentRecord` → duration rule (1) →
  `ptah-execution-header` (3).
- State or persistence: store entries are webview-memory only, owned by
  `SubagentExecutionStore` (root), lifetime = session open, bounds per component 7.
  Persistence: only `CliSessionReference.completedAt` (component 2); subagent history stays in
  the SDK JSONL owned by the SDK.
- External boundaries: `subagent:history-page` params validated by zod at the handler; ids
  restricted to `[A-Za-z0-9_-]` before any path join; errors carry no paths.
- Failure and rollback: claim failure → event takes the old tab path; history failure → error
  state with Retry; JSONL missing → `not-found` state ("No saved output for this agent"),
  distinct from a recorded empty agent; agent id not resolvable → `unresolved` with Retry; a
  clear, eviction, spill or last release during a load → no further page, no commit. Each phase is independently revertable: Phase
  A touches no data path; Phase B's claim seam is one call in `processStreamEvent` and one in
  `accumulate`, reverting those restores today's behaviour (removals ship last, after the
  renderers prove out).
- Observability: store logs (debug) on claim fallback, eviction and history errors with key and
  session id; backend logs history read failures with session/agent id; the lane shows error,
  empty and truncated states distinctly.

## Architecture-level quality requirements

- Functional:
  - One header structure for both lane kinds; no status word in the lane header; one duration,
    in the label; a finished run without end time reads `Worked`; restored CLI lanes with a
    persisted end time read `Worked for X`.
  - Tab chip, hover card, inspector and lane use the same duration rule and formatter;
    subagent chips/hover cards show a duration when timestamps are known.
  - A subagent lane opens its own tree at once (pending identity included); output continues
    after the parent result and after a new parent turn; two concurrent agents never mix;
    reopening a view neither stops collection nor duplicates; snapshot/live merge keeps order,
    the full prefix of an in-flight message and repeated deltas; a restored subagent shows its
    thinking, text, tools and results; the turn agent chip, subagent tile and inspector row
    open the same live view inside and outside the canvas.
  - No "View transcript" action, overlay or text fallback remains.
- Performance: per-subagent ≤ 2000 events live, ≤ 10 000 live events across unpinned
  entries; ≤ 20 finished subagent trees within `capFinalizedTree` budgets; restored subagents
  0 bytes until opened; no new timers or observers; history response ≤ 256 KB with every event
  ≤ 96 KB encoded (UTF-8 of the JSON) after the per-event caps.
- Security: id allowlist regex before file access; no path in user-visible errors.
- Maintainability: no new DI tokens or services in the backend containers; new RPC follows the
  manifest pattern; chat-ui stays the home of shared atoms; canvas still depends on chat, never
  the reverse.
- Testability: every behaviour above has a spec at the store/handler/component boundary listed
  in its component; UI batches add dark + light screenshots at 1440 and 760.

## Team-leader handoff

- Recommended executors: codex CLI lanes. `backend-developer` for A2, B1, B2, B6;
  `frontend-developer` for A1, A3, A4, B3, B4, B5, B7. Every lane brief must repeat the
  CLAUDE.md memory-safe rules (per-project checks, `--parallel=1`, Jest `--maxWorkers=2`, one
  heavy check at a time, no build/serve/e2e/package).
- Complexity: HIGH overall (Phase A MEDIUM, Phase B HIGH: event routing in the hot streaming
  path, history merge, cross-host RPC).
- Dependencies and ordering (component level):
  - A2 (component 2) before A1 (component 1 maps `completedAt`).
  - A1 before A3 (A3 consumes the rule and `cliActivity` from A1).
  - A3 (components 3, 3a) before A4 (component 4).
  - A4 and every batch touching `canvas-lane-view.component.ts` rebase on TASK_2026_683 B6
    after it is committed and pushed.
  - Phase B after Phase A. B1 and B2 (backend) can run before or with B3. B3 (component 7)
    before B4 (component 8). B4 and B2 before B5 (component 9). B5 before B6/B7 (removals:
    frontend B7 first, backend B6 last).
- Proposed batches (the team-leader re-derives). File invariant (round 1 finding 6, stated
  precisely in round 2): the batches are **not** all file-disjoint. Batches that may run in
  parallel (only B1, B2 and B3) are file-disjoint. The files in the recurrence table below
  are revisited by several batches; those batches run strictly in the order shown, each one
  starts from the previous one's committed result (rebase on it, no concurrent edit), and the
  later batch owns the file from that point.

| Batch | Components | Executor | Projects to check | Screenshots |
| --- | --- | --- | --- | --- |
| A2 | 2 | backend-developer | `@ptah-extension/shared`, `@ptah-extension/cli-agent-runtime` | no |
| A1 | 1 (+ `loadCliSessions` mapping) | frontend-developer | `@ptah-extension/chat-ui`, `@ptah-extension/canvas`, `@ptah-extension/chat`, `@ptah-extension/chat-streaming` | before/after: inspector rows, tab chip + hover card, restored CLI lane (dark + light, 1440) |
| A3 | 3, 3a | frontend-developer | `@ptah-extension/chat` | before/after CLI lane, dark + light, 1440 + 760; main chat turn row unchanged |
| A4 | 4 | frontend-developer | `@ptah-extension/chat`, `@ptah-extension/canvas` | before/after subagent lane (finished, running if available), dark + light, 1440 + 760 |
| B1 | 5 | backend-developer | `@ptah-extension/rpc-handlers` | no |
| B2 | 6 | backend-developer | `@ptah-extension/shared`, `@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers`, then `ptah-extension-vscode` (rpc-surface / container.smoke specs only) | no |
| B3 | 7 | frontend-developer | `@ptah-extension/chat-types`, `@ptah-extension/chat-streaming` | no |
| B4 | 8 | frontend-developer | `@ptah-extension/chat-streaming`, `@ptah-extension/chat-routing` | no |
| B5 | 9 | frontend-developer | `@ptah-extension/chat`, `@ptah-extension/canvas` | before/after: running, finished, restored subagent lane; main chat subagent bubble (live and restored with Load); agent monitor panel workflow subagent; dark + light, 1440 + 760 |
| B7 | 10 (frontend rows not owned by B5) | frontend-developer | `@ptah-extension/chat`, `@ptah-extension/chat-ui`, `@ptah-extension/chat-streaming` | after: inspector actions menu, background strip menu (dark + light, 1440) |
| B6 | 10 (shared/backend rows) | backend-developer | `@ptah-extension/shared`, `@ptah-extension/rpc-handlers`, `@ptah-extension/agent-sdk`, then the seven DI guard specs (Verification points) | no |

  Recurring files (each row is serial in the order shown; no two of these batches may run at
  the same time):

  | File | Batches, in order |
  | --- | --- |
  | `libs/frontend/chat/src/lib/components/index.ts`, `libs/frontend/chat/src/index.ts` | A3 → A4 |
  | `libs/frontend/chat-ui/src/index.ts` | A1 (only if the export is missing) → B7 |
  | `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts` | A1 (footer) → B5 (body + transcript removal) |
  | `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts` | A1 → B7 |
  | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` | A1 (`SubagentRecord` times, `loadCliSessions`) → B7 (transcript read) |
  | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` | A4 → B5 |
  | `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts` | A4 (create) → B5 |
  | `libs/shared/src/lib/types/{subagent-registry.types.ts, rpc.types.ts}`, `libs/backend/rpc-handlers/src/lib/handlers/{subagent-rpc.handlers.ts, subagent-rpc.schema.ts}` (+ handler spec) | B2 → B6 |

  `agent-card.component.ts` and `agent-card.utils.ts` belong to A3 only; `session-agent-roster.ts`
  to A1 only. B1, B2 and B3 share no file and may run in parallel lanes, but only one heavy
  check at a time.
- Acceptance per batch:
  - A1: unit specs for the rule; no `formatDuration` caller left and the inspector no longer
    calls `formatElapsed`; inspector and lane agree on `Worked` for a finished lane without end
    time; `loadCliSessions` maps `ref.completedAt` (epoch ms) and an older reference without it
    restores as before (the restore-mapping acceptance moved here from A2).
  - A2: exit persistence writes `completedAt` on the reference; a terminal write over an older
    reference without the field adds it and keeps the other fields.
  - A3: flat CLI lane matches prototype section 1-2 (label, meta, actions, details); card mode
    unchanged; `formatElapsed` has no caller and is deleted.
  - A4: subagent lane matches prototype; actions work through the tray service; error line shows.
  - B1: regression spec for premature and repeated `chat:complete`.
  - B2: paged structured history for subagents, legacy flat and workflow files, including
    thinking blocks in order; invalid ids rejected; missing file → `not-found`; no agent id →
    correlated or `unresolved`; a single oversized message pages with clipping and an advancing
    cursor, every response < 256 KB.
  - B3: store specs listed in component 7 all pass.
  - B4: claimed events never mint tab state; restored tree has agent nodes without subagent
    children; cleanup clears the store.
  - B5: lane, bubble, tile and monitor panel render the independent tree with all states; no
    main-tree walk remains in the lane view; the transcript rows of its three files are
    removed; the single chat in-place view (turn chip) shows post-turn store output; user
    decisions of 2026-10-17 applied: main turn meta counts only the parent's tools/files (P1,
    spec on `message-summary.utils` input without agent children), restored bubbles show
    "Load agent output" and fetch on click (P2), `agent:summary-chunk` stays and its text is
    not shown a second time once the store tree is mounted (P3, bubble spec), no edit to the
    generated baseline (P4).
  - B6/B7: no source reference to `subagent:transcript`, `SubagentTranscript*`,
    `viewTranscript`, `canViewTranscript`; guard specs green.
- Files affected:
  - CREATE: `libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.ts` (+ spec);
    `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts` (+ spec);
    `libs/frontend/chat/src/lib/utils/subagent-progress.utils.ts` (+ spec);
    `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts` (+ spec).
  - MODIFY (Phase A): `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-duration.ts`,
    `libs/frontend/chat-ui/src/index.ts`, `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts`,
    `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`,
    `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts`,
    `libs/frontend/chat/src/lib/components/molecules/agent-card/{agent-card.component.ts, agent-card.utils.ts, cli-agent-output.component.ts, stats-bar.utils.ts, cli-lane-usage-summary.component.ts}`,
    `libs/frontend/chat/src/lib/components/molecules/turn/turn-disclosure-row.component.ts`,
    `libs/frontend/chat/src/lib/utils/message-summary.utils.ts`,
    `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts`,
    `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts`,
    `libs/frontend/chat/src/lib/components/index.ts`, `libs/frontend/chat/src/index.ts`,
    `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`,
    `libs/shared/src/lib/types/agent-process.types.ts`,
    `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts`; matching specs.
  - MODIFY (Phase B): `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`,
    `libs/shared/src/lib/types/{subagent-registry.types.ts, rpc.types.ts}`,
    `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`,
    `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts`,
    `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts`,
    `libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.ts`,
    `libs/backend/rpc-handlers/src/lib/handlers/{subagent-rpc.handlers.ts, subagent-rpc.schema.ts}`,
    `libs/frontend/chat-types/src/lib/chat-types.ts`,
    `libs/frontend/chat-streaming/src/lib/{execution-tree-builder.service.ts, execution-tree-cache.ts (only if A1 fails), accumulator-core.service.ts, streaming-handler.service.ts, history-message-builder.service.ts, agent-monitor.store.ts}`,
    `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts` (spec only),
    `libs/frontend/chat-streaming/src/index.ts`,
    `libs/frontend/chat-routing/src/lib/stream-router.service.ts`,
    `libs/frontend/chat/src/lib/components/organisms/{subagent-lane/subagent-lane.component.ts, execution/inline-agent-bubble.component.ts, execution/subagent-tile.component.ts, agent-monitor-panel.component.ts, session-inspector/inspector-agent-actions-menu.component.ts, session-inspector/inspector-agents-section.component.ts}`,
    `libs/frontend/chat/src/lib/services/session-agents/{session-agent-tray.service.ts, session-agent-tray.ts}`,
    `libs/frontend/chat/src/lib/components/templates/{app-shell.component.ts, app-shell.component.html}`,
    `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts`,
    `libs/frontend/chat-ui/src/index.ts`,
    `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`; matching specs.
  - DELETE (Phase B, B7/B6): `libs/frontend/chat/src/lib/components/organisms/subagent-transcript-overlay.component.ts` (+ spec),
    `libs/frontend/chat/src/lib/services/subagent-transcript-viewer.service.ts`,
    `libs/frontend/chat-ui/src/lib/molecules/subagent-transcript-viewer.component.ts`.
- Verification points:
  - Re-verify every `canvas-lane-view.component.ts` line after rebasing on 683 B6.
  - Confirm assumptions A1-A8 (A9, A10 withdrawn) with the specs named in components 6-7 before B5 starts (A6/A7
    in B2, A1/A2/A8 in B3).
  - Backend RPC change: `SubagentRpcHandlers.METHODS`, `RpcMethodRegistry`, `RPC_METHOD_ENTRIES`
    in one commit; then run `npx nx test @ptah-extension/rpc-handlers --parallel=1` (covers
    `rpc-allowlist.spec.ts`), then the seven DI guard specs, one command at a time (the
    `subagent` manifest entry has `requires: []`, so every host registers it,
    `manifest.ts:326-331`; all seven files exist on `71820e0c0`):
    - `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-extension-vscode/src/di/surface-composition.spec.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`
    - `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/rpc-surface.spec.ts apps/ptah-electron/src/di/surface-composition.spec.ts apps/ptah-electron/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`
    - `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/surface-composition.spec.ts --coverage=false --maxWorkers=2`
    Run them for B2 and for B6. `expected-resolvable.ts` needs no change (no new service or
    token; `SubagentRpcHandlers` gains an injection of the already registered
    `SDK_TOKENS.SDK_SESSION_HISTORY_READER`, also injected by `chat-history-read.service.ts:35`);
    the two `container.smoke` specs confirm it resolves in VS Code and Electron.
  - Shared contract: `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2`.
  - Per changed project: `npx nx test <project> --parallel=1`, `npx nx typecheck <project> --parallel=1`,
    `npx nx lint <project> --parallel=1`; several projects: `npx nx run-many -t test -p A B --parallel=1`
    and confirm "Running target test for N projects". No build, serve, e2e or package targets.
  - Screenshots per the batch table, dark (`anubis`) and light (`anubis-light`), 1440 and 760,
    via the visual-reviewer with the private profile copy (capture-report method).

## Decisions

| # | Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | Persist `completedAt` in `CliSessionReference` | Persist / label-only fix | Value already exists on `AgentProcessInfo` (`agent-process.types.ts:133`, stamped `agent-process-manager.service.ts:1946`, `:2186`); single writer `agent-events.ts:422-441`; restore passes fields through (`session-metadata-store.ts:381-397`); cost one optional string | Yes (optional field) |
| D2 | Duration rule lives in chat-ui beside `formatAgentDuration`; canvas helper delegates | Keep in canvas / move to chat / chat-ui | Canvas depends on chat (`canvas-lane-view.component.ts:13-22`), chat cannot import canvas; formatter already in chat-ui (`agent-duration.ts:11`) | Yes |
| D3 | Rebuild earlier subagents from the SDK JSONL (structured), no new persistence | New `ptah.agentOutput` blob per subagent / SDK JSONL | JSONL already holds tool and thinking blocks; replay converts text and tools (`session-replay.service.ts:496-581`) and gains a thinking branch (component 6; it is missing today, `:528-581`); covers pre-existing sessions | Yes (a blob store could be added behind `ensureHistory`) |
| D4 | Per-subagent `StreamingState` + main accumulator + main tree builder (root option), not the CLI-lane builder | Flat array + `AgentMonitorTreeBuilderService` / per-subagent `StreamingState` | Accumulator dedups `stream` vs `complete` (`accumulator-core.service.ts:273`, `:314`, `:355`, `:370`, `:423`); CLI builder has no source handling (`agent-monitor-tree-builder.service.ts:500-564`); `onStateChanged` precedent for non-tab states (`accumulator-core.service.ts:79-85`) | Yes |
| D5 | Claim before tab routing; history-sourced subagent events not retained | Retain from history pages / fetch on demand | Pages can split an agent's events; decision 5 memory; replay already updates records through the accumulator (`history-message-builder.service.ts:117-143`) | Yes |
| D6 | Retention: 2000 events per live entry, 10 000 live events across unpinned entries (spill oldest-updated), 20 finished trees with `capFinalizedTree`, pin while shown; generation check before every page and commit | Other caps / per-entry cap only (no count bound) | Reuses `MAX_AGENT_STREAM_EVENTS` (2000), `MAX_COMPLETED_AGENTS` (20), `STREAMING_EVENT_CAP` (5000, `chat-types.ts:207`) × 2, finalized-tree budgets; a per-state cap alone does not bound the number of states (`chat-types.ts:259-303`) | Yes (constants) |
| D15 | Snapshot/live merge by SDK message id + block index, rebuilt into a fresh state with a merge-local dedup and `skipStoreEffects` | Skip whole overlapping messages + time cut (round 0) / timestamp window for text-only synthesized ids (round 1, withdrawn: can alias two messages and hide live text) / content-prefix alias at `complete` (round 2, withdrawn: runs before the content exists and equal text proves nothing) / per-block reconciliation with proven identity only (chosen) | Round-0 rule loses the pre-subscription prefix; `history`/`complete` sources replace block text (`accumulator-core.service.ts:273-275`, `:314-319`), stream deltas append; store effects at `:449-456`, `:497-498`, `:537-538` would double-apply | Yes |
| D16 | Oversized history events are clipped per event (head + tail), the hard cap measured on the UTF-8 JSON encoding; the page budget reserves the full wire envelope (`success`, `data`, 64-char `correlationId`, 32-char cursor) and is re-checked before return; a page always holds ≥ 1 event | Split one block over several events / clip | `history`-sourced text replaces rather than appends (`:314-319`), so a split block would keep only its last piece; clip budgets match `execution-tree-retention.ts:74`, `:84`, `:104`, which the finalized tree applies anyway; byte measure as `rpcOutputPageBytes` (`session-metadata-store.ts:342-352`), because JSON escaping grows text | Yes |
| D17 | `agentId` optional on `subagent:history-page`; backend correlates from `toolCallId` | Require `agentId` / correlate | `SubagentRecord.agentId` is optional and set only by `agent_start` (`agent-monitor.store.ts:536-545`); correlation already exists (`agent-correlation.service.ts:172-240`) | Yes |
| D7 | Restored subagent bubble loads on click; lanes load on open | Auto-load / on visible (observer) / on click | No per-item observer rule; N RPCs per session on open; P2 user-approved 2026-10-17 | Yes |
| D8 | Lane actions reuse `SessionAgentTrayService` and `ptah-agent-steer-input` | Copy bubble logic / extract shared component / reuse tray | Tray already offers steer/stop/background with owning-session targeting (`session-agent-tray.service.ts:83-98`), used by the inspector (`inspector-agents-section.component.ts:240-253`) | Yes |
| D9 | Header row reuses `TurnDisclosureRowComponent` with two optional inputs | New row / reuse | Prototype copies it (`prototype/index.html:10-12`); defaults keep main chat identical | Yes |
| D10 | Broadcaster turn gate counts root events only | Leave / fix | `chat-stream-broadcaster.service.ts:269-296` ignores `parentToolUseId`; 633 needs output after the parent turn without re-completing the turn | Yes |
| D11 | Delete the `subagent:transcript` RPC after the agent monitor panel moves to the tree | Keep for the panel / move panel and delete | Its UI callers are the approved removals plus the panel (`agent-monitor-panel.component.ts:1242`); no backend consumer (`chat-ptah-cli.service.ts` uses an unrelated probe) | Yes (git) |
| D12 | Do not edit `host-source-registry.baseline.ts` | Regenerate / leave | Contract spec checks only host-source-shaped names (`host-source-registry.contract.spec.ts:17-55`); baseline edits need a Gate 2 exception (`:1-2`) | n/a |
| D13 | The background lane without a subagent record keeps `ptah-background-agent-strip` (minus its transcript item) | Replace with subagent lane / keep | Record-less background agents have no `SubagentRecord` for the header; strip renders them today (`canvas-lane-view.component.ts:122-137`) | Yes |
| D14 | Out of scope, reported only: light-theme `PLAIN TEXT` code block, stale restored `running` subagent, 760 nav label clipping | Include / separate tasks | `capture-report.md` defects 3, 4 and the S4 note; none is in 685/633 scope; the stale state needs a backend liveness check | n/a |

## Risks and open questions

1. Hot path: `claim` runs for every chunk. Keep it O(1) (map lookups) and allocation-free for
   unclaimed events; measure with the existing streaming specs.
2. A1 (digest attribution) and A2 (dedup across states) could produce stale or duplicated
   subagent trees; both have named specs before B5.
3. Merge identity (D15): only equal SDK message ids and shared tool-use ids merge. A
   text-only message with a synthesized live id (A3 exception, rare,
   `stream-event.transformer.ts:204-216`) is never merged by timing or text (round 3): it can
   show twice (live `S` copy + `X` copy from the snapshot or the live `complete`) for the life
   of the entry, until the session is reloaded from history. Live text is never hidden by a
   guess. Spec case (3) pins it. A backend field carrying the real `message.id` on the
   synthesized stream events (set in `reconcileSynthesizedStart`, `:219-250`) would let the
   store merge it by id; not planned here (the transformer deliberately keeps the
   synthesized id, `:209-216`), recorded as a follow-up.
4. P1/P2 change visible behaviour in the main chat; the user approved both on 2026-10-17.
5. 683 B6 rebase: A4, B5 and B7 touch `canvas-lane-view.component.ts`.
6. Stale `running` restored subagents (capture S4) will show `Working` in the new header until
   the liveness issue is fixed (D14).
7. History payloads (`chat:resume`, `chat:history-page`) still carry subagent events that the
   webview now discards; a later backend flag can omit them.
8. Clipped history events (D16) lose the middle of very large text or tool payloads in
   restored views; the lane says so ("Some long outputs were shortened").
9. Live retention (D6) can exceed one tab's former 5000-event cap when several subagents run;
   bounded at 10 000 unpinned + 2000 per pinned view.

## Clarifications (resolved 2026-10-17)

Answered by the user on 2026-10-17; binding. Batch B5 implements them.

1. Main turn meta counts after subagents leave the main tree (P1)? **Answer: count the
   parent's own tools and files only.** (Not chosen: add each subagent's `record.toolUses`.)
2. Restored subagent output in the main chat bubble (P2)? **Answer: show "Load agent output"
   and fetch on click.** (Not chosen: fetch every restored subagent on session open.)
3. `agent:summary-chunk` subagent text path (P3)? **Answer: keep it in this task.** (Not
   chosen: remove it in Phase B.)
4. Generated host-source baseline (P4, recorded with the others)? **Answer: leave it
   untouched**; its stale `subagent:transcript` entry stays.

## Revision log (round 1)

Answers `implementation-plan-review.md` (REVISE 5/10). Line numbers are those of this revision.
Every finding was checked against source before the change; none is rejected.

| Finding | Verified at | Change made (plan section / lines) |
| --- | --- | --- |
| 1 Serious: restored trees omit thinking | `session-replay.service.ts:528-581` has no thinking branch; root path has one at `:310-320` | Correction note (lines 38-41); evidence row (76); component 6 "Thinking (finding 1)" with `createAgentThinkingDelta` (428-434); replay fixture spec with thinking, text, tool, result (verification seam of component 6); factory file added to component 6 and handoff files; D3 evidence corrected (D3 row); B2 acceptance |
| 2 Serious: snapshot/live overlap loses a message prefix | `stream-event.transformer.ts:158-159`, `:180-190`, `:205-216`; `assistant-message.transformer.ts:88`; replace-vs-append at `accumulator-core.service.ts:273-275`, `:314-319` | Component 7 "Snapshot/live merge (633, finding 2)" (547-580) replaces the skip-whole-message + time-cut rule: id + block-index identity, tool-id and time-window fallbacks with `idAlias`, rebuild into a fresh state with a merge-local dedup and `skipStoreEffects`, stream deltas filtered only for blocks the snapshot holds; component 6 now stamps `message.id` per grouped message and running block indices; assumptions A3 rewritten, A6-A9 added; merge spec cases (1)-(7); D15; Risks 3 rewritten |
| 3 Serious: oversized single message has no page result | `session-replay.service.ts:531-542` (one event per block); `jsonl-reader.service.ts:113-118` (50 MB files) | Component 6 "Per-event caps (finding 3)" and "Paging" (435-452) and new paging rule (event unit, ≥ 1 event per page, cursor always advances); result gains `clippedEvents`; specs for a 300 KB text block and a 1 MB tool result; lane state "Some long outputs were shortened"; D16; Risks 8 |
| 4 Moderate: missing agentId shown as "No output recorded" | `agent-monitor.store.ts:531-545` (`agentId?`, set only by `agent_start`); correlation at `agent-correlation.service.ts:172-240` | `agentId` optional in params; backend correlates from `toolCallId`; result `status: ok \| not-found \| unresolved` and returned `agentId` (component 6 contract and failure behaviour); store states `not-found` / `unresolved` with distinct copy and Retry (component 7 failure behaviour, component 9 states, Integration failure); D17. Also answers the review's "no file = empty" lane-introduced constraint |
| 5 Moderate: retention count and abort unspecified | `chat-types.ts:259-303` caps events per state only | Component 7 "Retention (finding 5)" and "History" abort guard (514-546): 10 000 live-event store budget with spill of the oldest-updated unpinned entry (abandoned `running` first), pinned bound by mounted views; `generation` check before every page and commit, bumped by clear, eviction, spill and last release; quality numbers and memory claim restated honestly; bound and abort specs; D6 rewritten; Risks 9 |
| 6 Moderate: batches not file-disjoint | Plan round 0 lines 193/196/280/283 and 198/573 | `agent-card.component.ts` + `agent-card.utils.ts` moved wholly to A3, `session-agent-roster.ts` wholly to A1 (component 1 and 3a file lists); bubble, lane-view and monitor-panel transcript removals moved into B5 (component 9, component 10, parity rows marked "executed in B5"); B7 no longer touches canvas; explicit recurring-file table with serial order (877 ff.); A1/A2 acceptance aligned (restore mapping now A1); ordering adds A1 → A3 |
| 7 Minor: DI guard list incomplete, Electron conditional | Seven spec files exist: VS Code and Electron `rpc-surface`, `surface-composition`, `container.smoke`; `libs/backend/cli-engine/src/lib/surface-composition.spec.ts`; `manifest.ts:326-331` `requires: []` | Verification points (962-971) list three exact Jest commands (all `--coverage=false --maxWorkers=2`), run for B2 and B6; evidence row added; B6 table row points at them |
| Coverage: 633 tray-chip row | `background-agent-tray` source gone; entry points `turn-agent-chips.component.ts:96`, `subagent-tile.component.ts:99-102`, `inspector-agents-section.component.ts:389-397` → `SESSION_CARD_ACTIONS.openLane`; single chat in-place view `chat-transcript.component.ts:933-958`, `single-chat-subagent-view.component.ts:79-80` | Explicit disposition "covered, no removal proposed" under Architecture decision (173-186); corrections note (47-53); component 9 adds the in-place view note and a `chat-transcript.component.spec.ts` case; B5 acceptance; functional requirement line |
| Lane-introduced constraints (limits need tests and a visible truncation contract) | — | Bound, clip and truncation specs now listed in components 6-7; lane states for truncated/spilled/clipped in component 9. The 30 px header, label grammar and slot API are kept: they come from the approved prototype (`prototype/index.html` sections 1-2), not from the tasks' text |

`## Proposed Removals` P1-P4 and `## Clarifications Needed` 1-3 are unchanged: the review
confirmed their facts (P2 cites the same bubble lines, P4 the same baseline entry) and they
remain open user decisions.

## Revision log (round 2)

Answers `implementation-plan-review-r2.md` (REVISE 6/10). Line numbers are those of this
revision. All three findings were checked against source; none is rejected.

| Finding | Verified at | Change made (plan section / lines) |
| --- | --- | --- |
| 1 Serious: the ±2 s text-only fallback can alias two distinct messages and hide live text | `stream-event.transformer.ts:204-216` (synthesized id kept), `:180-190` (`Date.now()`); stream text appends at `accumulator-core.service.ts:311-319` | The timestamp rule is removed. Step 2 now matches only on equal id or a shared tool-use id; an unproven text-only message is never aliased, so it stays visible, possibly twice (580-585). New step 6 (602-615) aliases `S → X` only when the message's own `complete` arrives for the same context and `S`'s stream text is a prefix or substring of `X`'s complete block text. The rebuild then removes only text that `X` already holds. A9 withdrawn and A10 added (171-177). Spec case (3) now covers two distinct nearby text-only messages, a snapshot taken before B is saved, the same-message duplicate resolved at completion, and a non-extending `complete` creating no alias (671-676). Risks 3 rewritten: transient duplicate, never hidden text (1052-1060). D15 options record the withdrawn rule (1034) |
| 2 Serious: the 256 KB cap is not guaranteed for escaped text | `session-replay.service.ts:531-542`; `jsonl-reader.service.ts:113-118`; byte-measure precedent `session-metadata-store.ts:342-352` (`TextEncoder` over `JSON.stringify` of the `{ success, data }` envelope) | Per-event caps split into character content budgets, then a hard 96 KB cap on the UTF-8 JSON encoding, with the clip recomputed on the serialized form by binary search and a guaranteed-terminating fallback (440-458). Paging budgets the encoded envelope, always emits at least one event and advances the cursor, and asserts ≤ 256 KB before returning (459-470). New specs: 90 000 `\u0001` characters, 90 000 multi-byte characters and `maxBytes: 1024` (490-495). Performance line and D16 updated (1035) |
| 3 Moderate: "file-disjoint" overstated | Recurrence table and file lists in Team-leader handoff | The invariant is stated exactly (901-906): only the parallel-capable batches B1, B2 and B3 are file-disjoint. Recurring-file batches run strictly in the table order, each rebased on the previous committed result. No architecture change |

`## Proposed Removals` P1-P4 and `## Clarifications Needed` 1-3 are unchanged and still open.

## Revision log (round 3)

User-approved extra round. Answers `implementation-plan-review-r3.md` (REVISE 6/10). Line
numbers are those of this revision. Both Serious findings were accepted as stated.

| Finding | Verified at | Change made (plan section / lines) |
| --- | --- | --- |
| 1 Serious: the completion alias runs before its evidence exists, and matching text cannot prove identity | `assistant-message.transformer.ts:88`, `:354-363`, `:413-430`; `accumulator-core.service.ts:297-321`; `stream-event.transformer.ts:306-334` | The content-prefix/substring alias is removed. Identity comes only from an SDK message id or a shared tool-use id (595-598). Step 6 now states that no late alias exists and records the accepted visible-duplicate case. No store step keys work to a completion point, so the review's event-order point no longer applies; the plan says why (615-627). A10 withdrawn (173). Spec case (3) is fed one event at a time in the real order and pins two-copies behaviour, including identical-text distinct messages (683-689). Risks 3 rewritten: the duplicate lasts for the life of the entry, and a backend real-id field is recorded as the follow-up (1072-1080). D15 options record the withdrawn round-2 rule (1054) |
| 2 Serious: the page budget omits `correlationId` | `session-metadata-store.ts:260-262`, `:342-353`, `:991-1005`, `:1025-1027` | Paging budgets the emitted response `{ success, data, correlationId }` with the 64-character correlation-id and 32-character cursor reservations. It subtracts the empty-page envelope, then re-checks before return and cuts trailing events with a recomputed cursor (455-480). New specs: a page nearly filling 256 KB with 36- and 64-character ids, the cut-back path, and one max-size event plus the full envelope (505-509). D16 updated (1055) |
| User decisions 2026-10-17 | Coordinator message relaying the user's answers | P1 to P4 rows are now decided ("User-approved 2026-10-17" with the chosen option, 829 ff.). `## Clarifications Needed` became `## Clarifications (resolved 2026-10-17)` with the answers, adding P4 as item 4 (1092-1103). Inputs note, component 9 bubble (P2 load on click; P3 summary text hidden once the store tree exists, 750), D7, Risks 4 and B5 acceptance (972-979) apply them |

Earlier revision logs keep their round-1 and round-2 wording ("still open") as history; the
decided state above supersedes them.
