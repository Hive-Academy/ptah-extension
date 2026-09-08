# Context

## Why

TASK_2026_384 found that only one component mounts the full editor
(`electron-shell.component.ts:307`), the VS Code host serves none of it, and
every other consumer reaches `libs/frontend/editor` for three narrow things:
git state services, `DiffViewComponent`, and one `openFile` call from transcript
file links. The whole frontend git surface lives inside the lib. So the git
surface is carved out first, and the IDE shell is deleted after.

The full coupling map with file:line evidence is in
`../TASK_2026_384/research-report.md` sections 2 and 4. This file states scope
and order. It does not repeat the evidence.

## In scope

### Phase 0. Dead code, no consumers

Delete vim (`vim-mode.service.ts`, the monaco-vim asset glob in the webview
`project.json`, the `monaco-vim` dependency, the `editor.vimMode` settings key),
quick-open, search panel, `WorktreePanelComponent`, `AddWorktreeDialogComponent`,
`layout-rpc.handlers.ts`. Remove `editor:searchInFiles`, `editor:listAllFiles`
and `layout:*` from `rpc.types.ts`, the manifest, capabilities, the runtime
prefix guard, and the three expected-absent lists.

### Phase 1. Terminal panel and host wiring

Delete `terminal/*`, `TerminalService`, the terminal signals on `EditorService`,
the xterm CSS import in `styles.css`, the `ptahTerminal` preload bridge, the
binary IPC channels in `ipc-bridge.ts`, `PtyManagerService`, `TerminalRpcHandlers`
and schema, the `PTY_HOST` port and token, the `pty` capability, the
`terminal:` prefix and types, `shell-allowlist.ts`. Remove `node-pty` and
`@xterm/*` from the Electron package, `project.json` externals,
`electron-builder.yml` prune blocks, `packaged-deps.spec.ts`. Delete
`pty-manager.spec.ts` and the terminal beats in `editor-tour.scene.ts`.

`node-pty` stays in the root `package.json` because the CLI e2e `pty-runner.ts`
uses it.

Decided 2026-09-06: the terminal is dropped for good. No session-bound
terminal returns in TASK_2026_386. Delete the whole list above, including
`PtyManagerService`, the preload bridge and the packaging.

### Phase 2. Carve `libs/frontend/git-ui`

Tags `scope:webview`, `type:feature`. Public API from `src/index.ts` only.

Move with public API unchanged: `GitStatusService` (drop `fileStatusMap` and
`changedDirPrefixes`, they served the tree), `GitBranchesService` (convert the
raw `window` listener to `MESSAGE_HANDLERS`), `WorktreeService` (same
conversion), `SourceControlService`, `DiffViewComponent`, `MonacoLoaderService`
and `provideMonacoEditor`, the diff subset of `editor-tab.types.ts`
(`DiffTabState`, `diffTabKey`, `diffComparisonLabel`, `OpenDiffRequest`,
`HunkApplyRequest`, `HunkApplyFn`), the diff half of `EditorDiffSplitHelper` as
a git-owned service, `git-read-error-messages.ts`, source-control panel and
file, worktree section (read the active workspace from
`ElectronLayoutService.activeWorkspace()` instead of `EditorService`).

Repoint: `app.config.ts`, `workspace-coordinator.service.ts`,
`lazy-diff-view.component.ts` plus its jest mapper and mock, both eslint
import bans, `tsconfig.base.json` aliases, `editor-message-routing.spec.ts`.
Rename `editor:getSetting` and `editor:updateSetting` under a git or
preferences namespace.

Monaco stays in this task. TASK_2026_386 replaces it with CodeMirror.

### Phase 3. Replacements the shell needs before it dies

1. Electron `file:open` launches the external editor through `IProcessSpawner`
   instead of reading the file for a Monaco tab. Remap `host.fileOpen` off
   `EditorRpcHandlers`. Call `notifyFileOpened` on the Electron editor provider
   so the `ptah_ide` MCP tools and context auto-include keep working.
   Collapse `file-path-link.component.ts` to the RPC branch. The launcher
   contract itself is TASK_2026_386. This phase only needs a minimal
   `code -g file:line` path so the link keeps doing something.
2. A git dock in the `electron-shell.component.ts` editor slot that calls
   `startListening()` on `GitStatusService` and `GitBranchesService` and hosts
   the source-control panel, the diff view, and a branch plus ahead-behind
   header. Without this, every `git:status-update` push is dropped.
3. Retarget `editor-git.shot.ts`, re-home the hunk and diff e2e specs and
   `git-diff-mock.ts` under a `git/` spec folder, rewrite `git/git-status.md`.

### Phase 4. Delete the rest

`EditorPanelComponent`, `CodeEditorComponent`, file-tree family, sidebar,
`EditorService` and helpers, `EDITOR_INTERNAL_STATE`, `editor:revertFiles` on
both hosts, `EDITOR_TAB_CONTENT_REVERTED`, `EditorRpcHandlers` and specs, the
editor entries in manifest, capabilities, prefix guard, `rpc.types.ts`,
`FILE_TREE_CHANGED` and `EDITOR_REREAD_OPEN_TABS`, the editor layout state in
`electron-layout.service.ts`, `no-editor-dependency.spec.ts`, the editor view
in `ui-driver.ts` and `prewarm.ts`, `editor-tour.scene.ts` and its json,
`file-tree.md`, the screenshot manifest entries, the editor lib itself.

Keep `FILE_CONTENT_CHANGED`. The diff view revalidates on it.

### Host watcher

In `git-watcher.service.ts` drop `scheduleTreeRefresh` and the tree job. Keep
the recursive `fs.watch` and the content-change job. Fold `TREE_HIDDEN_DIRS`
into `WATCH_IGNORED_DIRS` and add `.nx/cache`, `.angular/cache`, `dist`,
`coverage`, `tmp` to the ignore predicate. Pin with a spec that a write under
`.nx/cache` schedules nothing.

## Out of scope

Change-set view, CodeMirror, launcher port and adapters, task to worktree
binding, merge and PR, session-bound terminal. All TASK_2026_386.

## Acceptance criteria

- `npm run build:all`, `npm run lint:all`, `npm run typecheck:all` green after
  every phase, and each phase is its own commit set.
- `libs/frontend/editor` no longer exists. `libs/frontend/git-ui` exports the
  moved symbols with unchanged signatures.
- The manifest partition spec, `rpc-allowlist.spec.ts`, and the three
  expected-absent specs pass with the removed methods gone from every list.
- Skill Synthesis enhance preview and clone drawers still render the diff.
- `git:status-update` pushes reach the git dock on Electron. Pinned by an e2e
  spec that injects a synthetic push and asserts the dock updates.
- Transcript file links still open the file, now in the external editor.
- A write under `.nx/cache` schedules no git status update. Pinned by spec.
- `startup-tti.spec.ts` re-baselined. The renderer no longer loads the xterm
  and file-tree lazy chunk. Add a lazy-chunk budget for `git-ui` in the webview
  `project.json`.
- Persisted layout blobs that carry `editorWidth` and `editorVisible` still
  restore without error.

## Risks

- Contract edits in `rpc.types.ts`, the manifest, capabilities, host profiles
  and the expected-absent lists must land in one commit per phase, or boot
  throws on the manifest invariant.
- The CLI consumes `git:*` through `apps/ptah-cli/src/cli/commands/git.ts`.
  Do not prune any git method.
- Three backend producers broadcast `git:worktreeChanged`. The relocated
  `WorktreeService` must keep that contract.
- `editor-tour` is the documented showcase exemplar and `prewarm.ts` targets
  the editor for every scene. Promote another scene first.
