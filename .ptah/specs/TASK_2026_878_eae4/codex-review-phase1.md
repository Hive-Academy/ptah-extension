# Code logic review — TASK_2026_878_eae4, phase 1

**Verdict: CHANGES.** Source review only. Nx, npm, Playwright and browser checks were excluded by the request. The Angular skill catalogue was unavailable in this lane.

## Findings

### Major

1. **Clips play while partly offscreen.** `libs/web/landing/src/lib/sections/shared/console-clip.component.ts:15-17,120-129` starts at intersection ratio 0.9 and retains `inView = true` down to 0.5. The clip plays while 10–50% is outside the viewport, against the full-view/leave rule. `console-clip.component.spec.ts:86-100` treats 0.95 as fully visible and never tests departure. **Fix:** require full visibility, clear eligibility at the first departure, and test both boundaries.

2. **A pending play request can start after the clip leaves.** `console-clip.component.ts:134-149` pauses on departure only if `video.paused` is false. While `play()` is pending, the promise can settle after departure and begin offscreen playback without another observer event. **Fix:** recheck visibility and page state when play settles; pause if eligibility was lost. Test with a deferred play promise.

3. **Changing to reduced motion after hydration leaves WebGL animation running.** `libs/web/landing/src/lib/shared/lightning/lightning.component.ts:127-163` reads `matchMedia` once and never listens for changes. An active bolt keeps its RAF loop after the OS preference changes. **Fix:** subscribe to changes, stop the loop, draw a still frame, and remove the listener on destroy.

4. **S1's video disagrees with the approved copy.** `libs/web/landing/src/lib/sections/command-center/command-center-section.component.ts:40-45` uses `multi-agent.mp4`, while `landing-copy.md:25` specifies `command-center.mp4`. S2 uses the latter at `voice-and-apps-section.component.ts:40-45`. The copy assigns the same clip to S1 and S2, conflicting with the once-per-page rule. The S1 spec at `command-center-section.component.spec.ts:39-43` ratifies the drift. **Fix:** obtain an approved unique S1/S2 visual allocation, then align markup and specs with it.

### Minor

5. **Shader setup failures retain WebGL objects.** `libs/web/landing/src/lib/shared/lightning/lightning-renderer.ts:43-55` returns on compilation, program creation or link failure without deleting partial allocations. **Fix:** release shaders, program and context on every failed setup path; delete shaders after successful linking.

6. **The clip is not explicitly paused at teardown.** `console-clip.component.ts:80-87` disconnects observers but leaves any playing video to DOM teardown. **Fix:** pause on destroy and invalidate pending play work.

## Five logic questions

1. **Silent failure:** offscreen playback consumes media/CPU (`console-clip.component.ts:120-149`); rejected shader setup retains resources (`lightning-renderer.ts:43-55`).
2. **Unexpected action:** scrolling a little past a clip does not pause it (`console-clip.component.ts:123-125`); changing OS motion preference does not stop an active bolt (`lightning.component.ts:133-163`).
3. **Wrong input/data:** the S1 visual conflicts with `landing-copy.md:25`; the copy's S1/S2 visual entries conflict with once-only clip usage.
4. **Dependency failure:** rejected `play()` switches to native controls (`console-clip.component.ts:141-149`); shader failure falls back visually while retaining partial GPU allocations (`lightning-renderer.ts:43-55`).
5. **Missing detail:** approve a unique S1/S2 clip assignment and define the pixel tolerance for “fully in view” if ratio 1 proves unreliable.

## Checked scope and limits

Read the current hero, page composition, new S1/S2/S4 sections, shared scroll/video/lightning paths, their specs and approved copy. `hero.component.ts:30-31` confirms `TITLE_GONE = 0.9` and `TITLE_INERT = 0.95`. Browser-only initialization is guarded by `isPlatformBrowser`/`afterNextRender` in the reviewed components. Hero pin creation is at `hero.component.ts:156-180`, followed by section stage pins in `stage-scroll.ts:55-91`; actual pin order and visual accessibility require browser verification. No runtime check was run under the tool limits.

## Decisions

- Treat the once-per-page rule as binding over the contradictory S1/S2 visual entries in `landing-copy.md`; finding 4 requests an approved asset assignment. This is reversible.

