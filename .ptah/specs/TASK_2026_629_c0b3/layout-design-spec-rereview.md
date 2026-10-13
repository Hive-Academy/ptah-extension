# Rail design, revision 1 rereview

Scope: the revised design spec and prototype, parity inventory, and supplied Rail renders. This is a design/prototype verdict, not an implementation verification.

## Findings

| # | Status | Evidence and remaining impact |
|---|---|---|
| 1 | **CLOSED** | The parity table now covers rows 39–44, including Rail injector release, snapshot work, metrics, empty state, card semantics, and workspace pruning (`layout-design-spec.md:183-188`). Gridstack node release remains Grid-specific (`:183`). |
| 2 | **PARTLY** | Lane rows are real buttons with labels and actions (`02-focus-rail.html:338-340,525,528-534`), but `patchCard` returns before updating inner-button `tabIndex` when the HTML is unchanged (`:363-377`). After focus moves, controls on the old card remain tabbable while controls on the new card may remain `-1`; the promised roving order (`layout-design-spec.md:130-133`) is therefore unreliable. |
| 3 | **CLOSED** | Card text is selectable and the select button has no pointer events (`02-focus-rail.html:92-95`); the card click path ignores an active selection (`:511-518`). |
| 4 | **CLOSED** | The 72 px header clips its own contents and the 28 px chip row stays on one line with horizontal scrolling (`02-focus-rail.html:62,66-69,393-398`). The supplied 9 and 12 session renders show no chip/card overlap. |
| 5 | **CLOSED** | The git slot is `max-content`, its values can overflow their span, the mini bar drops below 1120 px, and narrow header labels hide (`02-focus-rail.html:120-123,141-151`). `rail-dark-920.png` shows both git numbers and a single-line focus header. |
| 6 | **CLOSED** | The v3 contract now specifies per-workspace mode and Rail state, v1/v2 migration to Rail, untouched Grid intent, hydration gating, surfaced write errors, and read-only newer records (`layout-design-spec.md:190-202`). This closes the design gap; code still needs to implement it. |
| 7 | **CLOSED** | The design now requires one active live view, no hidden-workspace live mount, per-tab lane state, draft flush, and child-injector cleanup (`layout-design-spec.md:98-113`). The prototype destroys the prior panel before mounting the next (`02-focus-rail.html:436-450`). This remains an implementation seam to verify in Angular. |
| 8 | **CLOSED** | The contract distinguishes stable order/height from width changes and names the scroll anchor (`layout-design-spec.md:53-54,71-87`); the prototype keeps separate geometry baselines across rail presentations and reanchors on panel toggles (`02-focus-rail.html:632-647`). |
| 9 | **PARTLY** | A callout appearing/disappearing forces repaint and a removed control yields focus to the select button (`02-focus-rail.html:359-377`); Allow/Deny check for a current permission (`:521-522`). A replacement permission while the old one is focused keeps the same `state|p` key, so repaint is deferred (`:359-372`) and Allow can approve the *new* request under the old command text (`:324-326,521`). The stale-action problem remains. |
| 10 | **PARTLY** | The prototype uses the documented real theme surfaces and darker proposed light state inks (`02-focus-rail.html:9-26`); the spec reports recomputed ratios (`layout-design-spec.md:140-154`). The spec itself still requires Electron confirmation of computed muted, tint, hover/focus, ring, and callout border pairs (`:155`), so final contrast acceptance is pending. |

## New defects found in revision 1

1. **Serious — focus-header controls lose keyboard focus during sampling.** Each focused-session sample calls `renderHeader` (`02-focus-rail.html:651-659`), which replaces the whole header, including Stop, Compact, overflow, and Close buttons (`:427-435`). A keyboard user focused on one of these controls is dropped from it on an ordinary sample. Patch changed text and states in place, or restore focus to the matching control.
2. **Blocking — queue can display one permission and approve another.** While focus is inside the queue, `renderQueue` skips updates whenever the item count is unchanged (`02-focus-rail.html:476-488`). If a resolved request is replaced by another for the same session, the visible command stays old, while the Allow handler acts on the current `s1.permission` (`:499-505`). Reconcile by request identity and disable or replace stale actions before approval.
Verdict: REVISE — 7/10
