# Handoff — TASK_2026_609_c495 (session 1 → session 2)

Written 2026-10-03 by the orchestrator at the user's request ("stop after this batch is committed").

## Where things are

- **Worktree**: `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup`
- **Branch**: `fix/task-609-subagent-setup`, rebased on `origin/main` `f314a4f8a` (includes PR #634). Local only, **never pushed**. HEAD `48877e550`.
- `node_modules` in the worktree is a junction to the main checkout's `node_modules` (same lockfile).
- Untracked, never stage: `.ptah/specs/TASK_2026_609_c495/` (task folder) and `test-results/` (B-0 artifact).
- Extra worktree `D:\projects\ptah-extension\.claude-worktrees\task-609-before` (detached at base `21c27d17f`, node_modules junction) — used for BEFORE screenshots; keep until B-7 after-screenshots are compared, then remove with `git worktree remove`.
- Progress: **20/28 batches** (Part A 6/6, Part B 14/22). Nothing IN_PROGRESS.

## Read these first (task folder)

1. `context.md` — user request, all user decisions (scope, model scope, Restore option 1, fast track, Gate 0.1 lanes + subagents, usage hygiene).
2. `batches.md` — authoritative batch list, run order, results, risks (R1–R13, PR1–PR10, PA-*), follow-ups FU-1..FU-4, rebase SHA map.
3. `implementation-plan.md` (Part B, C1–C6) and `task-description.md` (Part B, narrowed, 4 items) — APPROVED at the combined gate.
4. `research-report.md` — Part A root cause.

## Commits on the branch (oldest first)

| Part | Batch | SHA | Summary |
|---|---|---|---|
| A | 2 (F5) | `62f1ad576` | FileWriterService rejects relative paths |
| A | 1a | `ba965aa1c` | snapshot hand-edited CLI copies before retiring them |
| A | 1 (F1) | `c2c4f9951` | seed only owned agents, quarantine leaked clones |
| B | B-1 | `b3dc1b83a` | health report: localEdit + agentsInSync, snapshot before overwrite |
| B | B-2a | `ec2387def` | list/restore quarantined agents (domain) |
| B | B-1b | `2b9af459f` | export `isAgentSelectedForSync` |
| B | B-2b | `3a08ff540` | quarantine RPCs |
| B | B-3a | `045293092` | sync chips, reconcile guard, quarantine RPC client |
| B | B-2c | `4b1fa6135` | `wizard:preview-generation` RPC |
| B | B-3b | `b4f8d4b31` | quarantine panel, card chips, guarded Sync |
| B | B-4 | `165881e4a` | wizard preview dialog |
| A | 3a (F2) | `43a330406` | register `agentGeneration.models` |
| A | 4 (F4) | `4071ff138` | compact ptah tools table + manifest regenerated |
| B | B-5a | `e7a347322` | shared model classifier/resolver |
| B | B-5c | `d28ce1337` | `CliModelListService` extraction |
| B | B-5b | `67cca83f8` | settings-core `AgentModelSettings`, path-explicit writes |
| B | B-5c2 | `8fffc0652` | model lists with provenance (`listForClassification`) |
| A | 3b (F2) | `3c2c52284` | Claude model override in `buildAgentFileContent` |
| B | B-5d | `48877e550` | per-agent rival models in desired state |

## Next steps (run order)

1. **Part A phase review (DUE)** — one `code-logic-reviewer`, cross-side preferred (Codex lane reviewer since authors were mostly subagents, or a subagent if lane-authored), on the six Part A commits `62f1ad576 ba965aa1c c2c4f9951 43a330406 4071ff138 3c2c52284` (use `git show` per commit; not a branch range — Part B commits are interleaved). Checklist R1–R13, A3–A8 in batches.md. Writes `code-logic-review.md`. Then a fresh team-leader Mode 2 step 6. At most one fix round (Blocking/Serious only). Read-only, can run alongside step 2.
2. **B-5e** — the four transformers emit `model` (CLI lane, fallback backend-developer).
3. **B-5f1** — source resolver reads agent models + `di/register.ts:134` warn callback (Task B-5f1.2).
4. **B-5f2 / B-5f3 / B-5f4** — one per host (VS Code, Electron, CLI), parallel lanes. Exactly ONE `AgentModelSettings` instance per process (`useValue`, inside the `WORKSPACE_SCOPE_RESOLVER` guard).
5. **B-5g** — get/set agent model RPC; call `update(workspaceRoot, slug, provider, value, scope)` in that order; require + validate workspaceRoot; classify via `listForClassification()` (never the `agent:listCliModels` response). Can run alongside B-5f*.
6. **FU-4** — move the plan-write model to `HarnessPlanWrite.model?` (2-file harness-sync batch, after B-5f1).
7. **B-6** — frontend model control on the agent card, incl. "inherits: <model> (lane default)" label; when the guard cannot read fresh health, show a clear message + Retry and save nothing.
8. **B-7** — AFTER screenshots (dark + light, same method as B-0: 1280x800, `data-theme` set after load; capture script in `b0-capture/`, rename `package.json.disabled` back to run it, then rename again), compare with `screenshots/before-*.png`; ONE code-logic review on the combined Part B diff; then Gate 3 (QA choice) with the user.
9. Ask the user before any push or PR. Never commit to main.

## Rules that still apply (user's usage hygiene, context.md)

- Fresh team-leader for every Mode 2/3 call; give it report paths only.
- Resume an agent/lane only if its last activity was < 5 min ago.
- No per-batch review; scoped checks per batch (`typecheck,lint` then `test --maxWorkers=2`, never `--maxWorkers` on typecheck, never workspace-wide, tail output; settings-core uses `eslint:lint`).
- At most one fix round per review.
- Lanes get a narrow file list and a tool-call ceiling (≤40); act on completion signals, no polling.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Known baselines and follow-ups

- harness-sync: 17 tests fail on clean main + `capability-policy [C3]` is flaky (fails on main too). Only other failures block. Suggest a separate task for them.
- FU-1: snapshot-before-overwrite for the Claude target and MCP fragments (then widen guard wording).
- FU-2: move the preview out of `wizard-generation-rpc.handlers.ts` (~880 lines).
- FU-3: move Agents-tab wiring out of `skill-clones-view.component.ts` (730 lines).
- FU-4: see step 6.
- Deferred by user: content-manifest update detection.
- Incident (resolved): an early B-2c spec draft wrote 4 folders into the real `~/.ptah/user/agents`; removed, verified by the orchestrator; the committed spec mocks `os.homedir()` and clears `CODEX_HOME`. Any new spec touching home paths must do the same.
