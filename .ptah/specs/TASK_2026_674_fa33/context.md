# Context — nested subagent live tail lost after resync

Source: PR #727 (TASK_2026_655_5c1e), review `code-logic-review-F-r3.md`, defect 1 (serious).

## Problem

The resync repair in `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
(about lines 334-394) picks the first seed `agent_start` whose `parentToolUseId` is a history tool.
It then takes that tool's own `message_start` as the owner O and requires O to be a row in
`tab.messages`.

The history builder does not emit a row for a `message_start` that has `parentToolUseId`
(`history-message-builder.service.ts:167`). When the Task sits inside another subagent, O is
not a top-level row. The repair logs
`[SessionHistoryReplayer] seeded subagent history owner not found` and installs no live root.
`finalizeSessionHistory` has already cleared `streamingState`. `closeFence` applies the seed to
an empty state. `execution-tree-builder.service.ts:319` skips the parented `message_start`, so
the transcript paints nothing from the seed.

The same `find` only handles one owner. When a seed holds `agent_start` events under two
different top-level messages, the second owner's later deltas also land without a root.

## Reproduction

History: root `message_start` (`root`), Task `toolu_outer` on `root`, subagent `message_start`
(`sub`, `parentToolUseId: toolu_outer`), Task `toolu_inner` on `sub`. Live seed: `agent_start`
with `parentToolUseId: toolu_inner` plus its `text_delta`. Switch workspace away and back while
the inner subagent streams. Expected: the inner delta shows under the outer Task. Actual: the
outer Task stays the frozen history snapshot. The full text only appears after the turn ends.

TASK_2026_629's single-subagent view (`findSubagent` in `chat-transcript.component.ts`) shows
the same frozen node, so the defect is more visible after 629 merges.

## Suggested fix

Walk `parentToolUseId` up to the root `message_start` that history materialized as a row.
Collect every seed `agent_start` whose parent tool is in that root's tool closure, and handle
more than one root owner. Keep the warn-and-leave-seed path only when no materialized root
contains the tool.

## Acceptance

- A spec beside `session-loader.resync-live-seed.spec.ts` (A-2) builds the nested history above
  and asserts at the transcript level with the real tree builder: the inner delta renders once.
- A two-owner seed renders both live tails, each once.
- The existing A-2 and owner-missing specs still pass.
- Checks: `npx nx test @ptah-extension/chat --parallel=1`, typecheck, lint (scoped, serial).

## Scope extension (user, 2026-10-16): carrier for 675, 676 and the TASK_2026_681 leftovers

Worktree `.claude-worktrees/chat-transcript-followups`, branch `fix/chat-transcript-followups` (from `main` @ 6c0490f1f).
TASK_2026_675_b720 and TASK_2026_676_a876 ship in the same branch (same replayer block). The open
items recorded in PR #737 / #738 (TASK_2026_681_738f) move here (sources:
`../TASK_2026_681_738f/visual-review-final.md`, `visual-review-dock-border.md`, `visual-review-11-17.md`,
`code-logic-review-visual-fixes-r2.md`):

| # | Leftover | Source |
| --- | --- | --- |
| L1 | Light theme: lane usage row (`cli-lane-usage-summary`, 10 px mono) contrast 1.74-3.44:1 vs page (Serious, pre-existing) | visual-review-final Serious 1 |
| L2 | Compact card in Canvas repeats the title, the status (3x) and the Full view toggle that the Canvas focus header shows | visual-review-11-17 Moderate 3 |
| L3 | 760 px: details opener in the pane-side strip is a circled Unicode `i`, not a lucide icon button; the dock hover card stays open after pointer-away | visual-review-final Moderate 1, Minor 3; dock-border Minor 2 |
| L4 | 400 px: page overflows horizontally (document 723 px), top nav and New Session clipped | visual-review-final Moderate 2 |
| L5 | Inspector partial token badge aria-label uses the raw number (`at least 11956`) vs visible `≥ 12.0k`; no inspector spec for "usageTotals null and no usage segments" | r2 minor m1, m3 |
| L6 | e2e showcase scenes still use `.tile-header` / `Close tile` | 681 HANDOFF |
| L7 | ~130 kB eager bundle growth vs 3.49 MB unexplained: source-map analysis | 681 HANDOFF |

Not taken: light-theme dock border 1.32:1 (decorative, the shadow marks the edge).
