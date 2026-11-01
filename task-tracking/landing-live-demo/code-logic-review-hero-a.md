# Code Logic Review: hero-a (uncommitted diff)

Score: 7/10. Verdict: APPROVED with revisions (0 blocking, 1 serious, 4 moderate, 3 minor).
Scope: live-demo-section.component.ts (read in full), hero.component.ts and hero-content-overlay.component.ts (diff), check-live-demo.mjs (diff plus header). Specs not run. No leftover references to the deleted `live-demo-variant` were found in the changed code.

## Serious

S1. check-live-demo.mjs `gzippedTransferKb` double-counts files, so the budget can fail falsely.
- Pathnames are deduped as strings, not as resolved files. `/demo` (a 3xx response, status < 400) and `/demo/` both resolve to `demo/index.html`. `/` and `/index.html` do the same.
- The `response` hook adds redirect responses to `fetchedPaths`, and the directory-to-index mapping then counts the same file twice.
- The budget has about 10% headroom (1900 KB against roughly 1700 KB measured), so a few counted-twice files could push a passing build over the limit and block the deploy in deploy-landing.yml, which runs with defaults.
- Fix: dedupe on the resolved absolute file path, and skip 3xx responses.

## Moderate

M1. `gzippedTransferKb` measures the files on disk, not what was transferred.
- Fetched URLs that map to no file (SPA fallback, query-only routes, a server-generated 200) are skipped silently, so the number undercounts.
- It also assumes the host serves gzip. A brotli host would transfer less, so the budget is conservative there.
- A 304 response is not a problem (it is counted once, from disk), and the Playwright context starts with an empty cache.
- Document the "estimate" semantics. Consider also counting `content-length` from the response headers.

M2. `--max-transfer-kb abc` gives NaN, and `Number.isFinite` then silently disables the budget. Reject a non-finite value at parse time. `decodeURIComponent(pathname)` (around the line that builds `rel`) can throw on a malformed `%` sequence and crash the check; wrap it in try/catch.

M3. onTabKeydown, live-demo-section.component.ts:290-307. It does not ignore events that carry Alt, Ctrl or Meta, so Alt+ArrowLeft (browser Back) and similar combinations are hijacked.
- Fix: `if (event.altKey || event.ctrlKey || event.metaKey) return;`.
- Also `aria-orientation="vertical"` is fixed, but below `lg` the list is a horizontal scroller, which leaves the orientation wrong for screen-reader users on mobile.
  - Make it responsive, or bind it from the viewport signal.

M4. Autostart readiness, lines 254-271.
- If `load` never fires (a stuck third-party or lazy resource), `pageSettled` stays false and the demo never autostarts. The user can still click "Play live demo".
- Add a fallback timer, for example 5 s after `DOMContentLoaded`.
- `reducedMotion` and `saveData` are read once and never refreshed. This is old behaviour, and the power-on media query does react to live changes.

## Minor

- Lines 303-306. Focus is moved by DOM index after `selectTab`. This works, but `@if` re-renders could theoretically race; focus after the tab buttons have rendered.
- `selectTab` leaves `active` set and swaps the iframe src. That is intended; the stale-state guard on `scenario` in `acceptStateMessage` covers old iframe messages.
- Ordering: the power-on veil sits at opacity 1 once the timeline initialises, while the iframe can already autostart at the 10% intersection. The first seconds of playback are therefore partially hidden under the veil. This is cosmetic and scrubbed.

## Checks that came out clean

- SSR and no-JS: the veil is `opacity-0` at rest and GSAP only sets it after `browserReady()`, so prerendered HTML shows the final "on" state. The tablist, poster and description render without JS. The hero headline reveals use `gsap.from` after render, as before.
- Cleanup: `mm.revert()` runs in the effect's `onCleanup`. The load, resize, message and visibility listeners, the IntersectionObserver and the idle-callback or timeout handle are all released in `destroyRef.onDestroy`. ScrollTrigger is reverted via the matchMedia context.
- Autostart gating: the `pageSettled && sectionVisible && wideViewport && !reducedMotion && !saveData && !isMobile` condition is idempotent. It is re-evaluated on resize and on intersection. If the viewport shrinks, the template falls to the mobile video, and a pause is sent when the section leaves the viewport. A pause sent while the iframe was loading is re-sent from the state message.
- Roving tabindex, `aria-selected`, `aria-controls` and `aria-labelledby` are consistent, and Home, End and the arrow keys wrap correctly.
- Path traversal in `gzippedTransferKb` is blocked by the `relative(...)` check; the only cost is that a file literally named `..x` is skipped.

## Resolution (coordinator)

- Serious (budget double count): fixed. `gzippedTransferKb` now dedupes on the resolved file, and 3xx responses are not collected.
- Moderate (`--max-transfer-kb` NaN / malformed `%`): fixed. A non-positive or non-numeric budget throws, and a bad escape is skipped.
- Moderate (modifier keys / orientation): fixed. Alt, Ctrl and Meta are ignored, and `aria-orientation` follows the lg breakpoint.
- Moderate (`load` never fires): fixed. An 8 s fallback settles the page, and `settle` is idempotent.
- Moderate (estimate, not transfer): accepted. Gzip of the files on disk is a stable proxy for regressions. The budget is documented as such.
- Minor items: accepted as is.
