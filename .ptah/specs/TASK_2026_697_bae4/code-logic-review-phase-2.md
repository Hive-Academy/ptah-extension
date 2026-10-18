# Code Logic Review, Phase 2 — TASK_2026_697_bae4

Review family: reviewer: Anthropic Claude; implementer: codex

Scope: uncommitted Phase 2 diff in the voice-polish worktree (2A canvas, 2B detail/stats/ring, 2C start cards). Read in full: command-scene-renderer.ts, command-scene.component.ts, sprite-cache.ts (getVoiceHalo), command-session-stats.component.ts, context-ring diff, start/overlay/page diffs. I did not re-run suites (the orchestrator did).

Score: 7/10
Verdict: APPROVED (with the Moderate fixes recommended before merge; none block)

Counts: Blocking 0, Serious 0, Moderate 3, Minor 4

## Checks that hold

- Gradients: created only in prepareLinks (renderer:248-290), keyed on geometry, rims, theme and backdrop signature (so resize and theme invalidate). draw() only reads `this.links` (line 306). Voice-only changes go through setVoice (no prepareLinks); the component's voice effect does not call setSnapshot.
- Backdrop: rebuilt only when `width|height|dpr|theme` changes (line 208); DPR capped at 2. One `drawImage` per frame. No getComputedStyle or shadowBlur in the renderer or sprite cache (grep). getComputedStyle is only in the component's resolveInks, on theme mutation.
- Halo sprite cache key is theme|palette|rim|dpr, so live level only affects the blit's alpha and size. It is cleared on a theme flip. Ripples are gated on `speaking && !reducedMotion`. `active` is false under reduced motion, so one frame is drawn and the loop stops. There is still a single rAF (`frameId` guard).
- Stats: `knownSubtotalOf` returns null whenever `totalCost !== null`, so "known subtotal" never shows next to a known total. Null, NaN and non-positive values render as an em dash. Provisional adds `~` and an sr-only "estimated".
- Ring: `tone` undefined keeps the old 80/95 thresholds (other callers unchanged). The overlay only renders the ring when percent is non-null, and the page passes null unless `contextCue().known`. The 70% tone matches `contextWarning`.
- Child stats: the lookup is by exact `node.tabId`, skips root, and uses only `totalCost` and `tokenCount` (no derived totals).
- Start cards: one button, `aria-label` built from the same fields as the visible text. Bars are derived from `now()` (the shared clock), with no per-card timers. They are omitted for a non-finite timestamp. Providers fall back to a monogram.

## Findings

### 1. Moderate — Root label leader line inherits a stale strokeStyle
File: command-scene-renderer.ts:306-323 and 355-363.
The link loop now sets `strokeStyle` per edge (gradient or `inks.run`) and never restores it. The root leader line (`context.stroke()` at ~362) is drawn after the loop, so it takes the last edge's gradient. If the last edge is a running child, the leader uses `inks.run`. Before Phase 2, `strokeStyle` was set once before the loop. This is a visual regression that depends on node order.
Fix: set `context.strokeStyle` to the theme line colour (or `inks.idle`) and `lineWidth = 1` right before the leader block.

### 2. Moderate — Zero-size backdrop canvas makes drawImage throw
File: command-scene-renderer.ts:199-224 and 299.
`prepareBackdrop` sizes the offscreen canvas from `canvas.clientWidth/Height`. If the scene is `display:none` or collapsed (clientWidth 0), the backdrop gets width 0. `drawImage` with a zero-dimension canvas source throws `InvalidStateError` in draw(). The error is uncaught inside rAF and repeats on every invalidate. The component's `resize()` clamps the viewport to 1px, but the renderer does not.
Fix: in prepareBackdrop, return early (and clear `this.backdrop`) when `width < 1 || height < 1`. Guard the draw call with `this.backdrop && this.backdrop.width > 0`.

### 3. Moderate — Child stats show raw, unformatted and possibly provisional numbers
File: command-center-page.component.ts (childStats computed) with command-node-detail.component.ts:46-49.
The detail template prints `{{ stats.tokens }} tokens` and `{{ stats.costUsd }} USD` raw. A real `totalCost` such as 0.012345678 renders as "0.012345678 USD", and large token counts are unabbreviated. This path was effectively unused before, so it only becomes visible now. `provisional` is dropped, so an estimated child cost reads as exact, which contradicts the root stats semantics. `messages: snapshot.messageCount` is also shown as "0 messages" for an unloaded child.
Fix: format with the exported `formatCost` and `formatTokens`. Pass a `provisional` flag through `CommandChildStats` and prefix `~`. Omit messages when it is 0 and the snapshot is provisional.

### 4. Minor — Voice halo cache keeps stale dpr entries
File: sprite-cache.ts:230-260.
The key includes a float dpr (1 to 2). Moving the window between monitors adds entries that are only cleared on a theme flip, never by `prune()`. The growth is bounded, but there is no eviction.
Fix: keep a single entry and replace it when the key changes.

### 5. Minor — Offscreen canvases are not released explicitly
File: command-scene-renderer.ts:209-212, and destroy() at 175-186.
Replaced backdrops and cleared halo and sprite canvases rely on GC. Setting `canvas.width = 0` on discard (and on destroy) would free the backing store promptly during rapid resize or theme flips.

### 6. Minor — Duplicated phaseCount logic
Files: command-center-page.component.ts (phaseCount) and command-overlay.component.ts:208-222. The two copies can drift. Fix: extract a shared helper next to `CommandPhaseCount`.

### 7. Minor — Invalid-time card text and ring tone
- command-center-start.component.ts:203 gives "Updated Unknown" in both the visible text and the aria-label when `lastActivityAt` is invalid. Bars are correctly omitted. Consider omitting the "Updated" phrase too.
- context-ring.component.ts: with `tone` set, the ring never reaches the err ink at 95% or more. This is consistent with the chip but is a deliberate loss of the severity step. Document it or add an `'error'` tone.

## Five logic questions (short)

1. Silent failure: a hidden or zero-size stage makes the backdrop `drawImage` throw (finding 2). A missing `rim` falls back to a fixed grey gradient without notice.
2. User action: switching theme or resizing rebuilds the backdrop, gradients and sprites once. Each is cached afterwards. Rapid resize drags allocate a canvas per distinct size (finding 5).
3. Wrong answer: child cost and tokens print raw and without the provisional marker (finding 3).
4. Dependency failure: `getContext('2d')` null inside the backdrop or halo throws from `setSnapshot` inside the effect, with no fallback. `canvasUnavailable` already covers the main canvas.
5. Missing: no test covers the zero-size stage, or the leader-line style after a running edge.
