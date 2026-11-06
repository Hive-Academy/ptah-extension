# Codex review — round 2 (`e481b7052`)

**Verdict: CHANGES.** Read-only source review of the committed diff. No Nx, npm, Playwright, or browser run.

## Findings (ranked)

1. **Major — playback is still allowed before the whole clip is visible.** `libs/web/landing/src/lib/sections/shared/console-clip.component.ts:15-19,132-137` sets `FULL_VIEW_RATIO` to `0.98`. On an 800 px tall clip, about 16 px can be outside the viewport while autoplay runs; the observer also does not report a departure until the ratio falls below 0.98. This does not meet the full-view/first-departure rule from phase 1. **Fix:** determine eligibility from the video bounding rectangle and viewport bounds with a small *pixel* rounding tolerance, then pause on the first actual departure. Update `console-clip.component.spec.ts:92-103,132` to test a one-pixel departure instead of accepting 0.98 as full view.

2. **Minor — a reduced-motion flank bolt is not repainted after resize or DPR change.** `libs/web/landing/src/lib/sections/shared/flank-bolt.component.ts:93-105,108-143` sizes the bitmap only inside `paint()`. `libs/web/landing/src/lib/shared/lightning/strike-loop.ts:127-132` draws the reduced-motion still frame once and schedules no more frames. Resizing its gutter or changing display scale therefore leaves the old bitmap stretched until an unrelated state event. **Fix:** observe canvas/host size and window DPR changes, call `loop.refresh()` on change, and release the resize listener/observer on destroy. Add a spec that changes dimensions while reduced motion is active and checks canvas bitmap dimensions and repaint.

3. **Minor — the offscreen-loop spec does not establish the claimed idle behavior.** `libs/web/landing/src/lib/sections/shared/flank-bolt.component.spec.ts:88-102` advances 15 seconds, then asserts only `running === true`; that is true for both a sleeping timeout and a continuous RAF loop. **Fix:** instrument `requestAnimationFrame` and timers to assert no frames during a known dark gap, and assert cancellation plus listener/observer teardown after destroy. A direct `StrikeLoop` spec would cover both canvas and WebGL consumers.

## Confirmed in source

- Phase-1 findings 2, 3, 5, 6 are addressed: a settled play request rechecks eligibility (`console-clip.component.ts:165-180`); teardown invalidates pending play and pauses (`:88-95`); `StrikeLoop` subscribes to and removes reduced-motion changes, stopping the loop and drawing the still state (`strike-loop.ts:52-69,105-133`); WebGL setup failure paths delete allocated objects and release the context (`lightning-renderer.ts:53-82`). Finding 1 remains open as above. Finding 4 was closed by the owner with S1 `multi-agent.mp4` and S2 `command-center.mp4`.
- `StrikeSchedule` uses a seeded PRNG and constant-size state; its spec checks same-seed equality, different-seed divergence and dark gaps. `StrikeLoop` cancels its RAF/timer on visibility and intersection changes and removes its observer and listeners on destroy. Canvas creation is guarded by `isPlatformBrowser`/`afterNextRender`.
- S1/S2/S4 use distinct IDs and videos, have matching `aria-labelledby` targets, and hide decorative bolts/graphics. Their displayed eyebrow, headline, subline and points match `landing-copy.md`. The removed clip-stage has no remaining import in landing source.

## Limit

The requested read-only review excludes rendering and runtime checks, so visual placement, actual media playback and browser-specific canvas behavior were not verified.
