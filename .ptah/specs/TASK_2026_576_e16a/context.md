# Task Context - TASK_2026_576_e16a

## User Request

"yep lets start that workflow but in a separate workflow don't worry about task 555 its related to another session"

Earlier in the same conversation: "for git integration i think we nedd to build a more advanced and beautiful ui for it beside all the fixes you mentioned if we are going to go with that ?"

## Task Type

FEATURE

## Complexity

Complex

## Strategy

Full FEATURE flow, UI redesign of an existing surface:
PM (task-description.md + parity-inventory.md from OLD git-ui code) → cross-side review → Gate 1 → ui-ux-designer (design-spec.md + prototype/) → cross-side review → Gate 1.7 → software-architect (implementation-plan.md) → cross-side review → Gate 2 → team-leader (batches, backend + frontend tracks in parallel) → QA (Gate 3).

Inputs (read synthesis.md first): `D:\projects\ptah-extension\research_notes\In app editor alternatives\`

- synthesis.md
- git-backend-root-causes.md
- reference-products-and-diff-libs.md
- bundle-measurements-and-vscode-path.md
- current-ptah-surface.md
- agentic-product-patterns.md
- lightweight-editor-libraries.md
- webcontainers-and-runtimes.md

## CLI Lanes

Gate 0.1 outcome: **enabled**, restricted by the user to **Glm** (ptah-cli, ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164) and **antigravity** (cli). Do not use codex, opencode, copilot. Lanes work along with subagents: subagents author and own deliverables; lanes do focused sub-tasks and the cross-side document reviews.

`ptah_agent_list` rows (2026-09-29):

| Agent       | Type     | Status                                                                      |
| ----------- | -------- | --------------------------------------------------------------------------- |
| codex       | cli      | installed                                                                   |
| copilot     | cli      | disabled (installed)                                                        |
| cursor      | cli      | not installed                                                               |
| antigravity | cli      | installed                                                                   |
| opencode    | cli      | installed                                                                   |
| pi          | cli      | not installed                                                               |
| Glm         | ptah-cli | available (Ollama Cloud, ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164) |

## Conversation Summary

- Decision: option A (git-first review loop + light diff renderer + spot editor + Open-in). WebContainers discarded for editor/git (wrong problem, closed runtime, license). Keep system git; no dugite.
- The user wants a more advanced, polished git UI in addition to the reliability fixes.
- Proposed UI surfaces: change-set card in the chat transcript; review canvas (`@pierre/diffs` virtualized multi-file diff, changed-file tree, per-hunk accept/reject via `git:applyHunks`, line comments sent to the agent); commit composer (AI message, inline hook output); task/worktree view (branch, ahead/behind, PR + CI status); merge/rebase conflict banner (Ask agent / Open in editor / Abort); history timeline per task.
- Replace Monaco in the review surface; CodeMirror 6 for the spot editor. `@pierre/diffs` must be re-measured in the Nx webview build before commitment; fallback `@codemirror/merge`.
- VS Code host: no git-ui mount. Change-set card with buttons that call new `ptah.review.*` commands, which open `vscode.changes`, `vscode.diff`, `git.openMergeEditor`, `workbench.view.scm`.
- Remove the eager git-ui import in `apps/ptah-extension-webview/src/app/app.config.ts:62-67`.
- TASK_2026_555 is unrelated (another session). Do not touch it.

## Gate decisions

- **Gate 1 — APPROVED** by the user ("approved"), 2026-09-29, against task-description.md revision 2026-09-29T02:14 (review: task-description-review.md, antigravity, APPROVED, round 0).
  - The user gave no separate answers to the three open decisions. Orchestrator defaults, stated to the user:
    1. The four `remove-proposed` rows in parity-inventory.md are approved as part of the approved document.
    2. P1 stays in this task but ships as its own PR ahead of the UI phases (phase gate), per the PM recommendation.
    3. PR creation from Ptah stays out of scope; no follow-up task is created until the user asks.
- **Gate 1.7 — APPROVED** by the user ("approved"), 2026-09-29, against design-spec.md + prototype/ revision 1 (review: design-spec-review.md, antigravity, round 0 REVISE → round 1 APPROVED; a first Glm review attempt failed — model has no image input). Open items handed to the architect:
  1. Single-letter status badges (A/M/R) fail AA (design-spec §13a) — fix inside the implementation plan.
  2. Intra-line change highlight must mark only the changed words (prototype shows a whole-expression highlight).
  3. The design names Angular CDK Dialog + FocusTrap; project rule prefers `libs/frontend/ui` Native* primitives over new CDK usage — architect resolves.
- **Gate 2 — APPROVED** by the user ("approved"), 2026-09-29, against implementation-plan.md (review: implementation-plan-review.md, antigravity, APPROVED, round 0). No choices given → defaults: Clarification 1 = (a) neutral status chip with coloured accent; Clarification 2 = (a) commit message rides the active provider, no new setting. Reviewer minor findings carried to implementation: Windows `stat.ino` (use bigint stats or mtimeMs+size), register review commands next to `licenseCommands` (`ptah-extension.ts:78`).
- **Standing authorization (user, 2026-09-29)**: "next time when you want my approval you can ask a different family lane to review and approve". From now on, a gate that would ask the user for approval is instead decided by an independent lane of a different family from the reviewer/author (Glm ↔ antigravity), recorded in the task folder and reported to the user. Limits the orchestrator keeps: never commit to or merge into `main`, never push or open a PR, never bypass hooks, and never approve a removal outside the approved parity list without asking the user.
- **Review cadence P2 → cutover (user, 2026-09-30, "Per phase")**: batches inside a phase get only typecheck, lint, scoped unit tests (plus real-git specs when git behaviour changes) and the pre-commit hook, then the team-leader commits them. No lane review and no e2e per batch. At each phase end (P2, P3, P4, P5, cutover): one cross-side review lane on the phase diff, the full e2e set, and a visual review for UI phases; findings are fixed in follow-up commits. No early wiring: new UI stays unmounted until the cutover (Batch 58). P1 keeps its per-batch reviews (already done).
- **Stacked phase branches (user, 2026-09-30, "lets stack the phases")**: one branch and one PR per phase, each based on the previous phase's branch, so work does not wait for a merge. P1 = `feat/task-2026-576-git-review`, frozen at `b0a9b6f28` for its PR. P2 = `feat/task-2026-576-p2` from `b0a9b6f28`, worked in the main checkout (a fresh worktree has no node_modules). P1 PR review fixes go on the P1 branch (in a separate worktree); then P2 is rebased on it. When P1 merges, P2 is rebased onto `main` and its PR targets `main`. P3, P4, P5 and the cutover follow the same pattern. "Depends on: P1 merged" now means "stacked on the P1 branch".
- Branch: `feat/task-2026-576-git-review` created from `main` 722d921ab in the main checkout. P1 ships as its own PR (the user opens/merges PRs).
- research-report.md decisions: renderer `@pierre/diffs` (~189 KB gz realistic first diff in the real Nx build; `@codemirror/merge` 145 KB gz fallback); VS Code 1.100 APIs all present; SDK `WorktreeRemove` hook does not fire for Ptah's git worktrees (RC10 needs poll/watch detection); commit message via `SdkQueryRunner.runOneShot` + `IProviderAuthResolver`, falling back to the active provider.
