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

// Query startup configuration from main process (Phase 4.95).
// Synchronous IPC ensures ptahConfig has correct values before Angular boots.
// Returns: { initialView, isLicensed, workspaceRoot, workspaceName }
const startupConfig = ipcRenderer.sendSync('get-startup-config') as {
  initialView?: string | null;
  isLicensed?: boolean;
  workspaceRoot?: string;
  workspaceName?: string;
} | null;

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
// initialView and isLicensed come from the main process license check (Phase 3.5).
// workspaceRoot and workspaceName come from workspace restoration (Phase 2.5).
// The Angular app reads these in:
//   - AppStateManager.initializeState() → reads isLicensed, workspaceRoot, workspaceName
//   - App.handleInitialView() → reads initialView for navigation
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
  // Default to 'chat' — canvas is now a layout mode within chat, not a separate view.
  // The layoutMode signal defaults to 'grid', so Electron still shows canvas grid by default.
  initialView: startupConfig?.initialView || 'chat',
  isLicensed: startupConfig?.isLicensed ?? true,
});

// Expose clipboard API for sandboxed renderer access
contextBridge.exposeInMainWorld('ptahClipboard', {
  readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read-text'),
  writeText: (text: string): void => {
    ipcRenderer.send('clipboard:write-text', text);
  },
});

// Expose terminal binary IPC API (TASK_2025_227)
// Terminal data uses direct IPC channels for low-latency, high-frequency data.
// Only terminal:create and terminal:kill use JSON RPC -- data/resize/exit use binary IPC.
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

// Forward messages from main process to renderer
// The Angular MessageRouterService listens on window 'message' event.
ipcRenderer.on('to-renderer', (_event, message) => {
  // Dispatch as a native window message event -- this is exactly what
  // VS Code does internally for webview postMessage, so the Angular
  // MessageRouterService picks it up without any changes.
  window.dispatchEvent(new MessageEvent('message', { data: message }));
});
