# Batch 1B — Aurora, popover, single-chat

## Files changed

- Added `libs/frontend/ui/src/lib/native/aurora/aurora-effect.component.ts`, `.spec.ts`, and `index.ts`.
- Updated `libs/frontend/ui/src/lib/native/index.ts` with a star-only Aurora barrel export.
- Updated `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts` and `.spec.ts`.
- Updated `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts` and added `.spec.ts`.

## Public API for 2B/2C

`AuroraEffectComponent` selector: `ptah-aurora-effect`. Inputs: `variant = input<'board' | 'brand'>('board')`, `visible = input(true)`. `board` is 570px high at .24 opacity in dark theme and .33 in light; `brand` is 300px high at .14 opacity. It is decorative (`aria-hidden`, pointer inert). Gradients use `color-mix` of DaisyUI `--s` and `--b1`; a 60-second transform animation pauses when `visible` is false, offscreen, or the page is hidden. Reduced motion removes animation and live preference changes update paused state. The component releases its one observer and two listeners on destroy. The brand variant is mounted behind the single-chat logo; board mounting belongs to 2B.

`NativePopoverComponent` now accepts optional `anchor = input<HTMLElement | null>(null)`. When set before opening, positioning uses that element. When null, it uses the existing projected trigger. The existing open/close, focus and positioning fallback paths remain intact. 2C can pass the invoking hero or rail button through `[anchor]`.

The single-chat empty state retains its logo, tagline, prompt suggestions and footer; `showProjectSetup` still gates the shared Get ready card. No recent-session cards were added. The existing full-width/max-width containers and the card's narrow container styles support a 280px panel.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Shift the Aurora overlay with `transform` while keeping a static gradient layer. | Animate `background-position` as in the prototype; animate `transform`. | The plan permits a transform shift for CPU cost, and the task's runtime rule allows only compositor properties in perpetual animation. | Yes, CSS only. |
| Use one `IntersectionObserver` for the component host plus page visibility and media-query listeners. | Observer per stripe; one bounded observer per effect. | The plan requires offscreen, tab and reduced-motion handling and released resources. | Yes. |
| Keep the single-chat card under `showProjectSetup`. | Always show it; retain current gate. | Implementation plan and design spec explicitly retain the gate. | Yes. |

## Verification and remaining work

Added specs for theme-token CSS, reduced motion and live preference change, visibility and cleanup, both popover anchors, and single-chat content/conditional checklist/prompt output at a 280px fixture width. No Nx, Jest, TSC, build or visual command was run, per the lane's single-check-slot instruction. A scoped `ptah_get_diagnostics` call returned unavailable because its TypeScript check was still running after 45 seconds; it reported no checked files. The orchestrator should run the scoped ui/chat checks and visual contrast review. Aurora notice and packaging remain with batch 1C.
