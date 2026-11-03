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
        /**
         * `base-content-muted` — the secondary tier of the text ladder.
         *
         * Mirrors `apps/ptah-extension-webview/tailwind.config.js`. This app
         * has its OWN daisyUI config and shares nothing with the webview's, so
         * the token has to be registered here too — and it must be, because
         * `libs/frontend/markdown` and `libs/frontend/chat` are compiled
         * through THIS config as well as the webview's.
         *
         * Why a token and not `text-base-content/NN`: the landing theme's
         * `/40` text fails WCAG AA against `base-100`. The measured
         * `--bcm` value provides a muted tier with sufficient contrast.
         *
         * The `var(--bc)` fallback is deliberate and load-bearing: a theme with
         * no measured `--bcm` renders at FULL base-content contrast. An
         * unhandled theme degrades to "not visually muted", never to "fails
         * contrast".
         *
         * Values are recomputed from the literal theme colours by
         * `src/app/base-content-muted.spec.ts`, which fails if any drops below
         * 4.5:1 or if a theme declared here has no value.
         */
        'base-content-muted': 'oklch(var(--bcm, var(--bc)) / <alpha-value>)',
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
          // Secondary text tier: base-content mixed 40% toward base-100 in
          // OKLCH → 5.46:1. See the `colors` block above and
          // base-content-muted.spec.ts, which re-measures it.
          '--bcm': '61.980067% 0.006234 266.580599',
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
    ],
    darkTheme: 'operator',
    base: true,
    styled: true,
    utils: true,
    prefix: '',
    logs: false,
  },
};
