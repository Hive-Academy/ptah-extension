# TASK_2026_413 — Restore Git controls and complete change-review UX

## Outcome

Restore the Git controls removed during the editor-to-dock migration and turn the existing Electron Git dock into a usable review surface without recreating an IDE. The result must support safe current-branch operations, a separate read-only branch comparison, accurate change statistics, mounted external-editor launch controls including Kiro, and real rendered tests at the shipped 700 px default dock width.

## Current-state findings

- `GitBranchesService` still owns workspace-scoped local/remote/recent branch data, checkout, stash, remotes, tags, last-commit data, and push. The dock header renders only a read-only branch label and discards `GitPushResult` failures.
- The deleted editor library's `BranchPickerDropdownComponent` and `BranchDetailsPopoverComponent` can be restored into `git-ui`; their prior safe flow first attempts checkout without force and requires an explicit dirty-tree confirmation before retrying with force.
- `OpenInButtonComponent`, `IEditorLauncher`, three adapters, and `editor:*` RPCs exist, but the button is exported rather than mounted. Supported target IDs are VS Code, Cursor, Antigravity, and Zed; Kiro is absent.
- `SourceControlFileComponent.openFile` is declared but never emitted. `GitDockComponent`'s fallback calls `file:open` with a workspace-relative path. The handler expects an absolute path and tests do not exercise the rendered path.
- `GitInfoResult` has file status but no numstat data. `GitDiffComparison` is deliberately limited to staged and worktree comparisons, and `git:applyHunks` enforces the mutation matrix with snapshot, dry-run, offset, and rollback guards.
- The dock currently spends 256 px of its 700 px default width on the source-control rail. The remaining Monaco pane is narrow enough for the no-wrap hunk action widget to overlap Monaco's vertical scrollbar. Two Electron tests hide this by resizing the window to 2200 px.
- The isolated worktree has Node 24.15.0 and npm 11.12.1, but no `node_modules`; Nx, Jest, and Playwright are therefore not runnable here without a later approved dependency preparation step.

## In scope

### Current branch and repository details

- Mount a keyboard-accessible branch picker in the Git header.
- Show recent, local, and remote branches with search, current selection, ahead/behind values, and an inline create-branch flow.
- Preserve workspace scoping on every branch RPC and drop stale responses after workspace switches.
- Attempt ordinary checkout first. If the backend reports a dirty tree, show an explicit destructive warning and require a second user action before a forced checkout. Never force automatically.
- Mount a branch-details control showing current branch, latest commit, stash count, and configured remote information. Fetch the expensive details only when opened.

### Read-only branch review

- Add a distinct review mode with explicit base and head branch selectors. Selecting either review ref must not checkout a branch or mutate the index or working tree.
- Resolve both names to immutable commit SHAs before reading differences, and return the resolved identities with the result.
- Show total additions/deletions and per-file additions/deletions. Binary counts are represented as unavailable, not zero.
- Show a searchable folder tree in a right-hand rail. Selecting a file expands/selects its review row and loads its Monaco diff.
- Use one expanded review diff at a time to bound Monaco models and fit the dock. Retain existing side-by-side/unified preference behavior.
- Allow each file to be marked viewed/unviewed. Persist viewed state in webview state, partitioned by workspace and resolved comparison SHAs. A new SHA pair must start unviewed automatically.
- Historical review must be read-only by construction: no stage, unstage, discard, commit, or hunk-apply control may be rendered in that mode.

### Working-tree review and actions

- Preserve the existing staged versus worktree semantics and the existing `git:applyHunks` safety guards.
- Show aggregate/per-file numstat data for current changes without treating historical differences as working-tree files.
- Keep the existing folder hierarchy, stage, unstage, discard confirmation behavior, commit composer, worktrees section, closable diff tabs, and Monaco diff.
- Put the commit/push action area at the top of the dock. When staged changes exist, commit is the primary action and requires a message. When nothing is staged and the branch is ahead, push is the primary action. Surface success/failure in a visible status region; a failed push must not be console-only.
- Fix the hunk toolbar/widget layout at the default width. Do not raise the default dock width or widen tests to make the overlap disappear.

### Open in external editor

- Mount the existing split button for the displayed workspace and every eligible file row.
- Detect targets once per dock lifetime with explicit loading, no-target, and detection-error states. Keep the control visible and explained when no target is found.
- Preserve the remembered global target choice and surface launch failures in the dock.
- Add Kiro to the closed target unions, Zod schema, shared verified detection definitions, conventional executable candidates, and all three adapters' tests.
- Renderer calls must identify the displayed workspace. Relative file paths must be resolved against that registered workspace root by the backend, never against the host process current directory. The resolved absolute path must pass containment checks before launch.

### Test coverage

- Backend scratch-repository tests must prove changed-file status, rename handling, numstat totals, binary handling, ref resolution, and base/head file contents.
- Backend tests must snapshot the index, working tree, and HEAD before and after historical review calls and prove they are unchanged.
- Component tests must render and click the real branch, base/head, Open In, filter, file-row, Mark as viewed, commit, and push controls. Direct calls to protected methods do not satisfy mount coverage.
- A dock integration spec must instantiate the real child component graph (with only Monaco/RPC boundaries stubbed) so an export-only component cannot pass.
- Electron Playwright coverage must run at the launcher's default 1200×800 window and the layout service's default 700 px dock width. It must cover hunk-widget clickability, branch/base review, folder filtering, expandable diff, viewed state, workspace/file Open In calls, push failure feedback, and workspace switching.

## Out of scope

- CodeMirror migration or removal of Monaco/`ngx-monaco-editor-v2`.
- A general-purpose file editor, spot editor, file tree, editor tabs, terminal, or terminal resurrection.
- Transcript turn change-set cards.
- Task/worktree binding or task-card changes.
- Merge, merge-conflict resolution, pull-request creation, or `gh` integration.
- New dependency versions, dependency upgrades, or new UI frameworks.
- Commits, pushes, or PR creation as part of this task execution unless separately authorized later.

## Non-functional constraints

- Angular components are standalone, `OnPush`, signal-driven, zoneless-safe, and use `inject()`.
- Use only existing Ptah/daisyUI theme tokens and lucide-angular icons. Do not add React or a second sanitizer.
- Shared wire types live in `libs/shared`; frontend and backend must not import each other.
- All new/changed external RPC parameters are validated with Zod.
- Every Git request carries the displayed workspace root where known. Backend roots must be checked against registered workspace folders.
- Git subprocesses receive argv arrays, never shell strings. User ref names are resolved using an option-safe verification call; subsequent diff/show commands use resolved SHAs.
- Existing hunk selection, snapshot token, dry-run, no-offset, rollback, and sanitized error guarantees remain unchanged.
- Historical comparison caches and viewed state are workspace-partitioned and invalidated by ref/SHA changes.

## Acceptance criteria

1. Clicking the rendered current-branch control opens searchable recent/local/remote groups; selecting a clean branch performs one workspace-scoped non-force checkout.
2. A dirty-tree response renders a warning and does not issue a force checkout until the user confirms. Cancel performs no mutation.
3. Branch details render last commit, stash, and remote data for the active workspace and cannot show a stale previous-workspace response.
4. Base/head selectors load a read-only comparison without calling checkout, stage, unstage, discard, commit, or applyHunks.
5. Review results and UI show accurate aggregate and per-file additions/deletions, including renamed and binary files.
6. Filtering the changed-files tree is case-insensitive, preserves matching ancestor folders, and selecting a result opens the corresponding single expanded Monaco review diff.
7. Mark as viewed toggles visibly, persists for the same workspace/baseSHA/headSHA/file key, and resets for a changed SHA pair or different workspace.
8. Working-tree file rows retain correct staged/worktree diff provenance and mutation controls; historical rows expose none of those controls.
9. Workspace and file Open In controls are visibly mounted. Kiro is listed only when a verified executable is detected. Launch calls use the selected editor and displayed workspace.
10. A workspace-relative file path resolves under the supplied registered root; an unregistered root, traversal, or path outside that root is rejected before launch.
11. A failed push produces an on-screen alert/status and leaves retry available; success refreshes branch state and announces completion.
12. At default width, every hunk action remains inside the visible diff pane and can be clicked without Monaco's scrollbar intercepting it.
13. Real-child dock integration and Electron e2e tests fail if branch/Open In/review controls are merely exported but not mounted.
14. Relevant lint, typecheck, unit, integration, and Electron e2e targets pass once dependencies are available; command output must confirm the requested project count.

## Approval decision

The implementation plan recommends pull-request-style comparison semantics: compute the merge base of `base` and `head`, then review `mergeBase..head`. If the owner instead wants endpoint comparison (`base..head`), that changes file/totals results after branches diverge and must be chosen before implementation.
