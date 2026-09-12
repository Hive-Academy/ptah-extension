# @ptah-extension/git-ui

[Back to Main](../../../CLAUDE.md)

## Purpose

The webview's entire git surface behind one public API: repository status, branches, worktrees, source control (stage / unstage / commit), the Monaco diff view with hunk-level apply, and the Electron dock's read-only file/markdown tabs. Carved out of `@ptah-extension/editor` (TASK_2026_385) so the git experience survives that library's deletion and can be hosted by the Electron git dock without dragging Monaco's file-tree stack along.

## Boundaries

**Belongs here**: git state services, the source-control panel, the worktree section, the diff/file views and their shared tab store, and the dock-tab types the wire contract is aliased to.

**Does NOT belong**: a file tree, file editing, terminals, chat/link routing, or backend execution (served by host RPC handlers).

**Dependency rule — enforced by review and by `nx graph`**: `git-ui` may depend on `@ptah-extension/core`, `@ptah-extension/shared`, and `@ptah-extension/markdown` for sanitized preview rendering. It must **never** import `@ptah-extension/editor`, `@ptah-extension/chat` or `@ptah-extension/ui`.

## Public API (from `src/index.ts`)

- **Services**: `GitStatusService`, `GitBranchesService`, `WorktreeService` (+ `WORKTREE_CHANGED_MESSAGE_TYPE`), `SourceControlService`, `DiffTabsService`
- **Components**: `DiffViewComponent`, `SourceControlPanelComponent`, `SourceControlFileComponent`, `WorktreeSectionComponent`
- **Diff-tab types**: `EditorTab`, `DiffTabState`, `DiffTabStatus`, `DiffComparison`, `DiffSideRef`, `OpenDiffRequest`, `HunkApplyRequest`, `HunkApplyFn`, plus the re-exported wire types `GitApplyHunksOperation`, `GitApplyHunksResult`, `GitDiffFileResult`, `GitHunkRef`
- **Functions**: `diffTabKey`, `diffTabLabel`, `diffComparisonLabel`, `normalizeDiffPath`

**Deliberately NOT exported** — `MonacoLoaderService` and `git-read-error-messages.ts`. They are implementation detail of `DiffViewComponent` and `DiffTabsService`. Do not widen the barrel to reach them; the editor library carries its own private copies until it is deleted.

## Internal Structure

- `src/lib/services/` — `git-status.service.ts`, `git-branches.service.ts`, `worktree.service.ts`, `source-control.service.ts`, `diff-tabs.service.ts`, and the two internals (`monaco-loader.service.ts`, `git-read-error-messages.ts`)
- `src/lib/types/diff-tab.types.ts` — the diff-tab record and its helpers; `DiffComparison` is **aliased** to the shared `GitDiffComparison` rather than redeclared, so the tab record and the `git:diffFile` wire contract cannot drift
- `src/lib/diff-view/` — `DiffViewComponent` + its spec and a11y spec
- `src/lib/source-control/` — panel + per-file row
- `src/lib/worktree/` — the collapsible worktree section embedded in the panel

## Key Files

- `src/lib/services/git-status.service.ts` — event-driven (`git:status-update` push) and workspace-partitioned. `startListening()` arms the gate **and** eagerly fetches, so a gate that closes and re-opens reconciles instead of dropping every push it missed.
- `src/lib/services/diff-tabs.service.ts` — owns the open-diff set for the renderer's lifetime. `applyHunks` carries `snapshotToken` explicitly and refuses an apply whose tab record has moved on; a `refreshing` / `stale` / `error` state never blanks previously-rendered content.
- `src/lib/services/monaco-loader.service.ts` — the coordination point that lets `DiffViewComponent` drive `monaco.editor.createDiffEditor` directly. Shares `window.monaco` with `ngx-monaco-editor-v2`; whoever loads first wins, and a parallel loader is polled for rather than duplicated.
- `src/lib/diff-view/diff-view.component.ts` — the inline / side-by-side preference persists through `settings:get` / `settings:set` under the file-based key `diff.renderSideBySide`.

## Dependencies

**Internal**: `@ptah-extension/core` (`VSCodeService`, `rpcCall`, `MessageHandler`, `ElectronLayoutService`), `@ptah-extension/shared` (RPC contracts), `@ptah-extension/markdown` (`MarkdownBlockComponent`, the single sanitizer chokepoint)

**External**: `@angular/core`, `@angular/common`, `@angular/forms`, `monaco-editor` (diff view), `lucide-angular`

## Guidelines

1. **Keep the dependency direction.** `DiffTabsService → GitStatusService`, never the reverse. No import of `editor`, `chat` or `ui` from this library, at any depth.
2. **Register inbound handlers via the `MESSAGE_HANDLERS` multi-provider** in the composition root. `GitStatusService`, `GitBranchesService`, `WorktreeService` and `DiffTabsService` all implement `MessageHandler`; a service that is not registered is silently deaf, with no error to notice.
3. **Workspace-partition any new git state.** Multi-root workspaces are first class — key the state map by workspace path and derive from the ACTIVE slice so another workspace cannot leak in.
4. **A non-`fresh` diff state must retain its rendered content.** Never blank a tab to show that it is revalidating.
5. **Alias, do not redeclare, anything that also travels the wire.** `diff-tab.types.ts` aliases the shared RPC types on purpose.
6. **Single entry point.** Everything is reached through `src/index.ts`; there is no secondary entry point and no deep import.
