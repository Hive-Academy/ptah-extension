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
}));
jest.mock('os', () => ({ homedir: jest.fn(() => 'D:/home') }));

const { existsSync } = require('fs') as { existsSync: jest.Mock };

const fsp = require('fs/promises') as {
  mkdir: jest.Mock;
  writeFile: jest.Mock;
  readFile: jest.Mock;
};

import {
  buildHarnessNamespace,
  type HarnessNamespaceDependencies,
} from './harness-namespace.builder';

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

function makeDeps(
  overrides: {
    skills?: DiscoveredSkill[];
    disabled?: string[];
    servers?: { servers: Array<{ name: string }>; next_cursor?: string };
    workspaceRoot?: string;
  } = {},
): {
  deps: HarnessNamespaceDependencies;
  pluginLoader: PluginLoaderMock;
  mcpRegistry: McpRegistryMock;
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
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const deps: HarnessNamespaceDependencies = {
    pluginLoader,
    mcpRegistry,
    getWorkspaceRoot: () => overrides.workspaceRoot ?? 'D:/ws',
    logger,
  };
  return { deps, pluginLoader, mcpRegistry, logger };
}

beforeEach(() => {
  existsSync.mockReset();
  fsp.mkdir.mockReset().mockResolvedValue(undefined);
  fsp.writeFile.mockReset().mockResolvedValue(undefined);
  fsp.readFile.mockReset();
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildHarnessNamespace — shape', () => {
  it('exposes searchSkills/createSkill/searchMcpRegistry/listInstalledMcpServers', () => {
    const { deps } = makeDeps();
    const ns = buildHarnessNamespace(deps);
    expect(typeof ns.searchSkills).toBe('function');
    expect(typeof ns.createSkill).toBe('function');
    expect(typeof ns.searchMcpRegistry).toBe('function');
    expect(typeof ns.listInstalledMcpServers).toBe('function');
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
  it('forwards query + limit with default=10', async () => {
    const { deps, mcpRegistry } = makeDeps({
      servers: { servers: [{ name: 'a' }] },
    });
    const out = await buildHarnessNamespace(deps).searchMcpRegistry('a');
    expect(mcpRegistry.listServers).toHaveBeenCalledWith({
      query: 'a',
      limit: 10,
    });
    expect(out.servers[0].name).toBe('a');
  });

  it('respects explicit limit', async () => {
    const { deps, mcpRegistry } = makeDeps();
    await buildHarnessNamespace(deps).searchMcpRegistry('a', 25);
    expect(mcpRegistry.listServers).toHaveBeenCalledWith({
      query: 'a',
      limit: 25,
    });
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
