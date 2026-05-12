/**
 * Stateful VS Code API test-double for platform-vscode contract specs.
 *
 * Jest resolves `import * as vscode from 'vscode'` to this file via the
 * `__mocks__` convention. Unlike a pure stub, this test double keeps an
 * in-memory store for every subsystem the platform-vscode impls touch — file
 * system, configuration, commands, output channels, diagnostics, editors, and
 * LM models — so contract tests can assert real round-trip behaviour.
 *
 * Tests MUST call `__resetVscodeTestDouble()` in `beforeEach` to wipe state.
 * Seed helpers (`__vscodeState.*`) let specs prime the double before driving
 * the impl under test.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Minimal IEvent<T> / disposable helpers (mock-local copy to avoid a circular
// import from platform-core, which itself imports from us indirectly).
// ---------------------------------------------------------------------------

type Disposable = { dispose: () => void };
type Listener<T> = (data: T) => void;

function createEmitter<T>(): {
  event: (listener: Listener<T>) => Disposable;
  fire: (data: T) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<Listener<T>>();
  return {
    event: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (data) => {
      for (const l of [...listeners]) {
        try {
          l(data);
        } catch {
          /* swallow */
        }
      }
    },
    listenerCount: () => listeners.size,
  };
}

// ---------------------------------------------------------------------------
// Uri
// ---------------------------------------------------------------------------

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
    scheme: value.includes('://') ? value.split('://')[0] : 'file',
    toString: () => value,
  }),
};

// ---------------------------------------------------------------------------
// FileType / FileSystemError
// ---------------------------------------------------------------------------

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export class FileSystemError extends Error {
  code: string;
  constructor(message: string, code = 'Unknown') {
    super(message);
    this.code = code;
    this.name = 'FileSystemError';
  }
  static FileNotFound(path?: string): FileSystemError {
    return new FileSystemError(`File not found: ${path ?? ''}`, 'FileNotFound');
  }
  static FileExists(path?: string): FileSystemError {
    return new FileSystemError(
      `File already exists: ${path ?? ''}`,
      'FileExists',
    );
  }
}

// ---------------------------------------------------------------------------
// In-memory filesystem backing vscode.workspace.fs
// ---------------------------------------------------------------------------

interface FsEntry {
  type: FileType;
  ctime: number;
  mtime: number;
  content?: Uint8Array;
}

class InMemoryFs {
  readonly entries = new Map<string, FsEntry>();

  clear(): void {
    this.entries.clear();
  }

  private keyOf(uri: { fsPath: string; path: string }): string {
    return uri.fsPath || uri.path;
  }

  private ensureParents(keyPath: string): void {
    // Normalise both forward and back slashes
    const parts = keyPath.replace(/\\/g, '/').split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/') || '/';
      if (!this.entries.has(dir)) {
        this.entries.set(dir, {
          type: FileType.Directory,
          ctime: Date.now(),
          mtime: Date.now(),
        });
      } else if (this.entries.get(dir)?.type !== FileType.Directory) {
        // Parent exists as a file — technically invalid but the contract
        // tests don't exercise this edge case.
      }
    }
  }

  async readFile(uri: { fsPath: string; path: string }): Promise<Uint8Array> {
    const key = this.keyOf(uri);
    const entry = this.entries.get(key);
    if (!entry || entry.type !== FileType.File || !entry.content) {
      throw FileSystemError.FileNotFound(key);
    }
    return entry.content;
  }

  async writeFile(
    uri: { fsPath: string; path: string },
    content: Uint8Array,
  ): Promise<void> {
    const key = this.keyOf(uri);
    this.ensureParents(key);
    this.entries.set(key, {
      type: FileType.File,
      ctime: Date.now(),
      mtime: Date.now(),
      content: new Uint8Array(content),
    });
  }

  async readDirectory(uri: {
    fsPath: string;
    path: string;
  }): Promise<Array<[string, FileType]>> {
    const key = this.keyOf(uri).replace(/\\/g, '/');
    const prefix = key.endsWith('/') ? key : key + '/';
    const children: Array<[string, FileType]> = [];
    for (const [entryKey, entry] of this.entries) {
      const normalised = entryKey.replace(/\\/g, '/');
      if (!normalised.startsWith(prefix)) continue;
      const rest = normalised.slice(prefix.length);
      if (rest.length === 0 || rest.includes('/')) continue;
      children.push([rest, entry.type]);
    }
    return children;
  }

  async stat(uri: {
    fsPath: string;
    path: string;
  }): Promise<{ type: FileType; ctime: number; mtime: number; size: number }> {
    const key = this.keyOf(uri);
    const entry = this.entries.get(key);
    if (!entry) {
      throw FileSystemError.FileNotFound(key);
    }
    return {
      type: entry.type,
      ctime: entry.ctime,
      mtime: entry.mtime,
      size: entry.content?.byteLength ?? 0,
    };
  }

  async delete(
    uri: { fsPath: string; path: string },
    options?: { recursive?: boolean },
  ): Promise<void> {
    const key = this.keyOf(uri);
    const entry = this.entries.get(key);
    if (!entry) {
      throw FileSystemError.FileNotFound(key);
    }
    this.entries.delete(key);
    if (options?.recursive) {
      const prefix = key.replace(/\\/g, '/') + '/';
      for (const k of [...this.entries.keys()]) {
        if (k.replace(/\\/g, '/').startsWith(prefix)) {
          this.entries.delete(k);
        }
      }
    }
  }

  async createDirectory(uri: { fsPath: string; path: string }): Promise<void> {
    const key = this.keyOf(uri);
    this.ensureParents(key);
    if (!this.entries.has(key)) {
      this.entries.set(key, {
        type: FileType.Directory,
        ctime: Date.now(),
        mtime: Date.now(),
      });
    }
  }

  async copy(
    src: { fsPath: string; path: string },
    dst: { fsPath: string; path: string },
    options?: { overwrite?: boolean },
  ): Promise<void> {
    const srcKey = this.keyOf(src);
    const dstKey = this.keyOf(dst);
    const srcEntry = this.entries.get(srcKey);
    if (!srcEntry) throw FileSystemError.FileNotFound(srcKey);
    if (this.entries.has(dstKey) && !options?.overwrite) {
      throw FileSystemError.FileExists(dstKey);
    }
    this.ensureParents(dstKey);
    this.entries.set(dstKey, {
      ...srcEntry,
      content: srcEntry.content ? new Uint8Array(srcEntry.content) : undefined,
    });
  }
}

const inMemoryFs = new InMemoryFs();

// ---------------------------------------------------------------------------
// Configuration store (keyed by `${section}.${key}`)
// ---------------------------------------------------------------------------

const configStore = new Map<string, unknown>();
const configEmitter = createEmitter<{
  affectsConfiguration: (section: string) => boolean;
}>();
const workspaceFoldersEmitter = createEmitter<void>();

// ---------------------------------------------------------------------------
// Workspace folders (seedable)
// ---------------------------------------------------------------------------

type WorkspaceFolder = {
  uri: { fsPath: string; path: string };
  name: string;
  index: number;
};

let workspaceFoldersState: WorkspaceFolder[] = [];

// ---------------------------------------------------------------------------
// File system watchers (seedable per-path emitters)
// ---------------------------------------------------------------------------

const createdWatchers: Array<{
  pattern: string;
  fireChange: (uri: { fsPath: string }) => void;
  fireCreate: (uri: { fsPath: string }) => void;
  fireDelete: (uri: { fsPath: string }) => void;
}> = [];

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();

// ---------------------------------------------------------------------------
// Output channels (tracked for assertion)
// ---------------------------------------------------------------------------

interface MockOutputChannel {
  name: string;
  buffer: string;
  disposed: boolean;
  appendLine: jest.Mock;
  append: jest.Mock;
  clear: jest.Mock;
  show: jest.Mock;
  dispose: jest.Mock;
}

const outputChannels: MockOutputChannel[] = [];

// ---------------------------------------------------------------------------
// Editors / documents (seedable)
// ---------------------------------------------------------------------------

const activeEditorEmitter = createEmitter<
  { document: { uri: { fsPath: string } } } | undefined
>();
const openDocumentEmitter = createEmitter<{ uri: { fsPath: string } }>();
let activeTextEditorState:
  | { document: { uri: { fsPath: string; path: string } } }
  | undefined = undefined;

// ---------------------------------------------------------------------------
// Diagnostics (seedable)
// ---------------------------------------------------------------------------

let diagnosticsState: Array<[{ fsPath: string; path: string }, Array<any>]> =
  [];

// ---------------------------------------------------------------------------
// Secret storage test double (constructor-injectable)
// ---------------------------------------------------------------------------

export class InMemorySecretStorage {
  private entries = new Map<string, string>();
  private emitter = createEmitter<{ key: string }>();

  onDidChange = this.emitter.event;

  async get(key: string): Promise<string | undefined> {
    return this.entries.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    this.emitter.fire({ key });
  }
  async delete(key: string): Promise<void> {
    this.entries.delete(key);
    this.emitter.fire({ key });
  }
}

// ---------------------------------------------------------------------------
// Memento test double (constructor-injectable)
// ---------------------------------------------------------------------------

export class InMemoryMemento {
  private data = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.data.has(key) ? (this.data.get(key) as T) : defaultValue) as
      | T
      | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }
  }
  keys(): readonly string[] {
    return [...this.data.keys()];
  }
}

// ---------------------------------------------------------------------------
// lm (language model) test double
// ---------------------------------------------------------------------------

let chatModels: Array<{
  countTokens: (text: string) => Promise<number>;
  maxInputTokens: number;
}> = [];

export const lm = {
  selectChatModels: jest.fn(async (_selector?: unknown) => chatModels),
};

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------

export const workspace = {
  get workspaceFolders(): WorkspaceFolder[] | undefined {
    return workspaceFoldersState.length === 0
      ? undefined
      : workspaceFoldersState;
  },
  fs: {
    readFile: jest.fn((uri: any) => inMemoryFs.readFile(uri)),
    writeFile: jest.fn((uri: any, content: Uint8Array) =>
      inMemoryFs.writeFile(uri, content),
    ),
    readDirectory: jest.fn((uri: any) => inMemoryFs.readDirectory(uri)),
    stat: jest.fn((uri: any) => inMemoryFs.stat(uri)),
    delete: jest.fn((uri: any, options?: any) =>
      inMemoryFs.delete(uri, options),
    ),
    createDirectory: jest.fn((uri: any) => inMemoryFs.createDirectory(uri)),
    copy: jest.fn((src: any, dst: any, options?: any) =>
      inMemoryFs.copy(src, dst, options),
    ),
  },
  findFiles: jest.fn(async () => []),
  getConfiguration: jest.fn((section: string) => ({
    get: jest.fn(<T>(key: string, defaultValue?: T): T | undefined => {
      const full = `${section}.${key}`;
      return configStore.has(full)
        ? (configStore.get(full) as T)
        : defaultValue;
    }),
    has: jest.fn((key: string) => configStore.has(`${section}.${key}`)),
    inspect: jest.fn(() => undefined),
    update: jest.fn(async (key: string, value: unknown) => {
      configStore.set(`${section}.${key}`, value);
      configEmitter.fire({
        affectsConfiguration: (s: string) => s === section,
      });
    }),
  })),
  createFileSystemWatcher: jest.fn((pattern: string) => {
    const change = createEmitter<{ fsPath: string }>();
    const create = createEmitter<{ fsPath: string }>();
    const del = createEmitter<{ fsPath: string }>();
    const entry = {
      pattern,
      fireChange: change.fire,
      fireCreate: create.fire,
      fireDelete: del.fire,
    };
    createdWatchers.push(entry);
    return {
      onDidChange: change.event,
      onDidCreate: create.event,
      onDidDelete: del.event,
      dispose: jest.fn(),
    };
  }),
  onDidChangeConfiguration: jest.fn((listener: Listener<any>) =>
    configEmitter.event(listener),
  ),
  onDidChangeWorkspaceFolders: jest.fn((listener: Listener<any>) =>
    workspaceFoldersEmitter.event(listener),
  ),
  onDidOpenTextDocument: jest.fn((listener: Listener<any>) =>
    openDocumentEmitter.event(listener),
  ),
  getWorkspaceFolder: jest.fn((_uri: any) => workspaceFoldersState[0]),
  /**
   * Stub for vscode.workspace.updateWorkspaceFolders.
   * Tests that exercise workspace lifecycle mutations should override this with
   * a jest.fn() that also updates `workspaceFoldersState` via
   * `__vscodeState.setWorkspaceFolders(...)`.
   *
   * Default implementation: no-op returning true (matches VS Code's return type).
   */
  updateWorkspaceFolders: jest.fn(
    (
      _start: number,
      _deleteCount: number | null | undefined,
      ..._workspaceFoldersToAdd: Array<{
        uri: { fsPath: string; path: string };
      }>
    ): boolean => true,
  ),
};

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

type ScriptedResponses = {
  nextAction?: string;
  nextInput?: string;
  nextQuickPick?: { label: string };
};

const scripted: ScriptedResponses = {};

export const window = {
  get activeTextEditor() {
    return activeTextEditorState;
  },
  showErrorMessage: jest.fn(async (_msg: string, ..._actions: string[]) => {
    if (scripted.nextAction) {
      const a = scripted.nextAction;
      scripted.nextAction = undefined;
      return a;
    }
    return undefined;
  }),
  showWarningMessage: jest.fn(async (_msg: string, ..._actions: string[]) => {
    if (scripted.nextAction) {
      const a = scripted.nextAction;
      scripted.nextAction = undefined;
      return a;
    }
    return undefined;
  }),
  showInformationMessage: jest.fn(
    async (_msg: string, ..._actions: string[]) => {
      if (scripted.nextAction) {
        const a = scripted.nextAction;
        scripted.nextAction = undefined;
        return a;
      }
      return undefined;
    },
  ),
  showQuickPick: jest.fn(async (items: any[] | Promise<any[]>, _opts?: any) => {
    if (scripted.nextQuickPick) {
      const picked = scripted.nextQuickPick;
      scripted.nextQuickPick = undefined;
      const resolved = await items;
      return resolved.find((i) => i.label === picked.label);
    }
    return undefined;
  }),
  showInputBox: jest.fn(async (_opts?: any) => {
    if (scripted.nextInput !== undefined) {
      const v = scripted.nextInput;
      scripted.nextInput = undefined;
      return v;
    }
    return undefined;
  }),
  withProgress: jest.fn(async (_options: any, task: any) => {
    return task(
      { report: jest.fn() },
      {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      },
    );
  }),
  createOutputChannel: jest.fn((name: string) => {
    const channel: MockOutputChannel = {
      name,
      buffer: '',
      disposed: false,
      appendLine: jest.fn((m: string) => {
        channel.buffer += m + '\n';
      }),
      append: jest.fn((m: string) => {
        channel.buffer += m;
      }),
      clear: jest.fn(() => {
        channel.buffer = '';
      }),
      show: jest.fn(),
      dispose: jest.fn(() => {
        channel.disposed = true;
      }),
    };
    outputChannels.push(channel);
    return channel;
  }),
  onDidChangeActiveTextEditor: jest.fn((listener: Listener<any>) =>
    activeEditorEmitter.event(listener),
  ),
};

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

export const commands = {
  registerCommand: jest.fn(
    (id: string, handler: (...args: unknown[]) => unknown) => {
      commandHandlers.set(id, handler);
      return {
        dispose: jest.fn(() => {
          if (commandHandlers.get(id) === handler) {
            commandHandlers.delete(id);
          }
        }),
      };
    },
  ),
  executeCommand: jest.fn(async (id: string, ...args: unknown[]) => {
    const handler = commandHandlers.get(id);
    if (!handler) {
      throw new Error(`command '${id}' not found`);
    }
    return await handler(...args);
  }),
};

// ---------------------------------------------------------------------------
// languages
// ---------------------------------------------------------------------------

export const languages = {
  getDiagnostics: jest.fn(() => diagnosticsState),
  createDiagnosticCollection: jest.fn(() => ({
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
  })),
};

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

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
  openExternal: jest.fn(async (_uri: any) => true),
};

// ---------------------------------------------------------------------------
// Misc enums / primitives used across impls
// ---------------------------------------------------------------------------

export const EventEmitter = class<T> {
  private emitter = createEmitter<T>();
  event = this.emitter.event;
  fire(data: T): void {
    this.emitter.fire(data);
  }
  dispose(): void {
    /* noop */
  }
};

export const CancellationTokenSource = class {
  token: any = { isCancellationRequested: false };
  cancel() {
    this.token.isCancellationRequested = true;
  }
  dispose() {
    /* noop */
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

// ---------------------------------------------------------------------------
// Test-driver surface — specs import { __vscodeState, __resetVscodeTestDouble }
// via `jest.requireMock('vscode')` so they can prime state without typing the
// whole vscode module.
// ---------------------------------------------------------------------------

export const __vscodeState = {
  fs: inMemoryFs,
  config: configStore,
  configEmitter,
  workspaceFoldersEmitter,
  createdWatchers,
  commandHandlers,
  outputChannels,
  activeEditorEmitter,
  openDocumentEmitter,
  scripted,
  setWorkspaceFolders(paths: string[]): void {
    workspaceFoldersState = paths.map((p, index) => ({
      uri: { fsPath: p, path: p },
      name: p.split(/[/\\]/).pop() ?? p,
      index,
    }));
    workspaceFoldersEmitter.fire(undefined as unknown as void);
  },
  setActiveEditor(filePath: string | undefined): void {
    if (filePath === undefined) {
      activeTextEditorState = undefined;
    } else {
      activeTextEditorState = {
        document: { uri: { fsPath: filePath, path: filePath } },
      };
    }
    activeEditorEmitter.fire(activeTextEditorState);
  },
  fireOpenDocument(filePath: string): void {
    openDocumentEmitter.fire({ uri: { fsPath: filePath } });
  },
  setDiagnostics(
    entries: Array<{
      file: string;
      diagnostics: Array<{
        message: string;
        line: number;
        severity: 'error' | 'warning' | 'info' | 'hint';
      }>;
    }>,
  ): void {
    const sevToVs: Record<string, DiagnosticSeverity> = {
      error: DiagnosticSeverity.Error,
      warning: DiagnosticSeverity.Warning,
      info: DiagnosticSeverity.Information,
      hint: DiagnosticSeverity.Hint,
    };
    diagnosticsState = entries.map((e) => [
      { fsPath: e.file, path: e.file },
      e.diagnostics.map((d) => ({
        message: d.message,
        range: { start: { line: d.line, character: 0 } },
        severity: sevToVs[d.severity] ?? DiagnosticSeverity.Hint,
      })),
    ]);
  },
  setChatModels(
    models: Array<{
      countTokens: (text: string) => Promise<number>;
      maxInputTokens: number;
    }>,
  ): void {
    chatModels = models;
  },
};

export function __resetVscodeTestDouble(): void {
  inMemoryFs.clear();
  configStore.clear();
  commandHandlers.clear();
  outputChannels.length = 0;
  createdWatchers.length = 0;
  workspaceFoldersState = [];
  activeTextEditorState = undefined;
  diagnosticsState = [];
  chatModels = [];
  scripted.nextAction = undefined;
  scripted.nextInput = undefined;
  scripted.nextQuickPick = undefined;
  (workspace.updateWorkspaceFolders as jest.Mock).mockReset();
  (workspace.updateWorkspaceFolders as jest.Mock).mockReturnValue(true);
}
