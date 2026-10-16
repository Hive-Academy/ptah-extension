# C3 fix: dock stacking and shadow

## M3

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:82,87`: documented the stacking dependency beside the dock; retained `relative z-10` so the dock shadow paints over lane content while the header overflow menu at `z-20` remains above it.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts:166-168,195,543-544`: assert the dock has `z-10` and not `z-20`, contains its menu component and opened menu, and contains the rendered hover card.

## M4

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:87`: changed the shadow to `shadow-[0_6px_8px_-6px_rgb(0_0_0/0.45)]`, retaining its bottom-cast geometry with a neutral dark color.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts:170`: updated the shadow class assertion.
- `--elev-shadow` is `0 1px 2px oklch(var(--bc) / 0.1)` in light mode and `0 1px 1px oklch(0% 0 0 / 0.28)` in dark mode (`apps/ptah-extension-webview/src/styles.css:148,154`). Its light value depends on `--bc`, and its 1px cast is too shallow for this dock, so it was not used.

## Verification

- Requested single Jest run: **passed**, 1 suite and 10 tests; exit code 0. It emitted an existing Angular `NG0953` warning from `NativeDropdownComponent` after destruction.
- Scoped `ptah_get_diagnostics` was requested after the edits but returned unavailable because the TypeScript check exceeded 45 seconds; no diagnostic result was available.

## Decisions

- Kept the dock's `relative z-10` stacking context. Moving the card or dropdown outside the dock or painting a separate shadow would require a larger structure change; the review identified only a transient later `z-10` sibling, while the header must stay above the dock. This is reversible.
- Used the neutral black alpha shadow instead of `--elev-shadow` because the token has the wrong cast and uses `--bc` in light mode. This is reversible.

## Open

- Browser visual confirmation of the shadow in dark theme and any transient overlap with the later `z-10` transcript notice was outside this Jest-only verification.
