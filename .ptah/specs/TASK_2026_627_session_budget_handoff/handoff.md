# TASK_2026_627 — Session handoff (session 1 → session 2)

Written 2026-10-11 by the orchestrator. Read this first, then `implementation-plan.md` and `batches.md`.

## Where the work lives

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff`
- Branch: `fix/session-budget-handoff` (from `main` at `69a2b835e`). Nothing is pushed. No PR.
- Never work in the main checkout `D:\projects\ptah-extension`. Its untracked `docs/prototypes/` folder is not part of this task — leave it alone.
- The worktree has no own `node_modules`; Node resolves the main checkout's. Run commands from the worktree root. Never `npm install` there.

## The user's goal

Session budget is 50M tokens (the figure the chat shows). At the handoff stage (80% = 40M):

1. Send a message INTO the running agent: wrap up, start no new work, wait for running subagents and CLI lanes.
2. Then build a good handoff document (agent-written, merged with the deterministic one).
3. Then start a new session seeded with it — automatically (user decision).

Today the user only sees a notice at ~53M, sends are refused, and the session is stuck.

## Evidence (Electron log `%APPDATA%\Ptah\logs\Ptah Electron-2026-10-11.log`)

- `6e24ecf7`: first budget transition `normal -> limit` at 53,474,681 tokens (14:21:37Z). Never passed tighten/handoff — the climb was inside long turns.
- `f6862b9b`: tighten 25.7M, handoff 46.9M (93.9%), limit 53.0M four minutes later. Handoff stage only wrote a file.
- `[SubagentBudgetMonitor] Subagent over budget but no task id yet; stop deferred` repeated 13:12–14:19 → subagents never stopped.
- `chat:continue - refused: session budget reached`, each followed by `[renderer] console.error` (generic sender log at `message-sender.service.ts:745`, not a crash). User forked manually at 14:46.
- Handoff file `~/.ptah/handoffs/6e24ecf7-….md` was thin: "No compaction summary", "Open items: None recorded".

## Root causes (full list with file:line in implementation-plan.md)

1. Budget fed only at turn end (`sdk-agent-adapter.ts:1785-1801`, result message only).
2. Handover gate reads the previous turn's stage (`onTurnEnd` before the stats).
3. A message pushed into a running turn never reaches the model (`session-registry.service.ts:76-82`) → wrap-up must go via `PostToolUse` `additionalContext`.
4. Handoff stage only writes a file (`session-budget.service.ts:502-531`).
5. Subagent monitor looked up records by `toolu_…` id but they are keyed by hook UUID → never stopped.
6. Limit dead end: coordinator parks in `awaiting-confirmation`; `confirm()` has no caller/RPC.
7. Handover needs a live session record; the 14:25 config re-init disposed all sessions → "source session unavailable".
8. Agent-written handoff squeezed out by the 8,200-char seed cap and never written to file.
9. Coordinator logs nothing.

## User decisions (confirmed)

1. Handoff stage: automatic rotation after the agent wraps up and subagents/lanes finish; banner keeps "Cancel" and "Continue now". At the hard limit: one click "New session".
2. Mid-turn figure: reuse TASK_2026_626_7b3e's live estimate (branch `fix-live-session-stats`, worktree `.claude-worktrees/fix-live-session-stats-a1634d3869cb`, batches 3–5 still open). Batches 7–8 of 627 wait for 626 to merge.

## Batch state

| Batch | Content | State |
|---|---|---|
| 0 | Compaction card only while compacting; chip hides after next user message | COMPLETE `f0882e60d` |
| 1 | `MainThreadNoticeQueue` + delivery via PostToolUse `additionalContext` + DI | COMPLETE `28e3ddc05` |
| 2 | Monitor records task id from `task_started`; handoff goes to the queue | COMPLETE `221537118` |
| 3 | Agent handoff kept in full (builder); budget remembers workspace; queue `clear` on release/clearAll | IN_PROGRESS in batches.md, **no code written** (agent stopped when session 1 ended; worktree clean) |
| 4 | Shared contract, coordinator gates + logging, lifecycle `subagentsInFlight` / `armHandoverIfIdle` | Ready after 3 |
| 5 | Lane work provider (cli-agent-runtime); Phase 1 review (code-logic + style) | Ready after 4 |
| 6 | Frontend never stuck at the limit; Phase 2 review (logic + visual) | Ready after 4 |
| 7 | Budget live feed (Component 1 rest) | BLOCKED on 626 merge |
| 8 | Adapter live wrapper, `armHandoverIfIdle`, `onTurnTerminal` call | BLOCKED on 626 + 7 |

Docs commits: `af9ed9112`, `3e7105a38`, `79200a9c3` (task.md now `status: in_progress`, `description` as `>-`).

## Open risks

- A1: that `additionalContext` reaches the main model mid-turn is only typed, not proven. Needs one live Electron run (only if the user asks). If it fails, the turn-end handover still runs.
- A3: with a cost (`usd`) budget unit the live estimate can lose `totalCost`; Task 7.1 skips a live evaluation whose measure differs. `observeLive` must never write the entry `revision`.
- Side defects recorded, not fixed: MCP OAuth secret change disposes every live session; subagent registry keying also breaks subagent stop/steer/resume app-wide.

## Next action

Re-launch Batch 3 with a backend-developer using the prompt in `batches.md` (Batch 3: tasks 3.1 builder, 3.2 budget service). Then re-invoke the team-leader in verify-and-commit mode, then Batches 4 → 5 → 6, one executor at a time.

## Rules for every agent and lane

- Verify only changed projects: `npx jest -c <lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2`, `npx nx typecheck <project> --parallel=1`, `npx nx lint <project> --parallel=1`.
- Never workspace-wide checks, never `nx run-many` across unchanged projects, never build/serve/dev/e2e/package.
- One heavy check at a time. Filter output; do not re-run to read it.
- Executors never commit; the team-leader owns git (explicit staging, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
