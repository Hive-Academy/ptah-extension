# Batches - TASK_2026_685_64f4

Worktree: `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream` (branch
`feat/lane-execution-stream`, PR #751 draft, rebased on main with TASK_2026_683 / PR #748).
All paths below are relative to that worktree. Plan: `implementation-plan.md` (cited `plan:L-L`).

Total tasks: 32 remaining (A1-A3 tracked per batch) | Batches: 19 (3 done + 16 remaining) | Complete: 3/19

## Completed before this decomposition

| Batch | Components | Commit | Review |
| --- | --- | --- | --- |
| A2 — persist CLI run end time | 2 | e56bc3009 | `code-logic-review-A2.md` APPROVED 9/10 |
| A1 — one run-duration rule | 1 | 3322c8503 | `reports/code-logic-review-A1-fix.md` APPROVED |
| A3 — execution header, flat CLI lane | 3, 3a | 6092bc32b | `reports/code-logic-review-A3.md` APPROVED 8/10 (re-review) |

Carry-overs: A1 left `formatDuration` alive (`reports/batch-A1.md:33`) -> Batch A4b. A1 and
A3 screenshots were never captured (`screenshots/` holds only prototype PNGs) -> Batch A4
screenshot step. A1-fix Moderate (bubble running label has no tick,
`reports/code-logic-review-A1-fix.md:44`) -> recorded follow-up, not in this run's scope.

## Plan validation

Status: PASSED WITH RISKS (re-derived on the rebased tree, 2026-10-18)

Assumptions:

- A1 (tree digests attribute subagent roots to themselves, `execution-tree-cache.ts`) —
  unverified; Task B3a.2 checks it with a spec and extends the cache only if it fails.
- A2, A8 (dedup isolation across states; `registerAgent` under `skipStoreEffects`) —
  unverified; Task B3b.1 specs.
- A3 (merge keys on real SDK `message.id`) — unverified; B2a.2 replay spec and B3b.1 merge specs.
- A5 (RPC timeout bounds an in-flight history page) — unverified; B3b.1 abort specs.
- A6, A7 (JSONL lines sharing `message.id` form one message; running block index matches
  live `blockIndex`) — unverified; Task B2a.2 replay spec.
- Backend Phase B files (broadcaster, reader, replay, factory, dispatcher, subagent handler and
  schema, DI guard specs) are unchanged since plan base `71820e0c0` — verified with
  `git diff --stat 71820e0c0 HEAD`; plan line refs for them hold, except Risk 9.
- Frontend Phase B anchors hold: `execution-tree-builder.service.ts:319`, `stream-router.service.ts:293`, `:957`,
  `chat-types.ts:207`, `:259`, `agent-monitor-panel.component.ts:970`, `:1223`, `:1242` — verified.
- A3 outputs consumed by A4 exist: `ExecutionHeaderComponent` inputs
  (`execution-header.component.ts:36-44`), `summarizeExecutionNodes`
  (`message-summary.utils.ts:109`), `cliActivity` (`session-agent-roster.ts:74`),
  `agentRunLabel`/`agentRunDurationMs` exported (`chat-ui/src/index.ts:178`),
  `AgentSteerInputComponent` exported (`chat-ui/src/index.ts:44`), tray API
  `contextsFor/steer/stop/sendToBackground` (`session-agent-tray.service.ts:37`, `:83`, `:91`, `:96`),
  `subagentRpcError` (`agent-monitor.store.ts:774`) — verified.
- `libs/frontend/chat/src/index.ts:13` re-exports `./lib/components`, so a new component needs
  only `components/index.ts` — verified.

| # | Risk (evidence) | Severity | Mitigation |
| --- | --- | --- | --- |
| 1 | 683 B6 removed the lane `fade` signal and rAF effect (commits a3bc82d6a, 312b54f36). Lane motion is now the `styles` keyframes `rail-lane-enter` (`canvas-lane-view.component.ts:51-56`) and the `@for (block of laneBlocks(); track block.key)` wrapper (`:66-67`). The plan's "do not touch `fade`" rule (plan:107, :741) names code that is gone. | LOW | A4.3, B5a.2, B7b.1: do not touch the `styles` block, the outer `role="tabpanel"` div, `laneBlocks()` or the `rail-lane-enter` wrapper / `track block.key` |
| 2 | `canvas-lane-view.component.ts` line refs moved (plan :144-171, :245-257, :302-364). Now: `@case ('cli')` :71, `ptah-agent-card` :104, `@case ('subagent')` :113, background :116-135, `#subagentLane` :141-168, usage summary :144, fallback :153-163, transcript members :233-241, `agentNode` :242-254, transcript effect :292-320, `loadTranscript` :322-352, `findAgentNode` :384-392. | LOW | Given to A4.3 and B5a.2 |
| 3 | `canViewTranscript` is a REQUIRED field of chat-ui `BackgroundAgentStripEntry` (`background-agent-strip.component.ts:81`) and canvas sets it (`canvas-lane-view.component.ts:131`), as does chat (`session-agent-tray.ts:177`, `:234`). Removing it from the type with any producer left fails compile (excess property). The plan's recurrence table gives `canvas-lane-view` only to A4 -> B5 and B7 does not list canvas. | MEDIUM | B7b owns the field, the strip and all three producers in one commit (3-project exception, recorded on the batch); canvas-lane-view becomes A4 -> B5a -> B7b |
| 4 | The store's `rpc.call('subagent:history-page', ...)` is typed by `RpcMethodRegistry` (`core/src/lib/services/claude-rpc.service.ts:129`, `call<T extends RpcMethodName>`), so the store cannot typecheck before the registry entry exists. The plan's "B1, B2 and B3 may run in parallel" (plan:951) does not hold for the store. | MEDIUM | B3 split: B3a (no RPC) runs in parallel with B1/B2a; B3b (store) depends on B2b |
| 5 | `@ptah-extension/chat-types` has no test target (`libs/frontend/chat-types/project.json`: lint, typecheck only); plan wants a spec "of `setStreamingEventCapped`" in chat-types. | LOW | B3a.1 puts the spec in chat-streaming (existing precedent: `chat-streaming/src/lib/streaming-event-cascade-clean.spec.ts` covers it); chat-types gets typecheck + lint only |
| 6 | `formatDuration` survives (`stats-bar.utils.ts:41`), caller `subagent-usage-summary.component.ts:31`, `:134`; A1 acceptance "no `formatDuration` caller left" (plan:956) unmet. | LOW | Batch A4b |
| 7 | A1 and A3 rendered evidence missing; Phase A cannot complete without it. "Before" images exist only in `D:\projects\ptah-extension\.claude-worktrees\docs-lane-header-proof-451ab2d3f2f3\.ptah\specs\TASK_2026_685_64f4\screenshots\current-*.png` (main @ 6c0490f1f, pre-A1). | MEDIUM | Phase A screenshot step after A4/A4b: copy the before set into `screenshots/before/`, capture after for A1 + A3 + A4 surfaces |
| 8 | `app-shell` was refactored on main: overlay refs are now `app-shell.component.ts:36`, `:48`, `:122`, `:160` and `.html:7-11` (plan :54, :69, :144, :185); `app-shell.organization.spec.ts` is deleted; the new `app-shell.previous-sessions.spec.ts:63`, `:199` provides `SubagentTranscriptViewerService`. | LOW | B7a.2 edits those lines and that spec |
| 9 | `rpc.types.ts` shifted +6 (683 added `session:getOrganization`): `subagent:*` registry block now :1182-1201 (`subagent:transcript` :1198), `RPC_METHOD_ENTRIES` subagent rows :3872-3876 (plan :1176-1195, :3865-3869). `SDK_SESSION_HISTORY_READER` registration is `register.ts:204` (plan :203). | LOW | Given to B2b.1 and B6a.1 |
| 10 | `inline-agent-bubble.component.ts` lines moved after A1: transcript button :324, `canViewTranscript` :974, `onViewTranscript` ~:980-990, viewer-service import :54 and inject :610, `progressLine` :935-942, `commandError` :949-955, `childStats` :854, `hasChildren` :874 (plan :322-330, :963-981, :925-932, :853-873). | LOW | Given to A4.1 and B5b.1 |
| 11 | The B6/B7 acceptance grep `SubagentTranscript*` (plan:968) also matches the unrelated, kept `SubagentTranscriptProbe` / `probeSubagentTranscript` (`rpc-handlers/.../chat-ptah-cli.service.ts:48`, `:388`; `chat-subagent-context-injector.service.ts:141`). `SubagentTranscriptSdkModule` (`subagent-message-dispatcher.ts:54`) is used only by `getSubagentTranscript` and goes with it. | LOW | Acceptance grep in B6b uses the exact names listed there; the probe is out of scope and stays |
| 12 | `transcript-agent-facts.ts:90-105` walks agent-node children recursively to build turn agent chips. After B4, a nested agent (claimed by ownership rule 3, plan:532) is no longer in the main tree, so it may lose its turn chip. Plan evidence row (plan:101) names this consumer, but no batch re-sources it and it is not in the Proposed Removals. | MEDIUM | B5b.3 adds a spec that pins top-level chips and checks nested ones. If nested chips are lost, it is a removal the user must approve (see Decisions) |
| 13 | The plan's file list (plan:513-516) gives no file for the per-event clip and page assembly that the handler spec tests as "the pure page-assembly function". | LOW | Decision: a pure sibling module in rpc-handlers (Task B2b.3) |
| 14 | The 683 B6 rebase dependency (plan Risk 5) is satisfied: PR #748 is on main and this branch is rebased on it. | none | Re-verified in Risks 1-2 |
| 15 | A heavy Electron dev build for another task is running on this machine (2026-10-18). | MEDIUM | No lane, check or screenshot starts until it ends; then one heavy check at a time |

Edge cases (from plan components 4, 6-9):

- Subagent with no tray context (finished) -> no actions — A4.2
- Running subagent, no nodes -> "Starting agent"; finished, empty -> "No output recorded" — A4.2, B5a.1
- No `agentId` -> backend correlates, else `unresolved` — B2a.3, B3b.1, B5a.1
- Single message larger than 256 KB, escape-heavy or multi-byte text, `maxBytes: 1024` — B2b.3
- Subagent events after the parent `chat:complete` and after a new parent turn — B1.1, B3b.1, B4.1
- Close or reopen a view during a two-page load (abort, generation) — B3b.1
- Synthesized live id vs real snapshot id, text-only: two copies stay visible (plan Risk 3) — B3b.1
- Claim throws -> fail open to the tab path — B3b.1, B4.1
- Record-less background agent keeps `ptah-background-agent-strip` minus transcript (D13) — B7b.1

## Rules for every lane brief (repeat verbatim)

- Work only in `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream` (lane
  `workingDirectory`). Lanes never run git, never commit, never edit `batches.md` or `task.md`.
- Lanes run NO test, typecheck, lint, build, serve, e2e or package command (team-leader runs
  checks). `ptah_get_diagnostics` scoped to the changed files is allowed.
- CLAUDE.md memory-safe rules apply to anyone running checks: scoped projects only,
  `--parallel=1` for Nx, Jest `--maxWorkers=2` (never on typecheck), one heavy check at a time
  across all lanes, no `build`/`serve`/`dev`/`e2e`/`package`.
- Real code only: no TODO, stub, placeholder or mock data in production files.
- Report: every created/modified/deleted file by absolute path, evidence per task, how each
  listed risk was handled, decisions made.

## Phases and reviews

| Phase | Batches | Review after last batch commits |
| --- | --- | --- |
| A-rest | A4, A4b | code-logic + style (new public `SubagentLaneComponent`) + visual (Phase A screenshots) |
| B-backend | B1, B2a, B2b | code-logic + style (new public RPC `subagent:history-page`) |
| B-store | B3a, B3b, B4 | code-logic + style (new exported `SubagentExecutionStore`) |
| B-render | B5a, B5b, B5c | code-logic + visual (B5 screenshots) |
| B-removals | B7a, B7b, B7c, B6a, B6b | code-logic (removal completeness, guard specs) |

Implementer family: codex CLI lanes. Reviewer family: Claude (`code-logic-reviewer`,
`code-style-reviewer`, `visual-reviewer`) — different family.

## Parallel groups (implementation only; checks still run one at a time)

| Group | Batches | Why file-disjoint |
| --- | --- | --- |
| G1 | A4 ∥ A4b | A4b touches only `subagent-usage-summary.component.ts` and `stats-bar.utils.ts` (+ specs); A4 renders the summary but does not edit it |
| G2 | B1 ∥ B2a ∥ B3a | broadcaster (rpc-handlers) / shared types + agent-sdk / chat-types + chat-streaming; no shared file |
| G3 | B2b ∥ B3a (if B3a still running) | shared `rpc.types.ts` + rpc-handlers handler files / chat-types + chat-streaming |
| G4 | B5a ∥ B5b | subagent-lane + canvas-lane-view / bubble + tile + chat-transcript and message-summary specs |
| G5 | B7b ∥ B7c | chat-ui strip + tray producers + canvas line / chat-ui viewer + chat-ui index + store transcript read |

Everything else is serial in this order:
A4/A4b -> [Phase A review] -> B1/B2a/B3a -> B2b -> B3b -> B4 -> B5a/B5b -> B5c ->
B7a -> B7b/B7c -> B6a -> B6b. Option (not default): B1 and B2a are file-disjoint from A4/A4b and
may start during Phase A if throughput matters; the plan's default is Phase B after Phase A.

Recurring files (serial owners, each starts from the previous committed result):

| File | Owners in order |
| --- | --- |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (+ spec) | A4 -> B5a -> B7b |
| `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts` (+ spec) | A4 -> B5a |
| `libs/frontend/chat/src/lib/components/index.ts` | A4 |
| `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts` | B5b |
| `libs/frontend/chat-ui/src/index.ts` | B7c |
| `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` | B7c |
| `libs/frontend/chat-streaming/src/index.ts` | B3b |
| `libs/shared/src/lib/types/subagent-registry.types.ts` | B2a -> B6b |
| `libs/shared/src/lib/types/rpc.types.ts`, `libs/backend/rpc-handlers/src/lib/handlers/{subagent-rpc.handlers.ts,subagent-rpc.schema.ts}` (+ spec) | B2b -> B6a |
| `libs/frontend/chat/src/lib/services/session-agents/session-agent-tray.service.ts` / `session-agent-tray.ts` | B7a / B7b |

---

## Batch A4: Subagent lane — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer (Claude reviewers)
- Rationale: three coupled tasks (util -> component -> wiring) over two projects; one lane.
- Tasks: 3 | Depends on: A3 (committed 6092bc32b), 683 B6 (on main)
- Phase: A-rest | Phase review: code-logic + style + visual
- Spec section: component 4, plan:337-372; component 3 contract plan:274-304; parity rows
  plan:802-813

### Task A4.1: `subagentProgressText(record)` pure util — PENDING

- File: `libs/frontend/chat/src/lib/utils/subagent-progress.utils.ts` (+ `subagent-progress.utils.spec.ts`), CREATE
- Plan reference: plan:343-344
- Pattern to follow: `inline-agent-bubble.component.ts:935-942` (`progressLine`: `latestSummary`, else `last: <lastToolName>`, else `description`, else null)
- Quality requirements: pure, no Angular; spec covers each branch
- Validation notes: Risk 10 (line moved). Do not edit the bubble here (B5b owns it).
- Implementation details: export `subagentProgressText(record: SubagentRecord): string | null`; type import from `@ptah-extension/chat-streaming`.

### Task A4.2: `ptah-subagent-lane` component — PENDING

- Depends on: Task A4.1
- File: `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts` (+ `subagent-lane.component.spec.ts`), CREATE; `libs/frontend/chat/src/lib/components/index.ts` (export)
- Plan reference: plan:337-372
- Pattern to follow: flat header use in `agent-card.component.ts:62` (A3); steer input use `inspector-agents-section.component.ts:240-253`
- Quality requirements: inputs `record`, `sessionId`, `nodes`; header `kind="subagent"`, label via `agentRunLabel` (live = `running|pending|background`, `AgentMonitorStore.tick` for now), peek `subagentProgressText`, meta tools/files from `summarizeExecutionNodes(nodes)` falling back to `record.toolUses`, tokens from `record.totalTokens` (omit when absent, never `0`), `Background` when `status === 'background'`; actions Background/Stop/Message by `entry.canBackground/stoppable/steerable` from `SessionAgentTrayService.contextsFor(sessionId).get(record.parentToolUseId)`, aria-labels name the agent (`Send Explore to background`, `Stop Explore`, `Message Explore`); steer submit -> `tray.steer`, failure keeps text; error line from `subagentRpcError` narrowed to this key (`inline-agent-bubble.component.ts:949-955` pattern); details: `ptah-subagent-usage-summary`, facts Model, Task, Parent (8 chars + title); body `@for` -> `ptah-execution-node` with `getPermissionForTool` and `permissionResponded` passed through; empty states "Starting agent" (live) and "No output recorded" (finished).
- Validation notes: no tray context -> no actions; no new timers or animation (683 owns motion).
- Implementation details: standalone OnPush; inject tray service and `AgentMonitorStore`; spec covers actions by flags, steer success/failure, error line, details content, empty states.

### Task A4.3: wire `#subagentLane` in the lane view — PENDING

- Depends on: Task A4.2
- File: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (+ `canvas-lane-view.component.spec.ts`)
- Plan reference: plan:363-372
- Pattern to follow: current `#subagentLane` :141-168
- Quality requirements: render `ptah-subagent-lane [record]="sub" [sessionId]="sessionId()" [nodes]="agentNode()?.children ?? []"` and drop the top-level `ptah-subagent-usage-summary` (:144, moves into details); keep the transcript fallback branch (:153-163) beside it until B5a; drop now-unused imports only.
- Validation notes: Risks 1 and 2. Edit only the `#subagentLane` template, imports and members it needs.
- Implementation details: the spec asserts the new element, and that the summary is no longer top-level.

### Batch A4 verification

- Files exist with real implementations; no stub markers
- One check at a time, each after the previous ends:
  `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`
  (confirm "Running target test for 2 projects"), then
  `npx nx run-many -t typecheck -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`, then
  `npx nx run-many -t lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`; output tailed
- Phase A screenshot step (after A4 and A4b commit; Risk 7), visual-reviewer with the private
  profile copy (capture-report method), dark `anubis` + light `anubis-light`:
  - copy the before set from the docs-lane-header-proof worktree into `screenshots/before/`
  - A4: subagent lane finished (and running if available), 1440 + 760
  - A3 carry-over: flat CLI lane, 1440 + 760; main chat turn row unchanged, 1440
  - A1 carry-over: inspector rows, tab chip + hover card, restored CLI lane, 1440
- Edge cases: no tray context, empty running, empty finished

## Batch A4b: retire `formatDuration` (A1 carry-over) — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential (one task); parallel with A4 (group G1)
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: two-file cleanup that closes the A1 acceptance item; disjoint from A4.
- Tasks: 1 | Depends on: A1 (committed)
- Phase: A-rest | Phase review: covered by the A-rest code-logic review
- Spec section: component 1, plan:198-250 (one formatter app-wide); acceptance plan:955-957

### Task A4b.1: idle time through `formatAgentDuration`; delete `formatDuration` — PENDING

- File: `libs/frontend/chat/src/lib/components/molecules/agent-card/subagent-usage-summary.component.ts` (+ spec), `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts` (+ spec if it covers `formatDuration`)
- Plan reference: plan:96, :956
- Pattern to follow: `cli-agent-output.component.ts` duration display after A1 (uses `formatAgentDuration`, hides sub-second)
- Quality requirements: `subagent-usage-summary.component.ts:31`, `:134` format idle time with `formatAgentDuration` from `@ptah-extension/chat-ui`; keep `unknown` for undefined; define the sub-second text explicitly (keep current meaning, e.g. `<1s`) and spec it; delete `formatDuration` from `stats-bar.utils.ts:36-50`.
- Validation notes: Risk 6. Other libs' own `formatDuration` functions (chat-ui session stats, dashboard, setup-wizard, skill-synthesis-ui) are unrelated and stay.
- Implementation details: confirm no caller of the chat `formatDuration` remains in `libs/frontend`.

### Batch A4b verification

- Shares the A4 check commands (same project `@ptah-extension/chat`); if A4 is not ready, run
  `npx nx test @ptah-extension/chat --parallel=1`, `npx nx typecheck @ptah-extension/chat --parallel=1`,
  `npx nx lint @ptah-extension/chat --parallel=1`, one at a time
- Commit separately from A4

---

## Batch B1: root-only turn boundary in the broadcaster — PENDING

- Recommended executor: CLI lane (codex), backend-developer brief
- Execution mode: sequential (one task); group G2
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: one file, one rule, regression spec.
- Tasks: 1 | Depends on: Phase A review accepted (plan order)
- Phase: B-backend | Phase review: code-logic + style
- Spec section: component 5, plan:376-389

### Task B1.1: count root events only for the turn gate — PENDING

- File: `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts` (+ `chat-stream-broadcaster.service.spec.ts`)
- Plan reference: plan:376-389
- Pattern to follow: existing gate at :269-271 and :284-296 (verified unchanged)
- Quality requirements: reset `turnCompleteSent` only for `message_start` without `parentToolUseId`; send `CHAT_COMPLETE` only for `message_complete` without `parentToolUseId`; subagent events still published (:262); end-of-stream fallback (:299-307) unchanged.
- Validation notes: spec (a) subagent start/complete after the parent's complete send no second `chat:complete`; (b) subagent complete before the parent's does not complete early; (c) root unchanged.
- Implementation details: read `parentToolUseId` from the flat event; no new state.

### Batch B1 verification

- `npx nx test @ptah-extension/rpc-handlers --parallel=1`, then `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1`, then `npx nx lint @ptah-extension/rpc-handlers --parallel=1`
- Screenshots: none

## Batch B2a: structured subagent history read (agent-sdk) — PENDING

- Recommended executor: CLI lane (codex), backend-developer brief
- Execution mode: sequential; group G2
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: types + replay + reader are one dependency chain; the RPC surface is B2b so each
  batch stays within 2 projects.
- Tasks: 3 | Depends on: Phase A review accepted
- Phase: B-backend | Phase review: code-logic + style
- Spec section: component 6, plan:390-516 (contract plan:394-404; reader and replay plan:413-436)

### Task B2a.1: page contract types — PENDING

- File: `libs/shared/src/lib/types/subagent-registry.types.ts`
- Plan reference: plan:394-404
- Pattern to follow: `SubagentTranscriptParams` / `Result` in the same file (:280-297)
- Quality requirements: `SubagentHistoryPageParams`, `SubagentHistoryPageResult` exactly as specified; exported from the shared barrel if the file's other types are.
- Validation notes: name contains no host-source word (plan:106).
- Implementation details: types only; no registry entry here (B2b).

### Task B2a.2: thinking branch and per-agent replay — PENDING

- Depends on: Task B2a.1
- File: `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts` (+ `history-event-factory.spec.ts`), `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` (+ spec)
- Plan reference: plan:420-436
- Pattern to follow: `createThinkingDelta` `history-event-factory.ts:157-175`, `createAgentTextDelta` `:338-358`; `processAgentMessages` `session-replay.service.ts:496-581`
- Quality requirements: `createAgentThinkingDelta`; unconditional thinking branch in content order (empty skipped); public `replayAgentToStreamEvents(sessionId, toolCallId, messages)` with the private per-call option: real `message.id` grouping, running `blockIndex`, JSONL timestamps; main-history replay keeps synthetic ids.
- Validation notes: Assumptions A3, A6, A7 — replay spec with one message holding thinking, text, `tool_use`, `tool_result` yields them in order with real id, running indices, JSONL timestamps; main-history replay gains only the thinking event.
- Implementation details: no new DI service.

### Task B2a.3: `readSubagentEvents` in the history reader — PENDING

- Depends on: Task B2a.2
- File: `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` (+ spec)
- Plan reference: plan:413-420, :482-489
- Pattern to follow: correlation `agent-correlation.service.ts:172-240` used at `session-replay.service.ts:113-121`; locator `workflow-transcript-reader.ts:51`
- Quality requirements: agent id from param, else correlation, else `unresolved`; id checked against `^[A-Za-z0-9_-]{1,128}$` before any path join; locate subagents dir, legacy flat, workflows dir, else `not-found`; keep newest 10 000 events with `truncated`; read/parse failure -> user-safe error without a path; 50 MB limit.
- Validation notes: fixtures for the three locations, missing file, oversized file, correlated id, no match.
- Implementation details: returns `{ status, agentId, events, truncated }`; clipping and paging are B2b.3.

### Batch B2a verification

- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk --parallel=1` (confirm 2 projects), then the same with `-t typecheck`, then `-t lint`
- Screenshots: none

## Batch B2b: `subagent:history-page` RPC — PENDING

- Recommended executor: CLI lane (codex), backend-developer brief
- Execution mode: sequential; group G3 (may overlap B3a)
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: registry entry, schema and handler must land in one commit (plan:1015-1017).
- Tasks: 3 | Depends on: B2a
- Phase: B-backend (last batch) | Phase review: code-logic + style
- Spec section: component 6, plan:404-412 (handler, schema), plan:437-481 (caps, paging), plan:490-511 (specs); Verification points plan:1013-1043

### Task B2b.1: registry entry — PENDING

- File: `libs/shared/src/lib/types/rpc.types.ts`
- Plan reference: plan:394-395
- Pattern to follow: `subagent:*` block :1182-1201, `RPC_METHOD_ENTRIES` :3872-3876 (Risk 9)
- Quality requirements: `'subagent:history-page'` in `RpcMethodRegistry` and `RPC_METHOD_ENTRIES`; do not edit `host-source-registry.baseline.ts` (P4, D12).

### Task B2b.2: zod schema — PENDING

- File: `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.schema.ts`
- Plan reference: plan:407-412
- Pattern to follow: `SubagentTranscriptSchema` :86-95; `session-rpc.schema.ts:65-72` for `maxBytes`
- Quality requirements: `toolCallId` and optional `agentId` `^[A-Za-z0-9_-]{1,128}$`; `sessionId` validated like other session params; `maxBytes` 1024..262144, default 128 KB; `cursor` optional string.

### Task B2b.3: handler, per-event clip and page assembly — PENDING

- Depends on: Tasks B2b.1, B2b.2
- File: `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts` (+ `subagent-rpc.handlers.spec.ts`); CREATE `libs/backend/rpc-handlers/src/lib/handlers/subagent-history-page.ts` (+ `subagent-history-page.spec.ts`) — pure clip + page functions (Risk 13)
- Plan reference: plan:405-406, :437-481, :482-511
- Pattern to follow: CLI output page `session-metadata-store.ts:260-262`, `:342-353`, `:991-1005`, `:1025-1027`; `METHODS` :83-90, `register()` :108-119
- Quality requirements: inject `SDK_TOKENS.SDK_SESSION_HISTORY_READER` (`tokens.ts:29`, registered `register.ts:204`); content budgets then the 96 KB serialized hard cap with binary search; envelope measured with 64-char correlation id and 32-char cursor reservations; >= 1 event per page; final re-measure and cut-back; cursor always advances; `clippedEvents`; `not-found` / `unresolved` / `ok` empty / error mapping (`RpcUserError('INVALID_PARAMS')`, `Could not read agent output`).
- Validation notes: every handler-spec case listed in plan:494-509 (300 KB text, 1 MB tool result, 90 000 control chars, 90 000 multi-byte chars, `maxBytes: 1024`, near-full page with 36- and 64-char ids, cut-back path, 96 KB event + envelope < 256 KB, `../` rejected).

### Batch B2b verification

One command at a time:
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1` (covers `rpc-allowlist.spec.ts`), then `-t typecheck`, then `-t lint`
- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2`
- `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-extension-vscode/src/di/surface-composition.spec.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`
- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/rpc-surface.spec.ts apps/ptah-electron/src/di/surface-composition.spec.ts apps/ptah-electron/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`
- `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/surface-composition.spec.ts --coverage=false --maxWorkers=2`
- Screenshots: none

---

## Batch B3a: store prerequisites (event cap, root option, skipStoreEffects) — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential; group G2 / G3
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: three small, additive hooks the store needs; none needs the new RPC (Risk 4).
- Tasks: 3 | Depends on: Phase A review accepted
- Phase: B-store | Phase review: code-logic + style
- Spec section: component 7, plan:541-544 (event cap), plan:645-649 (tree builder), plan:636-640 + :594-600 (`skipStoreEffects`)

### Task B3a.1: optional `eventCap` on `StreamingState` — PENDING

- File: `libs/frontend/chat-types/src/lib/chat-types.ts`; spec in `libs/frontend/chat-streaming/src/lib/streaming-event-cap.spec.ts` (CREATE; Risk 5)
- Plan reference: plan:541-544
- Pattern to follow: `setStreamingEventCapped` `chat-types.ts:259-303`, `STREAMING_EVENT_CAP` :207
- Quality requirements: `eventCap?: number` read by `setStreamingEventCapped`, default `STREAMING_EVENT_CAP`; existing callers unchanged.

### Task B3a.2: `rootParentToolUseId` option on `buildTree` — PENDING

- File: `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts` (+ spec); `execution-tree-cache.ts` only if Assumption A1 fails
- Plan reference: plan:645-649
- Pattern to follow: root filter at :319; `buildTree` :279-296
- Quality requirements: with the option, roots = message starts whose `parentToolUseId === option`; without it, unchanged; nested agents build as today.
- Validation notes: Assumption A1 — spec proves digests attribute those roots to themselves.

### Task B3a.3: `skipStoreEffects` on `AccumulatorContext` — PENDING

- File: `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts` (+ spec)
- Plan reference: plan:594-600, :636-640
- Pattern to follow: context :63-86; store calls at :449-456 (`onTaskToolResult`, now with timestamp), :497-498, :537-538, `onAgentStart`
- Quality requirements: default false; when true, none of the listed store calls run; every existing caller unchanged.

### Batch B3a verification

- `npx nx test @ptah-extension/chat-streaming --parallel=1`, then
  `npx nx run-many -t typecheck -p @ptah-extension/chat-types @ptah-extension/chat-streaming --parallel=1`, then
  `npx nx run-many -t lint -p @ptah-extension/chat-types @ptah-extension/chat-streaming --parallel=1`
- Screenshots: none

## Batch B3b: `SubagentExecutionStore` — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: the core of 633; one file plus its spec and barrel; HIGH complexity, kept alone.
- Tasks: 2 | Depends on: B3a, B2b (typed RPC, Risk 4)
- Phase: B-store | Phase review: code-logic + style
- Spec section: component 7, plan:518-699 (whole)

### Task B3b.1: the store — PENDING

- File: `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts` (+ `subagent-execution.store.spec.ts`), CREATE
- Plan reference: plan:518-699
- Pattern to follow: accumulator use with `onStateChanged` `accumulator-core.service.ts:63-86`; scratch-state precedent `streaming-handler.service.ts:408-435`; `capFinalizedTree` `execution-tree-retention.ts:157`
- Quality requirements: entry shape, ownership rules 1-5, finalize, three retention bounds (20 finalized LRU, 2000/entry, 10 000 live total with spill), pin via `retain`/`release`, owner maps <= 4000, `ensureHistory` single flight with generation abort, snapshot/live merge steps 1-6 with a merge-local `EventDeduplicationService` and `skipStoreEffects`, `historyEventsSeen`, `clearSession`, claim exceptions caught and fail open.
- Validation notes: all spec cases in plan:665-686, including merge cases (1)-(7), abort during a two-page load, and states loaded-empty / not-found / unresolved / error / waiting. Assumptions A2, A3, A5, A8.

### Task B3b.2: export — PENDING

- Depends on: Task B3b.1
- File: `libs/frontend/chat-streaming/src/index.ts`

### Batch B3b verification

- `npx nx test @ptah-extension/chat-streaming --parallel=1`, `npx nx typecheck @ptah-extension/chat-streaming --parallel=1`, `npx nx lint @ptah-extension/chat-streaming --parallel=1`, one at a time
- Screenshots: none

## Batch B4: claim seams — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: three call sites of the store; hot path (plan Risk 1).
- Tasks: 3 | Depends on: B3b
- Phase: B-store (last batch) | Phase review: code-logic + style
- Spec section: component 8, plan:701-723

### Task B4.1: claim in `processStreamEvent` — PENDING

- File: `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts` (+ `streaming-handler.service.spec.ts`, `streaming-handler.background.spec.ts`)
- Plan reference: plan:705-707
- Quality requirements: claim once per event before tab resolution, background routing and fan-out; claimed -> `null`; no tab state minted; O(1), no allocation for unclaimed events.
- Validation notes: late subagent event after finalize retained in the store, nothing minted on the tab; `message-finalization.service.spec.ts:731-751` stay green.

### Task B4.2: history builder — PENDING

- File: `libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts` (+ spec)
- Plan reference: plan:708-710
- Quality requirements: subagent-owned history events go to `historyEventsSeen`, records/usage still updated, not added to the scratch tab state; restored tree has agent nodes without subagent children.

### Task B4.3: session cleanup — PENDING

- File: `libs/frontend/chat-routing/src/lib/stream-router.service.ts` (+ spec)
- Plan reference: plan:711-713
- Quality requirements: `subagentExecution.clearSession(sid)` beside `clearSessionAgents` (:293) and `forceClearSessionAgents` (:957).

### Batch B4 verification

- `npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat-routing --parallel=1` (confirm 2 projects), then `-t typecheck`, then `-t lint`
- Screenshots: none

---

## Batch B5a: subagent lane on the store tree — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential; group G4
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: the lane component and its host move together (input contract changes).
- Tasks: 2 | Depends on: B4, A4
- Phase: B-render | Phase review: code-logic + visual
- Spec section: component 9, plan:729-742; parity row "Lane fallback" plan:818

### Task B5a.1: `SubagentLaneComponent` reads the store — PENDING

- File: `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts` (+ spec)
- Plan reference: plan:730-738
- Quality requirements: drop `nodes`; `store.treeFor(key)`; one `retain` on mount, `release` on destroy; `ensureHistory` when not live and not loaded; every state line in plan:731-736 with Retry buttons (no loop, no observer).

### Task B5a.2: lane view cleanup — PENDING

- File: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (+ spec)
- Plan reference: plan:739-742
- Quality requirements: `#subagentLane` passes only `record` and `sessionId`; delete `agentNode`, `findAgentNode`, the tree-builder and tab-manager reads used only by it, the transcript members, effect, `loadTranscript`, the fallback branch and the `SubagentTranscriptViewerComponent` / `SubagentTranscriptMessage` imports (R8f). Keep `canViewTranscript: false` at :131 (B7b removes it, Risk 3).
- Validation notes: Risks 1, 2. Spec: no `subagent:transcript` call, no main-tree walk.

### Batch B5a verification

- Runs after B5b if both are ready (shared project chat):
  `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`, then `-t typecheck`, then `-t lint`
- Screenshots: at the end of B-render (below)

## Batch B5b: main chat bubble and tile on the store tree — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential; group G4
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: main-chat renderers plus the user decisions P1-P3 and the bubble transcript removal (file ownership, plan:749-751).
- Tasks: 3 | Depends on: B4
- Phase: B-render | Phase review: code-logic + visual
- Spec section: component 9, plan:743-760; Clarifications plan:1092-1103; parity row "View transcript button" plan:814

### Task B5b.1: bubble — PENDING

- File: `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts` (+ spec)
- Plan reference: plan:743-753
- Quality requirements: body stamps `store.treeFor(toolCallId)` roots through the existing `nodeTemplate` (no new import, cycle stays broken); live renders at once; restored shows "Load agent output" -> `ensureHistory` (P2); `hasChildren`/`childStats` (:854, :874) read the tree, else `record.toolUses`; summary-chunk text only while the store tree is empty (P3); remove the transcript button (:324), `canViewTranscript` (:974), `onViewTranscript`, viewer-service import (:54) and inject (:610) (Risk 10); `retain`/`release`.
- Validation notes: bubble spec: live tree, Load button, counts, no `subagent-transcript-button`, no double summary text.

### Task B5b.2: tile — PENDING

- File: `libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts` (+ spec)
- Plan reference: plan:757-758
- Quality requirements: tool count and latest activity from the store tree, else `record.toolUses` / `record.lastToolName`.

### Task B5b.3: P1 and in-place view specs; nested-agent check — PENDING

- File (spec only): `libs/frontend/chat/src/lib/utils/message-summary.utils.spec.ts`, `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts`; read-only check of `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.ts`
- Plan reference: plan:754-756, :770-772, :962-966
- Quality requirements: P1 spec (counts only the parent's tools/files on input without agent children); turn agent chip -> in-place view shows store output that arrived after the parent `chat:complete`, pending identity before `agent_start`; a spec that top-level agent chips survive B4, and a report on whether nested agents keep a chip (Risk 12). Do not change `transcript-agent-facts.ts` without a team-leader decision.
- Validation notes: `chat-transcript.component.ts` was refactored by 683 (+116 lines); re-read before writing the spec.

### Batch B5b verification

- Same command set as B5a (project chat; canvas included only once B5a is in). If B5a is not ready:
  `npx nx test @ptah-extension/chat --parallel=1`, `npx nx typecheck @ptah-extension/chat --parallel=1`, `npx nx lint @ptah-extension/chat --parallel=1`

## Batch B5c: agent monitor panel on the subagent lane — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: renders `ptah-subagent-lane`, so it waits for B5a.
- Tasks: 1 | Depends on: B5a
- Phase: B-render (last batch) | Phase review: code-logic + visual
- Spec section: component 9, plan:761-764; parity row "Workflow-subagent output" plan:821

### Task B5c.1: panel workflow-subagent detail — PENDING

- File: `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts` (+ `agent-monitor-panel.component.spec.ts`, `agent-monitor/agent-lane-panel.spec.ts`)
- Plan reference: plan:761-764
- Pattern to follow: current detail at :569-598, signals :970-977, loader :1206-1247
- Quality requirements: render `ptah-subagent-lane` instead of the transcript viewer; delete its transcript signals, loader and the `SubagentTranscriptViewerComponent` / `SubagentTranscriptMessage` imports (:53, :62, :193); update `agent-lane-panel.spec.ts:18`, `:158`.

### Batch B5c verification

- `npx nx test @ptah-extension/chat --parallel=1`, `npx nx typecheck @ptah-extension/chat --parallel=1`, `npx nx lint @ptah-extension/chat --parallel=1`
- B-render screenshot step (visual-reviewer, dark + light, 1440 + 760): running subagent lane,
  finished subagent lane, restored subagent lane after Load; main chat subagent bubble live and
  restored with Load; agent monitor panel workflow subagent; before images from the A4 after set

---

## Batch B7a: transcript callers in chat — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: chat-only deletions; the strip contract stays until B7b.
- Tasks: 2 | Depends on: B5b, B5c
- Phase: B-removals | Phase review: code-logic
- Spec section: component 10, plan:779-793; parity rows plan:815-816, :819

### Task B7a.1: inspector "View transcript" — PENDING

- File: `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-actions-menu.component.ts` (+ spec), `inspector-agents-section.component.ts` (+ spec)
- Quality requirements: remove the menu item (:38) and the handler branch calling `tray.viewTranscript` (:410).

### Task B7a.2: tray action, overlay and viewer service — PENDING

- Depends on: Task B7a.1
- File: `libs/frontend/chat/src/lib/services/session-agents/session-agent-tray.service.ts` (+ spec); `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`, `app-shell.component.html`, `app-shell.previous-sessions.spec.ts`; DELETE `libs/frontend/chat/src/lib/components/organisms/subagent-transcript-overlay.component.ts` (+ spec), `libs/frontend/chat/src/lib/services/subagent-transcript-viewer.service.ts`
- Quality requirements: remove `viewTranscript` and the viewer injection (:8, :34, :100-108); app-shell lines :36, :48, :122, :160 and html :7-11 (Risk 8); remove the provider in `app-shell.previous-sessions.spec.ts:63`, `:199`.

### Batch B7a verification

- `npx nx test @ptah-extension/chat --parallel=1`, `npx nx typecheck @ptah-extension/chat --parallel=1`, `npx nx lint @ptah-extension/chat --parallel=1`
- Screenshots: inspector actions menu after, dark + light, 1440 (taken with B7b's strip shot)

## Batch B7b: `canViewTranscript` field and strip item — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential; group G5
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: one required field with producers in three projects must change in one commit
  (Risk 3). Exception to the 2-project limit: compile atomicity; 3 files.
- Tasks: 1 | Depends on: B7a, B5a
- Phase: B-removals | Phase review: code-logic
- Spec section: parity rows plan:816-817

### Task B7b.1: remove the field, the strip action and its producers — PENDING

- File: `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts` (+ spec: :79-81, :331-346, :435, :474); `libs/frontend/chat/src/lib/services/session-agents/session-agent-tray.ts` (+ spec: :27 doc, :177, :234); `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (:131 only)
- Quality requirements: no `canViewTranscript` / `viewTranscript` left in these files; D13 strip stays for record-less background agents.
- Validation notes: Risks 1, 3.

### Batch B7b verification

- `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/canvas --parallel=1` (confirm 3 projects), then `-t typecheck`, then `-t lint`
- Screenshots: background strip menu and inspector actions menu after, dark + light, 1440

## Batch B7c: transcript viewer component and store read — PENDING

- Recommended executor: CLI lane (codex), frontend-developer brief
- Execution mode: sequential; group G5
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: last frontend users of the RPC; needs B5a, B5c and B7a to have dropped them.
- Tasks: 2 | Depends on: B7a, B5a, B5c
- Phase: B-removals | Phase review: code-logic
- Spec section: parity rows plan:820, :822

### Task B7c.1: delete the chat-ui viewer — PENDING

- File: DELETE `libs/frontend/chat-ui/src/lib/molecules/subagent-transcript-viewer.component.ts` (+ spec if present); `libs/frontend/chat-ui/src/index.ts` (:45)

### Task B7c.2: delete `getSubagentTranscript` — PENDING

- File: `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` (+ spec): :2501-2540 and doc :541; drop the `SubagentTranscriptMessage` import (:33)

### Batch B7c verification

- `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat-streaming --parallel=1`, then `-t typecheck`, then `-t lint`
- `rg -n "subagent:transcript|getSubagentTranscript|SubagentTranscriptViewer|SubagentTranscriptOverlay|viewTranscript|canViewTranscript" libs/frontend` returns nothing

## Batch B6a: `subagent:transcript` RPC surface — PENDING

- Recommended executor: CLI lane (codex), backend-developer brief
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: registry and handler removal in one commit; dispatcher next.
- Tasks: 1 | Depends on: B7c (no frontend caller left)
- Phase: B-removals | Phase review: code-logic
- Spec section: parity row "`subagent:transcript` RPC" plan:823; D11 plan:1061

### Task B6a.1: remove method, schema and handler — PENDING

- File: `libs/shared/src/lib/types/rpc.types.ts` (imports :88-89 area, registry :1198-1201, entry :3876; Risk 9); `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.schema.ts` (:86-95), `subagent-rpc.handlers.ts` (+ spec: :42-43, :54, `METHODS`, `register()`, :340-381)
- Quality requirements: do not edit `host-source-registry.baseline.ts` (P4).

### Batch B6a verification

- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1`, then `-t typecheck`, then `-t lint`
- The host-source contract spec and the seven DI guard specs, one at a time (commands as in B2b)

## Batch B6b: dispatcher transcript path and types — PENDING

- Recommended executor: CLI lane (codex), backend-developer brief
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: last contract removal; compiles only after B6a.
- Tasks: 1 | Depends on: B6a
- Phase: B-removals (last batch) | Phase review: code-logic
- Spec section: parity row plan:823

### Task B6b.1: remove dispatcher methods and shared types — PENDING

- File: `libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.ts` (+ spec: :32 import, :54 `SubagentTranscriptSdkModule`, `getSubagentTranscript` :427, `normalizeTranscript` :480, `renderMessageText` :513 if unused elsewhere); `libs/shared/src/lib/types/subagent-registry.types.ts` (:265-297)
- Validation notes: Risk 11 — keep `SubagentTranscriptProbe` / `probeSubagentTranscript`.

### Batch B6b verification

- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk --parallel=1`, then `-t typecheck`, then `-t lint`
- The seven DI guard specs, one at a time (commands as in B2b)
- `rg -n "subagent:transcript|getSubagentTranscript|SubagentTranscriptMessage|SubagentTranscriptParams|SubagentTranscriptResult|SubagentTranscriptSchema|SubagentTranscriptInput|SubagentTranscriptSdkModule|SubagentTranscriptViewer|SubagentTranscriptOverlay|viewTranscript|canViewTranscript" libs apps --glob '!**/host-source-registry.baseline.ts'` returns nothing

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Split B2 into B2a (types + agent-sdk) and B2b (registry + RPC handler) | One 7-file, 3-project batch / split | 6-file, 2-project batch limit; registry and handler must share a commit (plan:1015-1017) | Yes |
| Split B3 into B3a and B3b; B3b waits for B2b | Plan's B1 ∥ B2 ∥ B3 / split | Risk 4 | Yes |
| Split B5 into B5a, B5b, B5c | One 6-file batch / split | B5a and B5b are file-disjoint (parallel); the panel renders the lane, so it follows B5a | Yes |
| Split B7 into B7a, B7b, B7c and B6 into B6a, B6b; B7b takes canvas-lane-view :131 | Plan's B7 / B6 | Risk 3; each intermediate commit compiles | Yes |
| Add Batch A4b for `formatDuration` | Fold into A4 / separate | Risk 6; keeps A4 within 6 files | Yes |
| Clip + page assembly in a new pure `subagent-history-page.ts` in rpc-handlers | Inside the handler / reader / pure module | The plan tests "the pure page-assembly function" (plan:505-506) on the handler side; the reader returns raw events | Yes |
| `eventCap` spec lives in chat-streaming | chat-types spec / chat-streaming | Risk 5 | Yes |
| Batch A4 left PENDING, not IN_PROGRESS | Mark IN_PROGRESS now / on spawn | The spawn prompt forbids starting a lane while the Electron build runs; IN_PROGRESS means assigned | Yes — set at spawn |
| Phase A screenshot step covers A1 + A3 + A4 | Separate captures / one step | Risk 7; one Electron slot | Yes |
| Risk 12 (nested agent chips) is checked in B5b.3; any loss goes to the user | Silently accept / re-source now / check then escalate | Not in the approved removals (plan:829-840); removing a capability is user-reserved | Yes |
