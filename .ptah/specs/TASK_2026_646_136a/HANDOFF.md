# HANDOFF - TASK_2026_646_136a (2026-10-15, session 7)

## Goal

An optional decision model for orchestration routing, plus a lane evaluation loop:
- A "Decision model" background role (Ollama, TypeSafe Jev via `/v1/systemone`, or any structured-output model).
- A `ptah_route_decide` MCP tool (HTTP and stdio dispatchers).
- A lane and subagent outcome record, with `ptah_outcome_report`.
- A capability matrix as data (`source`, `asOf`).
- A spread rule across every spawnable lane.

Approved requirements: `task-description.md` (revision 3). Approved plan: `implementation-plan.md` (+ part-a, part-b),
Gate 2 PASSED (decision #52). Work is in `batches.md` (38 batches).

Final user decisions (do not reopen): #12, #13, #18 (as amended by #22), #19. Keep `skillSynthesis.enabled=false` in
`~/.ptah/settings.json`. Leave memory untouched. Lanes: mode `enabled`, Approval `lane-review`. User preference (#82):
"restart anyone u like and try to utilize our cli tools for parallel work if possible".

## Temporary rule until 2026-10-16 (relayed user instruction, Claude usage at 95%)

Do NOT spawn Claude subagents (Agent/Task tool) for implementation, review or research. Use CLI lanes
(`ptah_agent_spawn`, load the `agent-lanes` skill first; run `ptah_agent_list` before each spawn). The orchestrator
plans, writes lane briefs, runs the Mode 2 checks itself, and commits (decision #90 precedent). Glm is AT LIMIT;
opencode light work only; copilot disabled; antigravity unknown. From 2026-10-16 the team-leader subagent flow may
resume.

## Done

Branch `feat/decision-model-routing`, worktree `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`,
draft PR https://github.com/Hive-Academy/ptah-extension/pull/731 (keep it a draft until the task is complete).
Batch count: **30/38 COMPLETE**. Phases accepted: **P1, P2** (#85).

Commits this session:

| Commit | What | Executor (family) |
| --- | --- | --- |
| 8cd5cc212 | Batch 36 - P2 fix round | codex (OpenAI) |
| bfae43c3c | Batch 36b - journal op validation (+ #84 import) | codex (OpenAI) + orchestrator |
| 653b71cf2 | Batch 21 - route decide pipeline | grok (xAI) |
| 1b9966147 | FE-19a strict flag in lane-routing tsconfig; P2 accepted; #85-#87 | orchestrator |
| bf898ae9c | Batch 23 - lane outcome write point (+ #88 lane-outcomes TS4111) | codex (OpenAI) |
| 2f7833b8f | Batch 24 - kept skill-synthesis stores (2 rounds) | codex (OpenAI) |
| 0c52b416b | Batches 26 + 28 - route and report tool modules (#90) | grok (xAI), codex (OpenAI) |

Pushed: everything up to 0c52b416b, plus this handoff docs commit.

## In progress (uncommitted in the worktree)

- **Batch 18 (A11, decision-model config RPC, grok):** files in `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`, the new
  `agent-rpc.handlers.decision-model.spec.ts` (orchestrator added the auth-providers mock, 15/15 pass, #89) and five
  sibling specs (constructor arg). Round 1 checks otherwise passed (typecheck shared + rpc-handlers, lint, guard specs
  as known). **Commit only after Batch 30a** (TL-59): no host calls `registerLaneRoutingServices`, so
  `AgentRpcHandlers` would fail at boot in all three hosts.
- **Batch 30a (AB14-pre, lane-routing host registration, grok lane `46f3684d-49fc-4295-88c6-cd910705510b`):** adds
  `registerLaneRoutingServices` to `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`,
  `apps/ptah-electron/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/container.ts`, and smoke-spec
  cases that resolve `DECISION_MODEL_CONFIG` and `AgentRpcHandlers`. Report: `reports/batch-30a-report.md`. See the
  status line at the end of this file.
- **Batch 27 (A16, failure classifier, grok):** lane done, report `reports/batch-27-report.md`; files
  `libs/backend/lane-routing/src/lib/failure-class/**`, `lane-routing/src/lib/di/register.ts(+spec)`,
  `lane-routing/src/index.ts`. **Not yet verified.**

## Open problems and decisions

- Decisions this session: #82-#90 in `decisions.md`; TL-47..TL-61 in `batches.md`.
- Later tasks added: LT-P2-17/18 (P2c), FE-21a (split `route-decide.gate.spec.ts`, 792 lines), FE-23a/b/c, FE-24a/b/c/d.
- **Reviews due:**
  - P3 (Batches 9-13, 16, 17, 21, 27, 33): codex lane (OpenAI) after Batch 27 commits.
  - P4 (14, 18, 19, 22): codex lane + visual review, after Batches 18 and 22.
  - P5 (8, 23, 24, 25, 28, 32): Anthropic subagents (all other families implemented P5) - not before 2026-10-16.
  - P6 (26, 29, 30, 30a): codex lane.
- P4 review notes (TL-59 run): `getStatus()` rejection fails the whole `agent:getConfig`; the new spec's state-set
  guard checks lane-routing's DTO, not the shared mirror type. Setting key used: section `ptah`, key
  `agentOrchestration.decisionModel`, global scope; Jev key in secret storage `ptah.laneRouting.jevApiKey` (part-a says
  section `agentOrchestration`, key `decisionModel`) - for the Mode 3 write-path trace.
- Known red until Batch 25: the three host `rpc-surface.spec.ts` files and `rpc-allowlist.spec.ts` fail by exactly
  `agent:outcomeSignals`.
- Lane rules: never add lane-routing/lane-outcomes to a lib package.json (#79); never `@inject` an unregistered token
  (#73); after a queued `ptah_agent_message`, wait for that lane's completion before a respawn (#80); executors run no
  Nx/Jest (#53); the pre-commit hook may lint the whole working tree (#65).

## Key files

All in `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\`:
`batches.md` (rules lines 21-60, waves ~line 183, phases ~196, per-batch sections), `decisions.md` (#1-#90),
`implementation-plan.md` (+ part-a, part-b), `task-description.md`, `reports/batch-*-report.md`, `reviews/*.md`.

## Next steps

1. Read this file, then `batches.md` rules (21-60), the Batch 18, 27, 30a, 22, 25, 29, 30, 31 sections, and
   `decisions.md` #82-#90. Work only in the worktree. `git status --short`; `git log --oneline
   origin/feat/decision-model-routing..HEAD` (push anything unpushed in the background with `NX_NO_CLOUD=true`).
2. **Batch 30a + Batch 18:** if the 30a lane delivered, verify one at a time:
   `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`,
   then the same for `apps/ptah-electron` and `apps/ptah-cli`, then the cli-engine `rpc-surface.spec.ts` (red only by
   `agent:outcomeSignals`). Commit 30a, then Batch 18 (re-run
   `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers --coverage=false --maxWorkers=2`
   and `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/rpc-handlers`).
3. **Batch 27:** `NX_NO_CLOUD=true npx nx test @ptah-extension/lane-routing --parallel=1`, then lint, then typecheck;
   confirm the five spec cases in the Batch 27 section; commit. Then spawn the **P3 review** on a codex lane (full
   brief, deliverables `reviews/p3-code-logic-review.md` and `reviews/p3-code-style-review.md`).
4. Then: Batch 22 (UI settings row; grok, or codex is excluded as P4 reviewer -> grok), Batch 25 (Glm AT LIMIT ->
   grok or codex), Batch 29 (MCP registration; after 26, 28), Batch 30 (host wiring; do not re-add 30a calls), Batch 31
   (docs; opencode light). Max 3 lanes, file-disjoint, `deliverables` on every spawn, full brief for codex.
5. Checks per changed project only, one heavy check at a time, `NX_NO_CLOUD=true`:
   - Degradation: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 | grep -E "FAIL|TOTAL"` (296, no FAIL).
   - di-lint: `npx ts-node --transpile-only tools/di-lint/check-injects.ts | tail -2`.
6. Commit in the foreground (600000 ms timeout; read `.commitlintrc.json`; subject <= 72, body <= 100; end with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never `--no-verify`). Push in the background. Never commit
   to main. Keep PR #731 a draft.

## Batch 30a lane status at handoff

The grok lane completed (exit 0, 13m 33s, verdict delivered). Report: `reports/batch-30a-report.md` (8655 bytes).
**Not verified.** Uncommitted files: the three `phase-2-libraries.ts`/`container.ts` roots (vscode, electron,
cli-engine), the three `container.smoke.spec.ts` and three `expected-resolvable.ts` (vscode, electron, cli). The lane
ran no Jest and did not run `validate-deps` (the pre-push gate runs it). Next step 2 verifies it. Grok session for a
resume: `01a140c5-bc48-7f60-af5b-2576c7176ea7`. Pushed: up to 0c52b416b; this handoff commit is pushed after it.
