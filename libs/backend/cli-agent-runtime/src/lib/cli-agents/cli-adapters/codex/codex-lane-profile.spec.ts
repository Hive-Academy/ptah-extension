import {
  CodexRuntime,
  buildCodexExecutionProfile,
} from '@ptah-extension/codex-runtime';
import {
  buildCodexLaneProfileSettings,
  type CodexLaneProfileInput,
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

// Explicit fixture acknowledgement only; production 10b must enforce these keys.
const handledKeys = [
  'agentsEnabled',
  'pluginsEnabled',
  'appsEnabled',
  'includeSkillInstructions',
  'disabledUserMcpServers',
  'autoCompactTokens',
  'toolOutputTokenLimit',
  'webSearch',
  'ptahToolTimeoutSeconds',
  'roleDelivery',
] as const satisfies readonly (keyof CodexLaneRequirements)[];

function acknowledgedProfile(source: CodexLaneProfileInput) {
  const result = buildCodexLaneProfileSettings(source);
  result.assertAllRequirementsHandled(handledKeys);
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

  it('prevents reading settings before acknowledging requirements', () => {
    const result = buildCodexLaneProfileSettings(input());
    expect(() => result.settings).toThrow('requirements must be handled');
    expect(() => result.assertAllRequirementsHandled([])).toThrow(
      'Unhandled Codex lane requirements',
    );
    expect(() => result.settings).toThrow('requirements must be handled');
    result.assertAllRequirementsHandled(handledKeys);
    expect(result.settings.consumer).toBe('lane');
  });

  it.each(handledKeys)('refuses an unhandled %s requirement', (key) => {
    const result = buildCodexLaneProfileSettings(input());
    expect(() =>
      result.assertAllRequirementsHandled(
        handledKeys.filter((candidate) => candidate !== key),
      ),
    ).toThrow(key);
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
      handledKeys.filter(
        (key) =>
          key !== 'autoCompactTokens' &&
          key !== 'toolOutputTokenLimit' &&
          key !== 'ptahToolTimeoutSeconds',
      ),
    );
    expect(result.settings.consumer).toBe('lane');
  });

  it.each([51820, undefined])(
    'the public runtime refuses the lane before using process dependencies (port %s)',
    async (mcpPort) => {
      const unexpectedDependency = jest.fn((): never => {
        throw new Error(
          'Runtime must refuse before accessing process dependencies',
        );
      });
      const runtime = new CodexRuntime({
        sink: { request: async () => 'decline' },
        get spawner() {
          return unexpectedDependency();
        },
        get executable() {
          return unexpectedDependency();
        },
        get binary() {
          return unexpectedDependency();
        },
        get store() {
          return unexpectedDependency();
        },
        get clock() {
          return unexpectedDependency();
        },
        get logger() {
          return unexpectedDependency();
        },
      });
      const source = input();
      const result = acknowledgedProfile({
        ...source,
        config: { ...source.config, mcpPort },
      });
      const profile = buildCodexExecutionProfile({
        session: result.settings,
        paths,
      });
      expect(profile.lane?.suppressedTools.length).toBeGreaterThan(0);
      expect(profile.mcpServers).toHaveLength(mcpPort === undefined ? 0 : 1);
      try {
        await expect(runtime.open(profile)).rejects.toThrow(
          'Codex profile requires unsupported runtime configuration',
        );
        expect(unexpectedDependency).not.toHaveBeenCalled();
      } finally {
        await runtime.close();
      }
    },
  );

  it('retains suppression and Ptah attachment in public core settings', () => {
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
    // These fields trigger the core's pre-spawn refusal, even with zero budgets.
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
      expect(() =>
        buildCodexExecutionProfile({ session: result.settings, paths }),
      ).not.toThrow();
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
      expect(result.warnings).toHaveLength(2);
    },
  );

  it('preserves positive token, money and turn limits explicitly', () => {
    const source = input();
    const result = acknowledgedProfile({
      ...source,
      maxTurns: 3,
      maxBudgetUsd: 4,
      config: { ...source.config, autoCompactTokens: Number.MAX_SAFE_INTEGER },
    });
    expect(result.requirements.autoCompactTokens).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.settings.lane).toMatchObject({
      maxTurns: 3,
      maxBudgetUsd: 4,
    });
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
