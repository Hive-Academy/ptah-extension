# Design review round 2 (final) - TASK_2026_700_dcce

Verdict: APPROVE (0 Blocking, 0 Serious, 4 Moderate, 3 Minor)

Scope: design-revision-2.md, design-spec.md, prototype/README.md, all 19 screenshots, the 678 target renders, and the code sources named in the brief. I did not run contrast scripts, nx, jest or builds; contrast numbers are taken from the spec and not recomputed. Where this file says "r1 Nx" it means the IDs in design-spec-review-r1.md.

## 1. Round-1 verification

| r1 ID | Status | Evidence |
| --- | --- | --- |
| N1 "Build phase" invented | RESOLVED | `dark-start.png` and `light-start.png` API migration card read "Active · generating · Command Center". `generating` is a real `SessionTurnPhase`. The README lists the five real values. |
| N2 Delegated Work clips with free rail space | RESOLVED | `dark-speaking.png`: the card runs to the dock bottom (y~845) and all six rows show with room to spare. Same in `dark-tribunal-confirm.png` and `dark-idle.png`. Where content exceeds the card (approval, question, 24-nodes, 900px) a "SCROLL LIST" cue sits under the heading and the last row fades (`dark-question.png`, `light-question.png`). |
| N3 Context chip vs plate | RESOLVED | 62% in chip and plate in idle, speaking, question, child and start. 73% in both for approval, 24-nodes, narrow and 480, in both themes. |
| N4 480px plates overflow | RESOLVED | `dark-480.png`, `light-480.png`: "Repository access" and "Release checks" plates are whole and inside the scene. The spec marks 480 as a stress case below the 800px Electron minimum. |
| N5 Top plate clipped by band | RESOLVED | "Migration 21" and "Tests 20" plates are whole under the band in both 24-node captures. |
| N6 900px tightness | PARTIAL | Ptah and Crucible plates now clear each other. But the Crucible plate covers the lower half of the Crucible sphere at 900px (`dark-narrow.png`, `light-narrow.png`). See M3. |
| N7 Progress bars with no data | RESOLVED | No bars on any start card. |
| N8 Blank lower Current card | OPEN (Minor) | About 100px under "Resume current" and about 250px of empty page below the cards in both start captures. Accepted before. |
| N9 Duplicate subtitle | RESOLVED | `dark-speaking.png` Ptah card shows only the title and the state badge. |
| N10 Font mismatch in question capture | RESOLVED | `dark-question.png` is 1440x900 with the same fonts as the other wide captures. |
| N11 900px waveform dots | RESOLVED | No stray dots in `dark-narrow.png`; the waveform exists only in the speaking state. |

## 2. Specific checks

| Check | Result | Evidence |
| --- | --- | --- |
| (a) Delegated Work fills the rail at 1440; fade or cue only when clipped | PASS | The card fills the rail in all 1440 states. Clipped states (approval, question, 24-nodes, both themes) show "SCROLL LIST" plus a faded last row. `light-approval.png`: "Challenger active" sits at the card bottom and the fade is mild but present. Fits-without-clip states have no cue. |
| (b) One Context value in chip and plate | PASS on the value | The numbers always match. The ring colour does not (see M1). |
| (c) Current card Cost source | PASS (real) | `command-center-start.component.ts:205-218` renders `currentStats()?.totalCost`, falling back to `knownSubtotalOf(snapshot)`, with `~` when provisional. `ChatSessionSummary` has no cost field, and the design shows none on recent cards. The cell must be omitted when both are null; the spec decision implies this. |
| (d) Child session design | PASS with Moderate items | See the list below. |

Check (d) detail:

- Real fields only. The sphere, plate, row and card use `label` (fallback "Child session"), `providerId`, `state`, `updatedAt` and `tabId`, all projected at `work-projection.ts:178-190`. A persisted child gets state `unknown`, no provider and no tab, and the design matches. Stats are shown only from `childStats`, which needs a live `tabId`; the design shows none, and the code would add messages, tokens and cost for a live child.
- Open-tab action. Verified: nothing under `libs/frontend/command-center/src` opens or focuses a child tab from a node. `switchTab` appears only in `session-coordinator.ts` for the root and resume flows. The scene, the work list and `command-node-detail.component.ts` only select. The design correctly shows no button. The brief and `context.md` assume an existing action; there is none. The spec lists it as a proposed addition.
- However, the selected card prints "Live tab available" and "No live tab". These strings are not in the app today. They are derived from `tabId`, but "available" with no way to use it reads as a missing control. See M2.
- Unknown child. The sphere is dimmed with a dashed silver ring and a "CS" monogram. The plate reads "Child session / Provider unknown · unknown" with full-opacity text. The row has a dot icon and a silver left bar. It is readable and distinct from a failed or queued lane.
- Distinct sphere. Silver double ring plus a dotted halo, against gold Ptah, blue and orange state rings on CLI lanes, and the purple Tribunal "T". The grammar (ring, mark, plate) matches. Distinction depends only on the ring colour, which is weak (see M4).
- Ownership. The rail shows the owned lane indented under its child with a connector line, which is clear. In the canvas the lane sphere sits beside the child with no visible link line, and the "Test coverage" plate is about 60px away from its sphere. Ownership is weak in the canvas (see M4). The projection also supports grandchildren (`parentId` can be another child), which the design does not show.

## 3. New findings

### Blocking and Serious

None.

### Moderate

- **M1. The plate context ring is always orange.** `dark-speaking.png`, `dark-idle.png` and `light-idle.png` show an orange ring at 62%, while the header chip is neutral until 70% (`contextWarning` is `>= 70`, `command-center-page.component.ts:505`). The real page passes `rootContextTone` `warning` or `normal`. Fix: below 70% draw the ring in the neutral ink and the warning ink at 70% or more. Update the CSS at `.plate-context .context-ring` and the spec text.
- **M2. "Live tab available" and "No live tab" have no action and are new copy.** `dark-child-session.png` selected card. Fix: either drop both lines and show only provider and updated time (what the code shows today), or keep them only if the user approves the proposed open-tab addition. If the addition is approved, show a ghost "Open tab" button when `tabId` exists.
- **M3. At 900px the Crucible plate covers its sphere.** `dark-narrow.png`, `light-narrow.png`: the "T" sphere is half hidden. Fix: place plates below the sphere radius plus 8px, or move the plate beside the sphere when the stage is narrower than 1100px.
- **M4. Child ownership and kind are weak in the canvas.** `dark-child-session.png`: the child plate has no kind cue, and the child row in the rail looks like a lane row except for nesting. The lane sphere has no tether to its child, and its plate is offset from it. Fix: draw a thin silver tether from child to owned lane (same width as Tribunal tethers), place the plate directly under its own sphere, and add a small silver "child" glyph (Lucide `git-branch` or `corner-down-right`) on the plate and row.

### Minor

- **m1.** `dark-24-nodes.png`: several plates still sit over other spheres (Migration 7, Tests 20, Ptah plate over the lower sphere). This is a stress case and similar to the target density; acceptable.
- **m2.** Start view (r1 N8): empty space under the cards in both themes. Cosmetic.
- **m3.** The stage header Cost, Tokens and Duration are shown in the idle capture ($0.42, 04:32 with "Your command deck is ready"). Real idle sessions may have no values; the spec should say cells are omitted when unknown.

## For the user at Gate 1.7

Proposed additions (`design-spec.md` "Proposed additions", one item):

1. Open or focus a child session tab from the selected card when `tabId` exists. It does not exist today and needs a new button and coordinator route. Not drawn in the prototype.

Presentation changes over the current renderer (implementation work, not new capabilities): child-owned lanes orbit their child in the canvas, and the rail nests owned work under its child. Today the renderer puts all lanes on the root orbit and the rail list is flat.

Interpretation to confirm: "child sessions" means Ptah agent child sessions linked by `parentSessionId` (silver spheres), as `context.md` assumed. Note that `context.md` mentions an "existing open-tab action"; there is none.

Deviations from the target look (all justified in the spec): a new start view; context, Voice settings and warning affordances in the header; stats in a reserved stage band; Status and speaker meter in the dock; no FPS or drag-to-tilt text; app theme fonts and colours; darker light-theme gold labels; a silver child sphere and unknown-child plate (new).

Open Moderate items to decide: M1 (ring colour), M2 (tab-availability text), M3 (900px plate over sphere), M4 (child tether, kind glyph, plate placement). None blocks approval; M1 and M2 are cheap to fix before code starts.
