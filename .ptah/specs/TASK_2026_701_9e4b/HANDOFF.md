# HANDOFF - TASK_2026_701_9e4b (session 6)

Session 6 ended 2026-10-26 (token budget). No subagent or CLI lane of this task is running.
Batches 15 and 17 are implemented and NOT committed. Nothing is pushed.

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
Accepted pre-existing failures: `ptah-extension-webview:lint` (D19, circular dependency
webview <-> command-center), `@ptah-extension/agent-sdk:lint` (D21), degradation-audit flag
`apps/ptah-electron/src/ipc/ipc-bridge.ts:324` (not changed on this branch).

### Commits on the branch (newest first)

| Batch | SHA | Subject |
| ----- | --- | ------- |
| 18 | 11c5df630 | feat(cli): batch 18 - kept-file output |
| 16 | a0b61b0e6 | feat(setup-wizard): batch 16 - sidebar preview decisions |
| 13 | ccb672f6e | feat(platform-core,rpc-handlers,shared): batch 13 - pack plan install |
| 12 | e55e7c962 | feat(rpc-handlers,agent-generation,shared): batch 12 - run decisions |
| 1-11, 8b, 14, P1 fixes | 2596f6fc4 .. eae561cf6 | see `git log` |

`batches.md`: 17/27 complete. The Batch 18 heading says `COMPLETE (commit: see git log "batch 18")`;
replace it with `11c5df630` in the next batches.md edit.
Combined verify before the 13/16/18 commits: `77 tasks: 76 succeeded, 1 failed` (D19 only).
P1 phase is CLOSED (see session 5 notes in `reviews/` and D28).

## In progress (uncommitted in the worktree, do not lose)

1. **Batch 15** (F2 preview modal + F4 pack install prompt), report `reports/batch-15-report.md`.
   NEW `components/generation-preview-modal.component.ts`, `components/pack-install-prompt.component.ts`
   (+ specs); MODIFIED `components/agent-selection.component.ts`, `components/community-packs-panel.component.ts`,
   `services/wizard-rpc.service.ts` (+ specs). All paths under `libs/frontend/setup-wizard/src/lib/`.
   Own spec run: 15 suites, 206 tests pass.
2. **Batch 17** (F5 completion surfaces), report `reports/batch-17-report.md`.
   NEW folder `components/completion/` (outcome-summary, library-stale-notice, grade-expectation + specs);
   MODIFIED `components/agent-next-steps.component.ts`, `components/completion.component.ts`,
   `services/wizard-analysis-runner.service.ts` (Batch 12 resume fix), and via D30
   `services/setup-wizard-state.types.ts`, `services/setup-wizard/wizard-phase-generation.ts` (+ specs).
   Own spec run: 7 suites, 94 tests pass.
3. **Orchestrator lint fixes (session 6)** in Batch 17 files, after the combined verify
   (`npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview,ptah-electron` ->
   `15 tasks: 13 succeeded, 2 failed`: D19 + `setup-wizard:lint` with 3 `no-useless-escape` errors):
   - `completion.component.ts:366` `split(/[\/]/)` -> `split(/[\\/]/)` (also splits Windows `\` paths;
     a behavior fix, include it in the P2 logic review).
   - `wizard-phase-generation.spec.ts:219-220` `'D:\ws'` -> `'D:\\ws'`.
   Re-run after the fix: `npm run verify -- -t lint,test -p @ptah-extension/setup-wizard` ->
   `2 tasks: 2 succeeded`. Typecheck after the fix was not run (step 1 covers it).
4. `decisions.md`: D30 added (uncommitted). Batch 15/17 status lines in `batches.md` are still PENDING.

## Open items for the P2 review (collect them in the review prompt)

- Batch 18: `ptah agent apply` still overwrites a file whose content differs;
  `agent.pack.install.complete` can report `changed: true` when every file was kept.
- Batch 12 outcome decisions in `batches.md` "Batch 12 outcome".
- D30 backend gap: the backend attaches `result` (target, libraryPass, libraryDiverged) only to
  tab-bound runs (`wizard-generation-run.supervisor.ts:328`, `wizard-generation-rpc.handlers.ts:919`).
  The wizard-view completion page shows the summary but no grade/diverged/stale copy. Needs a
  backend fix batch (not yet assigned; decide it in the P2 fix round or as a named later task).
- Batch 17: `generation-agent-sidebar.component.ts:110-150` still shows its own raw results list,
  which duplicates the new summary. The completion page's old agent tiles were replaced by the
  outcome summary: check `parity-inventory.md` covers this (no unapproved removal).
- Batch 17 design deviations: no Retry button; kept files carry no "could not read" reason;
  "Open the Library" only inside the diverged callout.
- Batch 15: "Kept" status for pack files lives in each host component, because
  `SetupWizardStateService` has no `kept` status (lost when the component is re-created). The
  prompt runs plan + install itself and closes on confirm.
- `completion.component.ts:366` regex change (above).

## Decisions added in session 6

- D30: Batch 17 may edit `setup-wizard-state.types.ts` and `wizard-phase-generation.ts` (+ spec) to
  carry `result` into `CompletionData`; safe default when `result` is absent; backend gap deferred.
- D22 still open for the user: `~/.ptah/harness/state.json` has `agentSyncEnabled: false` from a
  Batch 5 spec draft; the user may delete the key.

## Lanes

codex: room (weekly ~8% at 2026-10-26, resets 2026-11-02). opencode: AT LIMIT until 2026-11-04.
Codex review session IDs (may be too large to resume; start fresh if so): A
`01a177cf-4363-7941-a157-801a6238d384`, B `01a177cf-60ff-7411-8db8-7120b06d18de`, style
`01a177cf-84f7-77e2-90db-4ce091e7ba66`. Codex reviewers cannot run git: give them file lists.
Lane signals from the `chat-layout-declutter` worktree are NOT this task. Ignore them.

## Verify lock note

The worktree's `scripts/verify.mjs` is the old single-slot lock (main has the 2-slot memory-gated
lock from PR #828). After everything is committed, merge `origin/main` into the branch, then read
the updated CLAUDE.md "STRICT: Verification commands".
Note: a single `--testPathPatterns="a|b"` regex can match too few suites in this shell; pass one
`--testPathPatterns=<name>` flag per suite.

## Next steps

1. Re-run the setup-wizard check (an Nx cache hit if the queued run finished):
   `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview,ptah-electron 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Running target|tasks:|✖|full log"`
   Accept D19 only. For a failure, grep its `full log:` file for ` error |FAIL |● `.
2. Fresh team-leader MODE 2 with `reports/batch-15-report.md`, `reports/batch-17-report.md` and the
   verify result: commit Batch 15, then Batch 17 (include the orchestrator lint fixes and D30 files,
   `decisions.md`, this HANDOFF.md), foreground, explicit paths, `.commitlintrc.json` scopes,
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Fix the Batch 18 SHA in batches.md.
3. P2 end: `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`,
   then a codex logic + style review of the P2 diff (`e55e7c962^..HEAD` file list; Batches 10-18;
   include every item in "Open items" above), and an Electron visual review (dark, light, narrow
   ~400px) of wizard preview modal, sidebar dialog, pack prompt and completion vs. `prototype/`.
   One fix round (Blocking/Serious; D30 backend gap is a candidate), one short re-review.
4. Merge `origin/main` into the branch at a committed safe point (verify lock change).
5. P3 (Batches 19-25), same pattern; visual review must include the F7i notice states and the
   F6 link (D15). P4 (Batch 26) with a codex logic review.
6. Team-leader MODE 3, then push + `gh pr create` in the background against `main` (title < 70
   chars, `## Summary` + `## Test plan` with real results, end with the Claude Code line). Watch
   CI and reviews; fix confirmed findings. No merge, force push or worktree removal.

Rules for every lane and subagent: scoped `npm run verify -- -p ...` only, one foreground run,
output filtered; never workspace-wide; never build/serve/dev/e2e/package; Electron first; keep
every host compiling; executors never commit/push or edit batches.md/task.md/decisions.md;
specs never write outside a temp or mocked root; never `npm install` in the worktree.
Parallel executors in one lib run only their own specs; the orchestrator runs the combined verify.
