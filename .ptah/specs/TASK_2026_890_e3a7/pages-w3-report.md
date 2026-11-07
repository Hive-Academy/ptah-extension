# Lane W3 evidence report

Status: complete. Five new pages, three cross-link lines. No astro.config.mjs edit.
Abbreviations in paths: RRU = `libs/frontend/review-runs-ui/src/lib/components`,
GIT = `libs/frontend/git-ui/src/lib`, APPS = `libs/frontend/mcp-apps-page/src/lib`,
STM = `libs/frontend/chat/src/lib/components/molecules/send-to-messaging`,
RM = `libs/backend/remote-machines/src/lib`, SHELL = `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`.

## apps/ptah-docs/src/content/docs/reviews/index.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | **Reviews** tab opens route /review-runs | SHELL:291-298, `apps/ptah-extension-webview/src/app/app.routes.ts:177` |
| 2 | Page title **Review runs**, subtitle "Repository review attempts and coverage" | RRU/review-runs-page.component.ts:55-57 |
| 3 | Thoth → **Schedules** → **Review runs** link | `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts:137-143`, `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:378` |
| 4 | Header: last refresh, **Pause all publication**, **Review settings**, **Refresh** | RRU/review-runs-page.component.ts:41, 61, 72, 76-80 |
| 5 | **Repositories** list, click filters runs; badges Disabled/Paused/Dry-run/Live | RRU/review-repositories.component.ts:10, 13, 16; RRU/review-runs-page.component.ts:126-129 |
| 6 | **Runs** section, queued count, repository and state filters | RRU/review-runs-page.component.ts:138-171 |
| 7 | Row: PR number, owner/name, head SHA prefix, trigger, badge labels, Waiting/In progress/Finished | RRU/review-runs-list.component.ts:15, 20, 22, 24 |
| 8 | Failed stage + message; Automatic retries stopped; Retry after | RRU/review-runs-list.component.ts:16-18 |
| 9 | Arrow keys move between rows | RRU/review-runs-list.component.ts:14, 36-42 |
| 10 | No matching runs → **Clear filters** | RRU/review-runs-page.component.ts:196-205 |
| 11 | **No review runs yet**, runs appear after the next poll | RRU/review-runs-page.component.ts:209-211 |
| 12 | Message table (poll failed / offline / not loaded / no lanes) and buttons | RRU/review-runs-page.component.ts:92-99, 106-110, 115-117, 122, 187 |
| 13 | Detail title "PR # … review", repo, SHA, attempt, state, Close, Escape | RRU/review-run-detail.component.ts:15-19, 83 |
| 14 | Stage timeline: stage labels, state, duration, lens scope | RRU/review-run-detail.component.ts:30-35, 79 |
| 15 | Coverage and lanes: Lens family, Verifier family, weaker-evidence badge, coverage-limited alert | RRU/review-run-detail.component.ts:42-48 |
| 16 | Findings table columns, status/lens filters, sort by column | RRU/review-findings-table.component.ts:25-29, 37-41, 69 |
| 17 | Walkthrough preview and Artifacts sections; "unavailable" messages | RRU/review-run-detail.component.ts:57-58; RRU/review-findings-table.component.ts:32 |
| 18 | Rerun as dry-run (local preview) / Rerun live (COMMENT review + inline comments) | RRU/review-run-detail.component.ts:50-53, 61 |
| 19 | Live rerun dialog needs the permission check box; **Start live rerun** | RRU/review-run-detail.component.ts:61; RRU/review-confirm-dialog.component.ts:12-16 |
| 20 | Rerun live disabled with no token or with global pause | RRU/review-run-detail.component.ts:53 |
| 21 | Drawer title, "Settings apply to the next run.", **Save review settings** | RRU/review-settings-drawer.component.html:16-19, 155 |
| 22 | Repository controls: Enable review polling, Keep this repository in dry-run, Pause publication for this repository, Remove | RRU/review-repositories-editor.component.ts:28, 37, 48, 52 |
| 23 | Add repository (owner/name) + **Add repository** | RRU/review-repositories-editor.component.ts:65, 81 |
| 24 | New repository: polling off, dry-run on | RRU/review-settings-drawer.component.ts:80-84 |
| 25 | Validation errors (invalid owner/name, already added) | RRU/review-settings-drawer.component.ts:57-75 |
| 26 | Fork PRs excluded; CodeRabbit stays enabled | RRU/review-repositories-editor.component.ts:90-91 |
| 27 | "Connect a bot token to enable live publication." | RRU/review-repositories-editor.component.ts:53-55 |
| 28 | Clear dry-run → **Enable live publication?** dialog with permissions | RRU/review-settings-drawer.component.ts:102-111; RRU/review-settings-drawer.component.html:171-180 |
| 29 | Permission text (Pull requests RW, Contents R, Metadata R) | RRU/review-confirm-dialog.component.ts:13 |
| 30 | Maintainer allowlist labels | RRU/review-settings-drawer.component.html:58-82 |
| 31 | Minimum severity shown only; numeric ranges 1-1440, 0-100, 0-1, 1-6 | RRU/review-settings-drawer.component.html:84-125 |
| 32 | GitHub bot identity: Connect/Replace bot token, Save token, Verify connection, Remove connection | RRU/review-bot-identity.component.ts:10, 37-39, 54, 61, 69 |
| 33 | Connected as / scopes / connection time; "No bot connected…" | RRU/review-bot-identity.component.ts:18-27, 33 |
| 34 | Replace and Remove dialogs; live publication stops until another token | RRU/review-settings-drawer.component.html:182-200 |
| 35 | Plaintext token warning | RRU/review-bot-identity.component.ts:11-15 |
| 36 | Pause toggle in header and drawer; resume dialog; drawer dialog needs the permission box | RRU/review-runs-page.component.ts:41, 243-251, 270-283; RRU/review-settings-drawer.component.html:131-137, 160-169 |
| 37 | The token is used for publication | RRU/review-settings-drawer.component.html:196 |

## apps/ptah-docs/src/content/docs/git/branches-and-review-tools.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Branch button in Git dock header opens the picker | GIT/git-dock/git-dock-header.component.ts:102-127 |
| 2 | **Branch details** info button | GIT/git-dock/git-dock-header.component.ts:122, 131; GIT/branch-picker/branch-details-popover.component.ts:24 |
| 3 | Search branches…, Recent, Local (↑/↓), Remote, New branch, Create | GIT/branch-picker/branch-picker-dropdown.component.ts:69-70, 249, 260-273, 276, 290-301 |
| 4 | Current local branch disabled; remote switch tracks | GIT/branch-picker/branch-picker-dropdown.component.ts:28, 263, 279, 412 |
| 5 | Create creates and switches; Enter; "Could not create branch" | GIT/branch-picker/branch-picker-dropdown.component.ts:296, 461-469 |
| 6 | Overwrite warning and file list | GIT/branch-picker/branch-picker-dropdown.component.ts:90, 114 |
| 7 | Stash & switch; notice "Changes stashed as … find them in Stashes" | GIT/branch-picker/branch-picker-dropdown.component.ts:174, 228-232 |
| 8 | Discard & switch…, confirm text, Discard changes, Back, Cancel | GIT/branch-picker/branch-picker-dropdown.component.ts:133, 151, 159, 182, 196 |
| 9 | **Pull request** panel in Task tab | GIT/task/task-worktree-view.component.ts:193-197; GIT/task/task-pr-panel.component.ts:123 |
| 10 | Number/title, state badges, review decision labels | GIT/task/task-pr-panel.component.ts:33-35, 51-69, 127, 135 |
| 11 | Checks passing/failing/pending, No checks | GIT/task/task-pr-panel.component.ts:139-160 |
| 12 | **Open PR** opens the browser | GIT/task/task-pr-panel.component.ts:109-112, 175 |
| 13 | Reads again at most every 60 s while the tab shows | GIT/task/task-worktree-view.component.ts:46, 74-75 |
| 14 | Unavailable lines table | GIT/task/task-pr-panel.component.ts:21-29 |
| 15 | Conflict banner above review tabs for merge/rebase/cherry-pick | GIT/review-shell/review-shell.component.ts:195-199; GIT/conflict/conflict-banner.component.ts:31-35, 131-135 |
| 16 | Title "X in progress" + count; Conflicted files list | GIT/conflict/conflict-banner.component.ts:184-190 |
| 17 | Open in editor / Open folder (delete/modify, symlink, submodule) | GIT/conflict/conflict-banner.component.ts:38-45, 219-220 |
| 18 | "No external editor was found…" | GIT/conflict/conflict-banner.component.ts:250 |
| 19 | Ask agent to resolve sends a prompt to the active session | GIT/conflict/conflict-banner.component.ts:145-147, 276 |
| 20 | Continue only when no conflicts; Abort with confirm | GIT/conflict/conflict-banner.component.ts:148-150, 266, 285, 315-319 |
| 21 | Open in button locations (dock, Task tab, file header, spot editor) | GIT/git-dock/git-dock-header.component.ts:164; GIT/task/task-worktree-view.component.ts:185; GIT/review-canvas/file-section-header.component.ts:292; GIT/spot-editor/spot-editor.component.ts:291 |
| 22 | Primary label "Open in X"; caret "Choose where to open" | GIT/open-in/open-in-button.component.ts:95, 176, 181 |
| 23 | Remembers the last editor | GIT/open-in/open-in-button.component.ts:27, 219, 281 |
| 24 | "No supported editor found on this machine" | GIT/open-in/open-in-button.component.ts:28 |
| 25 | Terminal dropped for files | GIT/open-in/open-in-button.component.ts:158-161 |
| 26 | Spot editor = one file, not an IDE | GIT/spot-editor/spot-editor.component.ts:61 |
| 27 | Edit in file header opens editable | GIT/review-canvas/file-section-header.component.ts:277, 288; GIT/spot-editor/spot-editor.component.ts:65-67 |
| 28 | Unsaved badge, Save, Mod-S, Back to review | GIT/spot-editor/spot-editor.component.ts:129, 142-148, 205; GIT/spot-editor/codemirror-setup.ts:197-201 |
| 29 | Edit button in spot header; read-only cases | GIT/spot-editor/spot-editor.component.ts:65-69, 163 |
| 30 | Markdown Preview/Source; 512 KB limit | GIT/spot-editor/spot-editor.component.ts:167-188, 371 |
| 31 | Discard unsaved dialog, Keep editing; disk-change reload/stale; Reload; save-conflict Overwrite | GIT/spot-editor/spot-editor.component.ts:72-77, 83-84, 234, 494-515 |
| 32 | Comment button → composer Side New/Old, From line, To line, Comment, Add draft | GIT/review-canvas/file-section-header.component.ts:261, 272; GIT/review-canvas/file-diff-section.component.ts:229-230, 275-338 |
| 33 | Draft comments bar in canvas footer, "N draft comments", list, remove ✕ | GIT/review-canvas/review-canvas.component.ts:206; GIT/review-canvas/draft-comments-bar.component.ts:24-26, 62, 65, 81, 138-140 |
| 34 | Send to agent; a failure keeps the drafts | GIT/review-canvas/draft-comments-bar.component.ts:28-30, 110 |

## apps/ptah-docs/src/content/docs/mcp-and-skills/apps.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | **Apps** tab, route /apps (Electron) | SHELL:264-274; `apps/ptah-extension-webview/src/app/app.routes.ts:153-158` |
| 2 | Agent builds interactive apps; replies next to the app panel | APPS/apps-system-prompt.ts:12, 15 |
| 3 | Conversation for this page only, coding chat unaffected | APPS/components/apps-page.component.ts:151 |
| 4 | Three-column layout; stacks when narrow; divider hidden | APPS/components/apps-page.component.ts:35-41 |
| 5 | State kept when you leave the tab, per workspace | APPS/components/apps-page.component.ts:21-24 |
| 6 | Composer; Enter sends; Shift+Enter; Send | APPS/components/apps-page.component.ts:217-218, 250, 449-452 |
| 7 | Built with `ptah_surface_update` | APPS/apps-system-prompt.ts:15 |
| 8 | No app yet | APPS/components/apps-surface-panel.component.ts:266-268 |
| 9 | Stop disabled when no turn runs | APPS/components/apps-page.component.ts:228-237 |
| 10 | Permission and question cards in the conversation | APPS/components/apps-transcript.component.ts:107, 114 |
| 11 | New conversation | APPS/components/apps-page.component.ts:153-162 |
| 12 | Form submit goes to the agent as a message; Last submitted at | APPS/apps-system-prompt.ts:16, 28; APPS/components/apps-surface-panel.component.ts:249-252 |
| 13 | Selection read by the agent | APPS/apps-system-prompt.ts:17, 24 |
| 14 | Open apps tabs when more than one app; arrows, Home, End | APPS/components/apps-surface-panel.component.ts:166-168, 408-425 |
| 15 | "This app could not be shown." | APPS/components/apps-surface-panel.component.ts:30 |
| 16 | Divider drag and arrow keys; Shift for larger steps | APPS/components/apps-page.component.ts:59-60, 263-265, 403 |
| 17 | App panel minimum 360 px; width saved with other panel widths | APPS/components/apps-page.component.ts:45-48, 55, 304 |

## apps/ptah-docs/src/content/docs/automation/messaging/send-a-session.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | Hand off to a Telegram/Discord/Slack binding; tab read-only; not a share | STM/send-to-messaging.component.ts:38-44, 286-293 |
| 2 | Picker text "takes over this tab… until you resolve it back" | STM/handoff-binding-picker.component.ts:54-55 |
| 3 | Needs an approved binding and a running adapter | STM/handoff-binding-picker.component.ts:89, 171 |
| 4 | Needs a saved turn | STM/send-to-messaging.component.ts:529 |
| 5 | Session actions (⋮) on the rail card; item in the menu | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:281-294, 391` |
| 6 | **Hand off session to…** label | STM/send-to-messaging.component.ts:122, 163 |
| 7 | Confirm text and **Continue** | STM/handoff-binding-picker.component.ts:138, 224 |
| 8 | "Attached to" platform | STM/send-to-messaging.component.ts:462 |
| 9 | Resolve back to webview; "Driven from … · read-only here"; no confirm; "Resolved back to webview" | STM/send-to-messaging.component.ts:51-52, 87-88, 482-484, 498 |
| 10 | Disabled item with reason; reason strings | STM/send-to-messaging.component.ts:49-50, 243-252, 263 |
| 11 | Picker messages table | STM/handoff-binding-picker.component.ts:89, 171; STM/send-to-messaging.component.ts:527, 529 |
| 12 | "Gateway tab" = Thoth **Messaging** tab | `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:381`; existing page `automation/messaging/index.md` ("Open the gateway") |

## apps/ptah-docs/src/content/docs/workspace/remote-machines.md
| # | Claim (short) | Evidence (path:line) |
|---|---|---|
| 1 | No screen to add, pair, or manage machines | `libs/frontend/machines-ui/src/index.ts:1` (`export {};`); no `machines:` caller in `libs/frontend` or `apps/ptah-extension-webview/src` (grep) |
| 2 | A service connects to workers over SSH | RM/ssh-stdio-transport.ts:5-28; `libs/backend/vscode-core/src/messaging/rpc-handler.ts:99` |
| 3 | Registry `~/.ptah/remote-machines.json` | RM/machine-registry.ts:46 |
| 4 | Connects to each registered machine at start; warning on failure | `apps/ptah-electron/src/activation/wire-runtime.ts:346-371` |
| 5 | `ssh` + alias from `~/.ssh/config`; BatchMode; worker port 41873 on 127.0.0.1 | RM/ssh-stdio-transport.ts:7, 13-28; RM/ssh-alias.ts:20 |
| 6 | Tokens in secret storage; plain text when the keyring is unavailable | RM/machine-token-store.ts:5-25 |

## Cross-links added
- `apps/ptah-docs/src/content/docs/git/index.mdx:33` → `/git/branches-and-review-tools/`
- `apps/ptah-docs/src/content/docs/automation/messaging/index.md:59` → `/automation/messaging/send-a-session/`
- `apps/ptah-docs/src/content/docs/mcp-and-skills/index.md:28` → `/mcp-and-skills/apps/`

## Sidebar request
| Slug | Label | Group |
|---|---|---|
| `reviews` | Reviews | New top-level group "Reviews" (or under Git, after Worktrees) |
| `git/branches-and-review-tools` | Branches and review tools | Git & Version Control, after Worktrees |
| `mcp-and-skills/apps` | Apps | MCP & Skills, after Third-party MCP |
| `automation/messaging/send-a-session` | Hand off a session | Automation › Messaging, after Pairing and approvals |
| `workspace/remote-machines` | Remote machines | Workspace, last |

## Decisions
- **Remote machines (B-78):** I searched `libs/frontend`, `apps/ptah-extension-webview/src`, the Electron menu and services, the MCP tool library, and deep-link handlers. No user path exists: no renderer caller of `machines:*`, no menu item, no MCP tool, no protocol handler. The page states what the desktop host does (registry file, reconnect at start, SSH transport, token storage). It says plainly that the app has no screen to manage machines. It has no roadmap words.
- **Findings / Walkthrough / Artifacts:** the page component does not pass `findings` to the run detail (RRU/review-runs-page.component.ts:221-226). Walkthrough preview and Artifacts are static "unavailable" texts (RRU/review-run-detail.component.ts:57-58). The page lists the sections and says that a section without data shows a message. It does not claim content in them.
- **"Gateway tab" wording:** the UI strings say "Gateway tab", but the Thoth tab label is **Messaging**. The page quotes the strings verbatim and explains the mapping once.
- The **Effective repository configuration** section (static unavailable text, RRU/review-settings-drawer.component.html:141-144) is left out.
- `reviews/index.md` starts a new docs folder. No `sidebar: order` because sibling pages do not use it.
- Link check (`_linkcheck.mjs`): my pages and cross-links have no bad links. One bad link is in a file of another lane (`memory/timeline-and-corpus.md:104 -> /memory/maintenance/`). I did not touch it.

## Clarifications Needed
- The hand-off picker strings say "Gateway tab", but the Thoth tab label is **Messaging**. This is a code-side wording mismatch, not a docs issue.
