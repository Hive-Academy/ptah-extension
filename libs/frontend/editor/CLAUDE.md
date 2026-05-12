# @ptah-extension/editor

[Back to Main](../../../CLAUDE.md)

## Purpose

Monaco-based code editor stack for the webview: file tree explorer, code editor, diff view, integrated multi-tab terminal (xterm.js + node-pty via binary IPC), git status bar, branch picker, source-control panel, search, quick-open, and worktree management. Owned by the editor panel and consumed by the webview shell.

## Boundaries

**Belongs here**: editor UI components (tree, editor, diff, terminal, sidebar, quick-open, search), editor services (`EditorService` coordinator + helpers, `GitStatusService`, `GitBranchesService`, `TerminalService`, `WorktreeService`, `SourceControlService`, `VimModeService`), the inverted-dependency `EDITOR_INTERNAL_STATE` token + provider.

**Does NOT belong**: chat surfaces, backend file system code, language servers (those live in extension code, communicated via RPC).

## Public API (from `src/index.ts`)

- **Models**: `FileTreeNode`, `SearchMatch`, `SearchFileResult`, `SearchInFilesParams`, `SearchInFilesResult`
- **Components**: file tree family (`FileTreeComponent`, `FileTreeNodeComponent`, `FileTreeContextMenuComponent`, `FileTreeInlineInputComponent`), `CodeEditorComponent`, `DiffViewComponent`, `EditorPanelComponent`, `GitStatusBarComponent`, terminal trio (`TerminalComponent`, `TerminalTabBarComponent`, `TerminalPanelComponent`), worktree trio (`AddWorktreeDialogComponent`, `WorktreePanelComponent`, `WorktreeSectionComponent`), `SidebarComponent`, source-control (`SourceControlPanelComponent`, `SourceControlFileComponent`), `SearchPanelComponent`, `QuickOpenComponent`, branch-picker (`BranchPickerDropdownComponent`, `BranchDetailsPopoverComponent`)
- **Services**: `EditorService`, `GitStatusService`, `GitBranchesService`, `TerminalService`, `WorktreeService`, `VimModeService`, `SourceControlService`
- **Tokens / providers**: `EDITOR_INTERNAL_STATE` + `EditorInternalState` + `provideEditorInternalState()`
- **Types**: `EditorTab`, `TerminalTab`, `PtahTerminalApi`

## Internal Structure

- `src/lib/branch-picker/`, `code-editor/`, `diff-view/`, `editor-panel/`, `file-tree/`, `git-status-bar/`, `quick-open/`, `search/`, `sidebar/`, `source-control/`, `terminal/`, `worktree/` — one component family per folder
- `src/lib/services/` — top-level services + `editor/` sub-folder containing the four `EditorService` helpers (`editor-workspace`, `editor-tabs`, `editor-file-ops`, `editor-diff-split`), the `editor-internal-state.ts` interface, `editor-tab.types.ts`
- `src/lib/services/editor-internal-state.provider.ts` — composition-root binding for the `EDITOR_INTERNAL_STATE` token
- `src/lib/models/` — `file-tree.model.ts`, `search.model.ts`
- `src/lib/types/terminal.types.ts` — terminal IPC types
- `src/services.ts` — secondary entry point for service-only consumers

## Key Files

- `src/lib/services/editor.service.ts:40` — `EditorService` implements `MessageHandler` (registers via `MESSAGE_HANDLERS` from `@ptah-extension/core`) and coordinates four helpers split by concern: workspace partitioning + file-tree, file ops (open/save/create/rename/delete/reveal), diff/split-pane, and tab open/close/switch/updateContent. Public API is identical to the pre-split service — Wave C7b (TASK_2025_291).
- `src/lib/services/editor/editor-internal-state.ts` — `EditorInternalState` interface. Wave F3 (TASK_2026_103) inverted-dependency contract for the editor's internal-state map; composition root binds via `provideEditorInternalState()` mirroring the chat-state pattern.
- `src/lib/services/git-status.service.ts` — event-driven (subscribes to `git:status-update` push messages), workspace-partitioned git state
- `src/lib/services/git-branches.service.ts` — branch list, stash count, last commit, recent-branch persistence (event-driven)
- `src/lib/services/terminal.service.ts` — terminal tab lifecycle, binary IPC via `PtahTerminalApi` window extension, workspace-partitioned
- `src/lib/services/worktree.service.ts` — git worktree CRUD + workspace folder registration

## State Management Pattern

- **Signals** for all editor state — `EditorService` owns signals on the coordinator so reference identity survives the helper split
- **Workspace partitioning** for editor, git, and terminal state — each workspace path holds a cached state slice so switching workspaces is instant (`EditorWorkspaceHelper`, similar pattern in `GitStatusService` / `TerminalService`)
- **Event-driven git** — backend pushes `git:status-update`; services react via the `MessageHandler` pattern
- **Inverted-dependency token** (`EDITOR_INTERNAL_STATE`) for the internal-state map — composition root binds it (mirrors `MODEL_REFRESH_CONTROL` / `STREAMING_CONTROL` pattern)

## Dependencies

**Internal**: `@ptah-extension/core` (`MessageHandler`, `VSCodeService`, `MESSAGE_HANDLERS` registration), `@ptah-extension/shared` (`MESSAGE_TYPES`, payload types), `@ptah-extension/ui` (overlays/native components — branch picker dropdowns, popovers)

**External**: `@angular/core`, `@angular/common`, `monaco-editor` (code editor + diff), `xterm` + `xterm-addon-fit` + `xterm-addon-webgl` (terminal rendering), `lucide-angular`

## Angular Conventions Observed

- Standalone components, `ChangeDetectionStrategy.OnPush`
- `inject()` exclusively
- `MessageHandler` registration via `MESSAGE_HANDLERS` multi-provider for inbound events
- Signal-based state with `computed()` derivations
- Helper-class split pattern for large coordinator services (`EditorService` → four helpers)

## Guidelines

1. **Register inbound message handlers via `MESSAGE_HANDLERS` multi-provider** in core — see `EditorService` for the pattern. No global event-bus subscriptions.
2. **Workspace-partition any new editor/git/terminal state.** Multi-root workspaces are a first-class concern; always key your state map by workspace path.
3. **Helper-class split for growing services.** When a service grows past ~500 lines, split into helpers under `services/<feature>/` keeping signals on the coordinator (see `EditorService`).
4. **Use the `EDITOR_INTERNAL_STATE` token** for anything that needs to mutate the editor's internal-state map from outside this lib — do not export the raw map.
5. **Terminal uses binary IPC**, not JSON-RPC. `PtahTerminalApi` is exposed on `window` by the host (electron/extension), and `TerminalService` talks to it directly for throughput.
6. **Monaco assets** must be loaded via the host preload — Monaco's `eval()` patterns are excluded from VSIX (`**/assets/monaco/**` in `.vscodeignore`).
