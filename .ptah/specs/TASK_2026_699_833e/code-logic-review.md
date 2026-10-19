# Re-review of 069902dea

Review family: codex; implementer family: Claude  
Scope: code diff `069902dea^..069902dea`  
Score: **8/10**  
Verdict: **APPROVED** (0 Blocking, 0 Serious open)

## Prior findings

| Prior finding | Status | Evidence |
| --- | --- | --- |
| Moderate: fractional shell width exceeded the dock maximum and breached the 624 px chat floor | **closed** | `libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.ts:76-86,110-120` floors the effective maximum and clamps the rendered width to it; `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:3015-3023` covers the 960.5 px, 560 px preference case and both ARIA values. |
| Minor: drag cleanup erased pre-existing body cursor and selection styles | **closed** for a single drag | `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts:222-226,305-310` saves and restores prior inline values; `split-handle.component.spec.ts:261-276,568-571` checks prior values after completion, cancellation, and destruction. See new finding 1 for overlapping drags. |

## New findings

1. **Minor — Overlapping handles restore body styles out of order.** `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts:222-226,305-310`: handle A saves the original style and starts; B saves A's cursor and starts; A ends first and restores the original while B remains active; B then ends and leaves A's drag cursor on the body. Pointer IDs are independent, so two simultaneous pointer drags can take this path. A shared ownership/stack mechanism would prevent the stale cursor and `userSelect`. The new tests cover one handle at a time (`split-handle.component.spec.ts:261-276`). This is a residual edge case, not a Blocking or Serious issue.

## Scope checks

- The tab is `Stats`, uses `side="left"`, and sits between main and dock inside `.cs-shell` (`chat-view.component.html:2,283-305,310-365`). Its visible active line is on its right edge (`libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts:63-69`).
- `INSPECTOR_TAB_WIDTH = 32` (`inspector-dock.controller.ts:16-22`) is reserved at attach (`chat-view.component.ts:1003-1011`) and subtracted before band choice and maximum calculation (`inspector-shell.controller.ts:408-413`). Thus raw widths 991 and 992 map to available widths 959 (sheet) and 960 (docked); at the latter, dock max is 336 and chat keeps 624. Specs cover both (`chat-view.component.spec.ts:3025-3035`). Fractional maxima are floored, so rendered dock width and `aria-valuenow` remain at or below `aria-valuemax` (`inspector-shell.controller.ts:76-86,110-120`; `chat-view.component.html:320-322`).
- The open sheet still gets a scrim and dialog presentation (`chat-view.component.html:331-355`); the tab floats immediately left of the sheet, becomes inert, and the full sheet leaves 32 px for it (`chat-view.component.css:52-86`; `chat-view.component.html:297-302`). Specs cover sheet and full-sheet states (`chat-view.component.spec.ts:3156-3185`).
- The tab button is passed as opener (`inspector-dock.controller.ts:120-126`), and the close path restores focus to it (`inspector-shell.controller.ts:339-350,448-465`; `chat-view.component.spec.ts:3187-3205`). Its accessible name reflects `Stats` and `aria-expanded` reflects open state (`sidebar-tab.component.ts:58-60,145-149`). The header toggle retains `aria-controls="inspector"` (`chat-view.component.html:32-36`; `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts:177`).
- `hostsInspector()` excludes bare embeds, tiles, and compact cards (`chat-view.component.ts:1105-1115`); the tab and dock are conditional on it (`chat-view.component.html:289-290,310,331`).

The orchestrator reported passing typecheck, test, and lint for both changed projects. No additional checks were run in this read-only re-review. The sheet checks above are code and unit-spec evidence, not a browser visual inspection.
