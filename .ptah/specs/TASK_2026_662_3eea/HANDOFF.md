# HANDOFF - Skills epic (TASK_2026_639 + TASK_2026_662) - 2026-10-19 (session 6)

## Goal

The user approved the full skills epic:

- Epic TASK_2026_639 children: TASK_2026_644 (PR #756 MERGED) and TASK_2026_435 (PR #759 MERGED).
- TASK_2026_662: delete the skill-synthesis pipeline in place, keep and fix the Library, add a success
  signal derived from task-folder reviews, archive then drop the pipeline data. Batches 1-72 in 6 phases
  (A-F) in `batches.md`.
- Out of scope: epic TASK_2026_640 (harness-sync distribution). Separate backlog task:
  TASK_2026_701_9e4b (wizard and Library alignment). Do NOT start it in this epic.
- U8 (this session): Electron is the priority host. No TUI or VS Code feature/polish work and no visual
  checks for them; visual reviews in Electron only. Typecheck/test gates for every host that compiles a
  changed lib stay.

## Done

| Item | Branch / worktree | State |
| --- | --- | --- |
| TASK_2026_644, TASK_2026_435 | own branches | PRs #756, #759 MERGED |
| 662 Phases A, B, C (incl. fix round) | `refactor/skill-synthesis-purge` / `.claude-worktrees/skill-synthesis-purge` | CLOSED |
| 662 Phase D (batches 57-61, Tasks 59.0, 61.0) | same | ALL COMMITTED, gates green; Phase D reviews in progress (see below) |
| CLAUDE.md "Product focus: Electron first" (user request) | `docs/electron-first` / `.claude-worktrees/electron-first` | PR #774 OPEN (pushed) |

Branch `refactor/skill-synthesis-purge` is NOT pushed (local only). Commits this session (oldest first):

- `298fd2591` Phase C fix round (S1 disable retired cron jobs, M4 log, U5 spec control, U7 tray, 3 roles,
  stale comments/narration, degradation-audit markers). Re-reviews APPROVED 8/10 (code + visual).
- `b56a94aaa` batch 57 (delete SU pipeline subtree, orphan state API).
- `a441ba440` batch 58 (+ 58.2 O37 stale-spec count = harvested and ageDays >= 7).
- `683a89100` batch 59 (remove 28 pipeline RPCs) + Task 59.0 (TUI read-only Library list, O38).
- `fb37155ff` batch 60 (pipeline registrations/exports; 4 holds, O40).
- `fe68b99ec` batch 61 + Task 61.0 (move 2 event methods to the event store, lane runner without
  budget/queue, delete 96 pipeline files, drop `ThothRuntimeRefs.skillSynthesis`).
- Uncommitted after the last commit: this HANDOFF.md and the Phase D review files (commit them with the
  Phase D docs commit).

Decisions this session: U5-U8 and O35-O42 in `decisions.md` (key ones below).

## In progress at handoff

1. Phase D code-logic review (Claude `code-logic-reviewer` subagent, read-only) on
   `git diff 298fd2591..fe68b99ec` -> `code-logic-review-phase-d.md`. STATUS: see "Review status" at the
   end of this file (filled in at wrap-up).
2. Phase D Electron visual review: NOT STARTED. The reviewer was put on HOLD before any build because peer
   TASK_2026_702 (session `ptah-ptah-extension-task-593-702-notific-678ed90000ebk2qkufgly07`) started a
   heavy check chain first and asked us to wait for "Heavy: free". No build ran, port 9390 untouched.
   The next session must re-run the visual review from scratch (prompt below in Next steps 3).

## Open problems and decisions

1. User decisions pending (ask in ONE bundled AskUserQuestion at the right time):
   - OP-1 (before batch 68 / 0057 drop): user runs the archive export dry-run on a COPY of their DB and
     confirms the receipt. Command in `reports/batch-50-report.md`. Batch 67 must first fix the O34b archive
     writer gaps (omits `scheduled_jobs` rows; Buffer values not base64).
   - OP-2 (snapshot prune): no provenance tag exists; prune script draft in `drafts/`. Ask whether and how.
2. Named follow-ups (not fixed, recorded): Phase C M3, M5, Minor m1-m6; light-theme tile/card contrast
   (pre-existing); Skills tile staleness; lane-outcomes warning; routing map shows Decision always as
   "Default" (Providers state has no decision slice, O36d); a retired job can be re-enabled from Schedules
   for one session (next boot disables it again, O37); visual Minor (24px spec buttons).
3. Known load-flaky specs (accept only after a pass when run alone): mcp-bench `native-baselines.spec.ts`,
   `corpus.spec.ts`, `host-launcher.spec.ts`, `open-handle-probe.spec.ts`; Electron
   `git-watcher.stress.spec.ts`; rpc-handlers harness specs (O26, O28c, O41, O42).
4. Kept by decision: `skill-judge.service.ts` (enhancer preview scoring), `applyProposal` RPC,
   `queue/queue-db.test-support.ts` (event store spec), the spec RPCs (U5). `skillSynthesis.trayKeepalive`
   key and DTO field are removed in batches 65 and 63 (notes added there, O35c).
5. Encoding: codex lanes on Windows can write UTF-8 BOMs. After each lane, strip BOMs:
   `for f in $(git status --porcelain | awk '{print $2}'); do [ -f "$f" ] && [ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' ')" = "efbbbf" ] && sed -i '1s/^\xEF\xBB\xBF//' "$f"; done`
6. degradation-audit must pass before push: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
   (exit 0 at `298fd2591`; deletions since then only lower counts).
7. Lanes: codex first (weekly ~47% at last check, confirmed room). Glm
   (ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`, modelTier opus) only as fallback. Never grok or
   opencode. Max 3 lanes. Codex resumes usually start fresh: always give full instructions. Lanes never run
   checks.
8. Electron and heavy jobs are shared with peers: before a launch/build, ListAgents + SendMessage
   "Electron: 662 launching, port 9390" to every peer and honour "hold" requests; afterwards send
   "Electron: free". Port 9390, private APPDATA.
9. `~/.ptah/settings.json` has `skillSynthesis.enabled=false` (keep it).
10. Worktrees `skills-lane-messaging`, `skills-rubric-sweep`, `question-routing-e2e`, `electron-first` stay
    until the user says to remove them (first `cmd //c rmdir <wt>\node_modules`, the junction).

## Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\`
  (`batches.md` statuses + owner notes, `decisions.md` U1-U8 + O1-O42, `implementation-plan.md`,
  `reports/batch-*-report.md`, reviews `code-logic-review-phase-*.md`, `visual-review-phase-*.md`, `drafts/`).
- Skills: `.claude/skills/orchestration/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`.
- Kept skill-synthesis lib: `libs/backend/skill-synthesis/src/lib/` (registry, catalog, scorecard, enhancer,
  judge, lanes/, event store, grade store, spec harvester/extractor, triggers/, archaeology/session-verdict,
  queue/foreground-activity.tracker, SKILL.md migration, `di/register.ts`, `di/tokens.ts`).

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge status --short` (expect HEAD
   `fe68b99ec` or a later docs commit; untracked `visual/` PNG folders are fine, never `git add -f`, U4).
2. Read `code-logic-review-phase-d.md` (if it is missing, re-run the Phase D code-logic review: Claude
   `code-logic-reviewer`, diff `298fd2591..fe68b99ec`, same questions as in this session; see the Phase D
   prompt summary in `decisions.md` O42 context).
3. Run the Phase D Electron visual review (`visual-reviewer` subagent): build-dev + copy-renderer-dev from the
   worktree, Playwright launch on port 9390 with private HOME/APPDATA/LOCALAPPDATA/user-data/PTAH_DB_PATH,
   checks: Skills Library (cards, detail, editor, Enhance preview drawer clean error without credentials,
   pause/telemetry, Orchestration specs card), routing map 3 roles, Agent Orchestration 3 roles, other Thoth
   tabs, main log without [ERROR]/DI/"No handler registered"/unknown `skillSynthesis:*` method, renderer
   console clean. Output `visual-review-phase-d.md`, PNGs in `visual/phase-d/` (not committed).
4. Phase D fix round (one round, lean rule 4): Blocking + Serious only, numbered file:line defects to fresh
   codex lanes. Gate each touched project (one heavy check at a time, filter the output):
   `NX_NO_CLOUD=true npx nx run-many -t test typecheck -p <projects> --parallel=1 2>&1 | grep -E "Running target|Tests:|Test Suites:|error TS|FAIL |● .*›|Successfully|failed"`
   Then a short re-review scoped to the fixes, and commit in the foreground (never amend). Commit the Phase D
   review files + this handoff in a `docs(task-specs)` commit.
5. Phase E (batches 62-66) and Phase F (67-72) per `batches.md` (read the notes added for 63, 65 by O35c and
   for 59/57 by O35d; batch 62 trims `di/tokens.ts`; batch 66 removes the drain constants, including
   `SKILL_DRAIN_JOB_IDS` — `retired-skill-jobs.ts` has its own id list). One code-logic review per phase.
   Before batch 68 (0057 drop) STOP for OP-1 (after batch 67 fixes O34b). Before any snapshot prune STOP for
   OP-2.
6. When 662 is complete: run the degradation audit, push `refactor/skill-synthesis-purge` in the background
   with `gh pr create`, report the PR link, set TASK_2026_662 and epic TASK_2026_639 `status: done` (edit only
   the `status:` line of each `task.md`).

## Verification rules (memory-safe)

- Only changed projects: `npx nx run-many -t test typecheck -p <projects> --parallel=1`; confirm the header
  says "for N projects". O20 shared-fake rule: gate every project whose specs fake a changed API.
- One spec: `npx jest -c <lib>/jest.config.(ts|cjs) <spec> --coverage=false --maxWorkers=2`
  (cli-engine and ptah-tui use `jest.config.cjs`).
- Never workspace-wide, build, serve, e2e or package unless asked (Electron build-dev for visual review is
  approved for this epic). One heavy check at a time across all sessions.
- Commits: read `.commitlintrc.json`; subject <= 72, body lines <= 100; end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review status (filled in at wrap-up)

- Phase D code-logic review: DONE - `code-logic-review-phase-d.md` REVISE 6/10, 1 Blocking, 0 Serious.
  DI, the Task 61.0 moves, lane runner, RPC contract, frontend and TUI check out.
  - **B1 (Blocking, fix first in the Phase D fix round):** `previewEnhancement` builds
    `{ minJudgeScore: PREVIEW_MIN_JUDGE_SCORE } as SkillSynthesisSettings`
    (`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:~340`). `judgeEnabled` is
    undefined, so `libs/backend/skill-synthesis/src/lib/skill-judge.service.ts:165` returns `disabled` and
    the preview returns an unscored draft with no error. The handler spec pins the wrong behaviour.
    Fix (O43): replace the cast with a typed constant holding every field the enhancer and judge read, at
    the shipped defaults (`judgeEnabled: true`, `minJudgeScore: 6.0`, `judgeModel: 'inherit'`,
    `judgeProvider: ''`, see `libs/backend/platform-core/src/file-settings-keys.ts:~605-611`), ideally by
    narrowing the enhancer/judge parameter to a `Pick<SkillSynthesisSettings, ...>` so no cast is needed;
    fix the handler spec to assert the judge runs. Gate: rpc-handlers, skill-synthesis (+ hosts if a shared
    type changes). Read the review file for any Moderate/Minor items (record, do not fix).
- Phase D visual review: NOT STARTED (held for peer 702 heavy job). Run it after the B1 fix so the Enhance
  preview check covers the fix.
