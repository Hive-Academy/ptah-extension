import 'reflect-metadata';
import * as path from 'path';

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

import { FileRpcHandlers } from './file-rpc.handlers';

type RpcMethod = (params?: unknown) => Promise<{
  success: boolean;
  error?: string;
  isDirectory?: boolean;
}>;

const WORKSPACE = path.resolve('/ws');
const OUTSIDE = path.resolve('/other/repo/x.ts');

describe('FileRpcHandlers — file:open', () => {
  const resolveForView = jest.fn();
  const resolveForExternalOpen = jest.fn();
  const captureException = jest.fn();
  const editor = {
    selection: undefined as unknown,
    revealRange: jest.fn(),
  };

  function build(): RpcMethod {
    const methods = new Map<string, RpcMethod>();
    new FileRpcHandlers(
      { debug: jest.fn(), error: jest.fn() } as never,
      {
        registerMethod: (name: string, handler: RpcMethod) =>
          methods.set(name, handler),
      } as never,
      { captureException } as never,
      { resolveForView, resolveForExternalOpen } as never,
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
    expect(resolveForExternalOpen).not.toHaveBeenCalled();
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
    expect(resolveForExternalOpen).not.toHaveBeenCalled();
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
   * R3: an absolute path in an unregistered sibling repo opens today, so it
   * must keep opening — behind an explicit confirmation that shows the path,
   * rather than being refused.
   */
  it('confirms an out-of-root absolute path, showing the absolute path', async () => {
    resolveForView.mockResolvedValue({
      kind: 'rejected',
      reason: 'outside-roots',
    });
    resolveForExternalOpen.mockResolvedValue(file(OUTSIDE));
    showWarningMessage.mockResolvedValue('Open');

    await expect(build()({ path: OUTSIDE })).resolves.toEqual({
      success: true,
    });

    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('outside your open workspaces'),
      expect.objectContaining({ modal: true, detail: OUTSIDE }),
      'Open',
    );
    expect(openTextDocument).toHaveBeenCalled();
  });

  it('opens nothing when the confirmation is cancelled', async () => {
    resolveForView.mockResolvedValue({
      kind: 'rejected',
      reason: 'outside-roots',
    });
    resolveForExternalOpen.mockResolvedValue(file(OUTSIDE));
    showWarningMessage.mockResolvedValue(undefined);

    const result = await build()({ path: OUTSIDE });

    expect(result.success).toBe(false);
    expect(openTextDocument).not.toHaveBeenCalled();
  });

  /** R1: a deny-listed credential is refused outright, with no confirm offered. */
  it('refuses a deny-listed credential without offering a confirmation', async () => {
    resolveForView.mockResolvedValue({
      kind: 'rejected',
      reason: 'outside-roots',
    });
    resolveForExternalOpen.mockResolvedValue({
      kind: 'rejected',
      reason: 'outside-roots',
    });

    const result = await build()({ path: '/home/me/.ssh/id_ed25519' });

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
