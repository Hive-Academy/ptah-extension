# Context

## Measured state

The tokens live in `apps/ptah-extension-webview/tailwind.config.js` in the
`anubis` theme block, which `darkTheme` selects by default.

| Token pair | Foreground | Background | Measured ratio | WCAG AA normal text (4.5:1) | WCAG AA large text and UI (3:1) |
| --- | --- | --- | --- | --- | --- |
| `success-content` on `success` | `#e8e6e1` | `#16a34a` | **2.64:1** | FAIL | FAIL |
| `info-content` on `info` | `#e8e6e1` | `#3b82f6` | **2.95:1** | FAIL | FAIL |

Both ratios were computed with the WCAG relative-luminance formula against the
token values as written in the config. They are reproducible from the file, not
estimated from a screenshot.

For comparison, the same theme's `warning` token pairs `#131317` on `#f97316`,
which is a dark-on-light pairing and passes comfortably. The two failing pairs
are the ones that put a light `#e8e6e1` foreground on a mid-lightness fill.

`anubis-light` uses an entirely separate OKLCH token set beginning around
`apps/ptah-extension-webview/tailwind.config.js:128`. Its `success` and `info`
pairs have never been measured.

## Scope

1. Measure every semantic token pair in BOTH themes, not just the two known
   failures. Produce the full ratio table. `anubis-light` has no measurements
   at all today.
2. Fix every pair that falls below 4.5:1 where the token renders normal text,
   and below 3:1 where it renders only a user-interface boundary.
3. Prefer darkening the fill or switching the content token to the dark
   `#131317`, as the `warning` pair already does, over lightening the fill.
   Lightening `success` and `info` moves them toward the `base-100` chrome and
   costs the badge its legibility as a status signal.
4. Add a regression test in the style of
   `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts`, which
   already asserts a measured ratio. It must fail when a token pair regresses.
5. Check the rendered result. A ratio table is necessary but is not sufficient
   evidence that the badge still reads as a status signal.

## Why this is not a future risk

Filled `badge-success` and `badge-info` are already used across the product.
Any user reading them today is reading text below the AA threshold. Existing
screens are affected, so the fix will change the appearance of shipped UI. Say
so in the pull request rather than presenting it as a token-only change.

## Acceptance criteria

1. A ratio table exists for every semantic token pair in `anubis` and in
   `anubis-light`.
2. No pair used for normal text measures below 4.5:1.
3. A test fails if any measured pair regresses.
4. The visual result is checked in a live host at both themes, not inferred.

## Open questions

- Does `badge-success` render normal text or is it classed as a user-interface
  component? The threshold is 4.5:1 or 3:1 depending on the answer. `success`
  at 2.64:1 fails either way, so this only affects how far `info` must move.
- Does the VS Code webview inherit any host theme override that changes these
  tokens at runtime? If it does, the measurement must be repeated against the
  composited value rather than the config value.

## Provenance

Recorded first in the open-questions section of the TASK_2026_492_0bcc design
specification, on pull request #563. Re-measured and confirmed against
`tailwind.config.js` when this carrier was filed.
