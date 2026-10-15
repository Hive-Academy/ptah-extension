# Design review (Gate 1.7) - Voice Command Center

- Author: codex CLI lane (ui-ux-designer role). Reviewer: independent cross-side reviewer (Claude).
- Artifact: `design-spec.md` + `prototype/command-center.html` + `prototype/README.md` + 36 PNGs, revision 3.
- Round: 3 (FINAL). Binding: `task-description.md` AC1-25, `context.md`, `decisions.md` #13 (no 3D libraries) and #14 (provider brand marks).
- Evidence: read spec, README, HTML source (`sprite`, `drawNode`, `draw`, `positionLabels`, `brandSvg`), 9 PNGs viewed (3 cropped and enlarged), PNG mtimes, and `libs/frontend/ui/src/{index.ts,lib/native/index.ts,lib/native/brand-mark/*,provider-mark/*}`.

## Rounds 1-2 summary

Round 1 (REVISE): five Serious items (clipped labels, missing state evidence, no N=24 frame, Tribunal without participants, Ptah voice ring hidden by selection). Round 2 (REVISE) accepted the pseudo-3D Canvas 2D rewrite (no 3D library, cached radial-gradient sprites) and closed those five, then raised three new Serious items: N1 label collisions with Ptah, N2 the 24-node frame, N3 the hot loop vs the performance budget. Moderate items N4-N11 were to be fixed in the same pass.

## Verdict: **APPROVED**

All three round-2 Serious findings are resolved in the rendered frames and the source. Decision #14 is implemented in the prototype (marks on orbs, chips and rail rows). No Blocking or Serious item is open. The Moderate items below do not need another design round, but R3-1 to R3-4 must land in the implementation plan, and the stale screenshots (R3-5) must be re-shot before the handoff.

## Round-2 Serious findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| N1 | Labels collide with Ptah, spheres and the voice ring | **Resolved** | `dark/light-failed-approval.png`, `dark-mid-demo.png`, `dark-tribunal-terminal.png`: the Ptah plate sits fully below the ring, no plate covers a sphere or ring, no node touches the Ptah ring. `positionLabels` tests four sides and rejects plate/plate and plate/sphere collisions, with a larger keep-out for Ptah. Residual touch at 24 nodes: R3-8. |
| N2 | 24-node frame: one colour, overlaps, unused stage | **Resolved** | `dark/light-24-nodes.png`: seven vendor hues (blue, teal, plum, red, jade, silver, gold) plus provider marks, no sphere overlaps, no sphere inside Ptah's ring, orbits scaled to the stage (inner `.235W`, outer `.425W`) and fill it. The palette map is now in the token table for both themes. Only 8 plates show plus the must-show ones; the list mirrors all 24 (acceptable, stated in the README). |
| N3 | Hot loop contradicts the budget | **Resolved (code); evidence caveat R3-6** | `getComputedStyle` runs only in `fit()` and the theme toggle. The only `fillText` is inside `sprite()` (cache miss). No gradient or `shadowBlur` in `draw`/`drawNode`. The meter is throttled to 2 Hz, draw ms is sampled with `performance.now()` (p95 over 90 frames), and the README reports the below-floor FPS honestly. |

## Decision #14 compliance

| Check | Result |
|---|---|
| Marks on agent orbs | Yes. Provider path drawn with `new Path2D(d)` into the cached sprite (`sprite()` brand branch), white on a dark inner disc (`dark-mid-demo.png` Codex and Grok orbs). |
| Marks in DOM chips and rail | Yes (`brandSvg`), plus a monogram span for unknown IDs. |
| Slug resolution | Matches the real table for the shipped IDs. The prototype's extra `glm` key does not exist in `PROVIDER_BRAND_SLUGS`; see R3-9. |
| Subagents and participants | Marks and names are present. Sessions use the parent mark (24-node frame). Tribunal satellites use the parent marks. Legibility and naming gaps: R3-3, R3-10. |
| Monogram fallback | Specified (`two-letter monogram on the vendor-colour disc`) and coded in `sprite()`. Not exercised in any frame (R3-11). |
| Path data stays in TS | Yes. Spec `## Angular binding` and README both say path data stays in TypeScript and that only the standalone prototype inlines it. |
| Public exports | **Spec is wrong, R3-1.** `PROVIDER_BRAND_SLUGS` is already public: `lib/native/brand-mark/brand-slugs.ts`, re-exported by `lib/native/brand-slugs/index.ts`, `lib/native/index.ts:44` and `src/index.ts`. `PROVIDER_BRAND_ART` is **not** exported from `@ptah-extension/ui` (only `MarkArtwork` types, `ProviderMarkComponent` and `MarkSvgComponent` are). |

## Orchestrator observations

- **Codex icon in the "Architecture" chip (confirmed, with a correction).** The crop of `dark-mid-demo.png` shows the real Codex mark (cloud with a `>_` prompt), not a different glyph, but it is painted in gold fill (`.brand-art{fill:currentColor}` under the gold chip ink). It reads as a yellow blob at 14px. On the orb the same path is white-on-dark and legible, and in the rail it is blue on a blue tile, so one vendor mark appears in three colours across the surfaces. The Grok, OpenCode and Antigravity chip marks are tinted gold too. See R3-2.
- **Tribunal "T" monogram (confirmed).** `brandFor()` returns `''` for `tribunal`, so `drawNode` passes the fallback `'T'` and the orb face shows a serif "T" (`dark-mid-demo.png`, `dark-tribunal-terminal.png`). Chips and rail rows use the Lucide shield instead. The same group therefore has two identities. It is not a brand-mark violation (a Tribunal has no single provider), but a monogram reads as a missing provider. See R3-4.

## New findings

### Moderate

1. **R3-1 Public-export plan is incorrect (spec `## Angular binding`).** It says to add exports for both records to `lib/native/brand-mark/index.ts`. That is wrong twice. `PROVIDER_BRAND_SLUGS` is already public, and `brand-mark-barrels.spec.ts` pins `brand-mark/index.ts` to exactly `['BrandMarkComponent']` (R7: the barrel pulls the full artwork table into the initial chunk). Correct plan: export `PROVIDER_BRAND_ART` (it imports only a type, so it is eager-safe) through an artwork-light barrel such as `provider-mark/index.ts`, extend the barrel guard, and keep `src/index.ts` and `native/index.ts` star-only lists.
2. **R3-2 Chip mark colour.** Marks in plates and chips take the gold chip ink, which loses vendor recognition and is unreadable at 14px. Use the lit/rim colour of the node's vendor palette (or the text ink at a 14px minimum) and use one colour rule across plate, chip and rail.
3. **R3-3 Tribunal satellites are illegible.** Satellites are 25px with a 0.59 inner disc, so the mark is about 5px (`dark-mid-demo.png`: three coloured specks). Identity depends on the 9px chips under the plate. Make satellites at least 32px or drop the inner disc, and put the parent mark at least 12px in the participant chips.
4. **R3-4 Tribunal core face.** Replace the "T" monogram with the same Lucide shield used in the list and chips (stroke path baked into the sprite), so the group has one identity. Keep monograms for unknown providers only.
5. **R3-5 Stale screenshots.** 12 of 36 PNGs predate the revision-3 HTML (13:52): `light-missing-provider` (13:29), `dark/light-mic-denied`, `dark-missing-provider` (13:45), and all `*-transcription/playback/chat-error` and `*-error` (13:47). `dark-error.png` shows plain unmarked spheres and Lucide terminal chips, contradicting decision #14. The README states that all PNGs reflect the current prototype. Re-shoot all 12.
6. **R3-6 Performance numbers do not bound the shipped PNGs.** README: p95 draw 2.6-3.7ms. The meters in the shipped frames read 0.7ms to 5.4ms (`light-24-nodes.png` 5.4ms at 31 FPS, `dark-24-nodes.png` 1.7ms at 33 FPS). Report the observed range, and note that draw ms excludes DOM compositing. The prototype has two `backdrop-filter:blur(16px)` surfaces over an animating stage, and the 24 plates are repositioned each frame. The README's cause for the FPS miss ("browser scheduling") is a hypothesis, not a measurement.
7. **R3-7 Electron gate has a criterion but no procedure.** Spec and README define p95 draw <= 8ms and a 30 FPS floor at N=24, 1280x720, integrated GPU, and say headless numbers do not count. Not defined: where it is measured (dev-only meter or a Performance trace in the Electron renderer), sample length (suggest 10s warm, light and dark), who runs it, and the pass artifact. Also require frame time from a trace (draw plus raster and composite), not draw ms alone. Add this as a named acceptance task with an owner in the implementation plan. CLAUDE.md bars `e2e`/`serve` runs without user approval, so the plan must say the user runs it.

### Minor

8. **R3-8 Plate touches ring at 24 nodes (light).** In `light-24-nodes.png` the "Release checks 23" and "Release checks 16" plates abut a sphere halo despite the 12px rule. Probably drift between label pass and draw. Verify in implementation.
9. **R3-9 `glm` slug alias.** The prototype maps `glm` to the Ollama mark. `PROVIDER_BRAND_SLUGS` keys are provider IDs only, so production must resolve from the lane's provider ID and never from the vendor display name. State this in the binding (the spec already says "provider ID before model or display name"; add that no new key is added to the shared table).
10. **R3-10 Child-session chip naming.** Spec: `Codex · Builder`. The 24-node prototype shows `Session · stopped` with the Codex mark. Show the parent provider name next to the session name.
11. **R3-11 No monogram frame.** Add one unknown-provider node to the 24-node or idle-demo frame so the fallback is reviewable.
12. **R3-12 DOM component choice.** The spec binds `<ptah-brand-mark>` (needs the full artwork table, lazy-only per R7). `<ptah-provider-mark [providerId]>` is already public, resolves `PROVIDER_BRAND_SLUGS` plus `PROVIDER_BRAND_ART`, and supports mono paint, which fixes R3-2. Prefer it for provider IDs and use `MonogramTileComponent` for unknowns; the decision #14 wording is otherwise satisfied.
13. **R3-13 Frame-loop hygiene.** `drawNode` rebuilds the sprite cache key (`join`) per node per frame, and `positionLabels` reads `offsetWidth/offsetHeight` per label per frame (forced layout after style writes). Cache keys per node and label sizes per layout. Carried from round 2 and still valid: N12 (Angular binding details), N14 (light stage separation), N15 (rail height).

## Coverage against acceptance criteria

Designed and rendered: AC3, AC4, AC6, AC10, AC11, AC14, AC15, AC17, AC18, AC21, AC22, AC23. AC20: budget stated, headless evidence weak (R3-6, R3-7). AC16: restart offer named, preview is a button label only. AC7-9: copy only. Not visual: AC1, AC2, AC5, AC12, AC13, AC19, AC24, AC25.

## Lane-introduced constraints

Designer-proposed rules the user should confirm (README lists five; these are the additional ones in the spec):

- [lane-proposed] Layout: 72px header, 336px rail, 600px minimum desktop stage, stack below 720px.
- [lane-proposed] Sizes: Ptah 154px, delegate 58px, Tribunal 70px with 25px satellites (R3-3 asks to enlarge).
- [lane-proposed] Seven vendor hues (blue, teal, plum, red, jade, silver, gold) as the lane palette, in addition to the provider mark.
- [lane-proposed] Scene cap of 24 nodes; beyond that, oldest completed items collapse into a count chip and remain only in the list. This removes scene items and is user-reserved scope.
- [lane-proposed] At N>12, plates show for Ptah, selected, awaiting and failed nodes plus five others; the rest are tooltip/list only.
- [lane-proposed] Drag tilts the orbit plane +/-18 degrees; 11px minimum plate and HUD text; 44px primary targets.
- [lane-proposed] Performance numbers: 60 FPS target, 30 FPS floor, p95 draw <= 8ms, 16 particles, 48 dots, DPR <= 2, 24MB backing.
- [lane-proposed] Separate voice ring and selection halo; Stop is never disabled while a turn can be aborted.
- [lane-proposed] Unknown provider IDs show a two-letter monogram on the vendor-colour disc.

Project rules carried over: [project-rule] Canvas 2D and CSS transforms only (decision #13); provider marks from `PROVIDER_BRAND_ART` and `PROVIDER_BRAND_SLUGS` with path data kept in TypeScript (decision #14).
