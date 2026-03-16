import { BrowserWindow } from 'electron';
import * as path from 'path';

/**
 * Create the main application window.
 *
 * Security settings:
 * - contextIsolation: true (preload is only bridge)
 * - nodeIntegration: false (no Node.js in renderer)
 * - sandbox: true (additional security layer)
 */
export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Ptah',
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
    // Save window bounds for next launch
    // Window state persistence is handled via IPC to ElectronStateStorage (Batch 3+)
    const bounds = mainWindow.getBounds();
    console.log(
      `[Ptah Electron] Saving window bounds: ${JSON.stringify(bounds)}`
    );
  });

  return mainWindow;
}
