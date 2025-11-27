/**
 * VS Code API Mocks for Testing
 * Provides comprehensive mocks for all VS Code API types used in tests
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as vscode from 'vscode';

/**
 * Mock VS Code Extension Context
 */
export function createMockExtensionContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: {
      get: jest.fn(),
      update: jest.fn(),
      keys: jest.fn().mockReturnValue([]),
    } as any,
    globalState: {
      get: jest.fn(),
      update: jest.fn(),
      setKeysForSync: jest.fn(),
      keys: jest.fn().mockReturnValue([]),
    } as any,
    secrets: {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(),
    } as any,
    extensionUri: createMockUri('/test/extension/path'),
    extensionPath: '/test/extension/path',
    environmentVariableCollection: {
      persistent: false,
      replace: jest.fn(),
      append: jest.fn(),
      prepend: jest.fn(),
      get: jest.fn(),
      forEach: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    } as any,
    storagePath: '/test/storage/path',
    globalStoragePath: '/test/global/storage/path',
    logPath: '/test/log/path',
    extensionMode: 1, // ExtensionMode.Development
    logUri: createMockUri('/test/log/path'),
    storageUri: createMockUri('/test/storage/path'),
    globalStorageUri: createMockUri('/test/global/storage/path'),
    asAbsolutePath: jest
      .fn()
      .mockImplementation(
        (relativePath: string) => `/test/extension/path/${relativePath}`
      ),
    extension: {
      id: 'test.extension',
      extensionUri: createMockUri('/test/extension/path'),
      extensionPath: '/test/extension/path',
      isActive: true,
      packageJSON: { name: 'test-extension', version: '1.0.0' },
      exports: undefined,
      activate: jest.fn(),
      extensionKind: 1,
    } as any,
    languageModelAccessInformation: {
      onDidChange: jest.fn(),
      canSendRequest: jest.fn().mockReturnValue(true),
    } as any,
  };
}

/**
 * Mock VS Code Webview Panel
 */
export function createMockWebviewPanel(): vscode.WebviewPanel {
  const webview = {
    options: {},
    html: '',
    onDidReceiveMessage: jest.fn(),
    postMessage: jest.fn().mockResolvedValue(true),
    asWebviewUri: jest.fn(),
  } as any;

  return {
    webview,
    viewType: 'test-webview',
    title: 'Test Webview',
    options: {},
    viewColumn: 1, // ViewColumn.One
    active: true,
    visible: true,
    onDidDispose: jest.fn(),
    onDidChangeViewState: jest.fn(),
    reveal: jest.fn(),
    dispose: jest.fn(),
  } as vscode.WebviewPanel;
}

/**
 * Mock VS Code Uri
 */
export function createMockUri(path = '/test/path'): vscode.Uri {
  return {
    scheme: 'file',
    authority: '',
    path,
    query: '',
    fragment: '',
    fsPath: path,
    with: jest.fn(),
    toString: jest.fn().mockReturnValue(`file://${path}`),
    toJSON: jest.fn().mockReturnValue({
      scheme: 'file',
      authority: '',
      path,
      query: '',
      fragment: '',
    }),
  } as vscode.Uri;
}

/**
 * Mock VS Code Disposable
 */
export function createMockDisposable(): vscode.Disposable {
  return {
    dispose: jest.fn(),
  };
}

/**
 * Complete VS Code module mock
 */
export const vscodeModuleMock = {
  ExtensionContext: jest.fn().mockImplementation(createMockExtensionContext),
  commands: {
    registerCommand: jest.fn().mockImplementation(() => createMockDisposable()),
    executeCommand: jest.fn(),
  },
  window: {
    createWebviewPanel: jest
      .fn()
      .mockImplementation(() => createMockWebviewPanel()),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
  },
  ViewColumn: {
    One: 1,
    Two: 2,
    Three: 3,
    Active: -1,
    Beside: -2,
  },
  Uri: {
    file: jest.fn().mockImplementation((path: string) => createMockUri(path)),
    parse: jest.fn().mockImplementation((uri: string) => createMockUri(uri)),
    joinPath: jest
      .fn()
      .mockImplementation((base: vscode.Uri, ...paths: string[]) =>
        createMockUri(`${base.path}/${paths.join('/')}`)
      ),
  },
  Disposable: {
    from: jest
      .fn()
      .mockImplementation((...disposables: vscode.Disposable[]) => ({
        dispose: () => disposables.forEach((d) => d.dispose()),
      })),
  },
  EventEmitter: jest.fn().mockImplementation(() => ({
    event: jest.fn(),
    fire: jest.fn(),
    dispose: jest.fn(),
  })),
  WebviewOptions: {},
  WebviewPanelOptions: {},
};
