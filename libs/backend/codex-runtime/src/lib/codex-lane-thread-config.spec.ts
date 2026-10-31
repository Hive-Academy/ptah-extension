import { buildCodexExecutionProfile } from './codex-execution-profile';
import {
  buildCodexLaneThreadConfig,
  codexLaneThreadConfigSchema,
} from './codex-lane-thread-config';
import type { CodexExecutionProfile } from './codex-runtime.types';

function laneProfile(
  lane: Record<string, unknown> = {},
  withPtah = true,
): CodexExecutionProfile {
  return buildCodexExecutionProfile({
    session: {
      contextId: 'lane-1',
      consumer: 'lane',
      providerId: 'openai',
      workspaceId: 'workspace-1',
      cwd: '/work',
      model: 'model',
      permissionLevel: 'ask',
      lane: { suppressedTools: [], explicitFullAccess: false, ...lane },
      mcpServers: withPtah
        ? [
            {
              name: 'ptah',
              transport: 'http',
              url: 'http://localhost:3030/agent/lane-1/workspace/%2Fwork',
              headerReferences: {},
            },
          ]
        : [],
    },
    defaultHome: '/home',
    paths: {
      platform: 'posix',
      baseDirectory: '/',
      entries: {
        '/work': { kind: 'directory', realpath: '/real/work' },
        '/home': { kind: 'directory', realpath: '/real/home' },
      },
    },
  });
}

describe('buildCodexLaneThreadConfig', () => {
  it('builds exact nested keys and keeps quoted user names beside Ptah', () => {
    const profile = laneProfile({
      agentsEnabled: false,
      pluginsEnabled: false,
      appsEnabled: false,
      includeSkillInstructions: false,
      disabledUserMcpServers: ['server.with.dot', 'quote"name', 'ptah', 'server.with.dot'],
      autoCompactTokens: 1200,
      toolOutputTokenLimit: 300,
      webSearch: 'live',
      ptahToolTimeoutSeconds: 960,
    });
    expect(buildCodexLaneThreadConfig(profile)).toEqual({
      agents: { enabled: false },
      features: { plugins: false, apps: false },
      skills: { include_instructions: false },
      model_auto_compact_token_limit: 1200,
      tool_output_token_limit: 300,
      web_search: 'live',
      approval_policy: 'never',
      mcp_servers: {
        'server.with.dot': { enabled: false },
        'quote"name': { enabled: false },
        ptah: {
          url: 'http://localhost:3030/agent/lane-1/workspace/%2Fwork',
          tool_timeout_sec: 960,
          default_tools_approval_mode: 'approve',
        },
      },
    });
  });

  it('omits zero token limits and defaults the Ptah timeout', () => {
    const config = buildCodexLaneThreadConfig(
      laneProfile({ autoCompactTokens: 0, toolOutputTokenLimit: 0 }),
    );
    expect(config).toEqual({
      agents: { enabled: false },
      features: { plugins: false, apps: false },
      skills: { include_instructions: false },
      web_search: 'disabled',
      approval_policy: 'never',
      mcp_servers: {
        ptah: {
          url: 'http://localhost:3030/agent/lane-1/workspace/%2Fwork',
          tool_timeout_sec: 960,
          default_tools_approval_mode: 'approve',
        },
      },
    });
    expect(
      buildCodexLaneThreadConfig(laneProfile({}, false)).mcp_servers,
    ).toBeUndefined();
  });

  it('freezes the entire returned config, including every MCP server', () => {
    const config = buildCodexLaneThreadConfig(
      laneProfile({ disabledUserMcpServers: ['user.one', 'user.two'] }),
    );

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.agents)).toBe(true);
    expect(Object.isFrozen(config.features)).toBe(true);
    expect(Object.isFrozen(config.skills)).toBe(true);
    expect(Object.isFrozen(config.mcp_servers)).toBe(true);
    expect(Object.keys(config.mcp_servers ?? {})).toEqual([
      'user.one',
      'user.two',
      'ptah',
    ]);
    for (const server of Object.values(config.mcp_servers ?? {})) {
      expect(Object.isFrozen(server)).toBe(true);
    }
  });

  it.each([
    { autoCompactTokens: -1 },
    { autoCompactTokens: 1.5 },
    { toolOutputTokenLimit: -1 },
    { toolOutputTokenLimit: Number.POSITIVE_INFINITY },
    { ptahToolTimeoutSeconds: 0 },
    { ptahToolTimeoutSeconds: -1 },
    { webSearch: 'unknown' },
    { agentsEnabled: true },
    { unexpectedConfigKey: true },
  ])('rejects invalid or unknown lane input %p before spawn', (invalid) => {
    expect(() => laneProfile(invalid)).toThrow('Invalid Codex execution profile input');
  });

  it('rejects a timeout without Ptah and unknown nested config keys', () => {
    expect(() =>
      buildCodexLaneThreadConfig(
        laneProfile({ ptahToolTimeoutSeconds: 10 }, false),
      ),
    ).toThrow('Ptah tool timeout requires');
    const valid = buildCodexLaneThreadConfig(laneProfile());
    expect(
      codexLaneThreadConfigSchema.safeParse({ ...valid, unknown: true }).success,
    ).toBe(false);
    expect(
      codexLaneThreadConfigSchema.safeParse({
        ...valid,
        agents: { enabled: false, unknown: true },
      }).success,
    ).toBe(false);
    expect(
      codexLaneThreadConfigSchema.safeParse({
        ...valid,
        mcp_servers: { ptah: { enabled: false, unknown: true } },
      }).success,
    ).toBe(false);
    expect(
      codexLaneThreadConfigSchema.safeParse({
        ...valid,
        mcp_servers: { ptah: { enabled: false } },
      }).success,
    ).toBe(false);
    expect(
      codexLaneThreadConfigSchema.safeParse({
        ...valid,
        mcp_servers: { user: { url: 'https://example.com', tool_timeout_sec: 10 } },
      }).success,
    ).toBe(false);
    expect(
      codexLaneThreadConfigSchema.safeParse({
        ...valid,
        mcp_servers: {
          ptah: {
            ...valid.mcp_servers?.['ptah'],
            default_tools_approval_mode: 'prompt',
          },
        },
      }).success,
    ).toBe(false);
  });
});
