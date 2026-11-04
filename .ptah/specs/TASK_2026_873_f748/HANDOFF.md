# HANDOFF — TASK_2026_873_f748 ptah-review (session 2 state)

## Goal

**ptah-review**: an automated, CodeRabbit-like PR review pipeline in Ptah on the cron scheduler + CLI
agent lanes (Electron first, host-neutral libs). Binding decisions D1–D36 in `decisions.md`.
Approval mode `lane-review`; user prefers codex lanes; reviews from a different family (grok).

## Done (branch `feat/ptah-review`, local only, NOT pushed; worktree `.claude-worktrees/ptah-review`)

| Commit | Batch | Verify (orchestrator) |
|---|---|---|
| `ea3418cd9` | specs/plan | — |
| `9e74840f8` | P1-01 review-contracts | 3/3 |
| `5734b5867` | P1-02 migration 0065 | test+typecheck; lint only pre-existing 0057/0058 (D27) |
| `e52e69c76` | scaffold review-core, review-github | 6/6 |
| `bb2a2f00e` | P1-04 policy + queue | review-core 3/3 |
| `a43fbce1a` | P1-03 GitHub read adapter | review-github 3/3 |
| `e632d1d56` | P1-11 review-eval Nx project + fixture (D20, D28, D29) | review-eval 3/3 |
| `3e5a467e7` | P1-05 SQLite repository + leases | review-core 3/3 |
| `8bcde2a87` | P1-07 lane admission/selector/runner/parser | review-core 3/3 |
| `fcfb73b5f` | P1-06 exact-SHA context + checks | review-core 3/3 |
| `ab214ee76` | review-runs-ui scaffold | 3/3 |
| `19fbb8195` | P1-08 prompts + artifact writer | review-core 3/3 |
| `769a4b7d5` | P1-12 bwrap isolation + codex-runtime hook (D30, D31) | review-eval 3/3; codex-runtime test env-fail on Windows (D30) |
| `8b6541777` | P1-14 runs page/store/list (D32, D33) | review-runs-ui 3/3 |
| `be7b6dde4` | P1-09 stage coordinator (+FR-7 weaker fallback) | review-core 3/3 |
| `ca6ab90e5` | P1-15 drawers + findings table | review-runs-ui 3/3 |
| `a89d03574` | P1-10 dry-run publication + restart fixture | review-core 3/3 |
| `7db1bfa0a` | P1-13 replay runner/matcher/report | review-eval 3/3 |
| `06c18760b` | P1-16a part 1: D32 contract fields + `review:` allowlist (D34, D35) | review libs 12/12, vscode-core pass; rpc-handlers test env-fail only in untouched suites (D35) |

| `22ebcf57c` | P1-16a-2 review RPC surface + query/settings/artifact ports (D36–D38) | persistence-sqlite (D27 lint only), review libs 9/9, shared+review-contracts 6/6, rpc-handlers lint+typecheck pass, test env-fail only untouched suites (D38) |

| `2491556ae` | P1-16a-3 Electron host wiring (D39, D40) | review-core+review-github+cli-agent-runtime 9/9, ptah-electron 9/9 |

## In progress

- **P1-16b** renderer route + cron-tab link → codex lane `f7723ff3-cf02-42f6-9486-4dcc5db3e12d`
  (session `01a1a466-1b25-76e1-b235-886a6e3c27c2`), report `reports/p1-16b-report.md`.

## Next steps

1. On P1-16b signal: verify `-p ptah-extension-webview,review-runs-ui,cron-scheduler-ui`. Machine is
   loaded: prefix `NX_PLUGIN_NO_TIMEOUTS=true`. Run long checks with `run_in_background`; strip ANSI
   from nx terminal output files. Electron `tsconfig.build.json` has an explicit paths list — new
   libs must be added there. Electron `package.json` lists no workspace libs. Commit by explicit path.
3. **P1-16b**: webview route `apps/ptah-extension-webview/src/app/app.routes.ts` + link in
   `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts` + routing specs.
4. **Ask the user** before any Electron run for dark+light screenshots vs `prototype/` (D22, D33).
5. P1 phase review: one grok code-logic review of `git diff main...HEAD` (implementer family codex);
   fix Blocking/Serious + local Minor; re-review (max 2 rounds).
6. Final whole-PR review, then background `git push -u origin feat/ptah-review` + `gh pr create`
   (title <70, `## Summary`, `## Test plan` with real results incl. D27/D30/D35 env failures; body ends
   with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). Watch CI with `gh pr checks`.
7. P2 per `batches.md` (D29 GraphQL thread resolution, D23 secret-storage test in P2-06).

## Rules recap

- Codex lanes cannot run Nx (D26): the orchestrator runs `npm run verify -- -p <project>` one at a time.
- Lanes must not edit `src/index.ts` / `di/*` while another lane edits the same lib; orchestrator wires
  exports. Never stage `task-tracking/landing-live-demo/HANDOFF.md`.
- Commit subject ≤72, body ≤100/line, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Side note: `.claude-worktrees/remove-landing-live-demo` + branch `chore/remove-landing-live-demo`
  (PR #913 merged) still exist — ask the user before removal.
