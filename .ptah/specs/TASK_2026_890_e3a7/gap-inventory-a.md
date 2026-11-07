# Gap inventory — Lane A (Electron shell, renderer routes, chat and frontend libs)

Scope: `apps/ptah-electron/src`, `apps/ptah-extension-webview/src`, and the libs `chat`, `chat-*`,
`core`, `ui`, `markdown`, `thoth-shell`, `command-center`, `notification-center`, `onboarding`,
`setup-wizard`, `dashboard`, `declarative-dashboard`, `canvas`. Settings pages are lane B.
Docs compared: `apps/ptah-docs/src/content/docs/**` and the sidebar in `apps/ptah-docs/astro.config.mjs`.

Path short forms: `electron/` = `apps/ptah-electron/src/`, `webview/` = `apps/ptah-extension-webview/src/app/`,
`fe/` = `libs/frontend/`.

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

## Summary

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

## Decisions

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
