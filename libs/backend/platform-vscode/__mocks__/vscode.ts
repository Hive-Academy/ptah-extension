/**
 * Mock for VS Code API
 * Used in Jest tests for the platform-vscode library.
 *
 * Provides mock implementations of all VS Code APIs used by
 * the platform-vscode implementation classes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const Uri = {
  file: (path: string) => ({
    fsPath: path,
    path,
    scheme: 'file',
    toString: () => `file://${path}`,
  }),
  parse: (value: string) => ({
    fsPath: value,
    path: value,
    scheme: value.split('://')[0] || 'file',
    toString: () => value,
  }),
};

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export const workspace = {
  fs: {
    readFile: jest.fn(() => Promise.resolve(new Uint8Array())),
    writeFile: jest.fn(() => Promise.resolve()),
    readDirectory: jest.fn(() => Promise.resolve([])),
    stat: jest.fn(() =>
      Promise.resolve({
        type: FileType.File,
        ctime: 0,
        mtime: 0,
        size: 0,
      })
    ),
    delete: jest.fn(() => Promise.resolve()),
    createDirectory: jest.fn(() => Promise.resolve()),
    copy: jest.fn(() => Promise.resolve()),
  },
  workspaceFolders: [
    {
      uri: { fsPath: '/mock/workspace' },
      name: 'workspace',
      index: 0,
    },
  ],
  findFiles: jest.fn(() => Promise.resolve([])),
  getConfiguration: jest.fn(() => ({
    get: jest.fn((key: string, defaultValue?: any) => defaultValue),
    has: jest.fn(() => false),
    inspect: jest.fn(() => undefined),
    update: jest.fn(() => Promise.resolve()),
  })),
  createFileSystemWatcher: jest.fn(() => ({
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
    onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn(),
  })),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
  onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
};

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export const window = {
  showErrorMessage: jest.fn(() => Promise.resolve(undefined)),
  showWarningMessage: jest.fn(() => Promise.resolve(undefined)),
  showInformationMessage: jest.fn(() => Promise.resolve(undefined)),
  showQuickPick: jest.fn(() => Promise.resolve(undefined)),
  showInputBox: jest.fn(() => Promise.resolve(undefined)),
  withProgress: jest.fn((_options: any, task: any) =>
    task({ report: jest.fn() })
  ),
  createOutputChannel: jest.fn((name: string) => ({
    name,
    appendLine: jest.fn(),
    append: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
  })),
  onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
  activeTextEditor: undefined as any,
};

export const commands = {
  registerCommand: jest.fn((_id: string, _handler: any) => ({
    dispose: jest.fn(),
  })),
  executeCommand: jest.fn(() => Promise.resolve(undefined)),
};

export const EventEmitter = class {
  event: any = () => ({
    dispose: () => {
      /* noop */
    },
  });
  fire() {
    /* noop mock */
  }
  dispose() {
    /* noop mock */
  }
};

export const CancellationTokenSource = class {
  token: any = {};
  cancel() {
    /* noop mock */
  }
  dispose() {
    /* noop mock */
  }
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export const languages = {
  createDiagnosticCollection: jest.fn(() => ({
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
  })),
};

export const env = {
  appName: 'Visual Studio Code',
  appRoot: '/mock/vscode',
  language: 'en',
  machineId: 'mock-machine-id',
  sessionId: 'mock-session-id',
  clipboard: {
    readText: jest.fn(() => Promise.resolve('')),
    writeText: jest.fn(() => Promise.resolve()),
  },
};
