import 'reflect-metadata';
import {
  buildCodexExecutionProfile,
  buildCodexLaneThreadConfig,
} from '@ptah-extension/codex-runtime';
import {
  buildCodexLaneProfileSettings,
  type CodexLaneProfileInput,
  type CodexLaneProfileSettings,
  type CodexLaneRequirements,
} from './codex-lane-profile';

function input(): CodexLaneProfileInput {
  return {
    permissionLevel: 'ask',
    identity: {
      contextId: 'lane-1',
      normalizedHome: '/codex',
      providerId: 'codex',
      workspaceId: 'workspace',
      model: 'model',
    },
    config: {
      variant: 'first-turn',
      workingDirectory: '/workspace',
      autoCompactTokens: 120000,
      toolOutputTokenLimit: 2500,
      webSearch: true,
      reasoningEffort: ' high ',
      userMcpServerNames: ['github', 'a.b', 'github', '', 'ptah'],
      mcpPort: 51820,
      agentId: 'lane/1',
      developerInstructions: 'Role one',
    },
  };
}

const paths = {
  platform: 'posix' as const,
  baseDirectory: '/',
  entries: {
    '/codex': { kind: 'missing' as const },
    '/workspace': { kind: 'directory' as const, realpath: '/workspace' },
  },
};

function requirementKeys(
  result: CodexLaneProfileSettings,
): (keyof CodexLaneRequirements)[] {
  return Object.keys(result.requirements) as (keyof CodexLaneRequirements)[];
}

function acknowledgedProfile(source: CodexLaneProfileInput) {
  const result = buildCodexLaneProfileSettings(source);
  result.assertAllRequirementsHandled(requirementKeys(result));
  return result;
}

describe('buildCodexLaneProfileSettings', () => {
  it('requires an explicit permission level at the type and runtime boundaries', () => {
    const { permissionLevel, ...missing } = input();
    expect(permissionLevel).toBe('ask');
    expect(() => {
      // @ts-expect-error The caller must choose a lane permission policy.
      buildCodexLaneProfileSettings(missing);
    }).toThrow('permissionLevel is required');
  });

  it('prevents reading settings before proving requirements', () => {
    const result = buildCodexLaneProfileSettings(input());
    expect(() => result.settings).toThrow('requirements must be handled');
    expect(() => result.assertAllRequirementsHandled([])).toThrow(
      'Unhandled Codex lane requirements',
    );
    expect(() => result.settings).toThrow('requirements must be handled');
    result.assertAllRequirementsHandled(requirementKeys(result));
    expect(result.settings.consumer).toBe('lane');
  });

  it('refuses every missing requirement handler', () => {
    const result = buildCodexLaneProfileSettings(input());
    for (const key of requirementKeys(result)) {
      expect(() =>
        result.assertAllRequirementsHandled(
          requirementKeys(result).filter((candidate) => candidate !== key),
        ),
      ).toThrow(key);
      expect(() => result.settings).toThrow('requirements must be handled');
    }
  });

  it('refuses a requirement whose typed core field no longer matches', () => {
    const result = acknowledgedProfile(input());
    Object.defineProperty(result.settings.lane, 'webSearch', {
      value: 'disabled',
      configurable: true,
    });
    expect(() =>
      result.assertAllRequirementsHandled(requirementKeys(result)),
    ).toThrow('Unsupported Codex lane requirements: webSearch');
    expect(() => result.settings).toThrow('requirements must be handled');
  });

  it('checks only requirements present and prevents requirement deletion', () => {
    const source = input();
    const result = buildCodexLaneProfileSettings({
      ...source,
      config: {
        ...source.config,
        mcpPort: undefined,
        autoCompactTokens: 0,
        toolOutputTokenLimit: 0,
      },
    });
    expect(Object.isFrozen(result.requirements)).toBe(true);
    expect(Object.isFrozen(result.requirements.disabledUserMcpServers)).toBe(
      true,
    );
    result.assertAllRequirementsHandled(
      requirementKeys(result).filter(
        (key) =>
          key !== 'autoCompactTokens' &&
          key !== 'toolOutputTokenLimit' &&
          key !== 'ptahToolTimeoutSeconds',
      ),
    );
    expect(result.settings.consumer).toBe('lane');
  });

  it('builds the exact native thread config from a validated lane profile', () => {
    const result = acknowledgedProfile(input());
    const profile = buildCodexExecutionProfile({
      session: result.settings,
      paths,
    });
    expect(buildCodexLaneThreadConfig(profile)).toEqual({
      agents: { enabled: false },
      features: { plugins: false, apps: false },
      skills: { include_instructions: false },
      model_auto_compact_token_limit: 120000,
      tool_output_token_limit: 2500,
      web_search: 'live',
      approval_policy: 'never',
      mcp_servers: {
        'a.b': { enabled: false },
        github: { enabled: false },
        ptah: {
          url: 'http://localhost:51820/agent/lane%2F1/workspace/%2Fworkspace',
          tool_timeout_sec: 960,
          default_tools_approval_mode: 'approve',
        },
      },
    });
  });

  it('projects every requirement into typed core settings and keeps the Ptah URL', () => {
    const result = acknowledgedProfile(input());
    expect(result.settings.lane).toEqual({
      suppressedTools: [
        'agents',
        'plugins',
        'apps',
        'skills',
        'mcp:a.b',
        'mcp:github',
      ],
      agentsEnabled: false,
      pluginsEnabled: false,
      appsEnabled: false,
      includeSkillInstructions: false,
      disabledUserMcpServers: ['a.b', 'github'],
      autoCompactTokens: 120000,
      toolOutputTokenLimit: 2500,
      webSearch: 'live',
      ptahToolTimeoutSeconds: 960,
      explicitFullAccess: false,
    });
    expect(result.settings.mcpServers).toEqual([
      {
        name: 'ptah',
        transport: 'http',
        headerReferences: {},
        url: 'http://localhost:51820/agent/lane%2F1/workspace/%2Fworkspace',
      },
    ]);
    expect(result.requirements).toEqual({
      agentsEnabled: false,
      pluginsEnabled: false,
      appsEnabled: false,
      includeSkillInstructions: false,
      disabledUserMcpServers: ['a.b', 'github'],
      autoCompactTokens: 120000,
      toolOutputTokenLimit: 2500,
      webSearch: 'live',
      ptahToolTimeoutSeconds: 960,
      roleDelivery: 'replace',
    });
    expect(result.warnings).toEqual([]);
    const profile = buildCodexExecutionProfile({
      session: result.settings,
      paths,
    });
    expect(profile.consumer).toBe('lane');
    expect(profile.effort).toBe('high');
    // D26: every native lane level is workspace-write in its cwd, no network.
    expect(profile.approvalPolicy).toBe('never');
    expect(profile.sandboxPolicy.mode).toBe('workspace-write');
    expect(profile.sandboxPolicy.networkAccess).toBe(false);
    expect(profile.fullAccessStatus).toBe('unproved-disabled');
    expect(profile.lane?.suppressedTools.length).toBeGreaterThan(0);
  });

  it.each(['plan', 'auto-edit', 'yolo'] as const)(
    'delegates %s to the settled core policy',
    (permissionLevel) => {
      const result = acknowledgedProfile({
        ...input(),
        permissionLevel,
      });
      const profile = buildCodexExecutionProfile({
        session: result.settings,
        paths,
      });
      expect(profile.approvalPolicy).toBe('never');
      expect(profile.sandboxPolicy.mode).toBe('workspace-write');
      expect(profile.sandboxPolicy.networkAccess).toBe(false);
      expect(profile.fullAccessStatus).toBe('unproved-disabled');
    },
  );

  it.each([0, -0])(
    'omits zero token budgets (%s), without dropping suppression',
    (zero) => {
      const source = input();
      const result = acknowledgedProfile({
        ...source,
        maxBudgetUsd: zero,
        maxTurns: zero,
        config: {
          ...source.config,
          autoCompactTokens: zero,
          toolOutputTokenLimit: zero,
          webSearch: false,
        },
      });
      expect(result.requirements).not.toHaveProperty('autoCompactTokens');
      expect(result.requirements).not.toHaveProperty('toolOutputTokenLimit');
      expect(result.requirements.webSearch).toBe('disabled');
      expect(result.settings.lane).not.toHaveProperty('maxBudgetUsd');
      expect(result.settings.lane).not.toHaveProperty('maxTurns');
      expect(result.settings.lane).not.toHaveProperty('autoCompactTokens');
      expect(result.settings.lane).not.toHaveProperty('toolOutputTokenLimit');
      const profile = buildCodexExecutionProfile({
        session: result.settings,
        paths,
      });
      const threadConfig = buildCodexLaneThreadConfig(profile);
      expect(threadConfig).not.toHaveProperty('model_auto_compact_token_limit');
      expect(threadConfig).not.toHaveProperty('tool_output_token_limit');
      expect(threadConfig.web_search).toBe('disabled');
      expect(result.settings.lane?.suppressedTools).toContain('skills');
      expect(result.warnings).toEqual([]);
    },
  );

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'omits invalid resolved limits (%s) with warnings',
    (value) => {
      const source = input();
      const result = acknowledgedProfile({
        ...source,
        config: {
          ...source.config,
          autoCompactTokens: value,
          toolOutputTokenLimit: value,
        },
      });
      expect(result.requirements).not.toHaveProperty('autoCompactTokens');
      expect(result.requirements).not.toHaveProperty('toolOutputTokenLimit');
      expect(result.settings.lane).not.toHaveProperty('autoCompactTokens');
      expect(result.settings.lane).not.toHaveProperty('toolOutputTokenLimit');
      expect(result.warnings).toHaveLength(2);
    },
  );

  it('keeps a positive supported token limit', () => {
    const source = input();
    const result = acknowledgedProfile({
      ...source,
      config: { ...source.config, autoCompactTokens: Number.MAX_SAFE_INTEGER },
    });
    expect(result.requirements.autoCompactTokens).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.settings.lane?.autoCompactTokens).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    { maxTurns: 1, maxBudgetUsd: undefined, name: 'maxTurns' },
    { maxTurns: undefined, maxBudgetUsd: 0.01, name: 'maxBudgetUsd' },
  ])('refuses unsupported positive $name', ({ maxTurns, maxBudgetUsd, name }) => {
    expect(() =>
      buildCodexLaneProfileSettings({ ...input(), maxTurns, maxBudgetUsd }),
    ).toThrow(`Codex lane ${name} is unsupported`);
  });

  it.each([undefined, 0, -1, 65536, 1.5, NaN])(
    'handles absent or invalid port %s without inventing attachment',
    (mcpPort) => {
      const source = input();
      const result = acknowledgedProfile({
        ...source,
        config: { ...source.config, mcpPort },
      });
      expect(result.settings.mcpServers).toEqual([]);
      expect(result.requirements).not.toHaveProperty('ptahToolTimeoutSeconds');
      expect(result.settings.lane).not.toHaveProperty('ptahToolTimeoutSeconds');
      const profile = buildCodexExecutionProfile({
        session: result.settings,
        paths,
      });
      expect(buildCodexLaneThreadConfig(profile).mcp_servers).toEqual({
        'a.b': { enabled: false },
        github: { enabled: false },
      });
      expect(result.warnings).toHaveLength(
        mcpPort === undefined || mcpPort === 0 ? 0 : 1,
      );
    },
  );

  it('resends a replacement role on resume and continuation without mutation', () => {
    const source = input();
    const first = acknowledgedProfile(source);
    const resumed = acknowledgedProfile({
      ...source,
      config: {
        ...source.config,
        variant: 'resume',
        developerInstructions: 'Role two',
      },
    });
    expect(first.settings.developerPrompt).toBe('Role one');
    expect(resumed.settings.developerPrompt).toBe('Role two');
    expect(
      buildCodexExecutionProfile({ session: resumed.settings, paths })
        .developerPrompt,
    ).toBe('Role two');
    const repeated = acknowledgedProfile(source);
    expect(repeated.settings).toEqual(first.settings);
    expect(repeated.requirements).toEqual(first.requirements);
    expect(repeated.warnings).toEqual(first.warnings);
    expect(source.config.userMcpServerNames).toEqual([
      'github',
      'a.b',
      'github',
      '',
      'ptah',
    ]);
  });

  it('honors empty role and the legacy resume resend override', () => {
    const source = input();
    for (const config of [
      { ...source.config, developerInstructions: '' },
      {
        ...source.config,
        variant: 'resume' as const,
        resendRoleOnResume: false,
      },
    ])
      expect(
        acknowledgedProfile({ ...source, config }).settings,
      ).not.toHaveProperty('developerPrompt');
  });
});
