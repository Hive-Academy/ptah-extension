# HANDOFF - TASK_2026_646_136a (2026-10-15, session 5)

## Goal

An optional decision model for orchestration routing, plus a lane evaluation loop:
- A "Decision model" background role (Ollama, TypeSafe Jev via `/v1/systemone`, or any structured-output model).
- A `ptah_route_decide` MCP tool (HTTP and stdio dispatchers).
- A lane and subagent outcome record, with `ptah_outcome_report`.
- A capability matrix as data (`source`, `asOf`).
- A spread rule across every spawnable lane.

Approved requirements: `task-description.md` (revision 3). Approved plan: `implementation-plan.md` (+ part-a, part-b),
Gate 2 PASSED at round 6 (decision #52). Work is in `batches.md` (now 35 batches: 31 + fix-round Batches 32-35).

Final user decisions (do not reopen): #12, #13, #18 (as amended by #22), #19. Keep `skillSynthesis.enabled=false` in
`~/.ptah/settings.json`. Leave memory untouched. Lanes: mode `enabled`, Approval `lane-review`.

## Done

Branch `feat/decision-model-routing`, worktree `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`,
draft PR https://github.com/Hive-Academy/ptah-extension/pull/731. Batch count in batches.md: **15/35 COMPLETE**.

Commits before this session (sessions 1-4): Batches 2 c51b98335, 1 5a6c3faa2, 3 e6b75a30a, 5 5e5c9ffca, 7 15b9c2c02,
4 3ada54c23, 9 55a58c96b, 6 8fc9278e9; plus 566fa772c, 78e8fddfb, d4af44690 (docs).

Commits this session (each verified by a Mode 2 team-leader; scoped checks only):

| Batch | Plan | Commit | Executor (family) |
| --- | --- | --- | --- |
| 10 | A5a candidate types + hard constraints | 900efd94d | grok (xAI) |
| 11 | A6a System One client + payload | e5fee2a40 | Glm (Zhipu); spec fix by orchestrator (#68) |
| 13 | A7 reasons + confidence | ab5038c72 | grok (xAI) |
| 14 | A10 lane model listing adapter | 66f724fed | grok (xAI); fix round opencode (#67) |
| 12 | A6b decision-model settings + probe | abf0d2b31 | subagent (Anthropic, #69) |
| 32 | P1c correlation-signal guards (agent-sdk) | 58916fc69 | grok (xAI, #63) |
| 33 | P1c route contract hardening + #74 index exports | 655de8cae | subagent (Anthropic, #70) |

Phase P1 closed: both P1 reviews APPROVED, no fix batch; triage table `## P1 review triage` in batches.md added
Batch 32 and Batch 33 (TL-12, TL-13). Batch 8 "before" screenshots: `visual/batch-8-before.md` (+ PNGs, dark and
light, 1100x700, base c57a9a1e7, worktree `.claude-worktrees/646-base-shots` kept for the after run).

Push: the last pushed commit is d4af44690. The 7 commits above are local-only (see "PUSH IS BLOCKED").

## In progress (uncommitted in the worktree; nothing else is running)

| Batch | State | Files | Report / next |
| --- | --- | --- | --- |
| 34 + 35 (store contract v2, specs, report effect) | IMPLEMENTED, verified (specs pass, lint, typecheck) - held by TL-21 until 15.3 passes | `libs/backend/lane-outcomes/src/lib/store/**`, `write/report-effect.*` | reports/batch-34-35-report.md |
| 15 (journal + pipeline, Task 15.3 fix rounds) | TL-23 fixes written by codex, NOT yet re-verified | `libs/backend/lane-outcomes/src/lib/write/**`, `src/index.ts` | reports/batch-15-3-report.md, reports/batch-15-3-fix-report.md |
| 16 (A4b matrix store) | NOT ACCEPTED (TL-26): 3 spec asserts fail (`capability-matrix.store.spec.ts:412,:471,:515`); prod code OK | `libs/backend/lane-routing/src/lib/matrix/{capability-matrix.store,local-derivation}{,.spec}.ts` | reports/batch-16-report.md; fix = pass `harness({ reader: outcomeReader({ summaries: [] }).reader })` in the 3 Req 6.7 cases (as at `:699-700`); then the 19 Batch 16 export lines go into `index.ts` with the Batch 16 commit (TL-25) |
| 17 (A5b score, spread, rotation) | written by grok (lane ended 0, report delivered; CLI session 01a13fc4-b856-7431-98ae-a2754d9f822b), NOT verified | `libs/backend/lane-routing/src/lib/ranking/{score,spread,rotation.store}{,.spec}.ts` | reports/batch-17-report.md (lists needed index exports) |
| 8 (Agents-tab outcome signals UI) | written, not verified | `libs/frontend/skill-synthesis-ui/**` (13 files) | reports/batch-8-report.md |

## Open problems and decisions

- **Decisions this session:** #61-#74 in `decisions.md`; team-leader decisions TL-12..TL-26 in `batches.md`.
- **Hook lints the whole working tree (#65):** `.lintstagedrc.mjs` runs `npx nx affected --target=lint`, and di-lint
  reads every file, so any other batch's uncommitted file that fails lint, the audit or di-lint blocks every commit.
  Executors may run `npx eslint <own files>` and the degradation pre-check once each (#65), and must never `@inject` a
  token that no `register*.ts` registers yet (#73).
- **Forward DI tokens:** `DECISION_MODEL_CONFIG` is built by an A8 factory (Batch 21, D11); so Batch 18 now waits for
  Batch 21 (#73). Batch 30 (AB14) smoke specs must resolve `DECISION_MODEL_CONFIG` in each host.
- **PUSH IS BLOCKED - 7 commits are local-only** (900efd94d, e5fee2a40, ab5038c72, 66f724fed, abf0d2b31, 58916fc69,
  655de8cae). The pre-push gate `ptah-electron:build-main:production` fails (both tries, with and without
  `NX_NO_CLOUD=true`): esbuild `Could not resolve "@ptah-extension/lane-routing"` at
  `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:24` (Batch 14 import). Cause:
  `apps/ptah-electron/tsconfig.build.json` keeps its own `paths` list (e.g. `task-specs` at `:83`) with no
  `@ptah-extension/lane-routing` (and no `@ptah-extension/lane-outcomes`) entry; `tsconfig.base.json:159-163` has both.
  `apps/ptah-cli/tsconfig.build.json` has its own list too - check it. Fix (a devops/backend fix batch, own commit):
  add `"@ptah-extension/lane-routing": ["../../libs/backend/lane-routing/src/index.ts"]` and the lane-outcomes entry to
  each host `tsconfig.build.json` that lacks them; verify with the gate itself by pushing. Separately, Nx Cloud returns
  401 ("organization has been disabled due to exceeding the FREE plan"); push with `NX_NO_CLOUD=true` so the gate
  runs locally. Never `--no-verify`.
- **Shared lanes:** other sessions (TASK_2026_648_374e, TASK_2026_678_9083) also run codex and grok lanes on this
  machine; a TASK_2026_678 codex lane was still running at handoff. That lane is not ours; never stop it.
- **Lane limits (13:33 UTC):** codex Weekly 10%, grok Weekly 28%, opencode Monthly 92% (light work only), Glm AT LIMIT
  (Ollama session limit, reset unknown, #63), antigravity out until about 2026-10-18 15:00 UTC (#54).
- **Known red specs until Batch 25:** the three host `rpc-surface.spec.ts` files and `rpc-allowlist.spec.ts` fail by
  exactly `agent:outcomeSignals`. Electron `state-storage-oversized-profile.bundle.spec.ts` needs a built `dist/`. Do not
  start a host in development mode before Batch 25.
- **Recorded later tasks:** FE-12a (split probe helpers out of `decision-model.config.ts`, 656 counted lines of 700);
  P1-L1 (13 Prettier-dirty files: one `style(...)` commit when no lane runs); Batch 15 Moderate/Minor items under TL-23;
  P5 Minor `runTagMissSessions` never cleared; `subagent-budget-monitor.ts` over `max-lines` (pre-existing).
- **P2 review** (after Batch 20) must check TL-18/TL-19 deviations and the Batch 6 notes in batches.md.

## Key files

All in `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\`:
- `batches.md` - rules (lines 112-150), TL decisions, waves, phases, per-batch states and Mode 2 notes.
- `decisions.md` (#1-#74), `context.md` (lane refreshes, Glm limit), `implementation-plan.md` (+ part-a, part-b).
- `reports/batch-*-report.md`, `reviews/p1-code-{logic,style}-review.md`, `visual/batch-8-before.md`.

## Next steps

1. Read this file, then `batches.md` (rules lines 112-150, TL-14..TL-26, the Batch 15/16/17/34/35 sections) and
   `decisions.md` #61-#74. Work only in the worktree above. Run `ptah_agent_list`.
2. First, unblock the push (see "PUSH IS BLOCKED"): fix the host `tsconfig.build.json` path lists in one commit, then
   `NX_NO_CLOUD=true git push origin feat/decision-model-routing` in the background, and confirm
   `git log --oneline origin/feat/decision-model-routing..HEAD` is empty. Keep PR #731 a draft until the task is complete.
3. Mode 2 queue, one at a time (fresh team-leader each; give the report path, the list of other writers' uncommitted
   files, the hook note #60/#65):
   a. Joint Mode 2 Batches 34/35/15 with `reports/batch-15-3-fix-report.md`: `npx nx test @ptah-extension/lane-outcomes
      --parallel=1`, `npx nx lint @ptah-extension/lane-outcomes`, `npx nx typecheck @ptah-extension/lane-outcomes`, then three
      commits 34, 35, 15 (TL-21).
   b. Batch 16 TL-26 spec fix (any non-OpenAI executor; tiny), then its Mode 2 (named specs, the 19 export lines, commit).
   c. Batch 17 Mode 2 (its specs, then the full lane-routing shared check, #72: `npx nx test @ptah-extension/lane-routing
      --parallel=1`, `npx nx typecheck @ptah-extension/lane-routing`, `npx nx lint @ptah-extension/lane-routing`).
   d. Batch 8 Mode 2 (`npx nx test @ptah-extension/skill-synthesis-ui --parallel=1`, `npx nx lint
      @ptah-extension/skill-synthesis-ui`). The after screenshots and the visual review run only after Batch 25.
4. Executors (max 3 in flight, file-disjoint, declare `deliverables`, full brief for codex, no Nx/Jest in executors):
   - Batch 19 (A13 agent-sdk structured adapter): Glm is out, so grok -> subagent. Imports the Batch 12 port from
     `@ptah-extension/lane-routing` (exported in 655de8cae).
   - Batch 20 (B4c recorder/reader/join/DI) on codex after Batch 15 commits; then Batches 23, 24, 25.
   - Batch 21 (A8) after Batches 16 and 17 commit; then Batch 18 (after 21), 22, 26, 27, 28, 29, 30, 31.
5. Phase reviews (shipping code, different family): P2 after Batch 20 (Claude subagents); P3 after Batch 21/27
   (codex lane); P4, P5, P6 per the Phases table.
6. Verification (one heavy check at a time, never workspace-wide, never build/serve/e2e/package):
   - One project: `npx nx test <project> --parallel=1`, `npx nx typecheck <project>`, `npx nx lint <project>`.
   - Several: `npx nx run-many -t test -p A B --parallel=1` (confirm "Running target test for N projects").
   - Single specs: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
   - Degradation: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 | grep -E "FAIL|TOTAL"`.
   - di-lint: `npx ts-node --transpile-only tools/di-lint/check-injects.ts`.
7. Commit in the foreground (600000 ms timeout; read `.commitlintrc.json`; subject <= 72, body lines <= 100). Push in
   the background (pre-push runs di-lint and the Electron gate; use `NX_NO_CLOUD=true` while Nx Cloud returns 401).
   Never commit to main.
