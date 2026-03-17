import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script -- bridges renderer (Angular) with main process.
 *
 * Exposes the same API shape as VS Code's webview API:
 * - window.vscode.postMessage(msg)  -> ipcRenderer.send('rpc', msg)
 * - window.vscode.getState()        -> ipcRenderer.sendSync('get-state')
 * - window.vscode.setState(state)   -> ipcRenderer.send('set-state', state)
 *
 * Also sets up window.ptahConfig for Angular app configuration.
 *
 * The Angular app (VSCodeService) reads window.vscode in constructor.
 * By providing the same shape, ZERO Angular code changes needed.
 */

// Expose VS Code-compatible API
contextBridge.exposeInMainWorld('vscode', {
  postMessage: (message: unknown) => {
    ipcRenderer.send('rpc', message);
  },
  getState: () => {
    return ipcRenderer.sendSync('get-state');
  },
  setState: (state: unknown) => {
    ipcRenderer.send('set-state', state);
  },
});

// Expose Ptah configuration
contextBridge.exposeInMainWorld('ptahConfig', {
  isVSCode: false,
  isElectron: true,
  theme: 'dark',
  workspaceRoot: '',
  workspaceName: '',
  extensionUri: '',
  baseUri: '',
  iconUri: './images/ptah-icon.png',
  userIconUri: './images/user-icon.png',
  panelId: 'electron-main',
  platform: process.platform, // 'darwin', 'win32', 'linux' — reliable in preload context
});

// Forward messages from main process to renderer
// The Angular MessageRouterService listens on window 'message' event.
ipcRenderer.on('to-renderer', (_event, message) => {
  // Dispatch as a native window message event -- this is exactly what
  // VS Code does internally for webview postMessage, so the Angular
  // MessageRouterService picks it up without any changes.
  window.dispatchEvent(new MessageEvent('message', { data: message }));
});
