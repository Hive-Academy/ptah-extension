# Handoff — TASK_2026_685_64f4 (agent message unification), session 3

Written 2026-10-19 by the orchestrator session that continued from the session-2 handoff
(commit 13c0c2624). Read this first. `batches.md`, `implementation-plan.md` and `reports/` in this
folder hold the full history.

## 0. Goal

Sub-agent and CLI-agent lanes render their messages the same way as the main agent (one execution
header, one execution stream per agent, one `SubagentExecutionStore`). Phases A (A1-A4) and B
(B1-B7, includes TASK_2026_633) of `implementation-plan.md`. Ship as PR #751.

## 1. State: all implementation is done

| PR                                 | Branch / worktree                                                            | State                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #751 685                           | `feat/lane-execution-stream`, `.claude-worktrees/lane-execution-stream`      | **Ready for review** (not draft). Body updated (batches, review verdicts, user decisions, test plan). All batches done. Waits for the user's review/merge. |
| #767 chat column width             | (removed)                                                                    | **Merged by the user.** Worktree, junction and local branch removed.                                                                                       |
| #761 CodeRabbit follow-ups of #750 | `fix/coderabbit-750-followups`, `.claude-worktrees/coderabbit-750-followups` | **Merged by the user.** Worktree still exists (has a node_modules junction); remove only when the user says so.                                            |
| #752 / #748                        | worktrees `chat-layout-display-sheet`, `nav-session-motion`                  | Removed this session (user approved; junctions removed first; merged branches deleted).                                                                    |

No local-only branches. No running lanes or subagents from this session.

**CI on #751 is all green at 95f21c3fe** (18 pass, 3 skipped; merge state BLOCKED only for review).
CI fixes after the session-3 handoff (codex lanes, verified by the orchestrator):

- a2e768eb8 degradation-audit: `reported` suppression on two history catch sites (no baseline raise).
- ff8e21ddf, 7e86d14b4 e2e `task-337`: follows `ptah-subagent-lane`; identity on the tile, summary via
  `agent_progress` in the disclosure peek, tool count in the disclosure meta.
- 95f21c3fe product fix: `treeFor` built the selected sub-agent root at depth 0, so `collectTools`
  dropped parent-linked tools (lane tool row empty, tile `0 tools` = visual D1). Now nested depth +
  regression spec.
- Gap recorded (not fixed): the lane does not show `agent:summary-chunk` text
  (`follow-up-lane-input-and-stats.md` section 4).

## 2. Commits this session (#751, all pushed; last 0364cd6d9 + docs up to c862fef03)

- cb2a26f16 final combined fix round (B1, N1-N3, M1-M5) + orchestrator spec fallout
  (store mocks gained `revisionFor`/`entryFor`; `ms-1` on lane details `<dd>` because Prettier
  removed the space inside each `<dt>`).
- b6d86b710 B7a (inspector View transcript, tray `viewTranscript`, app-shell overlay, viewer service;
  previous-sessions spec reads `@defer` block index 1 now).
- 5a4932658 B7b + B7c (`canViewTranscript`, strip action, chat-ui viewer,
  `AgentMonitorStore.getSubagentTranscript`; stale spec mocks removed).
- 8fde7c7eb B6a (`subagent:transcript` registry, allowlist, schema, handler).
- d442593ec merge of origin/main (centered chat column bcffd40a5; canvas lane height fixes).
  canvas-lane-view: main's layout + `effectiveCanvasLaneKind`, this branch's store-backed
  `ptah-subagent-lane`; main's transcript fallback and `agentNode` dropped.
- 02419881c B6b (dispatcher `getSubagentTranscript`/`normalizeTranscript`/`renderMessageText`, shared
  transcript types). `SubagentTranscriptProbe` stays (Risk 11); baseline entry stays (P4).
- docs: reports, reviews, `follow-up-lane-input-and-stats.md`.

## 3. Reviews (all in `reports/`)

- `code-logic-review-final-fix-and-b5c.md`: NEEDS_REVISION, 0 Blocking, 2 Major, 5 Minor. User-approved
  last fix round, so report only. Major 1: bubble history error/Retry states never render (OnPush reads
  the same mutable entry from `entryFor`). Major 2: `retain()` reads `agentMonitorStore.subagents()`
  tracked inside component effects (release/retain churn can abort a history load).
- `code-logic-review-removals.md`: APPROVED 9/10, 3 Minor (stale doc comment
  `background-agent-strip.component.ts:139`; dead `TrayAgentContext.agentId`
  `session-agent-tray.ts:28`; harmless negative assertion `inline-agent-bubble.component.spec.ts:180`).
- `visual-review-final.md`: NEEDS_REVISION 6/10 (D1 tile `0 tools` FIXED in 95f21c3fe; D2 restored lane loses header facts;
  D3 `out N` low contrast in light; D4-D6 moderate). Agent monitor panel and A3 CLI lane not captured.
- `visual-review-removals.md`: canvas lane heights OK; strip/inspector row menus not captured (need a
  running agent; by source only Steer / Send to background / Stop remain); chat column defects fixed by #767.

## 4. User decisions this session

- Webview initial budget stays at 4 MB (not back to 3.75 MB).
- Remove worktrees `chat-layout-display-sheet` and `nav-session-motion` (done).
- Lane message input + shared lane stats header: **separate PR after #751**. A message to a finished
  sub-agent routes through the main agent as a follow-up; CLI lanes use `agent:continue`. Recorded with
  all open defects in `follow-up-lane-input-and-stats.md`.
- Chat column width: user bubble, turn content and composer share one width (done in #767).
- Inspector-dock task (session stats panel as a resizable side dock with a vertical rail tab): the user
  starts it in its own session (peer `session-stats-tile` is running it). Not this task's work.

## 5. Next steps (in order)

1. Wait for the user's review of #751 and #767. Fix only what the user or CodeRabbit raises, in the
   matching worktree. For #751, a merge conflict with main is likely in
   `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (+ spec) if main changes it
   again; resolve as in d442593ec.
2. After the user merges: remove worktrees only when the user says so (remove the node_modules junction
   first with PowerShell `[System.IO.Directory]::Delete('<wt>\node_modules', $false)`, then
   `git worktree remove`).
3. Then the follow-up task (new worktree from main, new branch, new PR):
   `follow-up-lane-input-and-stats.md`.

Verification commands (memory-safe; one at a time; confirm the "N projects" header):

```bash
# in .claude-worktrees/lane-execution-stream
npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/canvas --parallel=1
npx nx run-many -t typecheck -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/canvas --parallel=1
npx nx run-many -t lint -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/canvas --parallel=1
# DI guard specs (after any RPC change)
npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2
npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-extension-vscode/src/di/surface-composition.spec.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2
npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/rpc-surface.spec.ts apps/ptah-electron/src/di/surface-composition.spec.ts apps/ptah-electron/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2
npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/surface-composition.spec.ts --coverage=false --maxWorkers=2
# in .claude-worktrees/chat-column-alignment
npx nx test @ptah-extension/chat --parallel=1   # one known flaky CompactSessionCardComponent case under load; passes alone
```

## 6. Key files

- Store: `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts` (+ `subagent-execution-{ownership,retention,history-merge}.ts`).
- Lane: `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts`.
- Bubble / tile: `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts`, `subagent-tile.component.ts`.
- Canvas: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`.
- History RPC: `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts` (`subagent:history-page`).
- #767: `chat-transcript.component.css` (host container, column `calc(100cqw - 1.5rem)`),
  `message-bubble.component.{html,css}` (`.cs-user-chat`, `.cs-user-bubble`).

## 7. Lessons and binding rules

- Electron slot protocol: announce `Electron: <task> launching` to every peer (ListAgents) before a dev
  launch, `Electron: free` after. Build in the worktree: `npx nx run ptah-electron:build-dev`, then
  `npx nx run ptah-electron:copy-renderer-dev`; launch
  `node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9370` in the background; Playwright
  `connectOverCDP`, never `browser.close()`. The app may open on another page (Voice): click the "Chat"
  tab at 1440 width first. After a renderer-only change, `copy-renderer-dev` + page reload is enough.
- **Never move a worktree `node_modules` folder across drives** (D: to C:). It contained a junction to
  the main `node_modules/marked`; the cross-drive move deleted the real files (restored and verified
  against `npm pack marked@18.0.13`). A worktree needs a junction:
  `New-Item -ItemType Junction -Path <wt>\node_modules -Target D:\projects\ptah-extension\node_modules`.
- Prettier on Angular inline templates removes significant spaces inside `<dt>`/inline elements; check
  rendered text after formatting.
- In Chromium, `scrollbar-color` on an element disables its `::-webkit-scrollbar` styles; the gutter is
  the platform width.
- Rules: CLAUDE.md memory-safe checks; implementers are codex lanes (`ptah_agent_list` first, agent-lanes
  skill), reviewers Claude subagents; lanes never commit or run checks; never commit/push while a lane
  edits; Prettier on changed files; commit in the foreground, push + gh as one background command;
  commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, PR bodies with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; never bare `git stash`; ask the user
  only about removals, scope changes or irreversible actions; end each turn with done / left / every
  local-only branch.
