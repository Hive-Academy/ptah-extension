# Design elevation — Batch 0 contract report

## Delivered contract

### Final naming and platform decision

The final Batch 0 token family is the already-shipped public `--surface-*`
family: `--surface-0..3`, `--surface-border`, `--surface-border-strong`,
`--surface-highlight`, `--elev-shadow`, and `--elev-shadow-raised`. The audit
was amended after implementation to propose internal `--pts*` names, but the
caller explicitly directed this completed `--surface-*` implementation not to
churn names. Public `.surface-1/.surface-2/.surface-3` and `.elev-*` classes
remain unchanged and consume that one consistent family.

Batch 0 stays on DaisyUI 4.12 and Tailwind 3.4 with Ptah semantic tokens. It
does not begin a DaisyUI 5/Tailwind 4 migration: v5's global depth/radius/size
knobs do not replace the product-specific four-plane hierarchy, and the audit
identifies the framework upgrade as a separate later spike.

### Tokens and themes

`apps/ptah-extension-webview/src/styles.css:120-147` documents and declares the
semantic elevation contract. The generic `:root, [data-theme]` fallback derives
all surface values from daisyUI 4's `--b1`, `--b2`, `--b3`, and `--bc`:

| Token                                          | Generic value                            |
| ---------------------------------------------- | ---------------------------------------- |
| `--surface-0`                                  | `oklch(var(--b1))`                       |
| `--surface-1`                                  | `color-mix(in oklch, b2 88%, b1)`        |
| `--surface-2`                                  | `oklch(var(--b2))`                       |
| `--surface-3`                                  | `color-mix(in oklch, b3 86%, b2)`        |
| `--surface-border` / `--surface-border-strong` | `bc` at 14% / 22% mixed with transparent |
| `--surface-highlight`                          | `bc` at 10% mixed with transparent       |
| `--elev-shadow` / `--elev-shadow-raised`       | `0 1px 2px bc/10%` / `0 8px 24px bc/18%` |

For Anubis, DaisyUI Dark, and every other theme ThemeService identifies as dark,
`[data-theme-mode='dark']` at `styles.css:141-145` raises the highlight to 13%
and uses the audit's black `0 1px 1px / 28%` and `0 12px 30px / 42%` shadows.
This is intentionally group-based rather than a fragile list of names; the
ThemeService's `isDark` list supplies the marker for all 34 picker themes.

`color-mix()` backgrounds have cheap preceding `oklch(var(--b2|b3))` fallbacks
in the utility rules at `styles.css:306-323`. Tailwind aliases are available at
`apps/ptah-extension-webview/tailwind.config.js:32-36`:
`bg-surface-0..3` and `border-surface-border`.

There are no measured per-theme surface overrides in this batch. All 34 themes
use the documented DaisyUI-derived generic fallback, while the existing
ThemeService dark marker applies the calibrated dark highlight/shadow variant.
Follow-up visual screenshots or measurements may add named overrides beside the
existing `--bcm` blocks without changing the token family or public classes.

### Utility classes

`apps/ptah-extension-webview/src/styles.css:299-326` adds these `@layer
components` classes:

| Class                           | Contract                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `.surface-1`                    | border, surface-1 fallback/background, inset top highlight                   |
| `.surface-2`                    | border, surface-2 fallback/background, inset highlight, compact shadow       |
| `.surface-3`                    | strong border, surface-3 fallback/background, inset highlight, raised shadow |
| `.elev-0`, `.elev-1`, `.elev-3` | no, compact, or raised elevation shadow                                      |

No existing `card` or `bg-base-*` style was globally changed.

### Primitives and API

All primitives are standalone, OnPush, projection-only components under
`libs/frontend/ui/src/lib/surfaces/`; they have no chat or orchestrator imports.
They export from `@ptah-extension/ui` through `src/lib/surfaces/index.ts:1-6`
and `src/index.ts:39`.

| Selector               | Inputs                                               | Slots / a11y                                         | Source                                                       |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `ptah-surface-section` | `tone: 'default'                                     | 'subtle'`, `padding: 'md'                            | 'lg'`                                                        | `[section-header]`, default content | `surface-section.component.ts:5-10` |
| `ptah-surface-card`    | `elevation: 1                                        | 2`, `interactive: boolean`                           | default content                                              | `surface-card.component.ts:3-8`     |
| `ptah-surface-tile`    | `selected: boolean`, `density: 'compact'             | 'default'`                                           | default content; exposes `data-selected`                     | `surface-tile.component.ts:3-9`     |
| `ptah-stat-card`       | required `label`, required `value`, optional `trend` | `[actions]`, default content                         | `stat-card.component.ts:3-9`                                 |
| `ptah-field`           | required `label`, optional `hint`, optional `error`  | one marked `input/select/textarea[ptahFieldControl]` | `field.component.ts:5-10`, `field-control.directive.ts:3-13` |

Spacing/radius: section defaults to `p-5 rounded-xl gap-5`; card is `p-4
rounded-xl`; tile default is `p-3 rounded-lg`; stat card is `p-4 rounded-xl`.
Field labels are `text-xs font-medium`, help/errors are `text-xs
text-base-content-muted`, with 4px label/control and 6px control/help spacing.
The `ptahFieldControl` directive adds the appropriate `input-sm`, `select-sm`,
or `textarea-sm` class.

Field content contract: consumers must import `PtahFieldControlDirective` and
mark the single projected native control. The field generates control and
description IDs, preserves any existing `aria-describedby`, links its help or
error text, and sets `aria-invalid="true"` while an error is present.

## Consumption in batches 1–7

```html
<ptah-surface-section tone="subtle">
  <div section-header>Session settings</div>
  <ptah-surface-card [elevation]="1">…</ptah-surface-card>
</ptah-surface-section>

<ptah-surface-tile [selected]="isActive()">…</ptah-surface-tile>

<ptah-field label="Model" hint="Used for new lanes">
  <select ptahFieldControl class="select">
    …
  </select>
</ptah-field>
```

Use exactly one structural `surface-*` class per new container; do not combine
it with `bg-base-*`. Use `surface-3` for floating/active containers. Pages and
feature components were deliberately not migrated in this batch.

## Verification

- UI focused primitive specs: 5 suites / 5 tests passed.
- Webview token contract spec: 1 suite / 11 tests passed.
- `npx nx typecheck @ptah-extension/ui --parallel=1`: passed.
- `npx nx lint @ptah-extension/ui --parallel=1`: passed.

The test/lint commands reported existing Nx/Tailwind deprecation and disabled
Nx Cloud notices only; neither affected results.

## Deviations

None that alter the audit contract. The audit's illustrative `.theme-dark`
selector is implemented as the actual app-wide `[data-theme-mode='dark']`
marker, so all configured dark DaisyUI themes receive the dark elevation values.
The stat selector is `ptah-stat-card`, which does not collide with the existing
marketplace `StatCardComponent` class.
