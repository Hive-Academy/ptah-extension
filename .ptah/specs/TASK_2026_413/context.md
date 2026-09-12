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

## Scope addendum (2026-09-11, approved via /orchestrate)

User approval: "this properly please you can rely our cli tools as you see fit and also your subagents you decide the provider and model for complexity and performance". CLI delegation: enabled, orchestrator chooses. Available: codex, antigravity, ptah-cli Ollama Cloud (pc-85830910-3d81-4248-84c1-4fa52752dd19), ptah-cli Claude subscription (pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d). Copilot disabled.

Orchestrator decisions carried from the proposal: Electron read-only file tab in the Git dock with preview-first markdown and Source toggle; VS Code keeps native tabs with line numbers; links resolve against the originating session's workspace; files outside allowed roots show a message plus an external-editor action; no explorer tree, no editing. Deferred follow-ups: dock visibility restore on restart, containment for legacy `file:read`.

Sequence: Batch 6 (Codex, legacy e2e root cause) runs in parallel with the software-architect addendum for Batches 7-8; team-leader decomposes; executors per recommendation; independent logic/style review (cross-vendor) plus visual review.

After Batches 1-5 landed, the user asked for two more outcomes in this task:

1. Make the sidebar in the viewer collapsible, as the old editor panel did.
2. Every file link the agent sends, in normal markdown or in tool-call results, opens in Ptah's own viewer, with the old rendered markdown preview for markdown files. Do not bring back the full file-explorer tree.

Audit facts (orchestrator read-only audit, main at d6bb17151):

- The old editor panel (`05e725865^`, `editor-panel.component.ts:85-91,119-140,668-769`) had a PanelLeftClose/PanelLeft toggle and a 160-480 px resizable 256 px sidebar. Visibility was never persisted and had no shortcut. The current dock rail is a fixed `w-64` with no collapse.
- The old markdown preview (`code-editor.component.ts`, 3cedb0d7d / 571227a8a) was a Preview/Source toggle for `.md` that rendered through the `<markdown>` component with the chat `full` preset. There was no mermaid. No in-app file or markdown viewer exists today.
- The old Electron FilePathLink opened `EditorService.openFile` (no line). Since e1585fad9 it calls `file:open`, which launches an external editor, drops the line, and ignores failures.
- No frontend code intercepts anchor clicks in rendered agent markdown. Relative links probably navigate the Electron window to a `file:` URL (inferred). The sanitizer strips drive-letter, `file:` and `vscode:` hrefs.
- `file:read` exists on Electron only and has no workspace containment. `git:showFile` reads HEAD only.

## Orchestrator decisions on team-leader stress test (2026-09-11)

The user delegated technical decisions. These resolve the team-leader's Batches 7-8 defects:

1. Risk 1 accepted. External-editor opening for paths outside allowed roots uses a backend deny-list of credential locations (checked on the given and the realpath form) and an explicit confirm that shows the absolute path, on both hosts.
2. Risk 2 accepted. Link capture is opt-in through `data-ptah-file-links` on agent-output containers only. Harness-builder and setup-wizard transcripts stay unmarked.
3. Risk 3 resolved without a regression. VS Code `file:open` for an absolute path outside registered roots does not refuse. It shows the same modal confirm with the absolute path, subject to the deny-list, then opens. Relative paths still resolve only under a checked root.
4. Risks 4 and 5 accepted as written (DI manifests, complete `ClaudeRpcService.openFile` caller list).
5. Shared-worktree serialization: the `mkdir` lock at `D:/projects/ptah-extension/.claude/worktrees/ptah-413-nx.lock` is mandatory for every Nx and Playwright command. No batch runs Nx or e2e while Batch 6R is still running.
6. Rebase onto main stays blocked until the user authorizes commits.

## Tracking

Task carrier allocated atomically through Ptah in the primary workspace. The executor should copy this task's carrier and context into the isolated worktree without overwriting any existing files, then place all deliverables there. Do not allocate another task ID. Primary workspace record remains the discovery pointer; product implementation belongs only in the isolated worktree.
