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
          'primary-content': '#e8e6e1',

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

          // SEMANTIC COLORS
          info: '#3b82f6',
          'info-content': '#e8e6e1',

          success: '#16a34a',
          'success-content': '#e8e6e1',

          warning: '#fbbf24',
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

          // SECONDARY: Cupcake pink/rose (exact match)
          secondary: 'oklch(89% 0.061 343.231)',
          'secondary-focus': 'oklch(84% 0.08 343)',
          'secondary-content': 'oklch(45% 0.187 3.815)', // Dark text on light secondary

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

          // SEMANTIC COLORS (cupcake exact match)
          info: 'oklch(68% 0.169 237.323)',
          'info-content': 'oklch(29% 0.066 243.157)', // Dark text on info

          success: 'oklch(69% 0.17 162.48)',
          'success-content': 'oklch(26% 0.051 172.552)', // Dark text on success

          warning: 'oklch(79% 0.184 86.047)',
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
    ],
    darkTheme: 'anubis',
    base: true,
    styled: true,
    utils: true,
    prefix: '',
    logs: false,
  },
};
