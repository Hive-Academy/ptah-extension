# HANDOFF - TASK_2026_702_594d Elevate the Chat start screen

Written 2026-10-20 by the orchestrator session `task-593-702` (it continued the 2026-10-19 handoff).
Sibling task: TASK_2026_593_7c2e (attention-first notifications), handoff at
`D:/projects/ptah-extension/.claude-worktrees/attention-notifications/.ptah/specs/TASK_2026_593_7c2e/HANDOFF.md`.

## Goal

Empty Chat board: one primary "New session" action, CSS-only Aurora hero, one "Get ready" card,
three recent sessions, and the whole canvas dock bar removed (ticker, needs-you chip,
"+ New Session"). The VS Code single-chat screen gets the checklist and a faint Aurora (#15).

## Where

- Worktree `D:/projects/ptah-extension/.claude-worktrees/chat-start-screen`, branch
  `feat/chat-start-screen` (node_modules junction). Task folder `.ptah/specs/TASK_2026_702_594d/`
  (decisions #1-#26).
- **PR #781 OPEN** (phases 1-2 + visual fix): https://github.com/Hive-Academy/ptah-extension/pull/781

## Done this session

| Step | Result | Evidence |
| --- | --- | --- |
| Visual-fix lint + spec | `canvas-rail-board.component.ts` eqeqeq; board spec "+ New session" label; checks green (ui 696, chat 4441, canvas 426, no-alpha 11/11, audit 294) | #23 |
| Commits | `b34813b0e` fix, `633432181` docs, `af9504659` re-check docs | git log |
| "Open Library" removal | **user approved** (Ready strip after setup; still shown before setup) | #24 |
| Electron re-check | `visual-recheck.md` APPROVED 8/10 (dark + light, 1440x900 + 800x700); screenshots local in `visual-recheck/` (PNG is git-ignored) and shown to the user | #25 |
| PR #781 | opened; merged origin/main (`81b42123f`): kept main's new resizable inspector dock + Stats tab, added our hero/notice/recent sessions; F1 test now checks `[data-inspector-dock]`; ticker export dropped | #26 |
| CI fix | `webview-e2e` session-create specs left the new-session popover open (hero opens it by design); helper closes it via its backdrop (`a1f77f2d0`) | #26 |

## Open / next steps

1. **Watch CI on PR #781.** The re-run after `a1f77f2d0` was pending at handoff.
   `git-real-git (windows-latest)` failed once on `node-gyp` during npm install (runner issue; the
   same job passed on #780) - re-run it if it fails again the same way. Fix real failures with
   one bounded codex lane + an independent Anthropic review; reply to CodeRabbit comments.
2. **Phase 3 is unblocked** (TASK_2026_593 PR #780 merged 2026-10-20): after #781 merges (or on
   top of it), update the branch from `main`, unmount the needs-you chip, delete
   `canvas-needs-you-queue*.ts` + spec, update `orchestra-canvas.rail.spec.ts`; Anthropic
   code-logic review, one codex fix round, scoped checks, commit, second PR.
3. Accepted minor items (later polish): neutral (not amber) eyebrow/badge, no row dividers, hard
   Aurora edge at the Sessions rail; relative dates can go stale until change detection;
   "2h ago" spec tolerates "Yesterday" near midnight; clock-skewed timestamps show an absolute
   date. Not captured: running cap (9 live sessions), VS Code single-chat 280px.
4. No local-only branch at the end.

## Standing user rules

Orchestration + agent-lanes skills; codex lanes implement (max 3, `ptah_agent_list` before every
spawn, never AT LIMIT, parallel lanes run no nx/jest); Anthropic subagents review; memory-safe
scoped checks only; one heavy job at a time on the machine (coordinate with peers); never
`text-base-content/NN`; audit must not rise; commit foreground with hooks, push background; no
`--no-verify`; do not edit notification-center code. The user accepts pushing without a full
local re-run and letting CI check. Codex weekly 63% at handoff.
