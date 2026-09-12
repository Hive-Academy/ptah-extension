import 'reflect-metadata';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

const showWarningMessage = jest.fn();
const showTextDocument = jest.fn();
const openTextDocument = jest.fn();
const executeCommand = jest.fn();

jest.mock('vscode', () => ({
  Uri: { file: (p: string) => ({ fsPath: p, path: p }) },
  workspace: {
    openTextDocument: (...args: unknown[]) => openTextDocument(...args),
  },
  window: {
    showWarningMessage: (...args: unknown[]) => showWarningMessage(...args),
    showTextDocument: (...args: unknown[]) => showTextDocument(...args),
  },
  commands: {
    executeCommand: (...args: unknown[]) => executeCommand(...args),
  },
  Position: class {
    constructor(
      public line: number,
      public character: number,
    ) {}
  },
  Selection: class {
    constructor(
      public anchor: unknown,
      public active: unknown,
    ) {}
  },
  Range: class {
    constructor(
      public start: unknown,
      public end: unknown,
    ) {}
  },
  TextEditorRevealType: { InCenter: 2 },
}));

import { FileLinkRootPolicy } from '@ptah-extension/rpc-handlers';
import { FileRpcHandlers } from './file-rpc.handlers';

type RpcMethod = (params?: unknown) => Promise<{
  success: boolean;
  error?: string;
  isDirectory?: boolean;
}>;

const WORKSPACE = path.resolve('/ws');

describe('FileRpcHandlers — file:open', () => {
  const resolveForView = jest.fn();
  const resolveForHostReveal = jest.fn();
  const captureException = jest.fn();
  const editor = {
    selection: undefined as unknown,
    revealRange: jest.fn(),
  };

  /**
   * `policy` defaults to the doubled one so the navigation tests stay focused.
   * The out-of-root block below passes a REAL {@link FileLinkRootPolicy}: a
   * mock there concealed that the policy this handler used rejected every
   * sibling repository before the confirmation could run (HIGH-2).
   */
  function build(policy?: unknown): RpcMethod {
    const methods = new Map<string, RpcMethod>();
    new FileRpcHandlers(
      { debug: jest.fn(), error: jest.fn() } as never,
      {
        registerMethod: (name: string, handler: RpcMethod) =>
          methods.set(name, handler),
      } as never,
      { captureException } as never,
      (policy ?? { resolveForView, resolveForHostReveal }) as never,
    ).register();
    const method = methods.get('file:open');
    if (!method) throw new Error('file:open was not registered');
    return method;
  }

  const file = (lexicalPath: string) => ({
    kind: 'file',
    lexicalPath,
    realPath: lexicalPath,
    root: WORKSPACE,
    sizeBytes: 1,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    editor.selection = undefined;
    openTextDocument.mockResolvedValue({ uri: 'doc' });
    showTextDocument.mockResolvedValue(editor);
    showWarningMessage.mockResolvedValue(undefined);
  });

  it('opens a relative path resolved under an authorized root', async () => {
    const target = path.join(WORKSPACE, 'src', 'a.ts');
    resolveForView.mockResolvedValue(file(target));

    await expect(
      build()({ path: 'src/a.ts', workspaceRoot: WORKSPACE }),
    ).resolves.toEqual({ success: true });

    expect(resolveForView).toHaveBeenCalledWith(
      { path: 'src/a.ts', workspaceRoot: WORKSPACE },
      { maxBytes: Number.POSITIVE_INFINITY, allowDirectory: true },
    );
    expect(openTextDocument).toHaveBeenCalled();
  });

  /**
   * The regression this handler was hardened against: a relative path used to
   * reach `fs.stat` directly, resolving against the extension host's
   * `process.cwd()`. It must never fall back to the external-link policy
   * either, which would reintroduce an unrooted resolution.
   */
  it('refuses a relative path with an unregistered root and never falls back', async () => {
    resolveForView.mockResolvedValue({
      kind: 'rejected',
      reason: 'root-not-open',
    });

    const result = await build()({ path: 'src/a.ts', workspaceRoot: '/nope' });

    expect(result.success).toBe(false);
    expect(resolveForHostReveal).not.toHaveBeenCalled();
    expect(openTextDocument).not.toHaveBeenCalled();
    expect(showWarningMessage).toHaveBeenCalled();
  });

  it.each([
    ['a UNC share', '\\\\server\\share\\a.ts'],
    ['a device path', '\\\\.\\PhysicalDrive0'],
    ['an extended-length prefix', '\\\\?\\C:\\a.ts'],
  ])('refuses %s before consulting any policy', async (_label, candidate) => {
    const result = await build()({ path: candidate });

    expect(result).toEqual({
      success: false,
      error: 'That path form is not supported.',
    });
    expect(resolveForView).not.toHaveBeenCalled();
    expect(resolveForHostReveal).not.toHaveBeenCalled();
    expect(openTextDocument).not.toHaveBeenCalled();
  });

  it('opens an in-workspace absolute path with NO confirmation', async () => {
    const target = path.join(WORKSPACE, 'a.ts');
    resolveForView.mockResolvedValue(file(target));

    await expect(build()({ path: target })).resolves.toEqual({
      success: true,
    });
    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(openTextDocument).toHaveBeenCalled();
  });

  /**
   * R3, against the REAL policy. The previous version of this block mocked
   * `resolveForExternalOpen` to return a synthetic file for `/other/repo/x.ts`
   * — and the real policy rejects every path outside registered ∪ home ∪ temp,
   * so the confirmation was unreachable for exactly the case R3 protects.
   * These tests run the genuine `FileLinkRootPolicy` against real files in a
   * temp directory that no registered root contains.
   */
  describe('an out-of-root absolute path, against the real policy', () => {
    let sibling: string;
    let siblingFile: string;
    let credential: string;

    const realPolicy = () =>
      new FileLinkRootPolicy(
        { getWorkspaceFolders: () => [WORKSPACE] } as never,
        { getWorktrees: async () => [] } as never,
      );

    beforeAll(async () => {
      sibling = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-file-open-')),
      );
      siblingFile = path.join(sibling, 'main.ts');
      await fs.writeFile(siblingFile, 'export {};', 'utf8');
      await fs.mkdir(path.join(sibling, '.ssh'), { recursive: true });
      credential = path.join(sibling, '.ssh', 'id_ed25519');
      await fs.writeFile(credential, 'KEY', 'utf8');
    });

    afterAll(async () => {
      await fs.rm(sibling, { recursive: true, force: true });
    });

    it('confirms with the absolute path and opens on Open', async () => {
      showWarningMessage.mockResolvedValue('Open');

      await expect(build(realPolicy())({ path: siblingFile })).resolves.toEqual(
        { success: true },
      );

      expect(showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('outside your open workspaces'),
        expect.objectContaining({ modal: true, detail: siblingFile }),
        'Open',
      );
      expect(openTextDocument).toHaveBeenCalled();
    });

    it('opens nothing when the confirmation is declined', async () => {
      showWarningMessage.mockResolvedValue(undefined);

      const result = await build(realPolicy())({ path: siblingFile });

      expect(result).toEqual({
        success: false,
        error: 'Opening that file was cancelled.',
      });
      expect(openTextDocument).not.toHaveBeenCalled();
    });

    /** R1: a deny-listed credential is refused outright, no confirm offered. */
    it('refuses a deny-listed credential without offering a confirmation', async () => {
      const result = await build(realPolicy())({ path: credential });

      expect(result.success).toBe(false);
      expect(openTextDocument).not.toHaveBeenCalled();
      expect(showWarningMessage).toHaveBeenCalledTimes(1);
      // The single call is the non-modal refusal, not a modal confirm.
      expect(showWarningMessage).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ modal: true }),
        'Open',
      );
    });

    it.each([
      ['a UNC share', '\\\\server\\share\\a.ts'],
      ['a device path', '\\\\.\\PhysicalDrive0'],
    ])('refuses %s before any confirmation', async (_label, candidate) => {
      const result = await build(realPolicy())({ path: candidate });

      expect(result).toEqual({
        success: false,
        error: 'That path form is not supported.',
      });
      expect(openTextDocument).not.toHaveBeenCalled();
    });
  });

  it('places the cursor at the 1-based line and column', async () => {
    const target = path.join(WORKSPACE, 'a.ts');
    resolveForView.mockResolvedValue(file(target));

    await build()({ path: target, line: 12, column: 3 });

    expect(editor.selection).toMatchObject({
      anchor: { line: 11, character: 2 },
      active: { line: 11, character: 2 },
    });
    expect(editor.revealRange).toHaveBeenCalled();
  });

  it('defaults the column to the first character when only a line is given', async () => {
    const target = path.join(WORKSPACE, 'a.ts');
    resolveForView.mockResolvedValue(file(target));

    await build()({ path: target, line: 5 });

    expect(editor.selection).toMatchObject({
      anchor: { line: 4, character: 0 },
    });
  });

  it('reveals a directory in the explorer', async () => {
    const dir = path.join(WORKSPACE, 'src');
    resolveForView.mockResolvedValue({
      kind: 'directory',
      lexicalPath: dir,
      realPath: dir,
      root: WORKSPACE,
    });

    await expect(build()({ path: dir })).resolves.toEqual({
      success: true,
      isDirectory: true,
    });
    expect(executeCommand).toHaveBeenCalledWith(
      'revealInExplorer',
      expect.objectContaining({ fsPath: dir }),
    );
    expect(openTextDocument).not.toHaveBeenCalled();
  });

  it('returns fixed copy and captures the real error when opening throws', async () => {
    const target = path.join(WORKSPACE, 'a.ts');
    resolveForView.mockResolvedValue(file(target));
    openTextDocument.mockRejectedValue(new Error('EACCES /secret/detail'));

    const result = await build()({ path: target });

    expect(result).toEqual({
      success: false,
      error: 'Could not open the file in VS Code.',
    });
    expect(result.error).not.toContain('/secret/detail');
    expect(captureException).toHaveBeenCalled();
  });

  it.each([
    ['an unknown key', { path: 'a.ts', nope: 1 }],
    ['a missing path', {}],
    ['a zero line', { path: 'a.ts', line: 0 }],
    ['a zero column', { path: 'a.ts', column: 0 }],
  ])('rejects %s at the schema', async (_label, params) => {
    const result = await build()(params);
    expect(result).toEqual({
      success: false,
      error: 'That file request was not valid.',
    });
    expect(resolveForView).not.toHaveBeenCalled();
  });
});
