# Batch 1 fix round — height and centering

## Fixes

| Issue | Change | Evidence |
| --- | --- | --- |
| Failing jsdom geometry spec | The session layout now exposes its bounded flex contract through static host classes. The spec asserts those classes instead of asking jsdom to compute component CSS. The passing projection test remains intact. | `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.ts:6`; `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.spec.ts:54-66` |
| Lost comments | Restored the exact HEAD comments above `DOCK_KEY_STEP` and `SessionBudgetActionsService`. | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:182,235` |
| Scrollbar offset | Added `scrollbar-gutter: stable both-edges` to the existing transcript scroller. Equal reserved gutters keep the transcript column centered on the same axis as the composer when the scrollbar appears. | `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css:43` |
| Composer menu clipping | Removed the three Batch 1 `overflow-hidden` rules from the main chat column, projected transcript wrapper and session layout host. Their `min-h-0` flex bounds remain; the transcript scroller still owns vertical scrolling and clips its own content. | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:5,100`; `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.ts:6-17` |

## Popover audit

All rows are based on source inspection. The panels are DOM descendants of the composer, with no portal or browser top layer. Floating UI sets `position: fixed` for these panels (`libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:152-153`); the suggestion panel begins as absolute and is changed to fixed by the same service. A fixed panel can still be clipped when a transformed ancestor establishes its containing block, so removing the three new clipping rules is the conservative cross-host choice.

| Composer UI | Implementation | Top layer? | Result of Batch 1 fix |
| --- | --- | --- | --- |
| Model picker | `model-selector.component.ts` uses `NativeDropdownComponent`; its panel is rendered in place (`native-dropdown.component.ts:85-88`). | No | The three new clipping ancestors are gone. |
| Effort picker | `effort-selector.component.ts` uses `NativeDropdownComponent`. | No | Same. |
| Autopilot menu | `autopilot-popover.component.ts` uses `NativeDropdownComponent`. | No | Same. |
| MCP chip popover | `mcp-status-chip.component.ts:25-41` uses `NativePopoverComponent`; its panel is rendered in place (`native-popover.component.ts:100-105`). | No | Same. |
| Attach menu | `chat-input.component.ts:365-418` uses `NativePopoverComponent`. | No | Same. |
| Slash and @ suggestions | `chat-input.component.ts:347-357` creates `UnifiedSuggestionsDropdownComponent`; its panel is rendered in place (`unified-suggestions-dropdown.component.ts:57-63,174-176`). | No | Same. |

The source path is shared by Electron, VS Code and Canvas. This is a source audit, not a rendered check in those hosts. The orchestrator should open each menu near the top and side edges of the composer in each host, and confirm the panel is fully visible. In normal chat, measure the transcript scroller's `clientWidth`, `scrollWidth`, `scrollHeight`, `clientHeight`, `overflowY` and `scrollbarGutter`; compare the horizontal centers of `.chat-scroll-content` and `.chat-composer-column` with a long transcript at 760px and 1440px. Confirm the composer remains at the bottom and no ancestor becomes a second vertical scroller.

## Line counts and verification

`chat-view.component.ts`: HEAD 2080, after fix 2082 physical lines. The two restored comments account for the increase. The only Batch 1 additions to that file are the import and component registration, each one line; removing either would break the layout, and merging unrelated imports or entries would damage formatting. `chat-transcript.component.ts` was untouched. No tests, typecheck, lint or build were run, per the fix-round instruction. Static source checks confirmed the replacement host classes, gutter rule and restored comments.

## Decisions

- **Host classes for the geometry spec.** Options: assert stylesheet text or assert host classes. Static classes make the bounded flex contract visible to jsdom and keep the test independent of stylesheet injection. Reversible.
- **No overflow on the three new outer containers.** Options: retain `overflow-hidden`, use `overflow: clip`, or rely on `min-h-0` bounds. The composer panels are in-place descendants and not top-layer elements; `min-h-0` already bounds the flex children, while the transcript scroller has its own overflow. Reversible.
- **Symmetric scrollbar gutter.** Options: one-sided `stable` or `stable both-edges`. The one-sided gutter would still move the transcript center relative to the composer; symmetric gutters reserve equal space. Reversible.
- **Report the 2-line increase.** Options: compress unrelated code to preserve a numeric line count or restore the exact comments with normal formatting. The review explicitly asked for the exact comments; the latter preserves readability. Reversible.
