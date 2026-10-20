# Visual fix report — TASK_2026_702

## Findings

| Finding | Change | Source | Spec |
| --- | --- | --- | --- |
| F1 blank inspector | Gate both inspector branches on a focused session so an empty board gets the full stage; focused sessions retain the inspector. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:261,296-309` | `canvas-rail-board.component.spec.ts:595` |
| F2 competing primary | Change both Run setup buttons to outline; Ready strip now has the prototype's three secondary actions. Hero New session remains the filled action. | `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.ts:13-18,28` | `project-setup-card.component.spec.ts:52-65` |
| F3 card details and hero copy | Add eyebrow, row icons, Setup tools label, and approved intro/scan copy. Align hero sentence and add visible plus. | `project-setup-card.component.ts:22-30`; `canvas-rail-board.component.ts:162-176` | `project-setup-card.component.spec.ts:49-51` |
| F4 recent sessions | Use two-line title clamp and relative dates, with absolute date in `title`. Removing the unused inspector width gives cards the prototype's wider stage. | `canvas-rail-board.component.ts:190-199,329-341` | `canvas-rail-board.component.spec.ts:1204` |
| F5 light shadow | Use the existing lighter elevation token for the light-theme card. | `project-setup-card.component.ts:40` | Visual review follow-up needed |
| F6 popover copy | Add dialog name/description, helper text, and visible optional-name label. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:130-150` | Existing `orchestra-canvas.rail.spec.ts` interaction coverage; visual review follow-up needed |
| F7 Escape | Handle Escape on the external new-session anchor while the popover is open; the shared popover handles Escape within its panel. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:238-246,550-565,600-604` | `orchestra-canvas.rail.spec.ts:363`; `native-popover.component.spec.ts:280` |

## Decisions

- Removed Open Library from the Ready strip. The approved prototype shows three actions there. Open Library remains on the not-ready card; once ready, Marketplace is reachable from the app-shell button (`app-shell.component.html:205-213`), but the skills deep link is lost. This matches the approved prototype.
- Calendar-relative activity uses minutes/hours for today and Yesterday for the previous calendar day. Older and future sessions show a short date. The absolute timestamp remains available as a tooltip. Dates are calculated on render, without a timer; they update on the next change detection.
- Applied the lighter shadow only under `anubis-light`, preserving dark-theme elevation. Reversible.

## Not done

- Tests and builds were not run, per the memory-safe rule. Scoped `ptah_get_diagnostics` was attempted but returned unavailable after its TypeScript check exceeded 45 seconds; it reported seven files unchecked. The orchestrator should run scoped checks and visual review.
- Notification-center code and the needs-you chip were untouched.

## Revise round 1

| Defect | Change | Source | Spec |
| --- | --- | --- | --- |
| 1. Title clamp | Removed `block` so `line-clamp-2` can set its display mode. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:195` | `canvas-rail-board.component.spec.ts:1204` checks clamp and absence of `block`. |
| 2. External-anchor Escape | Attached Escape handling to the active anchor and removed the listener on close or destroy. Escape closes once and returns focus. The shared popover remains unchanged. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:238-246,550-565,600-604` | `orchestra-canvas.rail.spec.ts:363` focuses the real external anchor and checks close and single focus return. |
| 3. Relative dates | Blank null timestamps, include the relative date in the card's accessible name, and retain the absolute date tooltip. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:194-196,329-340` | `canvas-rail-board.component.spec.ts:1204-1245` covers yesterday, older, future, null and undefined. |
| 4. Input label | Removed the overriding `aria-label` so the visible optional-name label is used. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:142-150` | `orchestra-canvas.rail.spec.ts:343` checks label association and absence of `aria-label`. |
| 5. Setup tools group | Added group semantics to the named control row. | `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.ts:30` | `project-setup-card.component.spec.ts:50-51` checks the group name. |
