# Batch A report — TASK_2026_863

## Root cause

`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:536-551`: `railStateValue` treated a stale running lane as authoritative after the tab had received terminal `loaded` status. The emitted rail state fed both the chip and `CanvasRailComponent` grouping, so an inactive completed tile could remain Running until its card was refreshed. The card now lets terminal tab status override stale lane activity and classifies a completed live session as Done even if it has no finalized messages yet.

## Changed files

- `libs/frontend/canvas/src/lib/canvas-board-mode.ts` — default board density is dense.
- `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts` — malformed or absent stored density falls back to dense while explicit comfortable remains valid.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` — removed stream sampler and corrected terminal rail state.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts` — removed preview row, its text latch and unused layout row; active tile now uses theme-aware bg-primary/25, while inactive tiles retain bg-base-200 and the focus border remains.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts` — removed forwarding of the unused preview hold input.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts` — replaced sampler tests with terminal status regression.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.spec.ts` — replaced preview hold tests with absence assertion and asserted active/inactive background classes.
- `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts` — asserted dense default.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-grouping.util.spec.ts` — asserted Finished regrouping when a background tile emits Done.

## Verification

Exact command: `npm run verify -- -p @ptah-extension/chat,@ptah-extension/chat-ui,@ptah-extension/canvas`

Result: exit 1 on both scoped attempts before lint, tests or typecheck; Nx plugin worker spawning failed with `spawn EPERM` and the daemon socket returned `connect EPERM` in this sandbox. The latest scoped `ptah_get_diagnostics` found no errors in the active-tile component or spec, but reported 16 errors in sibling files. Test results are therefore unconfirmed.

## Decisions

- Chose `dense` as the compact default because `CanvasRailDensity` uses `dense`/`comfortable`, and stored `comfortable` is an explicit preference. Reversible.
- Treated the backend terminal tab status as authoritative over lingering lane activity, since grouping consumes the card's emitted rail state. Reversible.

- Used bg-primary/25 for the active tile and bg-base-200 for inactive tiles, using existing theme colors and preserving the focus frame. Reversible.

## Open risks

- Scoped verification must be rerun outside the sandbox to confirm lint, tests and typecheck.
- Browser rendering was unavailable because the lane is prohibited from starting a dev server; visual quality is unconfirmed.

