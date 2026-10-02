import 'reflect-metadata';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Filesystem seams. The handler and the policy both `import * as fs from
 * 'node:fs/promises'`, so one module factory reaches every call. Everything
 * delegates to the real module unless a test sets an override, so the temp
 * trees below behave normally.
 *
 *  - `mockRealpathOverrides` simulates a symlink escape on hosts that may not
 *    create a real symlink (unprivileged Windows).
 *  - `mockRename` makes the final rename fail, to prove atomicity.
 */
const mockRealpathOverrides = new Map<string, string>();
let mockRename: ((from: string, to: string) => Promise<void>) | undefined;
jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises');
  return {
    ...actual,
    realpath: async (target: unknown, ...rest: unknown[]) =>
      mockRealpathOverrides.get(String(target)) ??
      (await actual.realpath(target, ...rest)),
    rename: async (from: string, to: string) =>
      mockRename ? mockRename(from, to) : actual.rename(from, to),
  };
});

import * as fs from 'node:fs/promises';
import { FILE_VIEW_MAX_BYTES } from '@ptah-extension/shared';

import { FileEditRpcHandlers } from './file-edit-rpc.handlers';
import { FileLinkRootPolicy } from './file-link-root-policy';

type RpcMethod = (params?: unknown) => Promise<unknown>;

type SaveResult =
  | { success: true; sha256: string }
  | { success: false; reason: string; error: string };

const sha256Of = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** See `file-link-root-policy.spec.ts`: real-symlink cases skip visibly. */
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

describe('FileEditRpcHandlers — file:saveContent', () => {
  let base: string;
  let workspace: string;
  let outside: string;

  const warn = jest.fn();
  const gitInfo = { getWorktrees: jest.fn(async () => []) };

  function build(
    policy: unknown = new FileLinkRootPolicy(
      { getWorkspaceFolders: () => [workspace] } as never,
      gitInfo as never,
    ),
  ): RpcMethod {
    const methods = new Map<string, RpcMethod>();
    new FileEditRpcHandlers(
      { warn } as never,
      {
        registerMethod: (name: string, handler: RpcMethod) =>
          methods.set(name, handler),
      } as never,
      policy as never,
    ).register();
    const method = methods.get('file:saveContent');
    if (!method) throw new Error('file:saveContent was not registered');
    return method;
  }

  /** Write `bytes` into the workspace and return its path and hash. */
  async function seed(relative: string, bytes: Buffer | string) {
    const absolute = path.join(workspace, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, bytes);
    return { absolute, sha256: sha256Of(bytes) };
  }

  async function save(params: Record<string, unknown>): Promise<SaveResult> {
    return (await build()(params)) as SaveResult;
  }

  async function strayTemps(): Promise<string[]> {
    const entries = await fs.readdir(workspace, { recursive: true });
    return entries.filter((entry) => String(entry).endsWith('.ptah-save'));
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRealpathOverrides.clear();
    mockRename = undefined;
    base = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-fileedit-')),
    );
    workspace = path.join(base, 'ws');
    outside = path.join(base, 'outside');
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it('writes the new content and returns the hash of the bytes on disk', async () => {
    const { absolute, sha256 } = await seed('src/a.ts', 'old');
    const result = await save({
      path: 'src/a.ts',
      workspaceRoot: workspace,
      content: 'new text',
      expectedSha256: sha256,
    });

    expect(result).toEqual({ success: true, sha256: sha256Of('new text') });
    expect(await fs.readFile(absolute, 'utf8')).toBe('new text');
    expect(await strayTemps()).toEqual([]);
  });

  it('re-adds a UTF-8 BOM and round-trips CRLF byte-for-byte', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const { absolute, sha256 } = await seed(
      'bom.txt',
      Buffer.concat([bom, Buffer.from('a\r\nb\r\n', 'utf8')]),
    );

    const result = await save({
      path: absolute,
      content: 'a\r\nc\r\n',
      expectedSha256: sha256,
    });

    const expected = Buffer.concat([bom, Buffer.from('a\r\nc\r\n', 'utf8')]);
    expect(await fs.readFile(absolute)).toEqual(expected);
    // The hash is of the raw bytes, BOM included — what the next read reports.
    expect(result).toEqual({ success: true, sha256: sha256Of(expected) });
  });

  describe('BOM round-trip contract', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);

    /**
     * The text `file:viewContent` hands the editor: exactly one leading BOM is
     * sliced off, and the rest is decoded with `ignoreBOM: true`, so any
     * further U+FEFF survives as content.
     */
    function viewerContent(bytes: Buffer): string {
      const body = bytes.subarray(0, 3).equals(bom) ? bytes.subarray(3) : bytes;
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        body,
      );
    }

    it('saves an unchanged BOM file byte-identical', async () => {
      const original = Buffer.concat([bom, Buffer.from('a\r\nb\n', 'utf8')]);
      const { absolute, sha256 } = await seed('bom-same.txt', original);

      const result = await save({
        path: absolute,
        content: viewerContent(original),
        expectedSha256: sha256,
      });

      expect(result).toEqual({ success: true, sha256 });
      expect(sha256Of(await fs.readFile(absolute))).toBe(sha256);
    });

    it('keeps a second BOM that the viewer reported as content', async () => {
      // A file that genuinely starts with two BOMs: the viewer shows the
      // second as a leading U+FEFF, and saving it back must not drop it.
      const original = Buffer.concat([bom, bom, Buffer.from('x', 'utf8')]);
      const { absolute, sha256 } = await seed('bom-twice.txt', original);
      const content = viewerContent(original);
      expect(content).toBe('﻿x');

      const result = await save({
        path: absolute,
        content,
        expectedSha256: sha256,
      });

      expect(result).toEqual({ success: true, sha256 });
      expect(await fs.readFile(absolute)).toEqual(original);
    });

    it('writes a leading U+FEFF typed into a BOM file after the file BOM', async () => {
      const { absolute, sha256 } = await seed(
        'bom-typed.txt',
        Buffer.concat([bom, Buffer.from('x', 'utf8')]),
      );

      await save({ path: absolute, content: '﻿y', expectedSha256: sha256 });

      const written = await fs.readFile(absolute);
      expect(written).toEqual(
        Buffer.concat([bom, bom, Buffer.from('y', 'utf8')]),
      );
      // The next read shows the editor exactly what it saved.
      expect(viewerContent(written)).toBe('﻿y');
    });

    it('writes a leading U+FEFF into a no-BOM file as its UTF-8 bytes', async () => {
      const { absolute, sha256 } = await seed('plain-feff.txt', 'x');

      const result = await save({
        path: absolute,
        content: '﻿y',
        expectedSha256: sha256,
      });

      // No BOM is added on top: the bytes are exactly utf8(content).
      const expected = Buffer.from('﻿y', 'utf8');
      expect(expected.subarray(0, 3)).toEqual(bom);
      expect(await fs.readFile(absolute)).toEqual(expected);
      expect(result).toEqual({ success: true, sha256: sha256Of(expected) });
    });
  });

  it('does not add a BOM to a file that had none', async () => {
    const { absolute, sha256 } = await seed('plain.txt', 'x');
    await save({ path: absolute, content: 'y', expectedSha256: sha256 });
    expect(await fs.readFile(absolute)).toEqual(Buffer.from('y', 'utf8'));
  });

  it('refuses a stale expectedSha256 as a conflict and leaves the file alone', async () => {
    const { absolute } = await seed('a.txt', 'disk changed');
    const result = await save({
      path: absolute,
      content: 'mine',
      expectedSha256: sha256Of('what I opened'),
    });

    expect(result).toEqual({
      success: false,
      reason: 'conflict',
      error: 'This file changed on disk since it was opened.',
    });
    expect(await fs.readFile(absolute, 'utf8')).toBe('disk changed');
  });

  it('writes over a changed file when overwrite is set', async () => {
    const { absolute } = await seed('a.txt', 'disk changed');
    const result = await save({
      path: absolute,
      content: 'mine',
      expectedSha256: sha256Of('what I opened'),
      overwrite: true,
    });

    expect(result).toEqual({ success: true, sha256: sha256Of('mine') });
    expect(await fs.readFile(absolute, 'utf8')).toBe('mine');
  });

  it('keeps the original when the rename fails, and removes the temp file', async () => {
    const { absolute, sha256 } = await seed('a.txt', 'original');
    mockRename = async () => {
      throw Object.assign(new Error('EPERM: secret detail C:\\x'), {
        code: 'EPERM',
      });
    };

    const result = await save({
      path: absolute,
      content: 'replacement',
      expectedSha256: sha256,
    });

    expect(result).toEqual({
      success: false,
      reason: 'unwritable',
      error: 'That file could not be saved.',
    });
    expect(await fs.readFile(absolute, 'utf8')).toBe('original');
    expect(await strayTemps()).toEqual([]);
    // Nothing from the filesystem error reaches the log.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(absolute);
  });

  it('refuses a path outside the open workspaces', async () => {
    const target = path.join(outside, 'x.txt');
    await fs.writeFile(target, 'keep');
    const result = await save({
      path: target,
      content: 'pwned',
      expectedSha256: sha256Of('keep'),
    });

    expect(result).toMatchObject({ success: false, reason: 'outside-roots' });
    expect(await fs.readFile(target, 'utf8')).toBe('keep');
  });

  it('refuses a relative path that climbs out of the workspace', async () => {
    const target = path.join(outside, 'x.txt');
    await fs.writeFile(target, 'keep');
    const result = await save({
      path: '../outside/x.txt',
      workspaceRoot: workspace,
      content: 'pwned',
      expectedSha256: sha256Of('keep'),
    });

    expect(result.success).toBe(false);
    expect(await fs.readFile(target, 'utf8')).toBe('keep');
  });

  it('refuses a workspaceRoot that is not open', async () => {
    const result = await save({
      path: 'x.txt',
      workspaceRoot: outside,
      content: 'pwned',
      expectedSha256: sha256Of(''),
    });
    expect(result).toMatchObject({ success: false, reason: 'outside-roots' });
  });

  it('refuses a path whose realpath escapes the workspace (simulated symlink)', async () => {
    const target = path.join(outside, 'secret.txt');
    await fs.writeFile(target, 'keep');
    const { absolute } = await seed('link.txt', 'decoy');
    mockRealpathOverrides.set(absolute, target);

    const result = await save({
      path: absolute,
      content: 'pwned',
      expectedSha256: sha256Of('keep'),
      overwrite: true,
    });

    expect(result).toMatchObject({ success: false, reason: 'outside-roots' });
    expect(await fs.readFile(target, 'utf8')).toBe('keep');
  });

  itWithSymlink(
    'refuses a real symlink inside the workspace that points outside it',
    async () => {
      const target = path.join(outside, 'secret.txt');
      await fs.writeFile(target, 'keep');
      const link = path.join(workspace, 'link.txt');
      await fs.symlink(target, link, 'file');

      const result = await save({
        path: link,
        content: 'pwned',
        expectedSha256: sha256Of('keep'),
        overwrite: true,
      });

      expect(result).toMatchObject({ success: false, reason: 'outside-roots' });
      expect(await fs.readFile(target, 'utf8')).toBe('keep');
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    },
  );

  itWithSymlink(
    'writes through a symlink that stays inside the workspace and keeps the link',
    async () => {
      const { absolute: real, sha256 } = await seed('real.txt', 'old');
      const link = path.join(workspace, 'alias.txt');
      await fs.symlink(real, link, 'file');

      const result = await save({
        path: link,
        content: 'new',
        expectedSha256: sha256,
      });

      expect(result).toEqual({ success: true, sha256: sha256Of('new') });
      expect(await fs.readFile(real, 'utf8')).toBe('new');
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    },
  );

  it('refuses to create a missing file', async () => {
    const result = await save({
      path: path.join(workspace, 'new.txt'),
      content: 'x',
      expectedSha256: sha256Of(''),
      overwrite: true,
    });

    expect(result).toEqual({
      success: false,
      reason: 'not-found',
      error: 'That file no longer exists.',
    });
    await expect(fs.stat(path.join(workspace, 'new.txt'))).rejects.toThrow();
  });

  it('refuses a directory', async () => {
    await fs.mkdir(path.join(workspace, 'dir'));
    const result = await save({
      path: path.join(workspace, 'dir'),
      content: 'x',
      expectedSha256: sha256Of(''),
    });
    expect(result).toMatchObject({ success: false, reason: 'not-a-file' });
  });

  it('refuses content over the size cap without touching the file', async () => {
    const { absolute, sha256 } = await seed('a.txt', 'keep');
    const result = await save({
      path: absolute,
      content: 'x'.repeat(FILE_VIEW_MAX_BYTES + 1),
      expectedSha256: sha256,
    });

    expect(result).toMatchObject({ success: false, reason: 'too-large' });
    expect(await fs.readFile(absolute, 'utf8')).toBe('keep');
  });

  it('refuses content whose UTF-8 encoding (plus BOM) exceeds the cap', async () => {
    const { absolute, sha256 } = await seed(
      'a.txt',
      Buffer.from([0xef, 0xbb, 0xbf, 0x41]),
    );
    // Exactly at the cap in bytes, so only the re-added BOM pushes it over.
    const result = await save({
      path: absolute,
      content: 'x'.repeat(FILE_VIEW_MAX_BYTES),
      expectedSha256: sha256,
    });
    expect(result).toMatchObject({ success: false, reason: 'too-large' });
  });

  it.each([
    [
      'UTF-16LE',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi', 'utf16le')]),
    ],
    ['UTF-16BE', Buffer.from([0xfe, 0xff, 0x00, 0x68])],
    ['binary', Buffer.from([0x41, 0x00, 0x42])],
    ['invalid UTF-8', Buffer.from([0x41, 0xc3, 0x28])],
  ])('refuses to overwrite a %s file', async (_label, bytes) => {
    const { absolute, sha256 } = await seed('f.dat', bytes);
    const result = await save({
      path: absolute,
      content: 'text',
      expectedSha256: sha256,
    });

    expect(result).toEqual({
      success: false,
      reason: 'unwritable',
      error: 'That file could not be saved.',
    });
    expect(await fs.readFile(absolute)).toEqual(bytes);
  });

  it.each([
    ['a missing path', { content: 'x', expectedSha256: sha256Of('') }],
    ['a non-hex hash', { path: 'a', content: 'x', expectedSha256: 'nope' }],
    [
      'an uppercase hash',
      { path: 'a', content: 'x', expectedSha256: sha256Of('').toUpperCase() },
    ],
    [
      'an unknown key',
      {
        path: 'a',
        content: 'x',
        expectedSha256: sha256Of(''),
        documentPath: '/x',
      },
    ],
    [
      'non-string content',
      { path: 'a', content: 1, expectedSha256: sha256Of('') },
    ],
  ])('refuses %s as invalid-request', async (_label, params) => {
    const result = await save(params);
    expect(result).toEqual({
      success: false,
      reason: 'invalid-request',
      error: 'That save request was not valid.',
    });
  });

  it.each([
    ['unsupported-path', 'invalid-request'],
    ['no-base-root', 'invalid-request'],
    ['root-not-open', 'outside-roots'],
    ['unreadable', 'unwritable'],
    ['too-large', 'too-large'],
  ])(
    'maps the read-path refusal %s onto %s',
    async (viewReason, saveReason) => {
      const policy = {
        resolveForView: jest.fn(async () => ({
          kind: 'rejected',
          reason: viewReason,
          lexicalPath: '/leak/me',
        })),
      };
      const result = (await build(policy)({
        path: 'a',
        content: 'x',
        expectedSha256: sha256Of(''),
      })) as SaveResult;

      expect(result).toMatchObject({ success: false, reason: saveReason });
      // A refusal never echoes a path back.
      expect(JSON.stringify(result)).not.toContain('/leak/me');
    },
  );

  it('turns a throwing policy into a refusal instead of a transport rejection', async () => {
    const policy = {
      resolveForView: jest.fn(async () => {
        throw new Error('boom /private/path');
      }),
    };
    const result = (await build(policy)({
      path: 'a',
      content: 'x',
      expectedSha256: sha256Of(''),
    })) as SaveResult;

    expect(result).toMatchObject({ success: false, reason: 'unwritable' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/private/path');
  });
});
