/**
 * Application Menu for Ptah Electron
 *
 * TASK_2025_200 Batch 5, Task 5.1
 *
 * Creates a native application menu with standard File, Edit, View, Window,
 * and Help menus. Handles macOS-specific patterns (app name menu, Cmd+Q, etc.)
 * and Windows/Linux patterns (Alt+F4, no app-name menu).
 *
 * The "Open Folder" action uses Electron's dialog API to let the user pick
 * a workspace folder. The result is forwarded to the IWorkspaceProvider via
 * the DI container so that workspace-intelligence and other services pick
 * up the new root path.
 */

import {
  Menu,
  type MenuItemConstructorOptions,
  app,
  dialog,
  shell,
  type BrowserWindow,
} from 'electron';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

const isMac = process.platform === 'darwin';

/**
 * Build and set the application menu.
 *
 * @param container - DI container for resolving platform services
 * @param getWindow - Callback that returns the current BrowserWindow (or null)
 */
export function createApplicationMenu(
  container: DependencyContainer,
  getWindow: () => BrowserWindow | null,
): void {
  const template: MenuItemConstructorOptions[] = [];

  // ========================================
  // macOS: App Name Menu
  // ========================================
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: `About ${app.name}` },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'Cmd+,',
          click: () => {
            sendRendererMessage(getWindow, 'navigate:settings');
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  // ========================================
  // File Menu
  // ========================================
  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Chat',
        accelerator: isMac ? 'Cmd+N' : 'Ctrl+N',
        click: () => {
          sendRendererMessage(getWindow, 'action:new-chat');
        },
      },
      {
        label: 'Open Folder...',
        accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
        click: async () => {
          await handleOpenFolder(container, getWindow);
        },
      },
      { type: 'separator' },
      ...(isMac
        ? [{ role: 'close' as const }]
        : [
            {
              label: 'Settings',
              accelerator: 'Ctrl+,',
              click: () => {
                sendRendererMessage(getWindow, 'navigate:settings');
              },
            },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ]),
    ],
  });

  // ========================================
  // Edit Menu
  // ========================================
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? [
            { role: 'pasteAndMatchStyle' as const },
            { role: 'delete' as const },
            { role: 'selectAll' as const },
            { type: 'separator' as const },
            {
              label: 'Speech',
              submenu: [
                { role: 'startSpeaking' as const },
                { role: 'stopSpeaking' as const },
              ],
            },
          ]
        : [
            { role: 'delete' as const },
            { type: 'separator' as const },
            { role: 'selectAll' as const },
          ]),
    ],
  });

  // ========================================
  // View Menu
  // ========================================
  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  // ========================================
  // Window Menu
  // ========================================
  template.push({
    label: 'Window',
    submenu: isMac
      ? [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' },
        ]
      : [{ role: 'minimize' }, { role: 'close' }],
  });

  // ========================================
  // Help Menu
  // ========================================
  template.push({
    label: 'Help',
    submenu: [
      {
        label: 'Open Website',
        click: async () => {
          await shell.openExternal('https://ptah.live');
        },
      },
      {
        label: 'Documentation',
        click: async () => {
          await shell.openExternal('https://ptah.live/docs');
        },
      },
      { type: 'separator' },
      ...(!isMac
        ? [
            {
              label: `About ${app.name}`,
              click: () => {
                const win = getWindow();
                if (win) {
                  dialog.showMessageBox(win, {
                    type: 'info',
                    title: `About ${app.name}`,
                    message: app.name,
                    detail: `Version ${app.getVersion()}\n\nAI Coding Orchestra for Desktop`,
                  });
                }
              },
            },
          ]
        : []),
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Handle the "Open Folder" menu action.
 * Shows a native folder picker dialog. On selection, updates the
 * workspace provider so all services pick up the new workspace root.
 */
async function handleOpenFolder(
  container: DependencyContainer,
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  const win = getWindow();
  const dialogOptions = {
    properties: ['openDirectory' as const],
    title: 'Open Folder',
  };

  const result = win
    ? await dialog.showOpenDialog(win, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return;
  }

  const folderPath = result.filePaths[0];
  console.log(`[ApplicationMenu] Opening folder: ${folderPath}`);

  try {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );

    // ElectronWorkspaceProvider has setWorkspaceFolders()
    if (
      'setWorkspaceFolders' in workspaceProvider &&
      typeof (workspaceProvider as Record<string, unknown>)[
        'setWorkspaceFolders'
      ] === 'function'
    ) {
      (
        workspaceProvider as unknown as {
          setWorkspaceFolders(folders: string[]): void;
        }
      ).setWorkspaceFolders([folderPath]);
    }

    // Notify renderer of workspace change
    sendRendererMessage(getWindow, 'workspace:changed', {
      folders: [folderPath],
    });
  } catch (error) {
    console.error(
      '[ApplicationMenu] Failed to set workspace folder:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Send a typed message to the renderer process via the BrowserWindow.
 * The renderer receives this on the 'to-renderer' channel, which the
 * preload script dispatches as a window MessageEvent for Angular.
 */
function sendRendererMessage(
  getWindow: () => BrowserWindow | null,
  type: string,
  payload?: unknown,
): void {
  const win = getWindow();
  if (win) {
    win.webContents.send('to-renderer', { type, payload });
  }
}
