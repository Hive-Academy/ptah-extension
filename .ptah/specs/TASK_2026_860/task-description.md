# Session status, dock and loader polish

## Scope

Electron-first Angular webview work on the running Sessions rail, the agent dock above the transcript, and the expanded session-details header. Keep shared-host behavior compatible. The shared pulse conversion from commit `160444fd6` is the baseline, not work to repeat. Requirements below describe observable behavior, not a component or library design.

## A. Finish pulse loaders

The source scan covered `libs/frontend/**`, `apps/ptah-extension-webview/src`, and `apps/ptah-electron/src`. The eight remaining local full rotations are all loading, active-work, or indeterminate-progress indicators and **must become a pulse**. There were no exact `@keyframes spin` definitions and no non-loading 360-degree rotation in this scan to retain.

| Remaining local rotation | Status / decision |
| --- | --- |
| `apps/ptah-electron/src/assets/preparing-workspace.css:275-289` | Indeterminate workspace-preparation ring; pulse. |
| `apps/ptah-extension-webview/src/styles.css:576-582,692-700` | `.divine-loading` via `cosmic-spin`; pulse. |
| `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.component.ts:205-220,343` | Running agent avatar; pulse. |
| `libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts:185-191` | Boot progress; pulse. |
| `libs/frontend/chat-ui/src/lib/molecules/vitals/progress-ring.component.ts:137-153` | Indeterminate progress ring; pulse; preserve determinate progress. |
| `libs/frontend/chat-ui/src/lib/molecules/vitals/staged-steps.component.ts:222-232` | Active setup step; pulse; preserve progress sweep meaning. |
| `libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.ts:128-129,165-167` | History loading spinner; pulse. |
| `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:295-303,1066` | Provider setup in progress; pulse. |

The remaining `animate-spin` class references are **loading/streaming status sites already mapped to `ptah-pulse`** by `apps/ptah-extension-webview/tailwind.config.js:49-56`. Keep their status behavior and ensure no local animation overrides restore rotation. The complete class-site census is:

| File | Lines | Status / decision |
| --- | --- | --- |
| `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-notification.component.ts` | 22 | Compaction in progress; pulse already mapped. |
| `libs/frontend/chat-ui/src/lib/molecules/tool-execution/todo-list-display.component.ts` | 51 | Active todo; pulse already mapped. |
| `libs/frontend/chat/src/lib/components/molecules/background-task-tiles/background-task-tiles.component.ts` | 45 | Background task running; pulse already mapped. |
| `libs/frontend/chat/src/lib/components/organisms/execution/agent-execution.component.ts` | 87, 118, 161, 193, 226 | Agent execution/streaming; pulse already mapped. |
| `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts` | 157, 171, 273, 308, 327, 512, 527 | Agent execution and pending actions; pulse already mapped. |
| `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-git-section.component.ts` | 83 | Git data loading; pulse already mapped. |
| `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-request-panel.component.ts` | 109, 120 | Request action in progress; pulse already mapped. |
| `libs/frontend/command-center/src/lib/components/command-node-detail.component.ts` | 56 | Running command; pulse already mapped. |
| `libs/frontend/command-center/src/lib/components/command-overlay.component.ts` | 139, 169 | Running command; pulse already mapped. |
| `libs/frontend/command-center/src/lib/components/command-work-list.component.ts` | 95 | Running command; pulse already mapped. |
| `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts` | 174 | Schedule loading; pulse already mapped. |
| `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts` | 182 | Fetch in progress; pulse already mapped. |
| `libs/frontend/git-ui/src/lib/history/history-timeline.component.ts` | 150 | History loading; pulse already mapped. |
| `libs/frontend/git-ui/src/lib/task/task-worktree-view.component.ts` | 117 | Worktree refresh; pulse already mapped. |
| `libs/frontend/marketplace/src/lib/ui/connector-card-status.component.ts` | 67 | Connector operation in progress; pulse already mapped. |
| `libs/frontend/onboarding/src/lib/ready/ready-claude-step.page.ts` | 178, 450 | Setup check/recheck; pulse already mapped. |
| `libs/frontend/onboarding/src/lib/ready/ready-strip.component.ts` | 120 | Setup running; pulse already mapped. |
| `libs/frontend/onboarding/src/lib/shared/item-status-card.component.ts` | 130 | Agent running; pulse already mapped. |
| `libs/frontend/onboarding/src/lib/shared/run-status-chip.component.ts` | 46 | Run active; pulse already mapped. |
| `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts` | 252 | Task load/busy; pulse already mapped. |

**Acceptance:** No loading/streaming site in the three scoped trees visibly rotates. Each local site above uses the shared pulse visual language, with a recognizable static dot under `prefers-reduced-motion: reduce`; the ring is hidden in reduced motion as in `apps/ptah-extension-webview/src/styles.css:2295-2305`. Loading semantics and accessible labels remain intact. Determinate progress and non-loading motion keep their meaning. Source checks cover `rotate(360deg)`, `@keyframes spin`, `animate-spin`, and Lucide Loader icons with animated classes, including Electron's preparation screen.

## B. Agent dock above chat

`libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:138-241,325-383` renders the chips and overflow. `dock-overflow.ts:24,36-49` reserves 180 px for the selected pill, 112/44 px for the menu and 30 px per chip; its current width calculation can allow 14 chips at 760 px, while the small-roster branch and `DOCK_INLINE_MAX` use five. **Cap the full-size dock at five rendered agent chips, including the selected agent, on every path.** Five is the defensible choice from the existing five-agent threshold and reserved widths; six would contradict the current compact layout. A narrower dock may show fewer than five. Preserve the selected agent as a visible chip when space permits; if it is not running, it is the sole allowed non-running exception ahead of running chips. Otherwise, the rendered left-to-right order must put every visible running agent before every visible waiting, failed, queued, done or stopped agent, with stable roster order within a status. This applies after slot selection and after the component groups/renders chips by kind (`canvas-lane-tabs.component.ts:353-378`); the current planner ranks waiting/failed ahead of running and restores roster order (`dock-overflow.ts:52-68,132-136`). The selected agent remains reachable in overflow when width cannot keep it inline. Every omitted agent, including finished agents, appears exactly once in the existing overflow dropdown, which already shows name, avatar, status and duration (`agent-dock-menu.component.ts:95-127`). The dropdown count is the number hidden.

**Acceptance:** For rosters of 0, 1, 5, 6, and more agents, and narrow/wide widths, a component test inspects rendered left-to-right chip order and confirms the running-first rule, including a non-running selected pill and mixed agent kinds. No rendered path exceeds five agent chips: initial non-finite width, absent `ResizeObserver`, subsequent resize, and the keyboard-focus freeze path at `canvas-lane-tabs.component.ts:338-346` when waiting or failed statuses arrive must all obey the cap; hidden-agent count and entries remain correct. ArrowLeft/ArrowRight/Home/End use the currently rendered visible-chip order, keep the focused chip reachable or deliberately move focus to the overflow trigger if it becomes hidden, and never silently change the selected lane when focus alone moves. While keyboard focus freezes the visible set, status updates or resize do not strand focus; leaving the dock releases the freeze. Selection survives status change or resize; the selected agent remains reachable if space cannot retain it. Overflow exposes every hidden agent with a readable status, supports selection by pointer and keyboard, and retains menu focus/close behavior. The transcript and composer still fit below the dock.

## C. Running Sessions sidebar

The target is `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:90-285`, fed by `canvas-rail-board.component.ts:132-147`. Present three ordered groups with visible headers and counts: **Running** (`running`), **Waiting / Needs input / Idle** (`needs`, `error`, `idle`; `error` must remain explicitly labeled as an error), then **Finished** (`done`). Group by the current `CompactRailState`, using the existing tile order inside each group. A state transition moves a card to its current group without changing its session identity or underlying stored order. Hide empty groups or show zero counts consistently; do not render orphan headings. Preserve the card's current status dot and pill (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts:228-238`) and make the text clear enough to distinguish Needs input, Error, Idle and Done in both densities and the collapsed rail's accessible name. The second strip under “Sessions” currently prints bare numeric shortcut chips, so the reported stray “2” is explained by `canvas-rail.component.ts:141-175`. Keep five individually labeled jump actions — **Needs input, Error, Running, Done, Idle** — with their own counts in an expanded-rail status summary below the title; show each action when its count is nonzero and retain its existing jump-to-next-matching-session behavior. Group heading counts are additional aggregate information and cannot replace these five actions. In narrow layout, the summary may scroll horizontally as it does today, but each action must remain keyboard reachable and expose its status and count in its accessible name.

**Acceptance:** Mixed-status cards appear in that group order with correct counts; a live status transition moves only its card and updates group and per-status counts. Each card has visible dot and text status, with an equivalent accessible name in the collapsed rail. The header no longer shows an unexplained number, and component tests activate each of the five labeled jump actions by pointer and keyboard and land on the next matching session. “New session,” “Previous sessions,” attention actions, density/collapse controls, card selection, and card menu actions remain available. Rail ArrowUp/ArrowDown/Home/End follow the new displayed group order (`canvas-rail.component.ts:500-516`), keep focus on the same session across regrouping where possible, and move focus predictably if that card disappears; keyboard focus order and selection must agree with the displayed order. Move Up/Down either operate visibly within the displayed group or are explicitly disabled at boundaries; never offer a silent no-op after grouping. Empty and all-finished cases remain usable.

## D. Session-details header actions

The described title/status row is the expanded or sheet session inspector at `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html:92-142`, hosted in Electron by `libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts:191-208,237-251`. It currently has only the panel-close/compact control. Add **Rename**, **Organize**, and **Stop** option buttons to its right-side action area beside that control, reusing the existing session-card flows. Rename is available for a persisted session, through `canvas-rail-card.component.ts:308-320,686-696` → `SessionRowActionsService.rename` (`session-row-actions.service.ts:68-79`) → `ClaudeRpcService.renameSession` (`claude-rpc.service.ts:313-317`) → `session:rename`. Organize is shown only when available and the session is persisted, through `canvas-rail-card.component.ts:321-334,711-723` → `SessionOrganizerService.openForSession` (`session-organizer.service.ts:194-215,267`) → `session:getOrganization`; editor changes use `session:setOrganization` (`session-organization-editor.component.ts:589-606`). Stop is shown only for a running session, through `canvas-rail-card.component.ts:373-382,585-595` → `ChatStore.abortWithConfirmation` (`chat.store.ts:373-382`) → `chat:abort` (`conversation.service.ts:460-463`), retaining its agent confirmation. Do not duplicate the existing rename, organizer, or abort business logic. Preserve the current panel toggle and title/status/workflow/branch information.

**Acceptance:** The header shows two or three relevant action buttons next to the panel toggle according to availability. Each action targets the inspector's session, never a different active tab; rename and organize refuse drafts without a session ID, Stop is absent when not running, and the abort confirmation still applies. Stop captures the inspector tab and session ID before querying `chat:running-agents` and uses that same target for the query, confirmation, `chat:abort`, local cleanup and every RPC-failure fallback, even when the active tab changes before confirmation or during fallback. The current no-argument abort path reads the active tab again (`conversation.service.ts:412-424,566-621`); a targeted frontend-store abort variant is allowed, with no backend protocol change. A component/service test changes the active tab before confirmation and again on a rejected agent query, then proves that only the captured inspector session is aborted or locally changed and that cancel sends no abort. Labels, title text, focus order, keyboard activation and disabled reasons are accessible. Actions remain reachable at narrow widths without obscuring the title or panel control. The inspector rail's compact form remains compact.

## Risks

- Width and selection rules can conflict when the dock is narrower than the selected pill plus menu; retain access in overflow and do not exceed the five-chip cap.
- Grouping is a display order over persisted manual tile order. Existing Move Up/Down and jump-to-status behavior need deliberate adaptation to avoid confusing movement or focus jumps.
- Inspector actions are session-scoped while the existing Stop flow focuses the active tab; wiring must prevent stopping another session in split panes or after rapid focus changes.
- Focus freezing and missing width measurements can bypass planner limits; the rendered dock must enforce the cap while preserving keyboard access.
- The shared Tailwind `animate-spin` mapping already pulses, but component-local animation declarations take precedence; reduced-motion rules must remove the halo/ring and leave a static dot.

## Out of scope

TUI changes; VS Code-only UI or editor-tab pop-out; backend protocol additions; new session lifecycle states; a redesign of Previous sessions search/filtering; changing the stored canvas tile order solely to achieve visual grouping; changing non-loading transitions or determinate progress visuals.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Five visible dock agents maximum | Five or six | Existing `DOCK_INLINE_MAX = 5` and width reservations at `dock-overflow.ts:8-24,36-49`; six risks squeezing the selected pill and menu. | Yes |
| Put `error` in the middle group with explicit Error label | Middle attention group or Finished | `CompactRailState` currently includes `error` (`canvas-rail.component.ts:41-45`); errors need attention and must stay above finished work. | Yes |
| Promote Rename, Organize and conditional Stop into inspector header | Those actions or a new pop-out/copy/fork action | All three already have card-menu flows and RPCs cited above; app-shell editor pop-out is VS Code only (`app-shell.component.html:210-229`). | Yes |

## Revision 1

1. Required left-to-right running-first rendered chip order, with the selected non-running pill as the sole exception and a rendered-order component test.
2. Required the five-chip cap for initial/non-finite width, unavailable `ResizeObserver`, focused-dock status updates and resize, with component tests for each path.
3. Preserved dock arrow-key selection and focus freezing plus rail keyboard focus order after grouping, with parity rows and tests.
4. Fixed Stop to the inspector tab/session from the start of the flow through confirmation and RPC-failure fallback, with a tab-switch test.
5. Located all five individual status jump actions in a labeled expanded-rail summary with accessible counts and keyboard activation.
