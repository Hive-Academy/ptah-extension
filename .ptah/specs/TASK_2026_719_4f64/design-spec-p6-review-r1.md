# P6 revision 1 cross-side review

Verdict: REVISE

Score: 7/10

## Prior findings

| Finding | Status | Evidence |
|---|---|---|
| 1. Capability parity | FIXED | `design-spec-p6.md`, Detail capability map and P6-8/P6-9 restore run/resume information, terminal fallback/Copy, pending instructions, Name/Remove locks, Manage on every named row and access after Add. A12-light visibly shows the locked pending state; A2-dark retains Manage alongside Sign in. |
| 2. Interactive prototype / B-2 | PARTIAL | Three LIVE frames, unique generated IDs, real dialog, README and menu navigation replace the inert gallery. However, `index.html:250-256` replaces the current accounts body on async completion: Sign in computes `had` but never uses it before `render()`, destroying focused controls even if the user moved to another control in that view. Add's fallback branch also unconditionally resets the current view to the list. Main `paint()` (`:283`) replaces its focused controls and its supposedly persistent live regions. `mkRegions` hides live regions, then fills and reveals them in the same callback; announcement reliability remains unproven. Lane has no Tab-close handler despite the keyboard contract. `smoke.mjs` logs happy-path observations; it does not exercise moved-focus/inactive-view completion or screen-reader speech. |
| 3. Selector state contract | PARTIAL | State contract 1–9 now covers initialization, dirty drafts/pushes, partial provider/account saves, cached ambient status, unavailable profiles, recovery navigation and derived removed IDs. Two new contradictions in contract 4 remain (below). |
| 4. Responsive / contrast evidence | PARTIAL | Contrast table now records all requested token pairs with a reproducible measurement script. `capture.mjs --solo` uses actual narrow viewports; the inspected `r-lane-open-245-dark.png` wraps the long option without clipping. But `deviceScaleFactor:2` changes pixel density, not browser zoom; the claimed “200% zoom” remains a simulation. The spec appropriately reserves production popover clipping for Electron visual review. The capture script logs overflow rather than asserting failure, contrary to Revision 1's wording. |
| 5. Heading/list spacing | FIXED | Updated list styling and A2-dark show the specified 24px gap below the heading/action row; row spacing remains calm. |

## New Serious issues

- **Ambient choice cannot be saved under the written contract.** `design-spec-p6.md`, State contract 4 says “ambient and unavailable/disabled options are never written.” Ambient is the valid, enabled way to return from a named account to the existing login (parity §1). Allow `{kind:'ambient'}` writes explicitly; only unavailable/disabled choices must be excluded.
- **Unconfirmed writes are falsely reported as failed.** State contract 4 first gives the uncertainty toast, then groups failed **or unconfirmed** account writes into “Provider saved. Account not saved.” A timeout/transport loss may occur after the host committed; the service returns `unconfirmed` and starts a re-read (`provider-accounts-state.service.ts:591-598`). Keep uncertainty distinct from confirmed refusal until the authoritative refresh resolves it; do not assert “not saved.”

No new Blocking issue identified. The B-2 defects above are remaining portions of prior finding 2.

## Low-noise check and limits

The fixes preserve D52: **zero visible helper sentences** in the product fixtures, including M4a/M4b. Added run badges, waiting labels, locks, Manage chevrons and terminal disclosure carry functional information; explanatory recovery/lock text is screen-reader-only or tooltip text. Toasts and the necessary load-failure row remain exceptions, not persistent helper prose.

Reviewed revised spec, HTML, README, supplied harness source and representative recaptured PNGs. No build, test, capture script, commit or push was run; live speech and real browser zoom were not independently exercised. Only this review file was written.
