import { BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { PRODUCT_DISPLAY_NAME } from '../config/product-identity';
import { installPermissionPolicy } from './permission-policy';
import {
  installNavigationGuard,
  isOnScreen,
  type WindowBounds,
} from './window-guards';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared with the detached Display window (TASK_2026_853_3401). They live in
// `window-guards.ts` because this file reads `import.meta.url` and must not be
// imported by anything a commonjs spec loads.
export { installNavigationGuard, isOnScreen };

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
export function createMainWindow(
  stateStorageOrResolver?: IStateStorage | (() => IStateStorage | undefined),
): BrowserWindow {
  const resolveStateStorage = (): IStateStorage | undefined =>
    typeof stateStorageOrResolver === 'function'
      ? stateStorageOrResolver()
      : stateStorageOrResolver;
  const stateStorage = resolveStateStorage();
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
    title: PRODUCT_DISPLAY_NAME,
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 },
  });

  installNavigationGuard(mainWindow);

  installPermissionPolicy(
    mainWindow.webContents,
    pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href,
  );

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    if (params.isEditable) {
      menuItems.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText) {
      menuItems.push(
        { role: 'copy' },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    }

    if (menuItems.length > 0) {
      const contextMenu = Menu.buildFromTemplate(menuItems);
      contextMenu.popup({ window: mainWindow });
    }
  });
  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds();
    console.log(
      `[Ptah Electron] Saving window bounds: ${JSON.stringify(bounds)}`,
    );
    const currentStateStorage = resolveStateStorage();
    if (currentStateStorage) {
      currentStateStorage
        .update('window.bounds', bounds)
        .catch((err: unknown) => {
          console.error(
            '[Ptah Electron] Failed to persist window bounds:',
            err instanceof Error ? err.message : String(err),
          );
        });
    }
  });

  return mainWindow;
}
