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
          // Using fallback colors for when VS Code variables aren't available
          // Format: var(--vscode-var, fallback)
          primary: 'var(--vscode-button-background, #0e639c)',
          'primary-content': 'var(--vscode-button-foreground, #ffffff)',
          secondary: 'var(--vscode-descriptionForeground, #8b949e)',
          accent: 'var(--vscode-focusBorder, #007fd4)',
          neutral: 'var(--vscode-sideBar-background, #21252b)',
          'base-100': 'var(--vscode-editor-background, #1e1e1e)',
          'base-200': 'var(--vscode-sideBar-background, #252526)',
          'base-300': 'var(--vscode-input-background, #3c3c3c)',
          'base-content': 'var(--vscode-editor-foreground, #cccccc)',
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
