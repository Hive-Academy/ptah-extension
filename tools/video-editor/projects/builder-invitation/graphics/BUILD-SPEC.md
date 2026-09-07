# Graphic build spec — builder-invitation

Every overlay in this job follows this contract. G07
(`g07-degradation-curve/`) is the worked example. Read its
`compositions/quality-over-time.html` before building anything.

## The deliverable

One HyperFrames project per beat, at
`projects/builder-invitation/graphics/<beat-id>-<kebab-name>/`, rendering to a
transparent ProRes 4444 MOV that drops onto video track 2 of the 60 fps Resolve
timeline `builder-invitation-cut`.

## Non-negotiable technical contract

| Rule         | Value                                                     | Why                                                                                                                 |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Frame rate   | `data-fps="60"` on the composition root in `index.html`   | HyperFrames **silently defaults to 30**. A 30 fps overlay halves the smoothness of a 60 fps timeline.               |
| Canvas       | 1920x1080                                                 | Matches the timeline.                                                                                               |
| Background   | `background: transparent` on `html, body`                 | The MOV carries alpha. A composition that paints an opaque body has no alpha to carry.                              |
| Caption band | Nothing may enter the **bottom 186px**                    | Reserved for Arabic captions across the whole video. Enforce with `padding-bottom: 186px` on the content container. |
| Pinned CLI   | `hyperframes@0.8.30`                                      | A version bump can change how a graphic renders. Bump deliberately, then re-render every overlay.                   |
| Render       | `scripts/render-overlay.sh <comp-dir> <absolute-out.mov>` | It asserts the rendered frame rate and the alpha channel and fails loudly. Pass an ABSOLUTE output path.            |

## Brand system

From `apps/ptah-video-studio/src/brand.config.ts`. Declare these as CSS custom
properties on the composition root. **No inline hex anywhere in the markup.**

```css
--ink: #08090c; /* base */
--ink-raised: #0e1015; /* radial centre of the backdrop */
--amber: #f5a524; /* primary accent */
--amber-light: #ffbb4d;
--amber-deep: #c97e0e;
--emerald: #34d399; /* second accent */
--emerald-light: #6ee7b7;
--text-strong: #ffffff;
--text-soft: rgba(255, 255, 255, 0.72);
--text-faint: rgba(255, 255, 255, 0.45);
--grid: rgba(255, 255, 255, 0.08);
```

Font: **Inter**, loaded from Google Fonts with `display=block`. Weights 400,
500, 600, 700, 800.

Wordmark `PTAH`. Tagline `ptah.live`. CTA `Get Ptah free`.

### The amber-on-orange collision

The A-roll background is an **orange wall** filling the left third of frame.
`--amber` sinks into it and disappears. Over A-roll, do one of:

1. Place the graphic on the RIGHT of frame, over the blue panel and window.
2. Lead with `--emerald` instead of `--amber`.
3. Sit the graphic on an `--ink` card with real elevation, so it never touches
   the wall.

Over B-roll (screen capture, near-black) there is no conflict.

## Language

**All on-screen text is English.** The narration is Arabic. Because the viewer
is already listening in one language and reading in another, keep cards short:
**maximum two lines, maximum six words per line.**

## Shot treatments

| Name            | What it does                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Takeover        | The camera shot leaves. The graphic owns the frame. Fade an `--ink` backdrop in over ~0.7 s and out over ~1.1 s so the cut back is not a pop. |
| Push-over       | Subject holds one third. The graphic takes the rest. Backdrop covers only its own side.                                                       |
| Face-in-graphic | The camera shot becomes an element inside the composition.                                                                                    |
| Screen-in-space | Screen capture on a plane in 3D. Camera pushes and tilts.                                                                                     |
| Punch and call  | Scale into a screen region, ring it, label it. Backdrop stays fully transparent — only the ring and label render.                             |
| Match cut       | A shape in the graphic aligns to a shape in the next shot.                                                                                    |

A `Punch and call` or `Screen-in-space` beat must sit on B-roll. A `Takeover`
or `Push-over` generally sits on A-roll.

## Composition rules (HyperFrames)

These are the ones that actually bit during G07.

1. **Root must be sized.** The element carrying `data-composition-id` needs
   `position: relative; width: 1920px; height: 1080px`.
2. **One paused timeline**, registered as
   `window.__timelines["<composition-id>"]`, ending with `tl.seek(0)`. Never
   `tl.play()`.
3. **Never measure inside a GSAP callback.** `getTotalLength()`,
   `getPointAtLength()`, `getBoundingClientRect()`, `getComputedStyle()` inside
   an `onUpdate` are seek-order dependent — the render worker seeks
   non-linearly with events enabled. Sample geometry ONCE at build time into an
   array, then index into it. G07's `sampleTrack()` is the pattern.
4. **Explicit `fromTo()` for anything that enters late.** `gsap.from()` is only
   safe for a non-clip element active from `t=0`.
5. **Count-ups tween a proxy object** via `onUpdate`, never a wall-clock
   counter.
6. **Deterministic only.** No `Date.now()`, no `Math.random()`, no network
   fetches.
7. **Match the SVG viewBox aspect to its CSS box.** A mismatch makes
   `preserveAspectRatio` letterbox the chart and shrink every label with it.
   Pin the box height and compute the viewBox to match.
8. **A host element with `data-composition-src` also needs
   `data-composition-id`.** Lint errors without it.
9. Allowed eases: `power1`-`power4`, `back`, `bounce`, `circ`, `elastic`,
   `expo`, `sine`, each `.in` / `.out` / `.inOut`.
10. **Several `fromTo()` tweens on ONE element need
    `immediateRender: false` on every one after the first.** GSAP resolves a
    `fromTo` from-value at build time, so the LAST one authored wins at `t=0`.
    An element with an entry tween and an exit tween renders in its exit
    from-state before the entry has started. Found in G05: a seam was fully
    open at 0.8 s, before its first tween at 1.34 s. `lint`, `check` and the
    motion pass all passed it. Only the contact sheet showed it.

## Reuse first

Check the registry before hand-authoring:
`npx hyperframes@0.8.30 add <block>`. Customize in place. If the block ends up
sharing nothing but its skeleton, rename the file honestly and record the
lineage in a header comment — do not leave a registry marker on a file that is
no longer that block. Delete any block file you installed and did not use.

## Verification gate — all of it, before reporting done

```bash
npx hyperframes@0.8.30 lint .
npx hyperframes@0.8.30 check .
npx hyperframes@0.8.30 snapshot --at <opening>,<signature move>,<final hold>
```

Then **look at `snapshots/contact-sheet.jpg`**. The automated gates passed a
version of G07 whose chart was scaled to 87% and floating in dead space, with
two label collisions. Only the contact sheet caught it. A build that has not
been eyeballed is not finished.

`check` must report 0 errors on lint, runtime, layout and motion, and all
contrast checks passing WCAG AA. The `composition_file_too_large` warning is
acceptable for one self-contained graphic; do not fragment a coherent
composition to silence it.

### Prove a reserved zone is empty — do not eyeball it

For any overlay that must keep a region transparent (the caption band, the
webcam picture-in-picture), measure the alpha channel instead of looking at a
thumbnail. A drop shadow's soft tail is invisible to the eye at contact-sheet
scale and still lands inside the zone.

```bash
# max alpha inside the region across one snapshot; expect 0
ffmpeg -v error -i snapshots/frame-00-at-0.8s.png \
  -vf "crop=1037:1080:883:0,alphaextract,signalstats,metadata=print:file=-" \
  -f null - | grep YMAX
```

Run it over every snapshot. `YMAX=0` is proof. Anything above 0 is a leak —
G02 measured 1/255 from a drop shadow and had to tighten its spread.
Prefer a shadow with a **negative spread** so its tail cannot reach the edge,
or no shadow at all.

## Placing overlays in Resolve (centralized — agents never do this)

**Two overlays whose frames touch must go on different video tracks.**
`AppendToTimeline` does not refuse an overlap. It butts the new clip against
the existing one and **silently trims the head**. Measured 2026-09-07: G08 was
requested at record frame 15180 for 1464 frames and landed at 15240 for 1404 —
one second cut off its front, including its whole fade-in, reported as
`success: true`.

The collision is easy to create because a graphic's rendered length is its
CONTENT plus its fade-out, while `beat-times.json` records only the content.
G07's content ends at 252.33 s but the file runs to 254.0 s, and G08's slot
opens at 253.0 s.

Rules:

1. Compute each overlay's real span as `in_s` to `in_s + rendered_duration`,
   not to `out_s`.
2. Where two spans touch, alternate tracks: V2, V3, V2, V3.
3. **Always read the track back** and compare `duration` against the file's
   `nb_frames`. A short clip is a silent truncation, not a rounding artifact.

## Do not

- Do not touch DaVinci Resolve or any MCP tool. Timeline writes are centralized.
- Do not run `scripts/render-overlay.sh`. Renders are serialized — one render
  uses 6 Chrome workers and the GPU, and parallel renders thrash 8 GB of VRAM.
  Build, verify, report. The renders are run centrally.
- Do not edit any file outside your own beat's folder.
- Do not use `apps/ptah-video-studio`. That is the Remotion showcase pipeline
  and it is a different flow.
