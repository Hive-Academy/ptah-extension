# HANDOFF — TASK_2026_705_9d53 (remove single layout) + closed TASK_2026_699_833e + TASK_2026_704 timeout fix

Written 2026-10-19 (session 3 wrap-up). No subagent, CLI lane or background command is running.
Electron is closed by this session (peer 700 announced its own launch on port 9334; wait for its
"Electron: free" before you launch). This file replaces the session 2 handoff
(`.claude-worktrees/inspector-side-dock/.ptah/specs/TASK_2026_699_833e/HANDOFF.md` is now stale).

## Goal

One PR per task, never merged to main by us:

1. TASK_2026_699_833e — "This session" inspector as a resizable "Stats" side dock in the Electron canvas. **DONE: PR #771.**
2. TASK_2026_705_9d53 — delete `ptah-tab-bar` and the `'single'` LayoutMode in every host, including the
   VS Code Canvas/single toggle. A stored `'single'` lands on the grid. Removals approved by the user:
   705 decisions 2, 4, 5, 6. **IN PROGRESS: batches 1-3 of 4 committed, branch local only.**
3. Side request from the user (console `agent:getLanePlanLimits` / `git:info` RPC timeouts), investigated by
   the Glm lane. **DONE: PR #772.**

## Done

### PR 1 — https://github.com/Hive-Academy/ptah-extension/pull/771 (branch `feat/inspector-side-dock`, pushed)
- Fix round: `abf44d146` (L1 handoff across 400 px + V-F2 `@defer (when <open>)` with skeleton), `e79f4100e` docs.
- Bounded correction (user decision 21): `c0a523197` (direct md→compact resize keeps the open dock), `1cbd4d5fd` docs.
- Mode 3 completion: `198c7c3f2` (pr-body.md, visual-recheck.md, screenshots/recheck/, task.md `status: in_review`).
- Reviews: codex re-review 1 REVISE (fixed by decision 21), re-review 2 REVISE 7/10 with one Moderate only
  (decision 22, follow-up). Visual re-check APPROVED 8/10 (decision 23). Style APPROVED.
- Decisions 20-23 in `TASK_2026_699_833e/decisions.md`: V-F1 composer overlap → follow-up for the peer owner
  (pre-existing composer behavior, proved by a split-pane 360 px screenshot); R2-M1 0 px reset + R-1 transient
  stale dock → follow-ups. All follow-ups are listed in the PR body.
- `.ptah/specs/TASK_2026_699_833e/.electron-userdata/` is still untracked and must never be committed.
- Merge order: #771 before PR 2.

### Timeout fix — https://github.com/Hive-Academy/ptah-extension/pull/772 (branch `fix/plan-limits-rpc-timeout`, pushed)
- Worktree `D:\projects\ptah-extension\.claude-worktrees\plan-limits-rpc-timeout`.
- `d831df4ff` fix(rpc-handlers,vscode-lm-tools): one 8 s end-to-end budget in the lane plan-limits handler;
  `agent.list()` raced against it; lookup gets the remaining time. `da7f56e53` docs (investigation + reviews).
- Implemented by Glm, reviewed by codex: REVISE 5/10 → one fix round → APPROVED 8/10. Scoped check green
  (rpc-handlers, vscode-lm-tools).
- Follow-ups in the PR body: `git:info` timeout (proposed only), stale renderer `timeout` rows (Moderate),
  slow cold CLI detection, NG0956 (the rest of TASK_2026_704_8918).
- Untracked copies of `TASK_2026_704_8918/task.md` and `context.md` stay untracked in that worktree
  (the originals live in the main checkout).

### PR 2 — worktree `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout` (branch `refactor/remove-single-layout`, LOCAL ONLY)
- "Before" screenshots: `screenshots/before/` (16 PNGs) + `visual-before.md`. Electron has no reachable
  single layout at base; tab bar and Canvas toggle exist only in the VS Code webview (rendered in headless
  Chromium with a stubbed `acquireVsCodeApi`, scripts in `capture/`).
- Batch 1 `56451fc0b` refactor(core,chat): drop the tab bar and single layout.
- Batch 2 `8e4fc7cb3` refactor(chat,canvas): drop chat-view layout and inspector.
- Batch 3 `56fccb725` refactor(core,harness-builder,webview): drop layout API.
- Decision 9 (705): deletion of `focusQuestionCard` / `openLaneFromInspector` accepted (only callers were the
  deleted inspector host template, covered by user decision 6).
- The task folder `.ptah/specs/TASK_2026_705_9d53/` is NOT committed yet (commit it in Mode 3; check that
  `capture/` and screenshots are wanted; never commit any `.electron-userdata/`).

## Open problems

| Item | Status |
|---|---|
| `ptah-extension-webview:lint` fails: circular dependency webview ↔ `@ptah-extension/command-center` at `apps/ptah-extension-webview/src/app/app.routes.ts:224` | PRE-EXISTING on main 15fe6031a (reproduced). Not ours. List as a follow-up in the PR 2 body. The final lint check will show it. |
| `compact-session-card.component.spec.ts` failed once in the Batch 1 run (worker force-exit warning) | Passes alone 49/49; did not recur in Batch 2/3. If it fails again, treat it as real. |
| `.gitignore` in the PR 2 worktree has a one-line change (`.opencode/agent/` in the Ptah harness block) | Not ours (Ptah harness). Never stage it, never revert it. |

## Exact next steps (PR 2)

1. **Batch 4** (chat-ui dead components + Electron e2e/showcase edits): one frontend-developer (Claude subagent,
   so codex stays a different family for the review). Prompt: the team-leader text in `batches.md` → Batch 4
   (IN_PROGRESS). Tell it: work only in the PR 2 worktree, never edit `chat-transcript.*`, `message-bubble.*`,
   `chat-input.component.ts`, do not edit `batches.md`, run no checks.
2. Batch 4 scoped check (orchestrator, foreground, filtered):
   `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui ptah-electron-e2e --parallel=1 2>&1 | grep -E "Running target|Successfully|Failed|failed|✕|●|error TS|Tests:" | head -30`
   (confirm "2 projects"). Then a fresh team-leader Mode 2 commit (stage only Batch 4 code files; never `.gitignore` or `.ptah/specs/`).
3. Final scoped checks, one at a time (from `implementation-plan.md:396-399`):
   - `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/harness-builder ptah-extension-webview ptah-electron-e2e --parallel=1`
   - `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/harness-builder ptah-extension-webview --parallel=1`
   - `npx nx run-many -t lint -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/harness-builder ptah-extension-webview ptah-electron-e2e --parallel=1`
     (expect only the pre-existing webview circular-dependency error).
   - Zero-reference sweep from `implementation-plan.md:380-388` (`ptah-layout-mode` only in e2e `canvas.spec.ts`
     and the `app-state.service.spec.ts` regression case).
4. codex code-logic review of `15fe6031a..HEAD` (run `ptah_agent_list` first; `taskKind` is NOT a valid spawn
   key; deliverable `code-logic-review.md`; no commands for the reviewer). One fix round, then one scoped re-review.
5. "After" screenshots (dark + light): visual-reviewer, same surfaces as `visual-before.md` (webview in headless
   Chromium + Electron). Before an Electron launch: `ListAgents`, send "Electron: 705 launching" to each peer,
   and "Electron: free" after. Show the screenshots to the user.
6. Team-leader Mode 3 (pr-body.md, task.md status, commit task-folder docs), then ONE background command:
   `git push -u origin refactor/remove-single-layout && gh pr create --base main --head refactor/remove-single-layout --title "refactor(chat,core): remove the tab bar and the single layout" --body-file .ptah/specs/TASK_2026_705_9d53/pr-body.md`
   PR body follow-ups: no-SESSION_CONTEXT fallbacks (`parity-inventory.md:114`), `SESSION_WORKFLOW_ADDONS` token
   and `workflowAddonsFor`, the pre-existing webview lint cycle. Note: merge after #771. Report the link.

## Rules

- CLAUDE.md: worktree only; scoped checks with `-p` and `--parallel=1`; Jest `--maxWorkers=2`; one heavy check at a
  time; never workspace-wide/serve/e2e/package; commit in the foreground; push + `gh pr create` as ONE background command.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)". Read `.commitlintrc.json` (subject ≤ 72, body ≤ 100).
- Lanes (2026-10-19 ~17:00 UTC): codex confirmed room (Weekly 53%); Glm (ptahCliId
  `pc-355b645d-35af-4974-84cf-9cf961ea0164`) worked, limits unknown; opencode Monthly 93%. Run `ptah_agent_list` first.
- Never merge to main. Never edit chat-transcript.*, message-bubble.*, chat-input.component.ts.

## Key files

- PR 2 task folder: `batches.md` (Batch 4 section + rules), `implementation-plan.md`, `parity-inventory.md`,
  `decisions.md` (rows 1-9), `batch-1/2/3-report.md`, `visual-before.md`, `screenshots/before/`.
- PR 1 task folder (closed): `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\.ptah\specs\TASK_2026_699_833e\` — `pr-body.md`, `decisions.md` rows 20-23.
- Timeout fix: `D:\projects\ptah-extension\.claude-worktrees\plan-limits-rpc-timeout\.ptah\specs\TASK_2026_704_8918\rpc-timeout-investigation.md`.
