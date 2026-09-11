# Restore Git controls and complete change-review UX

## User authorization

The user requested a new worktree and Codex CLI execution to fix the reviewed Git UI gaps. Ollama Cloud may be used at the orchestrator's discretion. No commits, pushes, PR creation, destructive Git operations, or dependency upgrades are authorized.

## Execution

- Strategy: FEATURE with regression repairs, Full workflow.
- Primary executor: installed Codex CLI, default configured model.
- Optional independent reviewer: Ollama Cloud, provider pc-85830910-3d81-4248-84c1-4fa52752dd19.
- Worktree: D:/projects/ptah-extension/.claude/worktrees/git-review-controls
- Branch: fix/git-review-controls
- Task: TASK_2026_413, child of TASK_2026_386.
- First phase: requirements and architecture/batch plan only; present for user approval before product code changes.
- Keep main checkout's existing worktree-hook and auth-translation modifications untouched.

## Verified background

TASK_2026_111, commit 37ee79b8, provided branch search, recent/local/remote groups, create/checkout with dirty-tree confirmation, and branch details (commit, stash, remote). PR #465 deleted these components in 05e725865, replacing the editor with a minimal Git dock. GitBranchesService capability survives.

PR #476 added folder hierarchy, closable diff tabs and a working split toggle. PR #477 added editor launcher adapters, RPCs and OpenInButtonComponent, but explicitly left the component unmounted. Final launcher supports verified executable routes; historical deep-link documentation is stale. Supported IDs are vscode, cursor, antigravity, zed; Kiro is absent.

Current file rows declare openFile but never emit it. Dock fallback sends workspace-relative paths to file:open; implementation must resolve against the displayed workspace, not process CWD. Header push handler discards failure results. Existing tests bypass actual rendering/click paths.

## Requested outcome

1. Restore branch picker and details within Git header, preserving workspace scoping and safe checkout behavior.
2. Wire detected-editor Open In actions for workspace and file rows, remembered choice, errors and empty detection state. Add Kiro through typed contracts, schema, verified detection and adapters.
3. Build the supplied screenshot's Git-review experience: branch/base selection, aggregate and per-file additions/deletions, collapsible review rows/diffs, searchable changed-files tree, viewed/unviewed state, clear commit/push controls.
4. Distinguish working-tree/index mutations from read-only branch comparisons. Never stage/discard historical changes as if they were current working changes.
5. Test real rendered controls at default dock width and workspace switching; do not widen the UI to conceal hunk-action overlap.

The reference screenshot shows a branch/base header, total +/- counts, file rows with status and per-file +/- counts, a right-side folder tree with Filter files, Mark as viewed action, and Commit or push control. Use existing Angular signals, OnPush and Ptah theme tokens. Do not recreate a full IDE.

## Scope boundaries

Do not silently expand into all of TASK_2026_386: CodeMirror migration, spot editor, transcript turn cards, task/worktree binding, merge and PR creation are not required for these fixes unless an explicit approved plan establishes necessity. Retain existing Monaco diff and hunk safeguards initially. No terminal resurrection.

## Evidence

- .ptah/specs/TASK_2026_385/batch-3.1-report.md
- .ptah/specs/TASK_2026_385/future-enhancements.md
- .ptah/specs/TASK_2026_386/context.md
- .ptah/specs/TASK_2026_386/design-spec.md
- .ptah/specs/TASK_2026_386/agent-output-root.md
- libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts
- libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts
- libs/frontend/git-ui/src/lib/source-control/source-control-file.component.ts
- libs/shared/src/lib/types/rpc/rpc-git.types.ts

## Tracking

Task carrier allocated atomically through Ptah in the primary workspace. The executor should copy this task's carrier and context into the isolated worktree without overwriting any existing files, then place all deliverables there. Do not allocate another task ID. Primary workspace record remains the discovery pointer; product implementation belongs only in the isolated worktree.
