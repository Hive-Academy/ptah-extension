# Parity Inventory - TASK_2026_677_efcd

Surfaces replaced or rebuilt:

- A. Tab `viewMode` `'compact'` and `ptah-compact-session-card` (chat-host variant) — `C/templates/chat-view.component.html:4-14`.
- B. Per-message auto-collapse and bubble chrome in `ptah-message-bubble` — `C/organisms/message-bubble.component.{ts,html}`.
- C. Chat-view surfaces around the transcript — `C/templates/chat-view.component.html:20-190`.
- D. Canvas Rail details aside — `CV/canvas-detail/canvas-session-details.component.ts` (re-skinned as the inspector body).
- E. Canvas thread switcher (lane strip) — `CV/canvas-detail/canvas-lane-tabs.component.ts`, mounted at
  `CV/canvas-rail/canvas-focus-area.component.ts:56-61` (rebuilt as the agent dock, Delta 2, task-description req. 18-19),
  plus today's agent kind glyphs of the chat-host compact card (E-16).

Prefixes: C = `libs/frontend/chat/src/lib/components`, CU = `libs/frontend/chat-ui/src/lib`, CS = `libs/frontend/chat-state/src/lib`,
CV = `libs/frontend/canvas/src/lib`. Line numbers come from `handoff-1.md` §4, `design-spec-review.md` finding 1, and direct reads of
`chat-view.component.html`, `message-bubble.component.html`, `canvas-session-details.component.ts` and `compact-session-card.component.ts`
in this worktree (2026-10-15).

Decision rule (task-description PM-5): default `keep` or `move`. `remove-proposed` only where design-spec.md excludes the capability. After
design-spec revise round 1 (commit 3693f9227, §12.2-12.3, D19) no row qualifies: B-4, B-8, B-11 are `move` and B-14, B-15 are `keep`.
Revision round 1 also corrected the C-18 and D-10 citations (task-description-review finding 5).

Test column: testing is postponed by the user (decisions.md row 3). The column names the existing spec file for that component, which must
keep passing; "postponed (T2)" where no spec exists or the existing spec does not cover the capability.

## A. View mode and compact session card

| ID | Capability | Where today (file:line) | Backing RPC / API / store | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| A-1 | Per-tab presentation switch `'full' \| 'compact'` | `chat-types.ts:507,782`; `CS/tab-manager.service.ts:3089-3108` | `TabManagerService` toggle/set/get | keep | Same API; `full` = reference density, `compact` = tighter density with the live log collapsed and the inspector closed by default, over the same clean-turn transcript (design-spec §3.8, D16; task-description PM-1, req. 16) | `CS/tab-manager.service.spec.ts` |
| A-2 | View mode survives reload | `CS/tab-persistence.ts:161-175` | tab persistence (local state) | keep | Unchanged | postponed (T2) (`tab-persistence.backoff.spec.ts` covers backoff only) |
| A-3 | Toggle control in the tab item (`data-compact`) | `CU/molecules/session/tab-item.component.ts:72-83` | `toggleTabViewMode(tabId)` | keep | Unchanged | postponed (T2) (T2-01) |
| A-4 | Toggle control in the Rail focus header | `CV/canvas-rail/canvas-focus-header.component.ts:57-60` | `TabManagerService` | keep | Unchanged | `CV/canvas-rail/canvas-focus-header.component.spec.ts` |
| A-5 | Rail board cards always render the compact card (`SESSION_FORCED_CARD`, `variant 'rail'`, `ptah-compact-rail-card`) | `C/molecules/compact-session/compact-session-card.component.ts:117-143`; token in `C/tokens/session-context.token` | `SESSION_FORCED_CARD`, `SESSION_CARD_ACTIONS` | keep | Unchanged (out of scope) | `CU/molecules/compact-session/compact-rail-card.component.spec.ts`; `compact-session-card.component.spec.ts`; Rail part postponed (T2-02) |
| A-6 | Chat-host compact card replaces the transcript when `showCompactCard()` | `C/templates/chat-view.component.html:4-14`; `chat-view.component.ts:962-978` | `TabState.viewMode`, `SESSION_FORCED_CARD` | move | Card retired; the clean-turn transcript renders in both modes, the inspector holds the aggregates (req. 1, 16.1, 16.8) | `C/templates/chat-view.component.spec.ts` |
| A-7 | Live / finalized session summary text (sampled stream) | `compact-session-card.component.ts:578-613`; `summarizeLive`, `summarizeFinalized` (chat-ui) | `TabState.streamingState`, `messages` | move | Work log while streaming; final answer when done (req. 1.1-1.2) | `C/molecules/compact-session/compact-session-card.component.spec.ts` |
| A-8 | Lane rows (sub-agents, CLI lanes, background) with status | `C/molecules/compact-session/compact-lane-rows.ts:52` (`buildLaneSummary`); template `:149-167` | `AgentMonitorStore.sessionSubagentsForSession()`, `agentsOwnedBySession()`, `BackgroundAgentStore.agentsForSession()` | move | Agent chip row (req. 4) and inspector AGENTS (req. 8) | `C/molecules/compact-session/compact-lane-rows.spec.ts` |
| A-9 | Open a lane from a lane row | `compact-session-card.component.ts:541-553` (`openLane`) | lane keys `sub:` / `cli:` / `bg:` (`laneKey`) | move | Chip click and inspector row click (req. 4.3, 8.4) | `compact-session-card.component.spec.ts` |
| A-10 | Permission callout with inline Allow / Deny | `compact-session-card.component.ts:478-513` (`respond`) | `PermissionHandlerService`, `AgentPermissionResponder` | move | Inspector row `Review` -> surface that allows/denies that request (req. 9.1, 9.3) | `compact-session-card.component.spec.ts` |
| A-11 | Open the request (permission) source | `compact-session-card.component.ts:515-525` (`openRequest`) | `PermissionRequest` | move | Inspector row `Review` (req. 9.3) | `compact-session-card.component.spec.ts` |
| A-12 | Answer a user question from the callout | `compact-session-card.component.ts:527-534` (`answerQuestion`) | `AskUserQuestionRequest` | move | Inspector row `Answer` (req. 9.2-9.3); question cards stay (C-12) | `compact-session-card.component.spec.ts` |
| A-13 | Requests filtered to this tab only | `compact-session-card.component.ts:363-381`, `:621-641` (`targetsTab`) | `TabSessionBinding`, `ConversationRegistry` | move | Session-scoped aggregation (req. 12.1) | `compact-session-card.component.spec.ts` |
| A-14 | Elapsed time of the running session | template `:156` (`elapsed`), `clearElapsedTimer` `:567-571` | `TabState` timestamps | move | Live line timer and `Working · t` label (req. 1, 5.3) | `CU/molecules/compact-session/compact-session-activity.component.spec.ts` |
| A-15 | Branch, context %, todos, git +/- on the card | template `:155-159` | `agentOrigin.branch`, `liveModelStats`, `summarizeTodos`, `SessionGitStatsStore` | move | Inspector orchestrator card, TODOS, GIT; header branch hint (req. 7, 10, 11, 12.3) | `compact-session-activity.component.spec.ts`; `CU/molecules/compact-session/compact-session-metrics.spec.ts` |
| A-16 | "Show output" / expand to the full view | `compact-session-card.component.ts:555-565` (`openFullView`); `chat-view.component.html:12` (`expandToFull`) | `TabManagerService` view mode | move | Disclosure row opens the work log (req. 1.2, 1.5); `Show activity` opens the activity panel (req. 5.1, 5.5); view-mode toggle (A-1) | `compact-session-card.component.spec.ts` |

## B. Message bubble (per-message auto-collapse and chrome)

| ID | Capability | Where today (file:line) | Backing RPC / API / store | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| B-1 | Auto-collapse of messages older than the last four (local, not persisted) | `C/organisms/message-bubble.component.ts:216-281` | component state | move | Per-turn work-log auto-collapse on the final message (req. 1.2, 1.5) | `C/organisms/message-bubble.component.spec.ts` |
| B-2 | Collapse/expand header button with chevron and `aria-expanded` | `message-bubble.component.html:39-55`, `:76-89` | component state | move | Disclosure row `Worked for` with chevron and `aria-expanded` (req. 1.7) | `message-bubble.component.spec.ts` |
| B-3 | Message title and collapsed description | `message-bubble.component.html:56-62`, `:76-89` (`messageSummary`) | `messageSummary()` | move | Final answer always visible under the disclosure (req. 1.2) | `message-bubble.component.spec.ts` |
| B-4 | Collapsed-header tool count and files-changed count | `message-bubble.component.html:63-72` | `messageSummary().toolCount`, `.filesChanged` | move | Count meta `{n} tools · {n} files` at the right end of the disclosure row, part of its accessible name; visible at rest (design-spec §3.2, §12.2; req. 1.10) | postponed (T2) |
| B-5 | Execution tree: text, markdown, thinking, tool cards, SDK cards, agent summary, `ptah-ui`, inline permission card, agent nodes | `message-bubble.component.html:99-133`; `C/organisms/execution/execution-node.component.ts:167-340` | `ExecutionNode` tree from streaming state | keep | Expanded work log (req. 2.1) | `execution-node.ptah-ui.spec.ts`, `execution-node.render-throttle.spec.ts`, `execution-node.send-message.spec.ts`, `execution-node.streaming-dom.spec.ts` |
| B-5a | Tool-call row rendering (verb, bold file name, path, arguments chip; expandable input, output and errors) | `C/organisms/execution/execution-node.component.ts:316-336` (`ptah-tool-call-item`); `C/molecules/tool-execution/tool-call-item.component.ts:84-99` (`ptah-tool-call-header`, `ptah-tool-input-display`, `ptah-tool-output-display`); `CU/molecules/tool-execution/tool-call-header.component.ts` | `ExecutionNode` tool nodes from streaming state | keep | Unchanged, wrapped by the work log (user decision, decisions.md row 32; task-description req. 20) | `C/molecules/tool-execution/tool-call-item.component.spec.ts`; `CU/molecules/tool-execution/tool-call-header.component.spec.ts`, `tool-input-display.component.spec.ts`, `tool-output-display.component.spec.ts` |
| B-6 | Mermaid fallback rendering of message text | `message-bubble.component.html:117` (`ptah-mermaid-message-text`) | message text | keep | Final answer / work log (req. 2.1) | postponed (T2) |
| B-7 | Typing cursor while streaming | `message-bubble.component.html:130` | `isStreaming` | move | Streaming caret on the last log line (design-spec §3.3) | `message-bubble.component.spec.ts` |
| B-8 | Collapsed-state cost badge | `message-bubble.component.html:136-148` | `messageSummary().cost` | move | `Cost` in the turn's activity panel behind `Show activity`: the turn total in the summary and, when the turn has more than one assistant message, each message's own cost in the per-message breakdown (design-spec §3.11, §12.2; req. 5.5, 5.6); session cost also in the inspector (req. 7.1). Visibility change: one click instead of always visible | `message-bubble.component.spec.ts` (asserts absence case at :183) |
| B-9 | Collapsed-state duration badge | `message-bubble.component.html:149-150` | `messageSummary().duration` | move | Disclosure label `Worked for {m}m {ss}s` and `Duration` in the activity panel (design-spec §3.9, §3.11; req. 1.2, 5.5) | postponed (T2) |
| B-10 | Copy message (hover reveal) | `message-bubble.component.html:158-163` (`ptah-copy-button`) | clipboard | keep | Action row `Copy message`, visible at rest (req. 5.1) | `CU/atoms/copy-button.component.spec.ts` |
| B-11 | Per-message token count and cost badges | `message-bubble.component.html:166-180` (`ptah-token-badge`, `ptah-cost-badge`) | `message().tokens`, `message().cost` | move | `Tokens` and `Cost` in the turn's activity panel, same formatters: turn totals in the summary (req. 5.5) and, when the turn has more than one assistant message, one breakdown row per message with that message's own tokens and cost, so no message's value is lost (req. 5.6; design-spec §3.11, §12.2; assumption A3); session totals also in the inspector (req. 7.1). Visibility change: one click instead of always visible | `message-bubble.component.spec.ts` |
| B-12 | Per-message duration badge | `message-bubble.component.html:181-182` | `message().duration` | move | Each message's own duration in the activity panel's per-message breakdown when the turn has more than one assistant message (req. 5.6); for a single-message turn a separate `Message duration` item in the summary, distinct from the turn elapsed `Duration` (req. 5.6; decision row 20); the turn's elapsed time also stays visible as the disclosure label (design-spec §3.9, §3.11; req. 1.2). Visibility change: the per-message badge moves behind `Show activity` | postponed (T2) |
| B-13 | Streaming quotes while waiting for output | `message-bubble.component.html:189` (`ptah-streaming-quotes`) | `isStreaming` | keep | Streaming turn (design silent; architect places it) | postponed (T2) |
| B-14 | Branch (fork) conversation from a user message | `message-bubble.component.html:311-324` (`user-branch-button`, `onBranchClick`); output `branchRequested` at `chat-view.component.html:90` | branch RPC via chat-view `onBranchRequested` | keep | `git-branch` icon button in the action strip under the user bubble; same label, event and C-10 banner; reveal behaviour unchanged from today (hover reveal of the strip, `message-bubble.component.html:311-314`); no focus reveal and no always-visible variant, by user decision (decisions.md row 23; req. 3.4) | `message-bubble.component.spec.ts` (`branch/rewind action buttons`) |
| B-15 | Rewind file changes to a user message (enabled only in an active session) | `message-bubble.component.html:325-345` (`user-rewind-button`, `onRewindClick`); `chat-view.component.html:91` | rewind RPC via chat-view `onRewindRequested` | keep | `undo-2` icon button next to Branch in the same strip; same label, disabled rule (`aria-disabled`, "Rewind unavailable — session is not active"), event and banner; same reveal behaviour as today and as B-14 (decisions.md row 23; req. 3.4) | `message-bubble.component.spec.ts` |
| B-16 | User message timestamp and sender ("You" or peer label) | `message-bubble.component.html:197-213` (`<time [attr.datetime]="formatDateTime(...)">` with `formatTime`, `inboundPeerLabel()` or `You`) | `message().timestamp`, `message().inboundPeer` | keep | `<time datetime title>` and `You` or peer label on the user turn, visible at rest and never inside the hover-revealed Branch/Rewind strip (designer places it; req. 3.5). No visibility change: time and `You` (or the peer label) stay visible at rest as today and in the accessibility tree; the hover/focus-only reveal was not approved by the user (decisions.md row 23) | `message-bubble.component.spec.ts` (`inbound peer bubble`) |
| B-17 | Inbound peer message styling and "self-reported and unverified" warning | `message-bubble.component.html:204-236` | `message().inboundPeer` | keep | User turn (req. 3.2) | `message-bubble.component.spec.ts` (`inbound peer bubble`) |
| B-18 | Compaction continuation disclosure ("Continued from previous conversation (compacted)") | `message-bubble.component.html:238-265` | `isCompactionContinuation()` | keep | User turn (req. 3.3) | postponed (T2) |
| B-19 | File attachment names on user messages | `message-bubble.component.html:274-296` | `message().files` | keep | User turn (req. 3.1) | postponed (T2) |
| B-20 | Image count label on user messages | `message-bubble.component.html:297-309` | `imageCountLabel()` | keep | User turn (req. 3.1) | postponed (T2) |
| B-21 | Sub-agent tile in the main transcript (opens the lane) | `execution-node.component.ts:167-340` (agent node -> `ptah-subagent-tile`) | `AgentMonitorStore` | move | Agent chip at rest, activity row in the expanded work log, inspector AGENTS row; together they meet T1-01 "tiles" (task-description PM-8, req. 4.8, which tabulates the tile fields of `subagent-tile.component.ts:75-81` per state); non-null assertions at `:80` removed (req. 4.6) | `C/organisms/execution/subagent-tile.component.spec.ts` |
| B-22 | Inline agent bubble outside the main transcript | `execution-node.component.ts:167-340` (`ptah-inline-agent-bubble`) | `AgentMonitorStore` | keep | Unchanged (lanes, canvas tiles) | postponed (T2) (T2-08) |
| B-23 | Render window and streaming boundary in the transcript | `C/organisms/transcript/chat-transcript.component.html:35-68` | `streamingBoundary`, render window | keep | Transcript of clean turns | `chat-transcript.component.spec.ts`, `chat-transcript.display.spec.ts`, `chat-transcript.replay-mount.spec.ts`, `chat-transcript.replay-motion.spec.ts`, `chat-transcript.ptah-ui.spec.ts`, `chat-transcript.change-set.spec.ts` |
| B-24 | Load older history | `C/templates/chat-view.component.html:86-89` (`olderHistoryRequested`) | older-history RPC | keep | Transcript of clean turns | `chat-transcript.older-history.spec.ts` |

## C. Chat-view surfaces

| ID | Capability | Where today (file:line) | Backing RPC / API / store | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| C-1 | Agent-started session banner with "open parent" | `C/templates/chat-view.component.html:20-33` | `resolvedAgentOrigin()`, `onOpenAgentParent` | keep | Unchanged | `C/molecules/agent-origin-banner/agent-origin-banner.component.spec.ts` |
| C-2 | Session stats strip (model, context, tokens, cost, time) | `chat-view.component.html:35-51` (`ptah-session-stats-summary`) | `resolvedSessionStats()`, `resolvedLiveModelStats()` | keep | Unchanged; core values also in the inspector orchestrator card (req. 7); reused for lane headers (req. 14.1, T1-03) | `CU/molecules/session/session-stats-summary.component.spec.ts` |
| C-3 | Stats strip compaction count | `chat-view.component.html:45` | `resolvedCompactionCount()` | keep | Unchanged | `session-stats-summary.component.spec.ts` |
| C-4 | Stats strip limits (plan limits) | `chat-view.component.html:46` | `resolvedStatsLimits()` | keep | Unchanged | `session-stats-summary.component.spec.ts` |
| C-5 | Stats strip session budget | `chat-view.component.html:47-48` | `resolvedSessionBudget()`, `resolvedSessionId()` | keep | Unchanged | `session-stats-summary.component.spec.ts` |
| C-6 | Background-agent tray: focus, steer, stop, background, scoped per canvas tile | `chat-view.component.html:53-64` | `BackgroundAgentStore`, `traySessionId()` | keep | Unchanged; background agents also listed in AGENTS (req. 8.1) | `C/organisms/background-agent-tray.component.spec.ts`, `background-agent-tray.scope.spec.ts` |
| C-7 | Compaction-in-progress notification | `chat-view.component.html:68` | `resolvedIsCompacting()` | keep | Unchanged | `CU/molecules/notifications/compaction-notification.component.spec.ts` |
| C-8 | Compaction marker (summary, measurement, duration) | `chat-view.component.html:69-76` | `visibleCompactionMarker()` | keep | Unchanged | `CU/molecules/notifications/compaction-marker.component.spec.ts` |
| C-9 | Fresh-chat empty state with prompt suggestions and project setup | `chat-view.component.html:94-102` | `handlePromptSelected` | keep | Unchanged | `chat-view.component.spec.ts` |
| C-10 | Branch/rewind error and info banners (auto-clear 4 s) | `chat-view.component.html:105-127` | `actionError()`, `actionInfo()` | keep | Unchanged; reports the results of B-14/B-15, which are kept | `chat-view.component.spec.ts` |
| C-11 | Resume interrupted sub-agents banner | `chat-view.component.html:129-136` | `resolvedResumableSubagents()` | keep | Unchanged | postponed (T2) |
| C-12 | Session budget banner (wrap-up, dismiss) | `chat-view.component.html:138-148` | `resolvedSessionBudget()`, `budgetDisplayStage()` | keep | Unchanged | postponed (T2) |
| C-13 | Auth-required banner (re-auth, dismiss) | `chat-view.component.html:150-160` | `authRequiredBanner()` | keep | Unchanged | postponed (T2) |
| C-14 | Voice-provider error toast | `chat-view.component.html:163` | voice provider service | keep | Unchanged | postponed (T2) |
| C-15 | Session permission badge (unmatched permissions, respond) | `chat-view.component.html:165-169` | `chatStore.unmatchedPermissions()`, `handlePermissionResponse` | keep | Unchanged; requests also surfaced in inspector rows and `N needs you` (req. 9, 12.2) | postponed (T2) |
| C-16 | AskUserQuestion cards, session-scoped | `chat-view.component.html:171-183` | `resolvedQuestionRequests()`, `handleQuestionResponse` | keep | Unchanged; also inspector `Answer` (req. 9.2) | postponed (T2) |
| C-17 | Queued content indicator | `chat-view.component.html:185-190` | `resolvedQueuedContent()` | keep | Unchanged | `chat-view.component.spec.ts` |
| C-18 | Composer controls (input, attach, approval mode, model, effort, send / stop) | Mounted at `chat-view.component.html:244-247` (`<ptah-chat-input />`); implemented in `C/molecules/chat-input/chat-input.component.ts`: input `<textarea>` `:230`; attach menu `ptah-native-popover` `:281` with `Attach files or images` button `:293-296`, files `:307`, images `:319`; model `ptah-model-selector` `:332`; effort `ptah-effort-selector` `:334`; voice `:356`; stop `:390-392` (`Stop generating`); send `:404-407` (`Send message`); approval mode `ptah-autopilot-popover` `:419` | `AutopilotStateService.stateFor`, `ModelStateService`, `EffortSelectorComponent.effectiveEffort` | keep | Composer re-skin with workspace/branch hints and approval and model chips (req. 12.4-12.5) | `chat-view.component.spec.ts` |

## D. Canvas Rail details aside (`canvas-session-details`)

| ID | Capability | Where today (file:line) | Backing RPC / API / store | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| D-1 | Landmark and heading "Session details" | `CV/canvas-detail/canvas-session-details.component.ts:31-32` | — | move | `<aside aria-label="This session">` with `<h2>` header (design-spec §4) | `CV/canvas-detail/canvas-session-details.component.spec.ts` |
| D-2 | Context % with progress bar and "Unavailable" value | `canvas-session-details.component.ts:33-49`, `:111-116` | `TabState.liveModelStats.{contextKnown,contextPercent}` | move | Orchestrator card context bar (req. 7.2-7.4) | `canvas-session-details.component.spec.ts` |
| D-3 | Tokens (unknown -> `—`) | `:51-54`, `:117-119` | `TabState.sessionStats.tokenCount` | move | Orchestrator card (req. 7.1, 7.5) | `canvas-session-details.component.spec.ts` |
| D-4 | Cost (unknown -> `—`) | `:55-60`, `:120` | `TabState.sessionStats.totalCost` | move | Orchestrator card (req. 7.1, 7.5) | `canvas-session-details.component.spec.ts` |
| D-5 | Turns (assistant message count; unknown -> `—`) | `:61-64`, `:121-123` | `TabState.sessionStats.messageCount` | move | Orchestrator card (req. 7.1, 7.5) | `canvas-session-details.component.spec.ts` |
| D-6 | Todo count `done/total`, active item, `todoTitle()` tooltip | `:65-77`, `:125-143` | `summarizeTodos` (`CU/molecules/compact-session/compact-session-metrics.ts:67`) | move | TODOS section with per-item list via `parseTodoList` (`:105`), count-only fallback (req. 10) | `canvas-session-details.component.spec.ts`; `compact-session-metrics.spec.ts` |
| D-7 | Branch with full-name tooltip | `:78-83`, `:124` | `TabState.agentOrigin.branch` | move | GIT section and header branch hint (req. 11.1, 12.3) | `canvas-session-details.component.spec.ts` |
| D-8 | Changes `+additions −deletions`, partial marker, `gitTitle()` tooltip | `:84-97`, `:155-170` | `SessionGitStatsStore.stateFor(root)` | move | GIT section (req. 11.1) | `canvas-session-details.component.spec.ts`; `C/services/session-git-stats/session-git-stats.store.spec.ts` |
| D-9 | Git tracking lifecycle per root and tab | `:144-154`, `:172-178` (`sessionWorkingRoot`, `track(root, tabId)`) | `SessionGitStatsStore`, `VSCodeService.config().workspaceRoot` | keep | Inspector GIT section | `session-git-stats.store.spec.ts` |
| D-10 | Lazy load of the details aside (`@defer`, bundle budget) | `CV/canvas-rail/canvas-rail-board.component.ts:181`, `:208`, `:239` (`@defer (on idle)` around `ptah-canvas-session-details`); import note `:26-28` (history: commit `828b0e66e`) | Angular `@defer` | keep | Inspector stays deferred (NFR Performance) | `CV/canvas-rail/canvas-rail-board.component.spec.ts` |
| D-11 | "Open details" button and 288 px aside in the Rail board | `CV/canvas-rail/canvas-rail-board.component.ts:180-211` | — | keep | Unchanged at >= 400 px; overlay below 400 px (req. 6.5, T1-32) | `canvas-rail-board.component.spec.ts` |

## E. Canvas thread switcher (`canvas-lane-tabs`) and agent kind glyphs (Delta 2)

Source: direct reads of `CV/canvas-detail/canvas-lane-tabs.component.ts` (244 lines), `CV/canvas-detail/lane-owner.ts`,
`canvas-lane-tabs.component.spec.ts`, the parent `CV/canvas-rail/canvas-focus-area.component.ts:56-61` and
`CU/molecules/compact-session/compact-session-lanes.component.ts` in this worktree (2026-10-15). `LT` = `CV/canvas-detail/canvas-lane-tabs.component.ts`;
`LT spec` = `CV/canvas-detail/canvas-lane-tabs.component.spec.ts`. New location = the agent dock (task-description req. 19) unless stated.
Today the strip has no needs-you or error indicator; the dock's priority overflow and pip (req. 19.7-19.8) are new capabilities and add no row.

| ID | Capability | Where today (file:line) | Backing RPC / API / store | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| E-1 | Component contract: inputs `sessionId`, `panelId` (default `canvas-lane-panel`), `laneKey` (default `orchestrator`); output `laneSelected(key)`; parent binds `tab()?.claudeSessionId`, `detail.laneKeyFor(id)` and `detail.selectLaneFor(id, $event)` | `LT:94-97`; `CV/canvas-rail/canvas-focus-area.component.ts:56-61` | `CanvasDetailService.laneKeyFor` / `selectLaneFor` | keep | Same parent binding, same lane keys; the dock opens the thread in the pane below (req. 19.3) | `LT spec` (all cases set `sessionId` and subscribe to `laneSelected`) |
| E-2 | Orchestrator entry always first, without a group label | `LT:47`, `:116-121` | — | keep | First dock item; avatar shows the session's provider mark, neutral glyph when unknown (req. 18.4-18.5, 19.1) | `LT spec:27` |
| E-3 | Ownership filter: only agents whose owner equals the session id; no session id → no agents (only the Orchestrator) | `CV/canvas-detail/lane-owner.ts:1-8`; `LT:99-114` | `AgentMonitorStore.subagents()` (`parentSessionId`), `.agents()` (`parentSessionId`), `BackgroundAgentStore.agents()` (`sessionId`) | keep | Dock and menu membership (req. 19.1) | `LT spec:75`, `:148` |
| E-4 | Sub-agent entries: non-background sub-agents, key `sub:{parentToolUseId}`, label `teammateName` → `agentType` → `description` → `Sub-agent` | `LT:122-132` | `AgentMonitorStore.subagents()`, `laneKey('subagent', …)` (`@ptah-extension/chat`) | keep | Dock avatar with role icon (req. 18.3); same key and label fallback | `LT spec:27` |
| E-5 | CLI lane entries: key `cli:{agentId}`, label = `cli`, each owned lane once | `LT:133-140` | `AgentMonitorStore.agents()`, `laneKey('cli', …)` | keep | Dock avatar with provider mark through one CLI id → provider id table, monogram fallback (req. 18.1-18.2) | `LT spec:148` |
| E-6 | Background entries: sub-agents in `background` status (key `bg:{parentToolUseId}`) plus background-store agents not already listed as a sub-agent (dedup by `toolCallId`), label fallback `Background agent` | `LT:141-160` | `AgentMonitorStore.subagents()`, `BackgroundAgentStore.agents()`, `laneKey('background', …)` | keep | Dock avatar with role icon and `Background` group (req. 18.3, 19.1) | `LT spec:27`, `:101` |
| E-7 | Groups in fixed order Orchestrator, Sub-agents, CLI lanes, Background; empty groups hidden; group labels as `role="presentation"` text | `LT:46-53`, `:115-162` | — | move | Group dividers in the dock and grouped sections with counts in the `N agents ›` menu (req. 19.9; `design-delta-2-options.md` §3 option B) | `LT spec:27` |
| E-8 | Selection fallback: unknown key → Orchestrator; `sub:` ↔ `bg:` migration for the same agent; the parent is told the corrected key | `LT:164-177` | `laneSelected` output | keep | Same rule (req. 19.11) | `LT spec:101`, `:119`, `:135` |
| E-9 | Overflow: horizontal scroll with hidden scrollbar and an edge fade mask when content is cut left or right | `LT:42-44` (`overflow-x-auto`, `mask-image`), `:88-93` (`edgeMask`), `:195-201` (`updateEdges`) | — | move | Priority overflow (Orchestrator, selected, needs you, error, running, rest) behind the `N agents ›` menu with a pip (req. 19.7-19.9, PM-15); every lane stays reachable | `LT spec:184` (edge update on resize, today's mechanism); priority overflow postponed (decisions.md row 3) |
| E-10 | Selected entry kept in view on selection change, list change and strip resize; `ResizeObserver` disconnected on destroy | `LT:178-193`, `:203-214` (`revealSelected`) | — | keep | Selected agent stays visible in the dock (req. 19.10) | `LT spec:184`, `:214` |
| E-11 | ARIA: `role="tablist"` `aria-label="Lanes"`; `role="tab"` with `aria-selected`, `aria-controls` = `panelId`, id `{panelId}-tab-{key}` | `LT:38-41`, `:55-65`, `:241-243` | `panelId` input (also on `ptah-canvas-lane-view`, `canvas-focus-area.component.ts:63-64`) | keep | Dock tablist; each avatar keeps tab semantics, id and `aria-controls`; accessible name extended to "{name}, {kind}, {status} {duration}" and `aria-describedby` to the card (req. 19.2, 19.5) | `LT spec:75`, `:101`, `:119`, `:135` (`aria-selected`, tab id) |
| E-12 | Keyboard: roving tabindex (selected 0, others -1); Left / Right wrap; Home / End; `preventDefault` + `stopPropagation`; automatic activation (emits the key) and focus moves to the new tab | `LT:66`, `:69`, `:216-239` | `laneSelected` output | keep | Same model over the visible dock items (req. 19.4); menu keys added (req. 19.9) | `LT spec:162` |
| E-13 | Click on a tab selects that lane | `LT:68` | `laneSelected` output | keep | Click or tap on an avatar or a menu row (req. 19.3, 19.14) | postponed (decisions.md row 3) |
| E-14 | Selected and hover visuals: 2 px bottom border in `primary`, full-ink label vs muted label, hover ink; 36 px high tabs | `LT:59-63` | — | move | Expanded gold-bordered pill with name, status word and duration, selection not by colour alone; hover fill on avatars; targets at least 24 x 24 px (req. 19.2, 19.12) | postponed (decisions.md row 3) |
| E-15 | Status indicator: raw status string as `title` tooltip; decorative `bg-current` dot (label colour, so status is not visible at rest) | `LT:67`, `:72-75` | `status` of each store record | move | Status ring + corner glyph + status word in the avatar, word in the accessible name and the hover card (req. 18.7, 19.2, 19.5) | `LT spec:27` (asserts `title` = status at `:72`; spec updates to the new markup allowed by PM-3) |
| E-16 | Agent kind glyphs `◇` (sub-agent), `›_` (CLI lane), `≋` (background) beside lane rows of the chat-host compact card; the approved design-spec §4.2 anatomy also drew `>_` / `◇` | `CU/molecules/compact-session/compact-session-lanes.component.ts:16-20` (map), `:105-106` (render); mounted via `compact-session-activity.component.ts:771` in `compact-session-card.component.ts:149` (A-8) | `CompactLaneKind` | keep (changed visual) | Kind stays identifiable: provider mark or monogram for CLI lanes, role icon with `Bot` default for sub-agents and background agents, plus the kind badge, in chips, AGENTS rows and the dock (req. 4.1, 8.1, 18.1-18.3; PM-13) | `CU/molecules/compact-session/compact-session-lanes.component.spec.ts` (today's glyphs); new avatar postponed (decisions.md row 3) |
| E-17 | Orchestrator status fixed to `running` (tooltip) | `LT:119` | — | move | Orchestrator status from the session's actual state (req. 19.15) | postponed (decisions.md row 3) |
| E-18 | Strip placed directly below the Rail focus header in each pane | `CV/canvas-rail/canvas-focus-area.component.ts:56-61` | — | keep | Dock in the same place (req. 19.16) | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:150-154` (e2e; not run in this task) |

## Proposed removals (user decision)

None. Design-spec revise round 1 keeps every row that round 0 of this inventory proposed to remove (design-spec §12.2-12.3, D19): B-4, B-8 and
B-11 are now `move`, B-14 and B-15 are `keep`. No row in this inventory is `remove-proposed`, so no user approval is needed to proceed.
Requirements revision round 2 keeps per-message tokens, cost and duration reachable in the activity panel's per-message breakdown
(task-description req. 5.6), so B-8, B-11 and B-12 lose no granularity and remain `move`, not `remove-proposed`.
Delta 2 adds rows B-5a and E-1..E-18; each is `keep` or `move` (E-16 is `keep` with a changed visual), so the answer stays: none.

## User-visible changes (not removals)

The capability stays; only how often it is seen changes. The user decided these in decisions.md row 23.

- B-8, B-11, B-12 (user-approved, decisions.md row 23): per-message cost, token and duration badges move from always visible to the activity panel, one click behind
  `Show activity` (design-spec §3.11): turn totals as the summary, plus one row per assistant message with its own tokens, cost and
  duration when the turn has more than one (task-description req. 5.5-5.6). The turn duration stays visible as the `Worked for` label (B-9).

Proposed by the design but not approved by the user (decisions.md row 23), so visibility stays as today:

- B-16: the user-turn time and `You` (or the peer label) stay visible at rest, as today (task-description req. 3.5).
- B-14, B-15: Branch and Rewind keep today's hover reveal unchanged; no focus reveal is added (task-description req. 3.4).

Delta 1 (decisions.md row 21) adds the inspector TASK section (task-description req. 17). It is a new capability that replaces no existing
surface, so it adds no row to this inventory; no row is `remove-proposed`.

Delta 2 (decisions.md rows 27, 30-32) changes how kept capabilities look, not whether they exist:

- E-9: lanes that do not fit are reached through the `N agents ›` menu instead of horizontal scrolling; the fade edges
  give way to a count and a pip (task-description PM-15).
- E-14, E-15, E-17: the selected lane reads as an expanded pill; status moves from a tooltip-only string to ring +
  glyph + word; the Orchestrator shows its real state instead of a fixed `running`.
- E-16: the `◇` / `›_` / `≋` kind glyphs (and the `>_` / `◇` of the earlier design anatomy) become provider marks and
  role icons; the chip icons of task-description req. 4.1 (`Bot` / `terminal` / `Layers`, design only, never shipped)
  follow the same avatar (PM-13).
- B-5a: tool-call rows are not restyled (user decision, decisions.md row 32).
