/**
 * Minimal mock for the Electron API used in Jest tests for the main process.
 * Keeps the surface area small and synchronous — spec files can extend / override
 * via `jest.mock('electron', () => ({ ... }))` when they need richer behavior.
 */

export const app = {
  getPath: (name: string) => `/tmp/electron-mock/${name}`,
  getName: () => 'ptah-electron',
  getVersion: () => '0.0.0-test',
  getAppPath: () => '/tmp/electron-mock/app',
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  on: () => undefined,
  once: () => undefined,
  quit: () => undefined,
  requestSingleInstanceLock: () => true,
  setAppUserModelId: () => undefined,
};

export const BrowserWindow = class {
  webContents = { send: () => undefined, openDevTools: () => undefined };
  loadFile = () => Promise.resolve();
  loadURL = () => Promise.resolve();
  on = () => undefined;
  show = () => undefined;
  close = () => undefined;
  isDestroyed = () => false;
};

export const ipcMain = {
  handle: () => undefined,
  on: () => undefined,
  removeHandler: () => undefined,
  removeListener: () => undefined,
};

export const ipcRenderer = {
  invoke: () => Promise.resolve(),
  on: () => undefined,
  send: () => undefined,
};

export const contextBridge = {
  exposeInMainWorld: () => undefined,
};

export const shell = {
  openExternal: () => Promise.resolve(),
};

export const clipboard = {
  readText: () => '',
  writeText: () => undefined,
};

export const dialog = {
  showSaveDialog: () =>
    Promise.resolve({ canceled: true, filePath: undefined }),
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
};

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
};

export const Menu = {
  buildFromTemplate: () => ({ popup: () => undefined }),
  setApplicationMenu: () => undefined,
};

export const nativeTheme = {
  shouldUseDarkColors: false,
  on: () => undefined,
};

export default {
  app,
  BrowserWindow,
  ipcMain,
  ipcRenderer,
  contextBridge,
  shell,
  clipboard,
  dialog,
  safeStorage,
  Menu,
  nativeTheme,
};
