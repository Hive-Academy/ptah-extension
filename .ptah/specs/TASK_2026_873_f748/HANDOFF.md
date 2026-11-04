# HANDOFF — TASK_2026_873_f748 ptah-review (session 3 state)

## Goal

**ptah-review**: an automated, CodeRabbit-like PR review pipeline in Ptah on the cron scheduler + CLI
agent lanes (Electron first, host-neutral libs). Binding decisions D1–D40 in `decisions.md`.
Approval mode `lane-review`; user prefers codex/non-Claude lanes; reviews from a different family
than the implementer (implementer = codex, reviewer = grok).

## Done (branch `feat/ptah-review`, local only, NOT pushed; worktree `D:\projects\ptah-extension\.claude-worktrees\ptah-review`)

| Commit | Batch | Verify (orchestrator) |
|---|---|---|
| `ea3418cd9` | specs/plan | — |
| `9e74840f8` | P1-01 review-contracts | 3/3 |
| `5734b5867` | P1-02 migration 0065 | test+typecheck; lint only pre-existing 0057/0058 (D27) |
| `e52e69c76` | scaffold review-core, review-github | 6/6 |
| `bb2a2f00e` | P1-04 policy + queue | 3/3 |
| `a43fbce1a` | P1-03 GitHub read adapter | 3/3 |
| `e632d1d56` | P1-11 review-eval + fixture (D20, D28, D29) | 3/3 |
| `3e5a467e7` | P1-05 SQLite repository + leases | 3/3 |
| `8bcde2a87` | P1-07 lane admission/selector/runner/parser | 3/3 |
| `fcfb73b5f` | P1-06 exact-SHA context + checks | 3/3 |
| `ab214ee76` | review-runs-ui scaffold | 3/3 |
| `19fbb8195` | P1-08 prompts + artifact writer | 3/3 |
| `769a4b7d5` | P1-12 bwrap isolation (D30, D31) | 3/3; codex-runtime env-fail on Windows (D30) |
| `8b6541777` | P1-14 runs page/store/list | 3/3 |
| `be7b6dde4` | P1-09 stage coordinator | 3/3 |
| `ca6ab90e5` | P1-15 drawers + findings table | 3/3 |
| `a89d03574` | P1-10 dry-run publication | 3/3 |
| `7db1bfa0a` | P1-13 replay runner | 3/3 |
| `06c18760b` | P1-16a-1 contract fields + `review:` allowlist (D34, D35) | pass; rpc-handlers env-fail only untouched suites |
| `22ebcf57c` | P1-16a-2 review RPC surface + query/settings/artifact ports (D36–D38) | persistence-sqlite D27-only lint; review libs 9/9; shared+review-contracts 6/6; rpc-handlers lint+typecheck pass, test 9 untouched suites env-fail (D38) |
| `2491556ae` | P1-16a-3 Electron host wiring (D39, D40) | review-core+review-github+cli-agent-runtime 9/9; ptah-electron 9/9 |
| `ffa6be7e4` | P1-16b renderer route + Schedules link | webview, review-runs-ui, cron-scheduler-ui, core, shared 15/15 |

Electron visual check (user approved, D33) done on `ffa6be7e4` build: page renders in `anubis` (dark)
and `anubis-light`; shots in `reviews/electron-shots/` (not committed yet — commit with the review
fix). Layout matches prototype structure; empty state only (no data in test profile).

## In progress — P1 review fix round 1 (UNCOMMITTED in worktree)

- grok P1 phase review: `reviews/p1-phase-review.md` → **REJECT 4/10**, Blocking B1 (60 s drain
  deadline passed to stages → lanes always skip), B2 (lane output parsed from stdout instead of
  `out/lane-output.json`), B3 (shutdown does not abort drain before SQLite close); Serious S1–S6;
  Minor M1–M2. Orchestrator added M3 (header pause toggle + icon, from visual check).
- Fix lane codex `9a191bcc-0c83-48b3-8014-534b4de6d814` (session `01a1a47d-efc1-7c72-b9be-3d9879d7a8f2`),
  report `reports/p1-review-fix-1.md`. Done so far: B2, part of S5 (retry returns attempt id,
  partial stage mapping), M3. Its current turn works on: B1, B3, S1, S4, S2, S6, S3, S5 regression
  spec, M1, M2 (in that order; report table updated per finding).
- Uncommitted temp file NOT to commit: `apps/ptah-electron-e2e/src/docs-screenshots/zz-review-runs.tmp.shot.ts`
  (delete it before the final commit, or keep untracked).

## Open problems and decisions

- Machine is loaded: Nx plugin worker times out; prefix every verify with `NX_PLUGIN_NO_TIMEOUTS=true`.
- Accepted environment failures: D27 (persistence-sqlite lint 0057/0058), D30 (codex-runtime on
  Windows), D35/D38 (rpc-handlers: chat/session, install-scope, skills-sh, plugin session-notice).
- Electron `tsconfig.build.json` has an explicit paths list (new libs must be added). Electron
  `package.json` lists no workspace libs — never add them.
- Buildable importers need buildable deps + package.json entries (D38).
- Side note: `.claude-worktrees/remove-landing-live-demo` + branch `chore/remove-landing-live-demo`
  (PR #913 merged) still exist — ask the user before removal.

## Key files

- `D:\projects\ptah-extension\.claude-worktrees\ptah-review\.ptah\specs\TASK_2026_873_f748\decisions.md` — binding D1–D40.
- `...\TASK_2026_873_f748\reviews\p1-phase-review.md` — grok findings to close.
- `...\TASK_2026_873_f748\reports\p1-review-fix-1.md` — fix lane status table.
- `...\TASK_2026_873_f748\batches.md` — P2 batches after P1 ships.

## Background work

- codex lane `9a191bcc-0c83-48b3-8014-534b4de6d814` — P1 review fix round 1 (remaining findings
  turn) — running. Its signal/report goes to the new session.

## Next steps

1. On `9a191bcc` signal: read `reports/p1-review-fix-1.md`. If findings remain, resume the lane
   (`resume_session_id 01a1a47d-efc1-7c72-b9be-3d9879d7a8f2`; >600 s idle gives a fresh lane — restate
   the task fully) until B1–B3, S1–S6, M1–M3 are fixed or disputed with evidence.
2. Verify one at a time from the worktree (background, long timeout, strip ANSI from
   `~/.nx/.../terminalOutputs/*`):
   `NX_PLUGIN_NO_TIMEOUTS=true npm run verify -- -p review-core,review-contracts,review-github,review-runs-ui`,
   then `-p persistence-sqlite` (if touched), `-p rpc-handlers`, `-p ptah-electron`. Relay failures
   to the lane (D26: codex lanes cannot run Nx).
3. Commit fix round 1 by explicit path (+ `reviews/p1-phase-review.md`, `reviews/electron-shots/*.png`,
   `reports/p1-review-fix-1.md`); exclude the `zz-review-runs.tmp.shot.ts`, `agent-output-*.md`,
   `.ptah/specs/TASK_2026_863_26b1/`, `task-tracking/landing-live-demo/HANDOFF.md`.
4. Round 2 review: resume grok session `01a1a474-3ddf-7f02-baf2-f1cfbfe21550` (or fresh grok lane,
   role code-logic-reviewer) on the fix diff; max 2 rounds total.
5. Final whole-PR review (grok), fix, then background `git push -u origin feat/ptah-review` +
   `gh pr create` (title <70, `## Summary`, `## Test plan` with real results incl. D27/D30/D35/D38
   env failures and the Electron visual check; body ends with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). Watch CI with `gh pr checks`.
6. P2 per `batches.md` (P2-01 uses migration 0066; D29; D23; multi-repo per D40).
