# Lane Fix H: contrast fixes for the Rail split pane headers (decision row 113)

**Verdict: DONE.** Findings 1 and 2 from `codex-review-split-headers.md` are fixed. Both changed specs pass: header 18/18 and board 74/74, the same counts as the baselines. Finding 3 was out of scope and was not touched.

## How the numbers were computed

- Colors come from `apps/ptah-extension-webview/tailwind.config.js` (themes `anubis` and `anubis-light`).
- OKLCH values were converted to sRGB with the standard OKLab matrices and clamped to the sRGB gamut, as a browser does. Hex values below are after that conversion.
- Contrast uses the WCAG 2.x relative-luminance formula.
- The old `/15` alpha divider was composited in sRGB onto the surface.

| Token | anubis | anubis-light (source -> sRGB) |
|---|---|---|
| `--p` primary | `#2563eb` | `oklch(85% 0.138 181.071)` -> `#44ebd3` |
| `--pc` primary-content | `#f8f7f4` | `oklch(36% 0.078 188.216)` -> `#004a45` |
| `--b1` base-100 | `#131317` | `oklch(97.788% 0.004 56.375)` -> `#faf7f5` |
| `--b2` base-200 | `#1a1a20` | `oklch(93.982% 0.007 61.449)` -> `#efeae6` |
| `--b3` base-300 | `#242430` | `oklch(91.586% 0.006 53.44)` -> `#e7e2df` |
| `--bc` base-content | `#e8e6e1` | `oklch(23.574% 0.066 313.189)` -> `#291334` |
| `--bcm` base-content-muted | `66.51% 0.0074 31.09` -> `#989291` | `48.96% 0.0448 348.48` -> `#745665` |

Note: in anubis-light, `primary-content` on `primary` measures 6.84:1 with this gamut clamp. The theme comment says 6.99:1, which comes from a different gamut mapping. Both values are above 4.5:1.

## Finding 1: active-pane top bar and active marker fill (Serious)

**Change** in `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`:

- `:18-27` (styles): added two component-local custom properties.
  - `:host` sets `--pane-accent: oklch(var(--p))` and `--pane-accent-ink: oklch(var(--pc))`.
  - `:host-context([data-theme='anubis-light'])` swaps them: `--pane-accent: oklch(var(--pc))` and `--pane-accent-ink: oklch(var(--p))`.
  - `.pane-active` now draws `box-shadow: inset 0 2px 0 0 var(--pane-accent)`. It was `oklch(var(--p))`.
  - New rule `.pane-marker-active { background-color: var(--pane-accent); color: var(--pane-accent-ink); }`.
- `:36` (template): the active marker binding `[class.bg-primary]` plus `[class.text-primary-content]` became `[class.pane-marker-active]="paneFocused()"`. The inactive marker bindings (`bg-base-200`, `text-base-content-muted`) are unchanged.

The bar and the marker sit on the header, which is `bg-base-100`. Ratios are also given against base-200 as a margin check.

| Check (needed) | anubis before | anubis after | anubis-light before | anubis-light after |
|---|---|---|---|---|
| Bar and marker fill vs base-100 (>= 3:1) | `#2563eb`/`#131317` **3.59** | same, **3.59** | `#44ebd3`/`#faf7f5` **1.40** (fail) | `#004a45`/`#faf7f5` **9.59** |
| Bar and marker fill vs base-200 | 3.35 | 3.35 | 1.25 | 8.56 |
| Marker numeral on fill (>= 4.5:1) | `#f8f7f4` on `#2563eb` **4.82** | same, **4.82** | `#004a45` on `#44ebd3` 6.84 | `#44ebd3` on `#004a45` **6.84** |

In both themes the numeral still uses the theme's measured primary pair, so the fill and the text stay a primary/primary-content pair. In anubis-light the two colors swap places: the dark teal fill carries the light teal numeral.

Themes other than the two anubis themes keep the previous `primary` fill with `primary-content` text, as before this change.

**Specs:** `canvas-focus-header.component.spec.ts:162` and `:176` now assert `pane-marker-active` in place of `bg-primary` and `text-primary-content`. No other change.

## Finding 2: split divider (Serious)

**Change** at `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:143`: `[class.border-base-content/15]="splitDisplayed()"` became `[class.border-base-content-muted]="splitDisplayed()"`. These bindings are unchanged: `border-l` and `border-t` (gated on `paneNumber(side) === 2` and on `splitStacked()`), `data-pane-divider`, `gap-1`, `min-w`/`min-h`, `order`, and the activation handlers.

The divider is next to the pane surface (`canvas-focus-area` is `bg-base-100`) and to the 4 px gap, which shows the board surface (base-100 or base-200). The token was also checked against base-300.

| Check (>= 3:1) | anubis before (`bc/15`) | anubis after (`#989291`) | anubis-light before (`bc/15`) | anubis-light after (`#745665`) |
|---|---|---|---|---|
| vs base-100 | 1.46 | **6.06** | 1.36 | **6.03** |
| vs base-200 | 1.50 | **5.66** | 1.35 | **5.39** |
| vs base-300 | n/a | **5.01** | n/a | **5.01** |

These values match the measured ratios recorded for `--bcm` in the tailwind config comments and in `base-content-muted.spec.ts`. In a theme with no `--bcm`, the token falls back to full `--bc`, which never drops below the contrast target.

**Specs:** `canvas-rail-board.component.spec.ts:1517` and `:1576` now name `border-base-content-muted` in place of `border-base-content/15`.

## Verification

All commands were run from W through the lock, one at a time:

- `node .ptah/tmp/check-run.mjs fixh-header -- npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - Exit 0. `Test Suites: 1 passed`, `Tests: 18 passed, 18 total` (baseline 18/18).
- `node .ptah/tmp/check-run.mjs fixh-board -- npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - Exit 0. `Tests: 74 passed, 74 total` (baseline 74/74).

Not run:

- Rendered or visual check: Jest uses JSDOM and does not compute theme CSS. The ratios come from the theme source.
- Type-check or lint: outside the requested scope. The change is a style string and a template class binding.

Nothing else changed:

- Rail split behavior: swap, active side, 1/2 markers, stacked Tab order.
- The display dock.
- `libs/frontend/chat` and `canvas-detail`.

## Decisions

1. **Per-theme accent via `:host-context([data-theme='anubis-light'])` plus component-local CSS variables.**
   - Options:
     - (a) One DaisyUI token for both themes: `primary` fails light at 1.40; `primary-content` passes both, but turns the dark-theme accent near-white and drops the blue cue.
     - (b) `--state-ink-run`: passes, but reuses the "running" state ink for a non-state cue and would read as the state chip.
     - (c) Theme-scoped override: chosen.
     - (d) A new theme token in `tailwind.config.js`: outside this lane's ownership, and a new token needs a plan.
   - Evidence: no canvas component has a per-theme selector. The canvas lib only consumes theme-defined vars (`--state-ink-*`). The closest repo precedents for a component-level override are `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts:121` and `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:48`, which both use `:host-context([data-theme='anubis-light'])`.
   - Reversible: yes. Delete the two variable lines and restore the old binding.
2. **Invert the primary pair in anubis-light rather than introduce a new color.**
   - Options: deepened gold `--ptah-gold-strong`, rejected because it is the light-theme focus-ring color and would make an active pane look focused; a hand-picked teal, rejected as a new unmeasured value.
   - Evidence: the light `primary-content` is the brand teal, deepened and already measured against `primary`. Here it measures 9.59:1 on base-100, and `primary` measures 6.84:1 on it.
   - Reversible: yes.
3. **Divider uses the existing `base-content-muted` token.**
   - Options: a lower alpha such as `base-content/40`, rejected because TASK_2026_183 removed per-alpha ink since no single alpha holds across themes; full `base-content` at 14.9 to 15.9:1, rejected as heavier than the divider needs.
   - Evidence: `--bcm` is per-theme, computed, and pinned by `base-content-muted.spec.ts`. It falls back to `--bc` for unmeasured themes. It measures 5.01 to 6.06:1 on every base surface in both themes.
   - Reversible: yes, a one-class change.
