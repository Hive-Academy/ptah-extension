import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { IStateStorage } from '@ptah-extension/platform-core';

// @ts-expect-error import.meta.url is valid in ESM bundle output; TS flags it because tsconfig targets CJS
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Saved window bounds shape for type-safe persistence.
 */
interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Check whether the given bounds are at least partially visible on any display.
 * Returns true if any portion of the window overlaps with a connected display.
 */
function isOnScreen(bounds: WindowBounds): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const { x, y, width, height } = display.workArea;
    // Check that at least 100px of the window is visible on this display
    return (
      bounds.x < x + width &&
      bounds.x + bounds.width > x &&
      bounds.y < y + height &&
      bounds.y + bounds.height > y
    );
  });
}

/**
 * Create the main application window.
 *
 * Security settings:
 * - contextIsolation: true (preload is only bridge)
 * - nodeIntegration: false (no Node.js in renderer)
 * - sandbox: true (additional security layer)
 *
 * @param stateStorage - Optional state storage for persisting/restoring window bounds.
 */
export function createMainWindow(stateStorage?: IStateStorage): BrowserWindow {
  // Attempt to restore saved window bounds
  const savedBounds = stateStorage?.get<WindowBounds>('window.bounds');
  const useSavedBounds =
    savedBounds &&
    typeof savedBounds.x === 'number' &&
    typeof savedBounds.y === 'number' &&
    typeof savedBounds.width === 'number' &&
    typeof savedBounds.height === 'number' &&
    savedBounds.width >= 800 &&
    savedBounds.height >= 600 &&
    isOnScreen(savedBounds);

  const mainWindow = new BrowserWindow({
    width: useSavedBounds ? savedBounds.width : 1200,
    height: useSavedBounds ? savedBounds.height : 800,
    ...(useSavedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 800,
    minHeight: 600,
    title: 'Ptah - Coding Orchestra',
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    // macOS title bar
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 },
  });

  // Persist window state on close
  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds();
    console.log(
      `[Ptah Electron] Saving window bounds: ${JSON.stringify(bounds)}`,
    );
    // Fire-and-forget: persist bounds for next launch
    if (stateStorage) {
      stateStorage.update('window.bounds', bounds).catch((err: unknown) => {
        console.error(
          '[Ptah Electron] Failed to persist window bounds:',
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  });

  return mainWindow;
}
