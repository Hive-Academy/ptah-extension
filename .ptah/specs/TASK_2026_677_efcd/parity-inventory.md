# Parity Inventory - TASK_2026_677_efcd

Surfaces replaced or rebuilt:

- A. Tab `viewMode` `'compact'` and `ptah-compact-session-card` (chat-host variant) — `C/templates/chat-view.component.html:4-14`.
- B. Per-message auto-collapse and bubble chrome in `ptah-message-bubble` — `C/organisms/message-bubble.component.{ts,html}`.
- C. Chat-view surfaces around the transcript — `C/templates/chat-view.component.html:20-190`.
- D. Canvas Rail details aside — `CV/canvas-detail/canvas-session-details.component.ts` (re-skinned as the inspector body).

Prefixes: C = `libs/frontend/chat/src/lib/components`, CU = `libs/frontend/chat-ui/src/lib`, CS = `libs/frontend/chat-state/src/lib`,
CV = `libs/frontend/canvas/src/lib`. Line numbers come from `handoff-1.md` §4, `design-spec-review.md` finding 1, and direct reads of
`chat-view.component.html`, `message-bubble.component.html`, `canvas-session-details.component.ts` and `compact-session-card.component.ts`
in this worktree (2026-10-15).

Decision rule (task-description PM-5): default `keep` or `move`. `remove-proposed` only where design-spec.md defines an exhaustive anatomy
that excludes the capability. A `remove-proposed` row stays in the product until the user approves its removal.

Test column: testing is postponed by the user (decisions.md row 3). The column names the existing spec file for that component, which must
keep passing; "postponed (T2)" where no spec exists or the existing spec does not cover the capability.

## A. View mode and compact session card

| ID | Capability | Where today (file:line) | Backing RPC / API / store | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| A-1 | Per-tab presentation switch `'full' \| 'compact'` | `chat-types.ts:507,782`; `CS/tab-manager.service.ts:3089-3108` | `TabManagerService` toggle/set/get | keep | Same API; architect defines what each mode shows with the clean turn (task-description PM-1) | `CS/tab-manager.service.spec.ts` |
| A-2 | View mode survives reload | `CS/tab-persistence.ts:161-175` | tab persistence (local state) | keep | Unchanged | postponed (T2) (`tab-persistence.backoff.spec.ts` covers backoff only) |
| A-3 | Toggle control in the tab item (`data-compact`) | `CU/molecules/session/tab-item.component.ts:72-83` | `toggleTabViewMode(tabId)` | keep | Unchanged | postponed (T2) (T2-01) |
| A-4 | Toggle control in the Rail focus header | `CV/canvas-rail/canvas-focus-header.component.ts:57-60` | `TabManagerService` | keep | Unchanged | `CV/canvas-rail/canvas-focus-header.component.spec.ts` |
| A-5 | Rail board cards always render the compact card (`SESSION_FORCED_CARD`, `variant 'rail'`, `ptah-compact-rail-card`) | `C/molecules/compact-session/compact-session-card.component.ts:117-143`; token in `C/tokens/session-context.token` | `SESSION_FORCED_CARD`, `SESSION_CARD_ACTIONS` | keep | Unchanged (out of scope) | `CU/molecules/compact-session/compact-rail-card.component.spec.ts`; `compact-session-card.component.spec.ts`; Rail part postponed (T2-02) |
| A-6 | Chat-host compact card replaces the transcript when `showCompactCard()` | `C/templates/chat-view.component.html:4-14`; `chat-view.component.ts:962-978` | `TabState.viewMode`, `SESSION_FORCED_CARD` | move | Clean turn in the transcript (task-description req. 1) | `C/templates/chat-view.component.spec.ts` |
| A-7 | Live / finalized session summary text (sampled stream) | `compact-session-card.component.ts:578-613`; `summarizeLive`, `summarizeFinalized` (chat-ui) | `TabState.streamingState`, `messages` | move | Work log while streaming; final answer when done (req. 1.1-1.2) | `C/molecules/compact-session/compact-session-card.component.spec.ts` |
| A-8 | Lane rows (sub-agents, CLI lanes, background) with status | `C/molecules/compact-session/compact-lane-rows.ts:52` (`buildLaneSummary`); template `:149-167` | `AgentMonitorStore.sessionSubagentsForSession()`, `agentsOwnedBySession()`, `BackgroundAgentStore.agentsForSession()` | move | Agent chip row (req. 4) and inspector AGENTS (req. 8) | `C/molecules/compact-session/compact-lane-rows.spec.ts` |
| A-9 | Open a lane from a lane row | `compact-session-card.component.ts:541-553` (`openLane`) | lane keys `sub:` / `cli:` / `bg:` (`laneKey`) | move | Chip click and inspector row click (req. 4.3, 8.4) | `compact-session-card.component.spec.ts` |
| A-10 | Permission callout with inline Allow / Deny | `compact-session-card.component.ts:478-513` (`respond`) | `PermissionHandlerService`, `AgentPermissionResponder` | move | Inspector row `Review` -> surface that allows/denies that request (req. 9.1, 9.3) | `compact-session-card.component.spec.ts` |
| A-11 | Open the request (permission) source | `compact-session-card.component.ts:515-525` (`openRequest`) | `PermissionRequest` | move | Inspector row `Review` (req. 9.3) | `compact-session-card.component.spec.ts` |
| A-12 | Answer a user question from the callout | `compact-session-card.component.ts:527-534` (`answerQuestion`) | `AskUserQuestionRequest` | move | Inspector row `Answer` (req. 9.2-9.3); question cards stay (C-12) | `compact-session-card.component.spec.ts` |
| A-13 | Requests filtered to this tab only | `compact-session-card.component.ts:363-381`, `:621-641` (`targetsTab`) | `TabSessionBinding`, `ConversationRegistry` | move | Session-scoped aggregation (req. 12.1) | `compact-session-card.component.spec.ts` |
| A-14 | Elapsed time of the running session | template `:156` (`elapsed`), `clearElapsedTimer` `:567-571` | `TabState` timestamps | move | Live line timer and `Working · t` label (req. 1, 5.3) | `CU/molecules/compact-session/compact-session-activity.component.spec.ts` |
| A-15 | Branch, context %, todos, git +/- on the card | template `:155-159` | `agentOrigin.branch`, `liveModelStats`, `summarizeTodos`, `SessionGitStatsStore` | move | Inspector orchestrator card, TODOS, GIT; header branch hint (req. 7, 10, 11, 12.3) | `compact-session-activity.component.spec.ts`; `CU/molecules/compact-session/compact-session-metrics.spec.ts` |
| A-16 | "Show output" / expand to the full view | `compact-session-card.component.ts:555-565` (`openFullView`); `chat-view.component.html:12` (`expandToFull`) | `TabManagerService` view mode | move | Disclosure row and `Show activity` action (req. 1.2, 5.1); view-mode toggle (A-1) | `compact-session-card.component.spec.ts` |

## B. Message bubble (per-message auto-collapse and chrome)

| ID | Capability | Where today (file:line) | Backing RPC / API / store | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| B-1 | Auto-collapse of messages older than the last four (local, not persisted) | `C/organisms/message-bubble.component.ts:216-281` | component state | move | Per-turn work-log auto-collapse on the final message (req. 1.2, 1.5) | `C/organisms/message-bubble.component.spec.ts` |
| B-2 | Collapse/expand header button with chevron and `aria-expanded` | `message-bubble.component.html:39-55`, `:76-89` | component state | move | Disclosure row `Worked for` with chevron and `aria-expanded` (req. 1.7) | `message-bubble.component.spec.ts` |
| B-3 | Message title and collapsed description | `message-bubble.component.html:56-62`, `:76-89` (`messageSummary`) | `messageSummary()` | move | Final answer always visible under the disclosure (req. 1.2) | `message-bubble.component.spec.ts` |
| B-4 | Collapsed-header tool count and files-changed count | `message-bubble.component.html:63-72` | `messageSummary().toolCount`, `.filesChanged` | remove-proposed | — (design-spec §3.2 label is `Worked for {m}m {ss}s` only) | postponed (T2) |
| B-5 | Execution tree: text, markdown, thinking, tool cards, SDK cards, agent summary, `ptah-ui`, inline permission card, agent nodes | `message-bubble.component.html:99-133`; `C/organisms/execution/execution-node.component.ts:167-340` | `ExecutionNode` tree from streaming state | keep | Expanded work log (req. 2.1) | `execution-node.ptah-ui.spec.ts`, `execution-node.render-throttle.spec.ts`, `execution-node.send-message.spec.ts`, `execution-node.streaming-dom.spec.ts` |
| B-6 | Mermaid fallback rendering of message text | `message-bubble.component.html:117` (`ptah-mermaid-message-text`) | message text | keep | Final answer / work log (req. 2.1) | postponed (T2) |
| B-7 | Typing cursor while streaming | `message-bubble.component.html:130` | `isStreaming` | move | Streaming caret on the last log line (design-spec §3.3) | `message-bubble.component.spec.ts` |
| B-8 | Collapsed-state cost badge | `message-bubble.component.html:136-148` | `messageSummary().cost` | remove-proposed | — (design-spec §3.6 action row is copy + activity only); session cost in inspector (req. 7.1) | `message-bubble.component.spec.ts` (asserts absence case at :183) |
| B-9 | Collapsed-state duration badge | `message-bubble.component.html:149-150` | `messageSummary().duration` | move | Disclosure label `Worked for {m}m {ss}s` (req. 1.2) | postponed (T2) |
| B-10 | Copy message (hover reveal) | `message-bubble.component.html:158-163` (`ptah-copy-button`) | clipboard | keep | Action row `Copy message`, visible at rest (req. 5.1) | `CU/atoms/copy-button.component.spec.ts` |
| B-11 | Per-message token count and cost badges | `message-bubble.component.html:166-180` (`ptah-token-badge`, `ptah-cost-badge`) | `message().tokens`, `message().cost` | remove-proposed | — (design-spec §3.6); session totals in inspector (req. 7.1) | `message-bubble.component.spec.ts` |
| B-12 | Per-message duration badge | `message-bubble.component.html:181-182` | `message().duration` | move | Disclosure label (req. 1.2) | postponed (T2) |
| B-13 | Streaming quotes while waiting for output | `message-bubble.component.html:189` (`ptah-streaming-quotes`) | `isStreaming` | keep | Streaming turn (design silent; architect places it) | postponed (T2) |
| B-14 | Branch (fork) conversation from a user message | `message-bubble.component.html:311-324` (`user-branch-button`, `onBranchClick`); output `branchRequested` at `chat-view.component.html:90` | branch RPC via chat-view `onBranchRequested` | remove-proposed | — (design-spec §3: user turn "with the bubble only") | `message-bubble.component.spec.ts` (`branch/rewind action buttons`) |
| B-15 | Rewind file changes to a user message (enabled only in an active session) | `message-bubble.component.html:325-345` (`user-rewind-button`, `onRewindClick`); `chat-view.component.html:91` | rewind RPC via chat-view `onRewindRequested` | remove-proposed | — (design-spec §3) | `message-bubble.component.spec.ts` |
| B-16 | User message timestamp and sender ("You" or peer label) | `message-bubble.component.html` user header (`formatTime`, `inboundPeerLabel`), around `:200-215` | `message().timestamp` | keep | User turn (req. 3) | `message-bubble.component.spec.ts` (`inbound peer bubble`) |
| B-17 | Inbound peer message styling and "self-reported and unverified" warning | `message-bubble.component.html:204-236` | `message().inboundPeer` | keep | User turn (req. 3.2) | `message-bubble.component.spec.ts` (`inbound peer bubble`) |
| B-18 | Compaction continuation disclosure ("Continued from previous conversation (compacted)") | `message-bubble.component.html:238-265` | `isCompactionContinuation()` | keep | User turn (req. 3.3) | postponed (T2) |
| B-19 | File attachment names on user messages | `message-bubble.component.html:274-296` | `message().files` | keep | User turn (req. 3.1) | postponed (T2) |
| B-20 | Image count label on user messages | `message-bubble.component.html:297-309` | `imageCountLabel()` | keep | User turn (req. 3.1) | postponed (T2) |
| B-21 | Sub-agent tile in the main transcript (opens the lane) | `execution-node.component.ts:167-340` (agent node -> `ptah-subagent-tile`) | `AgentMonitorStore` | move | Agent chip row (re-skinned `subagent-tile`, req. 4) | `C/organisms/execution/subagent-tile.component.spec.ts` |
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
| C-10 | Branch/rewind error and info banners (auto-clear 4 s) | `chat-view.component.html:105-127` | `actionError()`, `actionInfo()` | keep | Unchanged (purpose depends on B-14/B-15; removable only if those removals are approved) | `chat-view.component.spec.ts` |
| C-11 | Resume interrupted sub-agents banner | `chat-view.component.html:129-136` | `resolvedResumableSubagents()` | keep | Unchanged | postponed (T2) |
| C-12 | Session budget banner (wrap-up, dismiss) | `chat-view.component.html:138-148` | `resolvedSessionBudget()`, `budgetDisplayStage()` | keep | Unchanged | postponed (T2) |
| C-13 | Auth-required banner (re-auth, dismiss) | `chat-view.component.html:150-160` | `authRequiredBanner()` | keep | Unchanged | postponed (T2) |
| C-14 | Voice-provider error toast | `chat-view.component.html:163` | voice provider service | keep | Unchanged | postponed (T2) |
| C-15 | Session permission badge (unmatched permissions, respond) | `chat-view.component.html:165-169` | `chatStore.unmatchedPermissions()`, `handlePermissionResponse` | keep | Unchanged; requests also surfaced in inspector rows and `N needs you` (req. 9, 12.2) | postponed (T2) |
| C-16 | AskUserQuestion cards, session-scoped | `chat-view.component.html:171-183` | `resolvedQuestionRequests()`, `handleQuestionResponse` | keep | Unchanged; also inspector `Answer` (req. 9.2) | postponed (T2) |
| C-17 | Queued content indicator | `chat-view.component.html:185-190` | `resolvedQueuedContent()` | keep | Unchanged | `chat-view.component.spec.ts` |
| C-18 | Composer controls (input, attach, approval mode, model, effort, send / stop) | `chat-view.component.html` composer region below `:190` (not re-read) | `AutopilotStateService.stateFor`, `ModelStateService`, `EffortSelectorComponent.effectiveEffort` | keep | Composer re-skin with workspace/branch hints and approval and model chips (req. 12.4-12.5) | `chat-view.component.spec.ts` |

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
| D-10 | Lazy load of the details aside (`@defer`, bundle budget) | Rail board host, commit `828b0e66e` | Angular `@defer` | keep | Inspector stays deferred (NFR Performance) | `CV/canvas-rail/canvas-rail-board.component.spec.ts` |
| D-11 | "Open details" button and 288 px aside in the Rail board | `CV/canvas-rail/canvas-rail-board.component.ts:180-211` | — | keep | Unchanged at >= 400 px; overlay below 400 px (req. 6.5, T1-32) | `canvas-rail-board.component.spec.ts` |

## Proposed removals (user decision)

These rows are dropped by an exhaustive anatomy in design-spec.md. None is approved. Each stays in the product until the user decides.

- B-4 Collapsed-header tool count and files-changed count: the disclosure label is specified as `Worked for {m}m {ss}s` only
  (design-spec §3.2); the counts have no other place in the clean turn.
- B-8 Collapsed-state per-message cost badge: the done-turn action row is exactly copy + activity (design-spec §3.6); only the session
  total cost remains, in the inspector.
- B-11 Per-message token count and cost badges: same anatomy (design-spec §3.6); per-message granularity is lost, session totals remain in
  the inspector.
- B-14 Branch (fork) conversation from a user message: the user turn is "the bubble only" (design-spec §3); no other surface in the design
  offers branching.
- B-15 Rewind file changes to a user message: same (design-spec §3); no other surface in the design offers rewind.
