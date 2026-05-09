/**
 * esbuild config for the ptah-electron `build-main` target.
 *
 * Wired via `esbuildConfig` in apps/ptah-electron/project.json. Replaces the
 * inline `esbuildOptions` block so we can register the
 * `cjs-external-named-imports` plugin (which can't be expressed in JSON).
 *
 * Configuration-specific values (sourcemap/minify/Sentry DSN) are still
 * controlled by the Nx executor options + NODE_ENV. The Nx esbuild
 * executor sets `process.env.NODE_ENV` to the active configuration name
 * (e.g. 'development' or 'production') before normalizing options, so we
 * can branch on it here for the Sentry DSN define.
 */
const path = require('path');

const cjsExternalNamedImports = require(path.join(
  __dirname,
  'esbuild-plugins',
  'cjs-external-named-imports.cjs',
));

// Full union of named imports of `electron` used across the Electron main
// bundle (grep `from 'electron'` under apps/ptah-electron/src). Type-only
// imports are stripped by TS before esbuild sees them, so they do not need
// to appear here.
const ELECTRON_NAMED_EXPORTS = [
  'app',
  'BrowserWindow',
  'Menu',
  'clipboard',
  'screen',
  'contextBridge',
  'ipcRenderer',
  'ipcMain',
  'dialog',
  'shell',
  'nativeImage',
  'nativeTheme',
  'safeStorage',
  'session',
  'webContents',
  'Tray',
  'Notification',
  'powerMonitor',
  'systemPreferences',
  'globalShortcut',
];

const isProd = process.env.NODE_ENV === 'production';

const SENTRY_DSN_PROD =
  'https://f443ca20f86dff7c57cbf370e0f790e6@o4511123313393664.ingest.de.sentry.io/4511142057738320';

module.exports = {
  outExtension: {
    '.js': '.mjs',
  },
  banner: {
    // ESM banner: provide `require`, `__filename`, `__dirname` so any
    // CommonJS shim or third-party code that reaches for them at runtime
    // resolves to sane values instead of throwing
    // `ReferenceError: __dirname is not defined in ES module scope`.
    // Mirrors the apps/ptah-cli banner so both ESM bundles behave the same.
    js: "import { createRequire as __ptah_createRequire } from 'module'; import { fileURLToPath as __ptah_fileURLToPath } from 'url'; import { dirname as __ptah_dirname } from 'path'; const require = __ptah_createRequire(import.meta.url); const __filename = __ptah_fileURLToPath(import.meta.url); const __dirname = __ptah_dirname(__filename); globalThis.__dirname = __dirname;",
  },
  define: {
    __SENTRY_DSN__: isProd ? `"${SENTRY_DSN_PROD}"` : '""',
  },
  plugins: [
    cjsExternalNamedImports({
      modules: ['electron'],
      namedExports: {
        electron: ELECTRON_NAMED_EXPORTS,
      },
    }),
  ],
};
