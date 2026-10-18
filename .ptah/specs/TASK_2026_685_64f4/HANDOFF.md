# Handoff — TASK_2026_685_64f4 (agent message unification), session 2

Written 2026-10-18 by the orchestrator session that continued from the session-1 handoff
(commit b434ffbd5). Read this first, then `batches.md` and `implementation-plan.md` in this folder.

## 0. Goal

Make sub-agent and CLI-agent lanes render their messages the same way as the main agent (one
execution header, one execution stream per agent), per `implementation-plan.md` Phase A (A1-A4)
and Phase B (B1-B7, includes TASK_2026_633). Ship it as PR #751 once every batch in `batches.md`
is implemented, checked, reviewed, and screenshot-verified.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream`, branch
`feat/lane-execution-stream`, PR #751 (draft), base `main`.

## 1. PR and branch state

| PR | Branch / worktree | State |
| --- | --- | --- |
| #750 MCP sidebar card | merged by the user (merge 68227b71d). Worktree `sidebar-mcp-card` and local branch removed (junction removed first). | done |
| #752 690 chat layout | merged into #750's branch, so it is in main. Worktree `.claude-worktrees/chat-layout-display-sheet` still exists. | done; worktree removable when the user says so |
| #748 683 motion | merged. Worktree `.claude-worktrees/nav-session-motion` still exists. | done; removable when the user says so |
| #761 CodeRabbit follow-ups of #750 | `fix/coderabbit-750-followups`, `.claude-worktrees/coderabbit-750-followups` (has a node_modules junction), commits 47db90f95 + 2f14eb3cf | open, ready for review. Chat test 4404 pass, typecheck + lint pass. |
| #751 685 | `feat/lane-execution-stream` | draft, pushed up to f40dfa8ba. One fix lane may leave uncommitted files (section 3). |

#750 extra history (for the PR record): the webview initial budget was raised to 4 MB
(fd876cc0c) before the real cause was found; the eager-closure fix 6a4aab658 (display sheet
value-imported `DISPLAY_PANEL_SUMMARY_KEY`, pulling the display panel + declarative-dashboard
into main.js) probably makes the budget raise unnecessary. The user may want the budget back at
3.75 MB — ask, do not change on your own.

No local-only branches. Delete-on-cleanup rule: remove a worktree's `node_modules` junction first
with `cmd /c rmdir <worktree>\node_modules`, then `git worktree remove --force`.

## 2. 685 progress (commits this session, all pushed)

- 3330e805f B2a fix, baa2cb740 A4/B3a fix (+ my spec fixes: SURFACE_ACTIVE, provideMarkdown,
  whenStable, real SubagentLaneComponent import), ecae2eeab B2b `subagent:history-page`.
- aa1d41dd9 B2b fix (content-anchored `v1.` cursor, HISTORY_CURSOR_STALE, oversized placeholder).
- 138292c6f B3b `SubagentExecutionStore`; 963ed8227 B4 claim seams.
- 1a79a9a66 B-backend style fix (typed history errors, exhaustive kind list, window helper,
  non-advancing cursor guard).
- 4e4198193 B5a lane + canvas lane view on the store; a5ac376f5 B5b bubble + tile on the store.
- 6205bae6b B-store fix round (syncRecord effect, ensureHistory abort, truncated reload, store split
  into `subagent-execution-{ownership,retention,history-merge}.ts`).
- 479009c5b chat spec fallout after B4 (execution-node.ptah-ui mock; R-F4 resync spec asserts
  store ownership).
- 8894470c8 B5b.4 nested agent chips rebuilt from the store trees (USER DECISION on Risk 12),
  including the `$agents` Ptah UI source and turn keys.
- e12dcc246 B5c agent monitor panel renders `ptah-subagent-lane`.
- docs: 5bdc03121, eb91cfbd9, 117ac4f9b, e98b5cd17, 149dc7a30, f40dfa8ba (reports + reviews).

Reviews (all in `reports/`):
- fix round A4/B3a + B2a: APPROVED 8/10 (`code-logic-review-fix-round-B2b.md` part 1).
- B2b: 6.5 -> fix -> APPROVED 8/10 (`code-logic-review-B2b-fix.md`, minor m-D open: a running agent
  with >10 000 events can get HISTORY_CURSOR_STALE).
- B-backend style: CHANGES REQUESTED 7/10 -> fixed in 1a79a9a66 (not re-reviewed).
- B-store logic 6/10 + style 5/10 -> fix 6205bae6b -> re-review NEEDS_REVISION 5/10 with
  BLOCKING B1 + N1-N3 (`code-logic-review-B-store-fix.md`).
- B-render part 1 (B5a, B5b, B5b.4, fallout): NEEDS_REVISION 7/10, M1-M5
  (`code-logic-review-B-render-1.md`).
- B5c: not reviewed yet (B-render part 2).

## 3. In progress at handoff

USER DECISION: one combined, final fix round for the B-store re-review (B1, N1-N3) and B-render
part 1 (M1-M5). Codex lane `aae3d55d-8b96-46a6-b9d8-72640548bd4e`, deliverable
`reports/batch-B-store-render-fix.md`. Brief priority: B1 (history replay drops the parent message
after a Task call: `history-message-builder.service.ts` ~:139-141 must exempt the root
`agent_start` like the live path), N1/M2 (bubble retains without session id -> dead Load button),
M1 (lane retain effect keyed on a computed), N3, N2, M3 (bubble history states), M4 (`$agents`
nested under background agents), M5 (recompute cost), minors. See section 6 for the lane result
when it arrived.

After this round there are NO further fix rounds for B-store / B-render part 1: one re-review of
the fix diff, then report any remaining defect to the user and let the user decide.

## 4. Next steps (in order)

1. Read section 6. If the fix lane left uncommitted files: format them
   (`npx prettier --write <changed .ts files>`), then run, one at a time:
   `npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/canvas --parallel=1`
   (confirm "Running target test for 3 projects"), then `-t typecheck`, then `-t lint`.
   Spec-only fallout is fixed directly (pattern seen often: a spec that resets TestBed and loses
   the `SubagentExecutionStore` mock -> real store -> NG0201 MODEL_REFRESH_CONTROL; add the mock
   `{ entries: signal(new Map()), treeFor: () => [] }`).
   Commit: `fix(chat-streaming,chat): ...` (+ reports as `docs(task-specs)`), push in background.
2. One Claude `code-logic-reviewer` re-review of that fix diff (B1, N1-N3, B-render M1-M5), plus
   B-render part 2 = first review of B5c (e12dcc246). Report remaining defects to the user.
3. Screenshots (B-render step + Phase A step; batches.md :546-548 and the old handoff list):
   running / finished / restored-after-Load sub-agent lane; main chat bubble live and restored with
   Load; agent monitor panel workflow sub-agent; A1 inspector rows / tab chip / hover card, A3 CLI
   lane, A4 sub-agent lane ("before" images in the `docs-lane-header-proof` worktree). Dark + light,
   1440 + 760. Use the `visual-reviewer` subagent.
   Electron slot: free at handoff (662 and 650 closed their apps; 650 will announce a short
   re-check). Announce `Electron: 685 launching` to the peers first (ListAgents: sessions
   ptah-ptah-extension-task-650-setup-wizar-…, ptah-ptah-extension-setting-clean-up-ski-… and the
   687 / 679 sessions), send `Electron: free` after. Dev build in this worktree:
   `npx nx run ptah-electron:build-dev`, then `npx nx run ptah-electron:copy-renderer-dev`; skip
   `rebuild-native`. Launch `node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9370`
   in the background; CDP via Playwright `connectOverCDP`, never `browser.close()`, use
   `page.setViewportSize`.
4. Removal phase (batches.md :552-672): B7a -> B7b ∥ B7c -> B6a -> B6b, one Claude code-logic
   review for the phase (removal completeness + DI guard specs). B6a/B6b remove the
   `subagent:transcript` RPC: run the DI guard specs after B6a:
   - `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2`
   - `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-extension-vscode/src/di/surface-composition.spec.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`
   - the same three under `apps/ptah-electron`
   - `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/surface-composition.spec.ts --coverage=false --maxWorkers=2`
   B7b removes `canViewTranscript: false` in canvas-lane-view (kept on purpose until then).
5. When B6b is verified: push, update the #751 body (summary per batch, test plan, review
   verdicts, the user decisions below), then `gh pr ready 751`.

## 5. Decisions made with the user this session

- #750: raise the budget to 4 MB (done), then a proper eager-closure fix (done, 6a4aab658).
- Risk 12: nested agent chips are rebuilt from the store trees (B5b.4, done).
- B-store cap: one combined extra fix round with B-render (running at handoff), then report only.
- CodeRabbit follow-ups of #750 go to their own PR (#761).

## 6. Fix lane result

The lane finished and reported (report: `reports/batch-B-store-render-fix.md`). Its changes are
UNCOMMITTED and UNCHECKED in the worktree (no test/typecheck/lint ran; not Prettier-formatted).
Files changed by the lane:
- libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts (+ .spec.ts)
- libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts (+ .spec.ts)
- libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts (+ .spec.ts)
- libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts (+ .spec.ts)
- libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts (+ .spec.ts)
- libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.ts (+ .spec.ts)
- libs/frontend/chat/src/lib/components/organisms/transcript/transcript-ptah-ui-host-sources.ts (+ .spec.ts)
- libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts (+ .spec.ts)
- reports/batch-B-store-render-fix.md

Lane claims: B1, N1-N3, M1-M5 and the UI minors fixed with specs. Residuals it names: nested chips
still need the parent entry resident/loaded; a per-key revision avoids unrelated publishes, but an
update of a referenced key still recomputes all turn facts; the active-session bubble fallback can
differ for background tabs without a monitor record. Verify all of this (section 4 step 1), then
the re-review (step 2) decides.

Start with `git status --short` and `git diff --stat` in the worktree to see the lane's state.

## 7. Binding user rules

- CLAUDE.md memory-safe checks: scoped `-p`, `--parallel=1`, Jest `--maxWorkers=2`, one heavy check
  at a time (a `git push` pre-push gate counts), never `--maxWorkers` on typecheck; no
  build/serve/e2e except the dev-app runs for screenshots.
- Implementers are codex CLI lanes (`ptah_agent_list` first, load the agent-lanes skill; grok is at
  98% weekly until 2026-10-20, Glm is the fallback); reviewers are Claude subagents. Lanes never
  commit and never run checks; briefs repeat "Rules for every lane brief" in batches.md. Max 3
  lanes, file-disjoint. `ptah_agent_spawn` rejects `taskKind`.
- Never commit while a lane edits the same worktree. Do not push while a lane edits (the pre-push
  validate-deps build reads the working tree).
- Commit in the foreground; push (+ gh pr) as one background command. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Scopes from `.commitlintrc.json`.
  Never bare `git stash`.
- Lint-staged does not run Prettier on these files: run `npx prettier --write` on changed files
  before committing.
- Ask the user only about removals, scope changes or irreversible actions.
- End each turn with what is done, what is left, and every local-only branch.
