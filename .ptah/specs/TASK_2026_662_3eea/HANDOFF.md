# HANDOFF - Skills epic (TASK_2026_639 + TASK_2026_662) - 2026-10-19 (session 3)

## Goal

The user approved the full skills epic:

- Epic TASK_2026_639 children: TASK_2026_644 (PR #756 MERGED) and TASK_2026_435 (prompt-authoring rubric
  sweep, PR #759 OPEN).
- TASK_2026_662: delete the skill-synthesis pipeline in place, keep and fix the Library, add a success
  signal derived from task-folder reviews, archive then drop the pipeline data. 71 batches (+3 carry-over
  tasks) in 6 phases (A-F) in `batches.md`.
- Out of scope: epic TASK_2026_640 (harness-sync distribution).

## Done

| Item | Branch / worktree | State |
| --- | --- | --- |
| TASK_2026_644 | `docs/skills-lane-messaging` | PR #756 MERGED |
| TASK_2026_435 | `docs/skills-rubric-sweep` / `.claude-worktrees/skills-rubric-sweep` | PR #759 OPEN, head `5114892a9`. At 2026-10-18 ~20:20 all CI checks passed; merge state UNKNOWN (computing). Only CodeRabbit review is on `7c95b0e21`, already addressed by `8f56815e4`. No new review. |
| TASK_2026_662 Phase A (1-15) + fix round | `refactor/skill-synthesis-purge` / `.claude-worktrees/skill-synthesis-purge` | CLOSED. Fix round `8360e7aca`, records `dc10d73b2`. Reviews: round 2 REVISE 7/10, bounded correction, round 3 APPROVED 8/10. Visual review APPROVED 8/10 (`visual-review-phase-a.md`, `d1a2b32c8`). |
| TASK_2026_662 Phase B | same | 16 `6071e8ccc`, 19 `f2f58fdea`, 22 `e632e109d`, 17 `f2e072e0a`, 18 `03efa52df`, 20 `221127d6a`, 21 `917be31f2`; docs `d1a2b32c8`, `36b72025a`, `b886cd2e8`, `19d3e8b1e`. |

Branch `refactor/skill-synthesis-purge` is NOT pushed (local only). HEAD `19d3e8b1e` + uncommitted batches 23/24.

## In progress (UNCOMMITTED in the 662 worktree)

- **Batch 23** (codex lane `03940144`, done): `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts` + spec.
  Removed the `invocationCount <= 0` gate; null -> "No grade", 0 -> "0%". Report `reports/batch-23-report.md`.
  Its gate failed only on `clone-card.component.spec.ts` "reads as empty (one sentence) rather than four em
  dashes when unused" - a batch 24 file. Decision O15: verify 23 + 24 with ONE combined gate, commit separately.
- **Batch 24** (codex lane `c2488d5d`, finished, unverified): see "Lane state at handoff" below. Files: `SU/components/clones/
  skill-clones-view.component.ts`, `clone-card.component.ts`, `clone-detail-drawer.component.ts` + specs.
  Rule O15: unused AND ungraded -> one-sentence empty state; used but ungraded -> uses + "No grade";
  graded -> rate. The O14 save handler in `skill-clones-view.component.ts:~813-838` must stay.
- Uncommitted `decisions.md` rows O15 (and nothing else).

## Open problems and decisions

1. Decisions O7-O15 (this session) are in `decisions.md`. Key: O7 `formatSourceHash` moved to platform-core;
   O9 bounded correction (S1 root normalisation both sides); O10 dashboard Skills tile shows telemetry On/Off;
   O12 scorecard optional -> degrade, telemetry SQL in event store; O13/O13a batch 17 consumer fixes + core
   `PendingSettingsTab` adds `enhancement` (old ids removed in Task 53.2); O14 drawer save via parent; O15.
2. Deferred: tasks 44.2 (St-M2, round-2 M1/M2, round-3 N1), 65.2 (St-M3), 67.2 (L-M9), 53.2 (old
   `PendingSettingsTab` ids). Phase A visual Serious 1 (dark `badge-success`/`badge-error` contrast, pre-existing)
   is a named follow-up outside the task.
3. Proposed removal awaiting USER approval: unreachable `routing-background-more` template branch
   (`libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts:~156`), kept for now.
4. PNG screenshots are git-ignored (`.gitignore:141`, `.ptah/specs/**/*.png`); `visual/after/*.png` exist on
   disk only. Ask the user whether to `git add -f` them.
5. Lanes: Glm (`pc-355b645d-35af-4974-84cf-9cf961ea0164`) stopped twice mid-read on batch 19 -> codex used for
   all later batches (agent-lanes §5). codex resumes usually become fresh lanes (context > 60k or idle > 600 s):
   always give full instructions. codex messaging is `queue-next-turn`: a queued message runs as a LATER turn;
   wait for its own completion signal. Avoid grok (100% weekly) and opencode (93% monthly). Max 3 lanes.
   Lanes never run checks; the orchestrator runs one scoped check at a time.
6. One team-leader amended a commit before push (e632e109d); later briefs say "never amend".
7. Phase F needs the user: OP-1 archive dry-run receipt on a COPY of the user DB before batch 68 (0057 drop);
   OP-2 snapshot-prune dry-run before applying.
8. Electron is shared: before any launch send "Electron: 662 launching, port <p>" to every peer (ListAgents +
   SendMessage), then "Electron: free". Use port 9390 (never 9333; peers use 9334, 9370, 9380). Private APPDATA.
9. User settings: `~/.ptah/settings.json` has `skillSynthesis.enabled=false` (keep it).
10. Worktrees `skills-lane-messaging`, `skills-rubric-sweep`, `question-routing-e2e` stay until the user says to
    remove them (remove the node_modules junction with `cmd /c rmdir <wt>\node_modules` first).

## Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\`
  (`batches.md` with statuses + `### Next action`, `decisions.md`, `implementation-plan.md`, reviews
  `code-logic-review*.md`, `visual-review-phase-a.md`, `reports/batch-*-report.md`).
- Skills: `.claude/skills/orchestration/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge status --short` (expect batch 23 + 24
   files and `decisions.md`; HEAD `19d3e8b1e`). Read `reports/batch-24-report.md`.
2. If batch 24 is not complete, finish it with a fresh codex lane (full brief from `batches.md` Batch 24 + O15).
3. Combined gate for 23 + 24 (prefix `NX_NO_CLOUD=true`, filter with
   `grep -E "Running target|Tests:|Test Suites:|error TS|FAIL|●|Successfully|failed|  error "`):
   `npx nx run-many -t test typecheck lint -p @ptah-extension/skill-synthesis-ui --parallel=1`
   Failures -> numbered `file:line` defects to a fresh codex lane; re-run the gate.
4. Fresh `team-leader` Mode 2: commit batch 23 and batch 24 separately (foreground, specific files, never amend),
   then a docs commit (`decisions.md`, both reports, `batches.md`).
5. Phase B review: code-logic review (Claude subagent; implementers codex) on `dc10d73b2..HEAD` ->
   `code-logic-review-phase-b.md`; Phase B visual review (visual-reviewer, port 9390, private APPDATA, tell peers
   first) using the Phase map row B list in `batches.md` (includes Phase A Moderate 1 / Minor 1 carry-overs).
   One fix round, then a short re-review, then team-leader commits.
6. Phase C (batches 25-56) per `batches.md` waves; one code-logic review per phase. Get user confirmation before
   OP-1 / batch 68 and OP-2.
7. PR #759: `gh pr view 759 --json statusCheckRollup,mergeStateStatus`; a new CodeRabbit review -> fix with Glm,
   both skill copies, `npm run manifest:generate` then `npm run manifest:check`, commit foreground, push background.
8. When TASK_2026_662 is complete: push `refactor/skill-synthesis-purge` in the background, open its PR, set
   TASK_2026_662 and epic TASK_2026_639 `status: done` (status line only).

## Verification rules (memory-safe)

- Only changed projects: `npx nx run-many -t test typecheck lint -p <projects> --parallel=1`; confirm the header
  says "for N projects" with the requested N.
- One spec: `npx jest -c <lib>/jest.config.ts <spec> --coverage=false --maxWorkers=2`.
- Never workspace-wide, build, serve, e2e or package unless the user asks. One heavy check at a time.
- Under load, `voice-rpc.handlers.spec.ts` and `skills-sh-legacy-adoption.spec.ts` (rpc-handlers) can time out;
  re-run them alone before treating them as failures.
- Commit in the foreground only when no lane edits the worktree; push in the background.
- Commits: read `.commitlintrc.json`; subject <= 72, body lines <= 100; end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Lane state at handoff

- No lane or subagent is running.
- Batch 24 lane `c2488d5d` (codex) COMPLETED (exit 0, verdict delivered): `reports/batch-24-report.md`
  (4378 bytes) written. It claims the three-kind card/drawer display is implemented; its scoped diagnostics were
  clean. NOT yet verified: the combined 23 + 24 gate (next step 3) has NOT been run, and the code has not been
  read by the orchestrator. Start at next step 1, then go to step 3 (skip step 2 unless the report shows gaps).
- Lane's final report: 5 files edited under `libs/frontend/skill-synthesis-ui/src/lib/components/clones/`:
  `clone-card.component.ts` + spec, `clone-detail-drawer.component.ts` + spec, `skill-clones-view.component.spec.ts`
  (the view component itself is unchanged; the O14 save handler is kept). It reports 11 diagnostics errors in
  sibling files outside its scope; the gate decides if they are real.
