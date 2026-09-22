/**
 * Mock for VS Code API
 * Used in Jest tests to avoid parsing native VS Code type definitions
 */

export const Uri = {
  file: (path: string) => ({ fsPath: path, path }),
  parse: (value: string) => ({ fsPath: value, path: value }),
  /**
   * Additive gap fill: `WebviewHtmlGenerator.getAssetUris` calls this, so any
   * spec exercising webview HTML generation threw `Uri.joinPath is not a
   * function` before it could assert anything.
   */
  joinPath: (base: { path: string }, ...segments: string[]) => {
    const path = [base.path.replace(/\/$/, ''), ...segments].join('/');
    return { fsPath: path, path, toString: () => path };
  },
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
  /**
   * Additive gap fill, same reason as `Uri.joinPath`. `Dark` (2) matches
   * `ColorThemeKind.Dark`, which is the branch the webview HTML generator's
   * theme handling treats as the default.
   */
  activeColorTheme: { kind: 2 },
};

/** Additive gap fill: mirrors the real `vscode.ColorThemeKind` enum values. */
export const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
} as const;

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
