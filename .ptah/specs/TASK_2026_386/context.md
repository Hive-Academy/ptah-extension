# Context

## Why

TASK_2026_384 set the direction: Ptah stops competing with VS Code and owns the
review loop instead. The market reference is Claude Code desktop (diff viewer,
small file editor, "Open in" menu), Superset (diff and file editor, persistent
terminal per worktree) and T3 Code (inline diff review, one-button commit,
push and PR). The owner is installing those tools and will supply screenshots.
Those screenshots are the design input for the change-set surface. Run a
design pass on them before the architect writes the plan.

Depends on TASK_2026_385, which carves `libs/frontend/git-ui` and deletes the
IDE shell. This task builds on `git-ui`.

## What already exists

- 18 host-agnostic `git:*` RPCs over `GitInfoService`: `diffFile`,
  `applyHunks` with index-tree rollback, worktree CRUD, stage, unstage,
  discard, commit, push, branches, remotes.
- An SDK hook that creates per-task worktrees under `.claude-worktrees/`
  (`worktree-hook-handler.ts`) and the `HostProfile.worktree` seam.
- `session:rewindFiles` returns a path-validated file, insertion and deletion
  set per message (`session-rpc.handlers.ts:1062-1114`).
- Per-turn touched paths are computed then discarded in
  `message-summary.utils.ts:62-108`.
- `DiffViewComponent` takes four inputs and one output and does not depend
  on an editor service.
- A Monaco-free diff seed in `chat-ui` `diff-display.component.ts`.
- `IProcessSpawner` port and a reference `file:open` on VS Code
  (`file-rpc.handlers.ts:43-71`).
- `ptah_git_worktree_*` MCP tools on the same backend.

## In scope

### A. Change-set review

- New RPC `git:changedFiles` with `{ base: ref, head: ref | 'worktree' }` and
  `git:diffFile` extended to accept a ref pair. Today `GitDiffComparison` is
  only `'staged' | 'worktree'`.
- Per-turn change set in the transcript: after each assistant turn, a card
  lists files touched, additions, deletions, with one collapsed diff per file.
  Source is the touched-path set the summary utils already compute plus
  `session:rewindFiles`.
- Per-task change set in the git dock: branch versus main for the task's
  worktree, with stage, discard, and hunk apply from the existing RPCs.

### B. CodeMirror diff and spot editor

- Replace Monaco in `DiffViewComponent` with CodeMirror 6 and
  `@codemirror/merge`. Keep side-by-side and unified modes and per-hunk accept
  and reject. Keep the four inputs and the `retryRequested` output.
- One `SpotEditorComponent` for a single file: open from a change-set row or a
  transcript link, edit, save through the existing file write RPC. No tabs, no
  split, no tree.
- Remove `monaco-editor`, `ngx-monaco-editor-v2`, the `/assets/monaco` copy
  rule, `MonacoLoaderService`, `provideMonacoEditor`, and the `.vscodeignore`
  Monaco lines. Add a lazy-chunk budget for the diff chunk.

### C. Task to worktree, merge, PR

- Bind a task card to a worktree and branch. Store the binding in the task
  carrier frontmatter (`worktree`, `branch`) through `task-specs`.
- Actions on the task and in the git dock: create worktree, open change set,
  merge into main, create pull request. PR creation goes through `gh` when
  present, through `IProcessSpawner`, with a clear failure message when it is
  absent.
- `git:worktreeChanged` keeps its three producers. The UI subscribes through
  `MESSAGE_HANDLERS`.

### D. Open in external editor

- New port `IEditorLauncher` in `platform-core` with `PLATFORM_TOKENS.EDITOR_LAUNCHER`:
  `detect(): Promise<EditorTarget[]>`, `openFile(target, path, line?)`,
  `openWorkspace(target, root)`.
- Adapters: `platform-electron` (spawns `code`, `cursor`, `antigravity`, `zed`
  binaries, falls back to `vscode://` and `cursor://` deep links through
  `shell.openExternal`), `platform-vscode` (uses `vscode.window.showTextDocument`
  for VS Code itself, spawner for the others), `platform-cli` (spawner only).
- Detection order: `PATH` lookup, then per-platform install locations. Report
  what was found. Never guess.
- UI: an "Open in" split button on the change-set header, on each file row,
  and on the workspace header. Remembers the last choice in settings.
- Electron `file:open` and `notifyFileOpened` route through this port.
  TASK_2026_385 phase 3 shipped a minimal `code -g` path. Replace it here.

### E. Terminal decision

Decide first. If kept: one xterm surface bound to the active agent session
or worktree, opened from the session header, with the pty owned by the
session lifecycle. No tab bar, no IDE panel, no `EditorService` state. If
dropped: agent command output stays as transcript cards, and the node-pty
packaging leaves the Electron app in TASK_2026_385 phase 1.

## Out of scope

File tree, search-in-files, quick-open, vim, multi-tab editing. Those are
retired in TASK_2026_385 and do not return.

## Acceptance criteria

- After an agent turn that edits files, the transcript shows a change-set
  card with the correct file list and diffs. Pinned by a spec that replays a
  recorded stream.
- `git:changedFiles` between two refs returns the same list as
  `git diff --name-status base..head`. Pinned by a spec against a scratch repo.
- The diff view renders with CodeMirror. Hunk apply through `git:applyHunks`
  still passes `hunk-apply-real-rpc.spec.ts` re-homed under `git/`.
- `monaco-editor` is absent from the webview and Electron dependency graphs.
  Pinned by `packaged-deps.spec.ts`.
- A task bound to a worktree shows its branch and its change set. Merge and
  PR actions work on a scratch repo in e2e, PR only when `gh` is present.
- "Open in" lists only detected editors and opens the file at the line.
  Pinned by adapter specs with a fake spawner.
- `IEditorProvider` events still fire on Electron after an open. Pinned by a
  spec on `notifyFileOpened`.
- Renderer memory and `startup-tti.spec.ts` do not regress from the
  TASK_2026_385 baseline.

## Design

`design-spec.md` and `design-handoff.md` in this folder. Existing anubis and
anubis-light daisyui theme only, no new tokens. Key decisions: the change-set
card is a sibling of message bubbles in the transcript `@for`, file rows
collapse by default and expand to an inline CodeMirror unified diff capped at
`max-h-64`, more than six files switches to a compact top-five view that
routes to the dock, the dock reuses `SourceControlPanelComponent` verbatim for
the working tree and adds a Task tab for branch versus main, one
`OpenInButtonComponent` is shared by all four mount points.

## Decisions settled from the code

- **Per-file revert on the change-set card uses `git:discard`, not
  `session:rewindFiles`.** `SessionRewindParams` (`rpc-session.types.ts:260`)
  has no path filter. It rewinds every file of the turn. The card keeps
  "Revert whole turn" in its overflow menu through `rewindFiles`, and the
  per-row action discards that one path through `git:discard`.
- **Transcript file row and dock file row stay two components** that share
  one visual recipe, as the designer proposed. A mode flag would grow with
  every divergence of the two action sets.
- **The six-file threshold for the compact state ships as proposed.** It is a
  judgment call with no repo precedent. Make it one constant.

## Decisions by the owner, 2026-09-06

1. **Terminal: dropped.** Not a session-bound surface, not a dock tab. The
   cost was the subsystem, not the widget: a node-pty shell process and a
   WebGL renderer per tab, the binary IPC channel, the preload bridge, the pty
   manager loaded at boot, the native packaging. `openTerminal` on Electron
   was already a no-op, so no product flow depends on it. Agent command output
   stays as transcript cards. TASK_2026_385 phase 1 therefore removes node-pty
   and xterm from the Electron app without a condition. Section E above is
   closed.
2. **Merge conflict: blocking dock state, no in-app resolver.** When
   `git:merge` reports conflicts, the Task tab shows a blocking state that
   lists the conflicted files, each with an "Open in" button, plus "Abort
   merge" and "Mark resolved and continue" actions. Resolution happens in the
   external editor. The backend needs `git:merge` with a result that carries
   `conflicts: string[]`, plus `git:mergeAbort` and `git:mergeContinue`.
3. **Launcher: binaries first, deep links as fallback.** Detection checks
   `PATH` for `code`, `cursor`, `antigravity`, `zed`, then per-platform
   install locations. Open with `<bin> -g <file>:<line>` for VS Code-family
   binaries and `zed <file>:<line>` for Zed. If a binary is not found but the
   app is installed, fall back to `vscode://file/<path>:<line>` and
   `cursor://file/<path>:<line>` through `shell.openExternal`. Never show an
   editor that was not detected.

## Open decision

- Where the task to worktree binding lives if the task has no carrier yet.
  Proposal: create the carrier on first bind, since a folder without
  `task.md` is invisible to the board anyway.
