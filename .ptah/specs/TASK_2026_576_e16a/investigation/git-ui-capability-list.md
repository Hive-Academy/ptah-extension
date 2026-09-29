# git-ui Capability List (read-only audit)

Audit of every user-facing capability in `libs/frontend/git-ui`. A capability is something a user can see or do: a button, a toggle, a keyboard action, an empty/error state, or an auto-behaviour. Component templates are inline in each `.component.ts`; the cited line is the template line with the `(click)` / input / rendered state, or the handler line.

RPC methods are verified against `libs/frontend/git-ui/src/lib/services/*.ts`.

## git-dock.component.ts (`git-dock/`)

| Capability (user-visible)                                                                  | file:line                                            | RPC method(s) or push message                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Auto-arms git status + branch listening on dock mount (eager fetch, auto-refresh via push) | git-dock/git-dock.component.ts:236-238               | `git:info`, `git:branches`, `git:stashList`, `git:lastCommit`; pushes `git:status-update` |
| File row click opens the file in an external editor                                        | git-dock/git-dock.component.ts:89 (handler :248-257) | `editor:openFile`                                                                         |
| Diff tab bar — click a tab to activate it                                                  | git-dock/git-dock.component.ts:168                   | none (shows already-fetched diff)                                                         |
| Diff tab bar — close button per tab                                                        | git-dock/git-dock.component.ts:184                   | none                                                                                      |
| Diff tabs keyboard — `Delete` closes the active tab                                        | git-dock/git-dock.component.ts:273-277               | none                                                                                      |
| Diff tabs keyboard — `ArrowLeft`/`ArrowRight` cycle tabs                                   | git-dock/git-dock.component.ts:278-292               | none                                                                                      |
| "Show changed files" button (rail is collapsed, no tab open)                               | git-dock/git-dock.component.ts:114-121               | none (layout toggle)                                                                      |
| Loading repository state                                                                   | git-dock/git-dock.component.ts:104-105               | none (waits on `git:info`)                                                                |
| "The active workspace is not a Git repository." state                                      | git-dock/git-dock.component.ts:106-107               | none                                                                                      |
| "Source control is collapsed." state                                                       | git-dock/git-dock.component.ts:113                   | none                                                                                      |
| File view retry button (read-only file tab)                                                | git-dock/git-dock.component.ts:202                   | `file:viewContent`                                                                        |
| Diff view retry button                                                                     | git-dock/git-dock.component.ts:210                   | `git:diffFile`                                                                            |

## git-dock-header.component.ts (`git-dock/`)

| Capability (user-visible)                                                                                   | file:line                                     | RPC method(s) or push message                                                    |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| Toggle source-control rail (show/hide)                                                                      | git-dock/git-dock-header.component.ts:74      | none (layout)                                                                    |
| Current branch button — opens branch picker                                                                 | git-dock/git-dock-header.component.ts:92      | none (data via `git:branches`)                                                   |
| Branch details (info) button — opens details popover                                                        | git-dock/git-dock-header.component.ts:103     | none (see popover)                                                               |
| Stash button with count — opens stash popover                                                               | git-dock/git-dock-header.component.ts:129     | `git:stashList` (load-on-open)                                                   |
| Open-in workspace editor button                                                                             | git-dock/git-dock-header.component.ts:140-144 | `editor:openWorkspace` (+ `editor:detectTargets`, `settings:get`/`settings:set`) |
| Fetch button (spinner while in flight)                                                                      | git-dock/git-dock-header.component.ts:152     | `git:fetch`                                                                      |
| Pull button, shows `↓N behind`                                                                              | git-dock/git-dock-header.component.ts:172     | `git:pull`                                                                       |
| Push button, shows `↑N ahead`                                                                               | git-dock/git-dock-header.component.ts:192     | `git:push`                                                                       |
| Fetch/Pull/Push disabled while one is in flight; status line after ("Fetch completed." / "Fetch failed." …) | git-dock/git-dock-header.component.ts:202-218 | none (result of the RPC above)                                                   |
| Editor-launch failure/success status line                                                                   | git-dock/git-dock-header.component.ts:210-218 | `editor:openFile` / `editor:openWorkspace`                                       |

## source-control-panel.component.ts (`source-control/`)

| Capability (user-visible)                                                      | file:line                                                                   | RPC method(s) or push message    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------- |
| Commit message textarea                                                        | source-control/source-control-panel.component.ts:117-124                    | none                             |
| Commit button (disabled until message + staged files); "Committing..." spinner | source-control/source-control-panel.component.ts:125-136                    | `git:commit`                     |
| Staged Changes section collapse toggle                                         | source-control/source-control-panel.component.ts:172-188                    | none                             |
| Unstage all button                                                             | source-control/source-control-panel.component.ts:190-202 (handler :479-481) | `git:unstage` (paths `['.']`)    |
| Stage all button                                                               | source-control/source-control-panel.component.ts:259-271 (handler :475-477) | `git:stage` (paths `['.']`)      |
| Changes section toggle                                                         | source-control/source-control-panel.component.ts:241-257                    | none                             |
| "No staged changes" empty state                                                | source-control/source-control-panel.component.ts:222-229                    | none                             |
| "No changes" empty state                                                       | source-control/source-control-panel.component.ts:285-292                    | none                             |
| "Git status is unavailable…" state (status too large to read)                  | source-control/source-control-panel.component.ts:139-150                    | none (error state of `git:info`) |
| Folder collapse/expand in file tree                                            | source-control/source-control-panel.component.ts:310-332                    | none                             |

## source-control-file.component.ts (`source-control/`)

| Capability (user-visible)                     | file:line                                                      | RPC method(s) or push message                       |
| --------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| Row click opens the diff for that file        | source-control/source-control-file.component.ts:55-64          | none (opens a tab; tab fetches `git:diffFile`)      |
| Stage button (inline, hover)                  | source-control/source-control-file.component.ts:106-117        | `git:stage`                                         |
| Unstage button (inline, hover)                | source-control/source-control-file.component.ts:92-103         | `git:unstage`                                       |
| Discard changes button (inline, hover)        | source-control/source-control-file.component.ts:121-132        | `git:discard`                                       |
| `+N / −N` change-count display                | source-control/source-control-file.component.ts:140-142        | none                                                |
| Open-in icon button per row                   | source-control/source-control-file.component.ts:143-149        | `editor:openFile` (+ `settings:get`/`settings:set`) |
| Status icon + badge (M/A/D/U/R/C) with colour | source-control/source-control-file.component.ts:66-70, 152-157 | none                                                |

## worktree-section.component.ts (`worktree/`)

| Capability (user-visible)                                                                                     | file:line                                                                                      | RPC method(s) or push message                                                 |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Worktrees section disclosure (collapsible)                                                                    | worktree/worktree-section.component.ts:40-48                                                   | `git:worktrees` (auto-load by service)                                        |
| Refresh worktrees button                                                                                      | worktree/worktree-section.component.ts:55-68 (handler :301-304)                                | `git:worktrees`                                                               |
| "Add worktree" button (opens inline form)                                                                     | worktree/worktree-section.component.ts:69-77 (handler :307-313)                                | none (form toggle)                                                            |
| Add form — branch name + custom path inputs, "Create new branch" checkbox (`Enter` submits, `Escape` cancels) | worktree/worktree-section.component.ts:85-113                                                  | `git:addWorktree`                                                             |
| Create button                                                                                                 | worktree/worktree-section.component.ts:118-128 (handler :315-334)                              | `git:addWorktree`                                                             |
| Worktree row click — switches active workspace to that worktree                                               | worktree/worktree-section.component.ts:150-157 (handler :296-298)                              | none (ElectronLayoutService.addFolderByPath; underlying host call UNVERIFIED) |
| Active/main badges on rows                                                                                    | worktree/worktree-section.component.ts:174-185                                                 | none                                                                          |
| Remove worktree button (per non-main row)                                                                     | worktree/worktree-section.component.ts:193-203 (handler :344-348)                              | none (opens confirm)                                                          |
| Confirm remove — Remove / Force / Cancel                                                                      | worktree/worktree-section.component.ts:220-244 (handler :350-369)                              | `git:removeWorktree`                                                          |
| "No worktrees found" empty state; loading spinner                                                             | worktree/worktree-section.component.ts:141-147                                                 | `git:worktrees`                                                               |
| Auto-reload on backend worktree change                                                                        | worktree/worktree-section.component.ts (via WorktreeService, services/worktree.service.ts:298) | push `git:worktreeChanged`                                                    |

## stash-popover.component.ts (`stash/`)

| Capability (user-visible)                                             | file:line                                         | RPC method(s) or push message                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Stash list loads when popover opens; age + message + branch per entry | stash/stash-popover.component.ts:208-212          | `git:stashList`                                                                        |
| Select a stash entry → shows its files                                | stash/stash-popover.component.ts:74-94            | `git:stashShow`                                                                        |
| Apply stash                                                           | stash/stash-popover.component.ts:119-128          | `git:stashApply`                                                                       |
| Pop stash                                                             | stash/stash-popover.component.ts:129-138          | `git:stashPop`                                                                         |
| Drop stash with inline confirm ("Drop this stash permanently?")       | stash/stash-popover.component.ts:139-148, 101-117 | `git:stashDrop`                                                                        |
| Click a file in a stash → opens parent-vs-stash diff tab              | stash/stash-popover.component.ts:158-172          | `git:reviewChanges`, `git:reviewFile` (services/git-stash.service.ts:421-423, 377-379) |
| "No stashes." empty state; "No file changes." empty state             | stash/stash-popover.component.ts:67-68, 174-176   | `git:stashList` / `git:stashShow`                                                      |
| Error banner; "Loading stashes…" state                                | stash/stash-popover.component.ts:62-64, 65-66     | none                                                                                   |
| Close on outside click / `Escape`                                     | stash/stash-popover.component.ts:52-53            | none                                                                                   |

## branch-picker-dropdown.component.ts (`branch-picker/`)

| Capability (user-visible)                                                      | file:line                                                                   | RPC method(s) or push message |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------- |
| Branch search input (client-side filter)                                       | branch-picker/branch-picker-dropdown.component.ts:32-38                     | none                          |
| Recent / Local / Remote branch lists; click to check out                       | branch-picker/branch-picker-dropdown.component.ts:60-92 (handler :158-166)  | `git:checkout`                |
| Force-checkout confirm when the tree is dirty ("Discard changes and checkout") | branch-picker/branch-picker-dropdown.component.ts:39-52 (handler :167-170)  | `git:checkout` (force)        |
| New branch creation input + Create button (`Enter` submits)                    | branch-picker/branch-picker-dropdown.component.ts:94-110 (handler :171-182) | `git:checkout` (createNew)    |
| Ahead/behind arrows per local branch                                           | branch-picker/branch-picker-dropdown.component.ts:76-81                     | none                          |
| Checkout error banner                                                          | branch-picker/branch-picker-dropdown.component.ts:53-55                     | none                          |
| Close on outside click / `Escape`                                              | branch-picker/branch-picker-dropdown.component.ts:20-22                     | none                          |

## branch-details-popover.component.ts (`branch-picker/`)

| Capability (user-visible)                                                                  | file:line                                               | RPC method(s) or push message                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------- |
| Branch details popover: current branch, stash count, last commit (hash · subject · author) | branch-picker/branch-details-popover.component.ts:24-31 | `git:branches`, `git:stashList`, `git:lastCommit` |
| First remote name + fetch URL display                                                      | branch-picker/branch-details-popover.component.ts:32-36 | `git:remotes`                                     |
| Auto-refresh remotes when popover opens                                                    | branch-picker/branch-details-popover.component.ts:47-51 | `git:remotes`                                     |
| Close on `Escape`                                                                          | branch-picker/branch-details-popover.component.ts:16    | none                                              |

## diff-view.component.ts (`diff-view/`)

| Capability (user-visible)                                                    | file:line                                                      | RPC method(s) or push message                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| Monaco diff editor (side-by-side or inline)                                  | diff-view/diff-view.component.ts:1214-1259                     | none (content from `git:diffFile`)                       |
| Hunk toolbar — Previous / Next hunk                                          | diff-view/diff-view.component.ts:281-319                       | none (selection only)                                    |
| Hunk toolbar — Stage hunk / Unstage hunk / Discard hunk                      | diff-view/diff-view.component.ts:321-343 (handler :1751-1766)  | `git:applyHunks` (services/diff-tabs.service.ts:613-615) |
| In-editor hunk action cluster (Monaco content widget on the selected hunk)   | diff-view/diff-view.component.ts:595-625 (handler :1751-1766)  | `git:applyHunks`                                         |
| Glyph-margin click selects a hunk (click on a non-hunk line does nothing)    | diff-view/diff-view.component.ts:1513-1526                     | none                                                     |
| Inline / side-by-side layout toggle (persisted preference)                   | diff-view/diff-view.component.ts:352-370                       | `settings:get`/`settings:set` (`diff.renderSideBySide`)  |
| Retry button — re-read this comparison                                       | diff-view/diff-view.component.ts:372-382                       | `git:diffFile` (via DiffTabsService)                     |
| Overlay retry button on git read failure                                     | diff-view/diff-view.component.ts:463-470                       | `git:diffFile`                                           |
| Discard-hunk confirmation dialog (Cancel / Discard hunk)                     | diff-view/diff-view.component.ts:522-567 (handlers :1769-1778) | `git:applyHunks` (revert)                                |
| Apply error banner + dismiss button                                          | diff-view/diff-view.component.ts:393-415                       | none (result of `git:applyHunks`)                        |
| "Binary file — diff not shown" overlay                                       | diff-view/diff-view.component.ts:472-479                       | none                                                     |
| Persistent error overlay with detail + retry                                 | diff-view/diff-view.component.ts:443-471                       | `git:diffFile`                                           |
| "Loading diff editor…" / "Failed to load diff editor" states                 | diff-view/diff-view.component.ts:420-436                       | none                                                     |
| Status chips: "refreshing…", "stale", "error"                                | diff-view/diff-view.component.ts:229-247                       | none (push-driven revalidation)                          |
| Chrome chip: "new file", "deleted", "binary", "no changes", "renamed from …" | diff-view/diff-view.component.ts:221-227, 210-214              | none                                                     |
| Hunk position label ("Hunk 2 of 7")                                          | diff-view/diff-view.component.ts:298-302                       | none                                                     |

## file-view.component.ts (`file-view/`)

| Capability (user-visible)                                                             | file:line                                                            | RPC method(s) or push message                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| Read-only Monaco file viewer                                                          | file-view/file-view.component.ts:301-331                             | `file:viewContent` (services/file-view-reader.service.ts:68-80) |
| Markdown Preview / Source toggle (disabled over 512 KB)                               | file-view/file-view.component.ts:52-71                               | none                                                            |
| "Preview is disabled for files over 512 KB." note                                     | file-view/file-view.component.ts:144-150                             | none                                                            |
| Retry button on read error                                                            | file-view/file-view.component.ts:127-133                             | `file:viewContent`                                              |
| Blocked state (unsupported path / outside roots …) with reason                        | file-view/file-view.component.ts:102-119                             | none (refusal of `file:viewContent`)                            |
| Open-in button in blocked state + confirmation dialog ("Open outside the workspace?") | file-view/file-view.component.ts:110-117, 153-192 (handler :287-292) | `editor:openFile`                                               |
| "Loading file…" state; "Read-only" badge                                              | file-view/file-view.component.ts:91-101, 50                          | none                                                            |

## git-review-toolbar.component.ts (`review/`)

| Capability (user-visible)                                                   | file:line                                    | RPC method(s) or push message                                |
| --------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| Working tree / Branch review mode toggle                                    | review/git-review-toolbar.component.ts:19-31 | none (mode switch)                                           |
| Base branch select                                                          | review/git-review-toolbar.component.ts:36-46 | `git:reviewChanges` (services/git-review.service.ts:113-115) |
| Head select (HEAD or a local branch)                                        | review/git-review-toolbar.component.ts:49-60 | `git:reviewChanges`                                          |
| Files-changed summary ("N files changed", +additions / −deletions / binary) | review/git-review-toolbar.component.ts:61-74 | none (result of `git:reviewChanges`)                         |

## git-review-panel.component.ts (`review/`)

| Capability (user-visible)                                   | file:line                                                       | RPC method(s) or push message          |
| ----------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| "Loading review…" state                                     | review/git-review-panel.component.ts:64-75                      | none                                   |
| Review error state                                          | review/git-review-panel.component.ts:76-83                      | none (error of `git:reviewChanges`)    |
| "No files changed between these branches." empty state      | review/git-review-panel.component.ts:84-90                      | `git:reviewChanges`                    |
| Filter files input (list + tree filter)                     | review/git-review-panel.component.ts:116-122                    | none                                   |
| "No matching changed files." empty state                    | review/git-review-panel.component.ts:100-109                    | none                                   |
| Tree folder collapse/expand                                 | review/git-review-panel.component.ts:134-141 (handler :232-237) | none                                   |
| Tree file click — scroll to and expand that file's diff row | review/git-review-panel.component.ts:151-164 (handler :239-249) | `git:reviewFile` (via `review.expand`) |

## git-review-file-row.component.ts (`review/`)

| Capability (user-visible)                                               | file:line                                                         | RPC method(s) or push message                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Expand/collapse the file's inline diff                                  | review/git-review-file-row.component.ts:44-51                     | `git:reviewFile` (services/git-review.service.ts:163-165) |
| Status badge (Added/Modified/Deleted/Renamed/Copied)                    | review/git-review-file-row.component.ts:70-76                     | none                                                      |
| Binary-file badge and "Binary files cannot be displayed as text." state | review/git-review-file-row.component.ts:77-88, 121-131            | none                                                      |
| +N/−N counts                                                            | review/git-review-file-row.component.ts:90-93                     | none                                                      |
| "Viewed" checkbox (marks the row viewed; dims it)                       | review/git-review-file-row.component.ts:95-104 (handler :275-280) | none (local state)                                        |
| Open-in icon button per row                                             | review/git-review-file-row.component.ts:105-118                   | `editor:openFile`                                         |
| Inline diff (read-only; staging disabled by design)                     | review/git-review-file-row.component.ts:132-141                   | none (`git:reviewChanges`/`git:reviewFile` feed it)       |
| "Loading file diff…" state                                              | review/git-review-file-row.component.ts:142-154                   | `git:reviewFile`                                          |

## open-in-button.component.ts (`open-in/`)

| Capability (user-visible)                                        | file:line                                                    | RPC method(s) or push message                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Primary "Open in <editor>" button (emits to host; host launches) | open-in/open-in-button.component.ts:38-65 (handler :176-183) | none directly — parent routes to `editor:openFile`/`editor:openWorkspace` |
| Caret + "Choose where to open" menu per detected editor          | open-in/open-in-button.component.ts:72-112                   | none (targets from `editor:detectTargets`)                                |
| Remembers the last chosen editor across sessions                 | open-in/open-in-button.component.ts:238-270                  | `settings:get`, `settings:set` (`editorLauncher.lastTarget`)              |
| Disabled state: "No supported editor found on this machine"      | open-in/open-in-button.component.ts:45-49, 28                | none                                                                      |
| Close menu on outside click / `Escape`                           | open-in/open-in-button.component.ts:35, 51                   | none                                                                      |

## rail-resize-handle.component.ts (`git-dock/`)

| Capability (user-visible)                                                         | file:line                                        | RPC method(s) or push message |
| --------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| Drag to resize the source-control rail (160–480 px)                               | git-dock/rail-resize-handle.component.ts:26-27   | none (layout)                 |
| Keyboard resize: `ArrowLeft`/`ArrowRight` (16 px step), `Home` (min), `End` (max) | git-dock/rail-resize-handle.component.ts:109-119 | none                          |
| `Escape` cancels a drag and restores the start width                              | git-dock/rail-resize-handle.component.ts:74-78   | none                          |

## editor-brand-icon.component.ts (`open-in/`)

Presentational only: renders a static brand mark per editor target. No capabilities.

## Auto behaviours routed through file-link-router.service.ts (chat lib)

| Capability (user-visible)                                                                                            | file:line                                         | RPC method(s) or push message |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------- |
| Click a file link in chat (Electron): reveals the dock, switches it to working-tree mode, opens a read-only file tab | chat/services/file-link-router.service.ts:112-137 | `file:viewContent`            |
| Click a file link in chat (VS Code): opens the file natively in the host                                             | chat/services/file-link-router.service.ts:143-169 | `file:open`                   |
| A declined host confirmation opens nothing and shows no error                                                        | chat/services/file-link-router.service.ts:158-163 | `file:open`                   |

## Push messages / auto behaviours

| Message type           | Handled by                                                        | file:line                                                                   |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `git:status-update`    | GitStatusService — refresh status                                 | services/git-status.service.ts:234, 246 (registered at app.config.ts:208)   |
| `git:status-update`    | GitBranchesService — refresh branches / stash count / last commit | services/git-branches.service.ts:179, 191 (registered at app.config.ts:209) |
| `git:status-update`    | DiffTabsService — revalidate open diffs                           | services/diff-tabs.service.ts:201-208 (registered at app.config.ts:211)     |
| `file:content-changed` | DiffTabsService — refresh open file-view tabs                     | services/diff-tabs.service.ts:202-218 (registered at app.config.ts:211)     |
| `git:worktreeChanged`  | WorktreeService — reload worktree list                            | services/worktree.service.ts:32, 59, 298 (registered at app.config.ts:210)  |

Auto behaviours not tied to a single push message:

- Dock mount auto-detects external editors: `editor:detectTargets` (git-dock.component.ts:239; services/editor-launcher.service.ts:38-42).
- Stash list auto-loads when the stash popover opens (stash-popover.component.ts:208-212 → `git:stashList`).
- Branch details popover auto-refreshes remotes when opened (branch-details-popover.component.ts:47-51 → `git:remotes`).
- Source-control list auto-refreshes after every stage/unstage/discard/commit; the panel needs no manual refresh (source-control-panel.component.ts:96-97 comment; via `git:status-update` push).
- After a successful Fetch/Pull/Push, the status auto-refreshes (git-dock-header.component.ts:265).

## Keyboard shortcuts

| Shortcut                              | Where                                      | Action                                   | file:line                                                                                             |
| ------------------------------------- | ------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Delete`                              | Diff tab (focused)                         | Close that diff tab                      | git-dock.component.ts:273-277                                                                         |
| `ArrowLeft` / `ArrowRight`            | Diff tab bar                               | Cycle and activate the previous/next tab | git-dock.component.ts:278-292                                                                         |
| `ArrowLeft` / `ArrowRight`            | Hunk toolbar (roving tabindex)             | Move focus between hunk buttons          | diff-view.component.ts:1893-1905                                                                      |
| `Escape`                              | Revert-hunk dialog                         | Cancel the discard                       | diff-view.component.ts:1802-1815                                                                      |
| `Tab`                                 | Revert-hunk dialog                         | Toggle between Cancel and Discard hunk   | diff-view.component.ts:1809-1814                                                                      |
| `Escape`                              | Branch picker, stash popover, open-in menu | Close                                    | branch-picker-dropdown.component.ts:22; stash-popover.component.ts:53; open-in-button.component.ts:51 |
| `Enter`                               | Worktree add form, branch creation input   | Submit create                            | worktree-section.component.ts:91, 100; branch-picker-dropdown.component.ts:101                        |
| `Escape`                              | Worktree add form inputs                   | Close the form                           | worktree-section.component.ts:92, 101                                                                 |
| `ArrowLeft`/`ArrowRight`/`Home`/`End` | Rail resize handle (focused)               | Resize the rail / min / max              | rail-resize-handle.component.ts:109-119                                                               |

## Not covered

- `ElectronLayoutService` (in `@ptah-extension/core`) backs the rail toggle and worktree switch; the exact host message it sends for `addFolderByPath` was not audited (outside the stated file list).
- `MonacoLoaderService`, `monaco-theme.ts`, `monaco-loader.service.ts` are infrastructure only; they expose no user-visible capability of their own beyond the editor mounting.
- `git-review.service.ts` and `git-stash.service.ts` handle no push messages; only their RPC lines were cited.
