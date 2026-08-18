/**
 * `window-all-closed` quit path (TASK_2026_180, B5.1.2).
 *
 * ## The parity group is the whole safety argument for shipping C5 default-off
 *
 * `skillSynthesis.trayKeepalive` ships `false`, so no tray is created and the
 * quit path must be BYTE-IDENTICAL to the pre-change code. The `parity` group
 * below encodes that pre-change code as an executable oracle and asserts the
 * new implementation agrees with it on every platform. If C5 ever starts
 * suppressing the quit by default, that group fails.
 *
 * ## Why this spec does not import `main.ts`
 *
 * `main.ts` uses `import.meta.url`, and `tsconfig.spec.json` compiles with
 * `module: commonjs` — importing it fails to compile with
 * `TS1343: The 'import.meta' meta-property is only allowed when ...`. Verified,
 * not assumed. The decision therefore lives in `handleWindowAllClosed`
 * (`services/tray/tray.service.ts`) and `main.ts` retains only a branch-free
 * delegation to it:
 *
 * ```ts
 * app.on('window-all-closed', () => {
 *   handleWindowAllClosed({
 *     platform: process.platform,
 *     quit: () => app.quit(),
 *     hasLiveTray: () => trayService?.isLive() ?? false,
 *   });
 * });
 * ```
 */

import { handleWindowAllClosed } from './services/tray/tray.service';

/** Every platform Electron ships for, so the oracle is exercised on all of them. */
const PLATFORMS: readonly NodeJS.Platform[] = [
  'win32',
  'linux',
  'darwin',
  'freebsd',
];

/**
 * The pre-change handler, verbatim from `main.ts:161-165` before C5:
 *
 * ```ts
 * app.on('window-all-closed', () => {
 *   if (process.platform !== 'darwin') {
 *     app.quit();
 *   }
 * });
 * ```
 */
function preChangeHandler(platform: NodeJS.Platform, quit: () => void): void {
  if (platform !== 'darwin') {
    quit();
  }
}

describe('parity — with the shipped default (trayKeepalive false ⇒ no tray)', () => {
  it.each(PLATFORMS)(
    'on %s, matches the pre-change handler exactly',
    (platform) => {
      const expected = jest.fn();
      preChangeHandler(platform, expected);

      const actual = jest.fn();
      handleWindowAllClosed({
        platform,
        quit: actual,
        hasLiveTray: () => false,
      });

      expect(actual.mock.calls).toEqual(expected.mock.calls);
    },
  );

  it.each<[NodeJS.Platform]>([['win32'], ['linux'], ['freebsd']])(
    'quits exactly once on %s',
    (platform) => {
      const quit = jest.fn();

      handleWindowAllClosed({ platform, quit, hasLiveTray: () => false });

      expect(quit).toHaveBeenCalledTimes(1);
    },
  );

  it('does not quit on darwin', () => {
    const quit = jest.fn();

    handleWindowAllClosed({
      platform: 'darwin',
      quit,
      hasLiveTray: () => false,
    });

    expect(quit).not.toHaveBeenCalled();
  });
});

describe('keep-alive — a LIVE tray suppresses the quit', () => {
  it.each<[NodeJS.Platform]>([['win32'], ['linux'], ['freebsd']])(
    'does not quit on %s while a tray is live',
    (platform) => {
      const quit = jest.fn();

      handleWindowAllClosed({ platform, quit, hasLiveTray: () => true });

      expect(quit).not.toHaveBeenCalled();
    },
  );

  it('leaves darwin behaviour unchanged when a tray is live', () => {
    const quit = jest.fn();

    handleWindowAllClosed({
      platform: 'darwin',
      quit,
      hasLiveTray: () => true,
    });

    expect(quit).not.toHaveBeenCalled();
  });
});

describe('R10 fail-safe — liveness, not the setting, gates the suppression', () => {
  it('quits when the tray failed to construct, even though keep-alive was requested', () => {
    // `PtahTrayService.create` returned null (missing icon, no tray host, ...),
    // so `main.ts` passes `hasLiveTray: () => false`. Gating on the
    // `trayKeepalive` setting instead would strand an unkillable process here.
    const quit = jest.fn();

    handleWindowAllClosed({
      platform: 'win32',
      quit,
      hasLiveTray: () => false,
    });

    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('consults tray liveness at close time, not at startup', () => {
    const quit = jest.fn();
    let live = true;
    const deps = {
      platform: 'win32' as NodeJS.Platform,
      quit,
      hasLiveTray: () => live,
    };

    handleWindowAllClosed(deps);
    expect(quit).not.toHaveBeenCalled();

    // The tray was destroyed after startup; the app must become quittable again.
    live = false;
    handleWindowAllClosed(deps);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
