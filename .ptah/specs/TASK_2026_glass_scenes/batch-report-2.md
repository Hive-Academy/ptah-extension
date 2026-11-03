# Glass scene visibility follow-up

## Files changed

- `apps/ptah-extension-webview/src/styles.css` — reduce Ptah Glass optical blur and scene tint; strengthen local chrome and reading backing.
- `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts` — update scene tint floors and guard the pair-specific blur and backing tokens.
- `.ptah/specs/TASK_2026_glass_scenes/batch-report-2.md` — this report.

## Effective token changes

All overrides below apply only to `:root[data-theme='ptah-glass'][data-glass='on']` or `:root[data-theme='ptah-glass-light'][data-glass='on']`. Other themes keep their existing values.

| Token | Dark old → new | Light old → new |
| --- | --- | --- |
| `--glass-blur` | 16px → 7px | 16px → 7px |
| `--glass-blur-overlay` | 22px → 12px | 22px → 12px |
| `--glass-saturation` | 1.16 → 1.08 | 1.15 → 1.08 |
| `--glass-under` | base-100 / 0.18 → base-100 / 0.30 | unchanged |
| `--glass-fill` | unchanged | base-100 / 0.44 → base-100 / 0.60 |
| `--glass-scrim-text` | unchanged | base-100 / 0.50 → base-100 / 0.60 |
| `--bcm` caption ink | unchanged | `46.559% 0.0614 293.53` → `40% 0.0614 293.53` |
| `--glass-tint-alpha-aurora` | 0.70 → 0.58 | 0.50 → 0.38 |
| `--glass-tint-alpha-ember` | 0.62 → 0.50 | 0.42 → 0.35 |
| `--glass-tint-alpha-tide` | 0.58 → 0.45 | 0.42 → 0.35 |
| `--glass-tint-alpha-horizon` | 0.50 → 0.42 | 0.38 → 0.32 |
| `--glass-tint-alpha-pyramid` | 0.82 → 0.68 | 0.84 → 0.55 |
| `--glass-tint-alpha-temple` | 0.78 → 0.68 | 0.82 → 0.55 |

`--glass-filter` and `--glass-filter-overlay` already reference the blur and saturation tokens, so the scoped overrides change both filters without adding another rule. Overlays retain more blur and their near-opaque fills. Existing accessibility escape hatches still make surfaces opaque when transparency or contrast preferences require it.

## Readability and visual evidence

I decoded the four SVG scenes from `styles.css` and both WebP images with `sharp`, scaled each to 900×900 and 1280×900 with CSS `cover` behavior, then checked every pixel. The calculation composited the scene tint and the chrome pane fill in sRGB, converted the resulting pixels to WCAG relative luminance, and compared the worst pixel with the theme's body ink and `--bcm` caption ink. It used the unblurred scene, a conservative check for the bright Pyramid and Temple pixels. Dark chrome included the 0.30 base-100 under-scrim and existing 0.06 base-content fill; light chrome included the 0.60 base-100 fill. The reading scrims and raised cards add more backing locally.

| Mode | Lowest caption contrast on any scene | Lowest body contrast on any scene |
| --- | ---: | ---: |
| Dark chrome | 5.42:1 (Temple) | 6.52:1 (Temple) |
| Light chrome | 5.65:1 (Pyramid and Temple) | 10.12:1 (Pyramid and Temple) |

These modeled minima clear the documented 4.5:1 caption and 6.2:1 body targets for chrome panes. Bare text over the image scenes is not covered by this pane model; the existing surface roles and reading scrims remain necessary for text placed on the backdrop. The spec guards minimum tint and local backing values, not a pixel-level browser contrast measurement.

I rendered a temporary static Pyramid composition with the new pane, tint, and reading-plane values and inspected its screenshot. The apex and surrounding image remained visible through both large panes, while text and composer samples remained legible. This preview was removed; it was not a full Electron application render.

## Decisions

- Keep the optical changes scoped to the Ptah Glass pair. The alternatives were changing the shared glass defaults or adding component rules. The request limits this change to the pair, and existing theme selectors and surface roles provide the required boundary. Reversible.
- Use a darker light-mode caption ink and stronger local pane fill to permit a much lower image tint. The alternative was retaining a high full-window tint to protect bare text. The pixel model clears both documented targets in chrome at the chosen values, and the static preview shows more of the scene. Reversible.

## Verification

Command: `npm run verify -- -p ptah-extension-webview`

Result: **passed**, exit code 0; Nx reported 3 of 3 tasks succeeded (lint, test, typecheck), with 0 cache hits. The command was run after the CSS and spec changes; a subsequent CSS edit changed comments only.

Scoped `ptah_get_diagnostics` found no diagnostics in the changed spec. It does not recognize CSS and reported 16 errors in unchanged sibling files under its own compiler configuration. The required scoped verify gate passed.

The optional `angular-frontend-patterns` skill could not be loaded because this lane exposed no skill-loading tool. No build, serve, e2e, package, or workspace-wide target was run.
