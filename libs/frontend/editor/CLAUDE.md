# @ptah-extension/editor

[Back to Main](../../../CLAUDE.md)

## Purpose

Monaco-based code editor stack for the webview: file tree explorer, code editor, git status bar and branch picker. Owned by the editor panel and consumed by the webview shell.

> **Being dismantled (TASK_2026_385).** The whole git surface — `GitStatusService`, `GitBranchesService`, `WorktreeService`, `SourceControlService`, `DiffTabsService`, `DiffViewComponent`, the source-control panel and the worktree section — now lives in [`@ptah-extension/git-ui`](../git-ui/CLAUDE.md). This library is deleted entirely in Phase 4; do not add to it.

## Boundaries

**Belongs here**: editor UI components (tree, code editor, sidebar, status bar, branch picker), `EditorService` and its helpers, the inverted-dependency `EDITOR_INTERNAL_STATE` token + provider.

**Moved out**: everything git. Import it from `@ptah-extension/git-ui`. This lib may depend on `git-ui`; `git-ui` must never depend on this lib.

**Does NOT belong**: chat surfaces, backend file system code, language servers (those live in extension code, communicated via RPC).

## Public API (from `src/index.ts`)

- **Models**: `FileTreeNode`
- **Components**: file tree family (`FileTreeComponent`, `FileTreeNodeComponent`, `FileTreeContextMenuComponent`, `FileTreeInlineInputComponent`), `CodeEditorComponent`, `EditorPanelComponent`, `GitStatusBarComponent`, `SidebarComponent`, branch-picker (`BranchPickerDropdownComponent`, `BranchDetailsPopoverComponent`)
- **Services**: `EditorService`
- **Tokens / providers**: `EDITOR_INTERNAL_STATE` + `EditorInternalState` + `provideEditorInternalState()`

## Internal Structure

- `src/lib/branch-picker/`, `code-editor/`, `editor-panel/`, `file-tree/`, `git-status-bar/`, `sidebar/` — one component family per folder
- `src/lib/services/` — `editor.service.ts` + `editor/` sub-folder containing the four `EditorService` helpers (`editor-workspace`, `editor-tabs`, `editor-file-ops`, `editor-diff-split`) and the `editor-internal-state.ts` interface
- `src/lib/file-tree/file-tree-git-index.service.ts` — the two tree-only derivations (`fileStatusMap`, `changedDirPrefixes`) that `GitStatusService` shed when it moved to `git-ui`. Root-provided so they are computed once per status update, not once per node
- `src/lib/services/monaco-loader.service.ts` and `src/lib/services/editor/git-read-error-messages.ts` — PRIVATE copies of two `git-ui` internals. `git-ui` deliberately does not export them; both copies die with this lib in Phase 4
- `src/lib/services/editor-internal-state.provider.ts` — composition-root binding for the `EDITOR_INTERNAL_STATE` token
- `src/lib/models/` — `file-tree.model.ts`
- `src/services.ts` — secondary entry point for service-only consumers

## Key Files

- `src/lib/services/editor.service.ts:40` — `EditorService` implements `MessageHandler` (registers via `MESSAGE_HANDLERS` from `@ptah-extension/core`) and coordinates four helpers split by concern: workspace partitioning + file-tree, file ops (open/save/create/rename/delete/reveal), diff/split-pane, and tab open/close/switch/updateContent. Public API is identical to the pre-split service — Wave C7b (TASK_2025_291).
- `src/lib/services/editor/editor-internal-state.ts` — `EditorInternalState` interface. Wave F3 (TASK_2026_103) inverted-dependency contract for the editor's internal-state map; composition root binds via `provideEditorInternalState()` mirroring the chat-state pattern.

## State Management Pattern

- **Signals** for all editor state — `EditorService` owns signals on the coordinator so reference identity survives the helper split
- **Workspace partitioning** for editor state — each workspace path holds a cached state slice so switching workspaces is instant (`EditorWorkspaceHelper`)
- **Inverted-dependency token** (`EDITOR_INTERNAL_STATE`) for the internal-state map — composition root binds it (mirrors `MODEL_REFRESH_CONTROL` / `STREAMING_CONTROL` pattern)

## Dependencies

**Internal**: `@ptah-extension/core` (`MessageHandler`, `VSCodeService`, `MESSAGE_HANDLERS` registration), `@ptah-extension/shared` (`MESSAGE_TYPES`, payload types), `@ptah-extension/ui` (overlays/native components — branch picker dropdowns, popovers), `@ptah-extension/git-ui` (git state and the diff view)

**External**: `@angular/core`, `@angular/common`, `monaco-editor` (code editor + diff), `lucide-angular`

## Angular Conventions Observed

- Standalone components, `ChangeDetectionStrategy.OnPush`
- `inject()` exclusively
- `MessageHandler` registration via `MESSAGE_HANDLERS` multi-provider for inbound events
- Signal-based state with `computed()` derivations
- Helper-class split pattern for large coordinator services (`EditorService` → four helpers)

## Guidelines

1. **Register inbound message handlers via `MESSAGE_HANDLERS` multi-provider** in core — see `EditorService` for the pattern. No global event-bus subscriptions.
2. **Workspace-partition any new editor/git state.** Multi-root workspaces are a first-class concern; always key your state map by workspace path.
3. **Helper-class split for growing services.** When a service grows past ~500 lines, split into helpers under `services/<feature>/` keeping signals on the coordinator (see `EditorService`).
4. **Use the `EDITOR_INTERNAL_STATE` token** for anything that needs to mutate the editor's internal-state map from outside this lib — do not export the raw map.
5. **A push gate that can close must reconcile when it re-opens.** `EditorService` is `providedIn: 'root'`; `EditorPanelComponent` is not. Leaving the editor surface destroys the panel and shuts the `file:tree-changed` / `file:content-changed` gate while the tree and tabs it guards stay alive in the root service, so every push that lands meanwhile is dropped with nothing to replay it. `startFileTreeWatcher` therefore reloads the tree and re-reads open tabs on arm (idempotent, and a no-op before a workspace is active), matching `GitStatusService.startListening`'s gate-plus-eager-fetch — which is why git decorations never had this bug and the explorer did.
6. **Do not add git code here.** It belongs in `@ptah-extension/git-ui`. This lib is scheduled for deletion.
7. **Monaco assets** must be loaded via the host preload — Monaco's `eval()` patterns are excluded from VSIX (`**/assets/monaco/**` in `.vscodeignore`).
