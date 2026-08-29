const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, 'src/**/!(*.stories|*.spec).{ts,html}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  theme: {
    extend: {
      colors: {
        /**
         * `base-content-muted` — the secondary tier of the text ladder.
         *
         * TASK_2026_183 removed `text-base-content/40|50|60|80` because no
         * single alpha is correct on every theme: composited in sRGB, anubis
         * `/40` is 3.31:1 and the built-in daisyUI `dark` fails even at `/60`
         * (3.45:1) because its base-content is only 7.03:1 at FULL opacity.
         * Hierarchy therefore has to come from a value chosen per theme, which
         * is what `--bcm` is. Values are computed, not eyeballed — see the
         * ratio table in TASK_2026_186 and `src/app/base-content-muted.spec.ts`,
         * which recomputes every theme from the literal theme source and fails
         * if any drops below 4.5:1.
         *
         * The `var(--bc)` fallback is deliberate and load-bearing: a theme that
         * has no measured `--bcm` renders at full base-content contrast. An
         * unhandled theme therefore degrades to "not visually muted", never to
         * "fails contrast".
         */
        'base-content-muted': 'oklch(var(--bcm, var(--bc)) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
        display: ['Cinzel', 'Playfair Display', 'serif'],
      },
      animation: {
        glow: 'glow 2s ease-in-out infinite',
        'glow-urgent': 'glow-urgent 1s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%, 100%': {
            boxShadow:
              '0 0 4px 1px oklch(var(--wa) / 0.3), 0 0 8px 2px oklch(var(--wa) / 0.15)',
          },
          '50%': {
            boxShadow:
              '0 0 8px 2px oklch(var(--wa) / 0.5), 0 0 16px 4px oklch(var(--wa) / 0.25)',
          },
        },
        'glow-urgent': {
          '0%, 100%': {
            boxShadow:
              '0 0 6px 2px oklch(var(--er) / 0.4), 0 0 12px 4px oklch(var(--er) / 0.2)',
          },
          '50%': {
            boxShadow:
              '0 0 12px 4px oklch(var(--er) / 0.6), 0 0 24px 8px oklch(var(--er) / 0.3)',
          },
        },
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        anubis: {
          // PRIMARY: Bright Blue (visible on dark surfaces)
          primary: '#2563eb',
          'primary-focus': '#1d4ed8',
          'primary-content': '#f8f7f4',

          // SECONDARY: Pharaoh's Gold (unchanged - brand anchor)
          secondary: '#d4af37',
          'secondary-focus': '#92400e',
          'secondary-content': '#131317',

          // ACCENT: Gold Light (unchanged)
          accent: '#fbbf24',
          'accent-focus': '#d4af37',
          'accent-content': '#131317',

          // NEUTRAL: Blue-tinted dark (distinct from base-200)
          neutral: '#1e1e26',
          'neutral-focus': '#2a2a34',
          'neutral-content': '#d1d5db',

          // BASE: Softened background hierarchy (blue-tinted charcoal)
          'base-100': '#131317',
          'base-200': '#1a1a20',
          'base-300': '#242430',
          'base-content': '#e8e6e1',
          // Secondary text tier. 40% toward base-100 in OKLCH → 5.29:1. See
          // the `colors` block above and base-content-muted.spec.ts.
          '--bcm': '63.048152% 0.00745 23.427972',

          // SEMANTIC COLORS
          info: '#3b82f6',
          'info-content': '#e8e6e1',

          success: '#16a34a',
          'success-content': '#e8e6e1',

          // WARNING: true amber-orange, deliberately distinct from the brand
          // gold in `secondary`/`accent`. Warning used to be #fbbf24 — the same
          // hue family as the gold — so every caution affordance read as brand
          // chrome and every brand accent read as a warning.
          warning: '#f59e0b',
          'warning-content': '#131317',

          error: '#dc2626',
          'error-content': '#e8e6e1',

          // DAISYUI CUSTOM PROPERTIES (unchanged)
          '--rounded-box': '0.75rem',
          '--rounded-btn': '0.375rem',
          '--rounded-badge': '0.25rem',
          '--animation-btn': '0.15s',
          '--animation-input': '0.2s',
          '--btn-focus-scale': '1.02',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.5rem',
        },
        'anubis-light': {
          // Light theme variant - Exact Cupcake theme colors
          // Maintains warm, friendly aesthetic with proper contrast

          // PRIMARY: Cupcake teal (exact match)
          primary: 'oklch(85% 0.138 181.071)',
          'primary-focus': 'oklch(80% 0.15 181)',
          'primary-content': 'oklch(43% 0.078 188.216)', // Dark text on light primary

          // SECONDARY: Anubis gold — darkened for readable contrast on the
          // cream base (brand anchor). The dark theme keeps bright #d4af37;
          // here it is deepened so headings/accents keyed on --s stay legible.
          secondary: 'oklch(58% 0.132 75)',
          'secondary-focus': 'oklch(50% 0.12 72)',
          'secondary-content': 'oklch(98% 0.015 80)', // Light text on gold secondary

          // ACCENT: Cupcake warm accent (exact match)
          accent: 'oklch(90% 0.076 70.697)',
          'accent-focus': 'oklch(85% 0.1 70)',
          'accent-content': 'oklch(47% 0.157 37.304)', // Dark text on light accent

          // NEUTRAL: Cupcake dark neutral (exact match)
          neutral: 'oklch(27% 0.006 286.033)',
          'neutral-focus': 'oklch(22% 0.006 286)',
          'neutral-content': 'oklch(92% 0.004 286.32)', // Light text on dark neutral

          // BASE: Cupcake warm cream background (exact match)
          'base-100': 'oklch(97.788% 0.004 56.375)', // Warm white/cream
          'base-200': 'oklch(93.982% 0.007 61.449)', // Slightly darker cream
          'base-300': 'oklch(91.586% 0.006 53.44)', // Card/panel background
          'base-content': 'oklch(23.574% 0.066 313.189)', // Dark purple-gray text
          // Secondary text tier. 40% toward base-100 in OKLCH → 5.01:1. See
          // the `colors` block above and base-content-muted.spec.ts.
          '--bcm': '53.2596% 0.0412 354.4634',

          // SEMANTIC COLORS (cupcake exact match)
          info: 'oklch(68% 0.169 237.323)',
          'info-content': 'oklch(29% 0.066 243.157)', // Dark text on info

          success: 'oklch(69% 0.17 162.48)',
          'success-content': 'oklch(26% 0.051 172.552)', // Dark text on success

          // Amber-orange, rotated off the gold hue for the same reason as the
          // dark theme (see the `anubis` warning note above). Cupcake's stock
          // warning sat at hue 86 — indistinguishable from `secondary` gold.
          warning: 'oklch(75% 0.17 65)',
          'warning-content': 'oklch(28% 0.066 53.813)', // Dark text on warning

          error: 'oklch(64% 0.246 16.439)',
          'error-content': 'oklch(27% 0.105 12.094)', // Dark text on error

          // DAISYUI CUSTOM PROPERTIES - Cupcake exact settings
          '--rounded-box': '1rem',
          '--rounded-btn': '2rem',
          '--rounded-badge': '1rem',
          '--animation-btn': '0.15s',
          '--animation-input': '0.2s',
          '--btn-focus-scale': '1.02',
          '--border-btn': '2px',
          '--tab-border': '2px',
          '--tab-radius': '0.5rem',
        },
      },
      // The 32 daisyUI v4 prebuilt themes are DELIBERATELY ABSENT here.
      //
      // They are NOT deleted — `DAISYUI_THEMES` in
      // libs/frontend/core/src/lib/services/theme.service.ts still exposes all
      // 34 themes in the picker and they all still work. They are compiled
      // into a SEPARATE, non-injected stylesheet (`theme-extra.css`, emitted
      // from `node_modules/daisyui/dist/themes.css` — the same 32 themes, from
      // the same daisyUI package) which is fetched only by users whose
      // persisted theme is one of those 32. See:
      //   - apps/ptah-extension-webview/project.json  (`styles` -> inject:false)
      //   - apps/ptah-extension-webview/src/index.html (pre-paint loader)
      //   - ThemeService.setTheme (runtime loader)
      //
      // Adding a prebuilt theme name back here re-inflates the initial bundle
      // by ~800 B of raw CSS per theme and duplicates it against the deferred
      // sheet. Don't.
    ],
    darkTheme: 'anubis',
    // Keep the eager themes OFF bare `:root`.
    //
    // daisyUI copies the first theme to `themeRoot` (default `:root`) as an
    // unconditional fallback, on top of the `[data-theme=anubis]` block it
    // emits anyway. That `:root` copy and `theme-extra.css`'s
    // `[data-theme=<one of 32>]` rules have the SAME specificity (0,1,0), so
    // which one wins is decided purely by sheet order — and the deferred sheet
    // loads BEFORE styles.css (index.html inserts it while the parser is still
    // mid-`<head>`, and the build appends styles.css at the end of `<head>`).
    // anubis therefore won every deferred theme, and selecting one of the 32
    // changed only `--bcm`, which styles.css sets per theme further down.
    //
    // Pointing themeRoot at the theme's own attribute selector collapses the
    // duplicate: styles.css now contributes NO theme variables unless
    // `data-theme` is actually `anubis`. `<html data-theme="anubis">` is
    // hardcoded in index.html and ThemeService always writes the attribute, so
    // nothing relies on the bare-`:root` fallback.
    themeRoot: '[data-theme=anubis]',
    base: true,
    styled: true,
    utils: true,
    prefix: '',
    logs: false,
  },
};
