# HANDOFF - Skills epic (TASK_2026_639 + TASK_2026_662) - 2026-10-19 (session 5)

## Goal

The user approved the full skills epic:

- Epic TASK_2026_639 children: TASK_2026_644 (PR #756 MERGED) and TASK_2026_435 (PR #759 MERGED).
- TASK_2026_662: delete the skill-synthesis pipeline in place, keep and fix the Library, add a success
  signal derived from task-folder reviews, archive then drop the pipeline data. 72 batches + carry-over
  tasks in 6 phases (A-F) in `batches.md`.
- Out of scope: epic TASK_2026_640 (harness-sync distribution).
- Separate backlog task: TASK_2026_701_9e4b (wizard and Library alignment). Do NOT start it in this epic.

## Done

| Item | Branch / worktree | State |
| --- | --- | --- |
| TASK_2026_644, TASK_2026_435 | own branches | PRs #756, #759 MERGED |
| 662 Phase A (1-15), Phase B (16-24a) | `refactor/skill-synthesis-purge` / `.claude-worktrees/skill-synthesis-purge` | CLOSED |
| 662 Phase C (25-56) | same | ALL BATCHES COMMITTED (batch 50 PARTIAL, see O34a). Reviews done: code REVISE 7/10, visual APPROVED 8/10. Fix round NOT started. |

Branch `refactor/skill-synthesis-purge` is NOT pushed (local only). HEAD `fc017254b` + this handoff.

Phase C commits this session (oldest first): 31 `65fec79e9`, 27 `65c1d6654`, docs `41caee551`, 28 `63c90f2d1`,
29 `788f75a97`, 25.1 `dfec43265`, 25.2 `cb196c7dc`, 51 `54fe49b84`, 45 `de0886cac`, docs `57e2f08c0`,
46 `0f890f5a6`, 33 `5810714fc`, 35 `8a314287a`, 34 `5af82793e`, 36 `2e60c07d0`, 47 `98ee61f78`, 37 `b8877bfe6`,
38 `b7eb75628`, 48 `89974fee8`, docs `9fb4668a7`, 39 `5d0bb0173`, 43 `519bf9a7d`, 44.1 `0f13015e9`, docs
`292645188`, 44.2 `bec208f1c`, 40 `8110946a8`, 41 `1c4642ba0`, 42 `8e8c51a2c`, 44.3 `81752ea54`, 49 `9cc842ed4`,
docs `c3edd5644`, 50 `2fc7c3987`, 52 `63d403ef9`, 54 `8b47a798c`, BOM fix `c725aa0f9`, docs `0ba0db6ec`,
53 `7ed99d787`, 55 `70a9f147b`, 56 `167ae5000`, docs `fc017254b`.

Every batch passed its scoped gate before commit (details in `decisions.md` O24-O34 and `reports/batch-*-report.md`).

## In progress - Phase C reviews (phase gate) - BOTH FINISHED, fix round not started

Started in the background at the end of session 5, both on the Phase C diff `git diff 78b5d7b9a..HEAD`:

1. Code-logic review (Claude `code-logic-reviewer` subagent; implementers were codex) ->
   `code-logic-review-phase-c.md`.
2. Visual review (Claude `visual-reviewer` subagent; Electron build-dev, Playwright, port 9390, private
   APPDATA) -> `visual-review-phase-c.md` (PNGs under `visual/phase-c/`, never `git add -f`, U4).

STATUS AT HANDOFF: both finished; results in the "Review results" section at the end of this file. No lane
or subagent is running. Electron is closed and "Electron: free" was sent to all 4 peers.

## Open problems and decisions

1. Decisions this session: O24-O34 in `decisions.md` (key ones):
   - O26/O28c: mcp-bench `native-baselines.spec.ts`, `corpus.spec.ts`, and rpc-handlers harness specs time
     out under load and pass alone. Not regressions.
   - O27/O29/O30/O31/O32/O33/O34: orchestrator bounded corrections (restored retained capabilities the lanes
     removed: reachability `#83`, `CRON_POWER_MONITOR` double, `SKILL_SYNTHESIS_SERVICE` double; deleted the
     `readDormantSkillSlugs` shim; reverted batch 43's broken settings reader). All are in the Phase C review scope.
   - O31a: `previewEnhancement` still calls `this.synthesis.readSettings()`; batch 59 must give the enhancer a
     settings source (it uses only `minJudgeScore`) - note added to batch 59.
   - O33a: U2 handler side (active root to the scorecard) already landed in 44.3; Task 59.1 no longer owns it.
   - O34a: batch 50 shipped only the archive export script (OP-1 evidence). The prune script is parked in
     `drafts/prune-skill-history*.draft`: it needs `@ptah-extension/shared` at run time (no path mapping in
     `scripts/`) and an audited provenance ledger that does not exist. This is an OP-2 question for the user.
   - O34b: archive writer gaps (omits `scheduled_jobs` rows; Buffer values not base64) - added to batch 67.
     Must be fixed BEFORE the 0057 drop.
2. USER decisions still pending (ask in ONE bundled AskUserQuestion at the right time):
   - O30d: lane proposals to retire `skillSynthesis.trayKeepalive` (+ close-window behavior) and the tray
     "Pause skills" item. Kept for now (user-reserved removals).
   - OP-1 (before batch 68 / 0057 drop): user runs the archive export dry-run on a COPY of their DB and
     confirms the receipt. Command in `reports/batch-50-report.md` (`npx ts-node --project scripts/tsconfig.json
     scripts/export-skill-pipeline-archive.ts --db "<db>" --output-root "<dir>"`). Fix O34b (batch 67) first.
   - OP-2 (snapshot prune): how to identify bulk-seed snapshots (no provenance tag exists) and whether to
     prune at all; see O34a.
3. Encoding: codex lanes on Windows wrote UTF-8 BOMs via PowerShell. Lane briefs now say "UTF-8 without BOM,
   use the file edit tool". After each lane, strip BOMs from changed files:
   `for f in $(git status --porcelain | awk '{print $2}'); do [ -f "$f" ] && [ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' ')" = "efbbbf" ] && sed -i '1s/^\xEF\xBB\xBF//' "$f"; done`
4. Minor follow-up for the Phase C fix round: seven comment-only references to the deleted
   `skills-lane-pickers.e2e.spec.ts` in `libs/frontend/webview-e2e-harness/src/lib/scenarios/{boot,vscode-shell,marketplace}/*`
   (list in `reports/batch-51-report.md`). Also from `reports/batch-53-1-report.md`: the e2e
   `tray-keepalive.spec.ts` and `apps/ptah-electron-e2e/src/showcase/scripts/skills-tour.json` (narration) still
   hold obsolete expectations/text; find exact paths with rg and fix them in the same round.
5. Batch 58 caution: its validation rg lists `applyProposal` and `enhanceNow`; `applyProposal` is a retained
   Library method (batch 43 report) and the UI "Enhance now" button runs the preview flow. The lane must keep
   every method the Library still calls.
6. `ptah-cli` gate (>10 min, 36 deps) was deferred from batch 42 to batch 59 (O33c); run it in the background.
7. Lanes: codex first (weekly ~39% used at last check, confirmed room). Glm only as fallback. Never grok
   (AT LIMIT until 2026-10-20 17:40 UTC) or opencode (93% monthly). Max 3 lanes. Codex resumes often start
   fresh - always give full instructions. Lanes never run checks.
8. Electron is shared: before a launch, ListAgents + SendMessage "Electron: 662 launching, port 9390" to every
   peer, then "Electron: free". Port 9390, private APPDATA. Peer TASK_2026_699 uses 9391.
9. `~/.ptah/settings.json` has `skillSynthesis.enabled=false` (keep it).
10. Worktrees `skills-lane-messaging`, `skills-rubric-sweep`, `question-routing-e2e` stay until the user says
    to remove them (remove the node_modules junction with `cmd /c rmdir <wt>\node_modules` first).

## Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\`
  (`batches.md` statuses + owner notes, `decisions.md` O1-O34 + U1-U4, `implementation-plan.md`,
  `reports/batch-*-report.md`, reviews `code-logic-review-phase-*.md`, `visual-review-phase-*.md`, `drafts/`).
- Skills: `.claude/skills/orchestration/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge status --short` (expect a clean
   tree on top of the handoff commit; untracked PNGs under `visual/` are fine).
2. Read `code-logic-review-phase-c.md` and `visual-review-phase-c.md` (summary in Review results below).
3. Phase C fix round (one round, lean rule 4): Blocking + Serious fixed; Moderate only if it breaks a lane
   config or loses data; add the Minor item from open problem 4. Numbered `file:line` defects to fresh codex
   lanes (full instructions, no checks, UTF-8 without BOM). Gate each touched project, one heavy check at a time:
   `NX_NO_CLOUD=true npx nx run-many -t test typecheck -p <projects> --parallel=1 2>&1 | grep -E "Running target|Tests:|Test Suites:|error TS|FAIL |● .*›|Successfully|failed"`
   Then one short re-review scoped to the fixes (code + visual if UI changed). Commit in the foreground.
4. Phase D per `batches.md` (57 -> 58 -> 59 -> 60 -> 61; read the O25a, O31a, O33a, O28b notes in 57/59/61).
   Batch 59 gate is heavy (10 projects incl. `ptah-cli`): run it alone, in the background. One code-logic review.
5. Phase E (62-66) and Phase F (67-72). Before batch 68 (0057 drop) STOP and get the user's OP-1 confirmation
   (after batch 67 fixes O34b). Before any snapshot prune STOP for OP-2. Bundle O30d into the same question.
6. When 662 is complete: push `refactor/skill-synthesis-purge` in the background with `gh pr create`, report the
   PR link, set TASK_2026_662 and epic TASK_2026_639 `status: done` (edit only the status line).

## Verification rules (memory-safe)

- Only changed projects: `npx nx run-many -t test typecheck -p <projects> --parallel=1`; confirm the header
  says "for N projects". Apply the O20 shared-fake rule (gate every project whose specs fake a changed API).
- One spec: `npx jest -c <lib>/jest.config.(ts|cjs) <spec> --coverage=false --maxWorkers=2`
  (cli-engine uses `jest.config.cjs`; scripts use `scripts/jest.config.ts`).
- Docs: `npx prettier --check <changed files>` (`.mdx`/`.mjs` are not formatted by lint-staged; do not
  reformat whole unrelated files).
- Never workspace-wide, build, serve, e2e or package unless the user asks (Electron build-dev for visual
  review is approved for this epic). One heavy check at a time.
- Commit in the foreground only when no lane edits the worktree; push in the background.
- Commits: read `.commitlintrc.json`; subject <= 72, body lines <= 100; end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review results (both FINISHED at the end of session 5; Electron closed, "Electron: free" SENT to all 4 peers)

### Code-logic review - `code-logic-review-phase-c.md`: REVISE 7/10 (0 Blocking, 1 Serious, 5 Moderate, 6 Minor)

Review family: Claude (implementers codex). Read-only, no tests run.

- **S1 (fix now):** the four persisted pipeline cron jobs (`@ptah/skills-drain-*`, `@ptah/skills-backlog-cleanup`)
  keep firing on upgraded profiles with no handler ("No handler registered", up to 96 failed runs/day) until 0057.
  Fix: at cron start, idempotently remove those four job ids from the job store (non-fatal), in
  `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` and `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`
  (runner: `libs/backend/cron-scheduler/src/lib/job-runner.ts:257`). Gate thoth-runtime + cli-engine (+ cron-scheduler if touched).
- **M1 (USER decision - removal):** the Specs panel (list / harvest / clear stale specs) disappeared with the batch 27
  tab rewrite; the RPCs remain and auto-harvest on Stop still works. Ask: accept the removal, or restore a minimal control.
- **M2 (USER decision - removal):** O30a dropped dormant-slug folding (`phase-2-libraries.ts:~246-253`), so dormant
  promoted skills propagate again. Ask: accept (candidate residency is retired) or keep a replacement.
- M3: fast-forward without snapshot can leave a false `diverged` state after a mid-copy failure (review F3).
- M4: grade prune on an empty keep list is silent and unconditional (F2) - add a log line.
- M5: the trigger starts regardless of SQLite state in the CLI tier and is never re-armed after a failed start.
- Minor m1-m6 (cap warn in `spec-harvester.service.ts:134-145`; harvest failure log level; conditional approvals
  parse as pass `spec-extractor.ts:108`; lazy tracker start; export receipt lacks source identity and keeps the temp
  DB copy; `ptah skill-synthesis invocations/stats` CLI readers were removed with the group).
  Lean rule 4: Minor is recorded, not fixed (except trivially with an S1/M-fix lane on the same file).

### Visual review - `visual-review-phase-c.md`: APPROVED 8/10 (0 Blocking, no Phase C regression)

- Skills tab is Library only; "No grade" shown, never 0 %; routing map has no "+N more"; Inspect deep link opens and
  focuses the roles; Agent Orchestration shows 3 roles; enhancement timeout save persists; log has no DI or
  `skillSynthesis:*` errors.
- Serious (pre-existing, same root as Phase A/B follow-ups): light-theme tile value contrast (Memory 1.27,
  Schedules 2.35, Messaging 1.16) and Library card "ready" text 2.15:1.
- Moderate: routing map says "2 roles" vs 3 in Agent Orchestration (preview omits Decision,
  `routing-map.component.ts:26-29`) - fix in the round; Skills nav tile stale after the telemetry switch until a tab
  change; "Lane outcomes start failed (non-fatal)" with empty error on every boot (pre-existing); registered RPC list
  still has pipeline methods (batch 59 owns it).
- 88 PNGs + capture scripts/logs under `visual/phase-c/` (not committed, U4).

### Phase C fix round scope (next session)

Fix: S1; visual Moderate "2 roles" count; M4 log line; open problem 4 items (stale comments, tray-keepalive spec,
skills-tour narration). Ask the user (one bundled AskUserQuestion): M1, M2, O30d tray items. Named follow-ups
(not fixed): M3, M5, visual pre-existing contrast, Skills tile staleness, lane-outcomes warning, Minor m1-m6.
Then a short re-review scoped to the fixes, team-leader-style commit, then Phase D.
