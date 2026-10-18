# HANDOFF - Skills epic (TASK_2026_639 + TASK_2026_662) - 2026-10-18 (session 2)

## Goal

The user approved the full skills epic:

- Epic TASK_2026_639 children: TASK_2026_644 (Council lane messaging, PR #756 MERGED) and TASK_2026_435
  (prompt-authoring rubric sweep, PR #759 OPEN).
- TASK_2026_662: delete the skill-synthesis pipeline in place, keep and fix the Library, add a success
  signal derived from task-folder reviews, archive then drop the pipeline data. 71 batches in 6 phases
  (A-F) in `batches.md`.
- Out of scope: epic TASK_2026_640 (harness-sync distribution).

## Done

| Item | Branch / worktree | State |
| --- | --- | --- |
| TASK_2026_644 | `docs/skills-lane-messaging` | PR #756 MERGED |
| TASK_2026_435 | `docs/skills-rubric-sweep` / `.claude-worktrees/skills-rubric-sweep` | PR #759 OPEN. CodeRabbit fixes `8f56815e4` (24 fixed, 1 skipped: react server-components Nx entry, reviewer marked it undecided). Merged main incl. #764 as `5114892a9`, pushed. CI was re-running at handoff (`electron-e2e (shard 2/4)` pending, nothing failed). CodeRabbit re-review of `8f56815e4` was rate-limited; all 3 inline threads resolved. |
| main e2e break | `fix/question-routing-e2e` / `.claude-worktrees/question-routing-e2e` | PR #764 MERGED by the user. `new-project-question-routing.spec.ts` uses `goto('canvas')` (driver `goto('chat')` already creates a tile). |
| TASK_2026_662 Phase A batches 1-15 | `refactor/skill-synthesis-purge` / `.claude-worktrees/skill-synthesis-purge` | All 15 committed (15/71). Last commit `fd0110afc`. Not pushed. |

Phase A commits (oldest first): 657b01413 (1), 05139f1bf (2), 3984309d2 (7), ee01c4a94 docs, 75eceaaeb (3),
6aee6af62 (11), 6bd335a2f (15), 6c1529f92 docs, 70fe69067 (4), 7df51a3f6 (5), c46f99bb8 docs, baebe0c30 (6),
31db66e38 (8), 528d34c29 (9), ce231af1e docs, 3c474c1bc (10), 29d1305fb (12), 5e2cbe114 docs,
e5ea784a1 (13), de2e0e7d2 (14), fd0110afc docs.

## In progress (UNCOMMITTED in the 662 worktree) - Phase A review fix round

Phase A reviews (Claude subagents, third family; implementers codex + Glm):
- `code-logic-review.md`: REVISE 6/10, 0 blocking, 3 serious, 9 moderate.
- `code-style-review.md`: REVISE 6/10, 0 blocking, 3 serious, 3 moderate, 4 minor.

Fix plan: `phase-a-fix-round.md` (items 1-15 + 3b + 9 moved to lane B). All three codex lanes FINISHED;
reports: `reports/phase-a-fix-A1-report.md` (items 1-5), `reports/phase-a-fix-A2-report.md` (6, 7, 8, 3b;
item 9 moved), `reports/phase-a-fix-B-report.md` (10-15 and 9). **No checks have been run on the fix
round yet.** Uncommitted files are in skill-synthesis, rpc-handlers, agent-generation, persistence-sqlite,
platform-core (see `git status`). Item 3 is split: A1 removed the harvester `isError` argument, A2 made
`isError` optional in `SkillCandidateStore.reconcileSubagentEvent`/`applyReconciliation`.

Deferred (record in batches.md): L-M9 archive Windows modes/dir accumulation -> batch 67; St-M2 move
attribution grouping out of `SkillTaskGradeStore` -> batch 44; St-M3 move `SKILL_SETTINGS_MIGRATIONS` to
`file-settings-keys.ts` -> batch 65; all Minor findings recorded only.

Still owed for Phase A: visual review of UI batches 7 and 11 (dark + light, "before" from base
`271198ced`, existing captures in `visual/before/`).

## Open problems and decisions

1. Orchestrator decisions O1-O6 are in `decisions.md`. O3: the enhancer auth-failure warn omits the
   error text (credentials risk) - `skill-enhancer.service.ts` ~:853. The fix round item 13 restores
   `error.name` + sanitised message only on the proposal/candidate generation warns.
2. User settings: `~/.ptah/settings.json` has `skillSynthesis.enabled=false` (keep it). After batch 9 the
   manual enhancer returns `paused` while it is false (plan `implementation-plan.md:44,135`). User was told.
3. Lane notes: codex resumes often become fresh lanes (context > 60k or idle > 600 s) - always give full
   instructions. codex/ptah-cli messaging is `queue-next-turn` only. Glm once stopped mid-read; resume worked.
   Spec Logger mocks follow the project convention `{...} as unknown as Logger`; production code never.
4. Phase F needs the user: OP-1 archive dry-run receipt on a COPY of the user DB before batch 68 (0057
   drop); OP-2 snapshot-prune dry-run before applying. Tables to drop are listed in `batches.md`.
5. Electron is shared: before any launch send "Electron: 662 launching" to peers (ListAgents +
   SendMessage), then "Electron: free". At handoff session 698 held Electron on port 9380. Never port 9333.
   Use a private APPDATA.
6. Worktrees `skills-lane-messaging`, `skills-rubric-sweep`, `question-routing-e2e` stay until the user
   says to remove them (remove the node_modules junction with `cmd /c rmdir <wt>\node_modules` first).
7. Lanes: codex (weekly ~20%) first, then Glm (`ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164`,
   modelTier opus). Avoid grok (98% weekly) and opencode (93% monthly) unless the user asks. Max 3 lanes.
   Lanes never run checks; the orchestrator runs one scoped check at a time.

## Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\`
  (`implementation-plan.md`, `batches.md` (statuses + `### Next action`), `decisions.md`,
  `code-logic-review.md`, `code-style-review.md`, `phase-a-fix-round.md`, `reports/`, `visual/before/`).
- Approved removals: `.ptah/specs/TASK_2026_659_cec4/parity-inventory.md` + context D2/D3.
- Skills: `.claude/skills/orchestration/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge status --short` (expect the
   fix-round files above; HEAD `fd0110afc`).
2. Run the fix-round checks, ONE AT A TIME (prefix `NX_NO_CLOUD=true`, filter output with
   `grep -E "Tests:|Test Suites:|error TS|FAIL|●|Successfully|failed|  error "`):
   - `npx nx run-many -t test typecheck lint -p @ptah-extension/skill-synthesis --parallel=1`
   - `npx nx run-many -t test typecheck lint -p @ptah-extension/rpc-handlers @ptah-extension/agent-generation --parallel=1`
   - `npx nx run-many -t test typecheck lint -p @ptah-extension/persistence-sqlite @ptah-extension/platform-core --parallel=1`
   Confirm each header says "for N projects" with the requested N. Send failures as numbered `file:line`
   defects to a fresh codex lane (full instructions; no checks in the lane).
3. Short re-review scoped to the fix-round diff (`git diff fd0110afc`) by a fresh `code-logic-reviewer`
   subagent (and style for items 11, 12, 14). Deliverable: `code-logic-review-round-2.md`.
4. Fresh `team-leader` Mode 2 with the three fix reports + re-review path: commit the fix round in the
   foreground, record the deferred items in `batches.md`, then give `### Next action:`.
5. Visual review (batches 7, 11) when Electron is free: announce to peers first; `visual-reviewer`
   subagent with before screenshots from `271198ced`.
6. Start Phase B (batches 16-24, waves B-W1: 16 ‖ 19, then 17, 18, 20-24). One code-logic review per phase.
7. Check PR #759 CI: `gh pr view 759 --json statusCheckRollup,mergeStateStatus`. Expect green after the
   #764 merge. On a failure: `gh run view <id> --log-failed`. If CodeRabbit posts a NEW review, address it
   with Glm (user asked for grok or Glm), fix both skill copies, `npm run manifest:generate` then
   `npm run manifest:check`, commit in the foreground, push in the background.
8. When TASK_2026_662 is complete: push `refactor/skill-synthesis-purge` in the background, open its PR,
   set TASK_2026_662 and epic TASK_2026_639 `status: done` (status line only).

## Verification rules (memory-safe)

- Only changed projects: `npx nx run-many -t test typecheck lint -p <projects> --parallel=1`.
- One spec: `npx jest -c <lib>/jest.config.ts <spec> --coverage=false --maxWorkers=2`.
- Never workspace-wide, build, serve, e2e or package unless the user asks. One heavy check at a time
  (a `git push` runs the pre-push build gate: start no check while it runs).
- Commit in the foreground only when no lane edits the worktree; push in the background.
- Commits: read `.commitlintrc.json`; subject <= 72, body lines <= 100; end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
