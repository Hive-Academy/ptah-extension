/**
 * Injected by esbuild define at build time (`apps/ptah-electron/esbuild.config.cjs`).
 * Defaults to `false`; set to `true` only when `NODE_ENV === 'development'` and
 * `PTAH_REPLAY_RECORDER_BUILD === '1'` so production and default builds strip
 * every replay-recorder tap call site.
 */
declare const __PTAH_REPLAY_RECORDER__: boolean;
