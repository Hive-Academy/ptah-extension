# TASK_2026_685_64f4 — one execution header for CLI lanes and subagents

## User request (2026-10-16)
"Unify the header for the CLI agent and subagent executions. Currently they show something different,
which is confusing and does not fit the overall design we are trying to reach." The user wants a
visual proof of how it looks first, then a quick prototype, before any implementation. Also: "do we
show these icons and details already, so we might just delete them to be like the main chat?"

Example (CLI lane, codex, in the Canvas dock): a green `completed` badge; a play icon and `71h 18m`
on the right; a mono row `ctx —  in ≥ 11.9k  out ≥ 56` with `—` (cost) at the right; a row
`Task` / `Parent: 18e50e43…`; then the content (`pong`).

## Current state (main @ 6c0490f1f)
`canvas-lane-view.component.ts` renders a CLI lane at :107 and a subagent at :144-171.

| Piece | CLI lane (`ptah-agent-card`, `presentation="flat"`) | SDK subagent (`ptah-subagent-usage-summary` + `ptah-execution-node` → `ptah-inline-agent-bubble`) |
| --- | --- | --- |
| Status | `agent-card-header.component.ts:75-85`, raw word (`completed`) | No badge in the summary. Bubble header: chevron, avatar, name, badges (`inline-agent-bubble.component.ts:142-185`); status row with stop/background/transcript/message controls (:192-264) |
| Resume + duration | Resume button when not running and a `cliSessionId` exists (`agent-card-header:125-140`); duration via `formatElapsed` (:143-148, `agent-card.component.ts:157-164`) | No resume. Duration only in the footer `ptah-duration-badge` after streaming (`inline-agent-bubble:519-521`) |
| Usage | `cli-lane-usage-summary.component.ts:27-39`: ctx, in, out, cost; `≥` when rebuilt from segments (:76, :86-88) | `subagent-usage-summary.component.ts:46-106`: ctx, warm/cold, cache read/write, out, cost; no `in` |
| Task / Parent | `agent-card.component.ts:78-105` (collapsed `<details>`, Parent at :86-93) | Task text as `agentDescription` in the bubble header (:131-138, :420-433); no parent |

Wording differs (`completed` here vs `done` in the tab and inspector) and the two use different duration
formatters (`formatElapsed` vs `formatAgentDuration` in `dock-overflow.ts:93-104`).

## Already shown elsewhere (deletion candidates)

| Piece | Already shown in | Proposal (needs user approval for each removal) |
| --- | --- | --- |
| Status badge | Tab chip (`canvas-lane-tabs.component.ts:124-128`, `cliLaneStatusWord` in `chat-ui/.../agent-avatar/agent-status.ts:18-27`), avatar, hover card (`agent-dock-card.component.ts:48-54`), inspector (`inspector-agents-section.component.ts:171-173`) | Delete |
| Duration | Tab chip (`canvas-lane-tabs:129-133`), hover card (:51-53), inspector (:174-176, :205-207) | Delete from the header; one formatter app-wide |
| Resume (CLI) | Nowhere else | Keep; move to one shared action place |
| Subagent controls (stop, background, transcript, message) | Nowhere else | Keep; same shared action place |
| ctx / in / out breakdown | Inspector shows only totals (:189-204) | Move behind a disclosure (main chat activity panel model) |
| Parent ID | Nowhere else | Delete or move into the disclosure |
| Subagent bubble header (avatar, name) and footer tokens/cost | Tab chip, inspector | Delete |

Main chat model for comparison: an assistant turn shows one disclosure row "Worked for X" plus tool/file
counts (`turn-facts.utils.ts:233-255`, `message-bubble.component.html:12-25`); tokens, cost and duration
live in the opt-in activity panel (`message-bubble.component.html:125-150`,
`turn-activity-panel.component.ts:215-249`).

## Suspected bug (verify first)
`71h 18m` for a `pong` task. The card computes `completedAt - startedAt` from the agent store; the tab
chip computes the span from the roster's `startedAt`/`endedAt` with another formatter. The two can
disagree. Also `ctx —` because `usageTotals` is null for that lane (partial segment fallback).

## Likely files
- `libs/frontend/chat/src/lib/components/molecules/agent-card/` (`agent-card`, `agent-card-header`,
  `cli-lane-usage-summary`, `subagent-usage-summary`, `agent-card.utils.ts`, `stats-bar.utils.ts`)
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`, `dock-overflow.ts`
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts`
- `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-status.ts`
- matching specs

## Ordering and conflicts
- Visual proof (Electron screenshots, dark + light, a CLI lane and a subagent lane) and a static HTML
  prototype in this folder: no source change, can start now. Announce the Electron slot.
- Implementation after PR #739 merges (it changes `cli-lane-usage-summary`,
  `inspector-agents-section`, `canvas-lane-tabs`) and coordinated with TASK_2026_683 B6
  (`canvas-lane-view.component.ts`), or B6 rebases.

## Acceptance (draft)
- One header structure for both lane kinds, matching the main chat model.
- No information or action lost without user approval (preserve list above).
- One status word and one duration formatter across tab chip, hover card, inspector and lane view.
- Dark + light screenshots, before/after, at 1440 and 760.
- (User decision 2026-10-17) CLI lanes and subagents show the same real-time message stream with
  the same renderer as the main agent (`ExecutionNode` tree, `ptah-execution-node`). A subagent
  keeps its own independent execution tree, outside the main orchestration tree (memory and
  resource decision). "View transcript", the saved-transcript fallback and the
  `subagent:transcript` overlay path are removed. Details: `visual-proof.md` "User decision".
