# TASK_2026_681_738f — handoff (session 1 → session 2)

Written 2026-10-16 at the user's request (session token limit). Read this first, then `decisions.md`
(rows 1-26 are the full audit trail) and `plan.md`.

## Goal

Follow-ups to TASK_2026_677_efcd (clean session view, PR #734, merged to `main` 2026-10-16):
- Items 1-10: review leftovers from 677 (see `context.md` table).
- Items 11-19: UI tweaks the user added in this session (decisions rows 15, 16, 22, 25):
  11 remove the model chip from the canvas focus header; 12 header Compact / More / Close as lucide icon buttons with
  tooltips; 13 inspector Model row padding + bold value; 14 remove "Back to conversation"; 15 inspector AGENTS rows:
  no raw "Usage:" text, small stat badges; 16 user-chosen compact view shows the condensed card again (user: "code
  still there → show it and tweak"); 17 flat subagent / CLI-lane thread (user chose "Flatten the lane card");
  18 bottom shadow under the agent dock; 19 left padding on the assistant response on wide panes.

Workflow: orchestration skill, BUGFIX, Partial depth. Implementer: codex lanes. Reviewer: Claude
`code-logic-reviewer` subagents (different family). Visual evidence: `visual-reviewer` subagents.

## Where

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-followups`
- Branch: `fix/clean-session-followups` (from `main` @ 851846797). **Local only: not pushed, no PR yet.**
- `node_modules` in the worktree is a junction to `D:\projects\ptah-extension\node_modules` (needed for nx/jest).
- Task folder: `.ptah/specs/TASK_2026_681_738f/` (tracked; `*.png` are git-ignored, screenshots stay local).

## Done

Commits on the branch (all items 1-10, verified: typecheck/lint/test PASS, code review + re-review APPROVED,
visual review PASS):

| Commit | Content |
| --- | --- |
| df5838832 | fix(chat): items 1, 2 (specs only), 3, 5, 9, 10 |
| bbc0c7ae2 | fix(chat-ui): item 4 null-session tile expansion |
| 75ce4a6d1 | fix(canvas): items 6, 7, 8 |
| 8c06dfae7 | docs(task-specs): plan, reviews, bundle, visual review for 1-10 |

Item 9 bundle: one production build → initial 3.68 MB (baseline 3.62 MB from 677 row 107); the `@defer` moved the
activity panel into a 5.3 kB lazy chunk only. Budget stays 3.7 MB (user rule: lower only if it drops). ~20 kB headroom.

## In progress (UNCOMMITTED in the worktree)

Items 11-19 code + specs + reports (see `git status`). State:
- Items 11-17: implemented (lanes C, D, E), code review `code-logic-review-11-17.md` NEEDS_FIXES → fix round →
  re-review `code-logic-review-11-17-fixes.md` **APPROVED**.
- Visual review of 11-17 (`visual-review-11-17.md`) FAIL 6/10 → visual fix round (lanes C2 canvas, D2 chat; item 18
  added) → checks PASS (chat + canvas typecheck/lint/test, `.ptah/tmp/681-checks6.log` in the main checkout) →
  re-review `code-logic-review-visual-fixes.md` **NEEDS_FIXES** (open, see below).
- Item 19 (`message-bubble.component.css`): implemented (lane F); message-bubble spec 18/18; **nx checks not yet run**.

## Open problems (fix next)

From `code-logic-review-visual-fixes.md` (one fix round, then a short re-review scoped to the fixes):
1. **S1 (Serious)** `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:71-79`
   `usageTotalsFromSegments` shows partial totals for restored lanes as if known (contract Req 8.4,
   `agent-monitor.store.ts:1729-1731`, spec `agent-monitor.store.spec.ts:1608-1612`). Used in
   `cli-lane-usage-summary.component.ts:67-70` and `inspector-agents-section.component.ts:328`.
   Recommended: option (a) show the fallback with a visible partial marker (e.g. "≥ 11.9k", title "From retained
   output, may be partial") and keep the cost marked as estimate; add a restored-then-live spec. Option (b) would
   supersede Req 8.4 — that is a product decision for the user.
2. **M1** `inspector-agents-section.component.ts:348`: use `formatElapsed` (`agent-card.utils.ts:13-26`, the lane
   view's formatter) for the CLI duration badge (and align the aria label), so both read the same.
3. **M2** `stats-bar.utils.ts:78`: fallback drops `contextTokens` / cache fields; either carry them or document
   "only totals that are safe to show" in the JSDoc.
4. **M3** `canvas-lane-tabs.component.ts:86`: `z-10` makes the dock a stacking context for the hover card / dock menu.
   Keep it below 20 (the header overflow menu is z-20). Add a check (spec or visual) that the dock menu and hover
   card still paint over lane content.
5. **M4** same line: `shadow-[0_6px_8px_-6px_oklch(var(--bc)/0.35)]` is a light haze in dark themes. Use the
   existing elevation token (`--elev-shadow`, see `chat-input.component.ts:820`) or a neutral black alpha.

Recorded, not fixed (follow-ups for the PR body / later tasks):
- Compact card repeats title/status shown by the Canvas header (visual M3, decisions row 23).
- Canvas board inspector aside stays visible in compact: intended (own Details toggle; per-tab manual toggle wins).
- In compact, the composer and session banners are hidden (mounted, draft kept) — follows the user's item 16 choice.
- Pre-existing: horizontal page overflow at 400 px (all before shots); lane hover card stays open at 760.
- e2e showcase scenes also need `.tile-header` / `Close tile` (showcase migration, out of scope).
- Bundle: ~130 kB eager growth vs 3.49 MB still unexplained → propose a source-map analysis task.
- Minor review notes in each review file.

## Exact next steps

1. Fix round for the 5 open findings above on codex lanes (`ptah_agent_list` first; codex had confirmed room).
   Canvas (M3, M4) and chat (S1, M1, M2) are file-disjoint → two lanes. Brief: STRICT memory rules, no nx targets
   inside lanes, only Jest on their spec files with `--maxWorkers=1`, no git, ≤ 25 tool calls, deliverable
   `reports/batch-*-fix.md`.
2. Scoped checks (one heavy run at a time, from the worktree):
   ```
   npx nx run-many -t typecheck,lint -p chat chat-ui canvas --parallel=1
   npx nx run-many -t test -p chat chat-ui canvas --parallel=1 --maxWorkers=2
   ```
   (Do not pass `--maxWorkers` to typecheck: tsc rejects it.) Confirm the header says "for 3 projects".
3. Short Claude re-review of the fix hunks → `code-logic-review-visual-fixes-r2.md`.
4. Electron run for the final "after" shots (items 11-19). **Coordination rule agreed with sessions 649, 678, 646,
   679** (they share `C:\Users\abdal\.ptah`): send "Electron: 681 launching, port <n>" to the other sessions before
   launch and "Electron: free" after close (ListAgents → SendMessage; 649's address was
   `uds:\\.\pipe\LOCAL\cc-msg-1f8e75f29ff4c0ff9825550f00538d91`). Tell the user before the build. Build:
   `npx nx run ptah-electron:build-dev --parallel=1 --skip-nx-cache` then
   `npx nx run ptah-electron:copy-renderer-dev --parallel=1 --skip-nx-cache`. Port 9333 may be taken: the last run
   used 9351 and a copy of the Ptah Dev profile. Capture scripts: worktree `.ptah/tmp/`. Compare with
   `screenshots/before-11-17/` and `screenshots/after-11-17/`; dark + light, 1440 / 760 / 400; include the dock
   shadow (dark!), lane gutter, assistant left padding at 1440 (item 19) and narrow panes unchanged.
   Do not touch the 649 test files in `C:\Users\abdal\.ptah` (harnesses\tiny-ts-web.json, plugin
   ptah-harness-ts-web-conventions) or the untracked `.claude\skills\ts-web-conventions` in the main checkout.
5. Commit in the foreground (scopes from `.commitlintrc.json`: chat, chat-ui, canvas, task-specs; subject ≤ 72,
   body lines ≤ 100), e.g. `fix(canvas): icon header, flat lane view, dock shadow`,
   `fix(chat,chat-ui): compact card, flat agent card, inspector stats`, `fix(chat): align assistant turn on wide panes`,
   `docs(task-specs): TASK_2026_681 items 11-19 reviews and visual evidence`. End each with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
6. Push and open the PR as ONE background command (pre-push runs di-lint + Electron validate-deps):
   `git push -u origin fix/clean-session-followups && gh pr create --base main --title "fix: clean session view follow-ups (TASK_2026_681)" --body-file <file>`.
   Body: ## Summary (items 1-19), the not-fixed list above, bundle numbers, ## Test plan; ends with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Report the PR link.
7. Set `task.md` `status:` (edit only that line) when the PR is open; keep the worktree until the user says to remove it.

## Key files

- Canvas: `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`,
  `canvas-rail/canvas-focus-area.component.ts`, `canvas-rail/canvas-rail-board.component.ts`,
  `canvas-detail/canvas-lane-view.component.ts`, `canvas-detail/canvas-lane-tabs.component.ts`
- Chat: `components/templates/chat-view.component.{ts,html}`, `molecules/compact-session/compact-session-card.component.ts`,
  `molecules/agent-card/{agent-card,agent-card-header,cli-agent-output,cli-lane-usage-summary}.component.ts`,
  `molecules/agent-card/stats-bar.utils.ts`, `organisms/session-inspector/inspector-agents-section.component.ts`,
  `services/session-agents/session-agent-roster.ts`, `organisms/message-bubble.component.{html,css}`
- Chat-ui: `molecules/session/inspector-stats/inspector-session-stats.component.ts`,
  `molecules/session/plan-limits/stats-tile-expansion.state.ts`
- Task docs: `decisions.md`, `plan.md`, `context.md`, `reports/batch-*.md`, `code-logic-review*.md`,
  `visual-review*.md`, `visual-before-11-17.md`

## Rules to keep

CLAUDE.md memory-safe verification (scoped `-p`, `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time,
filtered output); no build/serve/e2e except the Electron screenshot build announced to the user; never both
`class=""` and `[class]=""` on one element; OnPush + signals + input()/output(); lanes never commit; commit in the
foreground; no local-only branch at the end.
