# TASK_2026_627 — Session handoff (session 2 → session 3)

Written 2026-10-11 by the orchestrator. Read this first, then `batches.md` (state, deferred table
627-L1…L12), `decisions.md` (D1–D11) and `implementation-plan.md`.

## Where the work lives

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff`
- Branch: `fix/session-budget-handoff` (from `main` at `69a2b835e`). Nothing is pushed. No PR. Do not
  merge into main.
- Never work in the main checkout `D:\projects\ptah-extension`. Leave its untracked `docs/prototypes/`
  alone.
- The worktree has no own `node_modules`; Node resolves the main checkout's. Never `npm install` there.

## The user's goal

Session budget is 50M tokens. At the handoff stage (80% = 40M): tell the running agent to wrap up and
wait for subagents and CLI lanes, build a good handoff document (agent-written, merged with the
deterministic one), then rotate to a new session seeded with it — automatically. At the hard limit the
user is never stuck: one click "New session".

## User decisions (confirmed)

1. Automatic rotation at the handoff stage; banner keeps "Continue now" and "Cancel". Limit: "New session".
2. The mid-turn figure reuses TASK_2026_626_7b3e (branch `fix-live-session-stats`). Batches 7–8 wait
   until 626 is merged into main and then merged into this branch. **User said (2026-10-11): stop and
   wait for 626.** Do not merge the 626 branch in early.
3. Phase 2 visual review: the user checks the banner and the compaction card manually in Electron. Do
   not run a screenshot review, and do not start serve or dev.
4. The `agent-lane-grid` `userPicked` TypeError (unbound `remove`) was fixed by the user in another
   session. It is not part of this task.

## Batch state (9 of 11 complete)

| Batch | Content | Commit |
|---|---|---|
| 0 | Compaction card only while compacting; chip hides after next user message | `f0882e60d` |
| 1 | `MainThreadNoticeQueue` + delivery via PostToolUse `additionalContext` | `28e3ddc05` |
| 2 | Subagent monitor records task id; handoff notice goes to the queue | `221537118` |
| 3 | Builder keeps agent handoff; budget remembers workspace; queue clear | `306ee2732` |
| 4 | Shared contract (`waitingFor`, `source-unavailable`), coordinator gates + logging, lifecycle | `833e5dadd` |
| 5 | Lane work provider (cli-agent-runtime), required `subagentsInFlight` | `6cb27e3e4` |
| 5F | Phase 1 fixes: limit beats work gate, 15-min wait bound, head-and-tail cut | `44eba9fc3` |
| 6 | Frontend: rotate fallback, waiting copy with counts, budget refusals at `console.info` | `0917b8074` |
| 6F | Phase 2 fixes: seed fallback from `~/.ptah/handoffs/<id>.md`, held handover always visible, Retry reuses the opened tab, "Cancel handover" at limit | `98852ac81` |
| 7 | Budget live feed (`observeLive`, live `stageFor`, wrap-up notice) | BLOCKED on 626 |
| 8 | Adapter live wrapper, `armHandoverIfIdle`, `onTurnTerminal` call | BLOCKED on 626 + 7 |

Reviews: Phase 1 code-logic + style closed (re-review of 5F approved). Phase 2 code-logic re-review of
6F APPROVED 8/10 (`code-logic-rereview-6F.md`); Phase 2 closed. Last commit: `0ab622eb4`. Tree clean.

## Files touched (main ones)

- agent-sdk `libs/backend/agent-sdk/src/lib/helpers/`: `session-budget/session-budget.service.ts`,
  `session-handoff-builder.ts`, `session-handoff-writer.ts`, `main-thread-notice-queue`,
  `compaction/…`, the `SessionHandoverCoordinator`, `session-lifecycle-manager.ts`, `di/register.ts`.
- cli-agent-runtime: `agent-process-manager.service.ts` (lane work provider).
- shared: `session-handover.types.ts`, `session-budget.types.ts`.
- chat `libs/frontend/chat/src/lib/`: `services/session-budget-actions.service.ts`,
  `services/message-sender.service.ts`,
  `components/molecules/notifications/session-budget-banner.component.ts` (all with specs).

## Open todos

- Batches 7 and 8 (see `batches.md`), after 626 merges. Start with Task 7.0: re-check risk A3 against
  the merged 626 types (`provisional`, `revision`) before coding Task 7.1.
- Phase 3 review after Batch 8, then team-leader completion mode.
- Deferred follow-ups 627-L1…L12 in the `batches.md` table (not in scope unless the user asks).
  Notable: L7 extract the coordinator gate (`max-lines` 726), the `session-budget.service.ts`
  `max-lines` growth to 751, L9 queued composer text stays in the old tab, L10 the file seed can
  predate an extend or compact.
- Known side defects, not fixed: MCP OAuth secret change disposes every live session; the subagent
  registry keying also breaks subagent stop/steer/resume app-wide.

## Exact next steps

1. Check whether TASK_2026_626 is merged into main (`git log main --oneline | grep -i live`, or ask
   the user). If it is not merged, report that and stop.
2. When it is merged: merge `main` into `fix/session-budget-handoff` in the worktree (no push).
   Resolve conflicts, then run the scoped checks of the touched libs.
3. Re-invoke the team-leader to un-block Batch 7, then run Batch 7 with a backend-developer, then
   team-leader verify-and-commit. Then Batch 8 the same way. Then the Phase 3 review from `batches.md`.
4. Optional, only if the user asks: one live Electron run to prove risk A1 (`additionalContext`
   reaches the main model mid-turn).

## Pitfalls

- Verification is scoped only: `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`,
  `npx nx typecheck <project> --parallel=1`, `npx nx lint <project> --parallel=1`. One heavy check at a
  time. Never workspace-wide, never `run-many`, never build/serve/dev/e2e/package.
- cli-agent-runtime and chat Jest runs can need a command-line `--moduleNameMapper` override for
  `marked` in this worktree (see "Verification rules" in `batches.md`).
- Executors never commit. The team-leader owns git: explicit staging (never `git add -A`), message ends
  with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never bare `git stash` (the stack is shared with other worktrees).
- `observeLive` must never write the entry `revision`, `snapshot`, `figure`, `usageSeq` or `blocked`;
  skip a live evaluation whose measure differs from the authoritative one (risk A3, cost budgets).
- `budget-limit` handovers are never gated by work in flight; `budget-auto` waits at most 15 min,
  checked only at turn end, then goes to `awaiting-confirmation`.
- The frontend matches the backend literal `'source session unavailable'`
  (`SessionHandoverCoordinator.complete()`); change both together.
