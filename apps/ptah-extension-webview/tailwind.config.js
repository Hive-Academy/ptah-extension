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
        // VS Code integration colors
        'vscode-bg': 'var(--vscode-editor-background)',
        'vscode-fg': 'var(--vscode-editor-foreground)',
        'vscode-border': 'var(--vscode-widget-border)',
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        ptah: {
          primary: 'var(--vscode-button-background)',
          'primary-content': 'var(--vscode-button-foreground)',
          secondary: 'var(--vscode-descriptionForeground)',
          accent: 'var(--vscode-focusBorder)',
          neutral: 'var(--vscode-sideBar-background)',
          'base-100': 'var(--vscode-editor-background)',
          'base-200': 'var(--vscode-sideBar-background)',
          'base-300': 'var(--vscode-input-background)',
          'base-content': 'var(--vscode-editor-foreground)',
          info: '#75beff',
          success: '#89d185',
          warning: '#d7ba7d',
          error: '#f48771',
        },
      },
      'dark',
      'light',
    ],
    darkTheme: 'ptah',
    base: true,
    styled: true,
    utils: true,
    prefix: '',
    logs: false,
  },
};
