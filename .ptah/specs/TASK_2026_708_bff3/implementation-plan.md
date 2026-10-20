# Implementation Plan - TASK_2026_708_bff3 (revision 2)

Revision 2 answers `implementation-plan-review.md` (codex, REVISE): transitions are observed
synchronously in `setSnapshot`; pulses need both endpoints and a drawn link; tethers match by
`fromId`/`toId`; both overlays use `save()/restore()`; renderer tests cover the cap, backdrop
reuse, pre-paint snapshots, both reduced-motion directions and the hidden pause. Line references
in section 1 are corrected.

Author: orchestrator (in-process, Claude). Reviewer: codex lane (opposite side).

All paths are relative to `libs/frontend/command-center/src/lib/scene/`.

## 1. Verified facts (base a745b9692)

| Fact | Evidence |
| --- | --- |
| `active` = snapshot && !reducedMotion && (nodes.length > 1 \|\| live). `live` = voice in listening/thinking/speaking or any node `running`/`starting`. | `command-scene-renderer.ts:222-235` |
| Ambient cap: when `active && !live && !needsPaint` and `time - lastPaintTime < 33`, the frame is skipped. Next frame is requested only when `active`. | `:321-335`, `:635` |
| With only the root node and an idle voice, `active` is false: one paint per invalidate, no loop. | `:231-235`, `:635` |
| `setHidden(true)` cancels the frame; `setHidden(false)` invalidates. | `:176-182` |
| Backdrop is a cached canvas keyed by size/dpr/theme/sceneRect/orbit bucket; drawn with `drawImage` at the frame start. | `:237-275`, `:346-347` |
| Background dots: 48 fixed normalised points in a module const `dots` (size 1.5 or 0.8), ink `#9d93ae` dark / `#625d73` light, alpha 0.18, drawn as `fillRect(dot.x*width, dot.y*height, size, size)`. | `command-scene-decoration.ts:3-7`, `:34-38` |
| Links: a cubic bezier parent -> child with control points `(parent.x, midY)` and `(node.x, midY)`, skipped for ids in `tetheredIds`. Tethers (child-session owned nodes, rect layout only) are straight lines `tether.to*` (owner) -> `tether.from*` (worker). | `:355-371`, `:408-415`, `scene-layout.ts:554-571` |
| Existing ambient particles: up to 16 `#e7bd74` 2x2 rects loop along running/starting links. | `:460-487` |
| Ripples: `VoiceRippleEmitter.update/draw` is called in the root branch of the node loop; `clear()` on voice-state change, reducedMotion -> true, theme change, destroy. | `:112-117`, `:142-143`, `:157`, `:567-571` |
| Delegation signal: a `SceneNode` whose `node.state` becomes `'starting'` or `'running'` (and has a `parentId`). | `:372`, `:464` |

## 2. Feature A - background twinkle

### New file `command-scene-twinkle.ts` (~45 lines)

```ts
export function drawBackdropTwinkle(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: 'light' | 'dark',
  time: number,
): void
```

- Stateless. Uses rAF `time` only, so a hidden pause cannot cause a burst.
- Dot source: rename the module const `dots` in `command-scene-decoration.ts` to an exported
  `SCENE_DOTS` (exported from the file only, NOT from the lib `index.ts`). The backdrop keeps
  drawing all 48 from it, so positions match by construction.
- Subset: `TWINKLE_DOTS = SCENE_DOTS.filter((_, i) => i % 4 === 1)` -> 12 dots, computed once at
  module load, each with a fixed `period = 3600 + ((i * 577) % 3000)` ms and
  `phase = (i * 0.618) % 1`.
- Brightness: `b = Math.max(0, Math.sin(2 * Math.PI * (time / period + phase))) ** 4`
  (bright about a fifth of each period, soft rise and fall). Skip the dot when `b < 0.02`.
- Draw: same ink as the backdrop dots (`#9d93ae` dark / `#625d73` light), `globalAlpha =
  b * peak` with `peak` 0.55 dark / 0.4 light, rect of `size + 0.8` centred on the backdrop dot
  (`x - 0.4`, `y - 0.4`). Wrap the drawing in `context.save()` / `context.restore()` so the
  caller's alpha and fill style are kept.
- Non-finite `time` or `width/height < 1`: return without drawing.

### Renderer wiring

Directly after the backdrop `drawImage` (`:346-347`):

```ts
if (this.active) drawBackdropTwinkle(context, width, height, snapshot.theme, time);
```

`active` already excludes reduced motion and the idle single-root scene, and this code runs only in
painted frames, so the twinkle runs inside the existing ambient cap and adds no frames.

## 3. Feature B - delegation pulses

### New file `command-scene-pulses.ts` (~170 lines)

```ts
export class DelegationPulseEmitter {
  get count(): number;            // live pulses
  get pendingCount(): number;     // queued handoffs (tests)
  /** Synchronous, no time. Called from setSnapshot for EVERY snapshot. */
  observe(layout: SceneLayout, silent: boolean): void;
  /** Painted frames only. Uses rAF time. Emits at most one pulse. */
  update(now: number): void;
  draw(context: CanvasRenderingContext2D, now: number, inks: SceneInks): void;
  clear(): void;
}
```

The emitter keeps the last observed layout's link geometry itself, so `draw` needs no renderer
maps. Types `SceneLayout`, `SceneNode`, `SceneTether` come from `./scene-layout`, `SceneInks` from
`./command-scene-renderer` (type-only import, same as the ripples file).

State: `pulses: { childId; born }[]`, `pending: string[]` (childIds, FIFO, unique),
`lastStates: Map<string, string>`, `links: Map<childId, LinkPath>` (from the last observe),
`seeded = false`, `lastUpdate = -Infinity`.
`LinkPath` (file-local) = `{ kind: 'bezier'; ox; oy; wx; wy; workerRadius }` or
`{ kind: 'line'; ox; oy; wx; wy; workerRadius }` (owner -> worker).

Constants: `TRAVEL_MS = 720`, `RING_MS = 520`, `PULSE_LIFE_MS = TRAVEL_MS + RING_MS`,
`MAX_PULSES = 6`, `MAX_PENDING = 12`, `MAX_TRACKED_STATES = 512`.

#### Drawn link (one rule for observe and draw)

For a node with `parentId` and its owner both in `layout.nodes`:

- If some tether has `fromId === node.id` and `toId === parentId` -> `line` from
  (`tether.toX`, `tether.toY`) to (`tether.fromX`, `tether.fromY`). This matches the renderer,
  which skips the bezier for every `tether.fromId` (`command-scene-renderer.ts:131-132,357`) and
  draws `toX,toY -> fromX,fromY` (`:410-415`).
- Else if any tether has `fromId === node.id` (tethered, but to another node) -> NO drawn link
  from this owner: no pulse.
- Else -> `bezier` owner -> worker with control points `(owner.x, midY)` and `(worker.x, midY)`,
  `midY = (owner.y + worker.y) / 2` (same curve as `:362-370`).

A node without a drawn link gets no pulse and no pending entry.

#### `observe(layout, silent)` (synchronous, from `setSnapshot`)

1. Rebuild `links` from `layout` with the rule above.
2. Drop live pulses and pending entries whose childId has no entry in `links` (worker or owner
   left the layout, or the link is no longer drawn). This is the synchronous "node leaves the
   layout" clear.
3. For each node with a link: `isLive = state === 'starting' || state === 'running'`.
   `prev = lastStates.get(id)`.
   - Queue (`pending.push(id)` unless already pending) only when ALL are true: `seeded`,
     `!silent`, `isLive`, and `prev !== undefined && prev is not live` (an observed
     non-live -> live transition), OR `prev === undefined` (id never observed since the last
     `clear()`: a brand-new worker that appears already `starting`/`running` is the delegation
     itself).
   - Overflow re-entry: a node that was observed before (id in `lastStates`) and returns already
     live does NOT queue, because `prev` is live. A node first seen in a later snapshot because
     it moved in from overflow while already live is indistinguishable from a new worker; it
     queues once (accepted, see Risks).
   - Record `lastStates.set(id, state)` (delete then set, so insertion order = recency). Over
     `MAX_TRACKED_STATES` -> delete the oldest key. `lastStates` is not pruned by layout.
4. Coalescing: one pending entry per child. `pending` over `MAX_PENDING` -> drop the oldest.
5. `seeded = true`. The first observe after construction or `clear()` only records states.

Because every snapshot is observed, `idle -> starting -> idle` between two paints still queues
the handoff (the pending entry stays while its link is drawn). The first snapshot seeds before
the first paint.

#### `update(now)` (painted frames only)

1. `now < lastUpdate` -> drop `pulses` (keep `pending`, `lastStates`, `seeded`).
2. Drop pulses with `now - born >= PULSE_LIFE_MS`.
3. Emit at most ONE pulse: the first pending childId that has a link and no live pulse, when
   `pulses.length < MAX_PULSES`. Remove it from `pending`, push `{ childId, born: now }`.
   One pulse per link: a pending child with a live pulse waits.
4. `lastUpdate = now`.

Pending entries do not expire by time (they need a paint to get a time); they are bounded by
`MAX_PENDING`, by link removal, and by `clear()`.

#### `draw(context, now, inks)`

- `context.save()` first, `context.restore()` last (keeps the caller's alpha, dash, widths and
  styles). Inside: `setLineDash([])`.
- For each pulse, take its `links` entry (skip when absent). Point at `t` on the path: the bezier
  formula or linear interpolation.
- Travel (`age < TRAVEL_MS`): `t = easeInOut(age / TRAVEL_MS)`. Head: filled circle r 2.6,
  `inks.run`, alpha 0.95; halo circle r 7, alpha 0.22; tail of 3 points at `t - 0.04*k`
  (k = 1..3, clamped at 0) with alpha 0.5, 0.3, 0.15, r 1.6.
- Ring (`TRAVEL_MS <= age < PULSE_LIFE_MS`): `p = (age - TRAVEL_MS) / RING_MS`, stroke circle at
  the worker end, radius `workerRadius + 13 + 16 * (1 - (1 - p) ** 2)`, `lineWidth 1.5`,
  `inks.run`, alpha `0.6 * (1 - p) ** 1.5`.

`clear()`: empty `pulses`, `pending`, `lastStates`, `links`; `seeded = false`;
`lastUpdate = -Infinity`.

### Renderer wiring

- Field: `private readonly pulses = new DelegationPulseEmitter();`
- `setSnapshot`, before `this.snapshot = snapshot`:
  - if a previous snapshot exists and (`theme` differs or `reducedMotion` differs, either
    direction) -> `this.pulses.clear()`. The ripples condition stays unchanged.
  - then `this.pulses.observe(snapshot.layout, this.hidden || snapshot.reducedMotion)`.
    Silent while hidden or under reduced motion: states are recorded, nothing queues, so turning
    reduced motion off or resuming from hidden causes no burst. After a clear the observe seeds.
- `setHidden(true)` -> `this.pulses.clear()` then
  `if (this.snapshot) this.pulses.observe(this.snapshot.layout, true)` (re-seed silently with
  the current states, so the first visible snapshot after the pause compares against them).
- `destroy()` -> `this.pulses.clear()`.
- `draw`, after the ambient particle block (`:460-487`), before the node loop:
  `if (this.active) { this.pulses.update(time); this.pulses.draw(context, time, snapshot.inks); }`
  Not active means reduced motion or no link exists, so nothing is drawn and pending stays bounded.
- Frame rate: a new delegation makes the worker `starting`/`running`, so `live` is true and
  frames run at full rate while the pulse travels. If the worker finishes early, the link still
  exists, so `nodes.length > 1` keeps `active` true and the pulse ends inside ambient 30 fps
  frames. No new frame scheduling.

Renderer growth: about +15 lines (to ~652). No other renderer change.

## 4. Tests

- `command-scene-twinkle.spec.ts` (new): fills only the 12 subset dots at the backdrop positions
  (`dot.x * width - 0.4`, `dot.y * height - 0.4`); alpha in `(0, peak]`; nothing for `width < 1`
  or non-finite time; deterministic at a fixed time; different alpha at two times;
  `save`/`restore` called once each.
- `command-scene-pulses.spec.ts` (new):
  - seeding: first observe queues nothing, even with live children;
  - `idle -> starting` queues one; `starting -> running` queues nothing more;
  - `idle -> starting -> idle` in two observes with no update between -> one pending, emitted at
    the next update;
  - a brand-new child that appears `starting` queues; a child observed before that leaves and
    returns `running` does not;
  - silent observe queues nothing but records states;
  - two queued children -> one pulse per update; same child twice -> one pulse, second waits
    while the first lives; global cap 6; `MAX_PENDING` drops the oldest;
  - age pruning at `PULSE_LIFE_MS`; time going back drops pulses;
  - owner missing, worker removed, tethered to another node -> no queue, live pulse dropped on
    the next observe;
  - draw: exact bezier point at a known `t` and exact straight-line point for a matching tether;
    ring arc centred on the worker with the expected radius; `save`/`restore` paired; a
    non-default `globalAlpha`/line dash set before `draw` is unchanged after it (restore mock).
- `command-scene-renderer.spec.ts` (extend, focused):
  - idle single root + idle voice: one paint, no further `requestFrame`, no twinkle fill;
  - active ambient scene: frames under 33 ms after the last paint are skipped (no draw calls),
    a frame at >= 33 ms paints, and the twinkle fills in it; `createCanvas` is not called again
    for those frames (backdrop reused);
  - reduced motion: no twinkle, no pulse draw;
  - a child appearing `starting` in a second snapshot draws a pulse on the next frame;
    two snapshots before one frame (`idle -> starting -> idle`) still draw one pulse;
  - `reducedMotion` false -> true and true -> false both clear pulses synchronously
    (`count === 0` right after `setSnapshot`, via a test accessor or the draw output) and the
    true -> false direction causes no pulse;
  - `setHidden(true)`, a delegation snapshot while hidden, `setHidden(false)`: no pulse drawn
    after resume; theme change clears a live pulse.
- `command-scene-decoration.spec.ts`: keep green after the `SCENE_DOTS` rename.

## 5. Batches

Both features need the renderer, so ONE batch on one codex lane:

| Batch | Files | Executor |
| --- | --- | --- |
| 1 | NEW `command-scene-twinkle.ts`, `command-scene-twinkle.spec.ts`, `command-scene-pulses.ts`, `command-scene-pulses.spec.ts`; EDIT `command-scene-decoration.ts` (export `SCENE_DOTS`), `command-scene-renderer.ts` (wiring only), `command-scene-renderer.spec.ts` | codex lane, 40 tool calls |

## 6. Verification

From the worktree, one at a time, after peer coordination:
`npx nx typecheck command-center --parallel=1`, `npx nx lint command-center --parallel=1`,
`npx nx test command-center --parallel=1 --maxWorkers=2`, degradation audit (<= 291),
`npx nx typecheck ptah-extension-webview --parallel=1`. Then the Electron visual check on port
9334 (dark, light, reduced motion; inject a `starting` child to trigger a pulse).

## 7. Risks

- Twinkle visibility in light theme is low by design (alpha 0.4 on `#625d73`); tune only after the
  Electron screenshots.
- `lastStates` keeps ids of nodes that left the layout; bounded by `MAX_TRACKED_STATES`.
- A node that enters the layout from overflow already `running` and never seen before pulses once.
  Accepted: it is a real worker becoming visible.

## Decisions

See `decisions.md`.
