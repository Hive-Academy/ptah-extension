# Rail design, revision 2 rereview

Scope: Revision 2 design contract and Rail prototype, with the supplied DOM probe as corroboration. This is a design/prototype review; Electron contrast and Angular implementation remain outside this verdict.

## Findings

| Item | Status | Evidence and impact |
|---|---|---|
| #2 — roving tab order | **CLOSED** | `syncTabs` runs before the unchanged-HTML return and again after a repaint (`02-focus-rail.html:374-399`). The supplied ArrowDown probe confirms old cards' inner buttons become `tabindex=-1` and the focused card's become `0`, meeting `layout-design-spec.md:250-251`. |
| #9 — replacement permission | **CLOSED** | Permission objects receive distinct keys, the repaint key includes that key, and the visible controls carry it (`02-focus-rail.html:324-330,342-347,374-395`). The click guard checks that shown key before Allow/Deny (`:581-594`); the supplied stale-`data-rid` probe confirms no request resolves. This closes the reported replacement-object path. |
| N1 — focus-header controls | **CLOSED** | The header key changes only with session, compact mode, or Stop availability; text and state patch in place, and a rebuild restores focus by `data-h` (`02-focus-rail.html:467-488`). The supplied 3.5-second sample probe confirms the focused Stop node remains the same. |
| N2 — queue identity and wrong action | **PARTLY** | Queue items reconcile by `session|reqKey`, retain surviving controls, and check their displayed key before action (`02-focus-rail.html:532-575`). The supplied stale-`data-key` probe confirms a mismatched key cannot resolve a request. Equal-text successive errors reuse an id (`:324-328`), however, so the guard cannot distinguish those requests; see new defect 1. |
| 920 px tab-strip overflow | **PARTLY** | The strip has horizontal scrolling, hidden scrollbar, fades and a fixed 35 px height; selection calls `revealTab` (`02-focus-rail.html:155-164,439-463`). The supplied 920 px probe confirms the last selected tab is visible. The prototype width selector does not call `revealTab` when the canvas width changes (`:668-670`); see new defect 2. |
| #10 — contrast | **Pending Electron by design** | The current measurement list remains computed muted text after gamut clipping, DaisyUI hover/focus mixes, tint composites, focus ring, and callout border pairs in the built app (`layout-design-spec.md:140-155,264`). No Electron acceptance result is claimed. |

## New defects from revision 2

1. **Blocking — repeated error text can make Retry act on a different request.** `errIds` is keyed by session and changes only when the error *text* changes; clearing an error does not clear the stored id (`02-focus-rail.html:324-328`). If one error is resolved and another error with identical text arrives before the queue reconciles, the old queue item survives under the same `session|request id` key (`:540-550`), and its Retry button passes the identity guard and retries the new error (`:568-575`). This violates the distinct-request and shown-action rules in `layout-design-spec.md:252,254`. Use a request id from the underlying event/model, including for errors; text is display data, not identity.
2. **Moderate — canvas-width control can leave the selected lane tab clipped.** The only width-change reveal hook listens to `window.resize` (`02-focus-rail.html:457-464`). The prototype's 920 px selector changes `--canvas-w` and calls `keepAnchor`, which scrolls the rail rather than the tab strip (`:668-670,717-718`). Selecting a far-right tab at a wider canvas and then switching to 920 px can leave that tab outside the narrowed viewport until another selection or window resize. Observe the strip's own width or reveal after the canvas-width change, as required by `layout-design-spec.md:255`.

Verdict: REVISE — 6/10
