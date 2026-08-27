/**
 * Regression guard: `will-quit` must drain the session metadata queue.
 *
 * The store coalesces a burst of writes into one update at the end of its
 * queue drain, so a CLI agent that exits in the final seconds of a session
 * leaves its reference STAGED, not stored. Nothing used to call `flush()` on
 * the way out and the reference was simply lost (TASK_2026_324 finding 3).
 *
 * ## Why the flush is FIRST here, and awaited in the other two hosts
 *
 * `will-quit` cannot block: Electron proceeds to tear the process down
 * regardless of what the listener returns. So this host cannot do what the CLI
 * and the extension do — reap the agents, then await the flush that their exits
 * produced. It does the only other useful thing: start the flush at the top of
 * the teardown so the staged snapshot gets the whole window to reach storage.
 * That is a smaller guarantee, and it is deliberate. Do not "fix" it by moving
 * the call below the disposals — there it would be started with no window left
 * at all.
 *
 * ## Why this spec does not import `main.ts`
 *
 * `main.ts` uses `import.meta.url` and `tsconfig.spec.json` compiles with
 * `module: commonjs`, so importing it fails with TS1343. Same reason, and the
 * same static-analysis approach, as `main.quit-path.spec.ts`.
 *
 * Source-under-test: apps/ptah-electron/src/main.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const MAIN_TS_PATH = path.resolve(__dirname, 'main.ts');

const METADATA_FLUSH = 'flushSessionMetadataStores()';
const PROXY_DISPOSE = 'providerProxyPool?.disposeAll()';

describe('will-quit session metadata flush', () => {
  let willQuitBody: string;

  beforeAll(() => {
    const source = fs.readFileSync(MAIN_TS_PATH, 'utf-8');
    const start = source.indexOf(`app.on('will-quit'`);
    expect(start).toBeGreaterThan(-1);
    willQuitBody = source.slice(start);
  });

  it('drains the coalesced write queue exactly once', () => {
    expect(willQuitBody.split(METADATA_FLUSH)).toHaveLength(2);
  });

  it('starts the flush before the disposals, so it has the teardown window', () => {
    expect(willQuitBody.indexOf(METADATA_FLUSH)).toBeLessThan(
      willQuitBody.indexOf(PROXY_DISPOSE),
    );
  });

  it('guards the flush — a quit must not be turned into a crash', () => {
    const flushIndex = willQuitBody.indexOf(METADATA_FLUSH);
    // The `try {` that opens the guarded block sits just above the call.
    expect(willQuitBody.slice(flushIndex - 40, flushIndex)).toContain('try');
  });
});
