/**
 * Specs for buildHarnessNamespace.
 *
 * ptah.harness.* exposes four MCP-accessible methods used by the harness
 * builder agent. Tests cover:
 *   - shape
 *   - searchSkills — query filter across skillId/displayName/description and
 *     isDisabled flag propagation
 *   - createSkill — name sanitization, existing-skill guard, YAML frontmatter
 *     assembly, allowedTools serialization, return value
 *   - searchMcpRegistry — delegation with default limit
 *   - listInstalledMcpServers — reads .vscode/mcp.json and .mcp.json with
 *     tolerance for IO errors
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the SUT
// ---------------------------------------------------------------------------

jest.mock('fs', () => ({ existsSync: jest.fn() }));
jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
}));
jest.mock('os', () => ({ homedir: jest.fn(() => 'D:/home') }));

const { existsSync } = require('fs') as { existsSync: jest.Mock };

const fsp = require('fs/promises') as {
  mkdir: jest.Mock;
  writeFile: jest.Mock;
  readFile: jest.Mock;
  readdir: jest.Mock;
  stat: jest.Mock;
};

import {
  buildHarnessNamespace,
  type HarnessNamespaceDependencies,
  type HarnessSkillsDirectory,
  type HarnessMcpRegistrySource,
} from './harness-namespace.builder';
import type { SkillShEntry } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DiscoveredSkill = {
  skillId: string;
  displayName: string;
  description: string;
  pluginId: string;
};

interface PluginLoaderMock {
  resolveCurrentPluginPaths: jest.Mock;
  discoverSkillsForPlugins: jest.Mock;
  getDisabledSkillIds: jest.Mock;
}

interface McpRegistryMock {
  listServers: jest.Mock;
}

interface SkillsDirectoryMock extends HarnessSkillsDirectory {
  search: jest.Mock;
}

interface SmitheryRegistryMock extends HarnessMcpRegistrySource {
  listServers: jest.Mock;
}

interface PulseMcpRegistryMock extends HarnessMcpRegistrySource {
  listServers: jest.Mock;
}

function makeDeps(
  overrides: {
    skills?: DiscoveredSkill[];
    disabled?: string[];
    servers?: { servers: Array<{ name: string }>; next_cursor?: string };
    workspaceRoot?: string;
    skillsDirectory?: SkillsDirectoryMock;
    smitheryRegistry?: SmitheryRegistryMock;
    pulseMcpRegistry?: PulseMcpRegistryMock;
  } = {},
): {
  deps: HarnessNamespaceDependencies;
  pluginLoader: PluginLoaderMock;
  mcpRegistry: McpRegistryMock;
  skillsDirectory?: SkillsDirectoryMock;
  smitheryRegistry?: SmitheryRegistryMock;
  pulseMcpRegistry?: PulseMcpRegistryMock;
  broadcast: jest.Mock;
  logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
} {
  const skills = overrides.skills ?? [];
  const disabled = overrides.disabled ?? [];
  const servers = overrides.servers ?? { servers: [] };

  const pluginLoader: PluginLoaderMock = {
    resolveCurrentPluginPaths: jest.fn().mockReturnValue(['/p/one']),
    discoverSkillsForPlugins: jest.fn().mockReturnValue(skills),
    getDisabledSkillIds: jest.fn().mockReturnValue(disabled),
  };
  const mcpRegistry: McpRegistryMock = {
    listServers: jest.fn().mockResolvedValue(servers),
  };
  const broadcast = jest.fn();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const deps: HarnessNamespaceDependencies = {
    pluginLoader,
    mcpRegistry,
    skillsDirectory: overrides.skillsDirectory,
    smitheryRegistry: overrides.smitheryRegistry,
    pulseMcpRegistry: overrides.pulseMcpRegistry,
    getWorkspaceRoot: () => overrides.workspaceRoot ?? 'D:/ws',
    broadcast,
    logger,
  };
  return {
    deps,
    pluginLoader,
    mcpRegistry,
    skillsDirectory: overrides.skillsDirectory,
    smitheryRegistry: overrides.smitheryRegistry,
    pulseMcpRegistry: overrides.pulseMcpRegistry,
    broadcast,
    logger,
  };
}

function makeSkillShEntry(
  over: Partial<SkillShEntry> & { skillId: string },
): SkillShEntry {
  return {
    source: over.source ?? 'owner/repo',
    skillId: over.skillId,
    name: over.name ?? over.skillId,
    description: over.description ?? '',
    installs: over.installs ?? 0,
    isInstalled: over.isInstalled ?? false,
  };
}

function enoent(): NodeJS.ErrnoException {
  const err = new Error('ENOENT') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

beforeEach(() => {
  existsSync.mockReset();
  fsp.mkdir.mockReset().mockResolvedValue(undefined);
  fsp.writeFile.mockReset().mockResolvedValue(undefined);
  fsp.readFile.mockReset();
  fsp.readdir.mockReset().mockRejectedValue(enoent());
  fsp.stat.mockReset().mockResolvedValue({ isDirectory: () => true } as never);
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildHarnessNamespace — shape', () => {
  it('exposes searchSkills/createSkill/searchMcpRegistry/listInstalledMcpServers/proposeConfig', () => {
    const { deps } = makeDeps();
    const ns = buildHarnessNamespace(deps);
    expect(typeof ns.searchSkills).toBe('function');
    expect(typeof ns.createSkill).toBe('function');
    expect(typeof ns.searchMcpRegistry).toBe('function');
    expect(typeof ns.listInstalledMcpServers).toBe('function');
    expect(typeof ns.proposeConfig).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// proposeConfig
// ---------------------------------------------------------------------------

describe('buildHarnessNamespace — proposeConfig', () => {
  it('rejects invalid configUpdates without broadcasting', async () => {
    const { deps, broadcast } = makeDeps();
    await expect(
      buildHarnessNamespace(deps).proposeConfig({
        persona: { goals: 'not-an-array' },
      } as never),
    ).rejects.toThrow(/Invalid configUpdates/);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('broadcasts validated config updates and returns an ack', async () => {
    const { deps, broadcast } = makeDeps();
    const result = await buildHarnessNamespace(deps).proposeConfig({
      persona: { label: 'Backend Dev', description: 'd', goals: ['ship'] },
    });
    expect(broadcast).toHaveBeenCalledWith(
      'harness:config-proposed',
      expect.objectContaining({
        configUpdates: expect.objectContaining({
          persona: expect.objectContaining({ label: 'Backend Dev' }),
        }),
        isConfigComplete: false,
      }),
    );
    expect(typeof result).toBe('string');
  });

  it('marks the configuration complete when isConfigComplete=true', async () => {
    const { deps, broadcast } = makeDeps();
    const result = await buildHarnessNamespace(deps).proposeConfig(
      { name: 'My Harness' },
      true,
    );
    expect(broadcast).toHaveBeenCalledWith(
      'harness:config-proposed',
      expect.objectContaining({ isConfigComplete: true }),
    );
    expect(result).toMatch(/complete/i);
  });
});

// ---------------------------------------------------------------------------
// searchSkills
// ---------------------------------------------------------------------------

describe('buildHarnessNamespace — searchSkills', () => {
  const sample: DiscoveredSkill[] = [
    {
      skillId: 'lint',
      displayName: 'Linter',
      description: 'runs lint',
      pluginId: 'core',
    },
    {
      skillId: 'test',
      displayName: 'Tester',
      description: 'runs jest tests',
      pluginId: 'core',
    },
  ];

  it('returns all skills with isDisabled annotation when query is empty', async () => {
    const { deps } = makeDeps({ skills: sample, disabled: ['lint'] });
    const out = await buildHarnessNamespace(deps).searchSkills();
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.skillId === 'lint')?.isDisabled).toBe(true);
    expect(out.find((s) => s.skillId === 'test')?.isDisabled).toBe(false);
  });

  it('filters results case-insensitively across id/name/description', async () => {
    const { deps } = makeDeps({ skills: sample });
    const out = await buildHarnessNamespace(deps).searchSkills('JEST');
    expect(out.map((s) => s.skillId)).toEqual(['test']);
  });

  it('treats whitespace-only query as "all"', async () => {
    const { deps } = makeDeps({ skills: sample });
    const out = await buildHarnessNamespace(deps).searchSkills('   ');
    expect(out).toHaveLength(2);
  });

  it('tags local skills with source="local"', async () => {
    const { deps } = makeDeps({ skills: sample });
    const out = await buildHarnessNamespace(deps).searchSkills();
    expect(out.every((s) => s.source === 'local')).toBe(true);
  });

  it('merges harness-authored ptah-harness-* plugin dirs with enabled paths', async () => {
    fsp.readdir.mockResolvedValueOnce([
      'ptah-harness-foo',
      'some-other-plugin',
      'ptah-harness-bar',
    ] as never);
    const { deps, pluginLoader } = makeDeps({ skills: sample });

    await buildHarnessNamespace(deps).searchSkills();

    const passedPaths = pluginLoader.discoverSkillsForPlugins.mock
      .calls[0][0] as string[];
    expect(passedPaths).toContain('/p/one');
    expect(passedPaths.some((p) => p.includes('ptah-harness-foo'))).toBe(true);
    expect(passedPaths.some((p) => p.includes('ptah-harness-bar'))).toBe(true);
    expect(passedPaths.some((p) => p.includes('some-other-plugin'))).toBe(
      false,
    );
    expect(new Set(passedPaths).size).toBe(passedPaths.length);
  });

  it('merges skills.sh results tagged source="skills.sh" with install metadata', async () => {
    const skillsDirectory: SkillsDirectoryMock = {
      search: jest.fn(async () => [
        makeSkillShEntry({
          skillId: 'react-best-practices',
          name: 'React Best Practices',
          source: 'vercel-labs/agent-skills',
          installs: 1000,
        }),
      ]),
    };
    const { deps } = makeDeps({ skills: sample, skillsDirectory });

    const out = await buildHarnessNamespace(deps).searchSkills('react');

    const remote = out.find((s) => s.source === 'skills.sh');
    expect(remote).toBeDefined();
    expect(remote?.skillId).toBe('react-best-practices');
    expect(remote?.installSource).toBe('vercel-labs/agent-skills');
    expect(remote?.installs).toBe(1000);
    expect(out.some((s) => s.source === 'local')).toBe(false);
    expect(skillsDirectory.search).toHaveBeenCalledWith('react');
  });

  it('does not call skills.sh when query is empty', async () => {
    const skillsDirectory: SkillsDirectoryMock = {
      search: jest.fn(async () => []),
    };
    const { deps } = makeDeps({ skills: sample, skillsDirectory });

    await buildHarnessNamespace(deps).searchSkills();

    expect(skillsDirectory.search).not.toHaveBeenCalled();
  });

  it('degrades to local-only when skills.sh search throws', async () => {
    const skillsDirectory: SkillsDirectoryMock = {
      search: jest.fn(async () => {
        throw new Error('network down');
      }),
    };
    const { deps, logger } = makeDeps({ skills: sample, skillsDirectory });

    const out = await buildHarnessNamespace(deps).searchSkills('lint');

    expect(out.every((s) => s.source === 'local')).toBe(true);
    expect(out.map((s) => s.skillId)).toEqual(['lint']);
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createSkill
// ---------------------------------------------------------------------------

describe('buildHarnessNamespace — createSkill', () => {
  it('sanitizes the name, creates the skill dir, writes frontmatter and returns paths', async () => {
    existsSync.mockReturnValue(false);
    const { deps, logger } = makeDeps();

    const result = await buildHarnessNamespace(deps).createSkill(
      'Code Review Helper',
      'Reviews code',
      '# Body',
      ['mcp__ptah__execute_code'],
    );

    expect(result.skillId).toBe('code-review-helper');
    expect(result.skillPath).toMatch(/code-review-helper[\\/]SKILL.md$/);

    expect(fsp.mkdir).toHaveBeenCalled();
    const [writtenPath, writtenBody] = fsp.writeFile.mock.calls[0];
    expect(writtenPath).toBe(result.skillPath);
    expect(writtenBody).toContain('name: "Code Review Helper"');
    expect(writtenBody).toContain('description: "Reviews code"');
    expect(writtenBody).toContain('allowed_tools:');
    expect(writtenBody).toContain('- mcp__ptah__execute_code');
    expect(writtenBody).toContain('# Body');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Created skill'),
    );
  });

  it('throws when the sanitized name is empty', async () => {
    const { deps } = makeDeps();
    await expect(
      buildHarnessNamespace(deps).createSkill('!!!', 'd', 'c'),
    ).rejects.toThrow(/Invalid skill name/);
  });

  it('throws and skips write when the skill already exists', async () => {
    existsSync.mockReturnValue(true);
    const { deps } = makeDeps();
    await expect(
      buildHarnessNamespace(deps).createSkill('my-skill', 'd', 'c'),
    ).rejects.toThrow(/already exists/);
    expect(fsp.writeFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// searchMcpRegistry
// ---------------------------------------------------------------------------

describe('buildHarnessNamespace — searchMcpRegistry', () => {
  it('forwards query + limit with default=10 and tags official source', async () => {
    const { deps, mcpRegistry } = makeDeps({
      servers: { servers: [{ name: 'a' }] },
    });
    const out = await buildHarnessNamespace(deps).searchMcpRegistry('a');
    expect(mcpRegistry.listServers).toHaveBeenCalledWith({
      query: 'a',
      limit: 10,
    });
    expect(out.servers[0].name).toBe('a');
    expect(out.servers[0].source).toBe('official');
  });

  it('respects explicit limit', async () => {
    const { deps, mcpRegistry } = makeDeps();
    await buildHarnessNamespace(deps).searchMcpRegistry('a', 25);
    expect(mcpRegistry.listServers).toHaveBeenCalledWith({
      query: 'a',
      limit: 25,
    });
  });

  it('returns official-only when no Smithery registry is configured', async () => {
    const { deps } = makeDeps({ servers: { servers: [{ name: 'off' }] } });
    const out = await buildHarnessNamespace(deps).searchMcpRegistry('x');
    expect(out.servers.map((s) => s.source)).toEqual(['official']);
  });

  it('merges Smithery results tagged source="smithery" when configured', async () => {
    const smitheryRegistry: SmitheryRegistryMock = {
      listServers: jest
        .fn()
        .mockResolvedValue({ servers: [{ name: 'smithery/srv' }] }),
    };
    const { deps } = makeDeps({
      servers: { servers: [{ name: 'official/srv' }] },
      smitheryRegistry,
    });

    const out = await buildHarnessNamespace(deps).searchMcpRegistry('db', 5);

    expect(smitheryRegistry.listServers).toHaveBeenCalledWith({
      query: 'db',
      limit: 5,
    });
    expect(out.servers).toEqual([
      { name: 'official/srv', description: undefined, source: 'official' },
      { name: 'smithery/srv', description: undefined, source: 'smithery' },
    ]);
  });

  it('degrades to official-only when Smithery search throws', async () => {
    const smitheryRegistry: SmitheryRegistryMock = {
      listServers: jest.fn().mockRejectedValue(new Error('missing key')),
    };
    const { deps, logger } = makeDeps({
      servers: { servers: [{ name: 'official/srv' }] },
      smitheryRegistry,
    });

    const out = await buildHarnessNamespace(deps).searchMcpRegistry('db');

    expect(out.servers.map((s) => s.source)).toEqual(['official']);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('merges PulseMCP results tagged source="pulsemcp" when configured', async () => {
    const pulseMcpRegistry: PulseMcpRegistryMock = {
      listServers: jest
        .fn()
        .mockResolvedValue({ servers: [{ name: 'autodesk-mcp' }] }),
    };
    const { deps } = makeDeps({
      servers: { servers: [{ name: 'official/srv' }] },
      pulseMcpRegistry,
    });

    const out = await buildHarnessNamespace(deps).searchMcpRegistry(
      'autodesk',
      5,
    );

    expect(pulseMcpRegistry.listServers).toHaveBeenCalledWith({
      query: 'autodesk',
      limit: 5,
    });
    expect(out.servers).toEqual([
      { name: 'official/srv', description: undefined, source: 'official' },
      { name: 'autodesk-mcp', description: undefined, source: 'pulsemcp' },
    ]);
  });

  it('merges official + smithery + pulsemcp results in order', async () => {
    const smitheryRegistry: SmitheryRegistryMock = {
      listServers: jest
        .fn()
        .mockResolvedValue({ servers: [{ name: 'smithery/srv' }] }),
    };
    const pulseMcpRegistry: PulseMcpRegistryMock = {
      listServers: jest
        .fn()
        .mockResolvedValue({ servers: [{ name: 'pulse/srv' }] }),
    };
    const { deps } = makeDeps({
      servers: { servers: [{ name: 'official/srv' }] },
      smitheryRegistry,
      pulseMcpRegistry,
    });

    const out = await buildHarnessNamespace(deps).searchMcpRegistry('db');

    expect(out.servers.map((s) => s.source)).toEqual([
      'official',
      'smithery',
      'pulsemcp',
    ]);
  });

  it('still returns official results when PulseMCP search fails', async () => {
    const pulseMcpRegistry: PulseMcpRegistryMock = {
      listServers: jest.fn().mockRejectedValue(new Error('pulse down')),
    };
    const { deps, logger } = makeDeps({
      servers: { servers: [{ name: 'official/srv' }] },
      pulseMcpRegistry,
    });

    const out = await buildHarnessNamespace(deps).searchMcpRegistry('db');

    expect(out.servers.map((s) => s.source)).toEqual(['official']);
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listInstalledMcpServers
// ---------------------------------------------------------------------------

describe('buildHarnessNamespace — listInstalledMcpServers', () => {
  it('collects servers from both .vscode/mcp.json and .mcp.json', async () => {
    existsSync.mockReturnValue(true);
    fsp.readFile
      .mockResolvedValueOnce(
        JSON.stringify({ servers: { filesystem: { type: 'stdio' } } }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ mcpServers: { github: { url: 'x' } } }),
      );

    const { deps } = makeDeps();
    const out = await buildHarnessNamespace(deps).listInstalledMcpServers();
    expect(out.map((s) => s.name).sort()).toEqual(['filesystem', 'github']);
    expect(out.map((s) => s.source).sort()).toEqual([
      '.mcp.json',
      '.vscode/mcp.json',
    ]);
  });

  it('logs a warning and returns partial results when a file is malformed', async () => {
    existsSync.mockReturnValue(true);
    fsp.readFile
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce(JSON.stringify({ servers: { x: { y: 1 } } }));

    const { deps, logger } = makeDeps();
    const out = await buildHarnessNamespace(deps).listInstalledMcpServers();

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('x');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns [] when neither file exists', async () => {
    existsSync.mockReturnValue(false);
    const { deps } = makeDeps();
    const out = await buildHarnessNamespace(deps).listInstalledMcpServers();
    expect(out).toEqual([]);
  });
});
