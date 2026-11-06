# Round 2 report — TASK_2026_878_eae4 (owner feedback round 2 + codex phase-1 fixes)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\landing-revamp` (branch `feat/landing-revamp`).
Nothing committed. All copy is from `landing-copy.md`; no new words were added to the page.

## Sections: composition and signature idea

The design language did not change: the ink, window, hairline, amber and core tokens, the
eyebrow, headline and subline type, the framed console window, and the grain and atmosphere.
The shared clip-stage template is **deleted**. Each section now has its own layout. All three
still use the same vertical scroll engine (`stage-scroll.ts`): the header lines come in top-down,
then the clip rises (desktop pins the stage while the steps play), and the final state is
settled. On compact screens nothing pins. With reduced motion, everything starts settled.

| Section | Composition (desktop ≥1024px) | Signature idea | Why it fits the copy |
| --- | --- | --- | --- |
| S1 command-center (`data-layout="rail-bleed"`) | Header in an off-centre column on the left. A wide clip (`min(76vw, 100vw−22rem, 80vh·1.6)`) is anchored to the **right page edge**, with its right side squared and borderless, so the desktop seems to continue past the screen. Measured video rect at 1440px: x 353 to 1440. | **The session rail.** A rail of 20 ticks, and 9 of them light amber as you scroll ("Nine running"). Below it the three points sit as stacked session tiles with an amber status edge. The rail overlaps the clip's left edge by 4rem. | Headline "One rail. Nine running. One bell." Rail, tiles and running count come straight from the copy. |
| S2 voice-and-apps (`data-layout="text-led"`) | Text leads. An uneven grid of `clip 47vw | 6rem gutter | copy 1fr`. A **smaller clip sits on the left, set lower** than the headline (margin-top 4 to 7rem). The copy column is on the right and left-aligned. | **The voice strip.** Under the subline, 16 amber bars "speak" during the first step, then a flat amber line takes over: it speaks briefly, then hands off. The bars are decorative and aria-hidden. | Point 1, "It speaks briefly, then hands the rest off", drawn as a strip. |
| S4 tribunal (`data-layout="bench"`) | A narrow copy column (≤24rem) pushed against a bolt gutter, then a medium clip **right of centre** (`min(56vw, 68vh·1.6)`), not touching the edge. | **The bench.** Five empty console windows (the panel's seats) fan out (−8° to 8°) and rise from behind the clip's top edge in the first step. The last point is set as the **verdict**: a framed card that lands last. | "Several vendors debate one call", "You confirm the panel", "Too few… it says so" as the last word. |

How they differ: the clip sits on the right edge, then on the left, then right of centre. Its
width runs about 76vw, then 47vw, then 56vw. The text sits above-left, then right, then left,
and only S1 overlaps the clip.

Mobile: every section is a single column. S1 shows the header, the clip, then the rail and tiles.
S2 and S4 show the header and points, then the visual. The S4 seats shrink to a row above the
clip.

## Flanking bolts (new owner decision)

The small seam bolt at the top of S1, S2 and S4 is **removed**. Each of those sections now has
two `<ptah-flank-bolt>` components (new, 2D canvas). They sit behind or beside the clip and
never over the picture or the copy. Their z-index is under the content, and they sit in
gutters or margins.

| Section | Bolt A | Bolt B | Seeds |
| --- | --- | --- | --- |
| S1 | Vertical, just left of the clip's left edge, behind the rail tiles. It shows above and below the tile stack, like a charged rail. | Horizontal, under the clip's bottom edge, running off the right page edge with the clip. | 31, 47 |
| S2 | Vertical, along the clip's outer left edge, in the page margin. | Vertical, in the 6rem gutter between the clip and the copy. | 59, 71 |
| S4 | Vertical, in the gutter between the copy column and the clip. | Vertical, along the clip's right edge, below the seats. | 83, 97 |

- The flanking bolts use a 2D canvas, not WebGL. Six more GL contexts would break the budget
  of about 2 live GL contexts. The page now has only two WebGL bolts: the hero bolt and the
  decision-loop seam bolt (S3 kept its seam bolt).
- Each bolt has its own seed, so the two bolts in a section strike at different times. In the
  measured runs, strikes alternated about 1.1 to 3.5 s apart.
- Mobile (<1024px) shows no flank bolt, because the columns are too narrow for a gutter.
- Reduced motion and save-data draw one faint still bolt (level 0.3) and never flash.

## Lightning changes (numbers)

The periodic engine is shared. `strike-schedule.ts` (pure, seeded) and `strike-loop.ts` (frames
and timers) drive both the WebGL `<ptah-lightning>` and the canvas `<ptah-flank-bolt>`.

- **Strike**: 320 ms in total. It rises to full in 24 ms, decays with a 55 ms time constant,
  and re-strikes once at 134 ms, peaking at 0.7 (14 ms rise, 40 ms decay). After that it is 0.
  Measured in the browser, the hero GL bolt was visibly drawn for 150 to 290 ms per strike and
  the canvas bolts for about 300 ms.
- **Idle gap**: 2.6 to 5.2 s, seeded with mulberry32 (`seededRandom`). The first strike comes
  after 0.5 s plus up to half a gap. Measured hero strikes started at 7.6, 11.9 and 16.3 s
  (4.3 to 4.5 s apart). The bolt is lit for about 8% of the time.
- **No frames between strikes**: the loop clears the canvas and sleeps on one `setTimeout` until
  the next strike. It also stops while off screen (IntersectionObserver), while
  `document.hidden` is true, and at intensity 0. Scroll-step strikes (one per header line and one
  per point) use the same 320 ms shape at a 0.85 peak.
- **Reduced motion and save-data**: one still frame at 0.3 brightness, never a flash, and step
  strikes are ignored. The reduced-motion query is followed live (codex finding 3).
- **WebGL shader** (`lightning-shader.ts`):
  - Before: the glow was `0.07·hash(t)/dist` in uv units. At 1440×900 the halo stayed above 10%
    out to about 230 px, which is the blur the owner saw, and the per-frame random hash made it
    shimmer.
  - Now the distance is measured in screen pixels (`fwidth`, `OES_standard_derivatives`).
  - Core: half-width 0.6 CSS px, antialiased over 1 px, white #fff9eb.
  - Halo: `0.32·exp(−d / 4 px)`, so it is below 5% after about 8 px.
  - Octaves: 10 → 7. The per-frame hash flicker is removed.
  - Hero intensity: 1 → 0.85.
- **Seam bolt** (S3 only now): the blurred bloom span (radial gradient plus `blur(6px)`, opacity
  0.35 to 0.9) is removed. Intensity is `1.1+0.6·charge` → `0.5+0.35·charge`. Width is 30rem →
  24rem. It gets its own seed.
- **Canvas bolt strokes** (`BOLT_STROKES` in `lightning-bolt.ts`; used by the hero arcs and the
  flank bolts). Width / alpha / blur:

  | Layer | Before | After |
  | --- | --- | --- |
  | Glow | 8 px / 0.16 / 20 | 4 px / 0.10 / 6 |
  | Body | 2.8 px / 0.7 / 9 | 1.6 px / 0.6 / 2 |
  | Core | 1 px / 0.88 / 2 | 0.9 px / 0.95 / 0 |
  | Forks | 1 px / 0.35 / 7 | 0.75 px / 0.3 / 2 |

  `paintBolt` gained a `spread` argument, so a long bolt keeps its jag within about 30% of a
  narrow gutter.
- **Decision-loop "charge threads"** (SVG):

  | Path | Before | After |
  | --- | --- | --- |
  | Forward glow | 10 px / 0.18 | 5 px / 0.10 |
  | Forward body | 2.75 px | 2 px |
  | Feedback glow | 9 px / 0.22 | 5 px / 0.12 |
  | Feedback body | 2.5 px | 2 px |

- **Fallback with no WebGL or on SSR**: a 1 px line at 35 to 45% alpha. The 14 px box-shadow
  glow is gone.
- **Clip-rim strikes** (`rim-flash`, `edge-strike`, 28 to 46 px amber box-shadows) were removed
  along with clip-stage.

## Codex phase-1 review fixes

1. `console-clip`: the clip plays only at an intersection ratio of `FULL_VIEW_RATIO = 0.98` or
   more, and pauses at the first drop below it (thresholds `[0, 0.98, 1]`). The old 0.9 / 0.5
   hysteresis is removed. Specs cover 0.95 (no play), 0.98 (play) and 0.97 (pause, then replay).
2. `console-clip`: when a `play()` promise settles, the clip checks again that it is still
   allowed to play (not destroyed, tab visible, fully in view and not paused by hand). If not,
   it pauses. A ticket counter ignores stale requests. Spec: a deferred play promise that
   settles after the clip has left the view gets paused.
3. `lightning`: the reduced-motion `matchMedia` now listens for `change`. On a change it stops the
   loop and draws one still frame, and the listener is removed on destroy. This is now in
   `StrikeLoop`. The spec covers both the change and the removal with the same handler.
5. `lightning-renderer`: every failure path deletes the shaders and program it made (and
   releases the context). This covers a missing derivatives extension, a failed compile, a failed
   program creation, a failed link and a failed buffer. After a successful link the shaders are
   detached and deleted.
6. `console-clip`: on destroy it pauses the video and invalidates any pending play. Spec: a play
   that settles after destroy is paused.

Finding 4 (clip allocation) was not changed, as instructed: S1 = multi-agent, S2 = command-center.

## Files

Created:
- `libs/web/landing/src/lib/shared/lightning/strike-schedule.ts` and `strike-schedule.spec.ts`
- `libs/web/landing/src/lib/shared/lightning/strike-loop.ts`
- `libs/web/landing/src/lib/sections/shared/flank-bolt.component.ts` and `flank-bolt.component.spec.ts`
- `libs/web/landing/src/lib/sections/command-center/command-center-section.component.css`
- `libs/web/landing/src/lib/sections/voice-and-apps/voice-and-apps-section.component.css`
- `libs/web/landing/src/lib/sections/tribunal/tribunal-section.component.css`

Modified:
- `shared/lightning/lightning.component.ts` (+spec): now uses StrikeLoop and has a `seed` input.
  `flashTimeOut` was removed; it was unused and is replaced by the periodic schedule.
- `shared/lightning/lightning-shader.ts`
- `shared/lightning/lightning-renderer.ts`
- `shared/lightning-bolt.ts` (+spec)
- `sections/shared/console-clip.component.ts` (+spec) and `console-clip.component.css`: the
  `--clip-radius` and `--clip-border-right` hooks
- `sections/shared/seam-bolt.component.ts`
- `sections/shared/section-header.component.ts`: `align` input, `center` | `start`
- `sections/shared/stage-scroll.ts`: `STEP_THRESHOLDS` and `stepsReached`
- `sections/command-center/*.ts` (+spec), `sections/voice-and-apps/*.ts` (+spec),
  `sections/tribunal/*.ts` (+spec)
- `sections/decision-loop/decision-loop-section.component.ts`: thinner glow paths, seam seed 23
- `sections/hero/hero.component.ts`: hero bolt `[intensity]="0.85" [seed]="11"`

Deleted: `sections/shared/clip-stage.component.ts` and `clip-stage.component.css`.

## Verification

Command, run from the worktree: `NX_ISOLATE_PLUGINS=false npm run verify -- -t lint,typecheck,test -p web-landing,ptah-landing-page`

- Run 1 (all TS and spec changes in place):
  `lock slot 2 acquired after 11s: verify lint,typecheck,test (web-landing,ptah-landing-page)`,
  then `NX   6 tasks: 6 succeeded` (Cache 0/6 hit), then `lock released after 288.2s, exit code 0`.
  The Nx TUI summary does not print a "Running target" line.
- Run 2 (final tree, after the S1 bleed / S2 width CSS tweaks): `lock slot 0 acquired after 237s:
  verify lint,typecheck,test (web-landing,ptah-landing-page)` → `NX   6 tasks: 6 succeeded`
  (Cache 0/6) → `lock released after 520.7s, exit code 0`.
- `ptah_get_diagnostics` on the changed files reports only the existing
  `@angular/core/testing` module-resolution notice that every spec in the lib has. That notice
  comes from the tool's tsconfig resolution, not from the Nx typecheck, which passed.

## Screenshots (`round2-shots/`)

- Sections at 1440×900 and 375×812 (`desktop-enter|mid|final|seam`, `mobile-mid|final`):
  - `command-center/`
  - `voice-and-apps/`
  - `tribunal/`
- `lightning/`:
  - `hero-periodic-1/2/3.png`: three hero shots 1.5 s apart. In `-2` the WebGL bolt is idle (dark).
  - `hero-strike.png`: the thin, crisp WebGL bolt mid-strike.
  - `command-center-strike.png`, `voice-and-apps-strike.png`, `tribunal-strike.png`: flank
    bolts caught mid-strike.
- Strike timings were measured by hooking `drawArrays` and the flank `stroke` calls (script
  `%TEMP%\r2cap\strikes.mjs`). The numbers are listed above.

## Open issues

- In S1 and S4, the header scrolls off above the viewport while the pinned stage plays its steps.
  This behaviour is unchanged from phase 1. S2 keeps its header inside the pinned stage. If the
  owner wants the headline visible during the pin in S1, the clip would have to shrink to about
  60vh.
- On mobile in S2 and S4, the points come before the clip, while S1 puts the clip first. The
  reading order eyebrow → headline → subline → visual still holds.
- The hero's older canvas arcs between symbols (thinner now) still cross the headline area
  during their roughly 0.8 s arc pairs. They were already periodic (every 3 to 6 s) and stay
  readable. Moving them off the copy is a hero-scope decision.
- A visual review in Electron was not run. The checks above used the web dev server at
  `http://localhost:4303`, as the brief specified.
