/**
 * Mock for VS Code API
 * Used in Jest tests to avoid parsing native VS Code type definitions
 */

export const Uri = {
  file: (path: string) => ({ fsPath: path, path }),
  parse: (value: string) => ({ fsPath: value, path: value }),
};

export const workspace = {
  workspaceFolders: [],
  getConfiguration: () => ({
    get: () => undefined,
    has: () => false,
    inspect: () => undefined,
    update: () => Promise.resolve(),
  }),
  fs: {
    readFile: () => Promise.resolve(Buffer.from('')),
    writeFile: () => Promise.resolve(),
  },
};

export const window = {
  showInformationMessage: () => Promise.resolve(),
  showWarningMessage: () => Promise.resolve(),
  showErrorMessage: () => Promise.resolve(),
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve(),
};

export const EventEmitter = class {
  event: any = () => ({ dispose: () => {} });
  fire() {}
  dispose() {}
};

export const CancellationTokenSource = class {
  token: any = {};
  cancel() {}
  dispose() {}
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
  createDiagnosticCollection: () => ({
    set: () => {},
    delete: () => {},
    clear: () => {},
    dispose: () => {},
  }),
};

export const env = {
  appName: 'Visual Studio Code',
  appRoot: '/mock/vscode',
  language: 'en',
  machineId: 'mock-machine-id',
  sessionId: 'mock-session-id',
  clipboard: {
    readText: () => Promise.resolve(''),
    writeText: () => Promise.resolve(),
  },
};
