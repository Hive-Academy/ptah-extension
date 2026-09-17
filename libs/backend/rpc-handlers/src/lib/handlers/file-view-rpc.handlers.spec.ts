import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { FILE_VIEW_MAX_BYTES } from '@ptah-extension/shared';

import { FileViewRpcHandlers } from './file-view-rpc.handlers';

type RpcMethod = (params?: unknown) => Promise<unknown>;

interface FailureResult {
  success: false;
  reason: string;
  error: string;
  absolutePath?: string;
  sizeBytes?: number;
  externalOpenAllowed: boolean;
}

interface SuccessResult {
  success: true;
  absolutePath: string;
  workspaceRoot: string;
  relativePath: string;
  content: string;
  sizeBytes: number;
  encoding: string;
}

describe('FileViewRpcHandlers — file:viewContent', () => {
  let base: string;
  let workspace: string;

  const resolveForView = jest.fn();
  const resolveForExternalOpen = jest.fn(async () => ({
    kind: 'rejected' as const,
    reason: 'outside-roots' as const,
  }));
  const warn = jest.fn();

  function build(): RpcMethod {
    const methods = new Map<string, RpcMethod>();
    new FileViewRpcHandlers(
      { warn } as never,
      {
        registerMethod: (name: string, handler: RpcMethod) =>
          methods.set(name, handler),
      } as never,
      { resolveForView, resolveForExternalOpen } as never,
    ).register();
    const method = methods.get('file:viewContent');
    if (!method) throw new Error('file:viewContent was not registered');
    return method;
  }

  /** A resolved file, as the policy would report it. */
  async function resolvedFile(relative: string, sizeBytes?: number) {
    const lexicalPath = path.join(workspace, relative);
    const stat = await fs.stat(lexicalPath);
    return {
      kind: 'file',
      lexicalPath,
      realPath: lexicalPath,
      root: workspace,
      sizeBytes: sizeBytes ?? stat.size,
    };
  }

  beforeAll(async () => {
    base = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-fileview-')),
    );
    workspace = path.join(base, 'ws');
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true });

    await fs.writeFile(path.join(workspace, 'src', 'a.ts'), 'hello', 'utf8');
    await fs.writeFile(
      path.join(workspace, 'bom.txt'),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('hi', 'utf8'),
      ]),
    );
    await fs.writeFile(
      path.join(workspace, 'utf16le.txt'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi', 'utf16le')]),
    );
    await fs.writeFile(
      path.join(workspace, 'binary.bin'),
      Buffer.from([0x41, 0x00, 0x42, 0x43]),
    );
    // 0xC3 with no continuation byte is invalid UTF-8 and carries no NUL, so
    // it reaches the fatal decoder rather than the binary sniff.
    await fs.writeFile(
      path.join(workspace, 'bad-utf8.txt'),
      Buffer.from([0x41, 0xc3, 0x28, 0x42]),
    );
  });

  afterAll(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns decoded content with a POSIX relative path', async () => {
    resolveForView.mockResolvedValue(await resolvedFile('src/a.ts'));
    const result = (await build()({ path: 'src/a.ts' })) as SuccessResult;

    expect(result).toMatchObject({
      success: true,
      content: 'hello',
      encoding: 'utf-8',
      sizeBytes: 5,
      workspaceRoot: workspace,
      relativePath: 'src/a.ts',
      absolutePath: path.join(workspace, 'src', 'a.ts'),
    });
  });

  it('strips a UTF-8 BOM', async () => {
    resolveForView.mockResolvedValue(await resolvedFile('bom.txt'));
    const result = (await build()({ path: 'bom.txt' })) as SuccessResult;
    expect(result.content).toBe('hi');
    expect(result.encoding).toBe('utf-8');
  });

  /**
   * The BOM check must precede the NUL sniff: UTF-16 text is full of NUL
   * bytes, so sniffing first would call every UTF-16 document binary.
   */
  it('decodes UTF-16 LE rather than calling it binary', async () => {
    resolveForView.mockResolvedValue(await resolvedFile('utf16le.txt'));
    const result = (await build()({ path: 'utf16le.txt' })) as SuccessResult;
    expect(result.content).toBe('hi');
    expect(result.encoding).toBe('utf-16le');
  });

  it('refuses a binary file', async () => {
    resolveForView.mockResolvedValue(await resolvedFile('binary.bin'));
    const result = (await build()({ path: 'binary.bin' })) as FailureResult;
    expect(result.reason).toBe('binary');
    expect(result.error).toBe('This file is binary and cannot be previewed.');
  });

  it('refuses non-UTF-8 bytes', async () => {
    resolveForView.mockResolvedValue(await resolvedFile('bad-utf8.txt'));
    const result = (await build()({ path: 'bad-utf8.txt' })) as FailureResult;
    expect(result.reason).toBe('unsupported-encoding');
    expect(result.error).toBe('This file is not valid UTF-8 text.');
  });

  /** The file grew between the policy's `stat` and this handler's `open`. */
  it('refuses a file that grew past the cap after stat', async () => {
    const grown = path.join(workspace, 'grown.txt');
    await fs.writeFile(grown, 'x'.repeat(FILE_VIEW_MAX_BYTES + 10), 'utf8');
    resolveForView.mockResolvedValue({
      kind: 'file',
      lexicalPath: grown,
      realPath: grown,
      root: workspace,
      sizeBytes: 10, // the stale, pre-growth size
    });

    const result = (await build()({ path: 'grown.txt' })) as FailureResult;
    expect(result.reason).toBe('too-large');
    expect(result.error).toBe('This file is too large to preview.');
    await fs.rm(grown, { force: true });
  });

  it.each([
    ['an unknown key', { path: 'a.ts', nope: 1 }],
    ['a missing path', {}],
    ['an empty path', { path: '' }],
    ['an over-long path', { path: 'a'.repeat(4097) }],
    ['a non-string path', { path: 42 }],
    ['a nullish payload', undefined],
  ])('rejects %s at the schema, before any policy call', async (_l, params) => {
    const result = (await build()(params)) as FailureResult;
    expect(result).toMatchObject({
      success: false,
      reason: 'invalid-request',
      error: 'That file request was not valid.',
      externalOpenAllowed: false,
    });
    expect(resolveForView).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported-path', 'That path form is not supported.'],
    ['no-base-root', 'This link needs an open workspace to resolve against.'],
    ['root-not-open', 'That workspace is not open in Ptah.'],
    ['outside-roots', 'This file is outside the workspaces open in Ptah.'],
    ['not-found', 'That file no longer exists.'],
    ['not-a-file', 'That path is not a file.'],
    ['unreadable', 'That file could not be read.'],
  ])('maps %s to fixed, path-free copy', async (reason, message) => {
    resolveForView.mockResolvedValue({ kind: 'rejected', reason });
    const result = (await build()({ path: 'src/a.ts' })) as FailureResult;

    expect(result.reason).toBe(reason);
    expect(result.error).toBe(message);
    expect(result.error).not.toContain(workspace);
    expect(result.error).not.toContain('src/a.ts');
  });

  it('logs the reason only — never a path and never content', async () => {
    resolveForView.mockResolvedValue({
      kind: 'rejected',
      reason: 'outside-roots',
      lexicalPath: '/somewhere/secret.txt',
    });
    await build()({ path: '/somewhere/secret.txt' });

    expect(warn).toHaveBeenCalledWith('[file:viewContent] rejected', {
      reason: 'outside-roots',
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('secret.txt');
  });

  it('offers external open only when the external policy accepts the path', async () => {
    resolveForView.mockResolvedValue({
      kind: 'rejected',
      reason: 'outside-roots',
      lexicalPath: '/home/me/.claude/notes.md',
    });
    resolveForExternalOpen.mockResolvedValue({
      kind: 'file',
      lexicalPath: '/home/me/.claude/notes.md',
      realPath: '/home/me/.claude/notes.md',
      root: '/home/me',
      sizeBytes: 3,
    } as never);

    const result = (await build()({
      path: '/home/me/.claude/notes.md',
    })) as FailureResult;
    expect(result.externalOpenAllowed).toBe(true);
    expect(result.absolutePath).toBe('/home/me/.claude/notes.md');
  });

  /**
   * A symlink escape is reported WITHOUT a lexical path, so there is nothing
   * to offer and the external policy must not even be consulted.
   */
  it('never offers external open for a refusal carrying no lexical path', async () => {
    resolveForView.mockResolvedValue({
      kind: 'rejected',
      reason: 'outside-roots',
    });
    const result = (await build()({ path: 'escape.ts' })) as FailureResult;

    expect(result.externalOpenAllowed).toBe(false);
    expect(result).not.toHaveProperty('absolutePath');
    expect(resolveForExternalOpen).not.toHaveBeenCalled();
  });

  it('never rejects to the transport when the policy throws', async () => {
    resolveForView.mockRejectedValue(new Error('boom /secret/path'));
    const result = (await build()({ path: 'src/a.ts' })) as FailureResult;

    expect(result).toMatchObject({
      success: false,
      reason: 'unreadable',
      error: 'That file could not be read.',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/secret/path');
  });

  it('treats a directory as not-a-file', async () => {
    resolveForView.mockResolvedValue({
      kind: 'directory',
      lexicalPath: path.join(workspace, 'src'),
      realPath: path.join(workspace, 'src'),
      root: workspace,
    });
    const result = (await build()({ path: 'src' })) as FailureResult;
    expect(result.reason).toBe('not-a-file');
  });

  it('declares exactly one method', () => {
    expect(FileViewRpcHandlers.METHODS).toEqual(['file:viewContent']);
  });
});
