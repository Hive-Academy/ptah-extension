# HANDOFF - TASK_2026_593_7c2e (attention-first notifications) + TASK_2026_702_594d (Chat start screen phase 3)

Written 2026-10-20 by orchestrator session `notification-fixes` (continued `notification-final`).
This one document covers both tasks. The TASK_2026_702 handoff
(`D:/projects/ptah-extension/.claude-worktrees/chat-needs-you-removal/.ptah/specs/TASK_2026_702_594d/HANDOFF.md`)
points here.

## Goals

- **593:** show only things that need the user (permission requests, ask-user questions, failures)
  in small snackbars, a bell with Needs you / Recent notices, and OS / VS Code host notifications;
  Clear all notices; no "Finished" notifications. Decisions #1-#47 in `decisions.md`.
- **702 phase 3:** remove the canvas needs-you chip (the bell covers it) and keep parity.

## PRs and branches (all pushed, none local-only)

| PR | Branch / worktree | Head | CI | State |
| --- | --- | --- | --- | --- |
| **#783** (593 A8 + phase C + CI fixes + empty bell panel) | `feat/attention-phase-c` / `.claude-worktrees/attention-notifications` | `eb6d62c14` | green | **MERGED** |
| **#790** (593 small follow-ups) | `feat/attention-followups` / `.claude-worktrees/attention-followups` | `868072d19` | retargeted to main by GitHub | **MERGED** (`c09f1e960` on main) |
| **#785** (702 phase 3 + lane Open parity) | `feat/chat-needs-you-removal` / `.claude-worktrees/chat-needs-you-removal` | `eabcd9172` (+ handoff doc) | was green at `35c9a8c59` | OPEN; conflicts with main after #783. **Peer session 662 (skills-epic) is resolving them at the user's request** (merge origin/main, 3 conflicts in chat-attention-action-dispatcher + app.config.ts, scoped checks, push). Check its result first; keep main's changes AND #785's `ATTENTION_LANE_OPENER` additions |
| **this branch** `docs/attention-visual-2` | `.claude-worktrees/attention-visual-2` (from `origin/main` `c09f1e960`, node_modules junction) | see `git log` | - | visual run 2 work; **NOT pushed at handoff** (waited for the peer check slot). Next session: push it and open a PR to main (step 0) |

Old worktrees still present (remove only when the user says): `.claude-worktrees/attention-pr780`,
`.claude-worktrees/chat-start-screen`. Remove a worktree with a node_modules junction with
`cmd //c rmdir <wt>\node_modules` first, then `git worktree remove <wt>`.

> The merged branches' worktrees (`attention-notifications`, `attention-followups`) stay until the
> user says to remove them. Their uncommitted visual-check script edits were copied here.

## Done this session

| Step | Result | Evidence |
| --- | --- | --- |
| #783 merged `origin/main` | brings in `a1f77f2d0` (session-create e2e fix) | merge commit before `eb6d62c14` |
| #783 CI fixes (codex lane A) | single `git-ui/services` import (review-shell spec:91); per-tab inline `role="alert"` for the stale older-history cursor restored (phase C regression, Electron e2e tile-load-older-history:383), computed from a stale snapshot, cross-workspace lookup | `lane-ci-fix-783.md`, commit `eb6d62c14` |
| Empty bell panel (codex lane C) | one "All clear / Nothing needs your attention." state with `Check`; "Clear all notices" (`Trash2`) moved to the header; behaviour unchanged. Width 320px kept: approved by `design-spec.md:162` | `lane-visual-fix-empty-panel.md`, `eb6d62c14` |
| Review (Anthropic) | APPROVED: a 8/10 after re-review, b 8/10, c 7/10 | `code-logic-review-ci-fix.md` |
| #783 CI | agent-sdk `subagent-budget-monitor.spec.ts` failed once with a runner concurrency timeout (not our code); re-run passed | `gh pr checks 783` |
| #785 session-create (codex lane B) | helper closes the named popover with Escape and asserts hidden | `lane-ci-fix-785.md`, commit `8a0ce5c60` |
| #785 lane Open parity (user decision: fix now) | `ATTENTION_LANE_OPENER` core token, canvas provider via light `@ptah-extension/canvas/focus` entry, Open focuses the session then opens the lane detail pane (`laneKey('cli', agentId)`), fallback = focused session + warn log | `lane-lane-open-parity.md`, `code-logic-review-lane-open.md` (APPROVED 8/10), commit `35c9a8c59` |
| #785 CI | `spot-editor-save.spec.ts` failed twice with different tests (typing into the spot editor timed out); re-runs passed: flaky | `gh pr checks 785` |
| #790 follow-ups (codex F1, F2) | R2 stale alert survives live events (pure computed on the first loaded message, no effect); M6 voice: stable key per workspace+direction, `presentationKey` per generation, per-key map so each notice's "Switch to local" works, other-workspace notice reports unavailable; M9 setup-wizard + harness-builder Open switches workspace via `WORKSPACE_COORDINATOR`; Apps focus target identity-safe unregister on destroy; X2 no change (replay messages are user-only) | `lane-followup-F1.md`, `lane-followup-F2.md`, `code-logic-review-followups.md` (APPROVED, M6 8/10 after re-review), commits `bfe3cb64a`, `868072d19` |
| #790 local checks | mcp-apps-page, setup-wizard, harness-builder typecheck+lint+test pass; chat typecheck+lint pass; chat-view + voice-provider-error specs 106/106; audit 291 | this session |
| Degradation audit | 291 in all three worktrees | `tools/degradation-audit/check-degradation.ts` |

## Electron visual check (593)

- Run 1 (previous session): `visual-review.md` REVISE 5/10. Defect 1 (empty panel) FIXED in
  `eb6d62c14`. Defect 2 (320px vs 340px) = approved deviation (`design-spec.md:162`).
- Run 2 attempt 1 (this session): `npx nx build ptah-electron --parallel=1` +
  `node apps/ptah-electron/scripts/copy-renderer.js` (build in `dist/` of the attention-notifications
  worktree is current for `eb6d62c14`), then `visual-check/shoot-populated.cjs`. 16 PNGs were
  written but the run is NOT usable: no workspace opened (Welcome screen), the light theme did not
  apply (light-*.png are dark), the theme menu stayed open over snackbars, `panel-clear-all` and
  `800` shots missing, cleanup crashed at `app.process()` after close (orchestrator removed the temp
  folder by hand; port 9347 free). Valid observations: badge count works; header "Clear all
  notices" works; Needs you rows use a full orange border (prototype: neutral border, orange
  icon); section header "Needs you 5" (prototype: uppercase "NEEDS YOU", count right); rows show
  "Unknown workspace" + disabled Open because the injection uses `attention:changed` with
  `target: null` (injection artifact, not a defect).
- **Script revised (lane `851f9012`, ended, `node --check` passes, NOT yet run):** the temp Git
  folder is passed as the first positional Electron argument (real-RPC e2e mechanism,
  `apps/ptah-electron-e2e/src/support/real-rpc-fixtures.ts:259-268`); private `PTAH_DB_PATH`,
  `APPDATA`, `LOCALAPPDATA`, `HOME`, `USERPROFILE`, userData, `PTAH_E2E=1`; theme switched through
  the UI picker and verified via `<html data-theme>` / `data-theme-mode` before each shot, menu
  closed with Escape; missing shots added; cleanup no longer calls `app.process()` after close and
  always writes `capture-results-2.json` and removes the temp folder; optional live
  `permission:request` shot. Details: `visual-check/shoot-populated-plan.md`. The attempt-1 PNGs
  were copied here for reference (PNG is git-ignored).

## Open problems and decisions

1. **Visual run 2 re-run** (next step 1). After it, decide the two style differences (row border,
   section header) with one codex lane + Anthropic review, or record them as approved deviations
   in `decisions.md`. Coverage gaps that stay: failed-turn notice (needs a matching session tab),
   git warning (no injectable producer).
2. **Later tasks (user-approved list, not started):** M7 ActionBanner API cleanup + dedupe; M8 Open
   routability computed at projection time; M4 git warning while the dock is closed (conflicts with
   project rule decision #43 / `git-dock-arming-identity.spec.ts:202`; needs a user design decision).
   Test hardening of `session-create.e2e.spec.ts` (asserts via `count()` guards) was NOT selected.
3. **Accepted minors:** M6 map entries remain after Clear all (bounded, exact generation only);
   M6 `switchError`/`switching` are global signals; #785 no unregister spec for the lane opener;
   #785 stale tab id gives session focus only (same as the old chip); TASK_2026_702 stale comment
   `electron-shell.component.ts:265-269`.
4. **#790 CI:** it merged right after the retarget; confirm `main` CI is green for `c09f1e960`
   (`gh run list --branch main --limit 3`). If a check fails there, fix on a new branch from main.

## Key files

- Task folder: `.ptah/specs/TASK_2026_593_7c2e/` (decisions.md, design-spec.md, prototype/screenshots/,
  visual-review.md, visual-check/, code-logic-review-*.md, lane-*.md).
- 702 task folder: `.claude-worktrees/chat-needs-you-removal/.ptah/specs/TASK_2026_702_594d/`.
- Bell panel: `libs/frontend/notification-center/src/lib/notification-center.component.ts`.
- Stale alert: `libs/frontend/chat/src/lib/components/templates/chat-view.component.{ts,html}`.
- Lane opener: `libs/frontend/core/src/lib/tokens/attention-lane-opener.token.ts`,
  `libs/frontend/canvas/src/lib/canvas-detail/canvas-attention-lane-opener.service.ts`,
  `libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.ts`.
- Voice: `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts`.
- Focus routers: `libs/frontend/setup-wizard/.../setup-wizard-focus-router.service.ts`,
  `libs/frontend/harness-builder/.../harness-builder-focus-router.service.ts`,
  `libs/frontend/mcp-apps-page/src/lib/services/apps-focus-target.ts`.

## Next steps

0. Push the two local-only branches (one pre-push gate each, after a "checks: free" slot) and open
   a PR to main for each: `docs/attention-visual-2` (this worktree) and `fix/handoff-no-lane-wait`
   (`.claude-worktrees/handoff-no-lane-wait`, commit `f73433376`: the "Wrap up & hand off" prompt in
   `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts` and the `session-handoff`
   skill, both copies + `content-manifest.json`, no longer tell the agent to wait for running lanes;
   lanes push their report and completion signal with their status; spec 19/19 passed).
   Check #785: did peer 662 push the conflict fix, and is CI green (`gh pr checks 785`)? If 662
   stopped, do the merge yourself in `.claude-worktrees/chat-needs-you-removal` (keep both sides,
   see the #785 row above), run its scoped checks (commands below), push in the background.
1. Read and verify the revised `visual-check/shoot-populated.cjs` in THIS worktree
   (`.claude-worktrees/attention-visual-2`). Ask peers for the slot (ListAgents + SendMessage),
   announce "Electron: <session> launching, port 9347, private APPDATA", then build main once and
   run the script from this worktree:
   `npx nx build ptah-electron --parallel=1`, `node apps/ptah-electron/scripts/copy-renderer.js`,
   `node .ptah/specs/TASK_2026_593_7c2e/visual-check/shoot-populated.cjs`.
   Check port 9347 is free and `%TEMP%/ptah-attention-populated-*` is gone; send
   "Electron: free" + "checks: free". If the script still fails, resume or respawn a codex
   visual-reviewer lane with the exact defects (it must not run Electron itself).
2. View each `visual-check/{dark,light}-*.png` next to `prototype/screenshots/` and SHOW them to the
   user; write `visual-review-2.md`; settle the row-border / header differences (step "Open
   problems" 1). Commit the script + review as `.md`-only where possible (CI ignores `**/*.md`).
3. Commit `visual-review-2.md` + script on `docs/attention-visual-2`, push, keep its PR updated;
   ask the user to merge it.
4. Propose the remaining later tasks (M7, M8, M4 decision) as a new task when the user asks.

Scoped verification commands (one heavy job at a time on the machine, coordinate first):

```bash
# 593 code is on main now; run these from a worktree on main (e.g. attention-visual-2)
npx nx run-many -t typecheck,lint,test -p @ptah-extension/notification-center --parallel=1
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts --coverage=false --maxWorkers=2
npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/review-shell-message-handlers.spec.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2
# 593 follow-ups (#790, on main)
npx nx run-many -t typecheck,lint,test -p @ptah-extension/mcp-apps-page @ptah-extension/setup-wizard @ptah-extension/harness-builder --parallel=1
npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts libs/frontend/chat/src/lib/services/voice-provider-error.service.spec.ts --coverage=false --maxWorkers=2
# #785 (chat-needs-you-removal worktree)
npx nx run-many -t typecheck,lint,test -p @ptah-extension/canvas @ptah-extension/core --parallel=1
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-attention-action-dispatcher.service.spec.ts --coverage=false --maxWorkers=2
# all worktrees
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay <= 291
gh pr checks 785; gh run list --branch main --limit 3
```

## Standing user rules

Orchestration + agent-lanes skills; "fix with our cli tools": codex CLI lanes implement
(`ptah_agent_list` before every spawn, never AT LIMIT, max 3, parallel lanes run no nx/jest);
Anthropic subagents do code-logic reviews; memory-safe scoped checks only (`--parallel=1`, Jest
`--maxWorkers=2`), one heavy job at a time on the machine (coordinate with ListAgents/SendMessage,
"checks: free" hand-offs; peers this session: 662 skills, 707 analytics, 708 voice-canvas); announce
Electron launches and send "Electron: free" after; never `text-base-content/NN`; audit must not
rise (291); commit foreground with hooks, push + `gh pr create` in the background; no
`--no-verify`; never edit `orchestra-canvas.component.ts` from 593; `BackOfficeActivityService`
public API stays; no notification-center edits from 702. The user accepts pushing without a full
local re-run and letting CI check (CI only runs for PRs into `main`). Do not spend tokens waiting
on lanes. No local-only branches at the end. Codex weekly 3% at handoff (resets 2026-10-27 15:43 UTC).

## Lane result at handoff

Lane `851f9012` (codex, visual-reviewer) ended normally (exit 0, verdict delivered): revised
`shoot-populated.cjs` (17 KB) and `shoot-populated-plan.md`; syntax check passed; it did not run
Electron. No lane or subagent is running at handoff.
