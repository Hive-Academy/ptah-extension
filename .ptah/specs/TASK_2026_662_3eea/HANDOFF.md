# HANDOFF - Skills epic (TASK_2026_639 + TASK_2026_662) + PR follow-ups - 2026-10-20 (session 9 end)

## Goal

1. Get PR #788 (`refactor/skill-synthesis-purge`, TASK_2026_662: purge the skill-synthesis pipeline, keep
   the Skills Library, migration 0057 archives then drops the pipeline data) green in CI and mergeable.
2. Side PRs the user asked about in this session: #785 (merged), #791 and #792 (green, need approval).
3. Out of scope: epic TASK_2026_640 and TASK_2026_701_9e4b. Do NOT start them.
4. User rules for this phase: **use CLI lanes (codex) for all work**; the orchestrator only plans, verifies,
   coordinates the machine with peers, and reports. Electron is the priority host (U8). Never grok/opencode;
   Glm is AT LIMIT. At most 3 lanes; `ptah_agent_list` before each spawn; full instructions every time.

## Done (session 9)

Worktree `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge`, branch
`refactor/skill-synthesis-purge`, PR https://github.com/Hive-Academy/ptah-extension/pull/788 (open).
Commits pushed (oldest first, on top of 4da7713ec):

| Commit | Subject |
| --- | --- |
| 902e37d2f | refactor(persistence-sqlite): batch 68 - register 0057 drop (+ Jest home guard `jest.setup-home.cjs`) |
| 1414253ba | test(persistence-sqlite): batch 69 - vec order spec and embedder comment |
| 70cf30416 | fix(agent-generation): mark the ENOENT return in skill retirement (degradation audit) |
| e6bdec698 | docs(task-specs): TASK_2026_662 batches 68-69 complete |
| a62b814bb | docs(task-specs): set TASK_2026_662 and TASK_2026_639 to done |
| ec223e574 | Merge origin/main (5 conflicts: 3 rpc-surface specs, advanced-settings spec = 25 keys, 639 task.md) |
| 474797b8d | fix(skill-synthesis): inject the invocation event store explicitly (CI di-lint) |
| cad8d9413 | fix(skill-synthesis): use the BATCHES_FILE contract constant (CI contract guard) |

Evidence: persistence-sqlite + mcp-bench gate green (mcp-bench `native-baselines` load-flaky, 11/11 alone);
post-merge typecheck + test green for 13 projects (shared, platform-core, vscode-core, rpc-handlers,
agent-generation, cli-engine, chat, chat-ui, core, ptah-electron, ptah-extension-vscode,
ptah-extension-webview, ptah-cli); degradation audit exit 0; reviews `code-logic-review-phase-f-68-69.md`
(8/10) and `...-fixes.md` (8/10). Real `~/.ptah/backups/skill-pipeline` emptied (16 empty test archives
deleted, user-approved). HTML report (untracked): `reports/gate-runs-2026-10-20.html`.

Other PRs:
- #785 (`feat/chat-needs-you-removal`): merge conflicts fixed (9f220a380), MERGED by the user.
- #791 (`fix/ptah-cli-repeat-guard`, worktree `.claude-worktrees/ptah-cli-repeat-guard`): CodeRabbit finding
  fixed in 4b4fe6188 (pending tool input keyed by parent_tool_use_id + block index), pushed, reply
  comment 4329016317 posted. CI 17 pass / 3 skipped. State: MERGEABLE, BLOCKED = REVIEW_REQUIRED (user approval).
- #792 (`docs/attention-visual-2`, docs only): flaky e2e rerun passed. BLOCKED = needs user approval.
- Main checkout `D:\projects\ptah-extension` pulled to c09f1e960 (13 local `.opencode/agent/*.md` edits kept).

## In progress at handoff (UNCOMMITTED in the 788 worktree, lanes finished, NOT verified)

PR #788 CI on cad8d9413 failed: `test (shard 4/4)`, `electron-e2e (shard 4/4)`, `webview-e2e`
(main and other PR branches pass the same workflows today). Two codex lanes wrote fixes (no checks run):

Lane A (unit) - report `reports/ci-788-unit-fix-report.md`:
- `libs/frontend/core/src/lib/services/back-office-activity.service.ts` (+62 lines: "aligned core notice
  projection with main") and its `.spec.ts` (removed the synthesis-failure projection assertion). REVIEW
  the service change carefully: confirm the merge really dropped main's notice projection (compare with
  `git show origin/main:libs/frontend/core/src/lib/services/back-office-activity.service.ts`) and that the
  lane did not re-add synthesis code.
- `cli-workspace-watcher.spec.ts` (platform-cli) left unchanged: no branch diff, real-filesystem timeout.

Lane B (e2e) - report `reports/ci-788-e2e-fix-report.md`:
- `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts`: switches use click (committed-state toggles),
  picker waits for the loaded Enhancement row.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts`: fixture supplies the
  retained enhancement settings (reachability "Used by 2").
- `.../settings/settings-visual.e2e.spec.ts`: expects the approved 3 consumer roles (Memory curator,
  Enhancement, Decision) instead of 7; checks the Enhancement popover.
- session-create failures left unchanged (popover backdrop flake, no branch diff; blank-name passed on retry).

Untracked, never commit: `visual/` folders (U4). `reports/gate-runs-2026-10-20.html` is optional.

## Open problems and decisions

1. `decisions.md` has rows up to O54. Add O55: main merge + CI fixes (di-lint, contract guard, the two lane
   fixes above, watcher and session-create judged not branch-caused) with evidence.
2. The pre-push `di-lint` passed from the Nx cache although a source file broke it (its target inputs do not
   include lib sources). Recorded as a gap; not fixed (outside the task).
3. `claude-approval.reader.spec.ts` (cli-agent-runtime, real-git tests) fails on clean main too: pre-existing.
4. Named follow-ups from earlier sessions still open (see `decisions.md` O50-O54 and old HANDOFF list): Phase C
   M3/M5/m1-m6, light-theme tile contrast, Skills tile staleness, stale "synth" legend at
   `skill-clones-view.component.ts:210`, the two Moderate test-depth items from O53.
5. Worktrees stay until the user says: skill-synthesis-purge, ptah-cli-repeat-guard, chat-needs-you-removal
   (785 merged; remove only on user request), attention-visual-2 and the older ones listed in O-rows.
6. Machine queue with peers (one heavy job at a time across sessions): run `ListAgents`, message every peer
   before any heavy check or push, wait for "checks: free", and send "checks: free" after. Peers seen:
   analytics 707, voice 708, notification-fixes (new session ...ljw2qmbecj405).

## Key files

- Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\`
  (`decisions.md`, `batches.md`, `reports/ci-788-unit-fix-report.md`, `reports/ci-788-e2e-fix-report.md`).
- Skills: `.claude/skills/orchestration/SKILL.md`, `.claude/skills/agent-lanes/SKILL.md`.
- Saved CI logs (cad8d9413 run): `C:\Users\abdal\AppData\Local\Temp\j118820269545.log` (test shard 4),
  `j118820266111.log` (electron-e2e shard 4), `j118820267522.log` (webview-e2e). Read only with filters.

## Next steps (in order)

1. `git -C D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge status --short` - expect HEAD
   cad8d9413 (in sync with origin) and the 5 modified files + 2 untracked reports above.
2. Read both lane reports. Review the 5-file diff yourself (`git diff --stat`, then targeted hunks),
   especially `back-office-activity.service.ts` against origin/main. Strip BOMs:
   `for f in $(git status --porcelain | awk '{print $2}'); do [ -f "$f" ] && [ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' ')" = "efbbbf" ] && sed -i '1s/^\xEF\xBB\xBF//' "$f"; done`
3. Coordinate the machine with peers, then spawn ONE codex lane (ptah_agent_list first) to run, from the
   worktree, one at a time, output filtered:
   - `NX_NO_CLOUD=true npx nx run-many -t typecheck lint test -p @ptah-extension/core --parallel=1`
   - `NX_NO_CLOUD=true npx nx run-many -t typecheck lint -p ptah-electron-e2e @ptah-extension/webview-e2e-harness --parallel=1`
     (confirm the exact Nx project names in each `project.json` first; no e2e targets locally)
   - Never pass `-- --maxWorkers` through nx run-many (it reaches tsc: TS5023).
4. If green: commit in the foreground with explicit pathspecs (`git commit -F - -- <paths>`; read
   `.commitlintrc.json`; subject <= 72; body wrapped at 72; end with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), e.g.
   `fix(core,e2e): align activity notices and settings e2e with the purge`. Add the two reports and an O55
   row in `decisions.md` in a `docs(task-specs)` commit.
5. Push via the lane (background, network retry up to 3), then watch CI on the new head:
   `gh run list --repo Hive-Academy/ptah-extension --branch refactor/skill-synthesis-purge --limit 6`
   and `gh pr checks 788`. If e2e still fails, fetch the job log (`gh api repos/Hive-Academy/ptah-extension/actions/jobs/<id>/logs`)
   and send a new lane with the filtered failure lines. A flaky-only failure: `gh run rerun <run> --failed`.
6. When #788 is green, report: #788, #791, #792 need the user's approval to merge. Send "checks: free" to
   the next peer.

## Verification rules (memory-safe)

- Only changed projects, `--parallel=1`, Jest `--maxWorkers=2`, output filtered; never workspace-wide,
  build, serve, e2e or package locally. One heavy check at a time across all sessions.
