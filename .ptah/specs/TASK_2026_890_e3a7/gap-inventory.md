# Gap inventory — PtahCode Electron app vs apps/ptah-docs

Merged from two read-only lanes (claude CLI; opencode and antigravity were at their usage limit).
Part A: shell, chat, canvas, dashboard, onboarding, setup wizard, command center, notifications.
Part B: Thoth (memory, skills, schedules, messaging), reviews, tasks, apps, git, marketplace,
all settings, and the known gaps. Row numbers restart in each part (A-n, B-n).

Totals: 138 rows — 45 documented, 41 partial, 52 missing.

Orchestrator spot-check (5 rows, all confirmed): A-36 session inspector, A-42 queued follow-ups,
A-3 tray Pause memory, A-35 lane tabs, B-2 memory Timeline. Also confirmed B-78: remote machines
has no renderer UI (`libs/frontend/machines-ui/src/index.ts` is `export {};`; the `machines:*`
RPC methods have no renderer caller), so it is not user-reachable yet.

Open question: Help → Documentation opens `https://ptah.live/docs`
(`apps/ptah-electron/src/menu/application-menu.ts:171`), not `https://docs.ptah.live`. The landing
site has a `docs` route, so this may be intended.

## Part A
| # | Area | Feature (UI label) | Code evidence (file:line) | Docs page (slug or —) | Status | Notes |
|---|------|--------------------|---------------------------|------------------------|--------|-------|
| 1 | Shell / App menu | File, Edit, View, Window, Help menus (**New Chat**, **Open Folder...**, **Settings** / **Preferences...**, Reload, Toggle DevTools, zoom, full screen, **Open Website**, **Documentation**, **About**) | `electron/menu/application-menu.ts:73`, `electron/menu/application-menu.ts:133` | reference/keyboard-shortcuts | partial | Shortcuts are listed. Zoom, full screen, the Window menu and Help → Open Website / Documentation / About are absent. |
| 2 | Shell / App menu | Help → Database → **Reset Database...** | `electron/menu/application-menu.ts:179` | troubleshooting/logs-and-diagnostics | documented | |
| 3 | Shell / Tray | Tray icon menu: **Pause memory** toggle, **Quit PtahCode**, state tooltip | `electron/services/tray/tray.service.ts:139`, `electron/services/tray/tray.service.ts:150` | — | missing | No page names the tray or the Pause memory toggle. |
| 4 | Shell / Update | Update check and update dialog (**Download**; GitHub Releases check every 4 h; Microsoft Store builds skip it) | `electron/services/update/update-manager.ts:39`, `electron/services/update/update-manager.ts:35` | getting-started/installation (#updates) | documented | |
| 5 | Shell / Notifications | OS desktop notifications when an agent needs you and the window is not focused; a click shows the window | `electron/activation/bootstrap.ts:352`, `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.ts:28` | — | missing | No page tells the user that PtahCode sends OS notifications. |
| 6 | Shell / Windows | Single instance: a second launch focuses the open window | `electron/main.ts:434` | — | missing | Minor. Fits workspace/opening-a-workspace. |
| 7 | Shell / Windows | Detached Display window (**PtahCode - Display**) from **Open Display in a separate window** | `electron/windows/display-window.ts:130`, `fe/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts:142` | — | missing | |
| 8 | Shell / Startup | Open a folder from the command line | `electron/activation/initial-workspace-arg.ts:3` | workspace/opening-a-workspace (#from-the-command-line) | documented | |
| 9 | Shell / Startup | Workspace restore at launch | `electron/activation/workspace-restore.ts:18` | workspace/workspace-restoration | documented | |
| 10 | Shell / Startup | Preparing-workspace splash and boot progress | `electron/assets/preparing-workspace.html:1`, `fe/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts:93` | — | missing | Minor. |
| 11 | Shell / Startup | Recovery shell when local storage fails at boot | `electron/main.ts:270`, `electron/activation/recovery-mode-ipc.ts:52` | — | missing | Troubleshooting has no entry for the recovery screen. |
| 12 | Shell / Tab bar | **Chat**, **Voice**, **Apps**, **Tasks**, **Reviews**, **Analytics**, **Setup** tabs | `fe/chat/src/lib/components/templates/electron-shell.component.ts:245`, `fe/chat/src/lib/components/templates/electron-shell.component.ts:328` | getting-started/first-launch | documented | Tab table is current. |
| 13 | Shell / Title bar | **Thoth**, **Marketplace**, **Settings** buttons; **Back to welcome** | `fe/chat/src/lib/components/molecules/global-config-actions.component.ts:82`, `fe/chat/src/lib/components/templates/electron-shell.component.ts:366` | getting-started/first-launch | partial | Back to welcome is absent. |
| 14 | Shell / Title bar | Theme toggle (**Change theme**) | `fe/chat/src/lib/components/templates/electron-shell.component.ts:381`, `fe/chat-ui/src/lib/atoms/theme-toggle.component.ts:45` | settings/theme | documented | |
| 15 | Shell / Title bar | Notification center (**Notifications**, **Needs you**, **Recent notices**, **Clear all notices**), snackbar and announcer | `fe/chat/src/lib/components/templates/electron-shell.component.ts:382`, `fe/notification-center/src/lib/notification-center.component.ts:38` | — | missing | |
| 16 | Welcome | Welcome screen: **Open a workspace**, **Open Folder**, recent workspaces, 13-week activity grid, vitals row, prompt launchers | `fe/chat/src/lib/components/templates/electron-shell.component.ts:411`, `fe/chat/src/lib/components/templates/electron-welcome.component.ts:176` | getting-started/first-launch, workspace/opening-a-workspace | partial | Vitals row and prompt launchers are absent. |
| 17 | Workspace | Workspace sidebar: Workspaces tab, **Add Folder**, **Remove workspace**, running-session marker | `fe/chat/src/lib/components/organisms/workspace-sidebar.component.ts:117` | workspace/opening-a-workspace, workspace/switching-workspaces | documented | |
| 18 | Workspace | **Close Workspace?** confirmation (stops streaming sessions) | `fe/core/src/lib/services/electron-layout.service.ts:456` | — | missing | No page warns that closing a workspace aborts running turns. |
| 19 | Route /onboarding | First-run **Get ready** step (**Check Claude Code and Codex**, **Continue anyway**) | `webview/app.routes.ts:86`, `fe/onboarding/src/lib/onboarding.routes.ts:39` | getting-started/first-launch, setup | documented | |
| 20 | Route /onboarding/analyze | Analyze current project (analyze → agents → generate → guidance → done; **Saved analyses**) | `fe/onboarding/src/lib/onboarding.routes.ts:52`, `fe/onboarding/src/lib/analyze/analyze-workspace.page.ts:209` | setup/setup-wizard | documented | |
| 21 | Setup | Generation controls: model picker, Stop generation, per-file Keep / Replace, community packs, **Interrupted analysis** resume | `fe/setup-wizard/src/lib/components/generation-model-picker.component.ts:12`, `fe/setup-wizard/src/lib/components/preview-decisions/keep-replace-control.component.ts:32` | setup/setup-wizard | partial | The page lists the steps but not these controls. Other evidence: `community-packs-panel.component.ts:28`, `analyze-workspace.page.ts:164`. |
| 22 | Route /onboarding/team-builder, /new-project | AI team builder and New project proposal (**Reply to the agent**, **Revision history**, **Save as preset**, review and **Apply**) | `fe/onboarding/src/lib/onboarding.routes.ts:95`, `fe/onboarding/src/lib/proposal/revision-history.component.ts:21` | setup/ai-team-builder, setup/new-project | partial | Presets and apply are documented. Revision history and the reply composer are absent. |
| 23 | Route /onboarding/guidance | **Only regenerate guidance** | `fe/onboarding/src/lib/onboarding.routes.ts:77` | setup/setup-wizard (#run-only-one-part) | documented | |
| 24 | Route /analytics | Usage dashboard (totals, **Daily usage**, **Cost share**, **Cache savings**, sessions table, **Refresh usage**) | `webview/app.routes.ts:115`, `fe/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.ts:47` | sessions/analytics | documented | |
| 25 | Analytics | **Account usage** tiles (provider plan windows), **Ptah Builders membership** card, **Skills for this project** card | `fe/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:837`, `fe/dashboard/src/lib/components/builders-card/builders-card.component.html:4` | sessions/analytics, plugins/skill-selection | partial | Account usage tiles and the Builders card are absent from the analytics page. |
| 26 | Route /thoth | Thoth shell and its tab bar: **Memory**, **Skills**, **Schedules**, **Messaging** | `webview/app.routes.ts:122`, `fe/thoth-shell/src/lib/components/thoth-shell.component.ts:376` | memory, skill-synthesis, automation/cron, automation/messaging | partial | No page describes Thoth itself (what it is, how to open it, its tabs). Tab content is lane B. |
| 27 | Route /marketplace | Marketplace surface entry | `webview/app.routes.ts:133` | marketplace | documented | Internals are lane B. |
| 28 | Route /tasks | Tasks tab entry | `webview/app.routes.ts:143` | tasks | documented | Internals are lane B. |
| 29 | Route /apps | **Apps** tab (MCP apps page) | `webview/app.routes.ts:153`, `fe/chat/src/lib/components/templates/electron-shell.component.ts:269` | getting-started/first-launch | partial | Only named ("MCP apps"). Internals are lane B. |
| 30 | Route /command-center | **Voice** tab, Command Center: **Start voice**, mic level, **Interrupt speech**, text command, **Live orchestration**, **Delegated work** list, **Recent sessions**, **Voice settings** link | `webview/app.routes.ts:163`, `fe/command-center/src/lib/components/command-center-page.component.html:125` | getting-started/first-launch | partial | Only named as "Voice control". No usage page. |
| 31 | Route /review-runs | **Reviews** tab (review runs) | `webview/app.routes.ts:177`, `fe/chat/src/lib/components/templates/electron-shell.component.ts:293` | getting-started/first-launch | partial | Only named. Internals (`review-runs-ui`) are lane B. |
| 32 | Canvas | Sessions rail: state groups, sort, **Dense cards**, **New session**, **Previous sessions**, 20 / 9 session limits | `fe/canvas/src/lib/canvas-rail/canvas-rail.component.ts:143`, `fe/canvas/src/lib/orchestra-canvas.component.ts:62` | canvas | documented | |
| 33 | Canvas | Card actions **Rename**, **Organize**, **Open beside** / **Close split** | `fe/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:640` | canvas, sessions/managing-sessions | documented | |
| 34 | Canvas | Send to messaging: hand a session to a Telegram, Discord or Slack binding (the tab becomes read-only) | `fe/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:391`, `fe/chat/src/lib/components/molecules/send-to-messaging/handoff-binding-picker.component.ts:224` | — | missing | Messaging pages cover the bots, not this card action. |
| 35 | Canvas | Focus area **Lanes** tabs and **Agents** dock menu | `fe/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:145`, `fe/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts:83` | — | missing | |
| 36 | Canvas | **Session inspector** (**Session details**): session stats, cache tile, limits and lanes, linked sessions, task section, git section, agents with actions, request panel; **Rename**, **Organize**, **Stop session** | `fe/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts:125`, `fe/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html:3` | — | missing | Known gap confirmed: "inspector" and "Session details" occur in no docs page. Stop action: `inspector-session-actions.component.html:29`. |
| 37 | Canvas | **Limits** alert and plan-limit tiles (provider plan windows, in the inspector task section) | `fe/chat-ui/src/lib/molecules/session/plan-limits/limits-alert.component.ts:19`, `fe/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts:47` | — | missing | The canvas "Limits" note is about session counts only. |
| 38 | Canvas | Empty board (readiness, branch, **Dismiss notice**) and chat empty state | `fe/canvas/src/lib/canvas-rail/canvas-empty-board.component.ts:205`, `fe/chat/src/lib/components/templates/chat-view.component.html:94` | — | missing | Minor. |
| 39 | Chat | Compact session card (compact view of a session) | `fe/chat/src/lib/components/templates/chat-view.component.html:10` | — | missing | Minor. |
| 40 | Chat / Composer | Message input, `@` and `/` suggestions, attachments, model selector, effort selector, approval chip, MCP chip, Send / Stop | `fe/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts:52`, `fe/chat/src/lib/components/molecules/chat-input/model-selector.component.ts:32` | chat, chat/file-attachments, chat/effort-levels, chat/autopilot, chat/cost-and-tokens | documented | |
| 41 | Chat / Composer | **Context usage** ring | `fe/chat-ui/src/lib/atoms/context-ring.component.ts:9` | — | missing | |
| 42 | Chat / Composer | Queued follow-ups: queue a message while a turn runs, **Edit queued message**, withdraw to composer | `fe/chat/src/lib/components/molecules/queued-follow-ups/queued-follow-ups.component.ts:71` | — | missing | agents/agent-sessions covers only the `ptah_session_send` queue mode. |
| 43 | Chat / Composer | Peer session send (**Message another peer session**) and the "Sent from another session" origin marker | `fe/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:545`, `fe/chat/src/lib/components/molecules/lane-event/lane-event-row.component.html:53` | — | missing | |
| 44 | Chat / Transcript | Streaming, Stop, **Branch conversation from here** | `fe/chat/src/lib/components/molecules/lane-event/lane-event-row.component.html:33` | chat/sending-messages | documented | |
| 45 | Chat / Transcript | Execution Tree | `fe/chat/src/lib/components/organisms/execution/execution-node.component.ts:151` | chat/execution-tree | documented | |
| 46 | Chat / Transcript | Permission request card (**Allow once**, **Always allow**, **Deny**) | `fe/chat-ui/src/lib/molecules/permissions/permission-request-card.component.ts:122` | chat/autopilot | partial | Manual approval is named. The card and its three actions are absent. |
| 47 | Chat / Transcript | Question card (**Input needed**, custom response) | `fe/chat-ui/src/lib/molecules/question-card.component.ts:64` | agents/agent-sessions | partial | Only AskUserQuestion for child sessions. The chat card is absent. |
| 48 | Chat / Transcript | **Turn summary** chip (**Changed files**, **Test results**) and change-set card (review, open file, open source control, **Conflicted**) | `fe/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.ts:67`, `fe/chat-ui/src/lib/molecules/change-set/change-set-card.component.ts:335` | — | missing | |
| 49 | Chat / Transcript | **Report response** button | `fe/chat-ui/src/lib/atoms/report-response-button.component.ts:40` | — | missing | troubleshooting/filing-bugs does not name it. |
| 50 | Chat / Transcript | Message rendering: markdown, code copy, clickable file paths, Mermaid diagrams | `fe/markdown/src/lib/markdown-block.component.ts:24`, `fe/chat-ui/src/lib/atoms/file-path-link.component.ts:31` | — | missing | Minor. Mermaid: `mermaid-diagram.component.ts:25`. |
| 51 | Chat / Display | Display panel and sheet (**Displays**, **Keep current view**, **Collapse display**): artifacts, file viewer, Ptah UI blocks, declarative dashboards | `fe/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts:38`, `fe/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts:207` | — | missing | Also `artifact-card.component.ts:27`, `fe/declarative-dashboard/src/lib/components/surface-renderer.component.ts:258`. |
| 52 | Chat / Agents | CLI agent cards and agent monitor panel: output, lane usage, **Stop agent**, **Resume agent session**, steer input | `fe/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts:150`, `fe/chat/src/lib/components/templates/chat-view.component.html:313` | agents/cli-agents | partial | The page covers the tools. The card controls (Stop, Resume, steer) are absent. |
| 53 | Chat / Agents | **Background agents** strip and **Running background tasks** tiles | `fe/chat-ui/src/lib/molecules/background-agent-strip.component.ts:209`, `fe/chat/src/lib/components/molecules/background-task-tiles/background-task-tiles.component.ts:26` | canvas | partial | Only the rail group "Background work". |
| 54 | Chat / Banners | Interrupted agents banner (**Resume all interrupted agents**) | `fe/chat/src/lib/components/molecules/notifications/resume-notification-banner.component.ts:59` | workspace/workspace-restoration | partial | The card label is described. The banner and Resume all are absent. |
| 55 | Chat / Banners | Session budget banner | `fe/chat/src/lib/components/templates/chat-view.component.html:137` | sessions/cost-summary | documented | |
| 56 | Chat / Banners | Compaction notification and compaction marker | `fe/chat-ui/src/lib/molecules/notifications/compaction-notification.component.ts:9`, `fe/chat/src/lib/components/templates/chat-view.component.html:58` | sessions/cost-summary, memory/settings | partial | Settings are named. The chat notification and marker are absent. |
| 57 | Chat / Banners | Auth-required banner and Codex sign-in block | `fe/chat/src/lib/components/templates/chat-view.component.html:154`, `fe/chat/src/lib/components/templates/chat-view.component.html:166` | getting-started/signing-in, providers/codex | partial | Sign-in is documented. The in-chat banner is absent. |
| 58 | Chat / Banners | Install scope migration notice | `fe/chat/src/lib/components/templates/chat-view.component.html:35` | — | missing | Minor. |
| 59 | Sessions | Previous sessions modal: search, date range, filters | `fe/chat/src/lib/components/molecules/previous-sessions-toolbar/previous-sessions-toolbar.component.ts:80` | sessions/session-history | documented | |

### Summary

Total rows: 59.

| Status | Count |
|--------|-------|
| documented | 20 |
| partial | 17 |
| missing | 22 |

Four partial rows are "named only" in the getting-started/first-launch tab table and have no usage
page: Voice / Command Center (#30), Reviews (#31), Apps (#29) and Thoth as a surface (#26). Treat
#30 and #31 as near-missing.

### Top 10 missing features

1. **Session inspector (#36)** — It is the main place to see session stats, limits, linked sessions, task, git and agents, and to stop a session. Users cannot find it without a page.
2. **Display panel (#51)** — Agents show artifacts, files and generated UI here. Users need to know how to pin, collapse and use it.
3. **Detached Display window (#7)** — An Electron-only window. Users need to know how to open it and that it follows the active tab.
4. **Notification center (#15)** — It lists what needs a response (permissions, unavailable sessions). Users must know where to look when an agent waits.
5. **OS desktop notifications (#5)** — Users need to know why the app sends notifications and what a click does.
6. **Queued follow-ups (#42)** — Users type during a running turn. They need to know that the message is queued and how to edit or withdraw it.
7. **Turn summary and change-set card (#48)** — This is how a user reviews the files and tests that each turn changed.
8. **Send to messaging (#34)** — It hands a session to a phone bot and makes the tab read-only. That effect must be explained before use.
9. **Plan limits alert and tiles (#37)** — Users need to read provider 5-hour and weekly windows before a lane stops on a limit.
10. **Tray menu and Pause memory (#3)** — The tray is the only place for the Pause memory toggle. Users who run in the background need it.

Next candidates: peer session send (#43), Close Workspace confirmation (#18), context usage ring (#41),
recovery shell (#11), lanes tabs and agents dock (#35).

### Decisions

- **Known gaps.** Only the session inspector is in lane A scope (row 36). Remote machines
  (`libs/frontend/machines-ui`), MCP caller authentication and the memory corpus and timeline
  (`libs/frontend/memory-curator-ui`, the Thoth Memory tab content) are not in the lane A libs. No
  code in lane A scope imports `machines-ui`. Lane B owns those rows.
- **Routes to other libs.** `app.routes.ts` is in scope, so each route has one entry-point row (#26–#31).
  The content of `marketplace`, `tasks-ui`, `mcp-apps-page`, `review-runs-ui` and the four Thoth tab
  libs is lane B. The `settings` route (`SettingsComponent` in `libs/frontend/chat`) is lane B and is not listed.
- **Settings components in lane A libs** (`libs/frontend/chat/src/lib/settings/**`, the motion style
  picker, the Voice settings content) are skipped. The Command Center row lists only the link to Voice settings.
- **Deep links.** The Electron app registers no protocol handler (no `setAsDefaultProtocolClient` or
  `open-url` in `apps/ptah-electron/src`). There is no deep-link feature to list.
- **Grouped rows.** The app menu is one row (#1), except Reset Database (#2), because it is destructive.
  The composer controls are one row (#40) because the chat pages cover them together. The banners in
  `chat-view.component.html` each have a row because each has its own user action.
- **Skipped as not user-facing.** The IPC bridge and its sender policy, the artifact protocol plumbing
  (its user effect is in #51), the replay recorder, the diagnostics loggers, the boot coordinator, the
  workers, `webview-e2e-harness`, test fixtures, the `ui` primitives (cards, modals, dropdowns) and
  the `chat-state`, `chat-streaming`, `chat-routing` and `chat-types` libs (state only; their effects
  appear in the chat rows).
- **Status calls.** A page that only names a feature in a table is `partial` (brief rule). A
  feature that docs cover only through the MCP tool API (for example the `queue` mode) and not through
  the UI control is `missing` (#42).
- **Docs search.** Every `missing` row was checked against the docs for the feature name and its UI
  label strings (for example "inspector", "Session details", "Display", "Needs you", "Pause memory",
  "Allow once", "Turn summary", "Context usage", "Close Workspace", "Peer"). There were no hits.
- **Help → Documentation** opens `https://ptah.live/docs`. The docs site URL in the facts file is
  `https://docs.ptah.live`. This is outside the inventory, but lane owners can check it.

## Part B
| # | Area | Feature (UI label) | Code evidence (file:line) | Docs page (slug or —) | Status | Notes |
|---|------|--------------------|---------------------------|-----------------------|--------|-------|
| 1 | Thoth › Memory | **Memories** view: search, scope toggle, pin, forget, stats strip | `LF/thoth-shell/src/lib/components/thoth-shell.component.ts:232`, `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:284` | memory/searching, memory/pinning-and-forgetting | documented | — |
| 2 | Thoth › Memory | **Timeline** view: query, memory type, concepts, files, date range, anchor, Load more (KNOWN GAP) | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:350`, `LF/memory-curator-ui/src/lib/components/timeline-filters.component.ts:48` | — | missing | No docs page contains "timeline". |
| 3 | Thoth › Memory | **Corpus** view: **Knowledge corpora** list, build-corpus dialog (name, type, concepts, files, query, limit, workspace scope), **Suggested boards** (KNOWN GAP) | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:351`, `LF/memory-curator-ui/src/lib/components/corpus-build-dialog.component.ts:55` | — | missing | memory/how-it-works only says "corpus memories are exempt" from eviction. |
| 4 | Thoth › Memory | **Code index** view: indexed symbols, search, paging, **Advanced indexing** / **Re-index** | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:224`, `LF/workspace-indexing/src/lib/workspace-indexing.component.ts` (mounted at memory-curator-tab:244) | memory/searching, workspace/workspace-intelligence | documented | — |
| 5 | Thoth › Memory | **Maintenance** › diagnostics: Last curator run, Curator model, DB health, storage health, event feed, trigger toggles | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:257`, `LF/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts:55` | — | missing | memory/settings lists trigger keys only. The diagnostics panel is not described. |
| 6 | Thoth › Memory | **Danger zone**: purge entries by subject pattern and match mode | `LF/memory-curator-ui/src/lib/components/memory-danger-zone.component.ts:25`, `:33` | — | missing | Destructive action with no docs. |
| 7 | Thoth › Memory | Memory **Paused** switch | `LF/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:185`, `LF/memory-curator-ui/src/lib/components/memory-pause-switch.component.ts:59` | memory/settings | partial | Only the `memory.enabled` key is listed. The tab switch is not named. |
| 8 | Thoth › Skills | Skills Library: cards, drawer, edit body, history restore, **Rebase to upstream** / **Keep mine**, **Enhance now** | `LF/thoth-shell/src/lib/components/thoth-shell.component.ts:237`, `LF/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:108` | skill-synthesis/the-skills-tab, skill-synthesis/how-it-works | documented | — |
| 9 | Thoth › Skills | **Skills** pause switch and **Skill telemetry** switch | `LF/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:77` | skill-synthesis/the-skills-tab | documented | — |
| 10 | Thoth › Skills | Bulk select and bulk rebase toolbar | `LF/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:305`, `LF/skill-synthesis-ui/src/lib/components/clones/clone-bulk-toolbar.component.ts:58` | — | missing | — |
| 11 | Thoth › Skills | Quarantined agents panel and **Restore** | `LF/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:400`, `LF/skill-synthesis-ui/src/lib/components/clones/quarantined-agents-panel.component.ts:255` | — | missing | No docs page contains "quarantine". |
| 12 | Thoth › Skills | Agent card: model per provider editor | `LF/skill-synthesis-ui/src/lib/components/clones/clone-card.component.ts:351`, `LF/skill-synthesis-ui/src/lib/components/clones/agent-model-editor.component.ts:167` | — | missing | — |
| 13 | Thoth › Skills | Scorecard badge and scorecard detail in the drawer | `LF/skill-synthesis-ui/src/lib/components/clones/clone-detail-drawer.component.ts:343` | skill-synthesis/the-skills-tab | partial | The page names **Success** / **No grade**. The scorecard detail is absent. |
| 14 | Thoth › Skills | **Orchestration specs**: **Harvest** review verdicts, **Clear stale** | `LF/skill-synthesis-ui/src/lib/components/skill-specs-control.component.ts:19`, `LF/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:113` | — | missing | No docs page contains "harvest". |
| 15 | Thoth › Schedules | **Schedules** tab: job list, stats, scope, **Run now** / **Edit job** / **Delete job**, job editor, run history drawer | `LF/thoth-shell/src/lib/components/thoth-shell.component.ts:242`, `LF/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts:130` | automation/cron/* (6 pages) | documented | — |
| 16 | Thoth › Messaging | Messaging tab: platform tabs, Connection / Access / Integration, allow list, pending and approved bindings, Discord integration kit | `LF/thoth-shell/src/lib/components/thoth-shell.component.ts:247`, `LF/messaging-gateway-ui/src/lib/components/gateway-platform-pane.component.ts:52` | automation/messaging/* (6 pages) | documented | — |
| 17 | Thoth › Messaging | **Gateway setup** guide drawer | `LF/messaging-gateway-ui/src/lib/components/messaging-gateway-tab.component.ts:126`, `LF/messaging-gateway-ui/src/lib/components/gateway-setup-guide.component.ts:24` | — | missing | Low priority: in-app help. The pages do not name it. |
| 18 | Thoth › Messaging | **Voice & rate limits** section | `LF/messaging-gateway-ui/src/lib/components/messaging-gateway-tab.component.ts:303` | automation/messaging/settings | documented | — |
| 19 | Reviews | **Review runs** page: runs list, **Refresh**, run detail (Stage timeline, Coverage and lanes, **Rerun this PR**, Findings, Walkthrough preview, Artifacts) | `apps/ptah-extension-webview/src/app/app.routes.ts:177`, `LF/review-runs-ui/src/lib/components/review-run-detail.component.ts:30` | getting-started/first-launch (tab name only) | missing | Also linked from **Schedules** (`cron-scheduler-tab.component.ts:141`). |
| 20 | Reviews | Review settings drawer: **Repositories** editor, **GitHub bot identity** token, publication pause | `LF/review-runs-ui/src/lib/components/review-runs-page.component.ts:229`, `LF/review-runs-ui/src/lib/components/review-bot-identity.component.ts:10` | — | missing | RPC `review:setBotToken`, `review:setPublicationPause`, `review:updateSettings`. |
| 21 | Tasks | Tasks board: Kanban / List, six columns, detail panel, workflow documents, **Start**, **New Task**, exclusions drawer | `apps/ptah-extension-webview/src/app/app.routes.ts:143`, `LF/tasks-ui/src/lib/components/tasks-view.component.ts:373` | tasks/index | documented | — |
| 22 | Tasks | Filter bar (text, labels, sort) and saved views menu | `LF/tasks-ui/src/lib/components/tasks-view.component.ts:178`, `:199` | — | missing | tasks/index does not mention filter, sort or saved views. |
| 23 | Tasks | Multi-select bulk bar: move to a status, add or remove a label | `LF/tasks-ui/src/lib/components/tasks-view.component.ts:344`, `LF/tasks-ui/src/lib/components/bulk/task-bulk-bar.component.ts` | — | missing | — |
| 24 | Tasks | Board command palette (`Ctrl+K` / `Cmd+K`) | `LF/tasks-ui/src/lib/components/tasks-view.component.ts:365`, `:577` | — | missing | Not in reference/keyboard-shortcuts. |
| 25 | Tasks | Detail panel: relations editor and activity feed | `LF/tasks-ui/src/lib/components/detail/task-detail.component.ts:283`, `:313` | tasks/index | partial | Only `depends_on` is named. Relation kinds and activity are absent. |
| 26 | Tasks | **Manage**: **Generate registry**, **Reindex**, **Tidy finished…** | `LF/tasks-ui/src/lib/components/tasks-view.component.ts:381` | tasks/index | documented | — |
| 27 | Apps | **Apps** page: MCP apps conversation, app surface panel, resizable column | `apps/ptah-extension-webview/src/app/app.routes.ts:153`, `LF/mcp-apps-page/src/lib/components/apps-page.component.ts` | getting-started/first-launch (tab name only) | missing | — |
| 28 | Git | Git dock header: branch, ahead/behind, stash count, Fetch / Pull / Push | `LF/git-ui/src/lib/git-dock/git-dock-header.component.ts:127` | git/git-status, git/index | documented | — |
| 29 | Git | Branch picker: search, switch, create a branch, overwritten-files warning | `LF/git-ui/src/lib/git-dock/git-dock-header.component.ts:127`, `LF/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts:63`, `:290` | — | missing | Docs tell the user to switch branches in a terminal. |
| 30 | Git | **Stashes** popover: entries and files in a stash | `LF/git-ui/src/lib/git-dock/git-dock-header.component.ts:157`, `LF/git-ui/src/lib/stash/stash-popover.component.ts:59` | git/index | partial | Named in the quick reference only. Actions are absent. |
| 31 | Git | Review view › **Changes**: diff layout, hunk actions, stage / discard, **Choose a comparison** | `LF/git-ui/src/lib/review-canvas/review-canvas.component.ts` | git/diffs | documented | — |
| 32 | Git | Review view › **Commit** composer and message generation | `LF/git-ui/src/lib/commit/commit-composer.component.ts` | git/commits | documented | — |
| 33 | Git | Review view › **History** tab: timeline, stash section, refresh | `LF/git-ui/src/lib/review-shell/review-shell.component.ts:377`, `LF/git-ui/src/lib/history/history-timeline.component.ts:141` | git/index | partial | Named in the quick reference only. |
| 34 | Git | Review view › **Task** tab: add and remove worktrees | `LF/git-ui/src/lib/task/task-worktree-view.component.ts:239` | git/worktrees | documented | — |
| 35 | Git | Task tab › **Pull request** panel: PR status badge, open in browser | `LF/git-ui/src/lib/task/task-worktree-view.component.ts:193`, `LF/git-ui/src/lib/task/task-pr-panel.component.ts:123` | — | missing | — |
| 36 | Git | Conflict banner with conflicted files | `LF/git-ui/src/lib/review-shell/review-shell.component.ts:199`, `LF/git-ui/src/lib/conflict/conflict-banner.component.ts:190` | — | missing | No docs page contains "conflict". |
| 37 | Git | **Open in** button: choose an external editor | `LF/git-ui/src/lib/git-dock/git-dock-header.component.ts:164`, `LF/git-ui/src/lib/open-in/open-in-button.component.ts:95` | — | missing | Appears in the dock, diffs, history and the spot editor. |
| 38 | Git | Spot editor: edit a file in the review view, Markdown view, unsaved-changes state | `LF/git-ui/src/lib/review-shell/review-shell.component.ts:255`, `LF/git-ui/src/lib/spot-editor/spot-editor.component.ts:167` | — | missing | — |
| 39 | Git | **Draft comments** bar on the review canvas | `LF/git-ui/src/lib/review-canvas/review-canvas.component.ts:206`, `LF/git-ui/src/lib/review-canvas/draft-comments-bar.component.ts:65` | — | missing | — |
| 40 | Setup | AI team builder: Brief / Proposal / Review, preview sections, **Presets**, **Apply**, leave dialog | `LF/onboarding/src/lib/proposal/proposal-workspace.page.ts:120`, `LF/harness-builder/src/lib/components/harness-config-preview.component.ts:90` | setup/ai-team-builder | documented | — |
| 41 | Setup | Builder AI helpers ("Describe the product or paste a PRD") and stack profile (Toolchain, Skills, Plugins on) | `LF/onboarding/src/lib/proposal/proposal-workspace.page.ts:115`, `LF/harness-builder/src/lib/components/sidebar/builder-stack-profile-section.component.ts` | setup/ai-team-builder | partial | These two sidebar sections are not named. |
| 42 | Marketplace | **Overview** page: stats, needs attention, featured connectors | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:59`, `LF/marketplace/src/lib/pages/overview/overview-page.component.ts` | marketplace/index | partial | One table row only. |
| 43 | Marketplace | **Connectors** catalog and status | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:65`, `LF/marketplace/src/lib/pages/connectors/connectors-page.component.ts` | marketplace/connectors | documented | — |
| 44 | Marketplace | **MCP Servers** (installed): table / cards, filters, server detail inspector, capability toggles, target marks, coverage matrix, bulk actions, removal | `LF/marketplace/src/lib/routes/marketplace.routes.ts:138`, `LF/marketplace/src/lib/pages/servers/installed-servers-page.component.ts` | marketplace/index, marketplace/mcp-registry | partial | Only "See what is installed". Detail, toggles, coverage and removal are absent. |
| 45 | Marketplace | **Skills & Plugins** (installed): library, skill detail, stale-library notice | `LF/marketplace/src/lib/routes/marketplace.routes.ts:152`, `LF/marketplace/src/lib/pages/skills/installed-skills-page.component.ts` | marketplace/index, plugins/skill-toggles | partial | The page itself is one table row. |
| 46 | Marketplace | Harness health badge, **Re-check harness health**, repair dialog, blocked harness paths | `LF/marketplace/src/lib/pages/skills/skills-section-header.component.ts:43`, `LF/marketplace/src/lib/harness/harness-health-badge.component.ts:123` | — | missing | No docs page contains "repair" or "blocked path". |
| 47 | Marketplace | **Smithery** source | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:92` | marketplace/smithery | documented | — |
| 48 | Marketplace | **MCP Registry** source | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:98` | marketplace/mcp-registry | documented | — |
| 49 | Marketplace | **Custom URL** (OAuth servers) source | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:104` | marketplace/connected-apps | documented | — |
| 50 | Marketplace | **Ptah Plugins** source | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:110` | plugins/marketplace, plugins/installing | documented | — |
| 51 | Marketplace | **Community** source (skills.sh) | `LF/marketplace/src/lib/shell/marketplace-nav.component.ts:116` | marketplace/index, plugins/index | partial | Named only. How to search and install is absent. |
| 52 | Marketplace | **Marketplaces** source: GitHub `owner/repo` marketplaces, consent dialog (per-file differences), install report, installed rows | `LF/marketplace/src/lib/pages/skills/skill-source-host.component.ts:132`, `LF/marketplace/src/lib/external-consent-dialog.component.ts:209` | marketplace/index, plugins/marketplace | partial | Named only. The consent and install flow is absent. |
| 53 | Settings | Settings page, four tabs, result toast with **Undo** | `LF/chat/src/lib/settings/settings.component.ts:201`, `LF/chat/src/lib/settings/feedback/settings-toast.component.ts` | settings/index | documented | — |
| 54 | Settings › Providers | **Main agent** section: **Reassign** provider, model and effort, scope badges, clear override | `LF/chat/src/lib/settings/providers/providers-settings.component.ts:129`, `LF/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts:132` | providers/index | partial | One bullet. Reassign popover, scope badges and override are absent. |
| 55 | Settings › Providers | Connections: filter, connection cards, **Connect a provider** catalog, custom endpoint, setup wizard, detail drawer (Overview & Used By, Credentials, Models & Tiers, Advanced) | `LF/chat/src/lib/settings/providers/providers-settings.component.ts:353`, `:445` | providers/index, providers/* (12 pages) | documented | **Token pricing** in the Advanced tab is not named. |
| 56 | Settings › Providers | Claude **Accounts** tab: **Add account**, sign-in script, ambient login check, Used by, remove | `LF/chat/src/lib/settings/providers/connection-detail-drawer.component.ts:87`, `LF/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts:107` | providers/claude | partial | One sentence. Add, sign-in script and remove steps are absent. |
| 57 | Settings › Providers | **CLI agents** matrix: model / effort cells, Claude lane account, Copilot auto-approve, Cursor credential, capability detail, **Orchestration policy**, **Max concurrent agents**, **Re-detect CLI agents** | `LF/chat/src/lib/settings/providers/agents-routing-settings.component.ts:63`, `LF/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:84` | providers/index, agents/cli-agents | partial | Policy, max concurrent, re-detect, Cursor credential and capability detail are absent. |
| 58 | Settings › Providers | Ptah CLI instances: add instance, tier mapping | `LF/chat/src/lib/settings/providers/add-cli-instance-modal.component.ts`, `LF/chat/src/lib/settings/providers/cli-tier-mapping-modal.component.ts` | providers/ptah-cli | documented | — |
| 59 | Settings › Providers | **Background models** / **Background model roles**: memory curator, skill enhancement, decision model, **Enhancement time limit** | `LF/chat/src/lib/settings/providers/agents-routing-settings.component.ts:142`, `LF/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts:483` | providers/index, skill-synthesis/settings | partial | Decision model row (key, base URL, timeout) and the time limit editor are absent. |
| 60 | Settings › Providers | Setting scope row ("Where this value can be set") | `LF/chat/src/lib/settings/providers/setting-scope-row.component.ts:116` | — | missing | Global versus workspace scope of a value is not explained. |
| 61 | Settings › Context Management | **Subagent prompt-cache TTL** | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:53` | settings/index | partial | Named only. |
| 62 | Settings › Context Management | Session budget | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:65` | sessions/cost-summary | documented | Page title is "Session Budget". It has a Settings section. |
| 63 | Settings › Context Management | **Lane guards** | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:74`, `LF/chat/src/lib/settings/ptah-ai/lane-guards-settings.component.ts:60` | settings/index | partial | Named only. |
| 64 | Settings › Context Management | Host routing, lane rotation, capability matrix (Family, Model, Samples, Score) | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:78`, `:80` | — | missing | — |
| 65 | Settings › Context Management | **Context budgets** group (`compaction.*`, idle compaction) | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:86`, `libs/shared/src/lib/types/advanced-settings.types.ts:93` | — | missing | No docs page contains a `compaction.` key. |
| 66 | Settings › Context Management | **Codex agents** group and **Codex sandbox mode** | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:87`, `:89` | providers/codex | partial | Only `codexAutoApprove` is documented. Sandbox mode and `codexAutoCompactTokens` / `codexToolOutputTokenLimit` / `codexWebSearch` are absent. |
| 67 | Settings › Context Management | **Background query limits** group (`internalQuery.*`) | `LF/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:90` | — | missing | — |
| 68 | Settings › Advanced | **Membership & data**: membership key, log out, **Export** / **Import** settings | `LF/chat/src/lib/settings/advanced-settings.component.ts:75`, `:122` | settings/import-export, getting-started/signing-in | documented | — |
| 69 | Settings › Advanced | Agent behaviour: **Enhanced System Prompt** (drawer: preview, regenerate, download), chat reasoning effort, **Dynamic workflows**, **Ultracode** mode | `LF/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts:136`, `:239` | chat/effort-levels | partial | Only effort is documented. Enhanced prompt, dynamic workflows and Ultracode are absent. |
| 70 | Settings › Advanced | Output styles: list, active style, create, editor, command-line parity write | `LF/chat/src/lib/settings/advanced-settings.component.ts:165`, `LF/chat/src/lib/settings/output-style/output-style-config.component.ts:89` | settings/index | partial | Named only. |
| 71 | Settings › Advanced | **MCP server port** and **Allow localhost access for browser tools** | `LF/chat/src/lib/settings/pro-features/mcp-port-config.component.ts:101`, `:206` | mcp-and-skills/built-in-mcp-server, troubleshooting/mcp-port-conflicts | partial | The localhost-access toggle is absent. |
| 72 | Settings › Advanced | Claude built-ins: built-in tools and claude.ai skills, token cost, "Needs tool" | `LF/chat/src/lib/settings/advanced-settings.component.ts:167`, `LF/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts:173` | — | missing | — |
| 73 | Settings › Advanced | Fine-tuning groups: **Memory upkeep**, **Scheduled jobs**, **Workspace harness** | `LF/chat/src/lib/settings/advanced-settings.component.ts:206`, `:208` | memory/settings, automation/cron/settings | partial | The keys of memory and cron are listed. `harness.preflightTimeoutMs` and `harness.manageGitignore` are absent. |
| 74 | Settings › Advanced | **Setup**: **Run onboarding again**, **Check Claude Code** | `LF/chat/src/lib/settings/settings.component.html:253`, `:265` | getting-started/first-launch, providers/claude | partial | **Run onboarding again** is absent. |
| 75 | Settings › Search & Voice | Web search: providers, API keys, Max results, test | `LF/chat/src/lib/settings/search-voice-settings.component.ts:20` | providers/web-search | documented | — |
| 76 | Settings › Search & Voice | Voice: STT and TTS direction, provider, model / voice, status, **Voice engines** drawer (ElevenLabs, local STT, local TTS) | `LF/chat/src/lib/settings/search-voice-settings.component.ts:23`, `LF/chat/src/lib/settings/ptah-ai/voice-details-drawer.component.ts:65` | — | missing | No docs page contains "ElevenLabs" or "text-to-speech". |
| 77 | Settings › Search & Voice | go vet consent: **Allow go vet**, workspace, Go binary | `LF/chat/src/lib/settings/search-voice-settings.component.ts:24`, `LF/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts:283` | — | missing | Consent to run the local Go toolchain needs a page. |
| 78 | Known gap | Remote machines (ssh transport, pairing, registry, remote sessions) | `libs/frontend/machines-ui/src/index.ts:1` (`export {};`), `libs/backend/remote-machines/src/lib/machines-rpc.handlers.ts:66`, `apps/ptah-electron/src/activation/wire-runtime.ts:346`, `libs/shared/src/lib/types/rpc.types.ts:4071` | — | missing | The backend and `machines:*` RPC are wired in Electron. No renderer UI calls them yet. No docs page contains "remote machine". |
| 79 | Known gap | MCP caller authentication: **External MCP callers** (`mcp.externalCallerAccess`) | `LF/chat/src/lib/settings/pro-features/mcp-port-config.component.ts:134`, commit `9101d8bc6` | mcp-and-skills/built-in-mcp-server (#external-callers) | partial | The setting is documented. Policy levels (read-only, lane-report, privileged), persistent tokens in `.mcp.json` / Codex TOML / Cursor header, and Host/Origin checks are absent. |

### Summary

Counts (79 rows):

| Status | Count |
|--------|-------|
| documented | 25 |
| partial | 24 |
| missing | 30 |

The 10 most important `missing` features:

1. **Remote machines** (#78) — users need a page that tells them how to pair a machine over ssh and run sessions on it. Write the page when a UI calls the `machines:*` methods.
2. **Review runs** (#19, #20) — a full surface with GitHub bot tokens and PR reruns. A user cannot set it up without a page.
3. **Memory Timeline** (#2) — the user needs to know how to filter memory events by type, concept, file and date.
4. **Memory Corpus** (#3) — the build dialog has six inputs and suggested boards. The user cannot know what a corpus does.
5. **Apps page** (#27) — a top-level tab that has only its name in the docs.
6. **Voice settings** (#76) — the user must select engines and keys (ElevenLabs or local) before voice works.
7. **Branch picker** (#29) — the docs tell users to switch branches in a terminal, but the app can do it.
8. **Memory Danger zone** (#6) — a destructive purge needs a page that describes its pattern modes.
9. **Context budgets and Background query limits** (#65, #67) — these keys change compaction and concurrency. Users need defaults and effects.
10. **go vet consent** (#77) — a security consent for running the local Go toolchain. Users need to know what it allows.

### Decisions

- **Session inspector**: it is in `libs/frontend/chat` (`LF/chat/src/lib/services/session-inspector/`,
  used at `LF/chat/src/lib/components/templates/chat-view.component.ts:1166`). That is lane A
  scope, so this file has no row for it. No docs page contains "inspector".
- **machines-ui** is an empty library (`export {};`), created in commit `c9e71a634`. Row #78
  uses the backend and RPC evidence instead.
- **MCP caller authentication** is `partial`, not `missing`: `mcp-and-skills/built-in-mcp-server`
  has an "External callers" section with the setting and its two values.
- **Thoth shell** (`LF/thoth-shell`) is only the tab host. Its tabs are in rows #1–#18. The shell
  and its entry button are left to lane A.
- **AI team builder**: the `harness-builder` components are mounted in the onboarding proposal page.
  Rows #40–#41 cover the builder panels only. The onboarding flow is lane A.
- **Skipped as not for Electron**: `vscode-lm-config.component.ts` shows only when a VS Code LM
  provider exists. That provider is not in the Electron host.
- **Skipped as not mounted in Settings**: the `notifications` and `display` advanced groups
  (`advanced-settings.types.ts`). No `groupId="notifications"` or `groupId="display"` mount was found
  in Settings. Lane A owns notifications.
- **Theme** (settings/theme) is not in a Settings tab component. It is left to lane A (shell).
- **Grouped**: small controls are under their panel. Examples: connection drawer tabs (#55),
  CLI matrix cells and popovers (#57), marketplace UI parts (#44).
- **Code index and workspace indexing**: the `workspace-indexing` component is mounted in the
  Code index view (`memory-curator-tab.component.ts:244`, before the `maintenance` case). This
  agrees with workspace/workspace-intelligence.
- Labels were found by search of templates (`aria-label`, headings, text). Each `missing` status
  was checked with a search of the docs for the feature name and its UI label strings.
