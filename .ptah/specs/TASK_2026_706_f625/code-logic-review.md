# Code Logic Review - TASK_2026_706_f625 (batches S and P)

Score: 7/10. Verdict: NEEDS_FIXES (one must-fix, the rest should-fix or minor).

Scope read: the full diff of scene/ and components/, the full renderer draw loop and lifecycle, scene-layout.ts orbit and tether code, SpriteCache, VSCodeService.getPtahIconUri/getAssetUri, apps/ptah-electron/src/preload.ts, and the new specs. No tests were run (the orchestrator's results were taken as given).

## Findings

### 1. Perpetual full-rate redraw whenever any delegate exists (MUST-FIX, Serious)

- File: scene/command-scene-renderer.ts:204-215 (`recomputeActive`) with :608 (`if (this.active) this.invalidate()`).
- Before: `active` was true only for voice listening/thinking/speaking or a running/starting node. Now `snapshot.layout.nodes.length > 1` makes it true for any scene with a single completed or idle delegate.
- Effect: a full-canvas redraw on every rAF (60-144 Hz). Each frame blits the backdrop, draws every sprite and link, runs status effects and writes label styles. It runs indefinitely when nothing is happening, and the work is purely decorative: link dash offset and a glow that is constant at idle.
- What does stop it:
  - `document.hidden` stops it through `setHidden` (component:407, 375).
  - reduced motion stops it.
  - Reduced motion is read live: `matchMedia` `change` -> `onMotion` -> signal -> snapshot.
- What does not stop it: an off-screen or occluded canvas (no IntersectionObserver), and no frame-rate cap.
- Fix: keep the ambient animation but throttle it. In `draw`, when the reason for being active is only ambient (no voice activity, no running node), skip the paint if `time - this.lastPaint < 33` and just reschedule. That gives about 30 fps, and 12 px/s dash flow is still smooth. Also drop to 0 frames when the canvas is not intersecting (IntersectionObserver feeding `setHidden`). Add a spec asserting that an idle multi-node scene paints at most every 33 ms.

### 2. "Many orbit" count does not match the layout's decision (Moderate, should-fix)

- File: scene/command-scene-renderer.ts:230-237 versus scene-layout.ts:180-183 and :342-348.
- The layout decides `many` from `orbitNodes = visible non-lane nodes not owned by a child` (when `rect` is set). The renderer re-derives the count as "delegate or tribunal nodes not tethered".
- Owned nodes are placed with kind `delegate` or `tribunal` (layout:343-348) but are tethered only when `parentId === owner` (layout:556).
- A grandchild owned by a child, with its parent being another owned node, is counted by the renderer but not by the layout.
- Result: the renderer can draw two tracks (`> 8`), or one track when the layout has none, while nodes sit on the other geometry. The renderer and layout can also drift silently if either threshold changes.
- Fix: have `computeSceneLayout` return `orbitCount` (or `many`) and pass it through the snapshot. The renderer should not re-derive it. The signature and `drawSceneDecoration` stay unchanged.

### 3. Non-finite voice level can kill the render loop (Minor)

- File: scene/command-scene-decoration.ts:64-67. `Math.max(0, Math.min(1, NaN))` is NaN, so the radius is NaN and `createRadialGradient` throws. A throw in `draw` skips the reschedule at :608, so animation stops until the next `invalidate`.
- Fix: `const l = Number.isFinite(level) ? level : 0`.
- Related: a new `createRadialGradient` is allocated every frame. It is small, bounded and not a leak. Caching by (radius bucket, theme) would be cheap, since the glow only changes with level.

### 4. Tether flow direction is inverted relative to E4 (Minor)

- File: scene/command-scene-renderer.ts:386-391. Tethers draw from the owned node to its owner, and the negative `lineDashOffset` moves the pattern toward the end point, so dashes flow work -> owner (inward). E4 says "root -> work". Parent links (:331-347) flow correctly.
- Fix: draw the tether from `toX/toY` to `fromX/fromY`, or flip the sign for tethers.

### 5. Logo image has no teardown path (Minor)

- File: scene/sprite-cache.ts:55-68 and component:455-469. One Image per cache, which is bounded and not per rebuild. `onload`/`onerror` are never detached and `src` is never cleared on teardown. A late load after the component is destroyed bumps a signal on a dead component. This is harmless but untidy. Add `dispose()` that nulls the handlers and `src` and call it from `teardown`.
- Also: `onerror` leaves `logoReady = false`, but a previously cached logo sprite is only replaced on the next `get`. This is fine because the signature check handles it.

### 6. Orbit guide is still drawn when there are no orbit nodes (Minor, by design)

- File: scene/command-scene-decoration.ts:40-49. With `orbitCount === 0` one faint track is drawn. E2 says "only the track(s) the layout uses". This is acceptable as a resting visual, but confirm that was intended.

### 7. Batch P legibility and brittle specs (Minor)

- Rail text drops to `text-[11px]` and `text-[10px]` (command-work-list, command-node-detail). This is small but within E5 ("one step smaller"). The new dock spec asserts Tailwind utility classes (`p-2`, `h-10`, `text-[11px]`, `gap: 4px 8px`), which will break on harmless restyles. Prefer asserting computed behavior (the min target size) or keep these as design-token checks only.
- The header uses `flex-wrap` with `min-h-[60px]`. The title is `whitespace-nowrap`, so it stays on one line. With the session badges, mic-error text and buttons all present, the controls group wraps to a second row and the header exceeds 60 px. That is acceptable overflow, not clipping.

## Checks that passed

- **Logo URL.**
  - Electron preload sets `iconUri: './images/ptah-icon.png'` (preload.ts:43), and the file exists in the webview public/images. It is a PNG with intrinsic size, so the SVG-without-size concern does not apply there.
  - If `iconUri` were empty, the `getAssetUri('assets/ptah-icon.svg')` fallback is not in the repo, so `onerror` fires and the `P` fallback stays.
  - The VS Code config supplies `iconUri`.
  - `@Optional` inject plus `typeof Image` guard cover tests and SSR.
- **Cache signature.** The signature includes `logo:${root && logoReady}`, and the early return checks the same token, so the root sprite rebuilds exactly once after load. The sprite-cache spec covers fallback, load, rebuild and error.
- **Clipping at DPR 2.** The arc clip and `drawImage` happen in the sprite's own scaled context (radius * 0.91, extent 1.82r), so they are DPR-correct. No `getImageData`, `toDataURL` or `toBlob` exists in the scene, so cross-origin canvas tainting is not a concern.
- **Glow ordering and theme.** The glow is drawn in the first node loop (renderer:394-406), before the sprite loop at :464-511, so it is behind the sprite. The theme comes from the snapshot every frame, so a theme switch updates it. Static radius under reduced motion is honoured.
- **Dash state leaks.** `setLineDash([])` and the offset reset at :392-393, and the later dashed strokes reset their own dash state. No leak into subsequent strokes.
- **Batch P contracts.** CSS placements (1100/720 container queries, stage minimums) are untouched except the rail widths. `label[for="command-text"]`, the dock `aria-label="Command dock"` and `data-dock-layout`, and the text contracts (empty-state copy, "Open Voice settings", "Interrupt speech", "Retry microphone") are unchanged in the diff. Interactive controls are at least `btn-sm` (32 px) or `min-h-10` (40 px). Badges shrank to `badge-sm` but are non-interactive.

## Five logic questions

1. Silent failure: logo load failure degrades to `P` (intended); a NaN level halts the loop silently (#3).
2. Unexpected user action: a minimised or backgrounded Electron window stops via visibilitychange; an occluded window does not (#1).
3. Wrong output from data: grandchild-owned nodes cause the wrong orbit track count (#2).
4. Dependency failure: a missing or 404 icon is handled; a missing VSCodeService is handled by optional inject.
5. Missing: no frame cap or ambient-only rAF policy (#1); no dispose for the Image (#5).

## Must-fix list

1. Throttle or stop the ambient-only animation (#1).

Should-fix: #2. Optional: #3, #4, #5, #7.

## Fix verification

Read: renderer diff (recomputeActive, draw throttle, invalidate), component IntersectionObserver wiring, scene-layout orbitCount, drawRootGlow, tether draw order. No tests run.

| # | Item | Verdict |
| - | ---- | ------- |
| 1 | Perpetual redraw | PARTIAL, new defect F1 below |
| 2 | Layout-owned orbit count | FIXED. `orbitCount: orbitNodes.length` (scene-layout.ts:574) is the same value that drives `many > 8`; renderer and decoration consume it (renderer prepareBackdrop, decoration). Signature buckets 0/1/2 unchanged. |
| 3 | Non-finite level | FIXED. `Number.isFinite` clamp in drawRootGlow. Per-frame gradient allocation left as is (acceptable). |
| 4 | Tether direction | FIXED. Tether now drawn from `to` (owner) to `from` (work). |
| 5 | Rail text minimum | FIXED. No `text-[10px]`/`[9px]` left in rail components (the remaining 10px is the header eyebrow, unchanged). |
| - | Logo dispose, dock spec style | Accepted by orchestrator decision, not re-raised. |

Item 1 detail. Verified working: ambient-only paints skip when `time - lastPaintTime < 33` (a skipped tick just re-requests a frame, cheap); `needsPaint` set by `invalidate` guarantees data changes paint immediately; IntersectionObserver feeds `setHidden(document.hidden || !intersecting)` and is disconnected in teardown; reduced motion makes `active` false so only invalidations paint.

### F1 (open, Serious, must-fix): `live` is too broad and bypasses the throttle
- File: scene/command-scene-renderer.ts `recomputeActive` (`this.live = ... this.voice.voiceState !== 'idle' || ...`).
- `CommandVoiceState` also includes `'muted' | 'stopped' | 'error'`. `session-coordinator.ts:293` sets `'stopped'` whenever the session stops, and `muted`/`error` persist until the user acts. In all of these states `live` is true, the throttle condition `!this.live` fails, and the scene paints at full vsync indefinitely, which is exactly the idle-cost regression the first review flagged. Nothing in drawStatus or drawVoiceRing animates for these states (command-scene-status.ts:123 treats muted/stopped as static).
- `'awaiting input'` was also added to the live work states, but no animated drawing depends on it; it widens full-rate painting without need.
- Fix: `live` should be exactly the previously animated set: voiceState in `listening|thinking|speaking`, or any node `running|starting`. Drop `'awaiting input'` unless a spec shows an animation tied to it. Add a spec: voiceState `stopped`/`muted`/`error` with one idle delegate paints at most every 33 ms.

## Final verdict: NEEDS_FIXES (one open defect, F1)

## Correction verification

- `LIVE_VOICE_STATES` (renderer:54-58) is exactly listening/thinking/speaking; `recomputeActive` sets `live` only from that set or running/starting nodes. `'awaiting input'` is gone. `active` is unchanged (reduced motion off and (nodes > 1 or live)). F1 is resolved.
- The new `it.each(stopped|muted|error)` spec (renderer.spec.ts:160-169) drives `setVoice`, then frames at 1000..1080 every 16 ms and asserts 2 paints (1000 and 1048; the rest skipped by the 33 ms cap). It would fail against the previous `!== 'idle'` logic. The sibling specs still cover live work painting every frame and reduced-motion stopping ambient scheduling.
- No new defects found.

Verdict: APPROVED. Final status of the review: all must-fix items resolved.
