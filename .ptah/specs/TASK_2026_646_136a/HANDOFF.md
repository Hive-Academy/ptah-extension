# HANDOFF - TASK_2026_646_136a (2026-10-15, session 6)

## Goal

An optional decision model for orchestration routing, plus a lane evaluation loop:
- A "Decision model" background role (Ollama, TypeSafe Jev via `/v1/systemone`, or any structured-output model).
- A `ptah_route_decide` MCP tool (HTTP and stdio dispatchers).
- A lane and subagent outcome record, with `ptah_outcome_report`.
- A capability matrix as data (`source`, `asOf`).
- A spread rule across every spawnable lane.

Approved requirements: `task-description.md` (revision 3). Approved plan: `implementation-plan.md` (+ part-a, part-b),
Gate 2 PASSED at round 6 (decision #52). Work is in `batches.md` (35 batches).

Final user decisions (do not reopen): #12, #13, #18 (as amended by #22), #19. Keep `skillSynthesis.enabled=false` in
`~/.ptah/settings.json`. Leave memory untouched. Lanes: mode `enabled`, Approval `lane-review`.

## Done

Branch `feat/decision-model-routing`, worktree `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`,
draft PR https://github.com/Hive-Academy/ptah-extension/pull/731 (keep it a draft until the task is complete).
Batch count in batches.md: **23/35 COMPLETE**. Every code commit is pushed (origin = dd021d709).

Commits this session (all pushed; each batch verified by a Mode 2 team-leader with scoped checks):

| Commit | What | Executor (family) |
| --- | --- | --- |
| 53340703e | build: lane-routing + lane-outcomes paths in electron/cli/tui `tsconfig.build.json` (unblocked the pre-push gate, #75) | orchestrator |
| 2493f2dd5 | Batch 34 - atomic store contract v2 | codex (OpenAI) |
| ce300e918 | Batch 35 - store contract specs and report effect | codex (OpenAI) |
| f4425ce5c | Batch 15 - outcome journal and write pipeline (spec fix #77) | codex (OpenAI) + orchestrator |
| 004195ee9 | Batch 16 - matrix store and local derivation (TL-26 spec fix) | grok (xAI) + opencode fix |
| 5ed3d9092 | Batch 17 - score, spread band, rotation store | grok (xAI) |
| 4876fe923 | Batch 8 - Agents tab outcome signals UI | (earlier session) |
| 53dc2bb99 | Batch 19 - structured decision adapter (+ TS4111 fix in `system-one.client.ts`, #81) | grok (xAI) + orchestrator |
| dd021d709 | Batch 20 - recorder, reader, signals, DI (+ #78 additions, F20-1..4 fixes) | codex (OpenAI) |

Phases: P1 accepted earlier. **P2 (Batches 6, 34, 35, 15, 20) is fully committed; its phase review ran and both say
REVISE** (see Open problems).

## In progress

Nothing is running. No lane, subagent or push is in flight. The worktree has no uncommitted code. The task-folder docs
(batches.md, decisions.md, new reports and reviews, this file) are committed with this handoff.

- **Batch 21 (A8, route decide pipeline): STOPPED BY THE USER** while the backend-developer subagent was still reading
  the plan. It wrote no files and no report. Do not restart it without asking the user (executor choice and timing).
  Batch 21 blocks Batch 18 (#73), FE-19a, and the P3 review.

## Open problems and decisions

- **Decisions this session:** #75-#81 in `decisions.md`; team-leader decisions TL-27..TL-31 in `batches.md`.
- **P2 phase review = REVISE (both, different family: Anthropic subagents reviewed OpenAI work):**
  - `reviews/p2-code-logic-review.md` (6/10): **S-1 Serious** - `outcome-write-pipeline.ts:259-290` (`accept`) and
    `:326-347` (`drain`): while `drain` awaits the journal write, `accept` takes the same items and a new op arrives;
    `queue.splice(0, moved.length)` then deletes the new op unjournaled, and earlier ops are journaled twice.
    Moderates M-1..M-11 (M-2 = M20-1 unbounded `classificationInputs`; M-3 = M20-2 role `'unknown'` -> null; M-4 =
    M20-3 reader leaks full rows; M-5 non-atomic SQLite `update()`; M-7 stall on failing `expireHolds`/poison op; M-8
    uncapped queue + raw `submit` error; M-9 one corrupt row kills a store read; M-11 a lane deliverables report
    overwrites a `failed` verdict).
  - `reviews/p2-code-style-review.md` (6/10): **Serious 1** - the journal-append loop is copied three times in
    `outcome-write-pipeline.ts` (`:265-280`, `:332-347`, `:651-664`; two copies hard-code `5000` instead of
    `OUTCOME_JOURNAL_LIMIT`; `KeyValueOutcomeJournal.append` is unused); bare numbers `1000/25/250/200/2000`; three
    `'subagent:'` literals bypass `subagentRunId`. **Serious 2** - the new public API (40-name barrel, register, start,
    tokens, store port, pipeline) has almost no JSDoc. 11 Moderates, 7 Minors.
  - Rule (orchestration lean rule 4): one fix round for Blocking + Serious; a Moderate is fixed only if it can break a
    lane config or lose data (candidates: M-5, M-8, M-9, M-11), else it becomes a named later task. Then one short
    re-review scoped to the fixes.
- **Lane defects seen (#80):** a codex lane that receives a queued `ptah_agent_message` runs it as a NEW turn after its
  report, so do not respawn a lane for the same work until its `<agent-lane-completed>` arrives. A codex resume with a
  large context becomes a fresh lane with a handoff brief, so always give a full brief.
- **Pre-push gate:** works now. Always push with `NX_NO_CLOUD=true` (Nx Cloud returns 401, free plan exceeded).
- **`@nx/dependency-checks`:** never add `@ptah-extension/lane-routing` or `lane-outcomes` to a lib `package.json` (those
  libs have no package.json; the rule reports the entry as unused - Batch 14 and #79 precedent).
- **Strict consumers:** agent-sdk compiles lane-routing source with `noPropertyAccessFromIndexSignature`; lane-routing's
  own tsconfig does not. FE-19a: add that flag to `libs/backend/lane-routing/tsconfig.json` after Batch 21 commits.
- **Hook lints the whole working tree (#65):** an uncommitted file of another batch can block every commit. Commit one
  batch at a time; stage only that batch's files.
- **Shared lanes:** other sessions (TASK_2026_648_374e, TASK_2026_678_9083) also run codex and grok lanes; never stop
  them.
- **Lane limits (15:06 UTC):** codex Weekly ~12% (room), grok Weekly 40% (room), opencode Monthly 92% (light work only),
  Glm AT LIMIT (reset unknown, #63), antigravity out until about 2026-10-18 (#54).
- **Known red specs until Batch 25:** the three host `rpc-surface.spec.ts` files and `rpc-allowlist.spec.ts` fail by
  exactly `agent:outcomeSignals`. Electron `state-storage-oversized-profile.bundle.spec.ts` needs a built `dist/`.
- **Recorded later tasks:** FE-8a (move agent RPC methods out of `skill-synthesis-rpc.service.ts`, 706 > 700 lines);
  FE-12a (split probe helpers out of `decision-model.config.ts`); FE-19a (above); P1-L1 (13 Prettier-dirty files, one
  `style(...)` commit); P5 Minor `runTagMissSessions` never cleared; `subagent-budget-monitor.ts` over `max-lines`.
- **Batch 8 visual:** after screenshots and the P5 visual review run only after Batch 25 (before shots in
  `visual/batch-8-before.md`, base worktree `.claude-worktrees/646-base-shots` kept).

## Key files

All in `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\`:
- `batches.md` - rules (lines 21-60), TL decisions, waves, phases, per-batch states and Mode 2 notes.
- `decisions.md` (#1-#81), `context.md`, `implementation-plan.md` (+ part-a, part-b), `task-description.md`.
- `reviews/p2-code-logic-review.md`, `reviews/p2-code-style-review.md` (the open P2 fix round).
- `reports/batch-*-report.md` (this session: 15-3-fix2, 16-fix, 19, 20, 20-fix).

## Next steps

1. Read this file, then `batches.md` (rules lines 21-60, TL-27..TL-31, the Batch 20 and 21 sections) and `decisions.md`
   #75-#81. Work only in the worktree above. Run `ptah_agent_list`. The session 6 docs are committed and pushed with
   this handoff; confirm `git log --oneline origin/feat/decision-model-routing..HEAD` is empty.
2. **Ask the user about Batch 21** (they stopped it in session 6): restart now, which executor (plan: subagent
   backend-developer; codex is excluded because it is the P3 reviewer; fallback grok), or wait.
3. **P2 fix round:** invoke a fresh team-leader in Mode 2 step 6 with both review paths and verdicts. It triages into a
   P2 fix batch (S-1, style Serious 1 and 2, and the Moderates that can lose data or break a lane config). The fix
   executor may be codex (it wrote P2); the re-review must again come from the Anthropic family. Then a fresh
   team-leader Mode 2 verifies and commits, and one short re-review scoped to the fixes. P2 is accepted only when both
   reviews accept.
4. After Batch 21 commits: FE-19a, Batch 18 (grok), then Batches 22, 23, 24, 25 (B-side needs P2 accepted), 26-31 per
   the waves table. P3 review (OpenAI family, codex lane) after Batches 21 and 27.
5. Limits: max 3 executors in flight, file-disjoint, declare `deliverables` on every spawn, full brief for codex.
   Executors run no Nx/Jest (#53); they may run eslint, prettier, the degradation pre-check and di-lint once each. Never
   `@inject` a token that no `register*.ts` registers (#73). Each Mode 2 team-leader verifies; shipping-code review
   comes from a different family than the implementer. Act on `<agent-lane-completed>`; never poll.
6. Verification (one heavy check at a time, never workspace-wide, never build/serve/e2e/package; prefix nx with
   `NX_NO_CLOUD=true`):
   - One project: `npx nx test <project> --parallel=1`, `npx nx typecheck <project>`, `npx nx lint <project>`.
   - Several: `npx nx run-many -t test -p A B --parallel=1` (confirm "Running target test for N projects").
   - Single specs: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
   - Degradation: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 | grep -E "FAIL|TOTAL"` (TOTAL 296, no FAIL; never raise a baseline).
   - di-lint: `npx ts-node --transpile-only tools/di-lint/check-injects.ts | tail -5`.
7. Commit in the foreground (600000 ms timeout; read `.commitlintrc.json`; subject <= 72, body lines <= 100; never
   `--no-verify`). Push in the background with `NX_NO_CLOUD=true`. Never commit to main.
