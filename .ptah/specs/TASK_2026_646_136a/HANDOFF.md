# HANDOFF - TASK_2026_646_136a (2026-10-15, session 3)

## Goal

An optional decision model for orchestration routing, plus a lane evaluation loop:
- A "Decision model" background role (Ollama, TypeSafe Jev via `/v1/systemone`, or any structured-output model).
- A `ptah_route_decide` MCP tool (HTTP and stdio dispatchers).
- A lane and subagent outcome record, with `ptah_outcome_report`.
- A capability matrix as data (`source`, `asOf`).
- A spread rule across every spawnable lane (codex, opencode, grok, antigravity, Glm ptah-cli, Claude in-process, any
  new `ptah_agent_list` row).

Approved requirements: `task-description.md` (revision 3, 13 requirements, Gate 1 passed).

Final user decisions (do not reopen): #12 (no decision model set → deterministic ranking always chooses), #13 (replace
the Agents-tab "Success" figure), #18 as amended by #22 (keep and fix in place, no carve-out), #19 (535/537 merged).
Keep `skillSynthesis.enabled=false` in `~/.ptah/settings.json`. Leave memory untouched.

## Done

Branch `feat/decision-model-routing`, worktree `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`,
draft PR https://github.com/Hive-Academy/ptah-extension/pull/731. Pushed; local equals origin at `e4a488bc7`.

- `cf381d4a1`, `2e24fb358` (session 2): decisions #22-#24, Scope additions 3, the 662 context.
- `34ef59100` docs(task-specs): add TASK_2026_646 implementation plan for Gate 2.
- `f11a08649` docs(task-specs): revise TASK_2026_646 plan for Gate 2 round 1.
- `c9ffe43d8` docs(task-specs): revise TASK_2026_646 plan for Gate 2 round 2.
- `e4a488bc7` docs(task-specs): record TASK_2026_646 Gate 2 round 3 review.

Architecture (session 3):
- The first in-process architect stopped at its context limit (~250k tokens) with nothing written (decision #25).
- The plan was then written as pass A (routing, new lib `libs/backend/lane-routing`, batches A1-A16) and pass B
  (evaluation loop, new lib `lane-outcomes`, batches B1-B10) in parallel, then an integration pass
  (`implementation-plan.md`, merged batches AB1 shared types, AB9 all MCP registration, AB14 host wiring and guard
  specs). Decisions #26-#33.
- Gate 2 cross-side review on codex lanes, three rounds:
  - Round 1: REVISE, 6 Serious + 1 Moderate → revision 1 (decisions #34-#38; #39 = partial IA-4 evidence).
  - Round 2: REVISE, 3 new Serious → revision 2 (decisions #40-#42; #41 removes the plan-only slug fallback).
  - Round 3: REVISE at the revise cap. All six earlier findings FIXED. Escalated to the user (decision #43).

Gate 0.1 refresh is recorded in `context.md` § CLI Lanes: mode `enabled`, Approval `lane-review`.

## In progress

Nothing is running (no lanes, subagents or background commands).

**Waiting on the user: the Gate 2 decision.** The user was asked to answer one of:
- `APPROVED with fixes` (recommended): the architect fixes R3-1 and R3-2 in one small edit, then one short codex
  check scoped to those two fixes, then team-leader decomposition.
- `APPROVED`: accept as is; R3-1 and R3-2 go into the batch notes as required fixes for B10a and A13.
- `REVISE: <direction>`.

Do not start decomposition or any implementation before the user answers.

## Open problems and decisions

- **R3-1 (Serious):** `implementation-plan.md` ~:470-475. When the desktop/CLI store is not open,
  `ptah_outcome_report` returns `{ ok: true, state: 'queued' }` before it validates the run ID; an unknown ID later
  only logs a warning. Req 5.6 (`task-description.md` ~:296-299) requires an error that names the ID and no write.
  Fix: validate against known rows, pending inserts and held reports before returning; if validation cannot finish,
  return an error naming the ID. Add a backlog unknown-ID fixture that checks the tool result and the store. Keep
  the report-before-stop hold for subagent runs.
- **R3-2 (Moderate):** `implementation-plan-part-a.md` ~:287-295. A live 404 for "model not found" is persisted as
  `unsupported-endpoint` even when the control probe proved the route exists. Fix: use the route discriminator, or a
  distinct model/provider failure state; add a live model-not-found fixture.
- **Implementation gates in the plan:** IA-5 (Ptah's PostToolUse `additionalContext` run tag
  `ptah-run: runId=subagent:<agentId>` reaches the model) must be confirmed by one runtime capture in A15. IA-4 is
  now only an optimisation. PA-1..5 and PB-1..5 assumptions are listed in `implementation-plan.md`
  § Assumptions to check first, each with its owning batch.
- **Known lane defects (TASK_2026_663_50d4):** OpenCode lanes can lack `ptah_*` tools; a role's default file name can
  override a declared deliverable (give each review round an explicit path, copy earlier rounds first — done for
  rounds 1-3); codex resume fails after 600 s idle (give a full brief on every respawn).
- **Lane limits (2026-10-15):** codex confirmed room (Weekly 0%); opencode near limit (Go Monthly 91%); antigravity,
  grok and Glm unknown. Check `ptah_agent_list` before each spawn.
- **Architect context:** each in-process architect pass used ~170-200k tokens. Keep future architect briefs narrow
  (one finding set, offset/limit reads, write-as-you-go).
- **TASK_2026_662_3eea questions (owned by 662, not this task):** Skills/Commands "Success %" → use count; the table
  drop list; keep or delete `extract-and-relocate-angular-component-feature`.

## Key files

All in `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\`:
- `implementation-plan.md` — integrated plan; wins over the parts. Sections: Shared contracts SC-1..SC-10,
  Reconciliation log, Requirement coverage, Batches, Parallel waves, Assumptions, Handoff to TASK_2026_662_3eea,
  Revision logs (rounds 1 and 2).
- `implementation-plan-part-a.md` (routing) and `implementation-plan-part-b.md` (evaluation loop) — normative parts.
- `implementation-plan-review-round1.md`, `-round2.md`, `-round3.md` — the codex reviews.
  `implementation-plan-review.md` is the same content as round 3.
- `decisions.md` (#1-#43), `context.md` (§ CLI Lanes, § Scope additions 1-3), `task-description.md`,
  `parity-inventory.md`, `research-runtime-survey.md`, `research-codebase-survey.md`.

## Next steps

1. Get the user's Gate 2 answer (see In progress). Work only in the worktree above.
2. If `APPROVED with fixes`:
   - Spawn one fresh `software-architect` subagent (in-process) with a narrow brief: fix R3-1 and R3-2 only, from
     `implementation-plan-review-round3.md`; add `## Revision log (Gate 2 round 3 fixes)`; append decisions from #44.
   - `implementation-plan-review-round3.md` already holds round 3. Delete `implementation-plan-review.md` before the
     check so the deliverable check is meaningful. Spawn a codex lane (full brief, explicit deliverable
     `implementation-plan-review.md`, title `round 4 — scoped fix check`) that checks only R3-1 and R3-2.
   - Commit in the foreground; push in the background.
3. After approval, record the gate in `decisions.md`, then run the `team-leader` in decomposition mode to write
   `batches.md` from the Batches and Parallel waves tables. Spread batches across codex, antigravity, grok, Glm
   (opencode only for light work while near its limit), at most 3 lanes in flight, file-disjoint per wave. Declare
   `deliverables` on every spawn; act on `<agent-lane-completed>`; never poll.
4. Shipping code gets one code-logic review per phase from a different family than the implementer
   (`code-logic-review.md`, with a `Review family` record).
5. Verification after each batch, one heavy check at a time:
   - One project: `npx nx test <project> --parallel=1` (also `typecheck` and `lint` for that project).
   - Several projects: `npx nx run-many -t test -p A B --parallel=1`; confirm the header says
     "Running target test for N projects" with the requested N.
   - Single specs: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
   - Never workspace-wide; never build, serve, e2e or package.
6. Commit in the foreground (read `.commitlintrc.json`; subject ≤ 72 chars, body lines ≤ 100). Push in the
   background. Never commit to main. Keep PR #731 updated.
