import * as path from 'path';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  STE_FILE_NAME,
  STE_FIXTURE,
  UNRECOGNIZED_KEY_FIXTURE,
} from './__fixtures__/output-style.fixtures';
import { BUILT_IN_OUTPUT_STYLES } from './built-in-output-styles';
import {
  OUTPUT_STYLES_DIR_SEGMENTS,
  OutputStyleDiscoveryService,
} from './output-style-discovery.service';

const WORKSPACE_ROOT = path.join('d:', 'tmp', 'ws-output-styles');
const FAKE_HOME = path.join('d:', 'tmp', 'home-output-styles');

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

function userFile(name: string): string {
  return path.join(FAKE_HOME, ...OUTPUT_STYLES_DIR_SEGMENTS, name);
}

function projectFile(name: string): string {
  return path.join(WORKSPACE_ROOT, ...OUTPUT_STYLES_DIR_SEGMENTS, name);
}

function styleFile(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: The ${name} style.\n---\n\nBody of ${name}.${extra}\n`;
}

describe('OutputStyleDiscoveryService', () => {
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
   * `root` is `string | null`, NOT `string | undefined`.
   *
   * A default parameter is re-applied when the argument is `undefined`, so a
   * `string | undefined` signature makes `makeService(fs, undefined)` silently
   * hand back the default workspace root — and the "no workspace open" case
   * below would have passed while testing the exact opposite of its name.
   * `null` is the only way to say "explicitly absent" through a defaulted
   * parameter; it is mapped to `undefined` at the boundary because that is what
   * `getWorkspaceRoot()` actually returns.
   */
  function makeService(
    fs = createMockFileSystemProvider(),
    root: string | null = WORKSPACE_ROOT,
  ): { service: OutputStyleDiscoveryService; fs: typeof fs } {
    return {
      service: new OutputStyleDiscoveryService(
        fs,
        makeWorkspace(root ?? undefined),
        makeLogger(),
      ),
      fs,
    };
  }

  describe('missing directories (Req 1.5)', () => {
    it('resolves with the four built-ins and does not throw', async () => {
      const { service } = makeService();

      const result = await service.discover();

      expect(result.styles).toHaveLength(BUILT_IN_OUTPUT_STYLES.length);
      expect(result.styles.map((s) => s.name)).toEqual([
        'default',
        'Explanatory',
        'Learning',
        'Proactive',
      ]);
      expect(result.invalid).toEqual([]);
      expect(result.active).toEqual({ name: null, tier: null, missing: false });
    });

    it('tolerates having no workspace open', async () => {
      const { service, fs } = makeService(createMockFileSystemProvider(), null);
      // Seeded so this case can actually FAIL. If the project root leaked back
      // in — which is exactly what the old `string | undefined` signature did —
      // this file would be discovered and both assertions below would break.
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await service.discover();

      expect(result.styles).toHaveLength(BUILT_IN_OUTPUT_STYLES.length);
      expect(result.styles.every((s) => s.tier === 'builtin')).toBe(true);
    });

    it('lists one tier when only that tier exists', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await service.discover();

      expect(result.styles).toHaveLength(BUILT_IN_OUTPUT_STYLES.length + 1);
      const terse = result.styles.find((s) => s.name === 'Terse');
      expect(terse?.tier).toBe('project');
      expect(terse?.relativePath).toBe('.claude/output-styles/terse.md');
    });
  });

  describe('entry shape', () => {
    it('keys on the frontmatter name, not the filename (E1)', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(projectFile(STE_FILE_NAME), STE_FIXTURE);

      const result = await service.discover();

      expect(
        result.styles.some((s) => s.name === 'Simplified Technical English'),
      ).toBe(true);
      expect(result.styles.some((s) => s.name === STE_FILE_NAME)).toBe(false);
    });

    it('marks file styles editable and built-ins immutable (Req 4.2)', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(userFile('terse.md'), styleFile('Terse'));

      const result = await service.discover();

      const terse = result.styles.find((s) => s.name === 'Terse');
      expect(terse).toMatchObject({
        tier: 'user',
        editable: true,
        deletable: true,
        fileName: 'terse.md',
        relativePath: '~/.claude/output-styles/terse.md',
      });
      expect(terse?.immutableReason).toBeUndefined();

      const builtIn = result.styles.find((s) => s.name === 'Explanatory');
      expect(builtIn).toMatchObject({
        editable: false,
        deletable: false,
        immutableReason: 'built-in',
      });
      expect(builtIn?.body).toBeUndefined();
    });

    it('never surfaces an absolute host path (Req 7.6)', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(userFile('terse.md'), styleFile('Terse'));
      await fs.writeFile(projectFile('bad.md'), UNRECOGNIZED_KEY_FIXTURE);

      const result = await service.discover();

      const paths = [
        ...result.styles.map((s) => s.relativePath ?? ''),
        ...result.invalid.map((i) => i.relativePath),
        ...result.invalid.map((i) => i.error.message),
      ];
      for (const value of paths) {
        expect(value).not.toMatch(/[A-Za-z]:[\\/]/);
        expect(value).not.toContain(FAKE_HOME);
        expect(value).not.toContain(WORKSPACE_ROOT);
      }
    });

    it('ignores non-markdown files and directories', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      await fs.writeFile(projectFile('notes.txt'), 'not a style');
      await fs.writeFile(projectFile('README'), 'not a style either');
      await fs.createDirectory(projectFile('nested'));

      const result = await service.discover();

      expect(result.styles.filter((s) => s.tier === 'project')).toHaveLength(1);
      expect(result.invalid).toEqual([]);
    });
  });

  describe('invalid files are listed, not omitted (Req 7.1)', () => {
    it('lists a file whose frontmatter carries a fifth key', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(projectFile('themed.md'), UNRECOGNIZED_KEY_FIXTURE);

      const result = await service.discover();

      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0]).toMatchObject({
        fileName: 'themed.md',
        relativePath: '.claude/output-styles/themed.md',
        tier: 'project',
        openable: true,
      });
      expect(result.invalid[0].error.code).toBe('UNRECOGNIZED_KEY');
      expect(result.styles.some((s) => s.fileName === 'themed.md')).toBe(false);
    });

    it('lists an unreadable file as READ_FAILED and keeps scanning', async () => {
      const fs = createMockFileSystemProvider();
      await fs.writeFile(projectFile('broken.md'), styleFile('Broken'));
      await fs.writeFile(projectFile('good.md'), styleFile('Good'));
      const realReadFile = fs.readFile.getMockImplementation();
      fs.readFile.mockImplementation(async (target: string) => {
        if (target.endsWith('broken.md')) throw new Error('EACCES');
        return realReadFile
          ? realReadFile(target)
          : Promise.reject(new Error('no impl'));
      });

      const { service } = makeService(fs);
      const result = await service.discover();

      expect(result.invalid).toHaveLength(1);
      expect(result.invalid[0].error.code).toBe('READ_FAILED');
      expect(result.invalid[0].error.message).not.toContain('EACCES');
      expect(result.styles.some((s) => s.name === 'Good')).toBe(true);
    });
  });

  describe('merge order and collisions (E4)', () => {
    it('lets project beat user and flags the loser', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(userFile('shared.md'), styleFile('Shared', ' (user)'));
      await fs.writeFile(
        projectFile('shared.md'),
        styleFile('Shared', ' (project)'),
      );

      const result = await service.discover();

      const shared = result.styles.filter((s) => s.name === 'Shared');
      expect(shared).toHaveLength(2);
      const user = shared.find((s) => s.tier === 'user');
      const project = shared.find((s) => s.tier === 'project');
      expect(user?.shadowed).toBe(true);
      expect(project?.shadowed).toBe(false);
    });

    it('lets any file style shadow a same-named built-in', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(userFile('learning.md'), styleFile('Learning'));

      const result = await service.discover();

      const learning = result.styles.filter((s) => s.name === 'Learning');
      expect(learning).toHaveLength(2);
      expect(learning.find((s) => s.tier === 'builtin')?.shadowed).toBe(true);
      expect(learning.find((s) => s.tier === 'user')?.shadowed).toBe(false);
    });

    it('leaves every unique name unshadowed', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(userFile('terse.md'), styleFile('Terse'));
      await fs.writeFile(projectFile('verbose.md'), styleFile('Verbose'));

      const result = await service.discover();

      expect(result.styles.some((s) => s.shadowed)).toBe(false);
    });
  });

  describe('active selection (Req 1.6, E5)', () => {
    it('resolves the winning tier for the active name', async () => {
      const { service, fs } = makeService();
      await fs.writeFile(userFile('shared.md'), styleFile('Shared'));
      await fs.writeFile(projectFile('shared.md'), styleFile('Shared'));

      const result = await service.discover({ activeName: 'Shared' });

      expect(result.active).toEqual({
        name: 'Shared',
        tier: 'project',
        missing: false,
      });
    });

    it('resolves a built-in selection', async () => {
      const { service } = makeService();

      const result = await service.discover({ activeName: 'Learning' });

      expect(result.active).toEqual({
        name: 'Learning',
        tier: 'builtin',
        missing: false,
      });
    });

    it('reports missing when the file was deleted outside Ptah (E5)', async () => {
      const { service } = makeService();

      const result = await service.discover({ activeName: 'Ghost Style' });

      expect(result.active).toEqual({
        name: 'Ghost Style',
        tier: null,
        missing: true,
      });
    });

    it('treats a null selection as no style at all', async () => {
      const { service } = makeService();

      const result = await service.discover({ activeName: null });

      expect(result.active).toEqual({ name: null, tier: null, missing: false });
    });
  });

  describe('workspace root', () => {
    it('prefers an explicit root over the provider', async () => {
      const other = path.join('d:', 'tmp', 'ws-other');
      const { service, fs } = makeService();
      await fs.writeFile(
        path.join(other, ...OUTPUT_STYLES_DIR_SEGMENTS, 'other.md'),
        styleFile('Other'),
      );

      const result = await service.discover({ workspaceRoot: other });

      expect(result.styles.some((s) => s.name === 'Other')).toBe(true);
    });
  });
});
