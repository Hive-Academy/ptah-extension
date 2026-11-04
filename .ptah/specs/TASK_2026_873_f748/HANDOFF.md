# HANDOFF — TASK_2026_873_f748 ptah-review (session 4 state)

## Goal

**ptah-review**: an automated, CodeRabbit-like PR review pipeline in Ptah on the cron scheduler + CLI
agent lanes (Electron first, host-neutral libs). Binding decisions D1–D40 in `decisions.md`.
Approval mode `lane-review`; implementer = codex, reviewer = grok.

## Done — P1 complete (branch `feat/ptah-review`, worktree `D:\projects\ptah-extension\.claude-worktrees\ptah-review`)

P1 batch commits `ea3418cd9`..`ffa6be7e4` (see git log). Review rounds this session:

| Commit | Content | Review |
|---|---|---|
| `a4db38ed6` | P1 fix round 1 (B1–B3, S1–S6, M1–M3) | grok round 2: all closed, new N1, N2 |
| `5e955b446` | P1 fix round 2 (N1, N2) | grok final whole-PR: N1, N2 closed, new F1, F2 |
| `b75c21b63` | Final-review fixes (F1, F2) | grok re-check: APPROVE 8/10 |

Verify on `b75c21b63`: review-core, review-contracts, review-github, review-runs-ui, shared,
ptah-electron, degradation-audit (lint, self-test) pass. rpc-handlers lint+typecheck pass; tests fail
only the accepted D35/D38 env suites (chat/session, install-scope, skills-sh, plugin session-notice).

Electron screenshots in `reviews/electron-shots/*.png` are git-ignored; kept local only (not forced).

## Open follow-ups (Minor, not blocking)

- `review-runs.store.ts`: `refreshError` keeps the failed-poll alert after a reload shows poll
  `succeeded` (grok re-check M1).
- `review-runs.store.ts:155` casts `rpc.call` to a loose function type; replace with the typed RPC call.
- `refresh()` polls only the first configured repository (accepted under D40 for P1).

## Next steps

1. Push + PR (background), then watch CI with `gh pr checks` and address findings.
2. P2 per `batches.md` (P2-01 uses migration 0066; D29; D23; multi-repo per D40).

## Do not stage

`task-tracking/landing-live-demo/HANDOFF.md`, `.ptah/specs/TASK_2026_863_26b1/`, `agent-output-*.md`,
`apps/ptah-electron-e2e/src/docs-screenshots/zz-review-runs.tmp.shot.ts`.

Side note: `.claude-worktrees/remove-landing-live-demo` + branch `chore/remove-landing-live-demo`
(PR #913 merged) still exist — ask the user before removal.
