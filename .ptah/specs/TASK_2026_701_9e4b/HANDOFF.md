# HANDOFF - TASK_2026_701_9e4b (session 2)

Session 2 ended 2026-10-25 at the user's request, after Batch 1. All planning gates are passed.
Batch 1 code exists in the worktree but is NOT verified clean and NOT committed.

## Goal

Align setup-wizard agent generation with the skills Library and enhancement flow (8 scope items,
see `context.md`): keep/replace overwrite guard (default keep), harness-root alignment, Library
refresh + provenance labels, Library edits vs. regeneration, explicit shared model setting,
prompt rubric alignment, "No grade" expectation, Marketplace plugin skills/agents in the same
flow. Electron first; visual reviews in Electron only, dark + light.

## Location

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment`
- Branch: `feat/wizard-library-alignment`, based on `38d9cc427`. `origin/main` is now `871d733e4`
  (one commit ahead; touches only `.codex/`, a SKILL.md and the TASK_2026_720 folder; no overlap).
- Task folder: `<worktree>\.ptah\specs\TASK_2026_701_9e4b`
- Commits: none. PR: none. The branch is local-only.
- `node_modules` in the worktree is now a junction to the main checkout (D17). Never run
  `npm install` in the worktree. Before `git worktree remove`, run `cmd /c rmdir node_modules`.

## Workflow state (orchestration skill, FEATURE, Full depth, approval mode `lane-review`)

| Phase | State | Artifact |
| ----- | ----- | -------- |
| Gate 1 | APPROVED (D5) | task-description.md, task-description-review.md |
| Gate 1.7 | APPROVED by codex round 2 (D13); user approved direction (D6) | design-spec.md ("Revise round 2"), prototype/, design-spec-review.md |
| Gate 2 | APPROVED by codex round 2 (D15) | implementation-plan.md (B1-B16, F1-F8, A1-A34, P1-P4), implementation-plan-review.md |
| Team-leader MODE 1 | Done: 26 batches (P1 1-9, P2 10-18, P3 19-25, P4 26) | batches.md (Batch 1 IN_PROGRESS) |
| Batch 1 (B1 shared contracts) | Code written by backend-developer; verify exit 1 (see below); not committed | reports/batch-1-report.md |
| Batches 2-26, reviews, visual review, PR | Not started | |

## Decisions this session (all in decisions.md)

- D12: TASK_2026_720_6f98 backlog folder is already on `main` (`871d733e4`). Nothing to commit.
- D13: Gate 1.7 passed. 3 Moderate prototype gaps stay in the prototype; implementation must
  still cover unreadable (forced Keep) and bulk pack states (Tasks 13.1 and 15.2).
- D14: A27 mitigation: one plugin-settings record per repository root; identical saved sub-folder
  configs import once; differing configs copy nothing, latest applies, F7i notice lets the user
  pick; nothing deleted.
- D15: Gate 2 passed. F7i notice and F6 link are outside the prototype -> Electron visual review.
- D16: CLI JSON-RPC schema constant `0.2` -> `1.0` with the D11 rename (Batch 2). Wire version
  stays `2.0`. Audit item for the user: overturn if a version bump is not wanted.
- D17: node_modules junction created (Batch 1 test failures came from its absence).
- D18: Batch 1 deviation accepted for team-leader review: the `GenerationAgentOutcome.status` /
  `ResumableGenerationAgent.status` widening moves to Batches 10/11 and 17.

## Batch 1 result (reports/batch-1-report.md)

- Changed: `libs/shared` only (index.ts, messages/*, origin-sidecar.types.ts, rpc.types.ts,
  rpc/*.types.ts, testing/index.ts + spec, new library-provenance.ts + spec,
  origin-sidecar.types.spec.ts, rpc-setup-decisions.types.ts, testing/fixtures/library-agreement.ts).
- `@ptah-extension/shared` lint/typecheck/test pass; all 8 projects typecheck.
- 7 test suites failed only because `node_modules` was missing (now fixed, D17) -> re-run.
- 1 webview lint error (circular dependency via `command-center/.../scene-contrast.spec.ts`),
  reported as pre-existing. Confirm it also fails on `main` before you accept that claim.

## Next steps

1. Re-run the Batch 1 check in the worktree (foreground, long timeout, tail the output):
   `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/setup-wizard,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview`
   The machine lock is shared with other sessions; a wait is normal.
2. Fresh team-leader MODE 2 with `reports/batch-1-report.md` (and D17/D18). It verifies and
   commits Batch 1 (foreground commit, `.commitlintrc.json`, subject <= 72 chars) and returns
   `### Next action:` for Batch 2 (B16: `keptLocalEdit` rename + schema 1.0).
3. Loop: executor subagent per batch (writes `reports/batch-N-report.md`) -> fresh team-leader
   MODE 2. Repeat the batch rules in every executor prompt: scoped verify only, never
   workspace-wide, never build/serve/e2e/package, Electron first, every host compiles,
   executors never commit or push.
4. At each phase end: host check `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`
   and one codex code-logic review on the phase diff (`code-logic-review.md`); style review in
   P1-P3 per batches.md. Codex lane prompts must be self-contained (fresh lanes, 40-call budget).
5. Electron visual review (dark, light, narrow) in P2 and P3, compared with prototype/; include
   F7i/F6 and keyboard focus, Tab confinement, Escape.
6. Team-leader MODE 3, then push + `gh pr create` in the background against `main` (title < 70
   chars, `## Summary` + `## Test plan`), watch CI and reviews. No merge, force push or worktree
   removal.

## Lanes

codex: confirmed room (weekly 12% at 2026-10-25). opencode: AT LIMIT until 2026-11-04.
Other lanes: limit unknown. `ptah_agent_spawn` in this build rejects `taskKind`/`routingSource`.
