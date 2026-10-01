# Ptah promo playbook (HyperFrames)

How we compose advanced Ptah videos with the `ptah-ui` kit. It adapts the common "elite motion designer" blueprint to what HyperFrames actually supports, and it names the HyperFrames skill that owns each step.

## 1. Pipeline (gated, scene by scene)

| Phase | Output | Owner skill | Gate |
| --- | --- | --- | --- |
| 1. Brief | `BRIEF.md`: message, audience, length, aspect, music | `/hyperframes` intent layer | user confirms |
| 2. Tokens | `kits/ptah-ui/SPEC.md` §1-3 (anubis palette, type roles, eases). New video: only list deviations | `/hyperframes-creative` | user approves any deviation |
| 3. Storyboard | `STORYBOARD.md`, one `## Frame N` per scene: time on the beat grid, hook type, kit components, camera, transition | `/general-video` with `storyboard: yes` | user approves on the live board (`review-loop.md`) |
| 4. Scenes | one file per scene: `compositions/frames/NN-name.html`, mounting kit components | `/hyperframes-core`, `/hyperframes-keyframes` | `npx hyperframes check` + snapshot per scene, preview before the next scene |
| 5. Assembly | `index.html`: frames on tracks, `HyperShader.init` transitions, music + SFX | `/hyperframes-animation` transitions, `/hyperframes-audio` | `check`, `animation-map.mjs`, draft render |
| 6. Final | `node tools/hyperframes/render.mjs <project> <name> --4k` (writes `video-output/<project>/` in the main checkout) | `/hyperframes-cli` | user approves the Studio preview first |

Never write a 2,000-line monolith (v1/v2 did; lint warns `composition_file_too_large`). One scene per file keeps each file under ~250 lines and lets a scene be fixed without touching the rest.

## 2. Timing rules

- Pick the track first, run `npx hyperframes beats`, and put every cut on a bar and every entrance on a beat. Offset the music with `data-media-start` so the drop lands at 1-2 s, never after a quiet intro.
- Cadence Fast-Slow-Fast: hook 0-4 s (a slam per beat), feature deep dives (one idea per 4-6 s, slow camera drift, UI states playing out), outro (slams + lockup on the last bars).
- HyperFrames timing is `data-start` / `data-duration` on clips plus ONE paused GSAP timeline per composition. Give every timed visual element `class="clip"` (the shared `.clip` CSS supplies its full-frame box). Register the root timeline with `window.__timelines = window.__timelines || {}; window.__timelines["<composition-id>"] = tl;` so the runtime can seek it; scene timelines added to that root must not be paused, or they will not advance when the root is seeked. There is no `data-time` attribute. Kit components take `cues` (seconds from mount start) so their internal beats lock to the grid.

## 3. Layers (per scene)

1. Background: flat `#131317` + one static element (vignette or perspective grid). No drifting blobs (rejected in v2 review).
2. Product UI: `ptah-ui` kit components, usually inside `app-window` slots. Real product UI, never screenshots or generic cards.
3. Kinetic type: Archivo Black / Inter headlines, 60-120 px, one idea per line.
4. VFX: shader transitions (`@hyperframes/shader-transitions`), `grain-overlay`, the kit's gold focus ring.

## 4. Motion rules

- Eases: `expo.out` for camera landings and type slams, `power3.out` for UI settles, `back.out(1.6)` for chips/badges. Elastic/bounce: only on type slams, never on product UI (it reads cheap on real UI; SPEC §3.1).
- Stagger: 0.05 s for split text, 0.09 s for UI rows and chips.
- Camera: animate a non-timed wrapper around mounted components (scale/x/y). Punch-in on the part that carries the story, and fire that component's `focus` beat at the same time.

## 5. Hook recipes (first 3-5 s)

| Hook | Recipe with our tools |
| --- | --- |
| A. Glitch-to-clarity | `app-window` mounted at camera scale 3.5 on one part (e.g. a `tool-call-row` badge). Chromatic split + blur on the wrapper (`chromatic-glitch` rule, `filter` numeric tweens) drive to 0 over 1.2 s while the camera goes 3.5 → 1.0 (`expo.inOut`), landing on the drop. Or a `glitch` shader transition into the clean frame. Do not hand-write Three.js for this. |
| B. Kinetic smash | `kinetic-beat-slam` rule: three words, one per beat. The last word becomes a mask (SVG `clipPath` with the text) over a live kit scene, then the clip scales out to full frame. `background-clip: text` works only for image/video fills, not live DOM. |
| C. Micro-interaction macro zoom | `composer` at camera 2.0 on the send button: prompt types, send press (`K.press`), `cursor-click-ripple` shockwave, then `zoom-out-workspace-reveal` blueprint to `app-window` 2+2 with sessions coming alive. |

## 6. Feature scenes ("living mockups")

Everything that the product does live, the kit does live: tool rows run pending → running → done, prose streams, subagents take a "Message agent" press, lanes report, the Peer dialog reaches "Accepted". Charts or counters: `stat-bars-and-fills`, `counting-dynamic-scale`, `svg-path-draw` rules.

## 7. Quality gates (every scene, then the film)

- `npx hyperframes check`: 0 errors (layout overlap, contrast, runtime). Mark intentional overlap only with `data-layout-allow-overlap` on the exact element.
- Snapshot at each beat that matters and read it. `check` cannot see shader transitions: draft-render and read frames at every transition.
- `*.motion.json` sidecar per scene (`appearsBy`, `before`, `keepsMoving`) so `check` verifies motion intent.
- Every on-screen claim is true to the code (cite it in `BRIEF.md`). Copy rules from SPEC (e.g. Peer says "Accepted", never "delivered").

## 8. HyperFrames surface we use

| Surface | Status |
| --- | --- |
| Skills `/hyperframes`, `/general-video`, `-core`, `-creative`, `-animation`, `-registry`, `-cli`, `/media-use` | used (routing, contract, transitions, catalog + `add`, lint/check/snapshot/beats/render, logos and SFX) |
| `/hyperframes-keyframes` | to adopt for camera moves (we hand-rolled them) |
| `/hyperframes-audio` | to adopt for ducking, EQ and a SFX bus (we only used volume lanes) |
| Storyboard review loop, `*.motion.json`, recipes (`recipe.mjs`) | to adopt next video |
| HyperFrames MCP (HeyGen hosted) | compose/render are disabled for CLI agents by design; only read tools (projects, render status). Use it only to publish or cloud-render a project; authoring stays local |
