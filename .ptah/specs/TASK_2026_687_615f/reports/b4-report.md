# B4 implementation report

| Item | Change | Regression spec |
| --- | --- | --- |
| E M-5 | `command-overlay.component.ts:186` releases a pin when its label leaves `visibleLabelIds` and emits `focusWorkListRow`. | `command-overlay.component.spec.ts`: pin, hide, focus output. |
| E M-6 / F-8; visual root placement | `scene-layout.ts:346` searches fixed rings near each sphere (maximum 452 candidates per label) instead of scanning the viewport. `command-scene-renderer.ts:227` draws a leader if the root plate must sit farther away. `command-scene.component.ts:140` memoizes geometry so theme and motion updates reuse it. | `scene-layout.spec.ts`: dense 24-node scenes at 900, 1440 and 1600 px, root distance and sphere keep-outs; candidate limit. |
| Visual chip | `command-scene-renderer.ts:299` removes the canvas square; `command-scene.component.ts:84` keeps the DOM pill in the upper right, clear of lower scene hints. | `command-scene-renderer.spec.ts`, `command-scene.component.spec.ts`. |
| Visual input and focus | `command-pending-input.component.ts:118` uses stronger light border and placeholder tokens with the prior dark treatment; pending controls, overlay and work list use `focus-visible:outline-base-content`. | `command-pending-input.component.spec.ts`, `command-overlay.component.spec.ts`, `command-work-list.component.spec.ts`. |
| Electron tabs | `electron-shell.component.ts:106` hides the scrollbar; `:112` uses icon-only tabs below 900 px with full accessible labels; `:177` adds Mic; `:483` scrolls the active tab into view. | `electron-shell.command-center-tab.spec.ts`: icon, labels, seven keyboard-reachable tabs. |
| Setup hub | `setup-hub.component.ts:798` handles Space, prevents scrolling and opens Command Center. | `setup-hub.component.spec.ts`: Space action and default prevention. |

## Files changed

- `libs/frontend/command-center/src/lib/scene/scene-layout.ts`, `scene-layout.spec.ts`, `command-scene-renderer.ts`, `command-scene-renderer.spec.ts`, `command-scene.component.ts`, `command-scene.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay.component.ts`, `command-overlay.component.spec.ts`, `command-pending-input.component.ts`, `command-pending-input.component.spec.ts`, `command-work-list.component.ts`, `command-work-list.component.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`, `electron-shell.command-center-tab.spec.ts`
- `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`, `setup-hub.component.spec.ts`
- `.ptah/specs/TASK_2026_687_615f/reports/b4-report.md`

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use fixed rings and a hard candidate cap for all labels. | Viewport grid / bounded rings. | The grid in `scene-layout.ts` scanned the full viewport for the root; the plan requires nearest placement with bounded work. | Yes. |
| Keep selected-ID changes as a geometry dependency. | Recompute for selection / freeze geometry. | `layoutScene` prioritizes the selected plate, so selection can change which labels fit. Theme and motion changes now reuse the computed layout. | Yes. |
| Put overflow at the upper right. | Lower right / upper right. | The old chip was at the lower edge near scene hints; the chip remains a single DOM pill. | Yes. |
| Hide the scrollbar and collapse tab text under 900 px. | Stable gutter / hidden scrollbar; scroll / icon-only. | The strip must keep all seven tabs usable between 800 and 900 px. Buttons retain `aria-label`, title and native keyboard activation. | Yes. |

## Verification and remaining work

- No Nx, Jest, TypeScript compiler, build or visual run was started, per the wave's memory-safe rule. Scoped `ptah_get_diagnostics` was called once for the 14 changed TypeScript files; its TypeScript service timed out after 45 seconds and returned **unchecked**, with no diagnostic verdict.
- Electron dark/light screenshots, contrast measurement (at least 3:1) and interactive visual acceptance remain for the orchestrator's sequential check. The narrow CSS and active-scroll behavior have DOM assertions but no rendered viewport test in this lane.
