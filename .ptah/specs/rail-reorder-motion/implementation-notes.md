# Implementation notes

## Files changed

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-flip.ts`: keyed FLIP measurement, paint-only playback, interruption cancellation, and reduced DOM API fallback.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-flip.spec.ts`: recreated-card/scroll-position and new-card/jsdom coverage.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts`: group keys, scroll-container marker, pre-refresh capture effect, after-render phases, and teardown.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`: transparent inactive wrappers and shared active fill for attention and collapsed cards.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts`: transparent attention-frame assertion.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts`: transparent inactive card, subtle hover, dark tinted active card, paint transitions, updated contrast comments.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.spec.ts`: updated fill and hover assertions.
- `libs/frontend/core/src/lib/services/app-state.service.ts`: host-neutral connection messages.
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts`: matching connection assertions.

## FLIP capture and playback

The `grouped()` effect captures each visible card by `data-tab-id` and each group header by `data-rail-group` before Angular refreshes the rail view. Positions use `rect.top - scrollContainer.top + scrollTop`, so scrolling does not create motion. Capture reads an in-flight animation's visual rect before cancelling it. An injector-bound `afterNextRender` measures the new layout in `earlyRead` and starts compositor-only transform/opacity animation in `write`. Cards without a previous key fade in; movements under 1 px, first render, collapse changes, and reduced-motion mode skip playback. Destroy cancels running animations.

## Colours

Inactive card and wrappers have transparent fill; inactive card hover uses `oklch(var(--bc) / 0.05)`. Expanded, attention, and collapsed focused surfaces use `--rail-active-fill: color-mix(in oklch, oklch(var(--p)) 22%, oklch(var(--b3)))`. The existing focus frame remains. The anubis-light deep-teal focus frame remains. The existing state-ink contrast spec checks base surfaces, not this new composite tint, so it reports no new computed ratio.

## Decisions

- **Capture before refresh via `effect()`** instead of retaining a settled-layout snapshot. Evidence: the card is recreated across `@for` groups, and the effect can read the outgoing view before its refresh. Reversible: yes.
- **Use Angular `earlyRead` then `write`** because `read` runs after `write` in `afterNextRender` phase order. Reversible: yes.
- **Mix primary into base-300 at 22%** for the focused fill, matching the requested dark tint while retaining the existing theme-specific focus frame. Reversible: yes.

## Verification

`npm run verify -- -p @ptah-extension/canvas,@ptah-extension/chat-ui,@ptah-extension/core`: **PASS** (exit 0). Canvas: lint/typecheck/test pass. Chat-ui: lint/typecheck/test pass. Core: lint/typecheck/test pass. Final output tail:

```text
NX   6 tasks: 6 succeeded, 2 cached
[verify 2026-11-06T16:51:40.963Z] starting verify test (@ptah-extension/canvas,@ptah-extension/chat-ui,@ptah-extension/core)
NX   3 tasks: 3 succeeded, 2 cached
[verify 2026-11-06T16:52:26.501Z] lock released after 103.5s, exit code 0
```

The first run found one stale hover-selector expectation in chat-ui; it was corrected before the passing rerun. Scoped `ptah_get_diagnostics` timed out on its TypeScript check; the requested Nx verification passed. A rendered screenshot was not captured because the task prohibits build/serve/e2e targets and no renderer was running. Skill loading was unavailable in this lane; only skill search was exposed.
