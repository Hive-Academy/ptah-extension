# Design review - TASK_2026_700_dcce

Verdict: REVISE

Reviewer: Anthropic in-process cross-side reviewer. Author: codex CLI lane. Scope: design-spec.md, prototype/README.md, 15 screenshots, parity-inventory.md, compared with the target renders in `C:/Users/abdal/AppData/Local/Temp/cc697/proto/`. Code was spot-checked. No builds or tests were run.

Summary: the fidelity to the target renders is good. The dark-speaking, dark-approval and light-24-nodes states are close to the target, and the surroundings, header, rail and dock now read as one page. The parity mapping covers all 39 rows. REVISE is driven by two broken layouts at 900px (stats strip over the scene, dock controls overlapping), a start view that invents data and duplicates the current session, and several prototype strings with no data source.

Counts: Blocking 2, Serious 4, Moderate 5, Minor 3.

## Findings

1. **Blocking - Narrow dock layout is broken.** Evidence: `screenshots/light-narrow.png`, 900px. The Mute and Stop buttons draw on top of the waveform, the command input is squeezed to "Or type a c", and the speaker and send controls overlap. "Resume last" wraps to two lines and the title wraps. Required change: specify the dock wrapping at 900px and 720px (mic and title row, then controls row, then command field full width). Recapture `dark-narrow` and `light-narrow` with no overlap. Add the 480px capture, which the spec describes but the folder lacks.

2. **Blocking - Stats strip overlaps the scene.** Evidence: `light-narrow.png` (the Cost, Tokens, Agents and Duration cells cover the OpenCode sphere and edge) and `dark-24-nodes.png` / `light-24-nodes.png` (the strip sits over the top arc, near Migration 7 and Migration 21). Required change: reserve a header band in the stage and have the scene layout fit its radius below that band, or collapse the strip to two columns or a single line at narrow widths. State the layout reservation in the spec, because `layoutScene` is the real constraint. Today the spec only says "stage header".

3. **Serious - Start view duplicates the current session.** Evidence: `dark-start.png` and `light-start.png`. "Release review" appears as the Current card and again as the first Recent card. Parity row 22 says the current card is placed before recent cards. Required change: exclude `coordinator.currentSessionId` from the recent grid, or mark that card "Current" instead of repeating it. The spec must state which one. Also fix the empty bottom half of the Current card (blank space under Resume), for example by putting the cost, tokens and activity figures there.

4. **Serious - Invented session identifier.** Evidence: the `SESSION CC-2048 · ACTIVE` pill in every screenshot and in `README.md`. The live code uses `sessionId.slice(0, 8)` or `new` (`command-center-page.component.ts:187`). Required change: label the sample as a short ID, for example an 8-character hex value, and say in the spec that the header shows `Session <8 chars>` or `new`. Remove "CC-2048" from the Current card text (`dark-start.png`).

5. **Serious - Prototype shows a "Recorded" badge on every card.** Evidence: `dark-start.png`, all four cards. In the app only the one session equal to `recordedSessionId` carries the mark. The code labels it "Command Center" (`command-center-start.component.ts:176`, `:302`), not "Recorded". Required change: show the mark on one card only, use the live wording, and make the spec's row 8/9 wording match.

6. **Serious - "History unavailable? Retry session list" banner has no data source.** Evidence: the dashed banner in `dark-start.png` and `light-start.png`, and spec parity row 9 ("history unavailable note"). In the code "History unavailable" is a per-card figure that appears only when `hasTranscript === false` (`cardFigures`, line ~295). Retry exists only on a failed `session:list`. Required change: show the per-card label on one card, and show the Retry state only inside the error-state frame of the Start view. Remove the permanent banner.

7. **Moderate - Card states with no source.** Evidence: `dark-start.png` shows COMPLETED, IDLE, ACTIVE and BUILD PHASE on recent cards. `ChatSessionSummary` has only `isActive` and optional `livePhase`. There is no completed or idle state. Required change: limit the sample to Active and a phase label, and show nothing otherwise.

8. **Moderate - Rail detail strings with no source.** Evidence: `Vendor: Grok`, `Owned by Ptah · Status visible in scene`, `Ordinary Ptah chat session · Head of engineering` and `Voice provider: LOCAL VOICE` in the Selected card (`dark-approval.png`, `dark-speaking.png`). None of these strings occur in the command-center components (grep for "Vendor:", "Owned by", "Voice provider" returned nothing). Required change: trace each to the node fields in `work-projection` or drop it. The spec's row 20 lists "provider, task, elapsed, phase, freshness, child figures", so the prototype should show those fields only.

9. **Moderate - Prototype states hard-code vendor names with no stated rule.** Evidence: the rail rows and plates show "Codex", "Grok", "OpenCode", "Antigravity" and "Glm". These are real provider labels for lanes, so they are acceptable. But `README.md` says provider names are illustrative, and the spec has no rule for the unknown-provider case beyond a monogram. Required change: say that the label comes from the node's provider and that an unknown one shows a monogram and the raw id.

10. **Moderate - Light-theme state ink and contrast notes need a recheck.** Evidence: `design-spec.md`, Contrast checks. Running ring in dark measures 4.17 and failed 4.07, which pass 3:1. But `light-approval.png` and `light-24-nodes.png` show white-tinted plates over the stage, and the measured pairs are against base pixels only. The spec admits this ("Recheck ... composed translucent cards"). Required change: measure the plate-text pairs (plate text on the plate fill, the Off canvas chip, the 10px mono badges in muted ink) and record them. Small mono labels at 10px must pass 4.5:1.

11. **Moderate - Rail width and empty space.** Evidence: `dark-speaking.png` and `dark-idle.png` leave a large blank rail area under Delegated work, while `dark-tribunal-confirm.png` and `light-24-nodes.png` clip the list ("Judge" cut off). Required change: the spec should say the delegated card scrolls inside the rail with a fixed max height and a visible scroll cue, and that the empty rail area is acceptable or filled by guidance.

12. **Minor - Feasibility notes pass but should be explicit.** Evidence: lucide names `CircleGauge`, `Clock3`, `Coins`, `Diamond`, `MicOff`, `Bot`, `Sparkles`, `Terminal`, `Shield`, `Activity`, `Play`, `Send`, `Plus`, `Square`, `Check`, `X` all exist in `node_modules/lucide-angular/icons`. `AudioLines`, `History`, `LoaderCircle`, `MessageCircleQuestion`, `RotateCcw`, `ShieldAlert`, `Slash`, `Volume2`, `Hash` are already used in `libs/frontend`. Required change: none beyond noting that the first group is new to the app, so the implementer registers them in the icon provider.

13. **Minor - Header has two controls that are not in the app.** Evidence: the "Preview state" select and "Demo" button are labelled prototype only, but they occupy the header region in every screenshot, and `dark-idle.png` (user target) has the same. Required change: none, but keep them out of the final-look screenshots the user approves, or visually mark them as dev controls.

14. **Minor - Light small gold labels.** Evidence: the spec says the light `secondary` gold measured 3.67 on cards and moves labels to `secondary-focus` (5.15). Correct and consistent with `tailwind.config.js:165-166`. Required change: confirm in the implementation plan that the same swap applies to the "Approve" button fill text and to the eyebrow labels in the rail. The light Approve button (`light-narrow.png`) shows white-ish text on a dark gold fill that should be measured too.

## Checks that passed

- Parity: all 39 inventory rows have a concrete new location in the spec's mapping table. Nothing is silently dropped or marked removed. The drag-to-tilt and FPS readout removal is justified because `command-scene.component.ts` has no such code.
- Fidelity: `dark-speaking`, `dark-approval` and `light-24-nodes` match the target renders (sphere, dotted halo, plate, rail, one dock bar, icons on plates, provider marks, state icons in rows). The user's complaints (detached, few icons, not following the design) are addressed.
- Token use: the colors come from the `anubis` and `anubis-light` themes (`tailwind.config.js:87-88`, `:165-166`). The spec uses `text-base-content-muted` and bans `text-base-content/NN`.
- Canvas rules: Canvas 2D only, inks resolved once per theme change, sprite caching, DPR cap 2, rAF only while animating, and reduced-motion gates are all stated.
- Keyboard and aria paths: the inventory notes are carried over unchanged (plate Enter/Space/Escape, list Arrow Up/Down, Tribunal Confirm guard, polite and assertive live regions).

## Required before Gate 1.7

Fix findings 1 to 6 and recapture the affected screenshots. Fix 7 to 11 in the same revision. The reviewer can re-check the revised narrow, start and rail screenshots quickly.
