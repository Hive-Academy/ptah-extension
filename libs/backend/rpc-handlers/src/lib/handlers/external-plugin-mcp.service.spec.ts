/**
 * ExternalPluginMcpService — unit specs.
 *
 * The defect: a marketplace plugin could declare `mcpServers`, the consent
 * dialog rendered them, the user approved them, and nothing installed them.
 * These specs pin the three properties that make the fix trustworthy:
 *
 *   1. Installing RECORDS AN INTENT per declared server, through the same
 *      `McpInstallService` surface `mcp:install` uses — never a second writer.
 *   2. Uninstalling FORGETS those intents in the scope each was recorded in,
 *      so a plugin's servers cannot outlive the plugin.
 *   3. A key an unowned server already occupies is REPORTED and is still routed
 *      through the one path that refuses to overwrite it. The refusal itself is
 *      the reconciler's rule (pinned in `harness-sync`'s
 *      `harness-reconciler.verify-agreement.spec.ts`); what is pinned here is
 *      that the user is finally TOLD.
 *
 * Most cases use a structural fake installer: `McpInstallService`'s default
 * `McpIntentStore` points at the developer's real `~/.ptah/mcp-installed.json`.
 * The scope suite at the end uses the real `McpInstallService` over an intent
 * store in a temp directory, so workspace isolation is proven on the store the
 * reconciler actually reads.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts`
 */

import 'reflect-metadata';

// The scope suite imports the real `McpInstallService` from
// `@ptah-extension/cli-agent-runtime`, whose barrel transitively pulls
// `@ptah-extension/workspace-intelligence`. That lib's TreeSitter module
// evaluates `import.meta.url` at top level, which ts-jest's CJS transform
// cannot parse. Nothing here uses workspace-intelligence.
jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  McpIntentStore,
  type IHarnessCliDetector,
} from '@ptah-extension/harness-sync';
import { McpInstallService } from '@ptah-extension/cli-agent-runtime';
import type {
  CapabilityScope,
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
  NO_WORKSPACE_MCP_WARNING,
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
  scope: CapabilityScope;
}

interface RecordedUninstall {
  serverKey: string;
  workspaceRoot?: string;
  scope: CapabilityScope;
}

interface FakeInstaller extends ExternalMcpInstaller {
  installs: RecordedInstall[];
  uninstalls: RecordedUninstall[];
  /**
   * The scopes each key is recorded in, as the open workspace sees them —
   * global first, the way `McpIntentStore.scopeOf` answers. `uninstall` drops
   * the scope it is given.
   */
  recorded: Map<string, CapabilityScope[]>;
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
    recorded: new Map(),
    install: (serverName, serverKey, config, targets, workspaceRoot, scope) => {
      fake.installs.push({
        serverName,
        serverKey,
        config,
        targets,
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
        scope,
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
    uninstall: (serverKey, _targets, workspaceRoot, { scope }) => {
      fake.uninstalls.push({
        serverKey,
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
        scope,
      });
      fake.recorded.set(
        serverKey,
        (fake.recorded.get(serverKey) ?? []).filter((s) => s !== scope),
      );
      return Promise.resolve([]);
    },
    intentScopeOf: (serverKey) => fake.recorded.get(serverKey)?.[0],
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
      'workspace',
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

  it('installs globally into the always-writable surfaces plus every rival CLI the detector actually finds', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(
      installer,
      detectorFor(['codex', 'cursor']),
    );

    await service.install(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
      'global',
    );

    // `claude` and `vscode` are unconditional because the reconciler never
    // gates them either; codex and cursor are here only because they were
    // detected, and copilot/antigravity are absent for the same reason.
    expect(installer.installs[0]?.targets).toEqual([
      'claude',
      'vscode',
      'codex',
      'cursor',
    ]);
    expect(installer.installs[0]?.scope).toBe('global');
  });

  it('installs for the workspace into claude, vscode and only the detected workspace-file CLIs (cursor, opencode)', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(
      installer,
      detectorFor(['codex', 'copilot', 'cursor', 'antigravity', 'opencode']),
    );

    await service.install(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
      'workspace',
    );

    // Codex, Copilot and Antigravity read home-folder files every workspace
    // shares, so a workspace install never names them even when detected.
    expect(installer.installs[0]?.targets).toEqual([
      'claude',
      'vscode',
      'cursor',
      'opencode',
    ]);
    expect(installer.installs[0]?.scope).toBe('workspace');
    expect(installer.installs[0]?.workspaceRoot).toBe(WORKSPACE_ROOT);
  });

  it('skips an undetected workspace-file CLI on a workspace install', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(installer, detectorFor(['codex']));

    await service.install(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
      'workspace',
    );

    expect(installer.installs[0]?.targets).toEqual(['claude', 'vscode']);
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
      'workspace',
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
        origin: 'harness-config',
        originLabel: 'Config file',
        removal: 'direct',
      },
    ];
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
      'workspace',
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
        origin: 'harness-config',
        originLabel: 'Config file',
        removal: 'ptah-managed',
      },
    ];
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
      'workspace',
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
      'workspace',
    );

    expect(outcome.serverKeys).toEqual(['binlog']);
    expect(outcome.warnings).toEqual([
      expect.stringContaining('could not be written to vscode: EPERM'),
    ]);
  });

  it('records no intent and warns when the workspace scope is chosen with no workspace open', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      undefined,
      'workspace',
    );

    expect(installer.installs).toEqual([]);
    expect(outcome.serverKeys).toEqual([]);
    expect(outcome.warnings).toEqual([NO_WORKSPACE_MCP_WARNING]);
    expect(NO_WORKSPACE_MCP_WARNING).toBe(
      "No workspace is open. The plugin's MCP servers were not installed. Choose All workspaces to install them for every workspace.",
    );
  });

  it('records a global intent with no workspace open, without per-target "no workspace" noise', async () => {
    const installer = createFakeInstaller();
    installer.failures.set('binlog', [
      {
        target: 'claude',
        configPath: '',
        success: false,
        error: 'No workspace folder open',
      },
    ]);
    const { service } = makeService(installer);

    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      '',
      'global',
    );

    expect(installer.installs).toHaveLength(1);
    expect(installer.installs[0]?.scope).toBe('global');
    expect(installer.installs[0]?.workspaceRoot).toBeUndefined();
    expect(outcome.serverKeys).toEqual(['binlog']);
    expect(outcome.warnings).toEqual([]);
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
      'workspace',
    );

    expect(installer.installs.map((call) => call.serverKey)).toEqual([
      'binlog',
    ]);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('not usable');
  });
});

describe('ExternalPluginMcpService.uninstall', () => {
  it('forgets each declared server in the scope it was recorded in', async () => {
    const installer = createFakeInstaller();
    installer.recorded.set('binlog', ['workspace']);
    installer.recorded.set('roslyn', ['global']);
    const { service } = makeService(installer);

    const outcome = await service.uninstall(
      PLUGIN_ID,
      [declaredServer(), declaredServer({ name: 'roslyn', command: 'roslyn' })],
      WORKSPACE_ROOT,
    );

    expect(outcome.serverKeys).toEqual(['binlog', 'roslyn']);
    expect(outcome.warnings).toEqual([]);
    expect(installer.uninstalls).toEqual([
      {
        serverKey: 'binlog',
        workspaceRoot: WORKSPACE_ROOT,
        scope: 'workspace',
      },
      { serverKey: 'roslyn', workspaceRoot: WORKSPACE_ROOT, scope: 'global' },
    ]);
  });

  it('forgets both records when a workspace install was later repeated for all workspaces', async () => {
    const installer = createFakeInstaller();
    installer.recorded.set('binlog', ['global', 'workspace']);
    const { service } = makeService(installer);

    const outcome = await service.uninstall(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
    );

    expect(installer.uninstalls.map((call) => call.scope)).toEqual([
      'global',
      'workspace',
    ]);
    expect(outcome.serverKeys).toEqual(['binlog']);
  });

  it('forgets a global intent even with no workspace open, because that record is user-wide', async () => {
    const installer = createFakeInstaller();
    installer.recorded.set('binlog', ['global']);
    const { service } = makeService(installer);

    const outcome = await service.uninstall(
      PLUGIN_ID,
      [declaredServer()],
      undefined,
    );

    expect(installer.uninstalls).toEqual([
      { serverKey: 'binlog', scope: 'global' },
    ]);
    expect(outcome.serverKeys).toEqual(['binlog']);
    // No per-target noise: there was no workspace to rewrite config files in,
    // and reporting six failures for that would be a finding nobody can clear.
    expect(outcome.warnings).toEqual([]);
  });

  it('leaves a server recorded for neither scope alone and says so', async () => {
    const installer = createFakeInstaller();
    const { service } = makeService(installer);

    const outcome = await service.uninstall(
      PLUGIN_ID,
      [declaredServer()],
      WORKSPACE_ROOT,
    );

    expect(installer.uninstalls).toEqual([]);
    expect(outcome.serverKeys).toEqual([]);
    expect(outcome.warnings).toEqual([
      expect.stringContaining('installed for another workspace'),
    ]);
  });

  it('reports a throwing uninstall as a warning rather than failing the sweep', async () => {
    const installer = createFakeInstaller();
    installer.recorded.set('binlog', ['workspace']);
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

/**
 * The real `McpInstallService` over a temp intent store: the store the
 * reconciler's desired state is built from (`listFor(workspaceRoot)`). No
 * reconciler, so nothing is written to any config file — only the intent file
 * under the temp root.
 */
describe('ExternalPluginMcpService scope (real intent store)', () => {
  let root: string;
  let workspaceA: string;
  let workspaceB: string;
  let store: McpIntentStore;
  let service: ExternalPluginMcpService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-plugin-mcp-scope-'));
    // A `.ptah` marker in each folder pins it as its own workspace root, so the
    // canonical key cannot climb to an ancestor of the temp directory.
    workspaceA = path.join(root, 'workspace-a');
    workspaceB = path.join(root, 'workspace-b');
    fs.mkdirSync(path.join(workspaceA, '.ptah'), { recursive: true });
    fs.mkdirSync(path.join(workspaceB, '.ptah'), { recursive: true });
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    store = new McpIntentStore(path.join(home, '.ptah', 'mcp-installed.json'));
    service = new ExternalPluginMcpService(
      createMockLogger() as unknown as Logger,
      new McpInstallService(null, store, { homeDir: home }),
      detectorFor(['codex', 'cursor']),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('records a workspace install for workspace A only, so it is absent from workspace B', async () => {
    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      workspaceA,
      'workspace',
    );

    expect(outcome.serverKeys).toEqual(['binlog']);
    expect(store.scopeOf('binlog', workspaceA)).toBe('workspace');
    expect(store.listFor(workspaceA)).toEqual([
      expect.objectContaining({
        serverKey: 'binlog',
        registryName: PLUGIN_ID,
        targets: ['claude', 'vscode', 'cursor'],
      }),
    ]);
    expect(store.listFor(workspaceB)).toEqual([]);
    expect(store.scopeOf('binlog', workspaceB)).toBeUndefined();
  });

  it('records an explicit global install for every workspace with the detected set', async () => {
    await service.install(
      PLUGIN_ID,
      [declaredServer()],
      workspaceA,
      'global',
    );

    expect(store.scopeOf('binlog', workspaceB)).toBe('global');
    expect(store.listFor(workspaceB)).toEqual([
      expect.objectContaining({
        serverKey: 'binlog',
        targets: ['claude', 'vscode', 'codex', 'cursor'],
      }),
    ]);
  });

  it('records no intent for a workspace choice with no workspace open', async () => {
    const outcome = await service.install(
      PLUGIN_ID,
      [declaredServer()],
      undefined,
      'workspace',
    );

    expect(outcome.warnings).toEqual([NO_WORKSPACE_MCP_WARNING]);
    expect(store.has('binlog')).toBe(false);
  });

  it('uninstall forgets the workspace record it was installed with', async () => {
    await service.install(
      PLUGIN_ID,
      [declaredServer()],
      workspaceA,
      'workspace',
    );

    const outcome = await service.uninstall(
      PLUGIN_ID,
      [declaredServer()],
      workspaceA,
    );

    expect(outcome.serverKeys).toEqual(['binlog']);
    expect(store.has('binlog')).toBe(false);
  });

  it('uninstall forgets the global record it was installed with, from any workspace', async () => {
    await service.install(
      PLUGIN_ID,
      [declaredServer()],
      workspaceA,
      'global',
    );

    await service.uninstall(PLUGIN_ID, [declaredServer()], workspaceB);

    expect(store.has('binlog')).toBe(false);
  });

  it('uninstall from workspace B leaves workspace A\'s record and warns', async () => {
    await service.install(
      PLUGIN_ID,
      [declaredServer()],
      workspaceA,
      'workspace',
    );

    const outcome = await service.uninstall(
      PLUGIN_ID,
      [declaredServer()],
      workspaceB,
    );

    expect(outcome.serverKeys).toEqual([]);
    expect(outcome.warnings).toEqual([
      expect.stringContaining('installed for another workspace'),
    ]);
    expect(store.scopeOf('binlog', workspaceA)).toBe('workspace');
  });
});
