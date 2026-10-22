# HANDOFF — TASK_2026_707 Analytics dashboard redesign (session 2)

Written 2026-10-20 ~19:45 local by orchestrator session 2 (token budget). Supersedes the session-1
handoff. `context.md` in this folder has the full log (Glm limit recorded at its end).

## Goal (user request)
1. Compact, uniform plan-limit tiles; fix Grok / Ollama / Antigravity readers. (PR 1)
2. T3-Code-style usage dashboard: usage per provider, tokens, cost per model, charts. (PR 2)
3. User sees every change in Electron (dark + light, **full-page desktop view**) before merge.
4. Side task: agy (Antigravity CLI) lanes end with `result.status: ERROR` → diagnostics fix.

User decisions (keep): in-house SVG charts; daily **stacked bars**; **cost-share donut** with
Provider | Model toggle; tiles get a subtle border; RPC is `analytics:spendSummary` (renamed so
the TASK_2026_610 host-source guard does not match `usage`); merge the old Sessions tab into the
Usage view = **"Merge + small top-5 list"** (counts into the KPI strip, top-5 sessions table, remove
session cards/modal/tab). User APPROVED the #796 design screenshots but wants **full-page desktop
screenshots** (they were window-sized sections).

## PRs and branches
| PR | Branch / worktree | State |
| --- | --- | --- |
| #784 plan-limit tiles | `feat/plan-limit-tiles` / `.claude-worktrees/plan-limit-tiles` | MERGED (head 7fac90cb1). Worktree clean. |
| #787 usage dashboard | `feat/analytics-dashboard` | MERGED (head 8b9df45cd). |
| **#796** tile + usage polish, donut | `feat/usage-dashboard-polish` / `.claude-worktrees/analytics-dashboard` | OPEN. Commits 0f925e8f8 (code), 5448a9e97 (specs). CI: only `electron-e2e` shards 1/3 failed on npm `ECONNRESET` (infra); `gh run rerun --failed` requested for run 39481994925. |
| **#797** agy diagnostics | `fix/agy-error-status` / `.claude-worktrees/agy-error-status` | OPEN. Commits 36d41ddd0 (fix), efeb2b7fc (specs). CI running. |

All worktrees have a `node_modules` junction to the main checkout. Main checkout stays on `main`.

## Done in session 2
- PR 784 follow-up: CI fixes + 4 CodeRabbit replies, merged.
- PR 787: view-model split (707→3 files), mojibake repairs, RPC rename, `messageId` spec, opencode
  WAL suppression, `usage-analytics` commitlint scope, tsconfig.base alias, host build alias in
  `apps/ptah-{electron,cli,tui}/tsconfig.build.json` (Electron build-main failed without it),
  merge of main (rpc.types conflict). Merged.
- Visual review r1 (FAIL both) → fixes → reviews → visual review r2 PASS WITH NOTES (both),
  screenshots `visual/r2/*.png` (git-ignored, local only).
- agy: investigation (`agy-error-status-investigation.md`, 3 real runs SUCCESS), web research
  (`agy-error-status-web-research.md`, agy 1.4.3), diagnostics fix with 2 review rounds
  (final APPROVE WITH FIXES 8/10; low items listed as follow-ups in #797 body).
- Known pre-existing failures on main (not ours): `claude-approval.reader.spec.ts` (2 real-git
  tests, cli-agent-runtime); `translation-proxy.sdk.integration.spec.ts` (auth-providers);
  Electron `state-storage-oversized-profile.bundle.spec.ts` needs a built worker artifact.

## In progress at handoff
- **Codex lane `39bc3598-4144-49b2-882f-652eccedd443`** (CLI Session ID
  `01a15aca-a665-7c42-8333-3b16fe9518f1`), working in `.claude-worktrees/analytics-dashboard`
  on branch `feat/usage-dashboard-polish`: merge Sessions tab into Usage (preserve list in its
  brief): sessions/messages/subagents counts → KPI strip; new "Top 5 sessions by cost" table from
  the Usage summary (may extend `UsageSummary`/`UsageFact` + `usage-analytics`); remove Sessions
  tab, session cards, detail modal and code with no other consumer. Deliverable:
  `batch-sessions-merge.md` in this folder (incl. `## Proposed Removals` — needs user approval).
  **UPDATE: the lane FINISHED after the handoff was written** (report received; deliverable
  `batch-sessions-merge.md` written). 27 files changed, UNCOMMITTED, UNVERIFIED by the
  orchestrator. Lane claims: session KPIs + top-5 table added; contract/backend extended;
  session card/modal components deleted; public session-stats RPC/service KEPT (CLI/TUI
  consumers); titles fall back to session IDs where the source has none; counts cover only
  session-linked contributions. Targeted Jest: backend 3/3, shared 3/3, frontend 56/56 and 36/36.
  Its `## Proposed Removals` (need user approval, NOT done): `SessionAnalyticsStateService` +
  fixtures (public index still exports them); "Session Analytics" wording in docs, Electron
  showcase copy and VS Code command titles.
- Machine queue (shared RAM/Electron): html-components (`ptah-ptah-extension-html-components-v2…`)
  holds the check slot and will send "checks: free" to 707; notification-fixes
  (`ptah-ptah-extension-notification-fixes-v-336f5e…`) also waits and needs Electron later.

## Open problems / decisions
1. Glm lane is AT LIMIT (reset unknown) — do not use. Reviews of Codex work go to grok (confirmed
   room) or opencode (Monthly 94%, near limit).
2. The sessions-merge lane output is unverified: read the deliverable, check the preserve list,
   check every deleted symbol's consumers (VS Code webview, CLI/TUI, e2e harness, DI/RPC guards,
   host-source baseline), get an independent review (grok or opencode), max 2 revise rounds.
3. The tile grid uses `grid-auto-rows: 1fr`; with few accounts a short tile has empty space
   (user did not object; mention it).
4. Follow-ups listed in PR bodies (#787/#796/#797): workspace scope switch, 90-day rollup,
   qualified bundled pricing, pricing asOf, legacy Claude null-id dedup, Ollama/Antigravity
   dashboard sources, spec file sizes; agy D6/D8/N1/N2.

## Key files
- Spec folder: `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/`
  (context.md, batch-*.md, code-logic-review-*.md, visual-review.md, visual-review-pr787.md,
  visual-review-r2.md, visual/ and visual/r2/ screenshots).
- agy spec folder: `D:/projects/ptah-extension/.claude-worktrees/agy-error-status/.ptah/specs/TASK_2026_707_agy/`.
- Dashboard code: `libs/frontend/dashboard/src/lib/components/{usage-dashboard,analytics-card,
  provider-account-card,provider-account-tile,session-analytics}/`,
  `libs/frontend/dashboard/src/lib/services/analytics-usage.store.ts`.
- Backend: `libs/backend/usage-analytics/`, `libs/shared/src/lib/types/rpc/rpc-analytics.types.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/analytics-rpc.handlers.ts`.

## Exact next steps
1. Lane `39bc3598` is finished. Read `batch-sessions-merge.md`; verify the preserve list,
   deletions and consumers (`git status` / `git diff` in the worktree); ask the user about the
   two `## Proposed Removals`.
2. Spawn an independent code-logic review (grok preferred, else opencode; never codex for codex
   code) → fix → re-review (cap 2 rounds).
3. Ask the machine queue for the slot (SendMessage via ListAgents), then in
   `.claude-worktrees/analytics-dashboard`:
   ```powershell
   $env:NX_NO_CLOUD='true'
   npx nx run-many -t typecheck -p dashboard usage-analytics shared rpc-handlers --parallel=1   # only projects the lane changed
   npx nx run-many -t test -p dashboard usage-analytics shared rpc-handlers --parallel=1 -- --maxWorkers=2   # check header count
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String "FAIL|TOTAL"
   ```
   If host-facing code changed (RPC removed/added): also typecheck `ptah-electron`,
   `ptah-extension-vscode`, `ptah-cli` and run their `src/di` Jest specs
   (`apps/ptah-cli/jest.config.cjs`).
4. Electron visual review via a Codex `visual-reviewer` lane (port 9335, kill only its own PID,
   never by image name): `npx nx build-dev ptah-electron --parallel=1`, `npx nx copy-renderer-dev
   ptah-electron --parallel=1`, launch `NODE_ENV=development ./node_modules/electron/dist/electron.exe
   --remote-debugging-port=9335 dist/apps/ptah-electron/main.mjs`. **Window 1920x1080 and
   1440x900; one full-page image of the whole analytics page (scroll the inner container and
   stitch), dark + light**, plus detail shots (readout, donut Model mode, Tokens mode, top-5 table).
   Show the images to the user (Read the PNGs) before any merge.
5. Commit in the foreground (scope e.g. `feat(dashboard,usage-analytics): merge sessions into usage view`,
   read `.commitlintrc.json`), push in the background to #796, update the #796 body (sessions
   merge + test plan), send "checks: free" to the waiting sessions.
6. Watch #796 and #797 CI (`gh pr checks 796`, `gh pr checks 797`); infra flakes (npm ECONNRESET)
   → `gh run rerun <run> --failed` after the run completes.
7. Merge only after the user approves the full-page screenshots.

Rules: CLAUDE.md (memory-safe checks, Electron first, worktrees, foreground commit / background
push). Until 2026-10-24 use CLI lanes (load agent-lanes skill), not Claude subagents. Never wait
or poll for lanes; act on `<agent-lane-completed>`.
