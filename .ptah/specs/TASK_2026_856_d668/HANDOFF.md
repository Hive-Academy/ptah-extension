# HANDOFF — TASK_2026_856_d668 (session 4 start)

## Goal
Every frontend session calculation (context %, tokens, cost, cache, turn count) and every
client-side date and timer must be calculated correctly and persisted: host or root store is the
source of truth, one shared clock (`injectWallClock` / `WallClockService` in @ptah-extension/core),
nothing held only in an Angular component lifecycle that resets on navigation, tab switch or
panel toggle.

User decisions (decisions.md #5–#7, do not ask again): all five Proposed Removals APPROVED (all
now done); no new persistent metrics store, host `SessionStatsEntry` is the single source of truth,
host lifetime `turnCount`; context % correctness end to end.

Flow: REFACTORING, Full depth, CLI lanes enabled (codex), approval mode lane-review. Only the
orchestrator commits (never team-leader or lanes).

## Done
Worktree `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics`, branch
`fix/persistent-session-metrics` from 9e797082e. 39 commits, HEAD d72972c47. NOT pushed, no PR.

- Phase 1 COMPLETE, review closed (decisions #18).
- Phase 2 COMPLETE: all 36/36 batches committed, every batch gate passed, host typecheck H 5/5
  after B15, B20/B21 and the fix round. batches.md: every batch/task header is COMPLETE.
  Session 3 commits: 8008ab4cf B18 (+ test-harness correction, #25), cf3a16837 B15, 602dc1f06 B14,
  61dc1ad34 B20, 85ac9c9ae B21 (orchestrator, #26), dffd9c3d7 B17, d72972c47 review fix M1–M3.
- Phase 2 code-logic review (claude reviewing codex): code-logic-review-phase2.md APPROVED,
  0 Blocking/Serious. M1–M3 fixed (d72972c47), re-review code-logic-rereview-phase2.md APPROVED.
  M4 no change (host owns timeout, #28). M5, M6 and Minors recorded as later work (#29).
- Plan grep gates PASS (#30). NUL count in session-loader.service.ts = 1.

## In progress (started in session 3, results not yet read)
1. Final affected gate `npm run verify`: session 3's run was STOPPED at the 1 h background limit
   with no result (lock is free, no orphan). RE-RUN it with timeout 7200000 (the maximum):
   `npm run verify 2>&1 | grep -E 'NX|full log|lock released|Running target' | tail -n 10`
   (Bash run_in_background, timeout 7200000). First check `node scripts/verify.mjs --status`
   for an orphan slot.
2. DONE at session 3 end: visual-review.md APPROVED (MEDIUM confidence), no regression on the
   reachable screens (rail cards, inspector incl. `Context —`, turn activity, subagent lane,
   tab switch, 1000px; dark + light, before + after). NOT reachable (no LLM provider in the
   sandbox): live clocks / running inline duration (B14), CX4/HB1 reload persistence, B11,
   B16 drawer during regeneration, B18 background-workspace root tab. List these in the PR
   test plan as not visually verified. Do NOT re-run unless the user asks. Original brief:
   Combined visual review (visual-reviewer subagent, Electron only, dark + light). Deliverable
   `.ptah/specs/TASK_2026_856_d668/visual-review.md`, screenshots in `.../visual-review/`.
   Before = detached worktree `D:\projects\ptah-extension\.claude-worktrees\psm-visual-base`
   at 9e797082e (node_modules junction; remove with `cmd //c rmdir node_modules` before any
   `git worktree remove`; keep it until the user authorizes cleanup).
   If visual-review.md is missing or has no verdict, re-run the visual review (same brief:
   screens CX4, HB1, B7, B8b, B11, B12, B13a, B13b, B14, B16, B18; builds one at a time under
   `node scripts/verify.mjs --exec --task visual-build -- npx nx build-dev ptah-electron --parallel=1`
   then `copy-renderer-dev`; own CDP port + temp user-data-dir + private APPDATA; kill only own PIDs).
   Check for leftover Electron processes it launched.

## Open problems and decisions
- Disputed Phase 1 findings (no change, explain in PR): logic S1 (carry after compact boundary =
  plan F12 + D21), logic M2 (normalizeModelKey needed; transcript ids lack `[1m]`). decisions #17.
- Later work to list in the PR: Phase 2 M5 (`childStats` lookup cost), M6 (beyond-plan `—`
  placeholders), Phase 1/2 Minors; result with no SDK token usage not counted live.
- Untracked task folder `.ptah/specs/TASK_2026_856_d668/` — decide at PR time whether to commit
  it (earlier commits did not include it).
- Lane lessons: codex lanes drift into UI placeholder changes — diff every lane result against
  the plan; lanes miss shared test harnesses outside their file list (B18 #25).

## Key files
- `...\TASK_2026_856_d668\decisions.md` — decision log #1–#31
- `...\TASK_2026_856_d668\code-logic-review-phase2.md`, `code-logic-rereview-phase2.md`
- `...\TASK_2026_856_d668\implementation-plan.md` — rev 3, "Team-leader handoff" (:1132)
- `libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts` — ONE literal NUL
  byte; `grep -c -aP '\x00'` must stay 1

## Next steps
1. Read visual-review.md. A REVISE for a regression this branch caused → one fix lane, batch gate,
   H, commit, short re-check. Then re-run the final affected `npm run verify` (see above).
2. Decide on committing the task folder. Check NUL count = 1. `git status` clean.
3. Push + `gh pr create` against main in ONE background command (title <70 chars, `## Summary`,
   `## Test plan` with real results, disputed findings and later work listed, footer
   "🤖 Generated with [Claude Code](https://claude.com/claude-code)"). Watch CI and reviews
   with gh; fix confirmed findings with new commits. Report PR URL, head, CI and review state.
