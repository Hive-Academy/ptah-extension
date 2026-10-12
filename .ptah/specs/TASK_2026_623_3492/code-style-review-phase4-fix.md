## Phase 4 style re-review — Batch 21F

**Score: 9/10** — the single-purpose fix restores the documented lazy/eager public boundary without adding an alternate API, new coupling, or maintenance surface. This is above the 7–8 band because the entry now has one clear import role and matches the closest lazy entries. It is not a 10 because this narrow review cannot establish the later Batch 23 main-barrel wiring or build-output closure; those are intentionally outside this diff.

Scope examined: `git diff 5f356dc96..b57910d88 -- libs/frontend/chat-ui/src/ptah-ui.ts`; the prior Phase 4 style review; decisions #59, #60, #73, #76, and #92; lazy siblings `src/change-set-card.ts` and `src/mermaid.ts`; and a source scan of `libs` and `apps` for `@ptah-extension/chat-ui/ptah-ui` and dock symbols. Per the memory-safe instructions, no build, test, typecheck, lint, Nx, or Jest command was run.

## Serious finding status

**CLOSED.** The prior Serious finding at `libs/frontend/chat-ui/src/ptah-ui.ts:25-31` is fixed. The diff removes the exports of `PTAH_UI_DISPLAY_DOCK`, `displayFenceKey`, `PtahUiDisplayDock`, `PtahUiDisplayFenceState`, and `PtahUiDisplayFenceStatus`. The entry now retains only the lazy renderer/chip/block surface at `ptah-ui.ts:24-30`, consistent with the lazy-only sibling entries. This satisfies decision #92 and preserves the main-barrel-only future path required by decisions #59, #60, #73, and #76.

The corrected header is accurate: `ptah-ui.ts:17-22` identifies the dock file as eager-light, says it is deliberately not exported here, and explains why an eager provider must use the main-barrel route. The scan found no consumer importing any dock symbol through `@ptah-extension/chat-ui/ptah-ui`; its remaining consumer imports are `PtahUiMessageTextComponent` or `PtahUiBlockComponent` only. No TODO, PLACEHOLDER, or STUB marker exists in the changed file.

## Blocking

None.

## Serious

None.

## Moderate

None.

## Minor

None.

## Five style questions

1. **What breaks when requirements change in six months?** Nothing new in this diff: `ptah-ui.ts:17-22` directs eager integration to the planned main-barrel route, so a future consumer does not acquire a lazy secondary-entry shortcut.
2. **What would a new team member misread here?** The revised comment and absence of dock exports at `ptah-ui.ts:17-30` give the same answer: this entry is for lazy UI surface only.
3. **What does this cost to maintain that a simpler shape would not?** No additional cost: the fix deletes the duplicate public route and keeps one source of truth for the future eager port export.
4. **Where is this inconsistent with how the same problem is solved elsewhere in the repo?** It is consistent: `change-set-card.ts:12-17` and `mermaid.ts:1-2` expose lazy component surfaces only.
5. **What would you have done differently, and why is that better rather than merely other?** Nothing within this scoped diff. Deleting the re-export block is the minimal change mandated by decision #92; adding an alternative export or compatibility layer would reintroduce the ambiguity the fix removes.

VERDICT: APPROVED

