/**
 * Upsert semantics, the E8 concurrent-edit guard, and the FILE_EXISTS half of
 * §5.6 that `output-style-slug.ts` deliberately does not decide (it needs the
 * filesystem, so it lives here).
 */
import * as path from 'path';
import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { OutputStyleFileWriter } from './output-style-file.writer';
import { parseOutputStyleFile } from './output-style-frontmatter';

const WORKSPACE_ROOT = path.join('d:', 'tmp', 'ws-style-writer');
const FAKE_HOME = path.join('d:', 'tmp', 'home-style-writer');

function projectFile(fileName: string): string {
  return path.join(WORKSPACE_ROOT, '.claude', 'output-styles', fileName);
}

function userFile(fileName: string): string {
  return path.join(FAKE_HOME, '.claude', 'output-styles', fileName);
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(root: string | undefined): IWorkspaceProvider {
  return {
    getWorkspaceRoot: jest.fn(() => root),
    getWorkspaceFolders: jest.fn(() => (root === undefined ? [] : [root])),
  } as unknown as IWorkspaceProvider;
}

function styleFile(name: string, body = `Body of ${name}.`): string {
  return `---\nname: ${name}\ndescription: The ${name} style.\n---\n\n${body}\n`;
}

describe('OutputStyleFileWriter', () => {
  const originalHome = process.env['HOME'];
  const originalUserProfile = process.env['USERPROFILE'];

  beforeEach(() => {
    process.env['HOME'] = FAKE_HOME;
    process.env['USERPROFILE'] = FAKE_HOME;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
    if (originalUserProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = originalUserProfile;
  });

  /**
   * `root` is `string | null` rather than `string | undefined` on purpose:
   * passing `undefined` to an optional parameter re-applies its default, so a
   * "no workspace" test would silently get one. `null` means "no folder open".
   */
  function makeWriter(
    fs: MockFileSystemProvider = createMockFileSystemProvider(),
    root: string | null = WORKSPACE_ROOT,
  ): { writer: OutputStyleFileWriter; fs: MockFileSystemProvider } {
    return {
      writer: new OutputStyleFileWriter(
        fs,
        makeWorkspace(root ?? undefined),
        makeLogger(),
      ),
      fs,
    };
  }

  describe('create', () => {
    it('writes a slugged file and reports a display path', async () => {
      const { writer, fs } = makeWriter();

      const result = await writer.save({
        tier: 'project',
        name: 'Simplified Technical English',
        description: 'Short sentences.',
        keepCodingInstructions: true,
        body: '# Rules\n\nUse short sentences.',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.location.fileName).toBe('simplified-technical-english.md');
      expect(result.location.displayPath).toBe(
        '.claude/output-styles/simplified-technical-english.md',
      );
      expect(result.renamedFrom).toBeUndefined();

      const written = await fs.readFile(
        projectFile('simplified-technical-english.md'),
      );
      const parsed = parseOutputStyleFile(
        written,
        'simplified-technical-english.md',
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.style.name).toBe('Simplified Technical English');
      expect(parsed.style.keepCodingInstructions).toBe(true);
    });

    it('preserves the body verbatim (Req 4.3)', async () => {
      const { writer, fs } = makeWriter();
      const body = 'Line one.\n\n  indented\n\n- bullet';

      await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'Terse.',
        keepCodingInstructions: false,
        body,
      });

      const written = await fs.readFile(projectFile('terse.md'));
      expect(written.endsWith(`${body}\n`)).toBe(true);
    });

    it('writes the user tier under the home directory', async () => {
      const { writer, fs } = makeWriter();

      const result = await writer.save({
        tier: 'user',
        name: 'Terse',
        description: 'Terse.',
        keepCodingInstructions: false,
        body: 'Short.',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.location.displayPath).toBe(
        '~/.claude/output-styles/terse.md',
      );
      expect(fs.__state.files.has(userFile('terse.md'))).toBe(true);
    });
  });

  describe('name safety (Req 3.4, Req 3.5)', () => {
    it.each([
      ['blank', '   '],
      ['a path separator', '../escape'],
      ['a windows device name', 'CON'],
      ['punctuation only', '!!!'],
    ])('rejects %s without touching the filesystem', async (_label, name) => {
      const { writer, fs } = makeWriter();

      const result = await writer.save({
        tier: 'project',
        name,
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_NAME');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('collision (Req 3.4 → FILE_EXISTS)', () => {
    it('refuses to clobber an unrelated file with the same basename', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('terse.md'), styleFile('Something Else'));
      fs.writeFile.mockClear();

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('FILE_EXISTS');
      expect(result.error.path).toBe('.claude/output-styles/terse.md');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('writes over it when overwrite is explicit', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('terse.md'), styleFile('Something Else'));

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'replaced',
        overwrite: true,
      });

      expect(result.ok).toBe(true);
      const written = await fs.readFile(projectFile('terse.md'));
      expect(written).toContain('name: Terse');
      expect(written).toContain('replaced');
    });

    it('does not treat the file being edited as a collision', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'Updated.',
        keepCodingInstructions: false,
        body: 'updated body',
        originalName: 'Terse',
      });

      expect(result.ok).toBe(true);
      const written = await fs.readFile(projectFile('terse.md'));
      expect(written).toContain('updated body');
    });
  });

  describe('edit (upsert, Req 4.4)', () => {
    it('locates the file by frontmatter name, not by filename (E1)', async () => {
      const { writer, fs } = makeWriter();
      // Filename and `name` deliberately unrelated.
      await fs.writeFile(projectFile('legacy.md'), styleFile('House Style'));

      const result = await writer.save({
        tier: 'project',
        name: 'House Style',
        description: 'Updated.',
        keepCodingInstructions: true,
        body: 'new body',
        originalName: 'House Style',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.location.fileName).toBe('legacy.md');
      expect(await fs.readFile(projectFile('legacy.md'))).toContain('new body');
      expect(fs.__state.files.has(projectFile('house-style.md'))).toBe(false);
    });

    it('renames: writes the new file, removes the old one, reports renamedFrom', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await writer.save({
        tier: 'project',
        name: 'Very Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
        originalName: 'Terse',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.renamedFrom).toBe('Terse');
      expect(result.location.fileName).toBe('very-terse.md');
      expect(fs.__state.files.has(projectFile('very-terse.md'))).toBe(true);
      expect(fs.__state.files.has(projectFile('terse.md'))).toBe(false);
    });

    it('reports NOT_FOUND when the edited style no longer exists', async () => {
      const { writer, fs } = makeWriter();

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
        originalName: 'Gone',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('E8 concurrent-edit guard', () => {
    it('aborts with STALE_FILE when the byte length moved', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      fs.writeFile.mockClear();

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
        originalName: 'Terse',
        expectedByteLength: 1,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('STALE_FILE');
      expect(result.error.path).toBe('.claude/output-styles/terse.md');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('aborts with STALE_FILE when mtime moved and the adapter supplies one', async () => {
      const fs = createMockFileSystemProvider();
      const { writer } = makeWriter(fs);
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      const bytes = fs.__state.files.get(projectFile('terse.md'));
      fs.stat.mockResolvedValue({
        type: 1,
        ctime: 0,
        mtime: 5_000,
        size: bytes?.byteLength ?? 0,
      });
      fs.writeFile.mockClear();

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
        originalName: 'Terse',
        expectedMtime: 4_000,
        expectedByteLength: bytes?.byteLength,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('STALE_FILE');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('ignores an mtime of 0, which means the adapter has no signal', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      const bytes = fs.__state.files.get(projectFile('terse.md'));

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
        originalName: 'Terse',
        expectedMtime: 12_345,
        expectedByteLength: bytes?.byteLength,
      });

      expect(result.ok).toBe(true);
    });

    it('does not check anything when neither stamp was supplied', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      fs.stat.mockClear();

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
        originalName: 'Terse',
      });

      expect(result.ok).toBe(true);
      expect(fs.stat).not.toHaveBeenCalled();
    });

    it('stat() captures the stamp a later save echoes back', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      const bytes = fs.__state.files.get(projectFile('terse.md'));

      const stamped = await writer.stat({ tier: 'project', name: 'Terse' });

      expect(stamped.ok).toBe(true);
      if (!stamped.ok) return;
      expect(stamped.stamp.byteLength).toBe(bytes?.byteLength);
      expect(stamped.location.fileName).toBe('terse.md');

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
        originalName: 'Terse',
        expectedMtime: stamped.stamp.mtime,
        expectedByteLength: stamped.stamp.byteLength,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('delete (Req 4.5)', () => {
    it('removes the file the name resolves to', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('legacy.md'), styleFile('House Style'));

      const result = await writer.delete({
        tier: 'project',
        name: 'House Style',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.location.fileName).toBe('legacy.md');
      expect(fs.__state.files.has(projectFile('legacy.md'))).toBe(false);
    });

    it('reports NOT_FOUND for an unknown name', async () => {
      const { writer } = makeWriter();

      const result = await writer.delete({ tier: 'project', name: 'Nope' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NOT_FOUND');
    });
  });

  describe('no workspace open', () => {
    it('reports NO_WORKSPACE for the project tier', async () => {
      const { writer, fs } = makeWriter(createMockFileSystemProvider(), null);

      const result = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('NO_WORKSPACE');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('still writes the user tier', async () => {
      const { writer } = makeWriter(createMockFileSystemProvider(), null);

      const result = await writer.save({
        tier: 'user',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('Req 7.6 — no absolute host path in a surfaced message', () => {
    it('holds for the failure modes that name a file', async () => {
      const { writer, fs } = makeWriter();
      await fs.writeFile(projectFile('terse.md'), styleFile('Other'));

      const collision = await writer.save({
        tier: 'project',
        name: 'Terse',
        description: 'x',
        keepCodingInstructions: false,
        body: 'x',
      });

      expect(collision.ok).toBe(false);
      if (collision.ok) return;
      expect(collision.error.message).not.toContain(WORKSPACE_ROOT);
      expect(collision.error.message).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(collision.error.path).not.toMatch(/[A-Za-z]:[\\/]/);
    });
  });
});
