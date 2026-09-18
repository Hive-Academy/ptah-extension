/**
 * Unit specs for `CommandDiscoveryService` built-in command surface.
 *
 * Focus: the `/deep-research` built-in must appear in discovery so the slash
 * menu offers it. `getBuiltinCommands()` is private, so we drive it through the
 * public `discoverCommands()` / `searchCommands()` API with empty custom
 * command + skill directories (mocked `fs/promises`).
 */

import 'reflect-metadata';

jest.mock('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue([]),
  readFile: jest.fn().mockResolvedValue(''),
}));

import * as fs from 'fs/promises';
import * as path from 'path';

import { CommandDiscoveryService } from './command-discovery.service';

const readdirMock = fs.readdir as unknown as jest.Mock;
const readFileMock = fs.readFile as unknown as jest.Mock;

function makeService(): CommandDiscoveryService {
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue('D:/tmp/ws'),
  };
  const fsProvider = {
    createFileWatcher: jest.fn(),
  };
  const sentryService = {
    captureException: jest.fn(),
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const ctor = CommandDiscoveryService as unknown as new (
    ...args: unknown[]
  ) => CommandDiscoveryService;
  return new ctor(workspaceProvider, fsProvider, sentryService, logger);
}

describe('CommandDiscoveryService — /deep-research built-in', () => {
  beforeEach(() => {
    readdirMock.mockResolvedValue([]);
    readFileMock.mockResolvedValue('');
  });

  it('includes a deep-research builtin in discoverCommands()', async () => {
    const service = makeService();
    const result = await service.discoverCommands();
    expect(result.success).toBe(true);
    const deepResearch = result.commands?.find(
      (c) => c.name === 'deep-research',
    );
    expect(deepResearch).toBeDefined();
    expect(deepResearch?.scope).toBe('builtin');
    expect(deepResearch?.source).toBe('builtin');
    // Menu renders `/${name}` — verify the derived slash form.
    expect(`/${deepResearch?.name}`).toBe('/deep-research');
  });

  it('exposes an argument hint for the research question', async () => {
    const service = makeService();
    const result = await service.discoverCommands();
    const deepResearch = result.commands?.find(
      (c) => c.name === 'deep-research',
    );
    expect(deepResearch?.argumentHint).toBe('<question>');
  });

  it('surfaces deep-research via searchCommands query', async () => {
    const service = makeService();
    const result = await service.searchCommands({ query: 'deep-research' });
    expect(result.success).toBe(true);
    expect(result.commands?.some((c) => c.name === 'deep-research')).toBe(true);
  });
});

describe('CommandDiscoveryService — source discriminator across origins', () => {
  beforeEach(() => {
    readdirMock.mockReset();
    readFileMock.mockReset();
  });

  it('tags builtins with source "builtin"', async () => {
    readdirMock.mockResolvedValue([]);
    readFileMock.mockResolvedValue('');
    const service = makeService();
    const result = await service.discoverCommands();

    expect(result.success).toBe(true);
    const builtins =
      result.commands?.filter((c) => c.scope === 'builtin') ?? [];
    expect(builtins.length).toBeGreaterThan(0);
    expect(builtins.every((c) => c.source === 'builtin')).toBe(true);
  });

  it('tags custom .claude/commands entries with source "command"', async () => {
    const wsRoot = 'D:/tmp/ws';
    const commandsDir = path.normalize(path.join(wsRoot, '.claude/commands'));

    readdirMock.mockImplementation(async (dir: string) => {
      const normalized = path.normalize(dir);
      if (normalized === commandsDir) {
        return [
          {
            name: 'custom-cmd.md',
            isDirectory: () => false,
            isFile: () => true,
          },
        ];
      }
      return [];
    });

    readFileMock.mockImplementation(async () => {
      return '---\ndescription: A project command\n---\nPrompt body\n';
    });

    const service = makeService();
    const result = await service.discoverCommands(wsRoot);

    expect(result.success).toBe(true);
    const customCmd = result.commands?.find((c) => c.name === 'custom-cmd');
    expect(customCmd).toBeDefined();
    expect(customCmd?.scope).toBe('project');
    expect(customCmd?.source).toBe('command');
  });

  it('tags .claude/skills entries with source "skill"', async () => {
    const wsRoot = 'D:/tmp/ws';
    const skillsDir = path.normalize(path.join(wsRoot, '.claude/skills'));

    readdirMock.mockImplementation(async (dir: string) => {
      const normalized = path.normalize(dir);
      if (normalized === skillsDir) {
        return [
          {
            name: 'test-skill',
            isDirectory: () => true,
            isSymbolicLink: () => false,
            isFile: () => false,
          },
        ];
      }
      return [];
    });

    readFileMock.mockImplementation(async () => {
      return '---\nname: test-skill\ndescription: A workspace skill\n---\nSkill body\n';
    });

    const service = makeService();
    const result = await service.discoverCommands(wsRoot);

    expect(result.success).toBe(true);
    const skill = result.commands?.find((c) => c.name === 'test-skill');
    expect(skill).toBeDefined();
    expect(skill?.scope).toBe('plugin');
    expect(skill?.source).toBe('skill');
  });

  it('simultaneously pins all three sources to their respective source values', async () => {
    const wsRoot = 'D:/tmp/ws';
    const commandsDir = path.normalize(path.join(wsRoot, '.claude/commands'));
    const skillsDir = path.normalize(path.join(wsRoot, '.claude/skills'));

    readdirMock.mockImplementation(async (dir: string) => {
      const normalized = path.normalize(dir);
      if (normalized === commandsDir) {
        return [
          {
            name: 'deploy.md',
            isDirectory: () => false,
            isFile: () => true,
          },
        ];
      }
      if (normalized === skillsDir) {
        return [
          {
            name: 'visual-tester',
            isDirectory: () => true,
            isSymbolicLink: () => false,
            isFile: () => false,
          },
        ];
      }
      return [];
    });

    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath.includes('deploy.md')) {
        return '---\ndescription: Deploy app\n---\n';
      }
      if (filePath.includes('SKILL.md')) {
        return '---\nname: visual-tester\ndescription: Visual regression testing\n---\n';
      }
      return '';
    });

    const service = makeService();
    const result = await service.discoverCommands(wsRoot);

    expect(result.success).toBe(true);
    const builtin = result.commands?.find((c) => c.name === 'compact');
    const command = result.commands?.find((c) => c.name === 'deploy');
    const skill = result.commands?.find((c) => c.name === 'visual-tester');

    expect(builtin).toBeDefined();
    expect(builtin?.source).toBe('builtin');

    expect(command).toBeDefined();
    expect(command?.source).toBe('command');

    expect(skill).toBeDefined();
    expect(skill?.source).toBe('skill');
  });
});
