import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  FileType,
  type DirectoryEntry,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import {
  AgentRoleError,
  AgentRoleResolver,
  MAX_ROLE_BYTES,
  type AgentRoleErrorCode,
} from './agent-role-resolver.service';

interface FakeFileSystem {
  provider: IFileSystemProvider;
  exists: jest.Mock;
  readDirectory: jest.Mock;
  readFile: jest.Mock;
  totalCalls(): number;
}

function createFakeFileSystem(
  directories: Record<string, DirectoryEntry[]>,
  files: Record<string, string>,
): FakeFileSystem {
  const exists = jest.fn(
    async (path: string) => path in directories || path in files,
  );
  const readDirectory = jest.fn(async (path: string) => {
    const entries = directories[path];
    if (!entries) {
      throw new Error(`ENOENT: no such directory ${path}`);
    }
    return entries;
  });
  const readFile = jest.fn(async (path: string) => {
    const content = files[path];
    if (content === undefined) {
      throw new Error(`ENOENT: no such file ${path}`);
    }
    return content;
  });
  const provider = {
    exists,
    readDirectory,
    readFile,
  } as unknown as IFileSystemProvider;
  return {
    provider,
    exists,
    readDirectory,
    readFile,
    totalCalls: () =>
      exists.mock.calls.length +
      readDirectory.mock.calls.length +
      readFile.mock.calls.length,
  };
}

function file(name: string): DirectoryEntry {
  return { name, type: FileType.File };
}

async function expectRoleError(
  promise: Promise<unknown>,
  code: AgentRoleErrorCode,
): Promise<AgentRoleError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AgentRoleError);
  const roleError = caught as AgentRoleError;
  expect(roleError.code).toBe(code);
  return roleError;
}

describe('AgentRoleResolver', () => {
  let workspaceRoot: string;
  let agentsDir: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'ptah-role-resolver-'));
    mkdirSync(join(workspaceRoot, '.git'));
    agentsDir = join(workspaceRoot, '.claude', 'agents');
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  describe('listRoles', () => {
    it('returns an empty list when the agents directory is missing', async () => {
      const fs = createFakeFileSystem({}, {});
      const resolver = new AgentRoleResolver(fs.provider);

      await expect(resolver.listRoles(workspaceRoot)).resolves.toEqual([]);
      expect(fs.readDirectory).not.toHaveBeenCalled();
    });

    it('returns an empty list when the agents directory is empty', async () => {
      const fs = createFakeFileSystem({ [agentsDir]: [] }, {});
      const resolver = new AgentRoleResolver(fs.provider);

      await expect(resolver.listRoles(workspaceRoot)).resolves.toEqual([]);
    });

    it('lists top-level markdown files only, without extension, sorted', async () => {
      const fs = createFakeFileSystem(
        {
          [agentsDir]: [
            file('team-leader.md'),
            file('backend-developer.md'),
            file('notes.txt'),
            { name: 'nested.md', type: FileType.Directory },
            { name: 'linked.md', type: FileType.SymbolicLink },
            file('Architect.md'),
          ],
        },
        {},
      );
      const resolver = new AgentRoleResolver(fs.provider);

      await expect(resolver.listRoles(workspaceRoot)).resolves.toEqual([
        'Architect',
        'backend-developer',
        'team-leader',
      ]);
    });

    it('raises role_read_failed when the directory exists but cannot be listed', async () => {
      const fs = createFakeFileSystem({}, {});
      fs.exists.mockResolvedValue(true);
      fs.readDirectory.mockRejectedValue(
        new Error('EACCES: permission denied'),
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const error = await expectRoleError(
        resolver.listRoles(workspaceRoot),
        'role_read_failed',
      );
      expect(error.message).toContain('EACCES: permission denied');
      expect(error.availableRoles).toEqual([]);
    });
  });

  describe('workspace root guard', () => {
    it.each(['', '   ', 'relative/dir'])(
      'listRoles(%j) raises no_workspace before any filesystem call',
      async (root) => {
        const fs = createFakeFileSystem({}, {});
        const resolver = new AgentRoleResolver(fs.provider);

        const error = await expectRoleError(
          resolver.listRoles(root),
          'no_workspace',
        );
        expect(error.availableRoles).toEqual([]);
        expect(error.message).toContain('No workspace folder is open');
        expect(error.message).toContain('Spawning without "role" is valid');
        expect(fs.totalCalls()).toBe(0);
      },
    );

    it.each(['', 'relative/dir'])(
      'resolve(%j, "x") raises no_workspace before any filesystem call',
      async (root) => {
        const fs = createFakeFileSystem({}, {});
        const resolver = new AgentRoleResolver(fs.provider);

        const error = await expectRoleError(
          resolver.resolve(root, 'x'),
          'no_workspace',
        );
        expect(error.availableRoles).toEqual([]);
        expect(fs.totalCalls()).toBe(0);
      },
    );

    it('checks the role name before the workspace root', async () => {
      const fs = createFakeFileSystem({}, {});
      const resolver = new AgentRoleResolver(fs.provider);

      await expectRoleError(resolver.resolve('', '../x'), 'invalid_role_name');
      expect(fs.totalCalls()).toBe(0);
    });
  });

  describe('resolve', () => {
    it('raises no_roles when the agents directory is missing', async () => {
      const fs = createFakeFileSystem({}, {});
      const resolver = new AgentRoleResolver(fs.provider);

      const error = await expectRoleError(
        resolver.resolve(workspaceRoot, 'backend-developer'),
        'no_roles',
      );
      expect(error.availableRoles).toEqual([]);
      expect(error.message).toContain(workspaceRoot);
      expect(error.message).toContain('setup wizard');
      expect(error.message).toContain('Spawning without "role" is valid');
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('raises no_roles when the agents directory is empty', async () => {
      const fs = createFakeFileSystem({ [agentsDir]: [] }, {});
      const resolver = new AgentRoleResolver(fs.provider);

      await expectRoleError(
        resolver.resolve(workspaceRoot, 'backend-developer'),
        'no_roles',
      );
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('raises unknown_role listing the available roles', async () => {
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('team-leader.md'), file('backend-developer.md')] },
        {},
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const error = await expectRoleError(
        resolver.resolve(workspaceRoot, 'designer'),
        'unknown_role',
      );
      expect(error.availableRoles).toEqual([
        'backend-developer',
        'team-leader',
      ]);
      expect(error.message).toContain('backend-developer, team-leader');
      expect(error.message).toContain(workspaceRoot);
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it.each([
      '../x',
      '..',
      '.hidden',
      'a/b',
      'a\\b',
      '',
      'x'.repeat(101),
      'role name',
    ])(
      'rejects %j as invalid_role_name before any filesystem call',
      async (name) => {
        const fs = createFakeFileSystem(
          { [agentsDir]: [file('x.md')] },
          { [join(agentsDir, 'x.md')]: 'body' },
        );
        const resolver = new AgentRoleResolver(fs.provider);

        const error = await expectRoleError(
          resolver.resolve(workspaceRoot, name),
          'invalid_role_name',
        );
        expect(error.availableRoles).toEqual([]);
        expect(fs.totalCalls()).toBe(0);
      },
    );

    it('accepts a 100-character name', async () => {
      const name = 'r'.repeat(100);
      const fs = createFakeFileSystem(
        { [agentsDir]: [file(`${name}.md`)] },
        { [join(agentsDir, `${name}.md`)]: 'body' },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      await expect(
        resolver.resolve(workspaceRoot, name),
      ).resolves.toMatchObject({
        name,
      });
    });

    it('matches case-sensitively', async () => {
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('backend-developer.md')] },
        { [join(agentsDir, 'backend-developer.md')]: 'body' },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const error = await expectRoleError(
        resolver.resolve(workspaceRoot, 'Backend-Developer'),
        'unknown_role',
      );
      expect(error.availableRoles).toEqual(['backend-developer']);
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('reads the path joined from the matched listing entry and returns the definition', async () => {
      const sourcePath = join(agentsDir, 'backend-developer.md');
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('backend-developer.md')] },
        {
          [sourcePath]:
            '---\nname: backend-developer\ndescription: "Writes backend code: services"\n---\n# Backend\n\nDo the work.\n',
        },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const definition = await resolver.resolve(
        workspaceRoot,
        'backend-developer',
      );

      expect(fs.readFile).toHaveBeenCalledTimes(1);
      expect(fs.readFile).toHaveBeenCalledWith(sourcePath);
      expect(definition).toEqual({
        name: 'backend-developer',
        description: 'Writes backend code: services',
        body: '# Backend\n\nDo the work.\n',
        sourcePath,
        bytes: Buffer.byteLength('# Backend\n\nDo the work.\n', 'utf8'),
      });
    });

    it('omits description when the frontmatter has none', async () => {
      const sourcePath = join(agentsDir, 'plain.md');
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('plain.md')] },
        { [sourcePath]: 'No frontmatter here.' },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const definition = await resolver.resolve(workspaceRoot, 'plain');

      expect(definition).not.toHaveProperty('description');
      expect(definition.body).toBe('No frontmatter here.');
    });

    it('raises empty_role for a frontmatter-only file', async () => {
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('hollow.md')] },
        {
          [join(agentsDir, 'hollow.md')]:
            '---\nname: hollow\ndescription: x\n---\n  \n\t\n',
        },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const error = await expectRoleError(
        resolver.resolve(workspaceRoot, 'hollow'),
        'empty_role',
      );
      expect(error.availableRoles).toEqual(['hollow']);
    });

    it('accepts a body of exactly MAX_ROLE_BYTES', async () => {
      const body = 'a'.repeat(MAX_ROLE_BYTES);
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('big.md')] },
        { [join(agentsDir, 'big.md')]: `---\nname: big\n---\n${body}` },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const definition = await resolver.resolve(workspaceRoot, 'big');

      expect(MAX_ROLE_BYTES).toBe(65536);
      expect(definition.bytes).toBe(MAX_ROLE_BYTES);
      expect(definition.body).toBe(body);
    });

    it('raises role_too_large for a body one byte over MAX_ROLE_BYTES', async () => {
      const body = 'a'.repeat(MAX_ROLE_BYTES + 1);
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('big.md')] },
        { [join(agentsDir, 'big.md')]: `---\nname: big\n---\n${body}` },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const error = await expectRoleError(
        resolver.resolve(workspaceRoot, 'big'),
        'role_too_large',
      );
      expect(error.message).toContain(String(MAX_ROLE_BYTES + 1));
      expect(error.availableRoles).toEqual(['big']);
    });

    it('measures the limit in UTF-8 bytes, not characters', async () => {
      const body = 'é'.repeat(MAX_ROLE_BYTES / 2 + 1);
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('wide.md')] },
        { [join(agentsDir, 'wide.md')]: body },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      expect(body.length).toBeLessThan(MAX_ROLE_BYTES);
      await expectRoleError(
        resolver.resolve(workspaceRoot, 'wide'),
        'role_too_large',
      );
    });

    it('strips CRLF frontmatter and returns an LF-normalized body', async () => {
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('windows.md')] },
        {
          [join(agentsDir, 'windows.md')]:
            '---\r\nname: windows\r\ndescription: CRLF role\r\n---\r\nLine one\r\nLine two\r\n',
        },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const definition = await resolver.resolve(workspaceRoot, 'windows');

      expect(definition.description).toBe('CRLF role');
      expect(definition.body).toBe('Line one\nLine two\n');
      expect(definition.bytes).toBe(
        Buffer.byteLength('Line one\nLine two\n', 'utf8'),
      );
    });

    it('raises role_read_failed with the underlying message when the file cannot be read after listing', async () => {
      const fs = createFakeFileSystem({ [agentsDir]: [file('gone.md')] }, {});
      fs.readFile.mockRejectedValue(
        new Error('EBUSY: resource busy or locked'),
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const error = await expectRoleError(
        resolver.resolve(workspaceRoot, 'gone'),
        'role_read_failed',
      );
      expect(error.message).toContain('EBUSY: resource busy or locked');
      expect(error.availableRoles).toEqual(['gone']);
    });

    it('raises role_read_failed for a non-Error rejection', async () => {
      const fs = createFakeFileSystem({ [agentsDir]: [file('odd.md')] }, {});
      fs.readFile.mockRejectedValue('raw failure');
      const resolver = new AgentRoleResolver(fs.provider);

      const error = await expectRoleError(
        resolver.resolve(workspaceRoot, 'odd'),
        'role_read_failed',
      );
      expect(error.message).toContain('raw failure');
    });

    it('resolves roles from the harness root when given a sub-package workspaceRoot', async () => {
      const subPackage = join(workspaceRoot, 'libs', 'backend', 'thing');
      mkdirSync(subPackage, { recursive: true });
      const sourcePath = join(agentsDir, 'team-leader.md');
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('team-leader.md')] },
        { [sourcePath]: '---\nname: team-leader\n---\nLead.\n' },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      await expect(resolver.listRoles(subPackage)).resolves.toEqual([
        'team-leader',
      ]);
      const definition = await resolver.resolve(subPackage, 'team-leader');

      expect(definition.sourcePath).toBe(sourcePath);
      expect(fs.readDirectory).not.toHaveBeenCalledWith(
        join(subPackage, '.claude', 'agents'),
      );
    });

    it('keeps a body that itself begins with a --- pair after stripping the frontmatter once', async () => {
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('fenced.md')] },
        {
          [join(agentsDir, 'fenced.md')]:
            '---\nname: fenced\ndescription: outer\n---\n---\ninner: block\n---\nBody text.\n',
        },
      );
      const resolver = new AgentRoleResolver(fs.provider);

      const definition = await resolver.resolve(workspaceRoot, 'fenced');

      expect(definition.description).toBe('outer');
      expect(definition.body).toBe('---\ninner: block\n---\nBody text.\n');
    });

    it('re-reads on every call instead of caching', async () => {
      const sourcePath = join(agentsDir, 'live.md');
      const files: Record<string, string> = { [sourcePath]: 'first' };
      const fs = createFakeFileSystem(
        { [agentsDir]: [file('live.md')] },
        files,
      );
      const resolver = new AgentRoleResolver(fs.provider);

      await expect(
        resolver.resolve(workspaceRoot, 'live'),
      ).resolves.toMatchObject({
        body: 'first',
      });
      files[sourcePath] = 'second';
      await expect(
        resolver.resolve(workspaceRoot, 'live'),
      ).resolves.toMatchObject({
        body: 'second',
      });
      expect(fs.readDirectory).toHaveBeenCalledTimes(2);
      expect(fs.readFile).toHaveBeenCalledTimes(2);
    });
  });
});
