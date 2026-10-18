# Handoff — TASK_2026_685_64f4 (agent message unification), plus 690 / MCP card PR state

## 0. Goal

Make sub-agent and CLI-agent lanes render their messages the same way as the main agent (one
execution header, one execution stream per agent), per `implementation-plan.md` Phase A (A1-A4) and
Phase B (B1-B7, includes TASK_2026_633). Ship it as PR #751 once every batch in `batches.md` is
implemented, checked, reviewed, and screenshot-verified. All lanes and subagents of the previous
session have finished; nothing is running.

Key files: `batches.md` (per-batch files, specs, check commands, risks), `implementation-plan.md`
(components 1-10, Decisions, Clarifications), `reports/` (batch reports and reviews),
`reports/code-logic-review-A4-B3a.md` (latest review).

Written 2026-10-18 by the orchestrator session that ran 683 / 690 / 685. Read this first, then
`batches.md` (the batch plan) and `implementation-plan.md` (the spec).

## 1. PR and branch state

| PR | Branch / worktree | State |
| --- | --- | --- |
| #748 (683 motion) | merged into main (merge commit 0d918ae4c) | done. Its worktree `.claude-worktrees/nav-session-motion` can be removed when the user says so. |
| #750 MCP sidebar card | `feat/sidebar-mcp-card`, `.claude-worktrees/sidebar-mcp-card`, base `main` | Ready. Last commit d20da66e0 fixes the 2 CodeRabbit comments (in-flight-only `recovering` set, provider name refreshed per notice change). Pushed. User merges after CI is green and resolves the 2 threads. |
| #752 690 chat layout | `feat/chat-layout-display-sheet`, `.claude-worktrees/chat-layout-display-sheet`, base `feat/sidebar-mcp-card` | Ready for review (out of draft). Visual review APPROVED 8/10 after fix 543c127db (`visual-review.md`). Contains the CodeRabbit #748 route-sync fix 4c1fdd406. After #750 merges, GitHub retargets it to main; no rebase needed. |
| #751 685 | `feat/lane-execution-stream`, `.claude-worktrees/lane-execution-stream`, base `main` | Draft. Pushed up to 73e6fa944. Uncommitted work in the worktree (section 2). Leaves draft only when all batches through B6b are done and verified. |

No local-only branches. Local-only work: the uncommitted 685 files below.

690 open items (not blocking, report to user only): sheet peek shows its own body scroller above the
transcript (by design); sheet spans the full lane width while the composer is 758 px centred; model
menu does not close on Escape; side-by-side / stacked / sub-agent lane fill not verified at runtime
(no session had a sub-agent lane).

## 2. 685 progress

Committed on #751 (rebased on main after #748):
- A2, A1, A3 (earlier), A4b 5a12850a4, A4 1cda7cbf1, B1 2d1910965, B2a f8cc7fa24, B3a af584ec9c,
  docs 73e6fa944.

Code-logic review of A4..B3a: `reports/code-logic-review-A4-B3a.md`, CHANGES REQUESTED 7/10, no
Blocking, 4 Moderate. This is the ONE allowed fix round (cap). Fix lanes finished, NOT yet checked or
committed:
- B2a fix (`reports/batch-B2a-fix.md`): deterministic replay ids/timestamps, interleaved same-id
  message envelopes, validation errors kept distinct in `readSubagentEvents`, tail slice aligned to a
  message boundary. Files: agent-sdk `session-replay.service(.spec).ts`,
  `session-history-reader.service(.spec).ts`.
- A4/B3a fix (`reports/batch-A4-B3a-fix.md`): finished sub-agent summary restored in the lane;
  `skipStoreEffects` guards every global store side effect and `registerAgent`; "No output recorded"
  only when empty; steer toggle aria-controls/focus/Escape; Stop/Background double-click guard. Files:
  canvas `canvas-lane-view.component(.spec).ts`, chat `subagent-lane.component(.spec).ts`,
  chat-streaming `accumulator-core.service(.spec).ts`. The lane mentioned 3 possibly pre-existing mock
  typing errors in `accumulator-core.service.spec.ts` — typecheck decides.

B2b done by its lane, NOT yet checked or committed (`reports/batch-B2b.md`): `subagent:history-page`
in `libs/shared/src/lib/types/rpc.types.ts`, schema `subagent-rpc.schema.ts`, handler
`subagent-rpc.handlers(.spec).ts`, pure module `subagent-history-page(.spec).ts` (rpc-handlers). The
lane changed NO DI guard specs, claiming existing registration covers the new method — verify with the
guard specs (section 3 step 2).

Check run on the uncommitted state (finished before handoff):
`npx nx run-many -t typecheck,lint,test -p @ptah-extension/shared @ptah-extension/agent-sdk
@ptah-extension/rpc-handlers @ptah-extension/chat-streaming @ptah-extension/chat
@ptah-extension/canvas --parallel=1`, log at `D:\projects\ptah-extension\.ptah\tmp\685-batch2-checks.log`.
Result: 16/18 targets pass (typecheck + lint pass in all 6 projects; tests pass in shared, agent-sdk,
rpc-handlers, chat-streaming). TWO spec failures, both from the A4/B3a fix round:

1. `chat:test` — `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.spec.ts`,
   "renders a finished agent summary without an empty message or duplicate agent header":
   `NG0201: No provider found for InjectionToken SURFACE_ACTIVE` — the lane now renders
   `AgentSummaryComponent`, which does `inject(SURFACE_ACTIVE)` (agent-summary.component.ts:120). The
   spec's TestBed lacks `{ provide: SURFACE_ACTIVE, useValue: signal(true) }` (from
   `@ptah-extension/core`). Also confirm production: every host that renders `ptah-subagent-lane`
   (canvas lane view, and later the agent monitor panel in B5c) must have SURFACE_ACTIVE provided —
   if one does not, inject it with `{ optional: true }` in the component instead.
2. `canvas:test` — `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts:358`,
   "renders a live depth-2 agent with full tile mode and returns on Escape": expects text
   "Investigation finished" (the finished sub-agent summary), got "". Likely the same summary path
   (a missing provider, a deferred/`@defer` block not rendered in the test, or the summary input
   not wired from `agentNode().summaryContent`). Read `reports/batch-A4-B3a-fix.md` finding 1.

Fix both (small: do it directly or resume the A4/B3a fix lane, CLI session
01a14f8d-8a66-79b0-8083-68d98f90c473 — it may start fresh if its context is too large; give the full
brief), then rerun `-t test -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`.

## 3. Next steps (in order)

1. Fix the two spec failures in section 2 and rerun the chat + canvas tests until green.
2. B2b guard specs, one at a time:
   - `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2`
   - `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-extension-vscode/src/di/surface-composition.spec.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`
   - same three specs under `apps/ptah-electron`
   - `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/surface-composition.spec.ts --coverage=false --maxWorkers=2`
3. Commit in the foreground, separately: `fix(agent-sdk): ...` (B2a fix), `fix(chat,canvas,chat-streaming): ...`
   (A4/B3a fix), `feat(shared,rpc-handlers): ...` (B2b), then the reports as `docs(task-specs)`.
4. Re-review ONLY the fix-round diff (cap reached: if it finds defects, report them and stop for the
   user — do not start another fix round). Claude `code-logic-reviewer`, different family from codex.
   Also review B2b (first review for that batch).
5. Continue `batches.md`: B3b (store, needs B2b) → B4 → B5a ∥ B5b → B5c → B7a → B7b ∥ B7c → B6a → B6b.
   One Claude code-logic review per phase. B5b.3 checks nested-agent chips (Risk 12): if they are
   lost, ask the user (recommended: rebuild nested chips from the store tree).
6. Screenshots (needs Electron + a fresh dev build of this worktree): Phase A step (A1 inspector rows /
   tab chip / hover card, A3 CLI lane, A4 sub-agent lane; "before" images live in the
   `docs-lane-header-proof` worktree), and the B5c step (running / finished / restored sub-agent lane,
   main chat bubble live and restored, agent monitor panel), dark + light, 1440 + 760. Use the
   visual-reviewer subagent.
7. When B6b is done and verified: push, update the #751 body (summary per batch, test plan, review
   verdicts), `gh pr ready 751`.

## 4. Electron slot (shared with peer sessions)

Queue at handoff: TASK_2026_693 (679 follow-ups session) holds it on port 9361; we are next. Wait
for its "Electron: free", then announce `Electron: 685 launching` to the peer sessions (use
ListAgents to find them; the 687 command-center and 679 session-list sessions), and send
`Electron: free` after. Dev build: in this worktree `npx nx run ptah-electron:build-dev` then
`npx nx run ptah-electron:copy-renderer-dev`; skip `rebuild-native` (shared node_modules junction,
EBUSY when another app has better_sqlite3.node loaded). Launch:
`node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9370` in the background. CDP via
Playwright `connectOverCDP`; never `browser.close()`; use `page.setViewportSize`.

## 5. Binding user rules

- CLAUDE.md memory-safe checks: scoped `-p`, `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at
  a time (a `git push` pre-push gate counts as heavy), never `--maxWorkers` on typecheck; no
  build/serve/e2e except the dev-app runs needed for screenshots.
- Implementers are codex CLI lanes (`ptah_agent_list` first, load the agent-lanes skill); reviewers
  are Claude subagents. Lanes never commit and never run checks. Lane briefs repeat the
  "Rules for every lane brief" section of batches.md. Max 3 lanes; file-disjoint only.
- Never commit while a lane is editing the same worktree (lint-staged hides unstaged changes).
- Commit in the foreground; push (+ gh pr) as one background command. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Scopes from `.commitlintrc.json`.
  Never bare `git stash`.
- Ask the user only about removals, scope changes or irreversible actions.
- End each turn with what is done, what is left, and every local-only branch.
- No orphaned local branches: push and open/update a PR for verified work.
