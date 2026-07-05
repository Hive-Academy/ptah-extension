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
          warning: '#f5a524',
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
