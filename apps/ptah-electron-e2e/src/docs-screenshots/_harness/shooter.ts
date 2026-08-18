import * as fs from 'fs';
import * as path from 'path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

/**
 * Shooter — writes documentation screenshots straight into the docs site.
 *
 * `apps/ptah-docs/SCREENSHOTS.md` is the shot list and the spec: PNG, 1600px
 * wide for full-window shots, dark theme, no OS chrome, nothing real redacted
 * (these runs use mocked RPC, so no real key ever reaches a frame).
 *
 * Every capture lands in `apps/ptah-docs/public/screenshots/<name>.png`, which
 * is exactly the path `/screenshots/<name>.png` the markdown references, so a
 * capture run is what makes `check-screenshot-refs.mjs` pass.
 */

/** `apps/ptah-docs/public/screenshots` — the served asset directory. */
export const SHOT_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'apps',
  'ptah-docs',
  'public',
  'screenshots',
);

/** Full-window capture size, per SCREENSHOTS.md ("1600px for full-window"). */
export const WINDOW_SIZE = { width: 1600, height: 1000 };

/**
 * Force the window to the documented capture size. Playwright screenshots the
 * renderer, not the screen, so this only has to fit the CSS viewport — no
 * display-placement dance like the showcase launcher needs for video.
 */
export async function sizeForCapture(
  app: ElectronApplication,
  page: Page,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setResizable(true);
    if (win.isMaximized()) win.unmaximize();
    if (win.isFullScreen()) win.setFullScreen(false);
    win.setContentSize(size.width, size.height);
  }, WINDOW_SIZE);

  for (let pass = 0; pass < 3; pass++) {
    const measured = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const dw = WINDOW_SIZE.width - measured.width;
    const dh = WINDOW_SIZE.height - measured.height;
    if (dw === 0 && dh === 0) return;
    await app.evaluate(
      ({ BrowserWindow }, delta) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        const [cw, ch] = win.getContentSize();
        win.setContentSize(cw + delta.dw, ch + delta.dh);
      },
      { dw, dh },
    );
    await page.waitForTimeout(150);
  }
}

/**
 * Quiet the frame before a capture: stop CSS animations/transitions and hide
 * the caret, so two runs of the same shot differ only where the app differs.
 */
export async function freezeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      *:focus-visible { outline: none !important; }
    `,
  });
}

export interface ShootOptions {
  /**
   * Capture this element instead of the whole window — the "800px panel crop"
   * half of the SCREENSHOTS.md spec. The element is scrolled into view first.
   */
  crop?: Locator;
  /** Extra settle time before the shutter, ms. Default 400. */
  settleMs?: number;
}

/**
 * Capture `name` (no extension) into the docs `public/screenshots` directory.
 * Returns the absolute path written, so a spec can assert on it.
 */
export async function shoot(
  page: Page,
  name: string,
  opts: ShootOptions = {},
): Promise<string> {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await freezeMotion(page);
  await page.waitForTimeout(opts.settleMs ?? 400);

  const target = opts.crop;
  if (target) await target.scrollIntoViewIfNeeded().catch(() => undefined);

  const buffer = target
    ? await target.screenshot({ scale: 'css' })
    : await page.screenshot({ scale: 'css' });

  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, buffer);
  console.log(`[docs-shot] ${name}.png (${buffer.length} bytes) -> ${file}`);
  return file;
}
