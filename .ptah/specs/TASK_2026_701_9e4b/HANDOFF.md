# HANDOFF - TASK_2026_701_9e4b (session 7)

Session 7 ended 2026-10-26 (token budget). No CLI lane of this task is running. The backend
fix-round subagent was STOPPED mid-work when the session ended (no report). Nothing is pushed.

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
Executors: Claude subagents. Reviewers: codex lanes (implementer family Claude, review family codex).
Accepted pre-existing failures: `ptah-extension-webview:lint` (D19), `@ptah-extension/agent-sdk:lint`
(D21), degradation-audit flag `apps/ptah-electron/src/ipc/ipc-bridge.ts:324`.

### Done in session 7 (verified)

- `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview,ptah-electron` ->
  `15 tasks: 14 succeeded, 1 failed` (D19 only).
- Commits: `baf2abd1f feat(setup-wizard): batch 15 - preview modal and pack prompt`,
  `ac227e30f feat(setup-wizard): batch 17 - completion surfaces` (incl. lint fixes, D30 files).
  batches.md: Batch 15 heading has its SHA, Batch 18 has `11c5df630`; **Batch 17 heading says
  `COMPLETE` without SHA -> add `(commit: ac227e30f)`.**
- P2 host check: `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`
  -> `55 tasks: 55 succeeded`.
- P2 = Batches 10-18 (commits 4795f0b44 493027b0e e62d1dfe8 e55e7c962 ccb672f6e a0b61b0e6
  11c5df630 baf2abd1f ac227e30f; 16042c885 and eae561cf6 are P1 fixes). Diffs for reviewers:
  `T/reviews/p2-diff-backend.patch`, `T/reviews/p2-diff-frontend.patch` (source only, untracked).
- Codex P2 reviews (untracked, in `T/reviews/`):
  - `p2-code-logic-review-a.md` REJECTED 4/10: A1 (CLI `agent apply` overwrites), A2 (create-only
    write not atomic, TOCTOU), A4 (untabbed runs lose Library `result` facts) Blocking; A3 Moderate
    (CLI pack `changed` from `fromCache`). Lane session `01a178ae-a1ef-7613-bd0e-5140dc648a98`.
  - `p2-code-logic-review-b.md` REJECTED 4/10: B1, B2 Serious; B3-B7 Moderate; B8 Minor.
    Lane session `01a178ae-c7d9-72c3-a6eb-0c58ca115263`.
  - `p2-code-style-review.md` 6/10: S1, S2 Serious; M1 Minor. Lane session `01a178ae-ea96-7f30-aad2-22f88afe0016`.
- decisions.md: D31 (Electron visual review for P2+P3 combined after P3; user must start the app
  or allow `dev`), D32 (fix-round scope; deferred items -> named later task TASK-P2-FOLLOWUP).

## In progress (uncommitted, do not lose)

1. **Frontend fix round: DONE, not committed.** Report `T/reports/p2-fix-round-frontend-report.md`.
   Fixed B1, B2+B4 (new root `services/pack-install.store.ts`), S1 (new
   `services/generation-preview.store.ts`; agent-selection 1121 -> 952 lines), M1
   (`components/pack-install/pack-install-result.ts`), B5 (`utils/safe-failure-copy.ts`).
   Own checks: tests 118/118 in 8 suites, typecheck+lint 2/2. Notes for the re-review: raw error
   goes to `console.warn` (project rule says no console.* in libs; WizardRpcService already does
   it); proposed removal `SetupWizardStateService.agentInstallStatus`/`setAgentInstallStatus`
   (no prod reader; needs user approval, follow-up); `completion.component.ts:159-160` still renders
   raw `completion().errors` (follow-up B5 item).
2. **Backend fix round: PARTIAL, executor stopped, no report.** Scope (D32): A1, A2, A3, A4,
   S1-backend, S2. Uncommitted backend edits: 29 files, +1319/-471, including
   `apps/ptah-cli/src/cli/commands/agent.ts` (+spec), `file-writer.service.ts` (+spec),
   `agent-pack-download.service.ts` (+spec), a new exclusive-create method on
   `platform-core/src/interfaces/file-system-provider.interface.ts:46` with implementations in
   platform-cli / platform-electron / platform-vscode, the platform-core mock and contract, and
   one-line mock additions in specs of lane-routing, vscode-lm-tools, workspace-intelligence,
   agent-generation (generated-section-validator.spec.ts); `pack-install.service.ts`,
   `generation-preview.service.ts`, `wizard-generation-rpc.handlers.ts`,
   `wizard-generation-run.supervisor.ts`, `register-shared-rpc-handlers.ts` (+specs); NEW
   `wizard-generation/generation-library-pass.service.ts` (279 lines) + spec (193 lines).
   Which findings are complete and whether it compiles is UNKNOWN.

## Open items

- Deferred to TASK-P2-FOLLOWUP (D32): B3, B6 (completion Retry, design-spec.md:135), B7 (sidebar
  duplicate results, generation-agent-sidebar.component.ts:110-150), B8 (kept reason enum),
  completion rows in parity-inventory.md, the frontend notes in item 1 above.
- D22 still open for the user: `~/.ptah/harness/state.json` `agentSyncEnabled: false`.
- D31: the visual review needs the user to start Electron.

## Lanes

codex: room (weekly 30% at 2026-10-26, resets 2026-11-02). opencode: AT LIMIT until 2026-11-04.
`ptah_agent_spawn` rejects `taskKind`/`routingSource` keys: omit them. Codex reviewers cannot run
git: give them patch files and file lists. Lane signals from the `chat-layout-declutter`
worktree are NOT this task. Ignore them.

## Verify lock note

The worktree's `scripts/verify.mjs` is the old single-slot lock (main has the 2-slot memory-gated
lock from PR #828). After everything is committed, merge `origin/main` into the branch, then read
the updated CLAUDE.md "STRICT: Verification commands". Pass one `--testPathPatterns=<name>` flag
per suite.

## Next steps

1. Fresh backend-developer subagent to FINISH the backend fix round from the partial state.
   Give it: findings A1-A4 in `T/reviews/p2-code-logic-review-a.md`, S1/S2 in
   `T/reviews/p2-code-style-review.md`, D32, the file list in "In progress" item 2, and
   `git diff -- apps libs/backend` as its starting point. It must audit each finding against the
   current diff, complete what is missing, write `T/reports/p2-fix-round-backend-report.md`, and
   must not touch `libs/frontend/**`. Same rules as below.
2. Combined verify (one foreground run):
   `npm run verify -- -p @ptah-extension/setup-wizard,@ptah-extension/agent-generation,@ptah-extension/rpc-handlers,@ptah-extension/platform-core,@ptah-extension/platform-cli,@ptah-extension/platform-electron,@ptah-extension/platform-vscode,@ptah-extension/lane-routing,@ptah-extension/vscode-lm-tools,@ptah-extension/workspace-intelligence,ptah-cli,ptah-electron,ptah-extension-vscode,ptah-tui 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Running target|tasks:|✖|full log"`
   (check exact project names with `npx nx show projects | grep -E "lane-routing|vscode-lm|workspace-intel|platform-"` first).
   Accept D19 and D21 only.
3. Commit the fix round in the foreground, explicit paths, two commits (backend, frontend), scopes
   from `.commitlintrc.json`, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Include the
   T/reviews and T/reports files, decisions.md, this HANDOFF.md; fix the Batch 17 SHA in batches.md.
4. One short codex re-review scoped to the fix diff (new patch file of the fix commits): resume
   or start fresh per lane; verify A1-A4, B1, B2/B4, B5, S1, S2, M1 are fixed.
5. Merge `origin/main` into the branch (verify lock change); re-read CLAUDE.md verify rules.
6. P3 (Batches 19-25), same pattern; P4 (Batch 26) with a codex logic review. Then the combined
   Electron visual review (D31, D15: F7i notice states, F6 link; dark, light, ~400px).
7. Team-leader MODE 3, then push + `gh pr create` in the background against `main` (title < 70
   chars, `## Summary` + `## Test plan` with real results, end with the Claude Code line). Watch CI
   and reviews; fix confirmed findings. No merge, force push or worktree removal.

Rules for every lane and subagent: scoped `npm run verify -- -p ...` only, one foreground run,
output filtered; never workspace-wide; never build/serve/dev/e2e/package; Electron first; keep
every host compiling; executors never commit/push or edit batches.md/task.md/decisions.md; never
git stash/restore/checkout/reset/clean; specs never write outside a temp or mocked root; never
`npm install` in the worktree. Parallel executors in one lib run only their own specs; the
orchestrator runs the combined verify.
