# Phase 1 report: command-center, voice-and-apps, tribunal (+ pilot motion)

Page order is now: hero, **command-center** (S1), **voice-and-apps** (S2), decision-loop (S3, pilot), **tribunal** (S4), then the old Phase 2 sections, unchanged.

The final build includes three owner corrections that arrived mid-task:

1. **Motion follows vertical scroll.** Every section's progress is scrubbed by ScrollTrigger. On desktop the section is pinned for a short distance. The reveal runs in reading order: eyebrow, headline, subline, visual, then one point per scroll step. Everything ends in a settled state that stays on screen. Mobile scrubs without a pin. Reduced motion shows the final state at once. The decision-loop pilot uses the same mechanism.
2. **The live-demo clips are section visuals** (the owner reversed an interim "no hero clips" instruction). Each clip is used once. command-center.mp4 is in S2 and tribunal-council.mp4 is in S4. orchestration and multi-agent are left for Phase 2. Each clip sits in a hero-style framed console with play/pause and a lazy poster. It plays once it is fully in view and pauses when it leaves.
3. **One motion language from the hero's lightning.** A shared bolt util is extracted from `hero-lightning.ts`. An amber lightning thread runs down each seam between sections and is charged by scroll. The point rail is a lightning thread that charges and re-strikes at every step. Each point flashes once when it arrives. In the pilot, the active stage strikes and the travelling orb carries a spark that re-jags at each stage.

## Files changed

Created:

- `libs/web/landing/src/lib/shared/lightning-bolt.ts` (+ `.spec.ts`): `generateBoltPath` and `paintBolt`, extracted unchanged from the hero, plus `seededRandom` so bolt shapes are the same on the server and in the browser.
- `libs/web/landing/src/lib/sections/shared/section-scroll.ts` (+ `.spec.ts`):
  - `bindSectionScroll`: desktop pin + scrub, compact unpinned scrub, reduced motion settles at 1.
  - `sectionScrollProgress()`: an injection-context signal that is browser-only and released on destroy.
  - Reveal and step thresholds, `stepFor`, `seamCharge`.
- `libs/web/landing/src/lib/sections/shared/section-header.component.ts`: eyebrow, headline and subline in the pilot's treatment, revealed top-down by progress.
- `libs/web/landing/src/lib/sections/shared/charge-thread.component.ts`: SVG lightning thread using the hero's three stroke layers.
  - Charged from the top down with `clip-path: inset()`.
  - A strike re-jags the bolt and flashes it once, with no timers.
- `libs/web/landing/src/lib/sections/shared/step-points.component.ts` / `.css`: points on a lightning rail. Each point rises and strikes in turn.
- `libs/web/landing/src/lib/sections/shared/console-clip.component.ts` / `.css` (+ `.spec.ts`): the framed clip console.
- `libs/web/landing/src/lib/sections/shared/section-frame.css`: section frame, atmosphere, grain, seam thread slot, rise reveal, two-column step layout and its mirrored variant.
- `libs/web/landing/src/lib/sections/shared/vignette-window.css`: the window chrome for markup vignettes.
- `libs/web/landing/src/lib/sections/command-center/command-center-section.component.ts` (+ `.spec.ts`), `session-rail-vignette.component.ts` / `.css`.
- `libs/web/landing/src/lib/sections/voice-and-apps/voice-and-apps-section.component.ts` (+ `.spec.ts`).
- `libs/web/landing/src/lib/sections/tribunal/tribunal-section.component.ts` (+ `.spec.ts`).

Modified:

- `libs/web/landing/src/lib/landing-page.component.ts`: imports the three sections and places them in the order above.
- `libs/web/landing/src/lib/sections/decision-loop/decision-loop-section.component.ts` / `.css`: the pilot's motion now follows vertical scroll. Its visual design is unchanged.
  - `bindSectionScroll` replaces the pilot's own ScrollTrigger.
  - The header rises in reading order; the loop and its 01-06 rail map onto the scroll after the header.
  - The static bridge is now a charge thread.
  - The active stage strikes once; the orb carries a re-jagging spark.
  - Cleanup goes through the helper's release function.
- `libs/web/landing/src/lib/sections/hero/hero-lightning.ts`: pure extraction. It imports the shared util, re-exports `generateBoltPath` and `BoltPoint`, and `paint()` delegates to `paintBolt`. The drawing code is identical, so output is unchanged.

Not touched by me: `hero.component.ts`, `hero.component.css` and `hero.component.spec.ts`. They show as modified in the worktree because another agent is removing the video rail from them. No assets were added.

## Design decisions per section

All three sections share the pilot's tokens:

- Colors: ink `#08090c`, window `#0e1015`, hairline `#262a33`, amber `#f5a524` / `#ffbb4d`, core `#fff9eb`.
- The same eyebrow (mono, amber cue lines), uppercase headline and 56ch subline.
- The same window: hairline border, amber top highlight, deep shadow with amber halo.
- The same atmosphere and grain.

Copy is only the text from `landing-copy.md`. Points are not numbered because they are not a sequence; the pilot's six stages keep their numbers.

- **S1 command-center**: a session-rail vignette, left, with the points on a lightning rail, right. The vignette is markup with no words: text is shown as muted bars.
  - Step 1: twenty tiles build top-down; nine are marked running.
  - Step 2: the bell lights and its panel drops in with two groups, needs-you (amber) above notices.
  - Step 3: the git dock rises beside the chat, with one dashed, locked foreign-tree row.
  - Why a vignette instead of command-center.mp4: that clip shows the Voice command center, which belongs to S2's message. S1's message (the rail, the bell, git) is told more exactly by the vignette, and this keeps every clip to one use.
- **S2 voice-and-apps**: mirrored layout, points left and the command-center.mp4 console right. The clip shows the Voice tab running a spoken command, which matches "Talk to the work."
- **S4 tribunal**: the tribunal-council.mp4 console left, points right. The clip shows the chat-native council, which matches "It is not a separate screen."
- **S3 pilot**: unchanged visually. Only its motion source and lightning accents changed.

Motion in numbers:

- Desktop: pin at `center center` for `+=110%`. The progress scrub starts at `top 70%` and ends at the pin's end.
- Thresholds: eyebrow 0.02, headline 0.06, subline 0.10, visual 0.16, steps 0.42 / 0.62 / 0.82.
- Compact screens: `top 85%` to `bottom 90%`, with no pin.
- Every animation is a one-shot transition or keyframe. There are no infinite loops and no per-item timers.
- The only observers are two IntersectionObservers per clip, released on destroy.

Accessibility:

- Every section uses `aria-labelledby` pointing at its h2.
- Vignettes and threads are `aria-hidden`; the visible points are the text equivalent.
- Clips have an `aria-label`. The play/pause button has a label and a visible focus ring.
- Under reduced motion or save-data the clip never autoplays and shows native controls.
- Text contrast: `#fff` and `#e9ebef` on `#08090c` are about 18:1; amber `#ffbb4d` eyebrows are about 11:1.

### References

The `awwwards` MCP server was **not available** in this session; no `mcp__awwwards__*` tools were listed. No external references were used. Structure and motion come from the hero and the pilot.

## Screenshots

Each folder under `.ptah/specs/TASK_2026_878_eae4/phase-1-shots/` (`command-center`, `voice-and-apps`, `decision-loop`, `tribunal`) has these frames:

- `desktop-mid.png`: pinned, mid-build, at 1440x900.
- `desktop-final.png`: settled.
- `desktop-seam.png`: the seam thread from the section above.
- `mobile-mid.png` and `mobile-final.png`: at 375x812.

The capture script is `C:/Users/abdal/AppData/Local/Temp/p1cap/cap2.mjs`. It is a variant of the supplied `cap.mjs` that takes viewport shots at computed pin positions, because the sections are pinned.

What the shots show:

- The desktop mid frames show the reading order: S1 has tiles built with point 1 lit; S2 has the console in with point 1; the pilot loop is at stage 04.
- The final frames show all points lit and the rail fully charged.
- On mobile, the seam thread continues straight down from the hero's bolt into S1.
- No horizontal overflow at 375.

## Verify

`npm run verify -- -t lint,typecheck,test -p web-landing,ptah-landing-page`: RESULT_PLACEHOLDER

## Not done / follow-ups

- **`#features` anchor.** It still belongs to the old pillars section. S1 carries only `#command-center` because a duplicate id is invalid. Move `#features` to S1 when Phase 2 removes the pillars section.
- **Pinning order.** The four pinned sections rely on ScrollTrigger refreshing triggers in creation order, and they are created in page order. If the new hero adds or removes its own pin later, check the seams again. A `ScrollTrigger.refresh()` after the hero changes may be needed.
- **Copy decisions superseded.** Copy decision 8 placed command-center.mp4 in both S1 and S2. Each clip is now used once (owner rule), and S1 uses the vignette.
- **Spark visibility.** The pilot's spark is small and partly covered while it passes under a stage card. It is a subtle accent by design.

## Decisions

1. **Decision:** Shared section kit under `sections/shared/`: header, scroll helper, charge thread, step points, clip console, frame CSS.
   **Options:** Copy the pilot's header, frame and ScrollTrigger code into each section.
   **Evidence:** Three new sections plus the pilot use the same header, motion and rail. That is more than the repo's three-uses rule.
   **Reversible:** Yes.
2. **Decision:** command-center.mp4 goes to S2, and S1 uses a markup vignette.
   **Options:** The clip in S1 with S2 as a vignette; the clip in both.
   **Evidence:** Owner rule: each clip is used once. The clip's frame shows the Voice tab running a command (`command-center.jpg`), which is S2's subject.
   **Reversible:** Yes, by swapping the two visuals.
3. **Decision:** Desktop pins at `center center` instead of `top top`.
   **Options:** `top top` (would cut the lower part of sections taller than the viewport); no pin.
   **Evidence:** A section is about 1,000px tall at 1440x900. With a centre pin, the overflow falls inside the vertical padding.
   **Reversible:** Yes, it is one string in `section-scroll.ts`.
4. **Decision:** The clip plays at 90% visibility and pauses below 50%, and loads lazily (`preload="none"`, poster only within one screen).
   **Options:** Play on any intersection; eager poster.
   **Evidence:** Owner: "starts playing when it is fully in view (and pauses when it leaves)". Lazy-load was requested.
   **Reversible:** Yes, two constants.
5. **Decision:** The lightning thread is SVG charged with `clip-path: inset()`, and a strike is a one-shot keyframe on a re-created element.
   **Options:** A canvas `requestAnimationFrame` loop like the hero; `pathLength` dashes.
   **Evidence:** A canvas loop per section costs frames for decoration. `pathLength` dashes broke under `vector-effect: non-scaling-stroke` in Chrome (seen in a screenshot). The clip-path version renders correctly and costs nothing at rest.
   **Reversible:** Yes.
6. **Decision:** `hero-lightning.ts` delegates to `shared/lightning-bolt.ts`, and `hero.component.*` stays untouched.
   **Options:** Copy the drawing code with a TODO to remove the duplicate later.
   **Evidence:** The drawing code is identical, existing imports still work through the re-export, and the hero's lightning specs pass.
   **Reversible:** Yes.
