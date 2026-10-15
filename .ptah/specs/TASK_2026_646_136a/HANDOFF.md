# HANDOFF - TASK_2026_646_136a (2026-10-15, session 4)

## Goal

An optional decision model for orchestration routing, plus a lane evaluation loop:
- A "Decision model" background role (Ollama, TypeSafe Jev via `/v1/systemone`, or any structured-output model).
- A `ptah_route_decide` MCP tool (HTTP and stdio dispatchers).
- A lane and subagent outcome record, with `ptah_outcome_report`.
- A capability matrix as data (`source`, `asOf`).
- A spread rule across every spawnable lane.

Approved requirements: `task-description.md` (revision 3). Approved plan: `implementation-plan.md` (+ part-a, part-b),
Gate 2 PASSED at round 6 (decision #52). Work is decomposed in `batches.md` (31 batches, 8 waves, 7 review phases).

Final user decisions (do not reopen): #12, #13, #18 (as amended by #22), #19. Keep `skillSynthesis.enabled=false` in
`~/.ptah/settings.json`. Leave memory untouched.

## Done

Branch `feat/decision-model-routing`, worktree `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`,
draft PR https://github.com/Hive-Academy/ptah-extension/pull/731.

Gate 2 (this session):
- User answered `APPROVED with fixes` (#44). Fix rounds R3-1/R3-2 (d1232ab6e), R4-1 (e286725e8), R5-1 (8ec482708,
  user chose "one more fix + check", #50). Codex scoped checks: round 4 REVISE, round 5 REVISE, round 6 APPROVED
  (`implementation-plan-review-round{4,5,6}.md`). Gate pass recorded in 9b9ca0d9a. R6-1 became a B4 batch note.
- Team-leader decomposition: `batches.md` (7ea895538).

Implementation commits (all verified by a Mode 2 team-leader; scoped checks only):

| Batch | Plan | Commit | Executor (family) |
| --- | --- | --- | --- |
| 2 | AB1 shared contracts | c51b98335 | Glm (Zhipu) |
| 1 | A2 lane-routing scaffold | 5a6c3faa2 | grok (xAI) |
| 3 | B3 budget-stop registry + run tag | e6b75a30a | codex (OpenAI) |
| 5 | A3 route-decide contracts/ports | 5e5c9ffca | codex (OpenAI) |
| 7 | A1b row family + spawn fields | 15b9c2c02 | Glm (Zhipu) |
| 4 | B2 migrations 0054/0055 (2 rounds) | 3ada54c23 | Glm (Zhipu) |
| 9 | A4 matrix data | 55a58c96b | subagent (Anthropic) |
| 6 | B4a lane-outcomes scaffold + stores | 8fc9278e9 | codex (OpenAI) |

Other commits: 566fa772c (orchestrator fix: agent-sdk degradation-audit swallow, #60), 78e8fddfb (Prettier-only),
306aed4ea and the final docs commit of this session (task-folder state). Count in batches.md: 8/31.

Phase P1 (Batches 1, 2, 3, 4, 5, 7) is fully committed and both reviews are written (Anthropic, cross-family):
- `reviews/p1-code-logic-review.md`: APPROVED, 0 Blocking, 0 Serious, 6 Moderate, 6 Minor.
- `reviews/p1-code-style-review.md`: APPROVED, 0 Blocking, 0 Serious, 11 Moderate, 9 Minor (incl. 20 files from
  Batches 1-4 not Prettier-clean; duplicated literals such as `ROTATION_TASK_KINDS`).

## In progress (nothing is running)

Uncommitted code in the worktree, written by executors, NOT yet verified (each needs its Mode 2):

| Batch | Plan | Files | Report |
| --- | --- | --- | --- |
| 8 | B8 Agents-tab outcome signals (UI) | `libs/frontend/skill-synthesis-ui/**` (13 files) | reports/batch-8-report.md (grok) |
| 10 | A5a hard constraints | `libs/backend/lane-routing/src/lib/ranking/**` | reports/batch-10-report.md (grok) |
| 11 | A6a System One client + payload | `libs/backend/lane-routing/src/lib/decision-model/**` | reports/batch-11-report.md (Glm) |
| 13 | A7 reasons + confidence | `libs/backend/lane-routing/src/lib/reasons/**` | reports/batch-13-report.md (grok) |

Not started: Batch 14 (A10; the Glm session stopped twice, wrote nothing — move to its next fallback, grok) and
Batch 15 (B4b; marked IN_PROGRESS by the Batch 6 Mode 2 but no executor ran). Batch 12 waits for Batch 11.

## Open problems and decisions

- **Decisions this session:** #44-#60 in `decisions.md`; team-leader decisions TL-1..TL-11, TL-B4-1 and the hold-cap
  decision in `batches.md`.
- **Verification is serialized (#53):** executors run no Nx/Jest; each Mode 2 team-leader runs the batch checks,
  one Mode 2 at a time.
- **Hooks (#60):** the worktree had no `.husky/_`, so commits before 566fa772c skipped lint-staged and commitlint, and
  pushes up to 7ea895538 skipped the pre-push gates. `npx husky` fixed it. A commit now runs
  `nx affected --target=lint` (incl. the degradation-audit ratchet) and takes minutes: run `git commit` in the
  foreground with a 600000 ms timeout. Never raise an audit baseline; an intentional catch swallow needs
  `// degradation-audit: reported - <reason>` or `optional-capability`.
- **Glm lane defect (#57 corrected by #59):** a new Glm session with a read-heavy brief stops in its first run with no
  error; a resume usually finishes. Resume once; if that stops too, use the batch's next fallback. Report to
  TASK_2026_663_50d4.
- **antigravity is out (#54):** HTTP 429 quota, reset about 2026-10-18 15:00 UTC. Use fallbacks.
- **Lane limits (2026-10-15 12:05 UTC):** codex Weekly 7%, grok Weekly 13%, opencode Monthly 91% (light work only),
  Glm unknown. Run `ptah_agent_list` before each spawn.
- **Known red specs until Batch 25:** the three host `rpc-surface.spec.ts` files and `rpc-allowlist.spec.ts` fail by
  exactly one method, `agent:outcomeSignals` (no handler yet). Do not start any host in development mode before
  Batch 25 (the dev-mode manifest assertion throws).
- **UI evidence (#58):** the user allowed a visual-reviewer to run the app (one serve/dev process at a time, never in
  parallel with another heavy check) for before/after dark+light screenshots of Batch 8 (Agents tab) and Batch 22.
  Before screenshots come from base commit c57a9a1e7 in a separate detached worktree. P1 code-logic review note:
  the "after" run must be ordered after Batch 25.
- **P1 review findings not yet triaged:** run Mode 2 step 6 with both P1 review paths. Lean rule 4: Blocking/Serious
  are fixed (there are none); Moderate is fixed only if it can break a lane config or lose data, otherwise it becomes
  a named later task; Minor is recorded.
- **P2 notes recorded under Batch 6 in batches.md** (for the P2 review after Batch 20): key-value `evict()` can drop a
  receipt recorded before its row; `holdReport` uses `Date.now()` instead of a passed `nowMs`; SQLite `decode` defaults
  three fields until B4c.

## Key files

All in `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\`:
- `batches.md` — batch states, rules (lines 21-50), waves, phases, per-batch Mode 2 notes, TL decisions.
- `decisions.md` (#1-#60), `implementation-plan.md` (+ `-part-a.md`, `-part-b.md`), `task-description.md`.
- `reports/batch-*-report.md` — executor reports; `reviews/p1-code-{logic,style}-review.md`.
- `implementation-plan-review-round{1..6}.md` and `implementation-plan-review.md` (= round 6).

## Next steps

1. Read this file, then `batches.md` lines 1-175 (rules, decisions, waves, phases) and `decisions.md` #53-#60.
   Work only in the worktree above. Refresh `ptah_agent_list`.
2. P1 close: invoke a fresh `team-leader` in Mode 2 (step 6) with `reviews/p1-code-logic-review.md` and
   `reviews/p1-code-style-review.md` (both APPROVED). Let it triage Moderate items per lean rule 4 and decide whether
   a P1 fix batch (incl. Prettier on the 20 files of Batches 1-4) is needed.
3. Mode 2, one at a time, for the uncommitted batches: Batch 10, Batch 11, Batch 13 (lane-routing; before the last of
   them commits, run the wave-3 shared check `npx nx test @ptah-extension/lane-routing --parallel=1` and
   `npx nx lint @ptah-extension/lane-routing`). Give each Mode 2 the report path, the list of other batches' uncommitted
   files (stage by explicit path only) and the hook note (#60).
4. Batch 8: first a visual-reviewer captures the before screenshots (dark + light, Agents tab) from c57a9a1e7 in a
   detached worktree (`git worktree add --detach .claude-worktrees/646-base-shots c57a9a1e7`, plus a node_modules
   junction), with no other heavy check running. Then the Batch 8 Mode 2 (`npx nx test @ptah-extension/skill-synthesis-ui
   --parallel=1`, then `npx nx lint @ptah-extension/skill-synthesis-ui`).
5. Start executors (max 3 in flight, file-disjoint, declare `deliverables`, full brief for codex, no Nx/Jest in
   executors): Batch 15 (B4b) on codex; Batch 14 (A10) on grok; Batch 12 (A6b) after Batch 11 commits. Then wave 4
   per the Waves table. Act on `<agent-lane-completed>`; never poll.
6. Shipping code: one code-logic review per phase from a different family than its implementers (Phases table).
7. Verification commands (one heavy check at a time):
   - One project: `npx nx test <project> --parallel=1`, `npx nx typecheck <project>`, `npx nx lint <project>`.
   - Several projects: `npx nx run-many -t test -p A B --parallel=1` (confirm "Running target test for N projects").
   - Single specs: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`
     (`ptah-cli` and `cli-engine` use `jest.config.cjs`).
   - Degradation pre-check: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 | grep -E "FAIL|TOTAL"`.
   - Never workspace-wide; never build, serve, e2e or package (except the #58 visual-reviewer app run).
8. Commit in the foreground (600000 ms timeout; read `.commitlintrc.json`; subject ≤ 72, body lines ≤ 100). Push in the
   background (the pre-push hook runs di-lint and the Electron `validate-deps` gate). Never commit to main. Keep PR #731
   updated.
