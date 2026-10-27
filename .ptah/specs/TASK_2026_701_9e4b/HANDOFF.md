# HANDOFF - TASK_2026_701_9e4b (session 8)

Session 8 ended 2026-10-26 (token budget). Nothing is pushed. One Batch 19 subagent may still be
running (see Background work).

## Goal

Align setup-wizard agent generation with the skills Library and enhancement flow (8 scope items,
see `context.md`): keep/replace overwrite guard (default keep), harness-root alignment, Library
refresh + provenance labels, Library edits vs. regeneration, explicit shared model setting,
prompt rubric alignment, "No grade" expectation, Marketplace plugin skills/agents in the same
flow. Electron first; visual reviews in Electron only, dark + light.

## Location

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment`
- Branch: `feat/wizard-library-alignment`, base `38d9cc427`. Local only: no push, no PR yet.
- Task folder T: `<worktree>\.ptah\specs\TASK_2026_701_9e4b`
- `node_modules` in the worktree is a junction to the main checkout (D17). Never `npm install`
  there. Before `git worktree remove`, run `cmd /c rmdir node_modules`.

## Workflow state (orchestration skill, FEATURE, Full, approval mode `lane-review`)

Gates 1, 1.7, 2: APPROVED. User decisions D3, D6-D11 are final; do not ask again.
Executors: Claude subagents. Reviewers: codex lanes (review family codex, implementer family Claude).
Accepted pre-existing failures: `ptah-extension-webview:lint` (D19), `@ptah-extension/agent-sdk:lint`
(D21), degradation-audit flag `apps/ptah-electron/src/ipc/ipc-bridge.ts:324`.

## Done in session 8 (verified)

Commits (on top of `ac227e30f` Batch 17):
- `74501c8d2 fix(cli,platform-core,rpc-handlers,agent-generation): p2 backend fixes` (A1-A4, S1, S2;
  report `T/reports/p2-fix-round-backend-report.md`).
- `be9f73ef8 fix(setup-wizard): p2 frontend fixes` (B1, B2/B4, B5, S1, M1; plus a stale
  `completion.component.spec.ts` expectation fixed for B5 safe copy; Batch 17 SHA added in batches.md).
- `dcbfee9ac` merge of `origin/main` (no file overlap; brings the 2-slot memory-gated verify lock,
  CLAUDE.md verify rules updated).
- `6bba1367a fix(platform-core,agent-generation): serialize Ptah destination writes` (A2 closure:
  `libs/backend/platform-core/src/utils/destination-write-lock.ts`, used by
  `file-writer.service.ts` and `agent-pack-download.service.ts`; report `T/reports/p2-a2-completion-report.md`).

Verification:
- Combined verify before the commits (15 projects incl. all hosts): `92 tasks: 90 succeeded, 2 failed`
  = D19 webview lint + setup-wizard completion spec (then fixed; setup-wizard test re-run passed).
- After A2: `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/agent-generation,@ptah-extension/rpc-handlers,ptah-cli,ptah-electron,ptah-extension-vscode,ptah-tui`
  -> `68 tasks: 68 succeeded`. NOTE: an earlier run of the same command showed 10 false failures
  because the Bash background limit (600 s) killed it; run long verifies in the background with
  `timeout: 3600000`.

Reviews (codex):
- `T/reviews/p2-fix-rereview.md`: REVISE 6/10, 10 of 11 FIXED, A2 PARTIAL -> closed by 6bba1367a.
- `T/reviews/p2-a2-rereview.md`: A2 FIXED, `Verdict: APPROVED — 8/10`, no new defects. **P2 is closed.**
- decisions.md: D33 added (uncommitted) for this round.

## In progress (uncommitted, do not lose)

**Batch 19 (P3, backend-developer subagent)**: Tasks 19.1 + 19.2 per `T/batches.md` "## Batch 19".
Uncommitted files at session end:
- M `apps/ptah-cli/src/di/container.smoke.spec.ts`, `apps/ptah-electron/src/di/container.smoke.spec.ts`,
  `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`
- M `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` (+ spec),
  `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
- NEW `libs/backend/rpc-handlers/src/lib/handlers/marketplace/`, `.../handlers/skill-synthesis/`
The subagent was waiting on its own verify run; its report `T/reports/batch-19-report.md` did NOT
exist yet. Completeness and compile state are UNKNOWN until that report exists.

Other uncommitted task files: `T/decisions.md` (D33), `T/reviews/p2-a2-rereview.md`. Patch files
`T/reviews/*.patch` are reviewer inputs; do not commit them.

## Open items

- Deferred to TASK-P2-FOLLOWUP (D32): B3, B6, B7, B8, completion rows in parity-inventory.md, and the
  frontend notes: raw error `console.warn` in setup-wizard; proposed removal of
  `SetupWizardStateService.agentInstallStatus`/`setAgentInstallStatus` (needs user approval);
  `completion.component.ts:159-160` still renders raw `completion().errors`.
- D22 still open for the user: `~/.ptah/harness/state.json` `agentSyncEnabled: false`.
- D31: the Electron visual review needs the user to start the app (or allow `dev`).

## Background work

- Batch 19 backend-developer subagent (Agent tool, background, started ~17:35 UTC). It belongs to the
  previous session and cannot be resumed from a new session. Check: does `T/reports/batch-19-report.md`
  exist? If not, treat Batch 19 as partial (see Next step 1).
- No codex lane is running. Last codex session ids: `01a1791e-abff-7bd1-97a0-ee18de8b839a` (P2
  re-review), `01a17947-c8d2-7a21-9f0c-d728d9ae1125` (A2 re-check). Resume often starts fresh when the
  history is over 60k tokens; give full instructions.

## Lanes

codex: room (weekly 36% at 2026-10-26, resets 2026-11-02). opencode: AT LIMIT until 2026-11-04.
`ptah_agent_spawn` rejects `taskKind`/`routingSource`: omit them. Codex reviewers cannot run git:
give them patch files. Lane signals from other worktrees (chat-layout-declutter, etc.) are NOT this task.

## Next steps

1. Batch 19: if `T/reports/batch-19-report.md` exists, read it. If not, start a fresh
   backend-developer subagent to audit the uncommitted Batch 19 files against Tasks 19.1/19.2 in
   `T/batches.md`, finish what is missing, and write that report (must not touch libs/frontend or
   the A2 lock files). Then verify (background, `timeout: 3600000`):
   `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli > /tmp/b19.log 2>&1; echo "exit $?"; sed 's/\x1b\[[0-9;]*m//g' /tmp/b19.log | grep -E "Running target|tasks:|✖|error TS" | head -20`
2. Commit Batch 19 in the foreground with explicit paths (scope `rpc-handlers` plus `electron`/`cli`
   as needed per `.commitlintrc.json`), include `T/decisions.md`, `T/reviews/p2-a2-rereview.md`,
   `T/reports/batch-19-report.md`, this HANDOFF.md; mark Batch 19 COMPLETE with SHA in batches.md.
   End message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
3. Batches 20 -> 21 -> 22/23 -> 24/25 in order per `T/batches.md` (20 backend; 21-25 frontend;
   22 depends on 19 only). Each: subagent, its batch verify command, commit.
4. P3 phase review: one codex code-logic review on the P3 diff (patch file) + style review for the
   new RPCs (Batch 20). One fix round, one short re-review.
5. P4 (Batch 26) + codex logic review. Then the combined Electron visual review (D31, D15: F7i
   notice states, F6 link; dark, light, ~400px) — needs the user to start Electron.
6. Team-leader MODE 3, then push + `gh pr create` in the background against `main` (title < 70
   chars, `## Summary` + `## Test plan` with real results, end with the Claude Code line). Watch CI
   and reviews; fix confirmed findings. No merge, force push or worktree removal.

Rules for every lane and subagent: scoped `npm run verify -- -p ...` only, one run, output
filtered; never workspace-wide; never build/serve/dev/e2e/package; Electron first; keep every host
compiling; executors never commit/push or edit batches.md/task.md/decisions.md; never git
stash/restore/checkout/reset/clean; specs never write outside a temp or mocked root; never
`npm install` in the worktree. Parallel executors in one lib run only their own specs; the
orchestrator runs the combined verify.
