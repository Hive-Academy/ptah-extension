import type { ElectronApplication } from '@playwright/test';

/**
 * Main-process-quit helpers for the tray keep-alive e2e specs
 * (TASK_2026_180 B5.2).
 *
 * These specs assert on the Electron MAIN process's lifecycle -- whether
 * `app.quit()` was actually reached -- not on any renderer/DOM state, so they
 * drive the app's own OS process directly via `app.process()` rather than
 * through `ElectronApplication.close()` (which itself calls `app.quit()` and
 * would make "does closing all windows quit the app" untestable).
 */

/** Close every open BrowserWindow from inside the main process. */
export async function closeAllWindows(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.close();
    }
  });
}

/**
 * Resolve `true` once the launched app's OS process has exited, or `false` if
 * it has not exited within `timeoutMs`.
 *
 * Does not itself close anything -- pairs with `closeAllWindows` (to prove a
 * quit) or with nothing at all (to prove NO quit happened, i.e. keep-alive).
 */
export function waitForProcessExit(
  app: ElectronApplication,
  timeoutMs: number,
): Promise<boolean> {
  const proc = app.process();
  if (proc.exitCode !== null) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      proc.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    proc.once('exit', onExit);
  });
}

/**
 * Simulates the tray's "Quit Ptah" menu item by invoking `app.quit()`
 * directly in the main process.
 *
 * This is NOT a click on the real native tray icon -- Playwright/Electron's
 * `_electron` harness has no API to drive OS-level tray UI, and the tray
 * instance built by `PtahTrayService` is a module-private local in
 * `main.ts`, not reachable from outside. What IS reachable, and what this
 * function exercises, is the exact function the tray's quit item is wired
 * to: `buildTrayMenuTemplate`'s `onQuit` calls `options.quit()`
 * (`tray.service.ts:135`), and `main.ts` constructs the tray with
 * `quit: () => app.quit()` (`main.ts:182`). So "click Quit Ptah" and
 * "call `app.quit()` from outside" are the same call once you're past the
 * native menu-item dispatch -- which is covered instead by B5.1's own
 * `tray.service.spec.ts` (`assertQuitItemPresent` + template unit tests).
 */
export async function simulateTrayQuit(
  app: ElectronApplication,
): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    electronApp.quit();
  });
}

/**
 * Best-effort hard-stop for a launched app, used from a `finally` block so no
 * spec can leave an orphaned Electron process behind regardless of how it
 * failed. Safe to call on an already-exited process.
 */
export async function forceKillIfAlive(
  app: ElectronApplication,
): Promise<void> {
  try {
    const proc = app.process();
    if (proc.exitCode === null && proc.pid !== undefined) {
      proc.kill('SIGKILL');
    }
  } catch {
    // Process may already be gone -- not a spec failure.
  }
  await app.close().catch(() => undefined);
}
