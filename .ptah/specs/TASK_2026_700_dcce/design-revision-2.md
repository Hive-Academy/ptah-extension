# Command Center Voice — design revision 2

This final revision resolves the ten findings in the round 2 brief. The revised `prototype/command-center.html` is the interactive source, and all 19 named captures were regenerated with `prototype/capture-screenshots.js`. Preview and Demo controls are hidden in the captures. Gate 1.7 still requires cross-side acceptance.

| Finding | Change made | Where | Capture showing it |
| --- | --- | --- | --- |
| S1 — rail sizing | Rail matches stage plus dock height; upper cards retain natural height; Delegated Work fills the remainder with `flex:1 1 auto; min-height:0; overflow-y:auto`. Removed the 330px cap. Cue and last-row fade appear only on overflow. Updated parity row 21. | `design-spec.md` Layout and parity 21; prototype rail/work CSS and `alignRail()` | `screenshots/dark-speaking.png` (filled rail, no cue); `screenshots/dark-24-nodes.png` (cue and faded clipped row) |
| S2 — one Context value | Header chip and Ptah plate use the same `contextValue` in each scenario. The implementation handoff uses `contextCue()`; unknown renders “Context unknown” in both places and omits the plate ring. | `design-spec.md` Layout; prototype `refresh()` and `makeLabels()` | `screenshots/dark-approval.png` and `screenshots/light-24-nodes.png` (matching 73%); `screenshots/dark-idle.png` (matching 62%) |
| S3 — recent age bars | Removed six-segment bars from recent session cards and their CSS; revised start-view copy and parity row 9. | `design-spec.md` start view and parity 9; `prototype/command-center.html`; `prototype/README.md` | `screenshots/dark-start.png`, `screenshots/light-start.png` |
| N1 — live phase wording | Sample recent card now says “generating,” one of the actual `livePhase` values; removed the stray “Build phase” phrase from the Tribunal sample subtitle. The spec lists the five actual values. | `design-spec.md` start view and parity 9; `prototype/command-center.html`; `prototype/README.md` | `screenshots/dark-start.png`, `screenshots/light-start.png` |
| N2 — upper plate bounds | Plate placement includes full plate dimensions in the scene clamp, with a 6px top inset, and keeps dense overflow counted in the foot chip. “Migration 21” is visible below the header. | `design-spec.md` scene placement; prototype `placeLabels()` | `screenshots/dark-24-nodes.png`, `screenshots/light-24-nodes.png` |
| N3 — wide stage header | At 1100px and above, caption and four stat chips share a 72px row. Below 1100px they use two rows; the scene keeps its sphere scale and centered placement. | `design-spec.md` Layout; prototype stage CSS and scene rectangle | `screenshots/dark-speaking.png` (wide); `screenshots/light-narrow.png` (900px) |
| N4 — selected-card repetition | Ptah’s selected card omits a body line that repeated its subtitle. A lane Task line renders only when task text differs from subtitle. | `design-spec.md` parity 20; prototype `select()` | `screenshots/dark-speaking.png` (Ptah); `screenshots/light-narrow.png` (lane) |
| N5 — current cost source | Retained the Current card Cost cell using the real live-tab `currentStats()?.totalCost`, with `knownSubtotalOf(currentStats())` fallback. `ChatSessionSummary` has no cost field, so recent cards have no cost cell. | `design-spec.md` start view and parity 8; `prototype/README.md` | `screenshots/dark-start.png`, `screenshots/light-start.png` |
| N6 — narrow plates | Lane plates size from their content up to available scene width; names such as “Repository access” remain intact at 480px. Plates keep at least 8px edge clearance; the Ptah plate stays below its sphere and clears Crucible at 900px. | `design-spec.md` scene placement; prototype plate CSS and `placeLabels()` | `screenshots/dark-480.png`, `screenshots/light-480.png`, `screenshots/light-narrow.png` |
| M-2 — waveform | Speaking waveform sits in the dock title row beside the status text at 900px and 480px; it is hidden for all other voice states. | `design-spec.md` dock Layout; prototype dock markup, CSS and `updateVoice()` | `screenshots/dark-narrow.png`, `screenshots/dark-480.png` (no stray dots while idle); `screenshots/dark-speaking.png` (speaking waveform) |
| Review N10 — capture consistency | Recaptured dark question in the same Chromium run and environment as the other states. The capture script waits for fonts, compares rendered font signatures in every case, and verifies PNG dimensions by viewport group. | `prototype/capture-screenshots.js` | `screenshots/dark-question.png` (1440x900, matching the other wide captures) |

## Cross-reference

The on-disk `design-spec-review-r1.md` uses a different finding sequence from the round 2 brief. The brief's IDs remain authoritative for the revision rows above.

| Review-r1 ID | Revision row | Disposition |
| --- | --- | --- |
| N1 | N1 | Real `livePhase` wording |
| N2 | S1 | Delegated Work rail sizing |
| N3 | S2 | Shared Context value |
| N4 | N6 | 480px plate bounds; spec also identifies it as an Electron stress case |
| N5 | N2 | 24-node top plate clamp |
| N6 | N6 | Additional 900px Ptah/Crucible clearance |
| N7 | S3 | Recent-card age bars removed |
| N8 | — | Previously accepted blank Current-card space; no requested change |
| N9 | N4 | Duplicate selected-card body removed |
| N10 | Review N10 | Consistent font and capture dimensions |
| N11 | M-2 | Waveform placement and idle hiding |

## Child sessions

The new dark and light `child-session` captures at 1440x900 show a live Ptah child session, its owned Test coverage lane orbiting that child, and a persisted child without a tab. The silver sphere and double ring distinguish children from gold Ptah/Tribunal and blue CLI lanes. The live child plate shows Release review, Codex and running; the persisted child plate shows the projection fallback "Child session", "Provider unknown" and unknown with a dashed silver ring. `work-projection.ts:108-190` supplies kind, label, providerId, state, updatedAt, tabId and parentSessionId ownership. The owned lane is indented below its child in Delegated Work; the selected child card shows the available provider, freshness and live-tab status. The no-tab child remains selectable and has no tab action. Screenshots: `screenshots/dark-child-session.png`, `screenshots/light-child-session.png`.

Current Command Center scene and work-list clicks only call selection, and `command-node-detail.component.ts` has no child tab action. I therefore showed "Live tab available" as information for the live child and "No live tab" for the persisted child. Opening or focusing a child tab by `tabId` is listed under `design-spec.md` **Proposed additions** for approval; no button was invented in the prototype. Child-owned orbit and rail nesting are design presentation changes over the current root-orbit, flat-list renderer.

## Verification

`node capture-screenshots.js` regenerated dark and light start, idle, speaking, approval, question, 24-nodes, narrow, and 480 captures, plus dark Tribunal confirm and both child-session captures: 19 PNGs. The captures were visually inspected, including the child-owned orbit and unknown child plate, dense scene, both compact widths, start cards, selected cards, and scroll states.

The capture script verified all 19 PNGs in one Chromium run after `document.fonts.ready`. Every wide capture, including `dark-question.png`, is 1440x900; both narrow captures are 900x918; both 480px stress captures are 480x1697. CDP reported the same rendered fonts for all cases: `Georgia-Bold` for the title and `Consolas-Bold` for the sampled mono eyebrow and Context chip. This confirms consistent fallbacks in this capture environment, including both child-session images. The Electron app's 800px minimum width makes the 480px view a stress case, and its plate fixes remain in place.

`node check-revision-contrast.js` passed the WCAG AA normal-text criterion of 4.5:1 for every measured composed pair. Dark ratios: root plate metadata/context 11.98:1; lane metadata, overflow chip and stat labels 13.89:1; rail eyebrow 8.32:1; detail and delegated-row metadata 14.03:1; Approve 8.80:1. Light ratios: root plate metadata/context 13.57:1; lane metadata, overflow chip and stat labels 14.21:1; rail eyebrow 5.43:1; detail and delegated-row metadata 14.99:1; Approve 6.15:1. The child plate metadata measures 13.89/14.21:1 in dark/light, the selected child tab-status text 14.03/14.99:1, and the silver ring against the stage 4.60/3.28:1. The updated checker also measured the selected child row metadata at 12.52/13.62:1.

`node --check capture-screenshots.js` passed, and the updated capture script completed successfully with its size and font assertions. The scoped `ptah_get_diagnostics` call remained unavailable after its 45-second TypeScript window and did not recognize the HTML file. Both changed helper scripts passed `node --check`; Chromium rendered all 19 states without page errors, and the contrast script completed for approval and child-session in both themes.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the Current card Cost cell and omit cost on recent cards | Drop all cost / infer summary cost / use live current stats only | `command-center-start.component.ts` reads `currentStats()?.totalCost` and known subtotal; `ChatSessionSummary` has no cost | Yes |
| Use “generating” in the sample recent card | Another valid phase / generating | `SessionTurnPhase` and `livePhase` rendering in the live start component; the sample card is active | Yes |
| Show the dense-list cue only on measured overflow | Permanent cue / conditional cue | The review requires no cue when rows fit; 24-node capture requires a clear scroll affordance | Yes |
| Clamp full plate rectangles inside the scene | Clip / hide all dense plates / clamp and count overflow | 24-node and 480 review findings; approved scene composition and existing overflow chip | Yes |
| Hide waveform outside speaking | Keep idle dotted meter / hide | Live voice state and the 900px/480px stray-dot finding | Yes |
| Show a silver child orbit and nested owned work | Leave all child-owned work on the root orbit / group by projected parentSessionId | `work-projection.ts` projects child ownership; existing Tribunal satellite grammar provides a layout precedent | Yes |
| Keep child tab opening as a proposed addition | Add an active tab button / show tab availability only / hide tab state | Current scene, work list and selected card only select nodes; `work-projection.ts` supplies tabId but no UI action uses it | Yes |
| Identify 480px as an Electron stress case while retaining plate rules | Treat 480px as supported / omit it / document the limit and keep the test | `apps/ptah-electron/src/windows/main-window.ts:119` sets `minWidth: 800`; the 480px capture still tests plate containment | Yes |
