# Phase B fix E: Thoth stat tiles fit the panel

## Changed files

- `libs/frontend/memory-curator-ui/src/lib/components/memory-stats-strip.component.ts:27` ? container-sized five-tile grid; shrinkable tile bodies, wrapping titles, breakable date value.
- `libs/frontend/memory-curator-ui/src/lib/components/memory-stats-strip.component.spec.ts:5` ? asserts the grid class, five tiles, and absence of `xl:grid-cols-`.
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-stats-strip.component.ts:20` ? matching grid and tile treatment for populated and loading states (`:111`).
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-stats-strip.component.spec.ts:5` ? asserts both states use the grid and lack `xl:grid-cols-`.
- `libs/frontend/messaging-gateway-ui/src/lib/components/messaging-gateway-tab.component.ts:196` ? matching grid and shrinkable stat bodies to remove inner horizontal scroll.
- `libs/frontend/messaging-gateway-ui/src/lib/components/messaging-gateway-tab.component.spec.ts:153` ? asserts four tiles and no `xl:grid-cols-`.
- `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts:190` ? matching grid and tile treatment.
- `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.spec.ts:11` ? exposes the fixture for a grid assertion and corrects the existing config signal type assertion; grid assertion at `:66`.

## Class strings

- Memory: `grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5` -> `grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3`.
- Skills, populated and loading: `grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5` -> `grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3`.
- Gateway: `grid grid-cols-2 gap-3 xl:grid-cols-4` -> `grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3`.
- Cron: `grid grid-cols-2 gap-3 xl:grid-cols-4` -> `grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3`.
- Each tile wrapper gains `min-w-0 overflow-hidden`; each `.stat` gains `min-w-0 overflow-hidden`; titles gain `min-w-0 whitespace-normal`; small date/status values gain `min-w-0 break-words`.

## Projects touched

- `@ptah-extension/memory-curator-ui`
- `@ptah-extension/skill-synthesis-ui`
- `@ptah-extension/messaging-gateway-ui`
- `@ptah-extension/cron-scheduler-ui`

## Decisions

- Used the same 9.5rem minimum in all four grids. At roughly 820px of content width, five tracks fit; at narrower panel widths, the tiles wrap. The current Cron grid also used `xl:grid-cols-4`, so the consistency fix applies there. Reversible by editing the grid class.
- Kept every label, value, icon, color, accessibility label, and test ID; changed presentation classes only. Reversible by restoring those classes.
- Added focused DOM class assertions, including the Skills loading state. Neither stat-strip component had its own spec before this change. Reversible by editing or removing the new specs.
- Scoped diagnostics after edits found no errors in changed source files. The existing Cron spec type assertion was corrected; diagnostics still report errors in sibling files outside this batch, including shared `capability-id-codec.ts`. No Nx, Jest, lint, build, or e2e commands were run.
