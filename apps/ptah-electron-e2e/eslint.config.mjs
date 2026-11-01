import baseConfig, {
  APP_RPC_HANDLER_CLASS_SELECTOR,
  CHOKIDAR_LOAD_SELECTORS,
  MESSAGE_LITERAL_SELECTORS,
} from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {},
  },
  {
    // Playwright config + test fixtures are infra; permit looser shapes
    // than feature-library code (IPC payloads are unknown by nature).
    files: [
      'playwright.config.ts',
      'src/support/**/*.ts',
      'src/specs/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Re-states the root RECURSIVE_FS_WATCH_ALLOWED_APP_TS exemption (FU-11):
    // root `files` patterns resolve relative to this config when the project
    // lints from its own folder, so the root path does not match here.
    files: ['src/specs/git-watcher.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...MESSAGE_LITERAL_SELECTORS,
        ...CHOKIDAR_LOAD_SELECTORS,
        APP_RPC_HANDLER_CLASS_SELECTOR,
      ],
    },
  },
];
