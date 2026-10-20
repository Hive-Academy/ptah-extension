# HANDOFF - Skills epic (TASK_2026_639 + TASK_2026_662) - 2026-10-20 (session 8)

## Session 9 update (2026-10-20)

Next steps 1-6 are done: gate green after fixes, two reviews, commits 902e37d2f (68), 1414253ba (69),
70cf30416 (audit marker), audit exit 0. See decisions O53 and O54. Remaining: push + PR (step 7),
then the status commit (step 8).

## Goal

The user approved the full skills epic:

- Epic TASK_2026_639 children: TASK_2026_644 (PR #756 MERGED) and TASK_2026_435 (PR #759 MERGED).
- TASK_2026_662: delete the skill-synthesis pipeline in place, keep and fix the Library, add a success
  signal derived from task-folder reviews, archive then drop the pipeline data. Batches 1-72 in 6 phases
  (A-F) in `batches.md`.
- Out of scope: epic TASK_2026_640 and backlog task TASK_2026_701_9e4b. Do NOT start them.
- U8: Electron is the priority host. No TUI or VS Code feature work and no visual checks for them. Keep
  the typecheck/test gates for every host that compiles a changed lib.

## Done

Worktree `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge`, branch
`refactor/skill-synthesis-purge`. NOT pushed (local only), no PR yet. Commits this session (oldest first,
on top of `2a715bfa3`):

| Commit | Content |
| --- | --- |
| `333be4e41` | batch 67: archive format 2 (+ the two `.claude/skills` deletions of batch 71 landed here by mistake, O51 d) |
| `6112b70d5` | batch 70: `retireManagedSkills()` + user-layer listing exclusion |
| `68807eeb2` | batch 71: "Extract UI feature" suggestion removed (body notes the slip) |
| `658755c59` | docs: batches 67/70/71 COMPLETE, O46-O51, Phase F review + r2, reports, old handoff |
| `4da7713ec` | docs: `visual-review-phase-ef.md` APPROVED 8/10, O52 |

Evidence this session:
- Phase F gate (6 projects): 81/82 suites green; `native-baselines.spec.ts` (sources identical to `main`)
  failed under peer push load, passed on `main`, then passed alone in the worktree (11/11): accepted (O51 a).
- `scripts/export-skill-pipeline-archive.spec.ts` fixed for the scripts tsconfig (index access) + dedupe
  compare now requires equal table count; persistence-sqlite test+typecheck re-run green; spec 2/2 (O51 b).
- `code-logic-review-phase-f-r2.md` APPROVED 8.5/10 (Claude reviewer; codex implementer).
- Phase E+F Electron visual review APPROVED 8/10 (O52). The run used the worktree as workspace and
  harness sync deleted 7 tracked `.claude/commands/*.md` and edited `.gitignore`; restored with `git restore`.
  Future recipes: point the sandbox workspace at a temp copy.
- OP-1 done: SQLite backup-API snapshot of the live DB (`quick_check` ok) and dry-run export on the copy,
  in `C:\Users\abdal\AppData\Local\Temp\ptah-op1-8BUWMI\` (archive `export\pre-0057-rvHLJt`, 12 MB,
  receipt sha256 `4045f1aa...ddee8d`; vec 2692 rows, all with unique rowids). Snapshot script:
  `C:\Users\abdal\AppData\Local\Temp\ptah-op1-tools\snapshot.cjs`.
- **User decisions (U9, recorded in `decisions.md`, uncommitted):** OP-1 APPROVED (register 0057).
  OP-2: KEEP ALL ~1055 `.history` snapshots, no prune; batch 50 stays PARTIAL by decision.

## In progress at handoff (UNCOMMITTED, the lane finished)

Codex lane (finished, exit 0, verdict delivered; CLI Session ID `01a1570b-d90e-7210-9b45-86beeb6e4173`
for `resume_session_id` in a fix round, but still give full instructions) wrote batches 68 + 69.
Report: `reports/batch-68-69-report.md`. BOMs stripped
(none found). NOT gated, NOT reviewed, NOT committed:

- Batch 68: new `PS/migrations/0057_drop_skill_pipeline.ts` + `.spec.ts` (4 required cases),
  `PS/migrations/index.ts` (0057 last), 16 ratchet pins 56 -> 57 in migration specs (0028 ... 0056),
  `PS/skill-pipeline-archive.ts` one line: `export const PIPELINE_JOB_IDS` (scope exception for reuse,
  accept it). Runner unchanged (`FIRST_DESTRUCTIVE_SKILL_PIPELINE_VERSION` already 57).
- Batch 69: `PS/migration-runner.spec.ts` order spec (vec catch-up -> archive -> drop),
  `PS/embedder/embedder.interface.ts` comment names only the memory curator.
- `decisions.md` has the uncommitted U9 row.

(PS = `libs/backend/persistence-sqlite/src/lib`.)

## Machine queue with peers

- At handoff, peers 708 (voice) and 707 (analytics) paused for handoffs; notification-final
  (`ptah-ptah-extension-notification-final-f-563e7e0000ebk2qkufgly0j`) may run canvas/git-ui/webview checks.
  662 told all of them it pauses and will re-announce.
- New session: run `ListAgents`, message every peer "662 wants one 2-project nx gate, then a push with the
  pre-push gate", wait for "checks: free"/"go", and send "checks: free" to the next peer afterwards.

## Open problems and decisions

1. Named follow-ups (recorded, not fixed): Phase C M3, M5, m1-m6; light-theme tile contrast; Skills tile
   staleness; lane-outcomes warning; O36d; O37; 24px spec buttons; O45; O48; Phase F M2/M3 + Minors (O50);
   r2 Moderate (vec rowid spec uses a plain table; real-vec0 evidence from OP-1) and r2 Minors (O51 c);
   stale "synth" legend at `skill-clones-view.component.ts:210` and frontmatter-as-markdown (O52).
2. `skill-judge.service.ts`, `applyProposal`, `queue/queue-db.test-support.ts`, spec RPCs kept (U5).
3. Encoding: after each lane run strip BOMs:
   `for f in $(git status --porcelain | awk '{print $2}'); do [ -f "$f" ] && [ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' ')" = "efbbbf" ] && sed -i '1s/^\xEF\xBB\xBF//' "$f"; done`
4. Lanes: codex first (weekly 65%, resets 2026-10-24). Glm (`pc-355b645d-35af-4974-84cf-9cf961ea0164`,
   modelTier opus) only as fallback. Never grok or opencode. Max 3. `ptah_agent_list` before each spawn.
   Full instructions every time. Lanes run no checks.
5. Commit with explicit pathspecs (`git commit -F - -- <paths>`); never `git add` + bare `git commit` while
   other changes are staged (cause of the O51 d slip). Never amend.
6. `~/.ptah/settings.json` keeps `skillSynthesis.enabled=false`. Worktrees `skills-lane-messaging`,
   `skills-rubric-sweep`, `question-routing-e2e`, `electron-first` stay until the user says otherwise.
7. Never commit `visual/` folders (U4).

## Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\`
  (`batches.md`, `decisions.md` U1-U9 + O1-O52, `implementation-plan.md`, `reports/batch-68-69-report.md`,
  reviews `code-logic-review-phase-{d,d-r2,e,f,f-r2}.md`, `visual-review-phase-ef.md`, `drafts/`).
- Epic task file: `.ptah/specs/TASK_2026_639*/task.md`; this task: `TASK_2026_662_3eea/task.md`.
- Skills: `.claude/skills/orchestration/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge status --short`. Expect HEAD
   `4da7713ec`, the uncommitted batch 68/69 files above, `decisions.md` (U9), the report, untracked `visual/`.
2. Read `reports/batch-68-69-report.md` and the two 0057 files; spot-check the 4 spec cases and that the
   drop deletes only `PIPELINE_JOB_IDS` rows.
3. Coordinate peers, then ONE gate (filter output):
   `NX_NO_CLOUD=true npx nx run-many -t test typecheck -p @ptah-extension/persistence-sqlite mcp-bench --parallel=1 > /tmp/gate-68.log 2>&1; sed 's/\x1b\[[0-9;]*m//g' /tmp/gate-68.log | grep -E "Running target|Test Suites:|error TS|FAIL  [a-z]|● .*›|Successfully|^- "`
   Header must say 2 projects. Also `npx jest --config=scripts/jest.config.ts scripts/export-skill-pipeline-archive.spec.ts --coverage=false --maxWorkers=1`
   (the archive file changed). O20: if the export of `PIPELINE_JOB_IDS` or index changes affect other
   dependents' typecheck, add `ptah-electron` typecheck. Known load-flaky mcp-bench specs
   (`native-baselines`, `open-handle-probe`, `corpus`, `host-launcher`) count only after a pass alone:
   `npx jest -c tools/mcp-bench/jest.config.ts <spec> --coverage=false --maxWorkers=1`.
4. One code-logic review of batches 68-69 (different family than codex: a Claude `code-logic-reviewer`,
   read-only) -> `code-logic-review-phase-f-68-69.md`. One fix round only for Blocking/Serious.
5. Commit in the foreground with pathspecs: batch 68 `refactor(persistence-sqlite): batch 68 - register 0057 drop`
   (0057 files, index.ts, the 16 pinned specs, skill-pipeline-archive.ts), batch 69
   `test(persistence-sqlite): batch 69 - vec order spec and embedder comment`, then
   `docs(task-specs)`: `batches.md` (68, 69 COMPLETE; OP-1 confirmed; batch 50 PARTIAL by U9),
   `decisions.md`, report, review, this HANDOFF. Read `.commitlintrc.json`; subject <= 72; body lines <= 72;
   end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
6. Degradation audit: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` (exit 0;
   never raise baselines).
7. Push in the background (Bash `run_in_background`), announce to peers first (pre-push runs di-lint +
   Electron validate-deps):
   `git push -u origin refactor/skill-synthesis-purge && gh pr create --base main --title "refactor: purge skill-synthesis pipeline, keep the Library" --body-file <file>`
   (`## Summary` + `## Test plan`, mention 0057 archives then drops 9 tables on next boot, end with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). A failed gate needs a fix commit on top.
   Report the PR link.
8. Set `status: done` in `TASK_2026_662_3eea/task.md` and the TASK_2026_639 `task.md` (edit only the
   `status:` line), commit as docs(task-specs), push again in the background. No OP-2 prune (U9).

## Verification rules (memory-safe)

- Only changed projects: `npx nx run-many -t test typecheck -p <projects> --parallel=1`; confirm the header
  says "for N projects". O20: also gate every project whose specs fake or build a changed API.
- One spec: `npx jest -c <lib>/jest.config.(ts|cjs) <spec> --coverage=false --maxWorkers=2`.
- Never workspace-wide, build, serve, e2e or package unless asked. One heavy check at a time across all
  sessions.
