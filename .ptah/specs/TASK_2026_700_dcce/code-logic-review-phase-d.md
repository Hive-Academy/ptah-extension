# Code Logic Review, Phase D (D1 layout, D2 scene/renderer, D3 overlay) - `TASK_2026_700_dcce`

Reviewer: Anthropic-family independent reviewer. Source read in full: `scene-layout.ts`, `command-scene.component.ts`, `command-scene-renderer.ts`, `command-scene-decoration.ts`, `command-overlay.component.ts/.css`, plus the two failing spec cases and the prototype plate builder. Nothing was run (per instructions); orchestrator results are taken as given. All paths below are under `libs/frontend/command-center/src/lib/`.

## Summary

| Metric | Value |
| --- | --- |
| Verdict | **NEEDS_FIXES** |
| Score | 6/10 |
| Blocking | 0 |
| Serious | 3 (defects 1, 2, 4) |
| Moderate | 4 (defects 5, 6, 8, 9) |
| Lint / test gates | lint warning (file length) and 2 failing specs, both fixable in test or file layout |

Solid: recursion terminates (visible set is built from valid ancestor chains with a visited set, scene-layout.ts:99-117, so `owningChild` at :146 cannot loop and the `pending` queue at :316 adds each child once). The sceneRect math reserves the band once (command-scene.component.ts:178-190: top = reservedTop + 10, bottom = height - 62; layout adds only the 6px plate inset). Root is at rect midpoint (:131-132). Tether endpoints are read from the final placed points (scene-layout.ts:252-266) so they equal sphere centres after packing. rAF is demand-driven (renderer.ts `active` + `invalidate`), hidden tabs cancel the frame, DPR is capped at 2, backdrop and link gradient caches key on size, DPR, theme and rect, and teardown disconnects both observers and removes all listeners (component.ts:431-448). ResizeObserver is guarded (:350). No `innerHTML` in the overlay; D9 holds (no navigation, pin only shows read-only detail).

## Defects (numbered, each with location and fix)

1. **SERIOUS - plates are never placed directly below their own sphere (rect mode).** `scene-layout.ts:173` makes the first candidate `y = sphere.y + radius + 8`, but `overlapsSphere` (:218-223) tests every sphere including the plate's own, with exclusion `radius + 12` (or `rootRadius + 32` for the root). 8 < 12 and 8 < 32, so the "below" candidate is always rejected and the next candidate in the rect order `[below, rightSide, leftSide, above]` (:177) wins. Result: plates land to the right of their sphere. This contradicts design-spec line 63 ("Place the Ptah plate directly below its sphere") and plan D1 ("starts below its own sphere radius plus at least 8px"). No test asserts "below", which is why it passed. Fix: in rect mode skip `other === point` in `overlapsSphere`, and replace it with an explicit own-sphere gap check of `>= 8` (for the root use the same `rootRadius + 24` voice-ring clearance, i.e. set the root `below` offset to `radius + 32`). Add a spec in scene-layout.spec.ts: for a sparse scene, each non-null plate has `|plate.x + w/2 - node.x| < 1` and `plate.y >= node.y + radius + 8`.

2. **SERIOUS - rect-mode root plate can be null.** The root fallback at `scene-layout.ts:230` is `!rect && ...`, so with a sceneRect (the production path) a crowded stage gives the Ptah node no `labelRect`, and the renderer then hides its DOM plate (renderer.ts display none), losing the context ring and the root's only accessible control on canvas. Because clamping failures `continue` at :209 instead of being accepted, any candidate set that fails collision yields null. Fix: add a rect-mode fallback that clamps below the root to `[left, right]` / `[top, bottom]` and ignores plate and sphere collisions (root has top priority, so it wins), then push it into `used`. Add a 24-node spec with `sceneRect` asserting root `labelRect !== null` (the existing 24-node spec at scene-layout.spec.ts:395 runs without `sceneRect`, so it does not cover the production path).

3. **(Folded into 1/2, minor)** `scene-layout.ts:203` clamps plate x to `viewport.width - 8` and `8` instead of the rect's `left`/`right` consts (:132-133). Equivalent today (rect.x = 0, width = viewport.width) but drifts if A2b ever supplies a non-zero x. Use `left`/`right` in rect mode.

4. **SERIOUS - tribunal lanes owned by a child lose their link to the tribunal core.** `scene-layout.ts:254` builds a tether for every node whose `owningChild` is set, so a lane under a child-owned tribunal gets a tether to the child. The renderer then skips the normal parent link for any node that has a tether (`command-scene-renderer.ts:324`, `tethers.some(... fromId ...)` followed by `continue`). The lane orbits its tribunal core (scene-layout.ts:343-354) but has no line to it and a silver line to the child instead: wrong ownership reading and wrong "child -> owned work" semantics (D4 M4). Fix: in layout emit a tether only when `point.node.parentId === owner.node.id` (direct child-owned work) or for kinds that sit on the child orbit; lanes keep their tribunal link. In the renderer replace `tethers.some(...)` (O(n) per node per frame) with a `Set<string>` of `fromId` built in `setSnapshot`. Add a spec: child -> tribunal -> lane yields tethers for the tribunal only.

5. **MODERATE - decorative orbit curves disagree with node placement.** `command-scene-decoration.ts:46-53` draws ellipses at `sceneRect.width * rx` / `height * ry`, but the layout clamps radii to `rect.width/2 - 44` and `rect.height/2 - 44` (`scene-layout.ts:158-163`). At 480px width (0.425 * 480 = 204 vs 196) and in short stages the curve passes outside the spheres. Fix: export one `orbitRadii(rect, many, inner)` helper from scene-layout.ts and use it in both places.

6. **MODERATE - magic `70` child orbit radius duplicated and not guaranteed.** Layout places owned nodes on a 70px ring (`scene-layout.ts:330`), the renderer draws the dashed ring at 70 (`command-scene-renderer.ts:353`). Clamping (:337-338) and the `outside`/`overlap` scoring (:332-336) can move nodes off the ring, so the ring is not what the nodes orbit. Fix: export `SCENE_CHILD_ORBIT_RADIUS` from scene-layout.ts and import it in the renderer; accept the visual drift or draw the ring only when all owned nodes are within 2px of it.

7. **LINT (must fix) - `scene/command-scene-renderer.ts` is 736 lines (max 700).** Move `drawStatus` and `drawVoiceRing` (renderer.ts:572-736, about 165 lines) into a sibling `command-scene-status.ts` exporting `drawStatus(context, node, time, snapshot)` and `drawVoiceRing(context, node, time, snapshot, voice)`; the class calls them. Keep `CHILD_SILVER_INK` in the renderer (imported by scene-contrast.spec.ts:2) or re-export it. Brings the file to about 575 lines.

8. **MODERATE - scene overflow pill sits inside the reserved band.** `command-scene.component.ts:104` hard-codes `top-12` (48px) while the stage band is 72/144/154px (reservedTop). The pill renders under the opaque band, so counts are hidden or clipped at every breakpoint. Layout already computes `overflowChip` coordinates but they are unused. Fix: bind `[style.top.px]="reservedTop() + 16"` (and drop `top-12`), or use `chip.x/chip.y` and base `y` on `sceneRect`. The rail's "Off canvas" text keeps parity row 18 regardless; confirm with A2b whether the scene pill should exist at all.

9. **MODERATE - theme change does not re-resolve inks by itself.** `command-scene.component.ts` resolves inks only in `initialize` and in the `data-theme` MutationObserver (:359-364). The `theme` input changing without the attribute flipping (page sets the input first, attribute later, or a host that sets `data-theme-mode`) leaves stale `--state-ink-*` until the next mutation. Fix: add `effect(() => { this.theme(); if (this.ready()) this.resolveInks(); })` (use `untracked` for `resolveInks`'s signal writes).

10. **FAILING TEST (a), `components/command-overlay.component.spec.ts:338-347`: the test is wrong, not the markup.** Plate textContent concatenates inline spans without whitespace ("C" + "Child session" + "Provider unknown" + " · " + "unknown"), and that is not what assistive tech reads: the button carries `aria-label="Child session, Provider unknown, unknown"` (overlay.component.ts:61), which replaces its content for screen readers. Do not add whitespace to the markup. Fix: assert `labels[1].getAttribute('aria-label')` equals `'Child session, Provider unknown, unknown'`, `labels[1].querySelector('.truncate')?.textContent?.trim()` equals `'Child session'`, and `labels[1].querySelector('.plate-meta')?.textContent?.replace(/\s+/g,' ').trim()` equals `'Provider unknown · unknown'`; keep the monogram assertion. The same pattern applies to the raw-id case below it.

11. **FAILING TEST (b), `components/command-overlay.component.spec.ts:492-498`: the test is wrong; the approved design has no provider mark on the Ptah plate.** The prototype builds the head as `n.kind==='root'||n.kind==='tribunal' ? svg(n.icon) : brandSvg(n)` (prototype/command-center.html:116) and the root meta is `HEAD OF ENGINEERING`; design-spec line 63 says the plate reads `Ptah · HEAD OF ENGINEERING`. Parity row 15/16 are about accessible plates and hover timing, not a root brand mark; the root's provider stays in the `sr-only` span (overlay.component.ts:118) and aria-label. Fix: change the spec to use a non-root plate with a registered provider: in that test set the projection to `[nodes[0], { ...nodes[1], providerId: 'codex' }]`, take `labels[1]`, assert `ptah-provider-mark` exists, `.truncate` text contains `'Beta'`, and `.truncate` does not contain the mark. Add one assertion that `labels[0].querySelector('ptah-provider-mark')` is null (root uses the Sparkles kind icon).

12. **MINOR - root plate aria-label omits context.** overlay.component.ts:61 builds `label, provider, state` for every plate; the visible `Context 62%` text and the ring are overridden (ring is `aria-hidden`). Screen-reader users never hear the root context. Fix: for `node.kind === 'root'` append `', context ' + (rootContextPercent() ?? 'unknown') + '%'` (omit `%` for unknown).

13. **MINOR - tone is independent of percent.** `rootContextTone` is trusted as passed (overlay.component.ts:~127); percent 85 with tone `'normal'` draws a normal ring. The page owns the rule (<70 normal, >=70 warning) but the overlay could not detect a drift. Optional hardening: compute `effectiveTone = percent >= 70 ? 'warning' : 'normal'` in the overlay and ignore the input, or add a spec that fails if the page and overlay disagree. Also clamp displayed percent: `Context {{ rootContextPercent() }}%` prints out-of-range or NaN raw (ring clamps, text does not).

14. **MINOR - `prepareBackdrop` throws inside an Angular effect.** `command-scene-renderer.ts:228` `throw new Error('Canvas 2D context unavailable')` runs from `setSnapshot`, which the scene effect calls (component.ts:262), breaking the effect graph if the offscreen canvas context fails. Return early and skip the backdrop instead (the main canvas already reports `canvasUnavailable`).

## Five logic questions

1. **Silent failure.** Defect 2 (root plate silently null, DOM plate hidden) and defect 4 (lane silently loses its tribunal line). Missing plates are `display:none` with no counter beyond overflow counts, so dense omission is invisible to keyboard users (pre-existing design).
2. **Unexpected user action.** Resizing across the 1100/480 band thresholds reflows `reservedTop` and relays the scene; plates move because the label measurement round trip (overlay -> ResizeObserver -> `setOverlayLabels`) converges in one extra pass (checked, no loop). Pin then Escape then focus restore is unchanged and intact.
3. **Wrong answer from data.** A stage narrower than 480 or shorter than ~250px makes the decorative ellipses (defect 5) disagree with the spheres; `rootContextPercent` out of range prints raw (defect 13).
4. **Dependency failure.** No ResizeObserver: guarded, one resize only. No 2D context: main canvas emits `canvasUnavailable`; offscreen backdrop throws (defect 14).
5. **Missing, unmentioned.** Test that asserts "plate below sphere" (defect 1); root fallback in rect mode (defect 2); accessible context for the root plate (defect 12).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| D1 bounded rect, root centred, orbit clamps, 23-node budget and overflow counters | COMPLETE | Decoration disagrees with clamps (5) |
| D1 plate starts below sphere +8, 12px gap, top +6, edge 8, 900px Crucible rule | PARTIAL | Below never wins (1); Crucible rule holds only via generic sphere exclusion, which works |
| D1/D4 child-owned orbit, recursion, tether to child | PARTIAL | Lane-under-tribunal tether (4); ring radius duplicated (6) |
| D2 gold sphere/ring, halo, state rings, silver tether, child ring variants (live solid ring, unknown dashed + dim + CS) | COMPLETE | Verified renderer.ts:468-512 |
| D2 caching, theme invalidation, DPR cap, idle/hidden/reduced-motion rAF stop, teardown, RO guard | COMPLETE | Ink resolve on theme input (9); lint size (7) |
| D2 reservedTop -> rect (reserved once, foot 62) | COMPLETE | Overflow pill ignores band (8) |
| D3 plate content, 150/200ms hover, pin/Escape/focus restore, keyboard, reduced motion, no innerHTML | COMPLETE | |
| D3 context ring only when verified; tone normal <70 / warning >=70; no unconditional orange | COMPLETE | Tone not derived from percent (13) |
| D3 child plate silver GitBranch, "Child session / Provider unknown · unknown" | COMPLETE | Test (a) asserts wrongly (10) |
| D9 display-only children | COMPLETE | No navigation or tab copy found |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Ownership cycle / deep chain | YES | Visible filter with visited set; finite queue | none |
| Zero-size viewport | YES | Rect height clamped >= 0; nodes still placed | harmless |
| 24 nodes with sceneRect | PARTIAL | Budget and overflow preserved | root plate fallback missing (2) |
| 900px Crucible plate vs sphere | YES | Generic sphere exclusion | depends on defect 1 fix for the below candidate |
| Hidden tab / reduced motion | YES | Frame cancelled, `active` false | none |
| Theme flip | PARTIAL | Backdrop and gradients rebuild on theme; inks via MutationObserver only | defect 9 |

## Verdict

- Recommendation: REVISE (NEEDS_FIXES). Confidence: HIGH on defects 1, 2, 4, 7, 10, 11 (read from source; no run), MEDIUM on 5, 6, 8, 9.
- Top risk: the Ptah and delegate plates are not placed below their spheres in production geometry, and no test covers it.
- Required before acceptance: defects 1, 2, 4, 7, 10, 11. Recommended: 5, 6, 8, 9, 12. Optional: 13, 14.
