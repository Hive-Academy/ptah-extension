# Decisions — TASK_2026_860

| # | Decision | Evidence | By |
|---|----------|----------|----|
| 1 | Type FEATURE, depth Full | Four UI changes, two redesigned surfaces (sidebar, header) | orchestrator |
| 2 | Lanes enabled, approval mode lane-review | User CLAUDE.md lane preference; codex has room | orchestrator |
| 3 | One task for all four parts | Same frontend libs (chat, canvas, chat-ui), same review cycle | orchestrator |
| 5 | Dock cap = 5 chips | PM evidence: `DOCK_INLINE_MAX = 5` in dock-overflow.ts; user said "5 or 6" | PM lane (codex) |
| 6 | Header actions = Rename, Organize, Stop (Stop only when running) | Existing card-menu flows and RPCs; pop-out is VS Code only | PM lane (codex) |
| 7 | Gate 1 reviewer = kimi lane, not a Claude subagent | User CLAUDE.md: save Claude usage; kimi is a different family from codex (writer). Weaker-evidence label: lane-on-lane review | orchestrator |
| 8 | Gate 1 passed (lane-review): codex wrote, kimi reviewed REVISE (5 findings) then APPROVED r1 | gate1-review.md, gate1-review-r1.md | kimi lane |
| 9 | Gate 1.7 passed (lane-review): codex designed, kimi REVISE (3 Serious, 1 Minor) then APPROVED r1 | gate17-review.md, gate17-review-r1.md | kimi lane |
| 10 | Finished group collapsed by default only above 3 cards; stays visible as dots in the 56px rail | design-spec.md Decisions + Revision 1 | designer lane (codex) |
| 11 | Gate 2 passed (lane-review): codex plan, kimi REVISE (2 Blocking, 1 Serious) then APPROVED r1 | gate2-review.md, gate2-review-r1.md | kimi lane |
| 12 | Skip team-leader decomposition; use the plan's 4 file-disjoint batches directly | implementation-plan.md batch table already file-disjoint and reviewer-verified; saves a lane round | orchestrator |
| 13 | Executors: A=Glm, B/C/D=codex; phase code review by kimi (different family) | Glm and codex have confirmed room; kimi kept as independent reviewer | orchestrator |
| 14 | Integration verify: 6 projects pass (run 1: chat, chat-ui, webview, electron; run 2 after spec fixes: canvas 520/520, vscode typecheck+lint). Run-1 vscode failures had no error text; Nx marked them flaky | /tmp/v860.log, /tmp/v860b.log | orchestrator |
| 15 | Code review REVISE 5/10 (kimi): fix Blocking 1 + Serious 2-4 in one round; also fix Moderate 5 because it is in the same file and the same lane (board scroll), small and user-visible | code-logic-review.md | orchestrator |
| 16 | Code re-review APPROVED 9/10 (kimi): findings 1-5 resolved with tests | code-logic-review-r1.md | kimi lane |
| 17 | Batch B dropped 22 of 30 tests in canvas-lane-tabs.component.spec.ts; restore them before commit (tester lane) | git show main: spec, 30 → 8 tests | orchestrator |
| 18 | Do not commit task-tracking/landing-live-demo/HANDOFF.md (changed by a lane, not task scope); leave unstaged, report to user | git diff | orchestrator |
| 4 | Pulse item is a follow-up, not new work | Commit 160444fd6 covers the shared loaders; 8 local rotate keyframes remain | orchestrator |
