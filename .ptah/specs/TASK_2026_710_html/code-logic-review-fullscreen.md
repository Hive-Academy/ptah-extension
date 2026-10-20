# Code Logic Review — `TASK_2026_710_html` (fullscreen frame height)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0        |

Scope: the uncommitted fullscreen height correction in `libs/frontend/chat-ui/src/lib/organisms/artifacts/artifact-viewer.component.ts` (template iframe at lines 141–153, container class at 222–226, height state at 190 and 374–411) and the spec `lets the frame fill the overlay and restores the reported height on exit` (`artifact-viewer.component.spec.ts` lines 328–341). The component file was read in full. `task-description.md` and `code-style-review.md` are not in the task folder. `context.md` only names full screen as a surface, not this height bug.

Score is 8, not 9–10: the new spec checks the default 160px inline height and the `flex-1` class. It does not dispatch a non-default `height` message, and it does not assert node identity, nonce, `sandbox`, or `src` across the toggle. Those paths were traced in source only. Score is not 5–6: the height signal is not cleared on toggle, the iframe is not under a fullscreen structural directive, and `sandbox` / `src` are unchanged.

## Defects

none

## Five logic questions

### 1. How does this fail silently?

No silent success path in this correction. Before the change, `[style.height.px]="height()"` kept a clamped pixel height (minimum 160) on the iframe while `containerClass` switched the parent to `fixed inset-0 … flex flex-col` (`artifact-viewer.component.ts` lines 222–225). The overlay looked open and the frame stayed 160px tall. Line 151 now writes `null` while `fullscreenActive()` is true, which removes the inline `height`, and lines 149–150 add `min-h-0` and `flex-1` so the column flex item takes the free space under the `shrink-0` header (line 114). A failure of that layout would show a short or zero-height frame, not a green success. The spec only observes `style.height === ''` and the `flex-1` class (`artifact-viewer.component.spec.ts` lines 335–336); jsdom does not compute used flex height. That is a test limit, not a second code path that reports success.

### 2. What user action produces unexpected behaviour?

None found for this binding. Enter and exit (header button `toggleFullscreen` at line 284, Escape via `setFullscreen(false)` at lines 287–295) only flip `internalFullscreen` (lines 303–306). Both branches of line 151 update in the same template pass, so there is no tick where the pixel height is cleared and `flex-1` is already removed. The iframe is not wrapped in `@if` / `@for` keyed on fullscreen. The only structural `@if` is `srcInvalid() || loadFailed()` (line 94), which fullscreen does not set. Repeating the toggle does not change `[src]` (line 145), so the frame does not navigate again and `(load)` does not rebind the bridge.

### 3. What input data produces a wrong answer?

A `height` message is still accepted only after source, schema, and nonce checks (lines 374–383), then clamped and throttled (lines 391–410). `applyHeight` does not read `fullscreenActive`, so a message during the overlay still stores a clamped value on the `height` signal (line 190). While the overlay is up, line 151 short-circuits and does not paint that value. The next time `fullscreenActive()` is false, the same binding reads `height()` and restores it. `resetFrame` (line 322) is the only writer that forces the minimum, and fullscreen does not call it. Values the schema rejects never reach `applyHeight`. A page that measures the stretched viewport and posts a large but in-range `px` will be stored and applied on exit, up to `ARTIFACT_HEIGHT_MAX` (1600). That matches the requested “keep updating stored height” behaviour; this component does not interpret what the page measured.

### 4. What happens when a dependency fails?

The new bindings do not call the sanitizer, the theme bridge, or the message port. If the frame never loads, `loadFailed` replaces the whole branch (line 94) and there is no iframe to size; that path is unchanged. If a height message arrives with the wrong source, a bad shape, or a stale nonce, `onFrameMessage` returns before `applyHeight` (lines 376–380) and the stored height stays as it was. The 100ms trailing timer (lines 395–407) still commits `pendingHeight` during the overlay; the paint waits until exit. A timer that fires after exit updates the in-panel height, which is the existing throttle, not a dropped fullscreen update. `ngOnDestroy` still clears that timer (lines 275–278).

### 5. What is missing that the requirements never mentioned?

Nothing in the production binding. The new spec does not lock three behaviours the task asked to check, even though the source already does them:

- Same iframe node and bridge nonce across the toggle (no structural directive; `setFullscreen` does not call `resetFrame`, `removeMessageListener`, or `bridge.detach`).
- Restore of a non-default clamped height, and a height posted during the overlay applied only after exit.
- `sandbox="allow-scripts"` (line 146) and `[src]` (line 145) unchanged across the toggle. The markup spec (spec lines 117–123) covers the first render only.

## Failure modes

None found for this correction.

Reviewed: fullscreen class/style bindings (lines 149–151), overlay container classes (lines 222–225), height signal lifetime versus `resetFrame` (lines 317–325), message acceptance and throttle (lines 374–411), and iframe identity relative to the `@if` at line 94. Spec read: fullscreen block, lines 328–387, plus frame markup and message helpers, lines 1–159.

Residual uncertainty: Jest was not run, and no browser measured the used height of the iframe inside `fixed inset-0`. Fill is inferred from a definite-height column flex parent plus `flex-1` and `min-h-0` on the iframe. `ptah_get_diagnostics` / other `ptah_*` tools were not available in this session (`search_tool` returned no ptah server).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None in the component. The spec gap in question 5 is coverage, not a wrong runtime path.

## Data flow

1. User or parent sets fullscreen — `fullscreen` input or `internalFullscreen` (lines 214–218). OK.
2. `containerClass` becomes `fixed inset-0 z-50 flex flex-col …` (lines 222–224). OK. Header stays `shrink-0` (line 114).
3. Iframe drops inline height and gains `flex-1` + `min-h-0` (lines 149–151). OK. Element is the same node; `src` and `sandbox` are not touched (lines 145–146).
4. Page posts `height` — gates at lines 374–383, `height.set` at lines 405 or 410. OK. Style binding ignores the signal until exit.
5. Exit sets `fullscreenActive` false — line 151 writes `height()` pixels again and removes `flex-1` / `min-h-0`. OK. Stored value is the last clamped write, or 160 if the page never spoke.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Frame fills the overlay in full screen | COMPLETE | Fills the flex remainder under the header and padding, not the header band. No used-height measurement in jsdom. |
| Exit restores the reported/clamped height | COMPLETE | Signal is not reset on toggle (line 303 vs line 322). Spec exercises only the 160 default. |
| Iframe is not re-created | COMPLETE | Single iframe in the non-error branch; fullscreen changes classes and one style only. |
| Height messages during full screen update stored height | COMPLETE | `applyHeight` ignores fullscreen; line 151 only hides the paint. |
| No sandbox or src regression | COMPLETE | Attributes still static `sandbox="allow-scripts"` and `[src]="sanitizedSrc()"` (lines 145–146). |

Implicit requirements not addressed: none in this correction.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Enter before any height message | YES | Stored height stays 160; exit writes `160px` | Spec covers this |
| Height message during overlay | YES | Signal updates; inline height stays removed | Not in the new spec |
| Second height inside 100ms while overlay is open | YES | Trailing timer commits the newest clamp | Paint follows exit, or the timer if it fires later |
| Exit then a late trailing height | YES | Timer calls `height.set` (line 405) and the in-panel binding paints it | Pre-existing throttle |
| Toggle twice | YES | Same node; src unchanged | Nonce not asserted |
| `fullscreen` input already true on first paint | YES | Line 151 is null from the first check | Not in the spec |
| Error / invalid URL while overlay would be open | YES | Line 94 removes the iframe | Unchanged; not caused by this binding |
| px outside 160–1600 | YES | Schema reject, then `clampArtifactHeight` | Unchanged |

## Decisions

- **Fill means the flex remainder.** Options: edge-to-edge over the header, or grow under the existing header. Evidence: container is `flex flex-col` with `p-4` (line 224) and the header is `shrink-0` (line 114); the spec asserts `flex-1`, not `inset-0` on the iframe. Reversible: yes, by a later class change.
- **Viewport-sized reports during overlay are stored.** Options: freeze `height` while fullscreen, or keep `applyHeight` as-is. Evidence: the task says a height message during full screen must still update the stored height. Reversible: yes.
- **Spec gaps do not fail the verdict.** Options: NEEDS_REVISION until the spec posts a non-default height, or APPROVED on the source trace. Evidence: lines 303–306 and 391–410 already implement restore; a missing assertion is not a wrong answer. Reversible: yes.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the source paths above; MEDIUM for the used pixel height in Electron, because layout was not measured.
- Top risk: a page that measures the stretched iframe can store a clamped height up to 1600px that appears only after exit.
- What a robust implementation would add: one spec that posts `{ type: 'height', px: 320 }` before enter, posts a second value during the overlay, then asserts the same iframe node, the same nonce, `sandbox`, `src`, and `320px` only after exit. No production change follows from this review.
