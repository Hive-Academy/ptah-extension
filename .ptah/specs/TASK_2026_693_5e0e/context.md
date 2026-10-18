# TASK_2026_693_5e0e — TASK_2026_679 follow-ups FU-12..FU-16

Source: `TASK_2026_679_45ff/decisions.md` D97 (also D90, D95). PR #745 merged as `e2e9c1e5b`.

- Type BUGFIX, depth Partial. Worktree `.claude-worktrees/session-followups`, branch
  `fix/session-followups`.
- Implementers: Claude subagents (`backend-developer` FU-13, `frontend-developer` FU-12/14/16).
- Reviewer: codex lane (different model family). One fix round, then one re-review.
- Out of scope: FU-10 (TASK_2026_687_615f, D90).

## Items

- FU-12: Rename popover in `canvas-rail-card.component.ts` (NativePopover) clips at 400 px
  width when Workspaces is open.
- FU-13: `session-rpc.handlers.ts:485` sends `messageCount: 0`; "N msgs" never shows.
- FU-14: `canvas-rail-board.component.ts:393-395` one `lostpointercapture` releases all
  pointers. Missing specs: visibilitychange, lostpointercapture, Tab-from-outside, destroy.
- FU-16: `session-list-row` current-row accent shows only at the corners during inline edit.
- FU-15: Electron visual re-check (dark + light) of `256fb7d15` + FU-12 + FU-16. Needs USER
  approval of a build pair.

## Decisions

| ID | Decision |
| -- | -------- |
| D1 | Agents do not run checks. The orchestrator runs every gate, one at a time (CLAUDE.md). |
| D2 | First gates green: canvas, chat, rpc-handlers typecheck + lint + test. |
| D3 | Codex review REVISE 6/10 (`reviews/code-review.md`). One fix round: session:list returns cached counts only and warms in the background (miss = 0, label hidden); board cleanup clears `holdTabId`; agent-sdk exports `isHiddenTranscriptRecord` + new `isSkillOrMetaText`, copies deleted. |
| D4 | Fix-round gates green: agent-sdk, rpc-handlers, canvas. One agent-sdk test (`SubagentHandoffIndex`, not in the diff) failed under load and passed alone (22/22): flaky, not fixed here. |
| D5 | Codex re-review REVISE 6/10 (`reviews/code-rereview.md`): 2 Serious in the FU-13 counter (cold warm never reaches the open list; stalled reads starve the 4 slots). Canvas + SDK fixes accepted. FU-12/14/16 committed `1d8ef9d1e`. |
| D6 | USER (AskUserQuestion 2026-10-18): one extra FU-13 fix round (abort timeout, bounded queue, one list refresh after warms) + one more codex re-review. USER approved the FU-15 build pair and one Electron slot. |
| D7 | Build pair done (exit 0). First launch (port 9361, NODE_ENV=development, userData set in `dist/apps/ptah-electron/fu15-launch.mjs`) stopped before any window, because task-692 already held Electron on 9335. `ptah.sqlite` and `secrets.json` unchanged; the `Ptah Dev` folder mtime changed (no newer entry, so a create+delete). Next launch also passes `--user-data-dir=<private copy>`. Queue: 692 → 693 → 685. |
| D8 | Extra round gates green (rpc-handlers; one spec assertion updated by the orchestrator for the new `signal` option). Final codex re-review REVISE 7/10 (`reviews/code-rereview-2.md`): 1 Serious. USER (AskUserQuestion): commit FU-13 and record it as FU-17, no more rounds. |
| D9 | Pushed `1d8ef9d1e` + `64bfca9e9`; PR #754 opened (not a draft). USER: FU-17 is rare (69+ cold rows, label only), mark the PR ready. FU-15 still waits for a free Electron slot. |

## Open follow-ups

- FU-17: `session-message-count.ts` `MAX_QUEUED_WARMS = 64` drops the earliest queued warms. A reload
  with 69+ cold rows (`session-loader.service.ts:524-533` reloads `max(10, offset)` rows) repeats the same
  order, so those rows keep `messageCount: 0`. Fix: keep the top rows of the page, drop the tail, and skip
  rows whose cache entry is fresh. Evidence: `reviews/code-rereview-2.md`.
