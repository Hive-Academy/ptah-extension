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
        'state-run': 'var(--state-ink-run, oklch(var(--in)))',
        'state-need': 'var(--state-ink-need, oklch(var(--wa)))',
        'state-err': 'var(--state-ink-err, oklch(var(--er)))',
        'state-done': 'var(--state-ink-done, oklch(var(--su)))',
        'state-idle': 'var(--state-ink-idle, oklch(var(--bc)))',
        'surface-0': 'var(--surface-0)',
        'surface-1': 'var(--surface-1)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        'surface-border': 'var(--surface-border)',
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
          // Secondary text tier. 35.3% toward base-100 in OKLCH → 6.06:1 on
          // base-100, 5.66:1 on base-200, 5.01:1 on base-300 (the 40% value
          // was 4.37:1 on base-300). See the `colors` block above and
          // base-content-muted.spec.ts.
          '--bcm': '66.509856% 0.007403 31.090978',
          '--state-ink-run': '#3b82f6',
          '--state-ink-need': '#f97316',
          '--state-ink-err': '#ef4444',
          '--state-ink-done': '#16a34a',
          '--state-ink-idle': '#9ca3af',
          // Pending-todo checkbox outline: base-content at this alpha
          // (5.05:1 here, 3.68:1 on anubis-light; UI minimum 3:1). The stock
          // themes use 70% from styles.css (TASK_2026_677 design-spec 8.2).
          '--ptah-check-edge': '55%',

          // SEMANTIC COLORS
          info: '#3b82f6',
          'info-content': '#e8e6e1',

          success: '#16a34a',
          'success-content': '#e8e6e1',

          // WARNING: true orange, deliberately distinct from the brand
          // gold in `secondary`/`accent`. Warning used to be #fbbf24 — the same
          // hue family as the gold — so every caution affordance read as brand
          // chrome and every brand accent read as a warning.
          warning: '#f97316',
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
          // Dark text on light primary. 36% lightness, not Cupcake's 43%:
          // daisyUI 4's `btn-primary:hover` fill is primary mixed 10% toward
          // black in OKLab (#3accb7), where 43% measured 3.87:1 (Batch 68
          // axe). 36% is 5.23:1 on that hover fill and 6.99:1 on primary.
          'primary-content': 'oklch(36% 0.078 188.216)',

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
          // Secondary text tier. 34.2% toward base-100 in OKLCH → 6.03:1 on
          // base-100, 5.39:1 on base-200, 5.01:1 on base-300 (the 40% value
          // was 4.47:1 on base-200). See the `colors` block above and
          // base-content-muted.spec.ts.
          '--bcm': '48.955188% 0.044796 348.478612',
          '--state-ink-run': '#2a56c6',
          '--state-ink-need': '#8f5200',
          '--state-ink-err': '#b4232a',
          '--state-ink-done': '#13713a',
          '--state-ink-idle': '#6b6570',
          '--ptah-check-edge': '55%', // pending-todo checkbox outline, see `anubis`

          // SEMANTIC COLORS (cupcake exact match)
          info: 'oklch(68% 0.169 237.323)',
          'info-content': 'oklch(29% 0.066 243.157)', // Dark text on info

          success: 'oklch(69% 0.17 162.48)',
          'success-content': 'oklch(26% 0.051 172.552)', // Dark text on success

          // Orange, rotated farther off the gold hue for the same reason as the
          // dark theme (see the `anubis` warning note above). Cupcake's stock
          // warning sat at hue 86 — indistinguishable from `secondary` gold.
          warning: 'oklch(72% 0.18 55)',
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
      {
        "ptah-glass": {
          "color-scheme": "dark",
          "primary": "#e4b94a",
          "primary-focus": "#f2cd6b",
          "primary-content": "#1b1403",
          "secondary": "#efd48c",
          "secondary-focus": "#f6e2ab",
          "secondary-content": "#1b1403",
          "accent": "#45d0be",
          "accent-focus": "#6ce0d1",
          "accent-content": "#04201c",
          "neutral": "#30343a",
          "neutral-focus": "#3a3f47",
          "neutral-content": "#e6e8ec",
          "base-100": "#17191d",
          "base-200": "#202329",
          "base-300": "#2a2e35",
          "base-content": "#f2f2f1",
          "--bcm": "90.050% 0.0071 268.54",
          "--state-ink-run": "#93bdff",
          "--state-ink-need": "#ffb066",
          "--state-ink-err": "#ff9696",
          "--state-ink-done": "#5fe0a0",
          "--state-ink-idle": "#dcdee3",
          "--ptah-check-edge": "70%",
          "info": "#6aa6ff",
          "info-content": "#04122b",
          "success": "#3fd08a",
          "success-content": "#03180d",
          "warning": "#ff9f45",
          "warning-content": "#231000",
          "error": "#ff6b6b",
          "error-content": "#2a0505",
          "--rounded-box": "1.5rem",
          "--rounded-btn": "9999px",
          "--rounded-badge": "9999px",
          "--animation-btn": "0.18s",
          "--animation-input": "0.2s",
          "--btn-focus-scale": "1.02",
          "--border-btn": "1px",
          "--tab-border": "1px",
          "--tab-radius": "9999px"
        }
      },
      {
        "ptah-glass-light": {
          "color-scheme": "light",
          "primary": "#7c5700",
          "primary-focus": "#624300",
          "primary-content": "#fff8e6",
          "secondary": "#9a6b12",
          "secondary-focus": "#7a5300",
          "secondary-content": "#fff8e6",
          "accent": "#0b7f77",
          "accent-focus": "#08655f",
          "accent-content": "#effffd",
          "neutral": "#2b2650",
          "neutral-focus": "#1f1b3d",
          "neutral-content": "#f1eefc",
          "base-100": "#f7f3fd",
          "base-200": "#eee8f8",
          "base-300": "#e2daf1",
          "base-content": "#1e1936",
          "--bcm": "46.559% 0.0614 293.53",
          "--state-ink-run": "#2449b0",
          "--state-ink-need": "#8f5200",
          "--state-ink-err": "#a31f26",
          "--state-ink-done": "#0f6434",
          "--state-ink-idle": "#5f5878",
          "--ptah-check-edge": "55%",
          "info": "#2a5fd0",
          "info-content": "#ffffff",
          "success": "#167a45",
          "success-content": "#ffffff",
          "warning": "#f59a3a",
          "warning-content": "#2a1300",
          "error": "#cf3a3a",
          "error-content": "#ffffff",
          "--rounded-box": "1.5rem",
          "--rounded-btn": "9999px",
          "--rounded-badge": "9999px",
          "--animation-btn": "0.18s",
          "--animation-input": "0.2s",
          "--btn-focus-scale": "1.02",
          "--border-btn": "1px",
          "--tab-border": "1px",
          "--tab-radius": "9999px"
        }
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
    darkTheme: 'ptah-glass',
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
    themeRoot: '[data-theme=ptah-glass]',
    base: true,
    styled: true,
    utils: true,
    prefix: '',
    logs: false,
  },
};
