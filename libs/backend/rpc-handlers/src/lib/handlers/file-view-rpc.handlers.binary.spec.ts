import 'reflect-metadata';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FILE_VIEW_BINARY_IMAGE_MAX_BYTES,
  FILE_VIEW_BINARY_PDF_MAX_BYTES,
} from '@ptah-extension/shared';

import { FileLinkRootPolicy } from './file-link-root-policy';
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
  mime: string;
  kind: 'image' | 'pdf';
  sizeBytes: number;
  dataBase64: string;
}

function canCreateFileSymlink(): boolean {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'ptah-symlink-probe-'));
  try {
    const target = path.join(dir, 'target.txt');
    fsSync.writeFileSync(target, 'x', 'utf8');
    fsSync.symlinkSync(target, path.join(dir, 'link.txt'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    fsSync.rmSync(dir, { recursive: true, force: true });
  }
}

const itWithSymlink = canCreateFileSymlink() ? it : it.skip;

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const GIF = Buffer.from('GIF89a', 'ascii');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x0a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);
const BMP = Buffer.alloc(14);
BMP[0] = 0x42;
BMP[1] = 0x4d;
const PDF = Buffer.from('%PDF-1.7\n', 'ascii');

describe('FileViewRpcHandlers — file:viewBinary', () => {
  let base: string;
  let workspace: string;
  let outside: string;

  const warn = jest.fn();

  function handlers(folders: string[]): Map<string, RpcMethod> {
    const methods = new Map<string, RpcMethod>();
    new FileViewRpcHandlers(
      { warn } as never,
      {
        registerMethod: (name: string, handler: RpcMethod) =>
          methods.set(name, handler),
      } as never,
      new FileLinkRootPolicy(
        { getWorkspaceFolders: () => folders } as never,
        { getWorktrees: async () => [] } as never,
      ),
    ).register();
    return methods;
  }

  function viewBinary(folders: string[] = [workspace]): RpcMethod {
    const method = handlers(folders).get('file:viewBinary');
    if (!method) throw new Error('file:viewBinary was not registered');
    return method;
  }

  beforeAll(async () => {
    base = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-filebin-')),
    );
    workspace = path.join(base, 'ws');
    outside = path.join(base, 'outside-secret');
    await fs.mkdir(path.join(workspace, 'img'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(workspace, 'img', 'a.png'), PNG);
    await fs.writeFile(path.join(workspace, 'img', 'a.jpg'), JPEG);
    await fs.writeFile(path.join(workspace, 'img', 'a.gif'), GIF);
    await fs.writeFile(path.join(workspace, 'img', 'a.webp'), WEBP);
    await fs.writeFile(path.join(workspace, 'img', 'a.bmp'), BMP);
    await fs.writeFile(path.join(workspace, 'img', 'a.pdf'), PDF);
    await fs.writeFile(
      path.join(workspace, 'img', 'photo.png'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8'),
    );
    await fs.writeFile(path.join(workspace, 'notes.md'), PNG);
    await fs.writeFile(
      path.join(outside, 'secret.pdf'),
      PDF,
    );
  });

  afterAll(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  beforeEach(() => {
    warn.mockClear();
  });

  it.each([
    ['img/a.png', 'image/png', 'image', PNG],
    ['img/a.jpg', 'image/jpeg', 'image', JPEG],
    ['img/a.gif', 'image/gif', 'image', GIF],
    ['img/a.webp', 'image/webp', 'image', WEBP],
    ['img/a.bmp', 'image/bmp', 'image', BMP],
    ['img/a.pdf', 'application/pdf', 'pdf', PDF],
  ] as const)(
    'returns base64 for %s from magic bytes',
    async (relative, mime, kind, raw) => {
      const result = (await viewBinary()({
        path: relative,
        workspaceRoot: workspace,
      })) as SuccessResult;

      expect(result).toMatchObject({
        success: true,
        mime,
        kind,
        sizeBytes: raw.byteLength,
        workspaceRoot: workspace,
        relativePath: relative,
        dataBase64: raw.toString('base64'),
      });
      expect(result).not.toHaveProperty('realPath');
      expect(result.absolutePath).toBe(path.join(workspace, ...relative.split('/')));
    },
  );

  it('trusts the PNG signature of a file named notes.md', async () => {
    const result = (await viewBinary()({
      path: 'notes.md',
      workspaceRoot: workspace,
    })) as SuccessResult;
    expect(result.mime).toBe('image/png');
    expect(result.kind).toBe('image');
  });

  it('refuses SVG even when the extension is .png', async () => {
    const result = (await viewBinary()({
      path: 'img/photo.png',
      workspaceRoot: workspace,
    })) as FailureResult;
    expect(result).toMatchObject({
      success: false,
      reason: 'unsupported-type',
      error: 'This file type cannot be previewed.',
    });
    expect(result.error).not.toContain(workspace);
    expect(result.error).not.toContain('photo.png');
  });

  it('rejects a caller-supplied mime before any read', async () => {
    const result = (await viewBinary()({
      path: 'img/photo.png',
      workspaceRoot: workspace,
      mime: 'image/svg+xml',
    })) as FailureResult;
    expect(result.reason).toBe('invalid-request');
    expect(result.error).toBe('That file request was not valid.');
  });

  it('refuses a path that climbs out of the workspace, with a fixed error', async () => {
    const result = (await viewBinary()({
      path: '../outside-secret/secret.pdf',
      workspaceRoot: workspace,
    })) as FailureResult;
    expect(result.reason).toBe('outside-roots');
    expect(result.error).toBe(
      'This file is outside the workspaces open in Ptah.',
    );
    expect(result.error).not.toContain('outside-secret');
    expect(result.error).not.toContain('secret.pdf');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('outside-secret');
  });

  it('refuses a file URL and an https URL as an unsupported path form', async () => {
    for (const candidate of [
      'file:///C:/Windows/notepad.exe',
      'https://example.com/a.png',
    ]) {
      const result = (await viewBinary()({
        path: candidate,
        workspaceRoot: workspace,
      })) as FailureResult;
      expect(result.reason).toBe('unsupported-path');
      expect(result.error).toBe('That path form is not supported.');
      expect(result.error).not.toContain('example.com');
      expect(result.error).not.toContain('notepad');
    }
  });

  it('refuses a directory', async () => {
    const result = (await viewBinary()({
      path: 'img',
      workspaceRoot: workspace,
    })) as FailureResult;
    expect(result.reason).toBe('not-a-file');
    expect(result.error).toBe('That path is not a file.');
  });

  it('refuses a file over the PDF ceiling from stat, without echoing the path in the error', async () => {
    const huge = path.join(workspace, 'huge.pdf');
    const handle = await fs.open(huge, 'w');
    try {
      await handle.truncate(FILE_VIEW_BINARY_PDF_MAX_BYTES + 1);
    } finally {
      await handle.close();
    }

    const result = (await viewBinary()({
      path: 'huge.pdf',
      workspaceRoot: workspace,
    })) as FailureResult;
    expect(result).toMatchObject({
      success: false,
      reason: 'too-large',
      error: 'This file is too large to preview.',
      sizeBytes: FILE_VIEW_BINARY_PDF_MAX_BYTES + 1,
    });
    expect(result.error).not.toContain('huge.pdf');
    await fs.rm(huge, { force: true });
  });

  itWithSymlink(
    'refuses a symlink whose real target is outside the workspace and omits that target',
    async () => {
      const link = path.join(workspace, 'img', 'link.pdf');
      const target = path.join(outside, 'secret.pdf');
      await fs.symlink(target, link, 'file');

      const result = (await viewBinary()({
        path: 'img/link.pdf',
        workspaceRoot: workspace,
      })) as FailureResult;

      expect(result.reason).toBe('outside-roots');
      expect(result.error).toBe(
        'This file is outside the workspaces open in Ptah.',
      );
      expect(result).not.toHaveProperty('absolutePath');
      expect(result.externalOpenAllowed).toBe(false);
      const body = JSON.stringify(result);
      expect(body).not.toContain('outside-secret');
      expect(body).not.toContain(target);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('outside-secret');
      await fs.rm(link, { force: true });
    },
  );

  it('leaves file:viewContent refusing the same PNG as binary text', async () => {
    const method = handlers([workspace]).get('file:viewContent');
    if (!method) throw new Error('file:viewContent was not registered');
    const result = (await method({
      path: 'img/a.png',
      workspaceRoot: workspace,
    })) as FailureResult;
    expect(result.reason).toBe('binary');
    expect(result.error).toBe('This file is binary and cannot be previewed.');
    expect(result).not.toHaveProperty('dataBase64');
  });
});

describe('FileViewRpcHandlers — file:viewBinary image ceiling', () => {
  let workspace: string;
  let pngPath: string;

  const resolveForView = jest.fn();
  const resolveForExternalOpen = jest.fn(async () => ({
    kind: 'rejected' as const,
    reason: 'outside-roots' as const,
  }));

  function viewBinary(): RpcMethod {
    const methods = new Map<string, RpcMethod>();
    new FileViewRpcHandlers(
      { warn: jest.fn() } as never,
      {
        registerMethod: (name: string, handler: RpcMethod) =>
          methods.set(name, handler),
      } as never,
      { resolveForView, resolveForExternalOpen } as never,
    ).register();
    const method = methods.get('file:viewBinary');
    if (!method) throw new Error('file:viewBinary was not registered');
    return method;
  }

  beforeAll(async () => {
    workspace = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-filebin-cap-')),
    );
    pngPath = path.join(workspace, 'small.png');
    await fs.writeFile(pngPath, PNG);
  });

  afterAll(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('asks the policy for the 25 MiB PDF ceiling', async () => {
    resolveForView.mockResolvedValue({ kind: 'rejected', reason: 'not-found' });
    await viewBinary()({ path: 'small.png', workspaceRoot: workspace });
    expect(resolveForView).toHaveBeenCalledWith(
      { path: 'small.png', workspaceRoot: workspace },
      { maxBytes: FILE_VIEW_BINARY_PDF_MAX_BYTES },
    );
  });

  it('refuses an image whose stat size is over 15 MiB without returning bytes', async () => {
    resolveForView.mockResolvedValue({
      kind: 'file',
      lexicalPath: pngPath,
      realPath: pngPath,
      root: workspace,
      sizeBytes: FILE_VIEW_BINARY_IMAGE_MAX_BYTES + 1,
    });
    const result = (await viewBinary()({ path: 'small.png' })) as FailureResult;
    expect(result).toMatchObject({
      success: false,
      reason: 'too-large',
      error: 'This file is too large to preview.',
      sizeBytes: FILE_VIEW_BINARY_IMAGE_MAX_BYTES + 1,
    });
    expect(result).not.toHaveProperty('dataBase64');
    expect(result.absolutePath).toBe(pngPath);
  });

  it('does not disclose a realpath the policy withheld', async () => {
    resolveForView.mockResolvedValue({
      kind: 'rejected',
      reason: 'outside-roots',
    });
    const result = (await viewBinary()({
      path: 'escape.png',
    })) as FailureResult;
    expect(result).not.toHaveProperty('absolutePath');
    expect(result.externalOpenAllowed).toBe(false);
    expect(resolveForExternalOpen).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('realpath');
  });
});
