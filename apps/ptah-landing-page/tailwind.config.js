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
        ink: {
          950: '#08090c',
          900: '#0e1015',
          850: '#12141a',
          800: '#171a21',
          700: '#262a33',
          600: '#3a3f4b',
          500: '#5b616f',
          400: '#8b92a1',
          300: '#b7bdc9',
          100: '#e9ebef',
        },
        amber: { 400: '#ffbb4d', 500: '#f5a524', 600: '#c97e0e' },
        // Wires the daisyUI custom property `--surface-high` (declared per
        // dark/light theme below — see panel-theme-spec.md §1) into a real
        // utility class. Without this, `--surface-high` is emitted into the
        // compiled stylesheet as a declared-but-unconsumed CSS variable —
        // no `.bg-surface-high`/`.border-surface-high` etc. exist to read
        // it. This makes it a normal Tailwind color token backed by the
        // theme-scoped CSS var, so it repaints correctly under both
        // `data-theme=operator-admin/-member` (#34486a) and
        // `data-theme=operator-member-light` (#e2e2ea).
        'surface-high': 'var(--surface-high)',
        // Same wiring pattern for `--border-hairline` (panel-theme-spec.md
        // §2). `base-300` cannot double as both a raised-surface fill and a
        // hairline stroke — those two roles need different lightness, and
        // conflating them made `border-base-300` on a `bg-base-200` card
        // measure 1.05:1 (functionally invisible) after the ladder widened.
        // `hairline` is its own token so borders stay legible independent
        // of whatever the surface ladder does next.
        hairline: 'var(--border-hairline)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
        // 'display' (Cinzel) REMOVED — do not carry it forward.
      },
      fontSize: {
        '8xl': ['6rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
        '9xl': ['8rem', { lineHeight: '0.95', letterSpacing: '-0.04em' }],
      },
      animation: {
        'glow-pulse': 'glow-pulse 2.2s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2.2s ease-out infinite',
        'divider-draw': 'divider-draw 1.2s ease-out forwards',
        'status-blink': 'status-blink 2s ease-in-out infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 30px rgba(245,165,36,0.25)' },
          '50%': { boxShadow: '0 0 46px rgba(245,165,36,0.40)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(245,165,36,0.35)' },
          '50%': { boxShadow: '0 0 0 14px rgba(245,165,36,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(245,165,36,0)' },
        },
        'divider-draw': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'status-blink': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.35 },
        },
      },
      boxShadow: {
        device: '0 30px 80px -20px rgba(0,0,0,0.65)',
        'glow-amber': '0 0 60px rgba(245,165,36,0.28)',
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        operator: {
          primary: '#f5a524',
          'primary-focus': '#c97e0e',
          'primary-content': '#08090c',
          secondary: '#34d399',
          'secondary-focus': '#10b981',
          'secondary-content': '#08090c',
          accent: '#ffbb4d',
          'accent-focus': '#f5a524',
          'accent-content': '#08090c',
          neutral: '#12141a',
          'neutral-focus': '#171a21',
          'neutral-content': '#b7bdc9',
          'base-100': '#08090c',
          'base-200': '#0e1015',
          'base-300': '#171a21',
          'base-content': '#e9ebef',
          info: '#38bdf8',
          'info-content': '#08090c',
          success: '#34d399',
          'success-content': '#08090c',
          // #eab308 (Tailwind yellow-500): differentiates `warning` from the
          // brand-amber `primary` (#f5a524), which were hex-identical and made
          // every badge-warning/alert-warning indistinguishable from a primary
          // CTA. See visual-design-specification §7.3.
          warning: '#eab308',
          'warning-content': '#08090c',
          error: '#fb7185',
          'error-content': '#08090c',
          '--rounded-box': '0.75rem',
          '--rounded-btn': '0.5rem',
          '--rounded-badge': '999px',
          '--animation-btn': '0.15s',
          '--animation-input': '0.2s',
          '--btn-focus-scale': '1.0',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.5rem',
        },
      },
      {
        // Admin-only theme: reconciled against 8 Stitch-generated Ptah
        // Builders mockups (docs/design-system/panel-theme-spec.md).
        //
        // History: v1 lifted base-200/300 straight off
        // kinetic_operator/DESIGN.md's Material-3 frontmatter (too flat vs
        // the old theme). v2 "fixed" that by widening the ladder to hit
        // arbitrary WCAG targets (overcorrected — rendered as a visibly
        // different, lighter navy-slate product than the reference). v3
        // (this version) is grounded in pixel-sampled evidence from the
        // actual mockup canvases (60k+ sample histograms): page bg and card
        // fill sample at #0c141f/~#161a23-#151c27, a page→card ratio of only
        // ~1.06-1.08:1 — the mockups do NOT create depth via background-step
        // distance. Their card definition comes from a sampled hairline
        // border at ~(44,51,66) giving ~1.43:1 card-to-border contrast. So:
        // base-100/200/300/surface-high are back to the tight v1 values
        // (matches the sampled evidence almost exactly), and depth instead
        // comes from `--border-hairline`, tuned to hit the sampled ~1.43:1
        // card-to-border ratio — see spec §1/§2 for the full derivation.
        // Scoped via data-theme on the admin shell root so the marketing
        // site keeps `operator` untouched.
        'operator-admin': {
          primary: '#f5a524',
          'primary-focus': '#c97e0e',
          'primary-content': '#08090c',
          secondary: '#34d399',
          'secondary-focus': '#10b981',
          'secondary-content': '#08090c',
          accent: '#ffbb4d',
          'accent-focus': '#f5a524',
          'accent-content': '#08090c',
          neutral: '#151c27',
          'neutral-focus': '#232936',
          'neutral-content': '#b7bdc9',
          'base-100': '#0c141f',
          'base-200': '#151c27',
          'base-300': '#19202c',
          'base-content': '#dce2f3',
          info: '#38bdf8',
          'info-content': '#08090c',
          success: '#34d399',
          'success-content': '#08090c',
          // #eab308 (Tailwind yellow-500): differentiates `warning` from the
          // brand-amber `primary` (#f5a524). See visual-design-specification
          // §7.3 and panel-theme-spec.md §3 — do not undo this.
          warning: '#eab308',
          'warning-content': '#08090c',
          error: '#fb7185',
          'error-content': '#08090c',
          '--surface-high': '#232936',
          '--border-hairline': '#303849',
          '--rounded-box': '0.75rem',
          '--rounded-btn': '0.5rem',
          '--rounded-badge': '999px',
          '--animation-btn': '0.15s',
          '--animation-input': '0.2s',
          '--btn-focus-scale': '1.0',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.5rem',
        },
      },
      {
        // Member-facing shell (dashboard home, community feed, discussion
        // threads, course viewer). Same tight, evidence-grounded dark
        // ladder as `operator-admin` — see
        // docs/design-system/panel-theme-spec.md — kept as a separate theme
        // name so the member shell can diverge from the admin shell later
        // without touching admin.
        'operator-member': {
          primary: '#f5a524',
          'primary-focus': '#c97e0e',
          'primary-content': '#08090c',
          secondary: '#34d399',
          'secondary-focus': '#10b981',
          'secondary-content': '#08090c',
          accent: '#ffbb4d',
          'accent-focus': '#f5a524',
          'accent-content': '#08090c',
          neutral: '#151c27',
          'neutral-focus': '#232936',
          'neutral-content': '#b7bdc9',
          'base-100': '#0c141f',
          'base-200': '#151c27',
          'base-300': '#19202c',
          'base-content': '#dce2f3',
          info: '#38bdf8',
          'info-content': '#08090c',
          success: '#34d399',
          'success-content': '#08090c',
          warning: '#eab308',
          'warning-content': '#08090c',
          error: '#fb7185',
          'error-content': '#08090c',
          '--surface-high': '#232936',
          '--border-hairline': '#303849',
          '--rounded-box': '0.75rem',
          '--rounded-btn': '0.5rem',
          '--rounded-badge': '999px',
          '--animation-btn': '0.15s',
          '--animation-input': '0.2s',
          '--btn-focus-scale': '1.0',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.5rem',
        },
      },
      {
        // Light-mode counterpart to `operator-member`. Ladder + primary/
        // accent are reconciled from the 4 light-mode Stitch screens plus
        // warm_professionalism/DESIGN.md — see panel-theme-spec.md §1/§3.
        // Brand primary stays #f5a524 in light mode too (decision, not
        // Stitch's own inconsistent per-screen light CTA color).
        // base-100/200/300 are intentionally left tight (page #faf9f7 vs
        // card #ffffff samples at ~1.05:1) — same idiom as the dark ladder,
        // confirmed by pixel-sampling both mockups: neither theme creates
        // depth via background-step distance. `--border-hairline` is tuned
        // (darker than the previously-cited #e2ddd4) to actually read
        // against a pure-white card — see spec §2.
        'operator-member-light': {
          primary: '#f5a524',
          'primary-focus': '#c97e0e',
          'primary-content': '#08090c',
          secondary: '#34d399',
          'secondary-focus': '#10b981',
          'secondary-content': '#08090c',
          accent: '#ffbb4d',
          'accent-focus': '#f5a524',
          'accent-content': '#08090c',
          neutral: '#f2f0ec',
          'neutral-focus': '#e2ddd4',
          'neutral-content': '#1a1c22',
          'base-100': '#faf9f7',
          'base-200': '#ffffff',
          'base-300': '#f2f0ec',
          'base-content': '#1a1c22',
          info: '#38bdf8',
          'info-content': '#08090c',
          success: '#34d399',
          'success-content': '#08090c',
          warning: '#eab308',
          'warning-content': '#08090c',
          error: '#fb7185',
          'error-content': '#08090c',
          '--surface-high': '#e2e2ea',
          '--border-hairline': '#dcd6cb',
          '--rounded-box': '0.75rem',
          '--rounded-btn': '0.5rem',
          '--rounded-badge': '999px',
          '--animation-btn': '0.15s',
          '--animation-input': '0.2s',
          '--btn-focus-scale': '1.0',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.5rem',
        },
      },
    ],
    darkTheme: 'operator',
    base: true,
    styled: true,
    utils: true,
    prefix: '',
    logs: false,
  },
};
