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
   * The MEASURED CSS viewport (`innerWidth`/`innerHeight`) after deterministic
   * placement. This is the coordinate space `boundingBox()` reports in, so the
   * Director must normalize shot rects (and the manifest `res`) against it. On a
   * scaled display it is smaller than the recorded device frame (e.g. 1707x960
   * CSS for a 2560x1440 record at 150%); render-all detects the true device
   * frame size from the raw video, so it does not rely on this value for framing.
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

  // ── Deterministic high-resolution window placement ─────────────────────────
  // Playwright records the window's ON-SCREEN region at DEVICE pixels, then
  // scales it to fit `recordVideo.size` (= `res`). To fill a `res`-sized frame
  // 1:1 the on-screen content must be exactly `res` device pixels — i.e. a CSS
  // content box of `res / scaleFactor` that fits ENTIRELY within some display's
  // work area. A 2560x1440 record therefore needs a 1707x960 CSS window on a
  // 150%-scaled display, or a 2560x1440 CSS window on a 100% display at least
  // that large. We enumerate displays, pick the one that can host the box
  // (highest scale factor first — smallest on-screen footprint), and size the
  // content to `res / scaleFactor` there.
  //
  // This replaces the old "force a `res`-sized CSS window and centre it"
  // strategy, which was the root of the nondeterministic letterbox: on a scaled
  // display a `res`-sized CSS window spills off-screen, so Playwright captured
  // only the on-screen part and padded the rest with a gray band. render-all's
  // band-crop then produced a small letterboxed card. The MEASURED CSS viewport
  // is returned as `res` (the coordinate space `boundingBox()` reports in, which
  // the Director normalizes shot rects against); render-all detects the true
  // device frame size from the raw video itself.
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  const placement = await app.evaluate(({ screen, BrowserWindow }, rec) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return null;
    w.setResizable(true);
    w.setMinimumSize(400, 300);
    if (w.isMaximized()) w.unmaximize();
    if (w.isFullScreen()) w.setFullScreen(false);

    const candidates = screen.getAllDisplays().map((d) => {
      // CSS content box that yields exactly `rec` device pixels on this display.
      const cssW = Math.round(rec.width / d.scaleFactor);
      const cssH = Math.round(rec.height / d.scaleFactor);
      const fits = cssW <= d.workArea.width && cssH <= d.workArea.height;
      // Fraction of the target frame this display can paint fully on-screen
      // (1 == whole frame). Drives the least-letterboxed fallback when nothing
      // fits cleanly.
      const coverage =
        ((Math.min(cssW, d.workArea.width) * d.scaleFactor) / rec.width) *
        ((Math.min(cssH, d.workArea.height) * d.scaleFactor) / rec.height);
      return { d, cssW, cssH, fits, coverage };
    });
    const best =
      candidates
        .filter((c) => c.fits)
        .sort((a, b) => b.d.scaleFactor - a.d.scaleFactor)[0] ??
      [...candidates].sort((a, b) => b.coverage - a.coverage)[0];
    if (!best) return null;

    // Cap to the work area so the window is never partly off-screen (an
    // off-screen region records as a padding band), and anchor at the work-area
    // origin so the whole window is on the chosen display.
    const cssW = Math.min(best.cssW, best.d.workArea.width);
    const cssH = Math.min(best.cssH, best.d.workArea.height);
    w.setPosition(best.d.workArea.x, best.d.workArea.y);
    w.setContentSize(cssW, cssH);
    w.focus();
    return {
      fits: best.fits,
      scaleFactor: best.d.scaleFactor,
      appliedCssW: cssW,
      appliedCssH: cssH,
    };
  }, res);

  // Fine-correct the CSS content size so the measured viewport lands on the
  // applied target (setContentSize can come up a pixel or two short after
  // chrome / DPR rounding). Converges in one pass; extra passes just confirm.
  const measure = (): Promise<{ width: number; height: number; dpr: number }> =>
    win.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    }));

  const targetW = placement?.appliedCssW ?? res.width;
  const targetH = placement?.appliedCssH ?? res.height;
  let m = await measure();
  for (let pass = 0; pass < 3; pass++) {
    const dw = targetW - m.width;
    const dh = targetH - m.height;
    if (dw === 0 && dh === 0) break;
    await app.evaluate(
      ({ BrowserWindow }, delta) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (!w) return;
        const [cw, ch] = w.getContentSize();
        w.setContentSize(cw + delta.dw, ch + delta.dh);
      },
      { dw, dh },
    );
    await win.waitForTimeout(120);
    m = await measure();
  }

  // The recorded frame is the on-screen content at device resolution.
  const deviceW = Math.round(m.width * m.dpr);
  const deviceH = Math.round(m.height * m.dpr);
  if (
    Math.abs(deviceW - res.width) <= 2 &&
    Math.abs(deviceH - res.height) <= 2
  ) {
    process.stderr.write(
      `[showcase] capturing ${res.width}x${res.height} device px — viewport ` +
        `${m.width}x${m.height} @ ${m.dpr}x (full frame, no padding band)\n`,
    );
  } else {
    // No display could host the full frame; we record the largest on-screen
    // region that fit and render-all's band-crop trims the rest (letterboxed
    // card). Raise PTAH_SHOWCASE_RES to a size a display can host, or attach a
    // larger / higher-DPI display.
    process.stderr.write(
      `[showcase] WARNING: best on-screen capture is ${deviceW}x${deviceH} device px, ` +
        `short of the ${res.width}x${res.height} record size — no display can host ` +
        `it (viewport ${m.width}x${m.height} @ ${m.dpr}x). Recorded frames will ` +
        `carry a padding band that render-all.mjs crops (letterboxed card). Use a ` +
        `smaller PTAH_SHOWCASE_RES or a larger / higher-DPI display.\n`,
    );
  }

  // Return the MEASURED CSS viewport as `res` — the coordinate space the
  // Director normalizes shot rects against. render-all detects the true device
  // frame size from the raw video, so it needs no device dimensions here.
  return {
    app,
    res: { width: m.width, height: m.height },
    requestedRes: res,
  };
}
