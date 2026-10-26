# HANDOFF - TASK_2026_701_9e4b (session 4)

Session 4 ended 2026-10-26 because of the token budget. No subagent or lane is running.
Batches 10 and 14 are committed. The P1 fix round and Batch 11 are implemented, verified per
area by their executors, and NOT committed. Nothing is pushed.

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

### Commits on the branch

| Batch | SHA | Subject |
| ----- | --- | ------- |
| 1 | 2596f6fc4 | feat(shared): batch 1 - wizard and library alignment contracts |
| 2 | b0f9d3402 | feat(shared,harness-sync,cli): batch 2 - keptLocalEdit and schema 1.0 |
| 3 | e7a2be488 | feat(agent-sdk,cli-agent-runtime): batch 3 - plugin config home |
| 4 | 20fd5a2a8 | feat(agent-generation): batch 4 - wizard agent-origin store |
| 5 | a23b72e5a | feat(agent-generation,rpc-handlers): batch 5 - plugin agents in library |
| 6 | a621f0323 | feat(harness-sync,shared): batch 6 - keep edited managed copies |
| 8 | f083b037d | feat(electron): batch 8 - coalesced job per-batch outcome |
| 7 | 4809d01fe | feat(harness-sync,shared): batch 7 - digest-checked repair |
| 8b | 7c87ccd37 | fix(agent-generation): batch 8b - attach origin-store audit marker |
| 9 | a96d12d50 | feat(harness-sync,electron): batch 9 - refresh status and library push |
| 10 | 4795f0b44 | Batch 10 - guarded writer and orchestrator decisions |
| 14 | 493027b0e | Batch 14 - setup-wizard decision components |

Batch 10+14 combined verify (before commit): 67 tasks, 66 pass, 1 fail = D19.

### Uncommitted in the worktree (do not lose)

All three work items below are file-disjoint. Commit them as separate commits.

1. **P1 fix round** (reports: `reports/p1-fix-round-a-report.md`, `reports/p1-fix-round-b-report.md`,
   `reports/p1-fix-round-followups-report.md`):
   - Group A (A1-A4), `libs/backend/harness-sync/`: `di/register.ts`, `health/harness-destination-scanner.ts`
     (+ spec), `health/harness-health.ts`, NEW `health/approval-fingerprint.ts` (+ spec if present),
     `reconciler/harness-reconciler.service.ts`, `repair/blocked-repair.service.ts` (+ spec),
     `targets/artifact-retirement.ts`, `targets/claude-target.ts`, NEW
     `targets/claude-target.overwrite-detach.spec.ts`, `targets/copy-engine.ts`, `targets/workspace-target.ts`.
     harness-sync verify passed (604/604).
   - Group B (S1, S2, B1-B3, stale doc): `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts`
     (+ spec), `plugin-loader.service.ts` (+ spec); `libs/backend/agent-generation/src/index.ts`,
     `lib/services/user-layer/{source-hash.ts, user-layer-mirror.service.ts, user-layer-plugin-agents.ts}`
     (+ specs); `apps/ptah-electron/src/activation/plugin-activation.ts` (+ spec);
     `apps/ptah-extension-vscode/src/activation/plugin-activation.ts` (+ new spec).
   - Follow-ups: `plugin-config-home.ts` single `absentWhenInvalid` helper with an audit marker
     (audit agent-sdk 3 <= baseline 4); CLI B3 in `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts`
     (+ spec); comment fix in `libs/shared/src/lib/types/harness-sync.types.ts` (`expectedDigest`).
   - Not fixed (Minor, recorded): `apps/ptah-electron/src/di/container.smoke.spec.ts:508` exact-text
     assertion (unrelated to the fixes). Out-of-scope note from Group A: Claude-target removals
     still delete an owned copy without a move-aside.
   - Note: `HarnessDestination.digest` now holds the strict approval fingerprint (a `chmod` after
     approval also counts as a change; a filesystem with no file identity cannot be approved).
2. **Batch 11** (generation preview service), report `reports/batch-11-report.md`:
   NEW `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation/generation-preview.service.ts`
   (+ spec); MODIFIED `wizard-generation-binding.ts`, `wizard-generation-rpc.handlers.ts` (+ spec),
   `wizard-generation-rpc.schema.ts` (+ spec), `wizard-generation.preview-fidelity.spec.ts`,
   `register-shared-rpc-handlers.ts`. rpc-handlers verify passed. Temporary rule until Batch 12:
   when the opened folder is below the harness root, submit is create-only and preview paths and
   the run disagree.
3. Task-folder files: `batches.md` (Batch 14 SHA line), this `HANDOFF.md`, `reviews/` (3 P1 review
   files), the 4 new reports above. Commit them with the fix round or Batch 11.

### Combined verify for the uncommitted work (session 4)

`npm run verify -- -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/agent-sdk,@ptah-extension/agent-generation,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli`

RESULT: see "Verify result" at the end of this file. If no result is recorded there, run the
command again first.

## P1 review (codex) and re-review lanes

Review files in `reviews/`: `p1-code-logic-review-a.md` (4/10 REVISE), `p1-code-logic-review-b.md`
(5/10 REVISE), `p1-code-style-review.md` (6/10 REVISE). All Blocking/Serious/Moderate findings
(S1, S2, A1-A4, B1-B3) are now fixed in the worktree. The short re-review of the fix diff is NOT
done yet. Codex lane CLI session IDs for `resume_session_id`:
A `01a175e6-18a7-7ad1-a0bc-78b00fc2b2f7`, B `01a175e6-4620-72d0-be0d-de2c90b7b039`,
style `01a175e6-6de5-7a33-a1a5-735350deecff`.
Codex reviewers cannot run git: give them the file list and concrete facts in the prompt.

## Decisions (decisions.md D19-D23, plus session 4)

- D19, D21: accepted pre-existing lint failures (see above).
- D20: stale `%TEMP%\.claude` / `%TEMP%\.ptah` markers moved to `%TEMP%\ptah-stray-markers-backup-20261025`.
- D22: `~/.ptah/harness/state.json` has `agentSyncEnabled: false` from a Batch 5 spec draft. Tell the
  user; delete the key if wanted.
- D23: agent-generation audit ratchet fixed by Batch 8b.
- Session 4 (add to decisions.md as D24-D26 on resume):
  - D24: the 5 Zod `.catch(undefined)` audit flags in `plugin-config-home.ts` are Zod fallbacks, not
    promise handlers; replaced by one helper with an `optional-capability` marker. Baseline not raised.
  - D25: CLI `harness-boot.ts` had the same B3 defect; fixed in the same round (returns `failed`).
  - D26: the fix round, Batch 11 and the follow-ups ran in parallel as three file-disjoint
    subagents with one combined verify.
- Batch 10 notes for Batch 12: merge `keptOutcomes` into `outcomes`, make `keptCount` /
  `changedSincePreviewCount` required, count kept agents in `buildCompletePayload`.

## Lanes

codex: room (weekly 38% at 2026-10-26 01:50 UTC, resets 2026-11-01). opencode: AT LIMIT until
2026-11-04. `ptah_agent_spawn` rejects `taskKind`/`routingSource`.

## Next steps

1. FIRST fix the 3 failing host test targets (see "Verify result" at the end), then run the
   combined verify above once (`2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Running target|tasks:|✖|FAIL "`).
   Accept D19/D21 only.
2. Fresh team-leader MODE 2 with `reports/p1-fix-round-a-report.md`, `reports/p1-fix-round-b-report.md`,
   `reports/p1-fix-round-followups-report.md` and `reports/batch-11-report.md`. Commit in this
   order, foreground, explicit paths, `.commitlintrc.json` scopes: (a) P1 fix round
   (e.g. `fix(harness-sync,agent-sdk,agent-generation): address P1 review findings`), (b) Batch 11.
   Include task-folder files (reviews/, reports, batches.md, HANDOFF.md).
3. ONE short codex re-review of the fix-round diff (resume the three session IDs above; list the
   changed files and the finding IDs). Record the verdict.
4. Continue P2: Batch 12 -> 13 (ledger order for `register-shared-rpc-handlers.ts`: 11, 13, 19),
   15, 16, 17, 18. File-disjoint batches in parallel (for example 13 with 16 after 12), one combined
   verify, fresh team-leader MODE 2 per commit set.
5. At P2 end: `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli`,
   codex logic + style review of the P2 diff, Electron visual review (dark, light, narrow ~400px)
   of wizard preview, sidebar dialog, pack prompt and completion vs. `prototype/`.
6. P3 (Batches 19-25), same pattern; visual review must include the F7i notice states and the
   F6 link (D15). P4 (Batch 26) with a codex logic review.
7. Team-leader MODE 3, then push + `gh pr create` in the background against `main` (title < 70
   chars, `## Summary` + `## Test plan` with real results, end with the Claude Code line). Watch
   CI and reviews; fix confirmed findings. No merge, force push or worktree removal.

Rules for every lane and subagent: scoped `npm run verify -- -p ...` only, one foreground run,
output filtered; never workspace-wide; never build/serve/dev/e2e/package; Electron first; keep
every host compiling; executors never commit/push or edit batches.md/task.md/decisions.md;
specs never write outside a temp or mocked root; never `npm install` in the worktree.

## Verify result

Session 4 combined verify: `73 tasks: 69 succeeded, 4 failed`.
- `@ptah-extension/agent-sdk:lint` = accepted D21.
- `ptah-electron:test`, `ptah-extension-vscode:test`, `ptah-cli:test` = REAL FAILURES, NOT DIAGNOSED
  (the output filter dropped the suite names). Do NOT commit the fix round or Batch 11 until these pass.
- Most likely cause (unconfirmed): the host DI guard specs (`apps/*/src/di/container.smoke.spec.ts`,
  `expected-resolvable.ts`, `rpc-surface.spec.ts`, cli-engine `container`) do not know the new
  `GenerationPreviewService` / `AGENT_ORIGIN_STORE` resolution from Batch 11 (its report says the
  host checks were never run), or the S2 `PluginLoaderInitOptions` shape change / B3 status change
  in `plugin-activation`. Earlier in the session, the Electron failures came from a TS18048 in
  `generation-preview.service.ts:714-715`; Batch 11 says it fixed that, so check it.
- Diagnose with one run per host, for example:
  `npm run verify -- -t test -p ptah-electron 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "FAIL |●" | head -40`
  then the same for `ptah-extension-vscode` and `ptah-cli`. Give the failures to a backend-developer
  subagent (host DI guard files + Batch 11 / fix-round files only), then rerun the combined verify.
