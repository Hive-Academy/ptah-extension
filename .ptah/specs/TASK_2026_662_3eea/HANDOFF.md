# HANDOFF - Skills epic (TASK_2026_639 + TASK_2026_662) - 2026-10-20 (session 7)

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
`refactor/skill-synthesis-purge`. NOT pushed (local only). Commits this session (oldest first):

| Commit | Content |
| --- | --- |
| `6ad21290a` | Phase D fix B1: `MANUAL_PREVIEW_JUDGE_SETTINGS` + `JudgeGateSettings`, preview runs the judge (O43, O44) |
| `53317ca66` | docs: Phase D fix round, re-review `code-logic-review-phase-d-r2.md` APPROVED 9/10 |
| `068678e77` | docs: `visual-review-phase-d.md` APPROVED 8/10 (O45). **Phase D CLOSED** |
| `a825d4749` | batch 62: 24 dead DI tokens removed (O46) |
| `6838d2932` | batch 64: `SKILL_SYNTHESIS_EVENT` push removed (+ baseline entry, spec string) |
| `47f227655` | batch 65: 79 old `skillSynthesis.*` settings removed, `SKILL_SETTINGS_MIGRATIONS` moved, empty `skill-upkeep` group removed (O46, O48) |
| `b2fed64e6` | batches 63 + 66: 82 dead shared DTOs (incl. `trayKeepalive` DTO) and drain constants removed (O47) |
| `2a715bfa3` | docs: Phase E decisions + `code-logic-review-phase-e.md` APPROVED 8.5/10 |

Phase E (62-66): all committed, combined 14-project gate green except load-flaky specs that pass alone
(O48). Phase E code review APPROVED. **Phase E visual review NOT done yet** (Advanced settings: the
Skill upkeep group and 6 rows are gone). It is merged into the Phase F visual review (O49 d).

## In progress at handoff (UNCOMMITTED in the worktree, all lanes finished)

Phase F batches 67, 70, 71 are written, reviewed and fixed, but not yet fully gated or committed:

- Batch 67 (archive, O34b, L-M9, O48 b/c, O49 a, O50): `libs/backend/persistence-sqlite/src/lib/`
  `skill-pipeline-archive.ts` + spec (format 2, `scheduled_jobs` rows, `$base64` BLOB envelope,
  `SELECT rowid AS rowid, *` for `skill_candidates_vec`, root beside the DB, prune only receipt-less dirs
  older than 1 h, reuse of an identical older verified archive, non-fatal maintenance), `db-path.ts` + spec
  (`skillPipelineArchiveRoot`), `migration-runner.ts` + spec, `sqlite-connection.service.ts` + spec,
  `scripts/export-skill-pipeline-archive.spec.ts`, mcp-bench `data/candidate-row-diff.ts` + spec (local
  decoder) and `suites/audits/snapshot-audits.suite.spec.ts` (fixture `format: 2`).
  Report: `reports/batch-67-report.md` (revisions 1 and 2).
- Batch 70 (O49 c): `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`
  `retireManagedSkills()` + spec, `user-layer-fs-ops.ts` listing exclusion. Report: `reports/batch-70-report.md`.
- Batch 71 (O49 b): `.claude/skills/execute-phase-gated-task/` and
  `.claude/skills/extract-and-relocate-angular-component-feature/` deleted (staged with `git rm`), one
  suggestion removed from `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts`.
- Also uncommitted: `batches.md` (62-66 marked COMPLETE), `decisions.md` (O46-O50),
  `code-logic-review-phase-f.md` (REVISE 7/10; S1 and M1 are fixed, see O50).

Gate status of this uncommitted code:
- Green (2nd run): agent-generation, chat-ui, ptah-electron, ptah-extension-vscode, persistence-sqlite
  typecheck. persistence-sqlite tests were green before the last two small edits.
- mcp-bench: after the decoder and fixture fixes, `sample-sessions`, `candidate-row-diff` (18/18) and
  `snapshot-audits` (13/13) pass alone. The full mcp-bench test+typecheck run is NOT yet repeated.
  Known load-flaky (accept only after a pass alone): `native-baselines.spec.ts`, `open-handle-probe.spec.ts`,
  `corpus.spec.ts`, `host-launcher.spec.ts`.

## Machine queue with peers (shared heavy jobs)

- This session yielded the machine to peer `ptah-ptah-extension-task-593-702-notific-8fa43e0000ebk2qkufgly0b`
  for its two PR pushes and asked for "checks: free" back. That message will arrive in the OLD session. The
  new session must run `ListAgents`, ask that peer (and any other peer) whether heavy jobs run, and wait for
  "checks: free" / "go" before any nx gate or Electron build.
- The microsoft-store session left the queue. Peer 707 (`ptah-ptah-extension-chat-9237e9...`) is done.
- Before an Electron build: notify every peer "Electron: 662 launching, port 9390"; afterwards send
  "Electron: free" (and "checks: free" to the next peer in the queue).

## Open problems and decisions

1. User decisions pending (ONE bundled AskUserQuestion at the right time):
   - **OP-1 (before batch 68, the 0057 drop):** the live DB `~/.ptah/state/ptah.sqlite` (1.1 GB) has an
     active `-wal`, so `scripts/export-skill-pipeline-archive.ts` refuses it (correct). Plan: in your machine
     slot, make a consistent read-only snapshot with the SQLite backup API (better-sqlite3 `db.backup()` on a
     `readonly` connection) into a new private temp dir, then run
     `npx ts-node --project scripts/tsconfig.json scripts/export-skill-pipeline-archive.ts --db "<snapshot>" --output-root "<private temp dir>"`
     and show the user the receipt (9 tables, rows, sha256, archive path). Alternative: the user closes all
     Ptah hosts and runs the command. Batch 68 must NOT be committed until the user confirms.
   - **OP-2 (snapshot prune):** no provenance tag exists; prune script draft in `drafts/`, commands in
     `reports/batch-50-report.md`. Ask whether and how. Runs only after 0057 ran on the user's machine.
2. Named follow-ups (recorded, not fixed): Phase C M3, M5, m1-m6; light-theme tile contrast; Skills tile
   staleness; lane-outcomes warning; routing map Decision always "Default" (O36d); retired job re-enable
   for one session (O37); visual Minor 24px spec buttons; Enhance preview shows raw `empty-candidate`
   without a "no provider configured" reason (O45); default-only lane/trigger readers and unused
   `flatten*` helpers (O48); Phase F M2/M3 and Minors (O50).
3. `skill-judge.service.ts`, `applyProposal`, `queue/queue-db.test-support.ts` and the spec RPCs are kept
   by decision (U5).
4. Encoding: codex lanes can write UTF-8 BOMs. After each lane run:
   `for f in $(git status --porcelain | awk '{print $2}'); do [ -f "$f" ] && [ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' ')" = "efbbbf" ] && sed -i '1s/^\xEF\xBB\xBF//' "$f"; done`
5. Lanes: codex first (weekly 62% at last check). Glm (`pc-355b645d-35af-4974-84cf-9cf961ea0164`, modelTier
   opus) only as fallback. Never grok or opencode. Max 3 lanes. `ptah_agent_list` before each spawn. Resumes
   often start fresh: always give full instructions. `ptah_agent_spawn` rejects `taskKind`. Lanes run no checks.
6. `~/.ptah/settings.json` has `skillSynthesis.enabled=false` (keep it).
7. Worktrees `skills-lane-messaging`, `skills-rubric-sweep`, `question-routing-e2e`, `electron-first` stay
   until the user says to remove them.

## Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\`
  (`batches.md`, `decisions.md` U1-U8 + O1-O50, `implementation-plan.md`, `reports/`, reviews
  `code-logic-review-phase-{d,d-r2,e,f}.md`, `visual-review-phase-d.md`, `drafts/`).
- Skills: `.claude/skills/orchestration/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`.
- Visual review recipe: `visual-review-phase-c-r2.md` lines 1-15 (build-dev, copy-renderer-dev, Playwright
  `_electron.launch` of `dist/apps/ptah-electron/main.mjs`, port 9390, private HOME/USERPROFILE/APPDATA/
  LOCALAPPDATA/user-data-dir/PTAH_DB_PATH).

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge status --short`. Expect HEAD
   `2a715bfa3`, the uncommitted files listed above, and untracked `visual/` folders (never commit them, U4).
2. Coordinate the machine with peers (see "Machine queue"). When free, run ONE gate (filter the output):
   `NX_NO_CLOUD=true npx nx run-many -t test typecheck -p @ptah-extension/persistence-sqlite mcp-bench @ptah-extension/agent-generation @ptah-extension/chat-ui ptah-electron ptah-extension-vscode --parallel=1 > /tmp/gate-f.log 2>&1; sed 's/\x1b\[[0-9;]*m//g' /tmp/gate-f.log | grep -E "Running target|Test Suites:|error TS|FAIL  [a-z]|● .*›|Successfully|^- "`
   Accept a known load-flaky spec only after it passes alone:
   `npx jest -c tools/mcp-bench/jest.config.ts <spec> --coverage=false --maxWorkers=1`.
   Also run `scripts/export-skill-pipeline-archive.spec.ts` (standalone `npm run test:scripts`, not Nx; read
   `package.json` for the exact script and run only that spec).
3. Short re-review scoped to the Phase F fixes (S1, M1 and the O50 gate corrections) by a Claude
   `code-logic-reviewer` (read-only, no heavy commands) -> `code-logic-review-phase-f-r2.md`.
4. Commit in the foreground, one commit per batch (never amend; read `.commitlintrc.json`; subject <= 72;
   end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`): batch 67
   (`refactor(persistence-sqlite)` or with `mcp-bench`-related scope from the enum), batch 70
   (`agent-generation` scope if allowed, else check enum), batch 71 (staged deletions + `chat-ui`), then a
   `docs(task-specs)` commit with `batches.md` (mark 67, 70, 71 COMPLETE), `decisions.md`, reviews, reports,
   this HANDOFF.
5. Phase E+F Electron visual review (`visual-reviewer` subagent, recipe above): Advanced settings (no Skill
   upkeep group, Fine-tuning shows memory/scheduled jobs/workspace harness, dark + light), setup-plugins
   prompt suggestions (no "Extract UI feature"), Skills Library still works, main log without `[ERROR]`/DI/
   "No handler registered", renderer console clean. Output `visual-review-phase-ef.md`, PNGs in
   `visual/phase-ef/`. Notify peers before and after.
6. OP-1: make the snapshot + dry-run export (step in Open problems 1), then ONE AskUserQuestion with OP-1
   (confirm the receipt; recommended option first) and OP-2 (whether/how to prune). Do not register 0057
   before the user confirms OP-1.
7. After OP-1 is confirmed: batch 68 (0057 drop + ratchet pins 56->57; spec cases in `batches.md`), then
   batch 69 (runner vec-order spec + embedder comment). Gate:
   `NX_NO_CLOUD=true npx nx run-many -t test typecheck -p @ptah-extension/persistence-sqlite mcp-bench --parallel=1`.
   One Phase F code-logic review on 68-69.
8. Completion: degradation audit `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
   (must exit 0); push `refactor/skill-synthesis-purge` in the background with `gh pr create` (title < 70,
   `## Summary` + `## Test plan`, end with the Claude Code line); report the PR link; set TASK_2026_662 and
   TASK_2026_639 `status: done` (edit only the `status:` line of each `task.md`). OP-2 prune runs only
   after 0057 has run on the user's machine and only with the user's answer.

## Verification rules (memory-safe)

- Only changed projects: `npx nx run-many -t test typecheck -p <projects> --parallel=1`; confirm the header
  says "for N projects". O20: also gate every project whose specs fake or build a changed API.
- One spec: `npx jest -c <lib>/jest.config.(ts|cjs) <spec> --coverage=false --maxWorkers=2`.
- Never workspace-wide, build, serve, e2e or package unless asked (Electron build-dev for visual review is
  approved for this epic). One heavy check at a time across all sessions.
