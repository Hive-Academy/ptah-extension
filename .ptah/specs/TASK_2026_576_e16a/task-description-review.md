# Task Description Review - TASK_2026_576_e16a

- **Artifact**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_576_e16a\task-description.md`
- **Reviewed revision**: `2026-09-29T02:14:07.7690066+03:00`
- **Author**: in-process subagent: project-manager
- **Reviewer**: CLI lane: antigravity
- **Execution sides**: author in-process / reviewer CLI lane
- **Round**: 0
- **Verdict**: APPROVED

---

## Executive Summary

The requirements document for `TASK_2026_576_e16a` (overhaul of Ptah's git review experience across Electron and VS Code) is thorough, well-structured, and technically grounded. It directly translates user decisions, research synthesis findings, and the 14 ranked backend root causes into concrete, testable acceptance criteria without scope creep or architectural violations. The accompanying `parity-inventory.md` maps every existing capability in `libs/frontend/git-ui` with explicit decisions and verified citations.

The artifact is **APPROVED** to proceed to Gate 1 and the UI/UX design phase.

---

## Requirement Trace

| Requirement / Decision                                                                                                                                       | Source                               | Artifact Section                                                                 | Met? |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------- | ---- |
| Separate workflow from TASK_2026_555                                                                                                                         | `context.md:4`                       | Context (line 50), Scope (lines 138-139)                                         | Yes  |
| Build advanced & beautiful git UI alongside reliability fixes                                                                                                | `context.md:6`                       | Context (lines 29-40), Scope (lines 94-101), Requirements 4, 6, 7, 9, 10, 11, 12 | Yes  |
| Option A: git-first review loop + light diff renderer + spot editor + Open-in                                                                                | `context.md:44`                      | Scope (lines 79-109), Requirements 4-7, 10                                       | Yes  |
| Discard WebContainers (closed runtime, license risk, wrong problem)                                                                                          | `context.md:44`                      | Scope: Out of scope (lines 113-114)                                              | Yes  |
| Retain system git (no dugite or bundled binary)                                                                                                              | `context.md:44`                      | Scope: Out of scope (lines 115-116)                                              | Yes  |
| Chat transcript change-set card                                                                                                                              | `context.md:46`                      | Requirement 4 (lines 285-307)                                                    | Yes  |
| Review canvas (virtualized multi-file diff, changed-file tree, hunk accept/reject, line comments)                                                            | `context.md:46`                      | Requirement 6 (lines 337-373)                                                    | Yes  |
| Commit composer (AI message, inline hook output)                                                                                                             | `context.md:46`                      | Requirement 9 (lines 417-438)                                                    | Yes  |
| Task / worktree view (branch, ahead/behind, PR + CI status via `gh`)                                                                                         | `context.md:46`                      | Requirement 10 (lines 439-461)                                                   | Yes  |
| Conflict banner (Ask agent / Open in editor / Abort)                                                                                                         | `context.md:46`                      | Requirement 11 (lines 462-485)                                                   | Yes  |
| History timeline per task                                                                                                                                    | `context.md:46`                      | Requirement 12 (lines 486-505)                                                   | Yes  |
| Replace Monaco in review surface; CodeMirror 6 for spot editor                                                                                               | `context.md:47`                      | Requirement 7 (lines 374-398), Requirement 8 (lines 401-416)                     | Yes  |
| Re-measure `@pierre/diffs` vs `@codemirror/merge` in Nx webview build before commitment                                                                      | `context.md:47`                      | Requirement 3.2 (lines 274-280)                                                  | Yes  |
| VS Code host: no git-ui mount; change-set card calls `ptah.review.*` commands (`vscode.changes`, `vscode.diff`, `git.openMergeEditor`, `workbench.view.scm`) | `context.md:48`                      | Scope (lines 90-93), Requirement 5 (lines 308-336)                               | Yes  |
| Remove eager git-ui import in `app.config.ts:62-67`                                                                                                          | `context.md:49`                      | Requirement 3.1 (lines 268-273)                                                  | Yes  |
| Exclude workspace file tree, search-in-files, multi-tab editor, terminal, LSP                                                                                | `context.md:46-47`                   | Scope: Out of scope (lines 120-121)                                              | Yes  |
| Exclude in-app 3-way merge editor                                                                                                                            | `context.md:46`                      | Scope: Out of scope (lines 117-119)                                              | Yes  |
| RC 1: UI discards mutation results; commit checks transport instead of git success                                                                           | `git-backend-root-causes.md:321-323` | Requirement 1.1, 1.2 (lines 151-165)                                             | Yes  |
| RC 2: 10s timeout kills hook-running commands (commit, checkout, stash)                                                                                      | `git-backend-root-causes.md:324-326` | Requirement 1.3 (lines 166-171)                                                  | Yes  |
| RC 3: Git status failure/timeout renders as clean tree or "not a repo"                                                                                       | `git-backend-root-causes.md:327-329` | Requirement 1.4 (lines 172-178)                                                  | Yes  |
| RC 4: Status parser lacks `-z`; discard parses porcelain v1                                                                                                  | `git-backend-root-causes.md:330-332` | Requirement 1.5, 1.6 (lines 179-187)                                             | Yes  |
| RC 5: Watcher misses events outside Windows and in linked worktrees                                                                                          | `git-backend-root-causes.md:333-335` | Requirement 1.7 (lines 188-194)                                                  | Yes  |
| RC 6: Writes not serialized; `index.lock` not handled                                                                                                        | `git-backend-root-causes.md:336-338` | Requirement 1.8 (lines 195-200)                                                  | Yes  |
| RC 7: `git diff` inherits user config (`noprefix`, `textconv`), breaking `git apply`                                                                         | `git-backend-root-causes.md:339-341` | Requirement 1.9 (lines 201-204)                                                  | Yes  |
| RC 8: Push/pull/fetch 30s UI timeout vs 300s backend                                                                                                         | `git-backend-root-causes.md:342-344` | Requirement 1.10 (lines 205-210)                                                 | Yes  |
| RC 9: Branch switching too strict (dirty guard blocks `-b`, detaches HEAD on remote)                                                                         | `git-backend-root-causes.md:345-347` | Requirement 2.1 (lines 218-226)                                                  | Yes  |
| RC 10: Agent worktree repo pollution, missing remove/prune, un-scoped RPCs                                                                                   | `git-backend-root-causes.md:348-350` | Requirement 2.2 (lines 227-237)                                                  | Yes  |
| RC 11: Diff-tab refreshes fan out and dropped refreshes                                                                                                      | `git-backend-root-causes.md:351-353` | Requirement 2.3 (lines 238-242)                                                  | Yes  |
| RC 12: No merge/rebase/conflict/LFS awareness, diffs lack size limit                                                                                         | `git-backend-root-causes.md:354-356` | Requirement 2.4 (lines 243-250)                                                  | Yes  |
| RC 13: `GitInfoService` registered as transient in VS Code and CLI                                                                                           | `git-backend-root-causes.md:357-359` | Requirement 2.5 (lines 251-254)                                                  | Yes  |
| RC 14: Flag-injection guard ineffective against leading `-` in refs                                                                                          | `git-backend-root-causes.md:360-362` | Requirement 2.6 (lines 255-259)                                                  | Yes  |

---

## Findings

### Finding 1: Diff size limit threshold specification

- **Location**: `task-description.md:248-249` (Requirement 2.4)
- **Severity**: Minor
- **Description**: Requirement 2.4 specifies that _"A diff read of a file larger than a fixed size limit shall return a 'too large' result instead of sending the content."_ While Requirement 6.2 and 7.5 specify concrete thresholds for other boundaries (10,000 lines for virtualization, 512 KB for Markdown preview), the backend RPC diff size ceiling is stated qualitatively as "a fixed size limit".
- **Recommendation**: During Phase 2 architecture, the software architect should explicitly define this constant (e.g. 5–10 MiB, tightening the previous unbounded `readBlob` and unifying with `GitReviewReaderService`'s 64 MiB limit) to ensure backend and frontend expectations align.

### Finding 2: `index.lock` contention retry policy bounds

- **Location**: `task-description.md:198-200` (Requirement 1.8)
- **Severity**: Minor
- **Description**: Requirement 1.8 states that _"When a Ptah mutation meets an index.lock held by another process, it shall retry for a bounded time. If the lock remains, the user shall see 'Another git process is using this repository', never the raw stderr."_ The maximum retry duration and interval are not parameterized.
- **Recommendation**: The architect should prescribe a concrete bounded retry profile (e.g., 3 retries spaced with exponential backoff over a total window of 2000–3000 ms) so tests can deterministically simulate lock contention without lingering.

### Finding 3: Hexagonal boundary & security enforcement for VS Code commands

- **Location**: `task-description.md:324-330` (Requirement 5.5, 5.6)
- **Severity**: Minor (Positive Architecture Finding)
- **Description**: Requirement 5.5 strictly forbids adding `vscode.diff`, `vscode.changes`, or any other VS Code internal command to `ALLOWED_EXACT_COMMANDS` in `CommandRpcHandlers`, routing all review triggers through dedicated, workspace-validated `ptah.review.*` commands. This protects the webview-to-host isolation boundary and prevents path traversal outside workspace folders.

---

## Parity Check

`parity-inventory.md` was evaluated against the existing codebase:

1. **Completeness**: All 12 functional areas covering 116 capability rows have an explicit disposition: `keep`, `move`, or `remove-proposed`.
2. **Removals**: All 4 proposed removals are justified and documented in the "Proposed Removals" section:
   - Simultaneous multiple file-view tabs (subsumed by single-file spot editor + continuous canvas diff, respecting the "no multi-tab editor" boundary).
   - `SourceControlService.getOriginalContent` (dead code with no callers in the workspace).
   - `GitBranchesService.refreshTags` (dead code with no callers in the workspace).
   - `MonacoLoaderService` & `monaco-theme.ts` (consequence of user-mandated Monaco removal).
3. **Spot-Check Verification**: 10 distinct `file:line` references across the monorepo were verified against real source code:
   - `apps/ptah-extension-webview/src/app/app.config.ts:62-67` — Eager import of `git-ui` services: **Verified** (lines 62-67).
   - `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:366-382` — Dynamic import of `GitDockComponent`: **Verified** (lines 366-382).
   - `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts:235-245` — Event arming on mount and unhook on destroy: **Verified** (lines 235-245).
   - `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts:57-83` — Rail toggle button and layout service persistence: **Verified** (lines 57-83).
   - `libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts:457-496` — Swallowed mutation promises and transport success bug: **Verified** (lines 457-496).
   - `libs/frontend/git-ui/src/lib/worktree/worktree-section.component.ts:150-205` — Invalid nested `<button>` interactive control: **Verified** (lines 150-205).
   - `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:55-95` — Stash dialog template and listing: **Verified** (lines 55-95).
   - `libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts:39-52` — Dirty branch force-checkout confirmation: **Verified** (lines 39-52).
   - `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts:482-567` — Hunk revert top-layer modal `<dialog>`: **Verified** (lines 482-567).
   - `libs/frontend/git-ui/src/lib/services/source-control.service.ts:100-111` — `getOriginalContent` wrapper: **Verified** (lines 100-111).
     All citations matched line-for-line.

---

## Lane-Introduced Constraints

The following constraints in `task-description.md` represent technical and engineering requirements introduced by the authoring lane (PM) rather than direct user requests:

1. **Virtualization Scalability Thresholds (Requirement 6.2)**: Requires the canvas to remain responsive and scrollable with at least 200 changed files or 10,000 changed lines, enforcing off-screen culling.
2. **Accessibility Compliance Gate (Non-functional Requirements)**: Mandatory automated axe-core scanning with zero critical or serious accessibility violations across both light and dark themes.
3. **Performance Startup TTI Metric (Non-functional Requirements)**: Cold reload to interactive review canvas time measured via `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts` must not regress against base commit.
4. **Rate-Limiting Safeguard (Requirement 10.5)**: GitHub PR/CI status polling capped to at most once per minute while the view is visible.
5. **Draft Comment Persistence (Requirement 6.7)**: Unsent line review comments must survive closing and reopening the review canvas within the same app session.
6. **Empirical Renderer Benchmark Gate (Requirement 3.2)**: Mandates exact measurement of initial and lazy gzip bundle sizes for `@pierre/diffs` versus `@codemirror/merge` in the production Nx webview build before review-canvas implementation.
7. **Strict Boundary Defense (Requirement 5.5)**: Disallows extending `command:execute` allowlist for native VS Code commands.

All lane-introduced constraints are constructive, follow monorepo engineering standards, and protect system reliability.

---

## Unresolved Items

The 6 open questions articulated in `task-description.md:592-610` are properly assigned for resolution at Gate 1 or subsequent specialist phases:

1. **P1 Standalone Track**: Whether P1 (Reliability Core) ships as an independent task/PR ahead of UI work (Recommended: Yes; user decision at Gate 1).
2. **PR Creation Extension**: Whether `gh pr create` with AI summary should be scheduled as the immediate follow-up task (User decision at Gate 1).
3. **Review Comment Batching**: Whether line comments send immediately or collect into a review batch (Assigned to `ui-ux-designer`).
4. **AI Commit Message Provider**: Fallback model/provider strategy when active session provider is unavailable (Assigned to `software-architect`).
5. **History Timeline Scope**: Scope definition for task worktree vs main checkout (Assigned to `ui-ux-designer`).
6. **Claude Agent SDK Worktree Hook Invariant**: Verification whether SDK handles directory removal internally or requires Ptah-side deletion (Assigned to researcher/backend developer).
