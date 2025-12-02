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
