/**
 * Window guards shared by every app window (main window and the detached
 * Display window, TASK_2026_853_3401).
 *
 * Kept out of `main-window.ts` on purpose: that file reads `import.meta.url`,
 * and `tsconfig.spec.json` compiles with `module: commonjs`, so any module a
 * spec imports (here: `display-window.ts` through `activation/bootstrap.ts`)
 * must not pull it in (TS1343, see `activation/shutdown.ts`).
 */

import { screen, shell, type BrowserWindow } from 'electron';
import {
  isSafeExternalUrl,
  isSameDocumentNavigation,
} from './navigation-policy';
import { isAllowedArtifactFrameUrl } from './artifact-frame-guard';

/** Saved window bounds shape for type-safe persistence. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Check whether the given bounds are at least partially visible on any display.
 * Returns true if any portion of the window overlaps with a connected display.
 */
export function isOnScreen(bounds: WindowBounds): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const { x, y, width, height } = display.workArea;
    return (
      bounds.x < x + width &&
      bounds.x + bounds.width > x &&
      bounds.y < y + height &&
      bounds.y + bounds.height > y
    );
  });
}

/**
 * Open an external URL in the system browser, but only for known-safe
 * schemes. Prevents arbitrary-scheme handoff (e.g. `file:`, custom
 * protocol handlers) from `shell.openExternal`.
 */
function openExternalSafely(targetUrl: string): void {
  if (isSafeExternalUrl(targetUrl)) {
    void shell.openExternal(targetUrl);
  }
}

/**
 * Stop links from hijacking an app window.
 *
 * Two distinct attacks, one guard:
 *
 *  - A normal `<a href="https://…">` in rendered agent markdown triggers a
 *    top-level `will-navigate` that would replace the Angular shell with the
 *    target page, turning the app into a blank browser.
 *  - A RELATIVE link in that same markdown resolves against the renderer's
 *    own `file:` document, so it navigates the window to arbitrary local
 *    content. The old guard classified every `file:` URL as internal and let
 *    this through.
 *
 * The policy therefore allows exactly one thing — reloading the document
 * already loaded — and cancels the rest. A cancelled `file:` navigation is
 * NEVER handed to `shell.openExternal`; that would re-open the very path just
 * refused, through the OS instead of the window.
 *
 * `loadFile` and `webContents.reload()` do not emit `will-navigate`, so the
 * app's own startup load is unaffected.
 */
export function installNavigationGuard(window: BrowserWindow): void {
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !isAllowedArtifactFrameUrl(event.url)) {
      event.preventDefault();
    }
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (isSameDocumentNavigation(window.webContents.getURL(), targetUrl)) {
      return;
    }
    event.preventDefault();
    openExternalSafely(targetUrl);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
}
