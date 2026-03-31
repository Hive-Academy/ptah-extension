/**
 * VS Code API Shim for Electron
 *
 * TASK_2025_200 Batch 3: Provides empty stubs for the vscode module.
 *
 * Some @ptah-extension/vscode-core modules (OutputManager, ErrorHandler,
 * ConfigManager, etc.) import 'vscode' at the module level. When the bundler
 * resolves @ptah-extension/vscode-core via the barrel export (index.ts),
 * these modules are included even though Electron never instantiates them.
 *
 * This shim prevents runtime crashes from `import * as vscode from 'vscode'`.
 * The VS Code-specific service classes are NEVER instantiated in Electron --
 * we register Electron-compatible replacements (ElectronOutputManagerAdapter,
 * ElectronLoggerAdapter, etc.) instead.
 *
 * WARNING: If any code path actually tries to USE these stubs at runtime,
 * it will get undefined/no-op behavior. This is intentional -- those code
 * paths should never execute in Electron.
 *
 * Uses named exports so esbuild (tsconfig paths / external alias) can resolve
 * `import * as vscode from 'vscode'` correctly.
 */

// Named exports matching the vscode API surface used by our codebase

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

const vscodeWindow = {
  createOutputChannel: () => ({
    appendLine: () => {
      /* noop shim */
    },
    append: () => {
      /* noop shim */
    },
    clear: () => {
      /* noop shim */
    },
    show: () => {
      /* noop shim */
    },
    hide: () => {
      /* noop shim */
    },
    dispose: () => {
      /* noop shim */
    },
    name: 'shim',
  }),
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  createTerminal: () => ({
    sendText: () => {
      /* noop shim */
    },
    show: () => {
      /* noop shim */
    },
    dispose: () => {
      /* noop shim */
    },
  }),
};

const vscodeWorkspace = {
  getConfiguration: () => ({
    get: () => undefined,
    has: () => false,
    inspect: () => undefined,
    update: async () => {
      /* noop shim */
    },
  }),
  workspaceFolders: undefined,
  onDidChangeConfiguration: () => ({
    dispose: () => {
      /* noop shim */
    },
  }),
  fs: {
    readFile: async () => Buffer.from(''),
    writeFile: async () => {
      /* noop shim */
    },
    stat: async () => ({ type: 1, ctime: 0, mtime: 0, size: 0 }),
    readDirectory: async () => [],
    createDirectory: async () => {
      /* noop shim */
    },
    delete: async () => {
      /* noop shim */
    },
    rename: async () => {
      /* noop shim */
    },
    copy: async () => {
      /* noop shim */
    },
  },
};

export const commands = {
  registerCommand: () => ({
    dispose: () => {
      /* noop shim */
    },
  }),
  executeCommand: async () => undefined,
};

export const env = {
  openExternal: async () => false,
};

export const Uri = {
  parse: (value: string) => ({ toString: () => value, fsPath: value }),
  file: (path: string) => ({ toString: () => path, fsPath: path }),
  joinPath: (...args: unknown[]) => ({
    toString: () => String(args[args.length - 1]),
    fsPath: String(args[args.length - 1]),
  }),
};

export const authentication = {
  getSession: async () => undefined,
};

export const Disposable = class {
  static from(...disposables: Array<{ dispose: () => void }>) {
    return {
      dispose: () => disposables.forEach((d) => d.dispose()),
    };
  }
};

export const EventEmitter = class {
  event = () => ({
    dispose: () => {
      /* noop shim */
    },
  });
  fire() {
    /* noop shim */
  }
  dispose() {
    /* noop shim */
  }
};

export const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3,
  Active: -1,
  Beside: -2,
};

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

export const lm = {
  selectChatModels: async () => [],
};

export const extensions = {
  getExtension: () => undefined,
};

export const version = '0.0.0';

// Re-export internal names as the vscode API surface names
// `import * as vscode from 'vscode'` will see vscode.window, vscode.workspace, etc.
export { vscodeWindow as window, vscodeWorkspace as workspace };
