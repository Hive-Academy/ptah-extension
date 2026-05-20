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
 * Startup config (license status, workspace info) is fetched synchronously
 * from the main process via IPC so it's available before Angular bootstraps.
 *
 * The Angular app (VSCodeService) reads window.vscode in constructor.
 * By providing the same shape, ZERO Angular code changes needed.
 */
const startupConfig = ipcRenderer.sendSync('get-startup-config') as {
  initialView?: string | null;
  isLicensed?: boolean;
  workspaceRoot?: string;
  workspaceName?: string;
} | null;
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
contextBridge.exposeInMainWorld('ptahConfig', {
  isVSCode: false,
  isElectron: true,
  theme: 'dark',
  workspaceRoot: startupConfig?.workspaceRoot || '',
  workspaceName: startupConfig?.workspaceName || '',
  extensionUri: '',
  baseUri: '',
  iconUri: './images/ptah-icon.png',
  userIconUri: './images/user-icon.png',
  panelId: 'electron-main',
  platform: process.platform, // 'darwin', 'win32', 'linux' — reliable in preload context
  initialView: startupConfig?.initialView || 'chat',
  isLicensed: startupConfig?.isLicensed ?? true,
});
contextBridge.exposeInMainWorld('ptahClipboard', {
  readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read-text'),
  writeText: (text: string): void => {
    ipcRenderer.send('clipboard:write-text', text);
  },
});
contextBridge.exposeInMainWorld('ptahTerminal', {
  /** Write data to terminal (renderer -> main) */
  write: (id: string, data: string) => {
    ipcRenderer.send('terminal:data-in', id, data);
  },
  /** Resize terminal (renderer -> main) */
  resize: (id: string, cols: number, rows: number) => {
    ipcRenderer.send('terminal:resize', id, cols, rows);
  },
  /** Listen for terminal data output (main -> renderer). Returns cleanup function. */
  onData: (callback: (id: string, data: string) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      data: string,
    ) => callback(id, data);
    ipcRenderer.on('terminal:data-out', handler);
    return () => {
      ipcRenderer.removeListener('terminal:data-out', handler);
    };
  },
  /** Listen for terminal exit events (main -> renderer). Returns cleanup function. */
  onExit: (callback: (id: string, exitCode: number) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      id: string,
      exitCode: number,
    ) => callback(id, exitCode);
    ipcRenderer.on('terminal:exit', handler);
    return () => {
      ipcRenderer.removeListener('terminal:exit', handler);
    };
  },
});
ipcRenderer.on('to-renderer', (_event, message) => {
  window.dispatchEvent(new MessageEvent('message', { data: message }));
});
