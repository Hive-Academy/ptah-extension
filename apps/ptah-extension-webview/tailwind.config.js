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
          // PRIMARY: Lapis Lazuli Blue (Divine guidance, wisdom)
          primary: '#1e3a8a',
          'primary-focus': '#1e40af',
          'primary-content': '#f5f5dc',

          // SECONDARY: Pharaoh's Gold (Eternal accent)
          secondary: '#d4af37',
          'secondary-focus': '#92400e',
          'secondary-content': '#0a0a0a',

          // ACCENT: Gold Light (Highlights, warnings)
          accent: '#fbbf24',
          'accent-focus': '#d4af37',
          'accent-content': '#0a0a0a',

          // NEUTRAL: Obsidian grays (panels, cards)
          neutral: '#1a1a1a',
          'neutral-focus': '#2a2a2a',
          'neutral-content': '#d1d5db',

          // BASE: Background hierarchy (The Void)
          'base-100': '#0a0a0a',
          'base-200': '#1a1a1a',
          'base-300': '#2a2a2a',
          'base-content': '#f5f5dc',

          // SEMANTIC COLORS (God Powers)
          info: '#3b82f6',
          'info-content': '#f5f5dc',

          success: '#228b22',
          'success-content': '#f5f5dc',

          warning: '#fbbf24',
          'warning-content': '#0a0a0a',

          error: '#b22222',
          'error-content': '#f5f5dc',

          // DAISYUI CUSTOM PROPERTIES
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
          // Light theme variant - Cupcake-inspired warm aesthetic
          // Maintains Egyptian gold accents while providing a soft, friendly light mode

          // PRIMARY: Soft Teal (inspired by cupcake's primary)
          primary: 'oklch(75% 0.12 181)',
          'primary-focus': 'oklch(70% 0.14 181)',
          'primary-content': 'oklch(25% 0.05 181)',

          // SECONDARY: Warm Rose/Pink (cupcake-inspired)
          secondary: 'oklch(82% 0.08 343)',
          'secondary-focus': 'oklch(77% 0.10 343)',
          'secondary-content': 'oklch(30% 0.08 343)',

          // ACCENT: Egyptian Gold maintained for brand consistency
          accent: 'oklch(80% 0.14 70)',
          'accent-focus': 'oklch(75% 0.16 70)',
          'accent-content': 'oklch(25% 0.06 70)',

          // NEUTRAL: Warm gray with slight purple undertone (cupcake-inspired)
          neutral: 'oklch(30% 0.01 286)',
          'neutral-focus': 'oklch(25% 0.01 286)',
          'neutral-content': 'oklch(92% 0.005 286)',

          // BASE: Warm cream background (cupcake-inspired)
          'base-100': 'oklch(97.8% 0.004 56)', // Warm white/cream
          'base-200': 'oklch(94% 0.007 61)', // Slightly darker cream
          'base-300': 'oklch(91.5% 0.006 53)', // Card/panel background
          'base-content': 'oklch(24% 0.06 313)', // Dark purple-gray text

          // SEMANTIC COLORS (adjusted for light backgrounds)
          info: 'oklch(55% 0.18 237)',
          'info-content': 'oklch(95% 0.02 237)',

          success: 'oklch(55% 0.16 162)',
          'success-content': 'oklch(95% 0.02 162)',

          warning: 'oklch(75% 0.18 86)',
          'warning-content': 'oklch(25% 0.06 86)',

          error: 'oklch(55% 0.22 16)',
          'error-content': 'oklch(95% 0.02 16)',

          // DAISYUI CUSTOM PROPERTIES - Cupcake-inspired rounded corners
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
