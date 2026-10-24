import { buildCodexExecutionProfile } from '@ptah-extension/codex-runtime';
import {
  buildCodexLaneProfileSettings,
  type CodexLaneProfileInput,
} from './codex-lane-profile';

function input(): CodexLaneProfileInput {
  return {
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

describe('buildCodexLaneProfileSettings', () => {
  it('retains suppression and Ptah attachment in public core settings', () => {
    const result = buildCodexLaneProfileSettings(input());
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
    expect(profile.approvalPolicy).toEqual({
      granular: {
        sandbox_approval: true,
        rules: true,
        skill_approval: true,
        request_permissions: true,
        mcp_elicitations: true,
      },
    });
    expect(profile.sandboxPolicy.mode).toBe('read-only');
    expect(profile.fullAccessStatus).toBe('unproved-disabled');
    // These fields trigger the core's pre-spawn refusal, even with zero budgets.
    expect(profile.lane?.suppressedTools.length).toBeGreaterThan(0);
  });

  it.each(['plan', 'auto-edit', 'yolo'] as const)(
    'delegates %s to the settled core policy',
    (permissionLevel) => {
      const result = buildCodexLaneProfileSettings({
        ...input(),
        permissionLevel,
      });
      const profile = buildCodexExecutionProfile({
        session: result.settings,
        paths,
      });
      expect(profile.approvalPolicy).toBe('on-request');
      expect(profile.sandboxPolicy.mode).toBe(
        permissionLevel === 'plan' ? 'read-only' : 'workspace-write',
      );
      expect(profile.sandboxPolicy.networkAccess).toBe(false);
      expect(profile.fullAccessStatus).toBe('unproved-disabled');
    },
  );

  it.each([0, -0])(
    'omits zero token budgets (%s), without dropping suppression',
    (zero) => {
      const source = input();
      const result = buildCodexLaneProfileSettings({
        ...source,
        maxBudgetUsd: zero,
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
      expect(result.settings.lane?.suppressedTools).toContain('skills');
      expect(result.warnings).toEqual([]);
    },
  );

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'omits invalid resolved limits (%s) with warnings',
    (value) => {
      const source = input();
      const result = buildCodexLaneProfileSettings({
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
    const result = buildCodexLaneProfileSettings({
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
      const result = buildCodexLaneProfileSettings({
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
    const first = buildCodexLaneProfileSettings(source);
    const resumed = buildCodexLaneProfileSettings({
      ...source,
      config: {
        ...source.config,
        variant: 'resume',
        developerInstructions: 'Role two',
      },
    });
    expect(first.settings.developerPrompt).toBe('Role one');
    expect(resumed.settings.developerPrompt).toBe('Role two');
    expect(buildCodexLaneProfileSettings(source)).toEqual(first);
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
        buildCodexLaneProfileSettings({ ...source, config }).settings,
      ).not.toHaveProperty('developerPrompt');
  });
});
