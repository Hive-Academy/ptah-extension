# Visual Review - TASK_2026_626_7b3e

## Summary

| Metric            | Value                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| Overall score     | 8/10                                                                   |
| Assessment        | APPROVED                                                               |
| Visual breaking   | 0                                                                      |
| Serious           | 0                                                                      |
| Moderate          | 2                                                                      |
| Viewports tested  | 1 (440 px wide webview, the pop-out/side-panel width used by plan-limits visuals) |
| Screenshots taken | 30 PNG (+ 6 JSON measurement dumps)                                    |
| Components tested | 1 (`ptah-session-stats-summary`, compact and full layouts, dark and light) |

Scope note: the task asked for the header chips, not a responsive sweep. Only 440 px was opened; narrower widths were not tested and are not claimed.

## Environment

- Real component, real webview bundle: `nx build ptah-extension-webview --configuration=development` (dev config, not production) in this worktree (HEAD 2d8a14086) for AFTER, and in a temporary `git worktree` of 69a2b835e for BEFORE. Both builds completed; the AFTER bundle contains `stats-tokens-estimate`.
- Served by the existing webview e2e harness fixture server (`useAppBuild`), driven by Playwright/Chromium with the host bridge stubbed (`installPostMessageBridge`, `installWorkspaceHost`, `planLimitsFixtures`). Session loaded via the harness `chat:resume` stats (unrevisioned, non-provisional: 64.7k tokens, $0.42, `status: ok`).
- Provisional state was driven with a real `session:stats-live` host message (`provisional: true`, revision 5/8/12 plus `context`), then an authoritative `session:stats-live` (no `provisional`, higher revision) to check the settle. Fixture lives only in the task folder: `scratch/gen.e2e.spec.ts` and `scratch/pw.config.ts` (to rerun, add a `{"type":"module"}` package.json in `scratch/`; it is removed because it breaks the Nx project graph). No source file was modified.
- Themes: `anubis` (dark) and `anubis-light`. Clock fixed at harness NOW, UTC.
- Cleanup done: temp worktree removed, both node_modules junctions removed (link only), no dev server left running.
- Contrast is computed from the browser's rendered colours composited over the chip background (canvas-resolved, so oklch tokens are handled). Criterion: WCAG AA 1.4.3 (4.5:1 normal text); project design notes in the template reference the same text-token approach.

## Findings by severity

### Visual breaking

None.

### Serious

None.

### Moderate and minor

1. Compact layout: the provisional state widens the Tokens chip by about 12 px (91.64 to 103.59) and the Cost chip by about 11.5 px (83.70 to 95.22), so the Cost chip, and anything after it, moves right by ~12 px when a turn starts and back when it settles. Heights, y-positions and the strip box are unchanged (`[37,127,354,58]` in all three states), and there is no document-level horizontal scroll (scrollWidth 440 = viewport). Impact: small horizontal nudge of the chips to the right of Tokens during a turn; no click target moves vertically. Evidence: `after-compact-authoritative/provisional/settled-*.png`, `after-*.json`. Fix if wanted: none required; reserve width only if the jitter is judged noticeable.
2. Compact layout at 440 px: the Cost chip is already clipped by the strip's `overflow-x-auto` in the authoritative state before the change (right edge 420 vs strip edge 391 in BEFORE and AFTER, identical); the `~` pushes it ~12 px further. Pre-existing, not introduced here; the strip scrolls horizontally inside its own container. Evidence: `before-compact-authoritative-anubis.png` vs `after-compact-provisional-anubis.png`.

## Prototype fidelity

- Approved prototype: None in the task folder (no `prototype/`).
- Fidelity assessment: NOT APPLICABLE
- Before/after comparison (no prototype), non-provisional snapshot at base 69a2b835e vs this branch:
  - Dark, compact: `screenshots/before-compact-authoritative-anubis.png` vs `screenshots/afternp-compact-authoritative-anubis.png` - byte-identical PNGs; chip boxes, text and tooltips identical. No regression.
  - Dark, full: `before-full-authoritative-anubis.png` vs `afternp-full-authoritative-anubis.png` - byte-identical; no regression.
  - Light, compact: `before-compact-authoritative-anubis-light.png` vs `afternp-compact-authoritative-anubis-light.png` - byte-identical; no regression.
  - Light, full: `before-full-authoritative-anubis-light.png` vs `afternp-full-authoritative-anubis-light.png` - byte-identical; no regression.
  - Note: `after-*-authoritative-*.png` for the full layout were captured after the compact pass had already pushed newer live figures (66.0k, $0.48), so the clean comparison files are the `afternp-*` set (run with the provisional flow disabled).
- Provisional (AFTER only): `after-compact-provisional-{anubis,anubis-light}.png`, `after-full-provisional-{anubis,anubis-light}.png`; settled: `after-*-settled-*.png`.

## Viewport results

| Screen | Elements checked | Status | Screenshot |
| ------ | ---------------- | ------ | ---------- |
| 440 px, compact, dark/light | Tokens and Cost chips, authoritative / provisional / settled | Pass (`~` visible before value; Cost chip clipped by container as before) | `after-compact-*-anubis*.png` |
| 440 px, full, dark/light | Tokens and Cost cards, same three states | Pass; card widths and heights identical in all three states | `after-full-*-anubis*.png` |

Layout shift (from bounding boxes): strip box identical in every state in both layouts. Full layout: Tokens card 156 px wide and Cost card 174 x 146.25 px in authoritative, provisional and settled, so zero shift. Compact: horizontal growth of ~12 px per chip only (finding 1), zero vertical shift.

## Component and interaction results

| Component | States tested | Status | Screenshot |
| --------- | ------------- | ------ | ---------- |
| Tokens chip / card | authoritative, provisional (`~` + sr-only), settled (back to no `~`) | Pass | see above |
| Cost chip / card | same | Pass; in full layout the `~` sits left of the green cost pill (`~ $0.47`), readable | `after-full-provisional-anubis-light.png` |
| Tooltips | native `title`, read from the DOM | Pass: provisional Tokens title begins "Live estimate while the turn runs; final figures replace it when it ends." followed by the four-class breakdown; Cost title begins with the same line. Authoritative titles unchanged from BEFORE (compared as equal strings). | `after-dark.json` / `after-anubis-light.json` |
| Focus | Tab order through the page | The chips are non-interactive `title` spans in both BEFORE and AFTER, so there is no focus stop in the strip (12 tab stops recorded, none in the strip; first in-strip stop would be the expand/collapse button). The `~` adds no focusable element. Native `title` tooltips are mouse-hover only, as before. | `after-anubis.json` `tabStops` |

## Design system compliance

- `~` uses the existing `text-base-content-muted` token (`text-base-content-muted` in the template, both layouts, the same class as the "Tokens"/"Cost" labels). No new hex or opacity. The value text keeps `base-content`.
- Tokens chip uses `tabular-nums` on the value, so the digits do not wobble; the `~` itself is not tabular, hence the small width delta.

## Accessibility audit

- Contrast of the `~` (muted token over the chip background), measured: dark compact 4.72:1, dark full 5.37:1, light compact 4.72:1, light full 5.20:1. All meet 4.5:1 AA. Value text: 11.59 to 13.72:1. (An earlier run that mis-parsed oklch colours returned 2.4 to 2.8; it was a measurement bug and was replaced.)
- The `~` is `aria-hidden="true"`; the sr-only text "estimated " is present and read in order: the accessibility snapshot of the compact strip shows `text: Model Opus 4.1 Context — Tokens estimated 67.0k Cost estimated $0.50`. In non-provisional states the sr-only text is absent and the snapshot has no "estimated".
- `~` computed font size inherits the chip text size (no new small text introduced). No target-size change (nothing interactive added).
- Residual: the `~` marks an estimate visually, but sighted keyboard-only users cannot reach the explanatory `title` tooltip because the chips are not focusable (pre-existing pattern, outside this change).

## Visual performance

- No layout shift beyond finding 1; no animation was added (screenshots taken with animations disabled; the `~` is a static glyph that appears and disappears with the snapshot).
- Provisional-to-authoritative settle verified: after an authoritative `session:stats-live` with a higher revision, `stats-tokens-estimate` count goes to 0 and figures update (65.9k to 66.0k, $0.47 to $0.48).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for non-provisional parity (byte-identical screenshots in both themes and both layouts) and for the `~`/sr-only behaviour; MEDIUM for breadth, since only a 440 px viewport on Chromium was opened and the bundle was a development build.
- Key concern: the ~12 px horizontal chip growth in the compact layout when a turn becomes provisional (moderate, optional to address).
