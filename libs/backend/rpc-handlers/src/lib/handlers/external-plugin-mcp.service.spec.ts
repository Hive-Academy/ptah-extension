/**
 * ExternalPluginMcpService — unit specs.
 *
 * The defect: a marketplace plugin could declare `mcpServers`, the consent
 * dialog rendered them, the user approved them, and nothing installed them.
 * These specs pin the three properties that make the fix trustworthy:
 *
 *   1. Installing RECORDS AN INTENT per declared server, through the same
 *      `McpInstallService` surface `mcp:install` uses — never a second writer.
 *   2. Uninstalling FORGETS those intents, so a plugin's servers cannot outlive
 *      the plugin.
 *   3. A key an unowned server already occupies is REPORTED and is still routed
 *      through the one path that refuses to overwrite it. The refusal itself is
 *      the reconciler's rule (pinned in `harness-sync`'s
 *      `harness-reconciler.verify-agreement.spec.ts`); what is pinned here is
 *      that the user is finally TOLD.
 *
 * The installer is a structural fake. It must be: `McpInstallService`'s default
 * `McpIntentStore` points at the developer's real `~/.ptah/mcp-installed.json`.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts`
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { IHarnessCliDetector } from '@ptah-extension/harness-sync';
import type {
  ExternalPluginMcpServer,
  HarnessTargetId,
  InstalledMcpServer,
  McpInstallResult,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import {
  ExternalPluginMcpService,
  type ExternalMcpInstaller,
} from './external-plugin-mcp.service';

const WORKSPACE_ROOT = 'C:\\ws';
const PLUGIN_ID = 'external:dotnet/ai-tools/binlog';

/** One recorded call to `install`, in the order the arguments arrive. */
interface RecordedInstall {
  serverName: string;
  serverKey: string;
  config: McpServerConfig;
  targets: McpInstallTarget[];
  workspaceRoot?: string;
}

interface FakeInstaller extends ExternalMcpInstaller {
  installs: RecordedInstall[];
  uninstalls: { serverKey: string; workspaceRoot?: string }[];
  /** Entries `listInstalled` reports — the config files as they stand today. */
  existing: InstalledMcpServer[];
  /** Per-target failures to report back from `install`, keyed by server key. */
  failures: Map<string, McpInstallResult[]>;
}

function createFakeInstaller(): FakeInstaller {
  const fake: FakeInstaller = {
    installs: [],
    uninstalls: [],
    existing: [],
    failures: new Map(),
    install: (serverName, serverKey, config, targets, workspaceRoot) => {
      fake.installs.push({
        serverName,
        serverKey,
        config,
        targets,
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
      });
      return Promise.resolve(
        fake.failures.get(serverKey) ??
          targets.map((target) => ({
            target,
            configPath: `${target}.json`,
            success: true,
          })),
      );
    },
    uninstall: (serverKey, _targets, workspaceRoot) => {
      fake.uninstalls.push({
        serverKey,
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
      });
      return Promise.resolve([]);
    },
    listInstalled: () => Promise.resolve(fake.existing),
  };
  return fake;
}

function detectorFor(installed: HarnessTargetId[]): IHarnessCliDetector {
  const set = new Set(installed);
  return { isInstalled: (target) => Promise.resolve(set.has(target)) };
}

function declaredServer(
  overrides: Partial<ExternalPluginMcpServer> = {},
): ExternalPluginMcpServer {
  return {
    name: 'binlog',
    command: 'dotnet',
    args: ['dnx', 'Microsoft.AITools.BinlogMcp', '--yes'],
    commandLine: 'dotnet dnx Microsoft.AITools.BinlogMcp --yes',
    ...overrides,
  };
}

function makeService(
  installer: FakeInstaller,
  detector: IHarnessCliDetector = detectorFor([]),
): { service: ExternalPluginMcpService; logger: MockLogger } {
  const logger = createMockLogger();
  return {
    service: new ExternalPluginMcpService(
      logger as unknown as Logger,
      installer,
      detector,
    ),
    logger,
  };
}

describe('ExternalPluginMcpService.install', () => {
  it('records an install intent for every declared server, carrying the plugin id as the provenance name', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer(), declaredServer({ name: 'roslyn', command: 'roslyn' })],
      WORKSPACE_ROOT,
    );

    expect(outcome.serverKeys).toEqual(['binlog', 'roslyn']);
    expect(outcome.warnings).toEqual([]);
    expect(installer.installs.map((call) => call.serverKey)).toEqual([
      'binlog',
      'roslyn',
    ]);
    // The intent records WHERE the server came from, so `mcp-installed.json`
    // is not a list of anonymous keys.
    expect(installer.installs[0]?.serverName).toBe(PLUGIN_ID);
    expect(installer.installs[0]?.config).toEqual({
      type: 'stdio',
      command: 'dotnet',
      args: ['dnx', 'Microsoft.AITools.BinlogMcp', '--yes'],
    });
    expect(installer.installs[0]?.workspaceRoot).toBe(WORKSPACE_ROOT);
  });

  it('installs into the always-writable surfaces plus the rival CLIs the detector actually finds', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(
      installer,
      detectorFor(['codex', 'cursor']),
    );

    await service.install(PLUGIN_ID, [declaredServer()], WORKSPACE_ROOT);

    // `claude` and `vscode` are unconditional because the reconciler never
    // gates them either; codex and cursor are here only because they were
    // detected, and copilot/antigravity are absent for the same reason.
    expect(installer.installs[0]?.targets).toEqual([
      'claude',
      'vscode',
      'codex',
      'cursor',
    ]);
  });

  it('treats a detector that throws as "not installed" rather than failing the install', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(installer, {
      isInstalled: () => Promise.reject(new Error('probe blew up')),
    });

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
    );

    expect(outcome.serverKeys).toEqual(['binlog']);
    expect(installer.installs[0]?.targets).toEqual(['claude', 'vscode']);
  });

  it('reports a key an unowned server already occupies, and still routes the install through the one path that refuses to overwrite it', async () => {
    const installer = createFakeInstaller();
    installer.existing = [
      {
        serverKey: 'binlog',
        target: 'vscode',
        configPath: 'C:\\ws\\.vscode\\mcp.json',
        config: { type: 'stdio', command: 'the-users-own-binlog' },
        managedByPtah: false,
      },
    ];
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
    );

    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('binlog');
    expect(outcome.warnings[0]).toContain('C:\\ws\\.vscode\\mcp.json');
    expect(outcome.warnings[0]).toContain('does not own');

    // The intent is STILL recorded. Skipping it here would be a second copy of
    // an ownership rule that must have exactly one owner: the reconciler
    // classifies the key `foreign`/`blocked` and leaves the user's entry
    // untouched, which is the same answer a directory install gets.
    expect(installer.installs).toHaveLength(1);
    expect(installer.installs[0]?.serverKey).toBe('binlog');
  });

  it('does not warn about a key Ptah already manages — that is an update, not a collision', async () => {
    const installer = createFakeInstaller();
    installer.existing = [
      {
        serverKey: 'binlog',
        target: 'vscode',
        configPath: 'C:\\ws\\.vscode\\mcp.json',
        config: { type: 'stdio', command: 'dotnet' },
        managedByPtah: true,
      },
    ];
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
    );

    expect(outcome.warnings).toEqual([]);
  });

  it('surfaces a per-target write failure without failing the whole install', async () => {
    const installer = createFakeInstaller();
    installer.failures.set('binlog', [
      { target: 'claude', configPath: '.mcp.json', success: true },
      {
        target: 'vscode',
        configPath: '.vscode/mcp.json',
        success: false,
        error: 'EPERM',
      },
    ]);
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
    );

    expect(outcome.serverKeys).toEqual(['binlog']);
    expect(outcome.warnings).toEqual([
      expect.stringContaining('could not be written to vscode: EPERM'),
    ]);
  });

  it('installs nothing and says so when no workspace is open', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      undefined,
    );

    expect(installer.installs).toEqual([]);
    expect(outcome.serverKeys).toEqual([]);
    expect(outcome.warnings).toEqual([
      expect.stringContaining('No workspace folder is open'),
    ]);
  });

  it('skips a declaration the schema rejects and keeps the usable ones', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [
        // A record another process could have written: the manifest gate
        // requires a non-empty command, and so does this one.
        declaredServer({ name: 'broken', command: '' }),
        declaredServer(),
      ],
      WORKSPACE_ROOT,
    );

    expect(installer.installs.map((call) => call.serverKey)).toEqual([
      'binlog',
    ]);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('not usable');
  });
});

describe('ExternalPluginMcpService.uninstall', () => {
  it('forgets the intent for every server the plugin declared', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(installer);

    const outcome = await service.uninstall(
      PLUGIN_ID,
      [declaredServer(), declaredServer({ name: 'roslyn', command: 'roslyn' })],
      WORKSPACE_ROOT,
    );

    expect(outcome.serverKeys).toEqual(['binlog', 'roslyn']);
    expect(installer.uninstalls).toEqual([
      { serverKey: 'binlog', workspaceRoot: WORKSPACE_ROOT },
      { serverKey: 'roslyn', workspaceRoot: WORKSPACE_ROOT },
    ]);
  });

  it('forgets the intent even with no workspace open, because the intent store is user-global', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(installer);

    const outcome = await service.uninstall(
      PLUGIN_ID,
      [declaredServer()],
      undefined,
    );

    expect(installer.uninstalls).toEqual([{ serverKey: 'binlog' }]);
    expect(outcome.serverKeys).toEqual(['binlog']);
    // No per-target noise: there was no workspace to rewrite config files in,
    // and reporting six failures for that would be a finding nobody can clear.
    expect(outcome.warnings).toEqual([]);
  });

  it('reports a throwing uninstall as a warning rather than failing the sweep', async () => {
    const installer = createFakeInstaller();
    installer.uninstall = () => Promise.reject(new Error('store locked'));
    const { service } = makeService(installer);

    const outcome = await service.uninstall(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
    );

    expect(outcome.serverKeys).toEqual([]);
    expect(outcome.warnings).toEqual([
      expect.stringContaining('could not be removed: store locked'),
    ]);
  });
});
