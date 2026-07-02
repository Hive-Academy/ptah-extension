import * as fs from 'fs';
import * as path from 'path';
import { _electron, type ElectronApplication } from '@playwright/test';

/**
 * Real-app launcher for the marketing showcase harness.
 *
 * This is the deliberate INVERSE of `src/support/electron-launcher.ts`:
 * the e2e launcher boots a throwaway profile with `NODE_ENV=test` and mocked
 * RPC for deterministic assertions. The showcase launcher boots the REAL,
 * already-authenticated app so live agents and LLM inference are captured on
 * camera against the local docker backend.
 *
 * Key differences from the e2e launcher:
 * - `NODE_ENV=development` so the app resolves the dev API URLs (local docker),
 *   exactly like `nx serve ptah-electron`.
 * - `PTAH_NO_DEVTOOLS=1` so the dev-mode DevTools window does not pop open and
 *   ruin the recording (gated in `apps/ptah-electron/src/activation/post-window.ts`).
 * - The persistent user-data dir is REUSED (not a fresh mkdtemp), so the auth /
 *   provider keys you set up via `nx serve` are already present. Override with
 *   `PTAH_SHOWCASE_USER_DATA_DIR` to point at a dedicated showcase profile.
 * - Playwright video recording is enabled at a marketing resolution.
 *
 * NOTE: the app holds a single-instance lock. Quit any running `nx serve
 * ptah-electron` before launching a showcase scene, or the launch will exit
 * immediately.
 */

export type ShowcaseResolution = '1080p' | '1440p' | '4k';

export interface ShowcaseRes {
  width: number;
  height: number;
}

const RES_TABLE: Record<ShowcaseResolution, ShowcaseRes> = {
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

export interface ShowcaseLaunchOptions {
  /** Directory the recorded video(s) are written to. */
  videoDir: string;
  /** Capture resolution. Defaults to PTAH_SHOWCASE_RES env or '1080p'. */
  resolution?: ShowcaseResolution;
  /** Extra env vars merged into the Electron process. */
  env?: Record<string, string>;
  /** Override launch timeout in ms (default 60_000 — real boot is slower). */
  timeout?: number;
}

export interface ShowcaseLaunch {
  app: ElectronApplication;
  /**
   * The ACTUAL renderer viewport (`innerWidth`/`innerHeight`) after the
   * exact-viewport correction below. This is what the recorded frames contain
   * pixel-for-pixel, so downstream normalization (shots.json) and the manifest
   * `res` must use these measured values, not the requested capture size. Equal
   * to the requested resolution unless the OS clamped the window to the display.
   */
  res: ShowcaseRes;
  /** The resolution originally requested (from opts/env), for logging. */
  requestedRes: ShowcaseRes;
}

/** Resolves the absolute path to the built Electron main entry. */
export function resolveElectronEntry(): string {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'dist',
    'apps',
    'ptah-electron',
    'main.mjs',
  );
}

function resolveResolution(opts: ShowcaseLaunchOptions): ShowcaseRes {
  const fromOpt = opts.resolution;
  const fromEnv = process.env['PTAH_SHOWCASE_RES'] as
    | ShowcaseResolution
    | undefined;
  const key = fromOpt ?? fromEnv ?? '1080p';
  return RES_TABLE[key] ?? RES_TABLE['1080p'];
}

/**
 * Launch the real Ptah Electron app for a showcase recording and force the
 * window to the capture resolution. The caller owns closing the app (the
 * `app` fixture does this automatically and Playwright finalizes the video on
 * close).
 */
export async function launchShowcase(
  opts: ShowcaseLaunchOptions,
): Promise<ShowcaseLaunch> {
  const entry = resolveElectronEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(
      `[showcase] Electron entry not found at:\n  ${entry}\n\n` +
        `Run \`nx run ptah-electron-e2e:showcase\` (it chains the dev build),\n` +
        `or build manually with \`nx build-dev ptah-electron && nx copy-renderer ptah-electron\`.`,
    );
  }

  const res = resolveResolution(opts);
  fs.mkdirSync(opts.videoDir, { recursive: true });

  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: 'development',
    PTAH_NO_DEVTOOLS: '1',
    ...(opts.env ?? {}),
  };
  delete env['ELECTRON_RUN_AS_NODE'];
  // Intentionally NOT PTAH_E2E — this is a real run, not a mocked test.

  const args = [entry];
  // Reuse the authenticated default profile unless a dedicated showcase
  // profile is requested. Omitting --user-data-dir lets Electron use the same
  // default dir as `nx serve`, which is where the auth/provider keys live.
  const userDataDir = process.env['PTAH_SHOWCASE_USER_DATA_DIR'];
  if (userDataDir) {
    fs.mkdirSync(userDataDir, { recursive: true });
    args.push(`--user-data-dir=${userDataDir}`);
  }

  const app = await _electron.launch({
    args,
    env: env as Record<string, string>,
    timeout: opts.timeout ?? 60_000,
    recordVideo: {
      dir: opts.videoDir,
      size: { width: res.width, height: res.height },
    },
  });

  app.process().stdout?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[ptah stdout] ${chunk.toString('utf8')}`);
  });
  app.process().stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[ptah stderr] ${chunk.toString('utf8')}`);
  });

  // Force the window to the exact capture resolution so the recorded frames
  // are crisp (no upscaling from the default 1200x800) AND — critically — so
  // the renderer VIEWPORT equals the record size. `setContentSize` sizes the
  // web-contents *bounds*, but the measured `innerWidth`/`innerHeight` can
  // still come up short (device-scale rounding, integrated scrollbars, the OS
  // clamping a window larger than the physical display). When the viewport is
  // shorter than the record size, Playwright pads the bottom of every frame
  // with a uniform mid-gray band — the exact defect this correction kills. The
  // downstream gray-band auto-crop in render-all.mjs stays as a fallback.
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    // Allow sizing beyond the physical screen (electron honours this on most
    // platforms when the window is not maximized), and lift the minimum so a
    // correction pass can shrink freely if we overshoot.
    win.setMinimumSize(400, 300);
    win.setResizable(true);
    if (win.isMaximized()) win.unmaximize();
    if (win.isFullScreen()) win.setFullScreen(false);
    win.setContentSize(size.width, size.height);
    win.center();
    win.focus();
  }, res);

  // Measure the real renderer viewport and iteratively correct the content
  // size by the measured delta. 2-3 passes is plenty: the delta is a fixed
  // chrome/scaling offset, so a single correction usually converges and the
  // extra passes just confirm it.
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  const measureViewport = (): Promise<ShowcaseRes> =>
    win.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

  let measured = await measureViewport();
  for (let pass = 0; pass < 3; pass++) {
    const dw = res.width - measured.width;
    const dh = res.height - measured.height;
    if (dw === 0 && dh === 0) break;
    // Read the current content size and add the shortfall so the viewport lands
    // exactly on the requested resolution.
    await app.evaluate(
      async ({ BrowserWindow }, delta) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (!w) return;
        const [cw, ch] = w.getContentSize();
        w.setContentSize(cw + delta.dw, ch + delta.dh);
        w.center();
      },
      { dw, dh },
    );
    // Let layout settle before re-measuring.
    await win.waitForTimeout(120);
    measured = await measureViewport();
  }

  if (measured.width === res.width && measured.height === res.height) {
    process.stderr.write(
      `[showcase] viewport ${measured.width}x${measured.height} == record size\n`,
    );
  } else {
    // The OS clamped the window to the display (capture res exceeds the screen).
    // We record at the requested size regardless, so the frames will carry a
    // gray band that render-all.mjs's auto-crop trims. Thread the MEASURED
    // viewport downstream so shots.json normalization stays accurate.
    process.stderr.write(
      `[showcase] WARNING: viewport ${measured.width}x${measured.height} != record size ` +
        `${res.width}x${res.height} — the capture resolution exceeds this display, ` +
        `so recorded frames will carry a gray padding band. The render-all.mjs ` +
        `band-crop fallback will apply. Use a larger display or a smaller ` +
        `PTAH_SHOWCASE_RES to capture at native size.\n`,
    );
  }

  // Return the MEASURED viewport as `res` (what the frames actually contain),
  // keeping the requested resolution separately for diagnostics.
  return { app, res: measured, requestedRes: res };
}
