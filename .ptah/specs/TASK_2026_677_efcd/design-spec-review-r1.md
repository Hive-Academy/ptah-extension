# Gate 1.7 design re-review — round 1

**Verdict: REVISE. Score: 7/10.** The revision closes the parity inventory, supplies a credible request and inspector contract, and passes the measured focus and target checks. The prototype still leaves lane navigation inert in the overlay, and the specified UI remains unverified for the product's other selectable themes. Those are Serious findings, so Gate 1.7 has not passed.

## Round-0 findings

| # | Result | Evidence |
| --- | --- | --- |
| 1 | **Fixed, with a visibility caveat** | `design-spec.md:762-853` maps all 69 A/B/C/D inventory rows; direct row-ID comparison found zero missing or extra rows. `prototype/screenshots/dark-parity-surfaces.png` and `light-parity-surfaces.png` show retained branch/rewind, compaction and usage surfaces. B-8/B-11/B-12 are one click behind `Show activity` (`design-spec.md:336-346`), addressed below. |
| 2 | **Partly fixed** | The permission/question × host matrix and sending, success, error/Retry, multi-request and closed-elsewhere states are specified at `design-spec.md:434-488`; screenshots `dark-request-question.png`, `dark-requests-several.png`, `dark-request-error-retry.png` show the principal states. The `Open lane` prototype action does not open a lane or close the overlay (`prototype/assets/app.js:377`), and the promised missing-card error path is absent (`:381-385`); findings 1 and 3 below. |
| 3 | **Fixed as a specification; implementation fields still need the named architect check** | `design-spec.md:698-727` defines one session-scoped aggregate, unique open requests, loading/unknown/partial/error presentations and G1-G5 acceptance gates. `:681-694` hides ahead/behind pending a source and specifies `parseTodoList` with count-only fallback. The real lane queue uses `requestId` (`libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts:97-106`), which G5 must reconcile with the spec's provisional `id`. |
| 4 | **Partly fixed** | `prototype/assets/app.js:288-319,418-432` implements entry focus, inert main content, Tab trapping and Esc layering. `node prototype/assets/capture.mjs checks` passed entry, Esc, Close button, scrim and Answer return at 400 px; `dark-narrow-400-overlay-focus.png` shows the ring. Row selection, `Open lane` and resize/session-switch close paths are specified but not demonstrated; findings 1 and 4 below. |
| 5 | **Fixed** | `design-spec.md:463-482` explicitly sizes Review/Answer, `+N more` and Retry. The capture check measured Review 63×28, Answer 66×28, Retry 42×24 and `+N more` 56×24 at wide and 400 px, with no sub-24 px controls. |
| 6 | **Fixed** | `design-spec.md:161-185` records the alignment correction and labels provider marks and Review as departures P1/P2. The measured main content x=273.5 and bubble x=415.5 are within 1 px of `reference/02-session-shell-with-inspector.png`; `dark-collapsed-wide.png` visually matches the main layout. |
| 7 | **Partly fixed** | The actual light focus token is now audited: `design-spec.md:594-630,663-679` and `prototype/assets/contrast-check.mjs` report 5.26–6.28:1 light and 7.43–8.81:1 dark for the ring on surfaces 0–3. `design-spec.md:625-630` explicitly leaves other theme-picker themes without measured status-ink contrast; finding 2 below. |
| 8 | **Fixed** | The six requested names are direct exports of the installed `lucide-angular` package: `D:/projects/ptah-extension/node_modules/lucide-angular/icons/lucide-icons.d.ts:728,915,1108,1112,1310,1568`. `prototype/ROUND-1-NOTES.md` records matching sprite identifiers. |

## New findings

1. **Serious — lane navigation is advertised but inert, especially in the overlay.** The spec says selecting an agent or `Open lane` closes the sheet and focuses the opened lane title (`design-spec.md:647-651`). The prototype's `select` handler only changes `aria-current`, while `open-lane` only sets `ui.selected`, rerenders and announces success (`prototype/assets/app.js:361,377`). Neither navigates, calls `closeInsp`, nor moves focus to a lane title. Thus the tested focus paths omit two real close paths, and a user can receive “Opened the … lane” while still in the inspector. **Fix:** make both handlers activate a concrete mock lane view, funnel overlay closure through `closeInsp(laneTitle)`, focus that title, and add keyboard checks for both paths at 400 px. If lane opening is unavailable in a host, omit that action there and use the working inline permission panel.

2. **Serious — selectable themes outside Anubis have no contrast guarantee for new status text.** `design-spec.md:625-630` says the other themes may fall back to daisyUI `--in/--wa/--er/--su` colours that are “not contrast-tuned for text” and defers their audit to T4. The status words, permission/error lines and request controls use these inks in this UI. Word labels make state understandable but do not establish WCAG 2.2 SC 1.4.3's 4.5:1 contrast. The two Anubis themes pass the measured pairs; the claim does not cover the product's other selectable themes. **Fix:** provide a project-token fallback with measured >=4.5:1 status text and >=3:1 meaningful UI/focus pairs across supported themes, or specify and enforce a theme scope for this surface before implementation. Record the measured pairs and token source in the spec and audit script.

3. **Moderate — the promised question-card failure and Retry path is absent.** `design-spec.md:454-456,483-488` promises an error if the C-16 card does not mount within 1 s and says Answer has a retry. The prototype's `answer` handler calls `qc.scrollIntoView()` unconditionally (`prototype/assets/app.js:381-385`); if `#qCard` is absent, it throws, leaves no actionable error, and gives no retry. **Fix:** model the absent-card state, retain the request and count, show a row-level error with Retry, and restore focus to its Answer button or error region. Check both Electron and VS Code/Rail routing.

4. **Moderate — resize closure and focus return differ from the spec.** `design-spec.md:641-652` requires the sheet to close when the shell changes from docked to overlay and to return focus to the opener or session title on automatic closure. The prototype `ResizeObserver` only calls `applyModal()` (`prototype/assets/app.js:432`), leaving the sheet open and adding `inert` without the specified automatic close or focus transfer. **Fix:** detect the width-band transition, use the common close routine, and add a keyboard check for resize and session switch.

5. **Moderate — activity is a move for current one-message turns, but multi-message granularity is unresolved.** `design-spec.md:336-346` sums token/cost/activity values over assistant messages and explicitly does not show their per-message split for a multi-message turn (`[verify]`). B-11/B-12 are per-message data in the inventory; summing loses which message incurred a cost or duration when a turn contains several assistant messages. **Fix:** keep each message's labelled metrics inside the activity panel when more than one assistant message belongs to the turn, while retaining the aggregate as an optional summary. Verify the data shape before claiming full parity.

6. **Minor — the reference-state live line disagrees with the aggregate contract.** `design-spec.md:267-273,698-727` says a waiting request changes the live verb to `Waiting for you` from the shared aggregate. `dark-request-question.png` and `dark-requests-several.png` show `1/5 needs you` in the header while the transcript line still reads `Orchestrating`; `prototype/assets/app.js:217` exempts `t2=ref`. **Fix:** either bind that line to the same count in every state or explicitly state that it belongs to a historical turn and cannot reflect current request status.

## Removals / visibility changes for the user

- No capability removal is proposed in `design-spec.md:853-856`; all 69 inventory rows are placed in the new design.
- B-8, B-11 and B-12 cost, token and duration badges move from always visible to `Show activity` (`design-spec.md:336-346,843-856`). This is a one-click visibility change for today's one-assistant-message turns; the multi-message split needs the fix in finding 5.
- B-14/B-15 branch and rewind remain in a hover/focus action strip; B-4 tool/file counts remain on the disclosure row (`design-spec.md:314-345,843-852`).
- The chat-host compact card is retired while the persisted compact view toggle remains; its content is redistributed to the clean turn and inspector (`design-spec.md:274-291`).

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat B-8/B-11/B-12 as moved for a single-message turn, with a multi-message parity gap. | Move; effective removal; full parity. | `design-spec.md:336-346,843-856` keeps the values one click away but sums multiple messages. | Yes. |
| Keep Gate 1.7 at REVISE until lane navigation and supported-theme contrast are resolved. | Approve with follow-ups; revise before approval. | `prototype/assets/app.js:361,377`; `design-spec.md:625-630,647-651`; approval requires no Serious findings. | Yes. |

## Verification scope

Read the revised spec, round-0 review, round-1 notes, parity inventory, relevant prototype handlers and eight PNGs (including the reference). Ran `capture.mjs checks` (exit 0; all reported checks passed) and `contrast-check.mjs` for Anubis dark/light. No build, Nx, Jest or product code edit was performed.
