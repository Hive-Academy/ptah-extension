# Batch B — agent dock

## Files changed

- `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.spec.ts` (created)

## Behavior

The pure planner now limits the total chip count to five, including selection, for finite and unknown widths. An unmeasured or non-finite width permits one chip; a measured width too small for the selected pill and overflow trigger permits zero. It partitions the entire roster and renders running agents first across kinds, with the selected non-running agent as the sole ordering exception. A selected running agent retains a slot in its normal running position. Frozen keyboard order goes through the same cap and shrinks on resize. The component renders the planner's flat list, uses a roving tab stop, moves focus without selecting on ArrowLeft/ArrowRight/Home/End, releases freeze when focus leaves the dock, and moves focus to overflow if resize hides the focused chip. Overflow shows `+N`, every hidden agent's status and duration, and a selected marker; selection and Escape close it and restore trigger focus.

## Tests added or updated

- Pure planner: 0/1/5/6/20 agents, unknown/narrow/wide widths, selected running and non-running order, stable hidden partition, freeze and resize, menu ordering.
- Rendered component: first paint and absent `ResizeObserver`, measured resize including zero width, mixed kinds/statuses, visual keyboard order and focus-only movement, focused waiting/failed updates and freeze release, overflow focus recovery, hidden selection close, rail cap, hover card.
- Menu component: count, every hidden status and duration including finished, selected marker, pointer and keyboard selection, Arrow/Home/End, Escape, `aria-expanded` and focus return.

## Verification

Ran **once** in the foreground: `npm run verify -- -p @ptah-extension/canvas`. It waited for the shared lock, then exited 1: lint succeeded; tests reported 512 passed and 5 failed across 28 suites; typecheck failed in another batch's file. The batch B hover test timed out because it enabled fake timers before Angular settled; I moved fake-timer setup after `whenStable()`. The required once-only verify rule prevents a second run, so this fix is not rerun.

Remaining failures outside this batch's owned files:

- `dock-overflow-duration.spec.ts` has three legacy expectations that capacity zero still renders one or five agents. The approved batch B contract requires zero chips when measured width cannot fit a chip and trigger. This spec was not on batch B's edit allowlist and needs reassignment/update.
- `canvas-rail-card.component.spec.ts` has one card-height failure in batch C's surface.
- `chat-ui/src/lib/atoms/agent-avatar/agent-avatar.component.ts:200-201` has a TS1005 syntax error in batch D's surface, blocking canvas typecheck.

All six edited TypeScript files parsed cleanly with `ptah_ast_analyze`. Scoped `ptah_get_diagnostics` remained unavailable after its 45-second compiler timeout. No rendered screenshot was possible without running a prohibited serve/build target. The named `angular-frontend-patterns` skill had no skill loader in this lane; repository conventions and the approved handoff governed the implementation.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Reserve a slot for a selected running agent but leave it in running roster order. | Promote it to first, or retain position. | Design spec requires selection priority and a selected running agent in its running sequence. | Yes |
| Keep a frozen chip list while focus remains anywhere inside the dock. | Release on pointer click, or on dock exit. | Revision 1 requires release when focus leaves the dock subtree. | Yes |

## Clarifications Needed

1. Assign the unowned `dock-overflow-duration.spec.ts` to a lane for its obsolete capacity-zero assertions; batch B's file allowlist excludes it. Recommended: have the integration owner update it to the approved zero-chip contract.
