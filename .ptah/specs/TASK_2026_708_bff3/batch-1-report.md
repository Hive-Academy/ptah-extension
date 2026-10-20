# Batch 1 implementation report

## Files changed

| File | Summary |
| --- | --- |
| `libs/frontend/command-center/src/lib/scene/command-scene-decoration.ts` | Exported the existing 48 dots as `SCENE_DOTS` and kept the backdrop drawing from that array. |
| `libs/frontend/command-center/src/lib/scene/command-scene-twinkle.ts` | Added a stateless, rAF-time overlay for 12 fixed backdrop dots. |
| `libs/frontend/command-center/src/lib/scene/command-scene-twinkle.spec.ts` | Added subset, position, alpha, deterministic time, invalid-input and canvas-state tests. |
| `libs/frontend/command-center/src/lib/scene/command-scene-pulses.ts` | Added bounded delegation transition tracking, link geometry, travel and arrival-ring drawing. |
| `libs/frontend/command-center/src/lib/scene/command-scene-pulses.spec.ts` | Added transition, queue/cap, lifetime, link geometry, silent-state and canvas-state tests. |
| `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts` | Wired synchronous observation/clearing and painted-frame overlays into existing frame scheduling. |
| `libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts` | Added focused ambient-cap, backdrop-cache, reduced-motion, transition, hidden and theme tests. |

## Plan rules, sections 2–3

| Rule | Implementation |
| --- | --- |
| Reuse the exact backdrop dots; select 12 once | `command-scene-decoration.ts:3-7,36`; `command-scene-twinkle.ts:1-9` |
| Fixed period/phase, sine brightness, threshold, theme ink and peak | `command-scene-twinkle.ts:3-8,20-28` |
| Centred rect; save/restore; reject invalid size/time | `command-scene-twinkle.ts:18-19,29-37` |
| Twinkle after cached backdrop blit, only on active painted frames | `command-scene-renderer.ts:359-361` |
| Track bounded pulses, pending handoffs, state history and last update | `command-scene-pulses.ts:4-9,60-69` |
| Use the renderer's exact tether match or bezier link rule | `command-scene-pulses.ts:25-58,71-79` |
| Drop pulses/pending when the drawn link leaves; observe every snapshot | `command-scene-pulses.ts:80-101`; `command-scene-renderer.ts:121-128` |
| Queue only observed non-live to live or new-live transitions after seeding; silent observations only record state | `command-scene-pulses.ts:83-101` |
| FIFO uniqueness, oldest-first pending eviction, 512-state recency bound | `command-scene-pulses.ts:89-99` |
| Prune expired/backward-time pulses and emit at most one per painted update, capped at six | `command-scene-pulses.ts:103-115` |
| Ease travel, three tail dots and arrival ring; restore canvas state | `command-scene-pulses.ts:117-150` |
| Full clear resets queues, history, links, seeding and time | `command-scene-pulses.ts:152-159` |
| Clear for theme or either reduced-motion change before synchronous observation | `command-scene-renderer.ts:121-125` |
| Hidden pause clears and silently re-seeds; destruction clears | `command-scene-renderer.ts:184-189,215-218` |
| Pulse update/draw after ambient particles; existing scheduling remains | `command-scene-renderer.ts:502-505` |

## Tests added

- `command-scene-twinkle.spec.ts`: selected positions, theme alpha, deterministic brightness, invalid inputs and canvas restoration.
- `command-scene-pulses.spec.ts`: seeding, live transitions between paints, returning workers, silent observations, queue uniqueness and bounds, pulse cap and age, backward time, absent links, bezier/tether points, arrival ring and canvas restoration.
- `command-scene-renderer.spec.ts`: idle single root, 33 ms ambient cap and backdrop reuse, reduced motion, a new live worker, pre-paint transitions, both reduced-motion directions, hidden resume and theme clearing.

Tests and diagnostics were not run: the caller explicitly reserved all checks for the orchestrator. Verification here was static file review only.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the index within the filtered 12-dot subset for period and phase. | Filtered index or original 48-dot index. | Plan section 2 defines `TWINKLE_DOTS = SCENE_DOTS.filter(...)` and then gives `i` for each selected dot. | Yes; change the map index source. |
| Keep previously observed worker states after layout removal. | Retain bounded history or prune immediately. | Plan section 3 explicitly says `lastStates` is not pruned by layout and returning live workers do not requeue. | Yes; transition policy can be changed in the emitter. |

## Deviations

None.

## Could not do

No test, diagnostic, lint, typecheck or build command was run, per the caller's verification constraint.
