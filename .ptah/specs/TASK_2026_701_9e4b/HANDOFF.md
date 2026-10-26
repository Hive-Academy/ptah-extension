# HANDOFF - TASK_2026_701_9e4b (session 5)

Session 5 ended 2026-10-26 (session-handoff). No subagent or lane of this task is running.
Batches 13, 16 and 18 are implemented and NOT committed. Nothing is pushed.

## Goal

Align setup-wizard agent generation with the skills Library and enhancement flow (8 scope items,
see `context.md`): keep/replace overwrite guard (default keep), harness-root alignment, Library
refresh + provenance labels, Library edits vs. regeneration, explicit shared model setting,
prompt rubric alignment, "No grade" expectation, Marketplace plugin skills/agents in the same
flow. Electron first; visual reviews in Electron only, dark + light.

## Location

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment`
- Branch: `feat/wizard-library-alignment`, base `38d9cc427`. Local only: no push, no PR yet.
- Task folder: `<worktree>\.ptah\specs\TASK_2026_701_9e4b`
- `node_modules` in the worktree is a junction to the main checkout (D17). Never `npm install`
  there. Before `git worktree remove`, run `cmd /c rmdir node_modules`.

## Workflow state (orchestration skill, FEATURE, Full, approval mode `lane-review`)

Gates 1, 1.7, 2: APPROVED. User decisions D3, D6-D11 are final; do not ask again.
Executors: Claude subagents (backend-developer / frontend-developer). Reviewers: codex lanes.
Accepted pre-existing failures: `ptah-extension-webview:lint` (D19), `@ptah-extension/agent-sdk:lint`
(D21, `session-query-executor.accounts.spec.ts:174,183`), degradation-audit flag
`apps/ptah-electron/src/ipc/ipc-bridge.ts:324` (not changed on this branch).

### Commits on the branch (oldest first)

| Batch | SHA | Subject |
| ----- | --- | ------- |
| 1-10, 8b, 14 | 2596f6fc4 .. 493027b0e | see `git log` (12 commits) |
| P1 fix round | 16042c885 | fix(harness-sync,agent-sdk,agent-generation): address P1 review findings |
| 11 | e62d1dfe8 | feat(rpc-handlers): batch 11 - generation preview service |
| P1 B2 correction | eae561cf6 | fix(agent-generation): treat disabled plugins as ambiguous owners |
| 12 | e55e7c962 | feat(rpc-handlers,agent-generation,shared): batch 12 - run decisions |

Verification before these commits (session 5):
- Fix round + Batch 11 + host smoke stubs: `73 tasks: 72 succeeded, 1 failed` (D21 only).
- B2 correction + Batch 12: `74 tasks: 73 succeeded, 1 failed` (D19 only).

**P1 phase is CLOSED.** Codex re-reviews of 16042c885: A APPROVED, style APPROVED, B REVISE
(B2 partial) -> one bounded B2 correction -> codex check APPROVED (D28). Files in `reviews/`.

## In progress (uncommitted in the worktree, file-disjoint, do not lose)

1. **Batch 13** (community pack plan + guarded install, B8), report `reports/batch-13-report.md`.
   Its own scoped verify passed (`67 tasks: 67 succeeded`, second run). Audit: platform-core 7->6,
   rpc-handlers 1. Files: NEW `libs/backend/rpc-handlers/src/lib/handlers/setup/`; MODIFIED
   `libs/backend/platform-core/src/{agent-pack-download.service.ts,+spec,index.ts}`,
   `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.{handlers,schema}.ts` (+ specs),
   `register-shared-rpc-handlers.ts`, `rpc-allowlist.spec.ts`, `libs/shared/src/lib/types/rpc.types.ts`,
   `apps/ptah-electron/src/di/rpc-surface.spec.ts`, `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`,
   `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts` (deviation),
   `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`.
   Note for Batch 15: `wizard:install-pack-agents` refuses any Replace without a plan; the UI must
   call `wizard:plan-pack-install` first and send `planToken`, `decisions` (with row `revision`), `target`.
2. **Batch 16** (sidebar preview dialog, F3), report `reports/batch-16-report.md`. Code and specs
   written; the report's Verification section is EMPTY: the subagent stopped when session 5 ended,
   before its verify finished. Files: `libs/frontend/setup-wizard/src/lib/components/{agent-preview-dialog,agent-selection-list}.component.ts`
   (+ specs), `services/generation-workflow.store.ts` (+ spec), `services/wizard-rpc.service.ts`
   (+ spec; out-of-list edit approved as D29).
3. **Batch 18** (CLI kept-file output, F8), report `reports/batch-18-report.md`. Verify passed
   (`npm run verify -- -p ptah-cli,ptah-tui` 45/45). Files: `apps/ptah-cli/src/cli/commands/{agent,wizard}.ts` (+ specs).
   Two items for the P2 logic review: `ptah agent apply` still overwrites a file whose content
   differs; `agent.pack.install.complete` can report `changed: true` when every file was kept.
4. Task-folder files: `batches.md` (Batch 12 SHA line; Batches 13/16/18 marked IN_PROGRESS),
   `decisions.md` (D29 added), the 3 reports above, this file.

## Decisions added in session 5 (decisions.md)

- D24-D26: from session 4 (Zod audit helper, CLI B3 fix, parallel fix round).
- D27: host `container.smoke.spec.ts` minimal containers lacked an `AGENT_ORIGIN_STORE` stub; fixed
  in the 3 hosts (committed with Batch 11).
- D28: P1 re-review outcome and bounded B2 correction (ambiguity counts installed + disabled plugins
  via `getPluginSourceDescriptors()`; ambiguity only logged, no UI counter = Minor, recorded).
- D29: Batch 16 may add optional `decisions` param to `WizardRpcService.startBoundAgents`.
- Batch 12 decisions for the P2 review are in `batches.md` "Batch 12 outcome" (origin record via
  orchestrator after-write callback for harness-root runs; guards in orchestrator `mode` shape;
  retry ending `kept` = success). `wizard-analysis-runner.service.ts:38` (kept/changed shown as
  pending on resume) is assigned to Batch 17.
- D22 still open for the user: `~/.ptah/harness/state.json` has `agentSyncEnabled: false` from a
  Batch 5 spec draft; tell the user, delete the key if wanted.

## Lanes

codex: confirmed room (weekly 8% at 2026-10-26 ~10:40 UTC, resets 2026-11-02). opencode: AT LIMIT
until 2026-11-04. Old codex review sessions were too large to resume; new session IDs:
A `01a177cf-4363-7941-a157-801a6238d384`, B `01a177cf-60ff-7411-8db8-7120b06d18de`,
style `01a177cf-84f7-77e2-90db-4ce091e7ba66`. Codex reviewers cannot run git: give file lists.
Lane signals from the `chat-layout-declutter` worktree may arrive; they are NOT this task. Ignore.

## Background work

None of this task. The Batch 16 subagent is stopped (see In progress item 2).

## Verify lock change (PR #828 merged into main)

The verify lock now runs up to 2 checks at once with a memory gate (`PTAH_VERIFY_SLOTS=2`,
`PTAH_VERIFY_MIN_FREE_GB=8`, `PTAH_VERIFY_SETTLE_SEC=30`). The worktree's own `scripts/verify.mjs`
still works (slot 0). At the next safe point (everything committed), merge `origin/main` into the
branch, then read the updated CLAUDE.md "STRICT: Verification commands".

## Next steps

1. Finish Batch 16 verification: start a fresh frontend-developer with `reports/batch-16-report.md`
   and the Batch 16 section of `batches.md`; it runs the Batch 16 verification command, fixes only
   its own failures, and fills the report's Verification section. (Or run the combined verify in
   step 2 first and send only the failures.)
2. Combined verify for 13 + 16 + 18 (one foreground run, long timeout):
   `npm run verify -- -p @ptah-extension/shared,@ptah-extension/platform-core,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/setup-wizard,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Running target|tasks:|✖|full log"`
   Accept D19/D21 only. For a failure, grep its `full log:` file for `FAIL |● |error`.
3. Fresh team-leader MODE 2 with the 3 reports: commit Batch 13, then 16, then 18 (separate commits,
   foreground, explicit paths, `.commitlintrc.json` scopes, Co-Authored-By line). Batch 18 is the
   last P2 batch per batches.md, but 15 and 17 are still open; commit 18 now and treat the P2
   phase review as due after 15 and 17.
4. Batches 15 and 17 in parallel (both depend on 13; file-disjoint in setup-wizard; 17 also owns
   `wizard-analysis-runner.service.ts`). Then combined verify and team-leader MODE 2.
5. P2 end: `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`,
   codex logic + style review of the P2 diff (include the Batch 18 and Batch 12 review items), and
   Electron visual review (dark, light, narrow ~400px) of wizard preview, sidebar dialog, pack prompt
   and completion vs. `prototype/`. One fix round, one short re-review.
6. Merge `origin/main` into the branch at a committed safe point (verify lock change).
7. P3 (Batches 19-25), same pattern; visual review must include the F7i notice states and the
   F6 link (D15). P4 (Batch 26) with a codex logic review.
8. Team-leader MODE 3, then push + `gh pr create` in the background against `main` (title < 70
   chars, `## Summary` + `## Test plan` with real results, end with the Claude Code line). Watch
   CI and reviews; fix confirmed findings. No merge, force push or worktree removal.

Rules for every lane and subagent: scoped `npm run verify -- -p ...` only, one foreground run,
output filtered; never workspace-wide; never build/serve/dev/e2e/package; Electron first; keep
every host compiling; executors never commit/push or edit batches.md/task.md/decisions.md;
specs never write outside a temp or mocked root; never `npm install` in the worktree.
