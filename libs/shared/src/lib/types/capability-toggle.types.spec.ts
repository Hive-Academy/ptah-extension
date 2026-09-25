import {
  CAPABILITY_ENFORCEMENT,
  CAPABILITY_POLICY_UNKNOWN_ERROR_NAME,
  PTAH_MCP_SERVER_NAME,
  capabilityKey,
  classifyMcpScope,
  defaultEnabled,
  definitionInEffect,
  isCapabilityPolicyUnknownError,
  isMcpServerEnabled,
  nextWorkspaceValue,
  planApprovalImport,
  pluginConfigLayer,
  resolveEffective,
  type CapabilityDefault,
  type CapabilityLayerValues,
  type EffectiveCapabilitySet,
} from './capability-toggle.types';

const ON_DEFAULT: CapabilityDefault = { enabled: true, reason: 'user-scope' };
const OFF_DEFAULT: CapabilityDefault = {
  enabled: false,
  reason: 'repository-only',
};

describe('defaultEnabled', () => {
  it('turns ptah on whatever declares it', () => {
    expect(
      defaultEnabled({ kind: 'mcp', id: PTAH_MCP_SERVER_NAME, scopes: [] }),
    ).toEqual({ enabled: true, reason: 'ptah' });
  });

  it('turns a user-scope declaration on, even when a repository also declares it', () => {
    expect(
      defaultEnabled({ kind: 'mcp', id: 'github', scopes: ['global'] }),
    ).toEqual({ enabled: true, reason: 'user-scope' });
    expect(
      defaultEnabled({
        kind: 'mcp',
        id: 'github',
        scopes: ['workspace', 'global'],
      }),
    ).toEqual({ enabled: true, reason: 'user-scope' });
  });

  it('keeps a repository-only or undeclared server off', () => {
    expect(
      defaultEnabled({ kind: 'mcp', id: 'firecrawl', scopes: ['workspace'] }),
    ).toEqual({ enabled: false, reason: 'repository-only' });
    expect(defaultEnabled({ kind: 'mcp', id: 'ghost', scopes: [] })).toEqual({
      enabled: false,
      reason: 'undeclared',
    });
  });

  it('turns skills on and follows the plugin activation model', () => {
    expect(defaultEnabled({ kind: 'skill', id: 'orchestration' })).toEqual({
      enabled: true,
      reason: 'skill',
    });
    expect(
      defaultEnabled({ kind: 'plugin', id: 'p', source: 'harness' }),
    ).toEqual({ enabled: true, reason: 'plugin-opt-out' });
    expect(
      defaultEnabled({ kind: 'plugin', id: 'p', source: 'skillssh' }),
    ).toEqual({ enabled: true, reason: 'plugin-opt-out' });
    expect(
      defaultEnabled({ kind: 'plugin', id: 'p', source: 'bundled' }),
    ).toEqual({ enabled: false, reason: 'plugin-opt-in' });
    expect(defaultEnabled({ kind: 'plugin', id: 'p' })).toEqual({
      enabled: false,
      reason: 'plugin-opt-in',
    });
  });
});

describe('resolveEffective', () => {
  const resolve = (layers: CapabilityLayerValues) => resolveEffective(layers);

  it('falls back to the default when no layer records anything', () => {
    expect(resolve({ defaultValue: ON_DEFAULT })).toEqual({
      enabled: true,
      origin: 'default',
    });
    expect(resolve({ defaultValue: OFF_DEFAULT })).toEqual({
      enabled: false,
      origin: 'default',
    });
  });

  it('lets global beat the default, and a global inherit fall through', () => {
    expect(resolve({ global: 'off', defaultValue: ON_DEFAULT })).toEqual({
      enabled: false,
      origin: 'global',
    });
    expect(resolve({ global: 'inherit', defaultValue: ON_DEFAULT })).toEqual({
      enabled: true,
      origin: 'default',
    });
  });

  it('lets the imported layer beat global — an imported OFF over an inherited ON stays OFF', () => {
    expect(
      resolve({ imported: 'off', global: 'on', defaultValue: ON_DEFAULT }),
    ).toEqual({ enabled: false, origin: 'imported' });
    expect(resolve({ imported: 'on', defaultValue: OFF_DEFAULT })).toEqual({
      enabled: true,
      origin: 'imported',
    });
  });

  it('lets an explicit workspace value beat every other layer', () => {
    expect(
      resolve({
        workspace: 'on',
        imported: 'off',
        global: 'off',
        defaultValue: OFF_DEFAULT,
      }),
    ).toEqual({ enabled: true, origin: 'workspace' });
    expect(
      resolve({
        workspace: 'off',
        imported: 'on',
        global: 'on',
        defaultValue: ON_DEFAULT,
      }),
    ).toEqual({ enabled: false, origin: 'workspace' });
  });

  it('makes the inherit tombstone skip the imported layer', () => {
    expect(
      resolve({
        workspace: 'inherit',
        imported: 'off',
        global: 'on',
        defaultValue: OFF_DEFAULT,
      }),
    ).toEqual({ enabled: true, origin: 'global' });
    expect(
      resolve({
        workspace: 'inherit',
        imported: 'on',
        defaultValue: OFF_DEFAULT,
      }),
    ).toEqual({ enabled: false, origin: 'default' });
  });

  it('switches a skill off when its parent plugin is off, whatever its own layers say', () => {
    expect(
      resolve({
        workspace: 'on',
        defaultValue: { enabled: true, reason: 'skill' },
        parentEnabled: false,
      }),
    ).toEqual({ enabled: false, origin: 'parent-plugin' });
    expect(
      resolve({
        workspace: 'off',
        defaultValue: { enabled: true, reason: 'skill' },
        parentEnabled: false,
      }),
    ).toEqual({ enabled: false, origin: 'workspace' });
    expect(
      resolve({
        defaultValue: { enabled: true, reason: 'skill' },
        parentEnabled: true,
      }),
    ).toEqual({ enabled: true, origin: 'default' });
  });
});

describe('nextWorkspaceValue (AC-1.3)', () => {
  it('writes inherit when the choice equals global ?? default', () => {
    expect(nextWorkspaceValue(true, { defaultValue: ON_DEFAULT })).toBe(
      'inherit',
    );
    expect(
      nextWorkspaceValue(false, { global: 'off', defaultValue: ON_DEFAULT }),
    ).toBe('inherit');
    expect(nextWorkspaceValue(false, { defaultValue: OFF_DEFAULT })).toBe(
      'inherit',
    );
  });

  it('writes a concrete override when the choice differs from what is inherited', () => {
    expect(nextWorkspaceValue(false, { defaultValue: ON_DEFAULT })).toBe('off');
    expect(
      nextWorkspaceValue(true, { global: 'off', defaultValue: ON_DEFAULT }),
    ).toBe('on');
    expect(nextWorkspaceValue(true, { defaultValue: OFF_DEFAULT })).toBe('on');
  });

  it('turning a server back on makes it follow global again, past an imported OFF', () => {
    const layers = {
      global: 'on' as const,
      defaultValue: ON_DEFAULT,
      imported: 'off' as const,
    };
    const written = nextWorkspaceValue(true, layers);
    expect(written).toBe('inherit');
    expect(resolveEffective({ ...layers, workspace: written })).toEqual({
      enabled: true,
      origin: 'global',
    });
  });

  it('keeps an explicit install ON even when it equals the inherited value (N6)', () => {
    expect(
      nextWorkspaceValue(
        true,
        { defaultValue: ON_DEFAULT },
        { explicit: true },
      ),
    ).toBe('on');
  });
});

describe('pluginConfigLayer (AC-3.2)', () => {
  it('reads a pre-task config exactly as the loader did', () => {
    const layer = pluginConfigLayer({
      enabledPluginIds: ['ptah-core', 'ptah-angular'],
      disabledSkillIds: ['orchestration'],
    });
    expect([...layer.plugins]).toEqual([
      ['ptah-core', 'on'],
      ['ptah-angular', 'on'],
    ]);
    expect([...layer.skills]).toEqual([['orchestration', 'off']]);
  });

  it('lets a deny beat an enable for the same id', () => {
    const layer = pluginConfigLayer({
      enabledPluginIds: ['ptah-core'],
      disabledPluginIds: ['ptah-core', 'ptah-harness-x'],
      disabledSkillIds: ['a'],
      enabledSkillIds: ['a', 'b'],
    });
    expect(layer.plugins.get('ptah-core')).toBe('off');
    expect(layer.plugins.get('ptah-harness-x')).toBe('off');
    expect(layer.skills.get('a')).toBe('off');
    expect(layer.skills.get('b')).toBe('on');
  });

  it('treats a missing config or missing lists as an empty layer', () => {
    for (const state of [null, undefined, {}]) {
      const layer = pluginConfigLayer(state);
      expect(layer.plugins.size).toBe(0);
      expect(layer.skills.size).toBe(0);
    }
  });
});

describe('classifyMcpScope (AC-2.1)', () => {
  it('labels user-scope sources global', () => {
    expect(classifyMcpScope({ origin: 'claude-user' })).toBe('global');
    expect(classifyMcpScope({ origin: 'smithery' })).toBe('global');
    expect(classifyMcpScope({ origin: 'oauth' })).toBe('global');
    expect(classifyMcpScope({ origin: 'claude-connector' })).toBe('global');
    for (const target of ['codex', 'copilot', 'antigravity'] as const) {
      expect(classifyMcpScope({ origin: 'harness-config', target })).toBe(
        'global',
      );
    }
  });

  it('labels repository files workspace, and an unplaceable row workspace too', () => {
    for (const target of ['claude', 'vscode', 'cursor', 'opencode'] as const) {
      expect(classifyMcpScope({ origin: 'harness-config', target })).toBe(
        'workspace',
      );
    }
    expect(classifyMcpScope({ origin: 'harness-config' })).toBe('workspace');
  });
});

describe('definitionInEffect (AC-2.5)', () => {
  it('pins Claude precedence: local beats project beats user', () => {
    const user = { layer: 'user' as const, command: 'u' };
    const project = { layer: 'project' as const, command: 'p' };
    const local = { layer: 'local' as const, command: 'l' };
    expect(definitionInEffect([user, project, local])).toBe(local);
    expect(definitionInEffect([user, project])).toBe(project);
    expect(definitionInEffect([user])).toBe(user);
  });

  it('keeps input order within one layer and answers null for nothing', () => {
    const first = { layer: 'user' as const, command: 'first' };
    const second = { layer: 'user' as const, command: 'second' };
    expect(definitionInEffect([first, second])).toBe(first);
    expect(definitionInEffect([])).toBeNull();
  });
});

describe('planApprovalImport', () => {
  const createdAt = '2026-09-25T00:00:00.000Z';

  it('maps enable-all, enabled and disabled names, with an OFF from any source winning', () => {
    const doc = planApprovalImport({
      createdAt,
      mcpJsonServerNames: ['firecrawl', 'davinci', 'shopify'],
      approvals: [
        {
          path: '/home/u/.claude.json',
          kind: 'claude-project',
          enabledMcpjsonServers: ['sentry'],
        },
        {
          path: '/repo/.claude/settings.local.json',
          kind: 'settings-local',
          enableAllProjectMcpServers: true,
          disabledMcpjsonServers: ['davinci', 'sentry'],
        },
      ],
    });
    expect(doc).toEqual({
      v: 1,
      createdAt,
      sources: [
        { path: '/home/u/.claude.json', kind: 'claude-project' },
        { path: '/repo/.claude/settings.local.json', kind: 'settings-local' },
      ],
      entries: {
        'mcp:davinci': 'off',
        'mcp:firecrawl': 'on',
        'mcp:sentry': 'off',
        'mcp:shopify': 'on',
      },
    });
  });

  it('publishes an empty layer when there is nothing to import', () => {
    expect(
      planApprovalImport({
        createdAt,
        mcpJsonServerNames: ['firecrawl'],
        approvals: [],
      }),
    ).toEqual({ v: 1, createdAt, sources: [], entries: {} });
  });

  it('ignores enableAll false and leaves servers not named at import time out', () => {
    const doc = planApprovalImport({
      createdAt,
      mcpJsonServerNames: ['firecrawl'],
      approvals: [
        {
          path: '/p',
          kind: 'settings-local',
          enableAllProjectMcpServers: false,
        },
      ],
    });
    expect(doc.entries).toEqual({});
  });
});

describe('isMcpServerEnabled', () => {
  const policy = (
    overrides: Partial<EffectiveCapabilitySet>,
  ): Pick<
    EffectiveCapabilitySet,
    'status' | 'ptahEnabled' | 'deniedMcpServers'
  > => ({
    status: 'verified',
    ptahEnabled: true,
    deniedMcpServers: [],
    ...overrides,
  });

  it('follows the deny list under a verified policy', () => {
    const verified = policy({ deniedMcpServers: ['firecrawl'] });
    expect(isMcpServerEnabled(verified, 'firecrawl')).toBe(false);
    expect(isMcpServerEnabled(verified, 'github')).toBe(true);
    expect(isMcpServerEnabled(verified, PTAH_MCP_SERVER_NAME)).toBe(true);
  });

  it('allows only ptah under an unverified policy', () => {
    const unverified = policy({ status: 'unverified' });
    expect(isMcpServerEnabled(unverified, 'github')).toBe(false);
    expect(isMcpServerEnabled(unverified, PTAH_MCP_SERVER_NAME)).toBe(true);
    expect(
      isMcpServerEnabled(
        policy({ status: 'unverified', ptahEnabled: false }),
        PTAH_MCP_SERVER_NAME,
      ),
    ).toBe(false);
  });

  it('honours ptah turned off under a verified policy', () => {
    expect(
      isMcpServerEnabled(policy({ ptahEnabled: false }), PTAH_MCP_SERVER_NAME),
    ).toBe(false);
  });
});

describe('isCapabilityPolicyUnknownError (R2)', () => {
  it('matches structurally on the error name, from any class', () => {
    class ForeignSdkError extends Error {
      constructor() {
        super('policy unreadable');
        this.name = CAPABILITY_POLICY_UNKNOWN_ERROR_NAME;
      }
    }
    expect(isCapabilityPolicyUnknownError(new ForeignSdkError())).toBe(true);
  });

  it('rejects other errors and non-errors', () => {
    expect(isCapabilityPolicyUnknownError(new Error('EACCES'))).toBe(false);
    expect(
      isCapabilityPolicyUnknownError({
        name: CAPABILITY_POLICY_UNKNOWN_ERROR_NAME,
      }),
    ).toBe(false);
    expect(isCapabilityPolicyUnknownError(null)).toBe(false);
  });
});

describe('CAPABILITY_ENFORCEMENT', () => {
  const status = (provider: string, kind: string) =>
    CAPABILITY_ENFORCEMENT.find(
      (row) => row.provider === provider && row.kind === kind,
    )?.status;

  it('marks the rival MCP lanes and the CLI proxy not enforced', () => {
    for (const provider of [
      'codex',
      'opencode',
      'antigravity',
      'ptah-cli-proxy',
    ]) {
      expect(status(provider, 'mcp')).toBe('not-enforced');
    }
  });

  it('marks Claude and Ptah CLI agents enforced for every kind', () => {
    for (const provider of ['claude', 'ptah-cli']) {
      for (const kind of ['mcp', 'skill', 'plugin']) {
        expect(status(provider, kind)).toBe('enforced');
      }
    }
  });

  it('holds one row per provider and kind', () => {
    const keys = CAPABILITY_ENFORCEMENT.map(
      (row) => `${row.provider}/${row.kind}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('capabilityKey', () => {
  it('joins kind and id', () => {
    expect(capabilityKey('mcp', 'github')).toBe('mcp:github');
  });
});
