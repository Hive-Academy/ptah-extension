# Design review round 1 - TASK_2026_700_dcce

Verdict: REVISE (3 Serious, 0 Blocking)

Reviewer: cross-side reviewer. Scope: design-revision-1.md, design-spec.md, prototype/command-center.html, 17 screenshots (dark and light), target PNGs in `C:/Users/abdal/AppData/Local/Temp/cc697/proto/`, `libs/shared` types and `command-center-start.component.ts`. No build or tests run. I did not re-run the contrast scripts.

Summary: both round-0 Blocking items are resolved and fidelity to the approved look is good (gold ring, dotted halo, plate under sphere, edge glow, header, icons all match). Three Serious defects remain, and one of them (rail clipping) is a round-0 finding that was only partly fixed.

## Round-0 findings

| # | Sev | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Blocking | Resolved | `dark-narrow.png`, `light-narrow.png` (900px): title and mic row, then Mute/Stop/Status, then full-width command field and "Resume last"; no overlap. `dark-480.png`, `light-480.png` exist and show the same stacked dock. |
| 2 | Blocking | Resolved | Stats now sit in an opaque header band above the scene in `dark-24-nodes.png`, `light-24-nodes.png`, `dark-narrow.png`. Nothing from the strip covers spheres. Side effect: see N5. |
| 3 | Serious | Resolved | `dark-start.png`: Release review appears once (Current card); the recent grid holds API migration, Docs audit, Security pass. Cost, tokens and messages fill the card. Residual: about 100px of empty space under "Resume current" (Minor, N8). |
| 4 | Serious | Resolved | Header and Current card show `a4e91c20` (8 chars). CC-2048 is gone from all captures. |
| 5 | Serious | Resolved | Only the API migration card carries "Command Center", which matches `cardName` (`command-center-start.component.ts:~301`). |
| 6 | Serious | Resolved | Only the Docs audit card shows "History unavailable", which maps to `hasTranscript === false` (`cardFigures`, line 290). No permanent banner in `dark-start.png`. Retry exists only in the start-error state (listed in the preview select). |
| 7 | Moderate | Partially | Completed and Idle labels are removed, but "Build phase" is invented (see N1). |
| 8 | Moderate | Resolved | The selected card shows only Provider and Task. The old Vendor, Owned by, Ordinary Ptah chat session and Voice provider strings are gone from `dark-speaking.png` and `dark-approval.png`. Note N9 (duplicate subtitle). |
| 9 | Moderate | Resolved (spec only) | The unknown-provider monogram rule is in the spec and README. No screenshot shows an unknown provider, so I could not check it visually. |
| 10 | Moderate | Resolved | `check-revision-contrast.js` and the contrast section of the spec list plate, chip, rail and Approve pairs, all above 4.5:1. I did not recompute them. |
| 11 | Moderate | Partially | A bounded scroller, visible scrollbar and "SCROLL LIST" cue exist, but the clipping and blank rail space the finding raised are still there (see N2). |
| 12 | Minor | Resolved | The spec has the Lucide icon-registration note. |
| 13 | Minor | Resolved | Preview and Demo controls are hidden in every capture and kept in the HTML. |
| 14 | Minor | Resolved | Light eyebrows use secondary-focus. Light Approve in `light-narrow.png` is white on dark gold, measured 6.15:1 per the spec. |

Orchestrator observations: (a) confirmed, N2. (b) confirmed, N3. (c) not a defect at 900px, see N6. (d) "History unavailable" is real; "Build phase" is invented, N1.

## New findings

### Serious

- **N1. "Build phase" is not a real value.** `dark-start.png` and `light-start.png`, API migration card: "Active · Build phase · Command Center". The live code renders `livePhase.replace(/-/g, ' ')` (`command-center-start.component.ts:275-278`). `SessionTurnPhase` is `generating | awaiting-background | sleeping | idle | failed` (`libs/shared/src/lib/types/execution/stream-background.ts:227`). The prototype's HTML, README and spec row 9 inherit the wrong string. Fix: use a real phase such as "awaiting background" or "generating", and update spec row 9 and the README to match.
- **N2. The Delegated Work card clips rows while the rail has free space.** `dark-speaking.png`: the card stops at about y=640, cuts the "Judge / reviewing" row in half, and leaves about 200px of empty rail below it. The same clip appears in `dark-approval.png` (Challenger), `dark-tribunal-confirm.png` (Judge), `dark-question.png`, `light-speaking.png` and `dark-24-nodes.png` (Tests 6). The approved target (`dark-speaking.png`) shows all seven rows with no clipping and the card sized to its content. Fix: the card takes the remaining rail height (`flex:1; min-height:0`, with `overflow:auto` inside) so it scrolls only when the content is taller than the rail. The 24-node state keeps the scroll cue. Recapture all affected states.
- **N3. The header context chip and the Ptah plate disagree.** `dark-approval.png`, `dark-narrow.png`, `dark-480.png`, `dark-24-nodes.png` and the light equivalents: the header says "Context 73%" (orange) while the plate under the sphere says "Context 62%". In the HTML, the chip text is set from the state (`73%` for `approval` and `24-nodes`, line 103) but the plate string is a literal `Context 62%` (line 110). Both read the same root context in production. Fix: drive both from one value and recapture. If the 73% warning is to be shown, the plate ring and text must show 73% too.

### Moderate

- **N4. 480px plates overflow.** `dark-480.png`, `light-480.png`: the Repository access plate truncates to "Reposit..." but its meta line "OpenCode · awaiting" starts outside the plate's left edge, and the "Release..." plate's "Grok · failed" overflows its right edge. The Electron `minWidth` is 800 (`apps/ptah-electron/src/windows/main-window.ts:119`), so 480 is a stress case. Either clamp plate text inside the plate, or state in the spec that 480 is outside the supported range.
- **N5. Top plate clipped by the band.** `dark-24-nodes.png`, `light-24-nodes.png`: "Migration 21" is cut off at the top of the scene band. The spec says projection is clamped to the scene rectangle, so the plate height must be included in the clamp.
- **N7. Start-card progress bars have no data source.** `dark-start.png`: each recent card shows a four-of-six gold segmented bar. `ChatSessionSummary` has no progress or ratio field. Remove it, or tie it to a documented field.

### Minor

- **N6. 900px composition is tight but not broken.** `dark-narrow.png`: the Ptah plate sits under the sphere (x 243-385) and touches the Crucible sphere's blue arc and sits 12px from the Crucible plate. The Release checks plate (x 478-589) ends 11px inside the stage edge. No clipping. Consider more clearance at this width.
- **N8. Blank lower part of the Current card** in `dark-start.png` (about 100px under Resume current), and about 250px of empty page under both start cards. Acceptable, but the card could align heights.
- **N9. Duplicate text in the Ptah selected card.** `dark-speaking.png`: "Your engineering orchestrator" appears as a subtitle and again as the body line.
- **N10. `dark-question.png` was rendered with a different font fallback** (wider mono, 928px tall) from the other dark captures. Recapture in the same environment.
- **N11. At 900px the waveform collapses to a row of tiny dots** at the left of the controls row (`dark-narrow.png`). It reads as a stray element. Give it a minimum width and a sensible position.

## Fixes required for APPROVE

1. N1: replace "Build phase" with a real `SessionTurnPhase` label, and update the spec, README and screenshots.
2. N2: let the Delegated Work card fill the rail height and scroll only when needed. Recapture the speaking, approval, question, tribunal and 24-node states in both themes.
3. N3: use one context value for the header chip and the Ptah plate in all states. Recapture approval, 24-nodes, narrow and 480.

N4, N5 and N7 should go in the same pass because they are cheap. The Minor items can be approved with notes.
