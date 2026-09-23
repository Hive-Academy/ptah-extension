/**
 * The Installed-tab grouping and removal rules, lifted out of
 * `McpDirectoryBrowserComponent` so the marketplace Connected view and the
 * Installed tab cannot drift apart (TASK_2026_524, spec 3).
 *
 * Two things are pinned here:
 *   - grouping identity is origin AND key, never key alone — a `.mcp.json`
 *     entry and a live session connector with the same name are two rows with
 *     two different Remove buttons;
 *   - every `removal` kind routes to its own RPC, and a refusal comes back as
 *     a user-facing string rather than being swallowed.
 */

import type { ClaudeRpcService } from '@ptah-extension/core';
import type { InstalledMcpServer } from '@ptah-extension/shared';
import {
  groupInstalledServers,
  mcpTargetLabel,
  type InstalledServerGroup,
} from './installed-mcp-groups';
import { removeInstalledGroup } from './installed-mcp-removal';

function server(over: Partial<InstalledMcpServer> = {}): InstalledMcpServer {
  return {
    serverKey: 'github',
    configPath: '/repo/.mcp.json',
    config: { type: 'stdio', command: 'npx', args: [] },
    managedByPtah: false,
    origin: 'harness-config',
    originLabel: 'Project config',
    removal: 'direct',
    ...over,
  };
}

function group(over: Partial<InstalledServerGroup> = {}): InstalledServerGroup {
  return {
    key: 'harness-config github',
    serverKey: 'github',
    origin: 'harness-config',
    originLabel: 'Project config',
    showOriginLabel: false,
    removal: 'direct',
    servers: [],
    targets: [],
    configPaths: [],
    ...over,
  };
}

/** Minimal stand-in for the core `RpcResult` shape. */
function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

function failed(message: string) {
  return {
    success: false,
    data: undefined,
    error: message,
    isSuccess: (): boolean => false,
  };
}

interface RpcCall {
  method: string;
  params: unknown;
}

/**
 * A fake `ClaudeRpcService`. `removeInstalledGroup` takes the service as a
 * PARAMETER — `setup-plugins/` injects nothing beyond what it already did —
 * so the seam needs no TestBed at all.
 */
function fakeRpc(replies: Record<string, unknown>): {
  rpc: ClaudeRpcService;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  const call = (method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params });
    return Promise.resolve(replies[method] ?? ok(undefined));
  };
  // Structurally narrower than the real generic `call`, so a plain assertion
  // through `unknown` is the honest way to present it. No `as any`.
  return { rpc: { call } as unknown as ClaudeRpcService, calls };
}

describe('groupInstalledServers', () => {
  it('keeps two origins with the same server key as two groups', () => {
    const groups = groupInstalledServers([
      server({ origin: 'harness-config', originLabel: 'Project config' }),
      server({
        origin: 'claude-connector',
        originLabel: 'Account connector',
        removal: 'none',
        configPath: '',
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key)).toEqual([
      'harness-config github',
      'claude-connector github',
    ]);
  });

  it('collapses five targets of one key onto one group with five targets', () => {
    const groups = groupInstalledServers([
      server({ target: 'vscode' }),
      server({ target: 'claude' }),
      server({ target: 'cursor' }),
      server({ target: 'copilot' }),
      server({ target: 'codex' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].targets).toEqual([
      'vscode',
      'claude',
      'cursor',
      'copilot',
      'codex',
    ]);
    expect(groups[0].servers).toHaveLength(5);
  });

  it('drops rows with no target rather than inventing one', () => {
    const groups = groupInstalledServers([
      server({ origin: 'smithery', removal: 'smithery', configPath: '' }),
    ]);

    expect(groups[0].targets).toEqual([]);
  });

  it('dedupes config paths and drops empty ones', () => {
    const groups = groupInstalledServers([
      server({ target: 'vscode', configPath: '/repo/.mcp.json' }),
      server({ target: 'claude', configPath: '/repo/.mcp.json' }),
      server({ target: 'codex', configPath: '' }),
      server({ target: 'cursor', configPath: '/home/.cursor/mcp.json' }),
    ]);

    expect(groups[0].configPaths).toEqual([
      '/repo/.mcp.json',
      '/home/.cursor/mcp.json',
    ]);
  });

  it('labels every origin except the unremarkable harness config', () => {
    const [harness, smithery] = groupInstalledServers([
      server(),
      server({ origin: 'smithery', originLabel: 'Smithery', serverKey: 'exa' }),
    ]);

    expect(harness.showOriginLabel).toBe(false);
    expect(smithery.showOriginLabel).toBe(true);
  });

  it('is total on an empty list', () => {
    expect(groupInstalledServers([])).toEqual([]);
  });

  it('carries the head row removal fix command onto the group', () => {
    const [claudeUser] = groupInstalledServers([
      server({
        origin: 'claude-user',
        originLabel: 'Claude CLI',
        serverKey: 'sentry',
        configPath: '/home/.claude.json',
        removal: 'none',
        removalBlockedReason: 'Remove it with `claude mcp remove sentry`.',
        removalFixCommand: 'claude mcp remove sentry --scope user',
      }),
    ]);

    expect(claudeUser.removalFixCommand).toBe(
      'claude mcp remove sentry --scope user',
    );
    expect(claudeUser.removalBlockedReason).toBe(
      'Remove it with `claude mcp remove sentry`.',
    );
  });

  it('takes the command from the head row, not a later one', () => {
    const [grouped] = groupInstalledServers([
      server({ removal: 'none', removalFixCommand: 'claude mcp remove first' }),
      server({ removal: 'none', removalFixCommand: 'claude mcp remove other' }),
    ]);

    expect(grouped.removalFixCommand).toBe('claude mcp remove first');
  });

  it('leaves the field absent when the head row has no command', () => {
    const [connector, unquotable] = groupInstalledServers([
      // A claude.ai connector row: blocked, but no command can remove it.
      server({
        origin: 'claude-connector',
        originLabel: 'Claude account',
        configPath: '',
        removal: 'none',
        removalBlockedReason: 'Manage it in your Claude account.',
      }),
      // The backend withheld the command because the key cannot be quoted.
      server({
        origin: 'claude-user',
        originLabel: 'Claude CLI',
        serverKey: 'say"hi"',
        removal: 'none',
        removalBlockedReason: 'Remove it with the claude CLI.',
      }),
    ]);

    expect(connector).not.toHaveProperty('removalFixCommand');
    expect(unquotable).not.toHaveProperty('removalFixCommand');
  });
});

describe('mcpTargetLabel', () => {
  it('names each target the way the Installed tab renders it', () => {
    expect(mcpTargetLabel('vscode')).toBe('VS Code');
    expect(mcpTargetLabel('claude')).toBe('Claude Code');
    expect(mcpTargetLabel('codex')).toBe('Codex CLI');
    expect(mcpTargetLabel('antigravity')).toBe('Antigravity CLI');
  });
});

describe('removeInstalledGroup', () => {
  it('routes a smithery group to mcpDirectory:uninstallSmithery', async () => {
    const { rpc, calls } = fakeRpc({
      'mcpDirectory:uninstallSmithery': ok({ success: true }),
    });

    const failure = await removeInstalledGroup(
      rpc,
      group({ removal: 'smithery', serverKey: 'exa' }),
    );

    expect(failure).toBeNull();
    expect(calls).toEqual([
      {
        method: 'mcpDirectory:uninstallSmithery',
        params: { serverKey: 'exa' },
      },
    ]);
  });

  it('surfaces a Smithery refusal as a message rather than swallowing it', async () => {
    const { rpc } = fakeRpc({
      'mcpDirectory:uninstallSmithery': ok({
        success: false,
        error: 'still in use',
      }),
    });

    expect(
      await removeInstalledGroup(rpc, group({ removal: 'smithery' })),
    ).toBe('still in use');
  });

  it('falls back to a named message when a refusal carries no reason', async () => {
    const { rpc } = fakeRpc({
      'mcpDirectory:uninstallSmithery': ok({ success: false }),
    });

    expect(
      await removeInstalledGroup(
        rpc,
        group({ removal: 'smithery', serverKey: 'exa' }),
      ),
    ).toBe('Smithery refused to remove "exa".');
  });

  it('routes an oauth group to mcpDirectory:disconnectOAuth', async () => {
    const { rpc, calls } = fakeRpc({
      'mcpDirectory:disconnectOAuth': ok({ success: true }),
    });

    expect(
      await removeInstalledGroup(
        rpc,
        group({ removal: 'oauth', serverKey: 'linear' }),
      ),
    ).toBeNull();
    expect(calls[0].method).toBe('mcpDirectory:disconnectOAuth');
  });

  it('reports a transport failure on the oauth path', async () => {
    const { rpc } = fakeRpc({
      'mcpDirectory:disconnectOAuth': failed('host is gone'),
    });

    expect(await removeInstalledGroup(rpc, group({ removal: 'oauth' }))).toBe(
      'host is gone',
    );
  });

  it('sends targets and no force for a ptah-managed group', async () => {
    const { rpc, calls } = fakeRpc({
      'mcpDirectory:uninstall': ok({
        results: [{ target: 'vscode', success: true }],
      }),
    });

    expect(
      await removeInstalledGroup(
        rpc,
        group({ removal: 'ptah-managed', targets: ['vscode'] }),
      ),
    ).toBeNull();
    expect(calls[0].params).toEqual({
      serverKey: 'github',
      targets: ['vscode'],
    });
  });

  it('forces the uninstall for a direct group', async () => {
    const { rpc, calls } = fakeRpc({
      'mcpDirectory:uninstall': ok({
        results: [{ target: 'claude', success: true }],
      }),
    });

    await removeInstalledGroup(
      rpc,
      group({ removal: 'direct', targets: ['claude'] }),
    );

    expect(calls[0].params).toEqual({
      serverKey: 'github',
      targets: ['claude'],
      force: true,
    });
  });

  it('names the targets that refused, with their labels', async () => {
    const { rpc } = fakeRpc({
      'mcpDirectory:uninstall': ok({
        results: [
          { target: 'vscode', success: true },
          { target: 'codex', success: false, error: 'file locked' },
        ],
      }),
    });

    expect(
      await removeInstalledGroup(
        rpc,
        group({ removal: 'direct', targets: ['vscode', 'codex'] }),
      ),
    ).toBe('Could not remove "github" from: Codex CLI (file locked)');
  });

  it('says so when the backend removed nothing at all', async () => {
    const { rpc } = fakeRpc({
      'mcpDirectory:uninstall': ok({ results: [] }),
    });

    expect(
      await removeInstalledGroup(rpc, group({ removal: 'ptah-managed' })),
    ).toBe('Nothing was removed for "github".');
  });

  it('never calls through for a group that cannot be removed', async () => {
    const { rpc, calls } = fakeRpc({});

    expect(
      await removeInstalledGroup(rpc, group({ removal: 'none' })),
    ).toBeNull();
    expect(calls).toEqual([]);
  });
});
