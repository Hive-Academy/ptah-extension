# Writer lane W1 — evidence report

Status: DONE. Four new pages, two cross-link lines. Link check: `node .ptah/specs/TASK_2026_889_d57a/_linkcheck.mjs` → internal links bad: 0, frontmatter issues: 0.

Path prefixes: `FE` = `libs/frontend`, `EL` = `apps/ptah-electron/src`, `BE` = `libs/backend`.
`SI` = `FE/chat/src/lib/components/organisms/session-inspector`, `IS` = `FE/chat-ui/src/lib/molecules/session/inspector-stats`,
`PL` = `FE/chat-ui/src/lib/molecules/session/plan-limits`.

## apps/ptah-docs/src/content/docs/canvas/session-inspector.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Inspector is named "Session details" | `SI/session-inspector.component.html:3`, `FE/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts:183` |
| 2 | Compact rail at right of focus area, shows agents and short metrics, "Tok" | `canvas-inspector-dock.component.ts:126-142`, `SI/session-inspector.component.html:27-42` |
| 3 | **Expand session details** button | `SI/session-inspector.component.ts:177-181`, `session-inspector.component.html:10-13` |
| 4 | **Resize session details** grip | `canvas-inspector-dock.component.ts:160` |
| 5 | **Compact session details** / Esc to make compact | `SI/session-inspector.component.html:79-82,113-120`, `canvas-inspector-dock.component.ts:185` |
| 6 | Narrow window: overlay; **Close session details** | `canvas-inspector-dock.component.ts:175-184,232-241`, `session-inspector.component.html:80-81` |
| 7 | "!" mark on rail for limit / needs-you | `session-inspector.component.html:16-24,54-55`, `PL/session-limit-summary.ts:46-52` |
| 8 | Header shows name, status, branch | `session-inspector.component.html:88-108` |
| 9 | Rename dialog, **Session name**, **Save** | `SI/inspector-session-actions.component.html:36-38,61-76` |
| 10 | **Organize** action | `inspector-session-actions.component.html:41-45` |
| 11 | **Stop session** only while running | `inspector-session-actions.component.html:49-55` |
| 12 | Narrow: **More session actions** menu | `inspector-session-actions.component.html:2-6` |
| 13 | **Session statistics**: Context, Tokens, Cost | `IS/inspector-session-stats.component.ts:48,64,114,171` |
| 14 | **Show per-model breakdown** when 2+ models | `IS/inspector-session-stats.component.ts:262,272-273` |
| 15 | Cache tile "Cache · ttl", 5m/1h, Expired, estimate text | `IS/inspector-cache-tile.component.ts:13-14,44,102,113` |
| 16 | "idle in" countdown for idle compaction | `IS/inspector-cache-tile.component.ts:115-125,131-133` |
| 17 | Agents columns Agent/Tokens/Cost/Time/Status, Total, No agents yet | `SI/inspector-agents-section.component.ts:127,135-139,233` |
| 18 | **Actions for** menu: Steer, Send to background, Stop | `SI/inspector-agent-actions-menu.component.ts:34-45,80` |
| 19 | Steer opens a message field | `inspector-agents-section.component.ts:188-200,401-403` |
| 20 | **Show N more** | `inspector-agents-section.component.ts:223` |
| 21 | Requests at top of inspector | `session-inspector.component.html:134-145` |
| 22 | **Review** / **Answer** buttons | `SI/inspector-request-panel.component.ts:289` |
| 23 | **Allow** / **Deny** / **Open lane** | `inspector-request-panel.component.ts:111,122,124-130` |
| 24 | "no longer pending" notice | `inspector-request-panel.component.ts:59-63` |
| 25 | **PLAN LIMITS** section, one tile per provider | `IS/inspector-limits-lanes.component.ts:12-25,33-44` |
| 26 | Tile: usage per window, progress bar, reset time | `PL/provider-lane-limit-tile.component.ts:16-29,50-62` |
| 27 | **Near limit** / **At limit** | `PL/lane-tiles.ts:210-211`, `PL/plan-limit-tiles.ts:338,403` |
| 28 | **Usage · Unavailable**, **Limits not tracked** | `PL/provider-lane-limit-tile.component.ts:44-48` |
| 29 | **Limits** alert in compact stats bar while near/at limit | `PL/limits-alert.component.ts:9-13,30`, `FE/chat-ui/src/lib/molecules/session/session-stats-summary.component.html:13-16` |
| 30 | **TASK** section: task ID, stage, N/M tasks | `SI/inspector-task-section.component.ts:89,92,146,152` |
| 31 | Task documents, preview, **Open**, **Close document preview**, No documents yet | `inspector-task-section.component.ts:184-225` |
| 32 | **GIT** section: branch, +/− lines, **Retry reading git status** | `SI/inspector-git-section.component.ts:45,60-67,74-78` |
| 33 | Linked sessions: This session / Continued from / Continued in; click opens | `IS/inspector-linked-sessions.component.ts:32-34`, `session-inspector.component.html:210-216` |
| 34 | **Lanes** tab strip; orchestrator tab; Active / Finished agents groups | `FE/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:145,164,366-384`, `FE/canvas/src/lib/canvas-detail/dock-overflow.ts:66-72` |
| 35 | Selected tab shows name, status, duration | `canvas-lane-tabs.component.ts:178-208` |
| 36 | Click a tab shows the lane; arrow keys | `canvas-lane-tabs.component.ts:182-186,495-497`, `FE/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:120` |
| 37 | "N more agents" opens **Agents** menu of hidden agents | `FE/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts:1-30 (doc),83,137-139`, `canvas-lane-tabs.component.ts:263` |

## apps/ptah-docs/src/content/docs/chat/display-panel.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Display is a right sidebar of the chat, per session | `FE/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts:35-41,239`, `FE/chat/src/lib/components/templates/chat-view.component.html:213-215` |
| 2 | Artifacts: self-contained page (dashboard, report, prototype), no network | `BE/vscode-lm-tools/src/lib/code-execution/mcp-core/artifact-tools.ts:8-14` |
| 3 | Files: Markdown, image, PDF | `FE/chat-ui/src/lib/organisms/display-panel/display-file-item.ts:1`, `display-panel.component.ts:259-261` |
| 4 | Ptah UI blocks: short summaries | `artifact-tools.ts:12`, `FE/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts:173` |
| 5 | **Nothing to show yet** | `FE/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts:197-200` |
| 6 | Shows only with content; **Display · N** tab | `display-sheet.component.ts:36-37,50,219-226,263` |
| 7 | **Displays** tab strip, arrow keys | `display-panel.component.ts:205-207,483-486` |
| 8 | **Collapse display** | `display-sheet.component.ts:152` |
| 9 | New dot on item tab | `display-panel.component.ts:224-229` |
| 10 | Overlay when narrow | `display-sheet.component.ts:39-41,68-75` |
| 11 | **Keep current view** text | `display-sheet.component.ts:127-136` |
| 12 | Artifact card: title, created time, **Open**, **Full screen** | `FE/chat-ui/src/lib/organisms/artifacts/artifact-card.component.ts:14-20,63,72` |
| 13 | Display chip states and **Open in display** / **Open latest** | `FE/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.ts:29-55` |
| 14 | **Detach** opens **PtahCode - Display** | `display-sheet.component.ts:140-146`, `EL/windows/display-window.ts:37,142`, `EL/config/product-identity.ts:1` |
| 15 | Rail "Display · N (separate window)", **Focus**, **Re-attach** | `chat-view.component.html:217-243` |
| 16 | Window shows active tab's display | `EL/windows/display-window.ts:3-7` |
| 17 | Closing Display window re-attaches | `FE/chat/src/lib/services/display-window/display-window-sync.service.ts:80,219-221` |
| 18 | Closes with main window; keeps bounds | `EL/windows/display-window.ts:260-265,365` |

## apps/ptah-docs/src/content/docs/chat/composer-and-turn-summary.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Send works during a turn; message is queued | `FE/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:508,517-518,1661` |
| 2 | **Queued messages** list above composer | `FE/chat/src/lib/components/molecules/queued-follow-ups/queued-follow-ups.component.ts:36,47`, `chat-view.component.html:197-207` |
| 3 | Status labels (Waiting to queue, Queuing…, Queued for the next turn, Runs when this turn finishes) | `queued-follow-ups.component.ts:133-143`, `FE/chat/src/lib/services/chat-store/follow-up-queue.service.ts:154` |
| 4 | **Withdraw** puts text back in composer | `queued-follow-ups.component.ts:1-6 (doc),71-79,145-149` |
| 5 | **Send now** (Codex) / **Interrupt & send** (Claude) | `queued-follow-ups.component.ts:57-64`, `follow-up-queue.service.ts:256-276` |
| 6 | Refused action leaves item queued with note | `follow-up-queue.service.ts:273-276` |
| 7 | Lane composer "N queued · last", **Edit** restores text | `FE/chat-ui/src/lib/molecules/lane-composer.component.ts:68-75,328-350` |
| 8 | Needs an existing session (send a prompt first) | `FE/chat/src/lib/components/molecules/peer-session-send/peer-session-send.component.ts:145` |
| 9 | **Peer** in status line under composer; tooltip | `peer-session-send.component.ts:44-52,154`, `chat-input.component.ts:531-545` |
| 10 | Dialog title, Target Peer Session, Message | `peer-session-send-dialog.component.ts:49,67,100` |
| 11 | Notice before sending: Consumes a turn, Model-mediated | `peer-session-send-dialog.component.ts:121-131` |
| 12 | **Send**, Accepted / Refused, Send another, Done | `peer-session-send-dialog.component.ts:166,173,233,241,264` |
| 13 | Incoming peer message row with "· self-reported" | `FE/chat/src/lib/components/molecules/lane-event/lane-event-row.component.html:52-54` |
| 14 | Rail card **Context N%**, "—" when unknown | `FE/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:836-845`, `FE/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:156` |
| 15 | Inspector Context metric | `IS/inspector-session-stats.component.ts:64` |
| 16 | **Turn summary** chip only when a terminal turn has files or tests | `FE/chat-ui/src/lib/molecules/turn-recap/turn-summary.model.ts:278,288`, `FE/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:132-138` |
| 17 | Pills (3 files, +42, −7, 2 tests passed, incomplete) | `turn-summary-chip.component.ts:66-68,259` |
| 18 | incomplete = aborted or errored | `turn-summary.model.ts:139-140` |
| 19 | Expanded cards Files/Lines/Tokens/Cost/Time/Tests; conditional ones | `turn-summary-chip.component.ts:69-70,283-318` |
| 20 | Esc collapses | `turn-summary-chip.component.ts:75,334` |
| 21 | **Changed files** / **Test results** headings | `turn-summary-chip.component.ts:164,170` |
| 22 | File row: status, path, counts; **Conflicted**; **Review** / **Resolve**; **Review all** | `FE/chat-ui/src/lib/molecules/turn-recap/turn-summary-files.component.ts:1-10 (doc),106,132,147,267-268` |
| 23 | Review opens the change set in the git dock | `FE/chat/src/lib/services/change-set/change-set-actions.service.ts:69-72`, `chat-transcript.component.ts:1109-1121` |
| 24 | May include changes made before the turn | `turn-summary-files.component.ts:71` |
| 25 | Tests: passed share, run rows, failure lines, **Full command** | `FE/chat-ui/src/lib/molecules/turn-recap/turn-summary-tests.component.ts:1-10 (doc),61,142` |

## apps/ptah-docs/src/content/docs/workspace/notifications-and-tray.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Bell in title bar; pop-ups (snackbar); announcer | `FE/chat/src/lib/components/templates/electron-shell.component.ts:382-387` |
| 2 | Bell title **Notifications**; label "Notifications, N need(s) your response" | `FE/notification-center/src/lib/notification-center.component.ts:27,143` |
| 3 | Panel heading **Notifications** | `notification-center.component.ts:36` |
| 4 | **Needs you** list, item shows type, session, workspace | `notification-center.component.ts:45-48` |
| 5 | Types: Question needs an answer / Permission required / Lane permission required | `notification-center.component.ts:114-116` |
| 6 | **Answer**, **Allow**, **Deny**; Session unavailable disabled reason | `FE/chat/src/lib/services/chat-attention-source.service.ts:194-197`, `notification-center.component.ts:85` |
| 7 | **Nothing needs your response** | `notification-center.component.ts:72` |
| 8 | **Recent notices**; "Session failed: …" + **Show in canvas** | `notification-center.component.ts:76`, `FE/chat/src/lib/services/chat-failed-turn-attention.service.ts:42-44` |
| 9 | Dismiss one notice; **No recent notices** | `notification-center.component.ts:81,90` |
| 10 | **Clear all notices** removes recent notices | `notification-center.component.ts:38`, `FE/core/src/lib/services/notification.service.ts:57-61` |
| 11 | Mute / Unmute notification sounds | `notification-center.component.ts:37` |
| 12 | **All clear** when both lists empty | `notification-center.component.ts:40-41` |
| 13 | Pop-ups only when panel closed; same buttons; dismiss; "+N more" opens panel | `FE/notification-center/src/lib/notification-snackbar.component.ts:27-32,46,62` |
| 14 | OS notification only when supported and window not focused | `BE/platform-electron/src/implementations/electron-host-attention-notifications.ts:38-43`, `EL/activation/bootstrap.ts:351-354` |
| 15 | Body: request label — session; burst "N requests need you" | `electron-host-attention-notifications.ts:76-81` |
| 16 | Click shows the window and routes to the request | `electron-host-attention-notifications.ts:84-86,118-128`, `EL/activation/bootstrap.ts:355-361` |
| 17 | Tray always created; Pause memory checkbox; Quit PtahCode | `EL/services/tray/tray.service.ts:5-7,70-71,139-152` |
| 18 | Pause memory writes `memory.enabled` (checked = false) | `tray.service.ts:22,37-39,109,143-146` |
| 19 | Tooltip PtahCode / "PtahCode — memory paused" | `tray.service.ts:72,120-124` |
| 20 | Saved in `~/.ptah/settings.json`; pauses other processes; menu refresh on file change | `tray.service.ts:22-35` |
| 21 | Link to Memory settings (`memory.enabled` documented there) | `apps/ptah-docs/src/content/docs/memory/settings.md:16` |

## Cross-links added
- `apps/ptah-docs/src/content/docs/canvas/index.md:67` — `- [Session details](/canvas/session-inspector/) ...` in **Next steps**.
- `apps/ptah-docs/src/content/docs/chat/index.md:44` — `- [Composer and turn summary](/chat/composer-and-turn-summary/) and the [Display panel](/chat/display-panel/)` in **Where to go next**.

## Sidebar request
| Slug | Label | Group |
|---|---|---|
| `canvas/session-inspector` | Session details | Orchestra Canvas (after the canvas overview) |
| `chat/display-panel` | Display panel | Chat (after Switching models; frontmatter `sidebar.order: 10`) |
| `chat/composer-and-turn-summary` | Composer and turn summary | Chat (after Display panel; frontmatter `sidebar.order: 11`) |
| `workspace/notifications-and-tray` | Notifications and tray | Workspace (after Workspace Restoration) |

## Decisions
1. **Change-set card left out.** In the transcript it renders only with `host="vscode"` in the VS Code branch (`chat-transcript.component.html:142-151`). Electron shows the Turn summary chip instead (`:132-138`). Rule 2 (Electron only) applies. **Open Source Control** is also VS Code-only (`change-set-card.component.ts:362-365`).
2. **Context usage ring left out of the composer page.** `ptah-context-ring` is used only in the Command Center overlay (`FE/command-center/src/lib/components/command-overlay.component.ts:146`), not in the composer. The page documents the "Context usage" value that the canvas rail card shows (`compact-session-activity.component.ts:836-845`) and the inspector Context metric.
3. **"Edit queued message"** is a lane-composer control (`lane-composer.component.ts:73`). The main composer uses **Withdraw**. Both are documented in their own places.
4. **Limits alert** renders in `ptah-session-stats-summary` collapsed mode, whose hosts are the Command Center and the harness builder, not the canvas. The page says "In the compact session stats bar" and does not name a host.
5. The OS notification title is the literal `'Ptah'` (`electron-host-attention-notifications.ts:78`), not `PtahCode`. The page does not quote the title.
6. Page title of the inspector page is "Session details" (the UI label). The file name keeps `session-inspector` as the brief asked.

## Clarifications Needed
- OS notification title `'Ptah'` vs product name `PtahCode` (Decision 5). This may be a product defect, not a docs gap.
