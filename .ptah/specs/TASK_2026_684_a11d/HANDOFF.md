# HANDOFF - TASK_2026_684_a11d (2026-10-17, end of session 11 of task 646 / session 1 of task 684)

Status at handoff: no subagent, CLI lane or Electron instance of this session is running. All work is committed
and pushed.

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\ollama-cloud-decision-model`, branch
  `feat/ollama-cloud-decision-model`, HEAD `d85266932` (specs only) plus the commit with this file.
- Draft PR: https://github.com/Hive-Academy/ptah-extension/pull/740 (base `main`).
- Prerequisite PR #731 (TASK_2026_646_136a, decision-model routing) is **MERGED** (head `2ad20c173`).

## Goal

Follow-up to task 646 (user request, verbatim in `context.md`): set our decision model to Ollama Cloud
`clef` (https://ollama.com/library/clef:27b-cloud), bring-your-own decision providers (Jev or any
`/v1/systemone` host), filter the Ollama model list to decision-capable models, and add evals and tests.
End state: PR #740 implemented, reviewed, CI green, marked ready, merged by the user.

## Final user decisions (do not reopen)

| # | Decision |
| --- | --- |
| D1 | Reuse the existing `ollama-cloud` provider key (`ptah.auth.provider.ollama-cloud`). No separate key slot. |
| D2 | One generic custom `/v1/systemone` endpoint kind (base URL + key in secret storage + model). Jev and Ollama presets stay. |
| D3 | Offer only: filtered picker, no auto-select, no default to clef. We set clef in our own settings. |
| D4 | Orchestrator default (user was told and may override): with a key, a custom endpoint must use `https` except on loopback; without a key `http` is allowed. |
| Plan | The user APPROVED `implementation-plan.md` (2026-10-16). |
| Live run | The user runs the gated live spec locally ONCE with their key and shares the printed timing line. No agent handles the key. Batch 21 then applies the plan's timeout formula. |

## Done

### Task 646 / PR #731 (merged)

Session 11 commits on `feat/decision-model-routing` (all in the merged PR):

| Commit | What |
| --- | --- |
| 6be388a9e | Merge `origin/main` (no conflicts) |
| 758f96fdc | E2E expectations: CLI mcp-serve 12 tools (`route_decide`, `outcome_report`); settings 7 roles |
| f0dee00e1 | 41h bounded correction: selection-only save stored-after-reject is success (codex APPROVED 8/10) |
| 5474665e6 | Team-leader Mode 3 docs: completion report, ledger, `future-enhancements.md` |
| c487e9d3e | 41i: `agentOrchestration.decisionModel` file-based (VS Code could not save it) + object kept whole on reload (`FILE_BASED_OBJECT_SETTINGS_KEYS`) |
| 578885dc2 | 41j: `settings:set` refuses the decision key (codex APPROVED 8/10) |
| 392ce5e2f / 2ad20c173 | Review docs 41h / 41j |

CI on 2ad20c173: 20 pass, 3 skipped. One flaky test (`libs/backend/platform-cli/src/implementations/cli-workspace-watcher.spec.ts`
"nestedRepoDetection ...") failed once and passed on rerun. Degradation audit TOTAL **297**, which equals clean `origin/main`
(the extra site came from main; no baseline changed). Later tasks for 646: `.ptah/specs/TASK_2026_646_136a/future-enhancements.md`
(now on main), including LT-41i-1..3 and the pre-existing `settings:import` bypass of the deny list (not yet listed there).

### Task 684 specs (commit d85266932, in this worktree)

- `context.md`: request, D1-D4, research with file:line evidence (from the 646 branch; re-check after merge).
- `task-description.md`: 45 numbered acceptance criteria (1.1-9.1).
- `implementation-plan.md`: 17 components, traceability table for all 45 criteria (APPROVED).
- `batches.md`: Batch 0 + 22 implementation batches in 6 review phases; executors per batch; codex reviews each phase.
  Plan defects PD-1..PD-6 found by the team-leader are handled inside `batches.md` (widen-last ordering of the new kinds,
  Jev-key method switch in one commit, missing `decision-model-row.component.ts`, RPC surface specs, sync locality helper,
  line drift).

## In progress

Nothing is running. Batch 0 is marked in progress in `batches.md` but no step of it was done.

## Open problems and notes

1. The worktree `.claude-worktrees/decision-model-routing` (branch `feat/decision-model-routing`, remote gone after merge) still
   exists. CLAUDE.md: remove it only when the user says so (`git worktree remove .claude-worktrees/decision-model-routing`).
   Ask the user. Visual worktrees `646-base-shots` and `646-after-shots` also stay until the user says otherwise.
2. All file:line references in `context.md`, `implementation-plan.md` and `batches.md` come from the 646 branch before the merge
   (+ 41i). Batch 0 must re-check them after `git merge origin/main`.
3. The lint-staged hook runs `nx format:write`, which reformats `tsconfig.base.json` (one line,
   `@ptah-extension/chat/inspector`) outside the commit. After each commit run `git restore tsconfig.base.json` if it shows as
   modified. The hook also runs `nx affected --target=lint`, which can take over 2 minutes: commit with a long timeout
   (foreground, 600000 ms).
4. Commit subjects must be lower-case (`subject-case` rule); scopes are in `.commitlintrc.json`
   (`lane-routing`, `rpc-handlers`, `platform-core`, `task-specs`, `chat`, `shared`, ... - check before use).
5. Lanes: run `ptah_agent_list` before each spawn. At handoff only codex had confirmed room (weekly 44%); opencode near limit.
   Codex is the reviewer for this task: do not use it to implement. Claude subagents implement (the temporary CLI-lanes-only
   rule in the user's global CLAUDE.md expired 2026-10-16).
6. Electron is shared with peer sessions (649, 674, 678, 681, 683). Before any launch send "Electron: 684 launching" to live
   peers (`ListAgents`), after close "Electron: free". Never port 9333.
7. Keep `skillSynthesis.enabled=false` in `~/.ptah/settings.json`. Leave memory untouched. Never raise a degradation baseline.

## Key files (after the merge, on main)

- Decision model: `libs/backend/lane-routing/src/lib/decision-model/` (`decision-model.types.ts`, `decision-model.config.ts`,
  `probe.ts`, `system-one.client.ts`, `system-one.schema.ts`).
- Structured adapter: `libs/backend/agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts`.
- Config RPC: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` (`writeDecisionModel`,
  `storedSelectionState`, `setConfigQueue`); settings deny set `settings-rpc.handlers.ts` (`SETTINGS_SET_DENIED_KEYS`).
- Shared RPC types: `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`.
- Ollama Cloud provider: `libs/shared/src/lib/providers/entries/local-provider-entry.ts` (`OLLAMA_CLOUD_PROVIDER_ENTRY`).
- Settings keys: `libs/backend/platform-core/src/file-settings-keys.ts` (`FILE_BASED_SETTINGS_KEYS`,
  `FILE_BASED_OBJECT_SETTINGS_KEYS`), `file-settings-manager.ts`.
- Row: `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts`, `provider-consumer-rows.ts`.
- Live-test pattern: `libs/backend/auth-providers/src/lib/model-lists.live.spec.ts`, `.github/workflows/model-lists-probe.yml`.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\ollama-cloud-decision-model status -sb` (expect clean, in sync).
2. Batch 0: `git fetch origin && git merge origin/main` in this worktree (no rebase, no force push). Then one read-only pass
   (a subagent) that re-checks every file:line cited in `implementation-plan.md` and `batches.md` against the merged tree and
   corrects the docs. Commit (foreground), push (background).
3. Run batches 1-22 per `batches.md`: one implementer per batch (Claude subagents), file-disjoint batches may run in parallel,
   but only one heavy check at a time. Commit each batch after its scoped checks pass and no agent edits the worktree.
   Codex review at the end of each phase (resume its session for re-reviews; two revise rounds max per batch).
4. After Batch 19: ask the user to run the live spec locally with their key (command in `batches.md`) and share the timing line;
   then Batch 21 applies the timeout formula.
5. Push, CI green, `gh pr ready 740`; the user merges. User-run steps: select Ollama Cloud / clef in the app and check one
   `/orchestrate` pre-flight; add the `OLLAMA_API_KEY` repo secret for the weekly workflow.

## Verification commands (prefix `NX_NO_CLOUD=true`; one heavy check at a time)

- Libs: `NX_NO_CLOUD=true npx nx run-many -t test -p <A> <B> --parallel=1 --maxWorkers=2` (header must say N projects), then
  `NX_NO_CLOUD=true npx nx run-many -t typecheck lint -p <A> <B> --parallel=1`. Project names use the `@ptah-extension/` prefix
  (e.g. `@ptah-extension/rpc-handlers`, `@ptah-extension/platform-core`); `vscode-lm-tools` and `shared` worked unprefixed.
- Specs: `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`.
- ptah-cli: `PTAH_ALLOW_SKIP_UNBUILT=1 npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src --coverage=false --maxWorkers=2`.
  Never `nx test ptah-cli` or `nx test ptah-electron`.
- Apps: `npx tsc -p apps/<app>/tsconfig.app.json --noEmit`; DI guards
  `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di --coverage=false --maxWorkers=2` and the same for
  `apps/ptah-extension-vscode/src/di` (session 11: 59/59 and 62/62).
- Audit: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` must say `TOTAL 297` (or lower), no FAIL.
- Manifest: `npm run manifest:check`.
- CI: `gh pr checks 740`; failed logs `gh run view <id> --log-failed | grep ...`. Rerun a known flaky job with
  `gh run rerun <id> --failed`.
- Never build/serve/e2e unless reproducing a CI failure; never `--no-verify`; commit in the foreground, push in the background.
