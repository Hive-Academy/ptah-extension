# HANDOFF — TASK_2026_674_fa33 (+675, +676, 681 leftovers) and TASK_2026_683_3c29 (motion)

Written 2026-10-16 at the user's request (session token limit). Read this first, then `plan.md` and
`context.md` (section "Scope extension") in this folder. Two tasks, two worktrees.

## 1. TASK_2026_674_fa33 — transcript resync bugs + clean session view leftovers

### Goal
One PR that fixes the resync transcript bugs TASK_2026_674 (nested subagent live tail), TASK_2026_675 (non-last
Task owner moves to the bottom) and TASK_2026_676 (stale `latestTodoWrite`), plus the TASK_2026_681 leftovers
L1-L7 (user: "add the leftovers and remaining findings to one of those transcript live state bugs").
TASK_2026_679 is NOT in scope (the user runs it in another session).

### Where
- Worktree `D:\projects\ptah-extension\.claude-worktrees\chat-transcript-followups`, branch
  `fix/chat-transcript-followups` from `main` @ 6c0490f1f. **Local only: not pushed, no PR.**
- `node_modules` is a junction to the main checkout's `node_modules`. Remove a junction with `cmd /c rmdir`
  (never `Remove-Item`, never `git worktree remove` before the junction is gone).

### Done
- Commit `b40330387 docs(task-specs): file TASK_2026_683 navigation and session motion` (task.md + context.md
  of TASK_2026_683; user asked to file it in this PR).
- UNCOMMITTED (25 modified files + untracked reports), all verified:

| Item | Change | Files |
| --- | --- | --- |
| 674 | Resync repair walks parentToolUseId to the materialized root; several owners; frozen boundaries keep non-contiguous owners ordered; warn per unresolved seed | `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts` (+ `.spec.ts`, `session-loader.resync-live-seed.spec.ts`) |
| 675 | Resync records the owner's frozen placement on the live state (`resyncOwnerPredecessors`, optional readonly in `StreamingState`); finalization uses it only when present (no-anchor and anchor branch). Normal turns unchanged (no time-based insert) | `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts` (+ spec), `libs/frontend/chat-types/src/lib/chat-types.ts` |
| 676 | `latestTodoWrite` recomputed from the filtered events | replayer |
| L1 | Light-theme lane usage row: all labels `text-base-content-muted` (≥ 5.01:1 both themes) | `chat/.../molecules/agent-card/cli-lane-usage-summary.component.ts` (+ spec) |
| L2 | Compact card in Canvas hides only the title, Full view and a duplicate pill (`@if`); status row + needs-you count stay. Host signal `RAIL_TRANSCRIPT_RETENTION` (commented) | `chat/.../molecules/compact-session/compact-session-card.component.ts` (+ spec) |
| L3a | 760 px pane-strip details opener → lucide `PanelRight` icon button | `canvas/.../canvas-rail/canvas-rail-board.component.ts` (+ spec) |
| L3b | Dock hover card closes on pointer-away and on a tab A→B sweep | `canvas/.../canvas-detail/canvas-lane-tabs.component.ts` (+ spec) |
| L4 | CLOSED, no change: Electron `minWidth: 800` (`apps/ptah-electron/src/windows/main-window.ts:119`) | — |
| L5 | Partial badge aria-label uses the formatted number; spec for null totals + no segments | `chat/.../organisms/session-inspector/inspector-agents-section.component.ts` (+ spec) |
| L6 | e2e showcase selectors migrated; cleanup iterates every rail card, closes via `Close session` | `apps/ptah-electron-e2e/src/showcase/{canvas-orchestra,chat-code-edit,lane-console-review}.scene.ts`, `docs-screenshots/sessions.shot.ts` |
| L7 | Bundle analysis (`reports/batch-R-bundle.md`): +197.55 kB since c57a9a1e7 (3.49 MB). USER approved fix in this PR: wide Rail inspector `@defer (on idle)` → 3,688,519 B → 3,622,864 B (−65.7 kB) | `canvas-rail-board.component.ts:245` (+ spec "…once its deferred block completes") |
| status | 674/675/676 `in_progress`, 677 `done` (edited in this worktree only) | `.ptah/specs/TASK_2026_67{4,5,6,7}*/task.md` |

- Reviews (Claude, implementer codex): `code-logic-review-T.md` NEEDS_FIXES → `-T-r2.md` APPROVED 8/10;
  `code-logic-review-UE.md` NEEDS_FIXES → `-UE-r2.md` APPROVED 8/10. The `@defer` change and the one-line type fix
  in the replayer (`seed && … ? filter : []`, line ~337) were made by the orchestrator (trivial edits, not reviewed).
- Checks (from the worktree, last run after all code except the `@defer` edit):
  `run-many -t typecheck,lint -p chat chat-streaming chat-types canvas ptah-electron-e2e` PASS (5 projects);
  `run-many -t test -p chat chat-streaming chat-types canvas --maxWorkers=2` PASS (chat-types has no test target).
  After the `@defer` edit: canvas typecheck/lint PASS, `canvas-rail-board.component.spec.ts` 91/91.
- Electron dev dist in this worktree is CURRENT (renderer rebuilt after the `@defer` edit, exit 0).
- Temporary worktree `.claude-worktrees/bundle-baseline` removed (user approved).

### Open / recorded follow-ups (PR body)
- Switch L2's host signal to `SESSION_EMBED_CHROME` after PR #736 merges (it adds the embed `chrome` wiring).
- Remaining eager growth ~132 kB vs 3.49 MB (chat-ui inspector stats, canvas dock, styles); next candidate: dock
  overflow menu (≤ 9.2 kB).
- Minor review notes: e2e cleanup passes silently with the rail collapsed; no visibility guard in
  lane-console-review; 8 pre-existing `console.*` calls in the replayer; two-owner merge with a non-owner
  assistant row in between; `currentMessageId` guard.
- Light-theme dock border 1.32:1 (decorative, not taken).

## 2. TASK_2026_683_3c29 — smooth native navigation and session-switch motion

- Worktree `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion`, branch `feat/nav-session-motion`
  (= main 6c0490f1f, no commits, task folder untracked). task.md + context.md are ALSO committed in the 674 branch
  (`b40330387`).
- `implementation-plan.md` (Claude architect) → codex review `implementation-plan-review.md` REVISE (8 findings)
  → revised (round 1 of 2): 7 accepted, finding 3 settled by user Q2; batches now B0-B6 (B0 measurement,
  B1 router `withViewTransitions`, B2 styles + Electron naming, B3 URL-correction defer, B4 transcript cascade,
  B5 chat view + old-stagger removal, B6 canvas — B6 rebases after the 674 PR).
- User decisions (U1-U4): cascade (max 6, ~0.3 s, header/composer still); render long tasks reported, fixed later
  under TASK_2026_629 row 74; VS Code layout toggle stays instant; before/after measurement allowed (one renderer
  build + one Electron perf spec, announced).
- Open: B0's VS Code webview scenario is a second e2e beyond the approved Electron spec → ask the user, or check
  VS Code by hand.

## Exact next steps

1. 674 scoped checks once more (one heavy run at a time, from the 674 worktree; header must say 5 / 3 projects):
   ```
   npx nx run-many -t typecheck,lint -p chat chat-streaming chat-types canvas ptah-electron-e2e --parallel=1
   npx nx run-many -t test -p chat chat-streaming canvas --parallel=1 --maxWorkers=2
   ```
   (never pass `--maxWorkers` to typecheck).
2. 674 Electron screenshots (dist is current): announce "Electron: 674 launching, port 9351" to the other
   sessions (ListAgents → SendMessage; peers 646, 678, 649) and wait for any running one's "Electron: free".
   Reuse the launcher/harness in `.ptah/tmp/` of `.claude-worktrees/clean-session-followups` (`a1117-launcher.mjs`,
   `final-*.mjs`, `dock-*.mjs`; private profile copy `.ptah/tmp/a1117-appdata/Ptah Dev`) via a `visual-reviewer`
   subagent: dark + light, 1440/760: L1 usage row contrast, L2 compact card in Canvas (0 and 1 lane), L3a opener at
   760, L3b hover card sweep, wide Rail aside fills after idle. Report `visual-review.md` here. Send "Electron: free".
3. Commit 674 in the foreground (scopes from `.commitlintrc.json`; subject ≤ 72; body ≤ 100; end with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), e.g.
   `fix(chat,chat-streaming,chat-types): keep resync owners live and in place`,
   `fix(chat): compact card, usage contrast, inspector badge label`,
   `fix(canvas): pane opener icon, hover card close, lazy rail inspector`, `test(e2e): migrate showcase selectors`,
   `docs(task-specs): TASK_2026_674 plan, reviews, bundle report, handoff`. Check `e2e` / `chat-types` /
   `chat-streaming` are in the scope enum first.
4. Push + PR as ONE background command:
   `git push -u origin fix/chat-transcript-followups && gh pr create --base main --title "fix(chat): resync transcript owners and clean session view leftovers" --body-file <file>`;
   body: Summary (674/675/676, L1-L7, L4 closed, bundle −65.7 kB), follow-ups above, Test plan; ends with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Report the link; set task.md statuses.
5. 683: re-review the revised plan with the same codex lane (resume `01a14607-3109-76b0-8596-7c4b47dd1b66`, or a
   fresh lane with the review file) → `implementation-plan-review-r2.md`; then show the plan to the user for
   approval (incl. the VS Code e2e question). After approval: copy `implementation-plan.md` (+ reviews) into the
   674 branch task folder if that PR is still open (user wants the task filed there), then implement B0-B6 on
   codex lanes in the nav-session-motion worktree (measure before with B0, after at the end).

## Rules to keep
CLAUDE.md memory-safe verification; builds/Electron only when the user approved and announced; lanes never
commit; commit in the foreground; push + PR in one background command; no local-only branch at the end; never
both `class=""` and `[class]=""` on one element; OnPush + signals + input()/output().
