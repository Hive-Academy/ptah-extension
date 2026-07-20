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

import { CommandDiscoveryService } from './command-discovery.service';

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
  const ctor = CommandDiscoveryService as unknown as new (
    ...args: unknown[]
  ) => CommandDiscoveryService;
  return new ctor(workspaceProvider, fsProvider, sentryService);
}

describe('CommandDiscoveryService — /deep-research built-in', () => {
  it('includes a deep-research builtin in discoverCommands()', async () => {
    const service = makeService();
    const result = await service.discoverCommands();
    expect(result.success).toBe(true);
    const deepResearch = result.commands?.find(
      (c) => c.name === 'deep-research',
    );
    expect(deepResearch).toBeDefined();
    expect(deepResearch?.scope).toBe('builtin');
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
