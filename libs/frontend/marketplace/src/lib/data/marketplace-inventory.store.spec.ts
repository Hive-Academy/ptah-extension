/**
 * MarketplaceInventoryStore specs.
 *
 * Migrated from `connected-surface.component.spec.ts` (per-group isolation,
 * retry, connector de-duplication, blocked rows, removal routing, refused
 * removal, reload on content change) and from
 * `marketplace-hub.component.spec.ts:157-237` (connector rows from the newest
 * session, no removal for connector rows, degrade with no session). Each
 * migrated test names its source line.
 *
 * Not migrated here, by plan:
 *   - Smithery/OAuth status decoration (`connected-surface…spec.ts:366,394`)
 *     moves to `ConnectorLinksStore.statusFor` (plan C4, Batch 6). This spec
 *     pins the other half: the inventory makes no decoration read at all.
 *   - Button labels, empty-state targets and the Ptah-plugin "Manage" link
 *     (`:422` label, `:534`, `:556`) are presentation: the removal kind lives in
 *     `provider-row` (Task 8.1), the targets in the pages.
 *
 * New: `ensure` from idle only, zero RPC from reads and counts, notify reloads
 * only non-idle slices, a workspace switch reloads without navigating, `direct`
 * needs confirmation, `removeMany` partial failure, `removalFixCommand` read on
 * blocked rows only, stale generations dropped, no late publish after destroy.
 *
 * `ClaudeRpcService` is mocked per method. `PluginCatalogService` is stubbed to
 * the four members the store reads; its own caching is covered in `core`.
 * `WorkspaceScopeService` and `SessionMcpStatusRegistry` are the real root
 * services.
 */

import {
  EnvironmentInjector,
  createEnvironmentInjector,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  provideRouter,
  type Event as RouterEvent,
} from '@angular/router';
import {
  ClaudeRpcService,
  CommandDiscoveryFacade,
  PluginCatalogService,
  WorkspaceScopeService,
} from '@ptah-extension/core';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import type { InstalledServerGroup } from '@ptah-extension/chat-ui';
import type {
  ExternalPluginListing,
  InstalledMcpServer,
  InstalledSkill,
  PluginInfo,
} from '@ptah-extension/shared';
import {
  MarketplaceInventoryStore,
  removalIdOf,
  removalLockOf,
  type InventorySliceId,
} from './marketplace-inventory.store';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess: (): boolean => false,
  };
}

const SECRET = 'env-value-must-not-render';

function diskServer(serverKey: string): InstalledMcpServer {
  return {
    serverKey,
    target: 'claude',
    configPath: 'C:\\repo\\.mcp.json',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', serverKey],
      env: { API_KEY: SECRET },
    },
    managedByPtah: true,
    origin: 'harness-config',
    originLabel: 'harness config',
    removal: 'ptah-managed',
  };
}

function directServer(serverKey: string): InstalledMcpServer {
  return {
    ...diskServer(serverKey),
    configPath: 'C:\\Users\\me\\.cursor\\mcp.json',
    target: 'cursor',
    managedByPtah: false,
    removal: 'direct',
  };
}

function userServer(
  serverKey: string,
  fixCommand?: string,
): InstalledMcpServer {
  return {
    serverKey,
    configPath: 'C:\\Users\\me\\.claude.json',
    config: {
      type: 'http',
      url: 'https://user.example/mcp',
      headers: { Authorization: `Bearer ${SECRET}` },
    },
    managedByPtah: false,
    origin: 'claude-user',
    originLabel: 'Claude user config',
    removal: 'none',
    removalBlockedReason: 'Declared in your Claude user config.',
    ...(fixCommand === undefined ? {} : { removalFixCommand: fixCommand }),
  };
}

function smitheryServer(serverKey: string): InstalledMcpServer {
  return {
    serverKey,
    configPath: '',
    config: { type: 'http', url: 'https://smithery.example/mcp' },
    managedByPtah: true,
    origin: 'smithery',
    originLabel: 'Smithery',
    removal: 'smithery',
  };
}

function oauthServer(serverKey: string): InstalledMcpServer {
  return {
    serverKey,
    configPath: '',
    config: { type: 'http', url: 'https://oauth.example/mcp' },
    managedByPtah: true,
    origin: 'oauth',
    originLabel: 'OAuth',
    removal: 'oauth',
  };
}

function plugin(id: string, name: string): PluginInfo {
  return {
    id,
    name,
    description: 'A bundled plugin.',
    category: 'core-tools',
    skillCount: 3,
    commandCount: 1,
    isDefault: true,
    keywords: [],
  };
}

function skill(name: string): InstalledSkill {
  return {
    name,
    description: '',
    source: 'owner/skills',
    path: `/root/skills/${name}`,
    scope: 'global',
    agents: [],
  };
}

function listing(id: string, name: string): ExternalPluginListing {
  return {
    id,
    name,
    description: 'An external plugin.',
    source: 'owner/repo',
    path: 'plugins/x',
    installed: true,
    installedVersion: '1.2.0',
  };
}

/** A promise whose settlement the test controls. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface RpcCall {
  method: string;
  params: unknown;
}

const ALL_SLICES: readonly InventorySliceId[] = [
  'installed',
  'plugins',
  'community',
  'marketplaces',
];

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('MarketplaceInventoryStore', () => {
  let store: MarketplaceInventoryStore;
  let scope: WorkspaceScopeService;
  let mcpStatus: SessionMcpStatusRegistry;
  let responders: Map<string, () => unknown>;
  let calls: RpcCall[];
  let enabledPlugins: ReturnType<typeof signal<readonly PluginInfo[]>>;
  let catalogError: ReturnType<typeof signal<string | null>>;
  let ensureLoaded: jest.Mock<Promise<void>, []>;
  let refresh: jest.Mock<Promise<void>, []>;
  let clearCache: jest.Mock<void, []>;

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      return Promise.resolve(
        factory ? factory() : fail(`No responder for ${method}`),
      );
    }),
  };

  /** Let every pending RPC promise and its continuation run. */
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const methodsCalled = (): string[] => calls.map((c) => c.method);
  const paramsOf = (method: string): unknown =>
    calls.find((c) => c.method === method)?.params;

  const ensureAll = async (): Promise<void> => {
    await Promise.all(ALL_SLICES.map((id) => store.ensure(id)));
    await settle();
  };

  const groupFor = (serverKey: string): InstalledServerGroup => {
    const group = store
      .installed()
      .data.find((candidate) => candidate.serverKey === serverKey);
    if (!group) throw new Error(`No installed group for '${serverKey}'`);
    return group;
  };

  const keysOf = (): string[] =>
    store.installed().data.map((group) => group.serverKey);

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    enabledPlugins = signal<readonly PluginInfo[]>([]);
    catalogError = signal<string | null>(null);
    ensureLoaded = jest.fn().mockResolvedValue(undefined);
    refresh = jest.fn().mockResolvedValue(undefined);
    clearCache = jest.fn();

    responders.set('mcpDirectory:listInstalled', () => ok({ servers: [] }));
    responders.set('skillsSh:listInstalled', () => ok({ skills: [] }));
    responders.set('plugins:list-marketplaces', () =>
      ok({ marketplaces: [], suggestions: [], installed: [] }),
    );

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MarketplaceInventoryStore,
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: CommandDiscoveryFacade, useValue: { clearCache } },
        {
          provide: PluginCatalogService,
          useValue: {
            ensureLoaded: () => ensureLoaded(),
            refresh: () => refresh(),
            enabledPlugins: enabledPlugins.asReadonly(),
            error: catalogError.asReadonly(),
          },
        },
      ],
    });

    scope = TestBed.inject(WorkspaceScopeService);
    mcpStatus = TestBed.inject(SessionMcpStatusRegistry);
    store = TestBed.inject(MarketplaceInventoryStore);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ── Zero-RPC rule ──────────────────────────────────────────────────────────

  describe('loading only on request', () => {
    it('reads nothing on construction, from slice reads, or from counts', async () => {
      TestBed.tick();
      store.installed();
      store.plugins();
      store.community();
      store.marketplaces();
      store.newestSessionStatus();
      expect(store.counts()).toEqual({
        installed: null,
        plugins: null,
        community: null,
        marketplaces: null,
      });
      await settle();

      expect(calls).toEqual([]);
      expect(ensureLoaded).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      for (const id of ALL_SLICES) {
        expect(store[id]().state).toBe('idle');
      }
    });

    it('loads only the slice a page ensures', async () => {
      await store.ensure('community');
      await settle();

      expect(methodsCalled()).toEqual(['skillsSh:listInstalled']);
      expect(store.community().state).toBe('ready');
      expect(store.installed().state).toBe('idle');
      expect(store.plugins().state).toBe('idle');
      expect(store.marketplaces().state).toBe('idle');
      expect(store.counts()).toEqual({
        installed: null,
        plugins: null,
        community: 0,
        marketplaces: null,
      });
    });

    it('ensures from idle only: no second read while loading or once ready', async () => {
      const gate = deferred<unknown>();
      responders.set('skillsSh:listInstalled', () => gate.promise);

      void store.ensure('community');
      expect(store.community().state).toBe('loading');
      void store.ensure('community');
      expect(methodsCalled()).toEqual(['skillsSh:listInstalled']);

      gate.resolve(ok({ skills: [skill('run-tests')] }));
      await settle();
      await store.ensure('community');
      await settle();

      expect(methodsCalled()).toEqual(['skillsSh:listInstalled']);
      expect(store.community().data.map((s) => s.name)).toEqual(['run-tests']);
    });

    it('serves the plugins slice from the catalogue cache on ensure', async () => {
      enabledPlugins.set([plugin('ptah-core', 'Ptah Core')]);

      await store.ensure('plugins');
      await settle();

      expect(ensureLoaded).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
      expect(store.plugins().data.map((p) => p.name)).toEqual(['Ptah Core']);
    });
  });

  // ── Migrated: connected-surface.component.spec.ts ──────────────────────────

  describe('slices (connected-surface spec)', () => {
    // connected-surface.component.spec.ts:224
    it('populates all four slices from their own reads', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [diskServer('ptah'), smitheryServer('hubspot')] }),
      );
      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [skill('run-tests')] }),
      );
      responders.set('plugins:list-marketplaces', () =>
        ok({
          marketplaces: [],
          suggestions: [],
          installed: [listing('external:owner/repo/alpha', 'Alpha')],
        }),
      );
      enabledPlugins.set([plugin('ptah-core', 'Ptah Core')]);

      await ensureAll();

      expect(keysOf()).toEqual(['ptah', 'hubspot']);
      expect(store.plugins().data.map((p) => p.name)).toEqual(['Ptah Core']);
      expect(store.community().data.map((s) => s.name)).toEqual(['run-tests']);
      expect(store.marketplaces().data.map((l) => l.name)).toEqual(['Alpha']);
      expect(store.counts()).toEqual({
        installed: 2,
        plugins: 1,
        community: 1,
        marketplaces: 1,
      });
    });

    // connected-surface.component.spec.ts:258
    it('keeps one failing slice from hiding the other three', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [diskServer('ptah')] }),
      );
      responders.set('skillsSh:listInstalled', () =>
        fail('skills.sh is unreachable'),
      );
      responders.set('plugins:list-marketplaces', () =>
        ok({
          marketplaces: [],
          suggestions: [],
          installed: [listing('external:owner/repo/alpha', 'Alpha')],
        }),
      );
      enabledPlugins.set([plugin('ptah-core', 'Ptah Core')]);

      await ensureAll();

      expect(store.community()).toEqual({
        state: 'error',
        error: 'skills.sh is unreachable',
        data: [],
      });
      expect(keysOf()).toEqual(['ptah']);
      expect(store.plugins().data.map((p) => p.name)).toEqual(['Ptah Core']);
      expect(store.marketplaces().data.map((l) => l.name)).toEqual(['Alpha']);
      // No store-wide error: the three healthy slices keep their own state.
      const errored = ALL_SLICES.filter((id) => store[id]().state === 'error');
      expect(errored).toEqual(['community']);
    });

    it('turns a thrown read into that slice’s error with the fallback text', async () => {
      responders.set('plugins:list-marketplaces', () => {
        throw new Error('');
      });

      await ensureAll();

      expect(store.marketplaces()).toEqual({
        state: 'error',
        error: 'Could not read installed marketplace plugins.',
        data: [],
      });
      expect(store.installed().state).toBe('ready');
    });

    it('fails the plugins slice when the catalogue publishes an error', async () => {
      catalogError.set('Failed to load plugin config');

      await ensureAll();

      expect(store.plugins()).toEqual({
        state: 'error',
        error: 'Failed to load plugin config',
        data: [],
      });
      expect(store.counts().plugins).toBeNull();
    });

    // connected-surface.component.spec.ts:296
    it('retries only the failed slice', async () => {
      responders.set('skillsSh:listInstalled', () => fail('temporary'));
      await ensureAll();

      calls.length = 0;
      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [skill('run-tests')] }),
      );
      await store.retry('community');
      await settle();

      expect(methodsCalled()).toEqual(['skillsSh:listInstalled']);
      expect(store.community().state).toBe('ready');
      expect(store.community().data.map((s) => s.name)).toEqual(['run-tests']);
    });

    it('does nothing on Retry for a slice that has not failed', async () => {
      await ensureAll();
      calls.length = 0;

      await store.retry('community');
      await store.retry('installed');

      expect(calls).toEqual([]);
    });

    it('retries a failed plugins slice with a catalogue re-read', async () => {
      catalogError.set('Failed to load plugin config');
      await store.ensure('plugins');
      await settle();

      catalogError.set(null);
      await store.retry('plugins');
      await settle();

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(store.plugins().state).toBe('ready');
    });

    it('makes no status-decoration read (that moved to ConnectorLinksStore)', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [smitheryServer('hubspot'), oauthServer('sentry')] }),
      );

      await store.ensure('installed');
      await settle();

      expect(keysOf()).toEqual(['hubspot', 'sentry']);
      expect(methodsCalled()).toEqual(['mcpDirectory:listInstalled']);
    });

    // connected-surface.component.spec.ts:575
    it('reloads every loaded slice and clears the command cache on content change', async () => {
      await ensureAll();
      calls.length = 0;

      store.notifyContentChanged();
      await settle();

      expect(clearCache).toHaveBeenCalledTimes(1);
      expect(methodsCalled()).toEqual(
        expect.arrayContaining([
          'mcpDirectory:listInstalled',
          'skillsSh:listInstalled',
          'plugins:list-marketplaces',
        ]),
      );
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('reloads only non-idle slices on content change', async () => {
      await store.ensure('community');
      await settle();
      calls.length = 0;

      store.notifyContentChanged();
      await settle();

      expect(methodsCalled()).toEqual(['skillsSh:listInstalled']);
      expect(refresh).not.toHaveBeenCalled();
      expect(store.installed().state).toBe('idle');
      expect(store.plugins().state).toBe('idle');
      expect(store.marketplaces().state).toBe('idle');
      expect(clearCache).toHaveBeenCalledTimes(1);
    });

    it('drops a superseded read so a Retry cannot land out of order', async () => {
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      const queue = [first, second];
      responders.set('skillsSh:listInstalled', () => {
        const next = queue.shift();
        if (!next) throw new Error('unexpected read');
        return next.promise;
      });

      void store.ensure('community');
      void store.reload('community');
      second.resolve(ok({ skills: [skill('newer')] }));
      await settle();
      first.resolve(ok({ skills: [skill('older')] }));
      await settle();

      expect(store.community().data.map((s) => s.name)).toEqual(['newer']);
      expect(store.community().state).toBe('ready');
    });
  });

  // ── Migrated: connector rows (hub spec + connected-surface spec) ───────────

  describe('claude.ai connector rows', () => {
    const report = (sessionId: string, names: readonly string[]): void => {
      mcpStatus.record(sessionId, {
        servers: names.map((name) => ({ name, status: 'connected' as const })),
        notices: [],
      });
    };

    // marketplace-hub.component.spec.ts:157
    it('adds a row for each account connector the newest session reported', async () => {
      report('session-a', ['Gmail', 'Google Calendar']);

      await store.ensure('installed');
      await settle();

      const groups = store.installed().data;
      expect(groups.map((g) => g.serverKey)).toEqual([
        'Gmail',
        'Google Calendar',
      ]);
      expect(groups.map((g) => g.originLabel)).toEqual([
        'claude.ai connector',
        'claude.ai connector',
      ]);
      expect(store.counts().installed).toBe(2);
    });

    // marketplace-hub.component.spec.ts:176, connected-surface…spec.ts:356
    it('gives a connector row no removal and says where it is managed', async () => {
      report('session-a', ['Canva']);
      await store.ensure('installed');
      await settle();
      calls.length = 0;

      const canva = groupFor('Canva');
      expect(canva.removal).toBe('none');
      const lock = removalLockOf(canva);
      expect(lock?.reason).toContain('claude.ai');
      expect(lock?.fixCommand).toBeUndefined();

      const outcome = await store.removeServer(canva, {
        confirmedDirect: true,
      });

      expect(outcome).toEqual({
        status: 'refused',
        reason: 'blocked',
        message: lock?.reason,
        lock: { reason: lock?.reason },
      });
      expect(calls).toEqual([]);
      expect(clearCache).not.toHaveBeenCalled();
    });

    // marketplace-hub.component.spec.ts:193, connected-surface…spec.ts:325
    it('does not re-list a server that already reaches the slice from disk', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [diskServer('ptah'), diskServer('firecrawl')] }),
      );
      report('session-a', ['ptah', 'firecrawl', 'Gmail']);

      await store.ensure('installed');
      await settle();

      // Two disk rows plus exactly one connector row.
      expect(keysOf()).toEqual(['ptah', 'firecrawl', 'Gmail']);
      expect(groupFor('ptah').origin).toBe('harness-config');
      expect(groupFor('Gmail').origin).toBe('claude-connector');
    });

    // marketplace-hub.component.spec.ts:214
    it('reads the most recently recorded session', async () => {
      report('older', ['Gmail']);
      report('newer', ['Canva']);

      await store.ensure('installed');
      await settle();

      expect(keysOf()).toEqual(['Canva']);
      expect(store.newestSessionStatus()?.servers.map((s) => s.name)).toEqual([
        'Canva',
      ]);
    });

    // marketplace-hub.component.spec.ts:231
    it('degrades to the installed read alone when no session ever reported', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [diskServer('ptah')] }),
      );

      await store.ensure('installed');
      await settle();

      expect(store.newestSessionStatus()).toBeNull();
      expect(keysOf()).toEqual(['ptah']);
    });

    // connected-surface.component.spec.ts:335
    it('re-derives the rows when a session reports later, without a new read', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [diskServer('ptah')] }),
      );
      await store.ensure('installed');
      await settle();
      calls.length = 0;

      report('session-a', ['Gmail', 'ptah']);

      expect(keysOf()).toEqual(['ptah', 'Gmail']);
      expect(calls).toEqual([]);
    });

    it('lists no connector row before the installed read lands', () => {
      report('session-a', ['Gmail']);

      expect(store.installed().data).toEqual([]);
      void store.ensure('installed');
      expect(store.installed().state).toBe('loading');
      expect(store.installed().data).toEqual([]);
    });
  });

  // ── removalFixCommand only on blocked rows ─────────────────────────────────

  describe('removal locks', () => {
    const group = (server: InstalledMcpServer): InstalledServerGroup => ({
      key: `${server.origin} ${server.serverKey}`,
      serverKey: server.serverKey,
      origin: server.origin,
      originLabel: server.originLabel,
      showOriginLabel: server.origin !== 'harness-config',
      removal: server.removal,
      removalBlockedReason: server.removalBlockedReason,
      ...(server.removalFixCommand === undefined
        ? {}
        : { removalFixCommand: server.removalFixCommand }),
      servers: [server],
      targets: server.target ? [server.target] : [],
      configPaths: server.configPath ? [server.configPath] : [],
    });

    it('carries the fix command of a blocked row', () => {
      const blocked = group(
        userServer('sentry', 'claude mcp remove sentry --scope user'),
      );

      expect(removalLockOf(blocked)).toEqual({
        reason: 'Declared in your Claude user config.',
        fixCommand: 'claude mcp remove sentry --scope user',
      });
    });

    it('omits the command when a blocked row has none', () => {
      const lock = removalLockOf(group(userServer('sentry')));

      expect(lock).toEqual({ reason: 'Declared in your Claude user config.' });
      expect(lock && 'fixCommand' in lock).toBe(false);
    });

    it.each(['ptah-managed', 'direct', 'smithery', 'oauth'] as const)(
      'ignores a fix command on a removable %s row',
      (removal) => {
        const removable = group({
          ...diskServer('ptah'),
          removal,
          removalFixCommand: 'claude mcp remove ptah',
        });

        expect(removalLockOf(removable)).toBeNull();
      },
    );

    it('removes a removable row that carries a stray fix command normally', async () => {
      responders.set('mcpDirectory:uninstall', () =>
        ok({ results: [{ target: 'claude', success: true }] }),
      );
      const removable = group({
        ...diskServer('ptah'),
        removalFixCommand: 'claude mcp remove ptah',
      });

      const outcome = await store.removeServer(removable);

      expect(outcome).toEqual({ status: 'removed' });
      expect(methodsCalled()).toEqual(['mcpDirectory:uninstall']);
    });

    it('refuses a blocked row with its lock and fix command, calling nothing', async () => {
      const blocked = group(
        userServer('sentry', 'claude mcp remove sentry --scope user'),
      );

      const outcome = await store.removeServer(blocked);

      expect(outcome).toEqual({
        status: 'refused',
        reason: 'blocked',
        message: 'Declared in your Claude user config.',
        lock: {
          reason: 'Declared in your Claude user config.',
          fixCommand: 'claude mcp remove sentry --scope user',
        },
      });
      expect(calls).toEqual([]);
    });

    it('never puts an env or header value into a store-authored message', async () => {
      const blocked = group(userServer('sentry'));
      const direct = group(directServer('local-tool'));

      const outcomes = await store.removeMany([
        { kind: 'server', group: blocked },
        { kind: 'server', group: direct },
      ]);

      const text = JSON.stringify([
        outcomes.map((r) => r.outcome),
        removalLockOf(blocked),
        store.installed(),
      ]);
      expect(text).not.toContain(SECRET);
    });
  });

  // ── Removal ────────────────────────────────────────────────────────────────

  describe('removal routing (connected-surface spec)', () => {
    // connected-surface.component.spec.ts:422
    it('routes an MCP group through its removal kind', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [smitheryServer('hubspot'), oauthServer('sentry')] }),
      );
      responders.set('mcpDirectory:uninstallSmithery', () =>
        ok({ success: true }),
      );
      responders.set('mcpDirectory:disconnectOAuth', () =>
        ok({ success: true }),
      );
      await store.ensure('installed');
      await settle();
      calls.length = 0;

      await store.removeServer(groupFor('hubspot'));
      await store.removeServer(groupFor('sentry'));

      expect(paramsOf('mcpDirectory:uninstallSmithery')).toEqual({
        serverKey: 'hubspot',
      });
      expect(paramsOf('mcpDirectory:disconnectOAuth')).toEqual({
        serverKey: 'sentry',
      });
    });

    it('uninstalls a Ptah-managed server without force', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [diskServer('ptah')] }),
      );
      responders.set('mcpDirectory:uninstall', () =>
        ok({ results: [{ target: 'claude', success: true }] }),
      );
      await store.ensure('installed');
      await settle();

      const outcome = await store.removeServer(groupFor('ptah'));

      expect(outcome).toEqual({ status: 'removed' });
      expect(paramsOf('mcpDirectory:uninstall')).toEqual({
        serverKey: 'ptah',
        targets: ['claude'],
      });
    });

    it('refuses a direct row without confirmation and calls nothing', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [directServer('local-tool')] }),
      );
      await store.ensure('installed');
      await settle();
      calls.length = 0;

      const outcome = await store.removeServer(groupFor('local-tool'));

      expect(outcome).toMatchObject({
        status: 'refused',
        reason: 'needs-confirmation',
      });
      expect(calls).toEqual([]);
      expect(clearCache).not.toHaveBeenCalled();
      expect(keysOf()).toEqual(['local-tool']);
    });

    it('removes a confirmed direct row with force', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [directServer('local-tool')] }),
      );
      responders.set('mcpDirectory:uninstall', () =>
        ok({ results: [{ target: 'cursor', success: true }] }),
      );
      await store.ensure('installed');
      await settle();

      const outcome = await store.removeServer(groupFor('local-tool'), {
        confirmedDirect: true,
      });

      expect(outcome).toEqual({ status: 'removed' });
      expect(paramsOf('mcpDirectory:uninstall')).toEqual({
        serverKey: 'local-tool',
        targets: ['cursor'],
        force: true,
      });
    });

    // connected-surface.component.spec.ts:445
    it('uninstalls a community skill by name, then clears the cache and reloads', async () => {
      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [skill('run-tests')] }),
      );
      responders.set('skillsSh:uninstall', () => ok({ success: true }));
      await store.ensure('community');
      await settle();
      calls.length = 0;

      const outcome = await store.removeCommunitySkill('run-tests');
      await settle();

      expect(outcome).toEqual({ status: 'removed' });
      expect(paramsOf('skillsSh:uninstall')).toEqual({ name: 'run-tests' });
      // The hub's content-changed side effect (marketplace-hub.component.ts:168-171)
      // now runs here: one cache clear and one reload of the loaded slice.
      expect(clearCache).toHaveBeenCalledTimes(1);
      expect(methodsCalled()).toEqual([
        'skillsSh:uninstall',
        'skillsSh:listInstalled',
      ]);
    });

    // connected-surface.component.spec.ts:480
    it('uninstalls a marketplace plugin by plugin id', async () => {
      responders.set('plugins:uninstall-external', () =>
        ok({ pluginId: 'external:owner/repo/alpha', removed: true }),
      );

      const outcome = await store.removeMarketplacePlugin(
        listing('external:owner/repo/alpha', 'Alpha'),
      );

      expect(outcome).toEqual({ status: 'removed' });
      expect(paramsOf('plugins:uninstall-external')).toEqual({
        pluginId: 'external:owner/repo/alpha',
      });
    });

    it('reports a marketplace plugin that was already gone as a failure', async () => {
      responders.set('plugins:uninstall-external', () =>
        ok({ pluginId: 'external:owner/repo/alpha', removed: false }),
      );

      const outcome = await store.removeMarketplacePlugin(
        listing('external:owner/repo/alpha', 'Alpha'),
      );

      expect(outcome).toEqual({
        status: 'failed',
        message: '"Alpha" was already gone; nothing was removed.',
      });
      expect(store.marketplaces().actionError).toBe(
        '"Alpha" was already gone; nothing was removed.',
      );
    });

    // connected-surface.component.spec.ts:501
    it('leaves the row in place and reports a refused removal inline', async () => {
      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [skill('run-tests')] }),
      );
      responders.set('skillsSh:uninstall', () =>
        ok({ success: false, error: 'file is locked' }),
      );
      await store.ensure('community');
      await settle();
      calls.length = 0;

      const outcome = await store.removeCommunitySkill('run-tests');
      await settle();

      expect(outcome).toEqual({ status: 'failed', message: 'file is locked' });
      expect(store.community()).toEqual({
        state: 'ready',
        data: [skill('run-tests')],
        actionError: 'file is locked',
      });
      expect(clearCache).not.toHaveBeenCalled();
      expect(methodsCalled()).toEqual(['skillsSh:uninstall']);
    });

    it('reports a thrown removal inline and keeps the row', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [smitheryServer('hubspot')] }),
      );
      responders.set('mcpDirectory:uninstallSmithery', () => {
        throw new Error('socket closed');
      });
      await store.ensure('installed');
      await settle();

      const outcome = await store.removeServer(groupFor('hubspot'));

      expect(outcome).toEqual({ status: 'failed', message: 'socket closed' });
      expect(store.installed().actionError).toBe('socket closed');
      expect(keysOf()).toEqual(['hubspot']);
      expect(store.pendingIds().size).toBe(0);
    });

    it('marks only the affected row pending and refuses a duplicate removal', async () => {
      const gate = deferred<unknown>();
      responders.set('skillsSh:uninstall', () => gate.promise);

      const first = store.removeCommunitySkill('run-tests');
      const id = removalIdOf({ kind: 'community-skill', name: 'run-tests' });
      expect(Array.from(store.pendingIds())).toEqual([id]);

      const duplicate = await store.removeCommunitySkill('run-tests');
      expect(duplicate).toMatchObject({
        status: 'refused',
        reason: 'in-progress',
      });

      gate.resolve(ok({ success: true }));
      await first;

      expect(store.pendingIds().size).toBe(0);
      expect(methodsCalled()).toEqual(['skillsSh:uninstall']);
    });

    it('identifies removal targets by their route refs', () => {
      expect(
        removalIdOf({
          kind: 'marketplace-plugin',
          listing: listing('external:owner/repo/alpha', 'Alpha'),
        }),
      ).toBe('marketplace-plugin:external:owner/repo/alpha');
      expect(removalIdOf({ kind: 'community-skill', name: 'run-tests' })).toBe(
        'community-skill:run-tests',
      );
    });
  });

  describe('removeMany', () => {
    it('keeps going after a failure and reports each item', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({
          servers: [smitheryServer('hubspot'), directServer('local-tool')],
        }),
      );
      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [skill('run-tests'), skill('lint')] }),
      );
      responders.set('mcpDirectory:uninstallSmithery', () =>
        ok({ success: false, error: 'Smithery said no' }),
      );
      responders.set('skillsSh:uninstall', () => ok({ success: true }));
      await store.ensure('installed');
      await store.ensure('community');
      await settle();
      calls.length = 0;

      const results = await store.removeMany([
        { kind: 'server', group: groupFor('hubspot') },
        { kind: 'server', group: groupFor('local-tool') },
        { kind: 'community-skill', name: 'run-tests' },
        { kind: 'community-skill', name: 'lint' },
      ]);
      await settle();

      expect(results.map((r) => [r.id, r.outcome.status])).toEqual([
        ['smithery:hubspot', 'failed'],
        ['harness-config:local-tool', 'refused'],
        ['community-skill:run-tests', 'removed'],
        ['community-skill:lint', 'removed'],
      ]);
      // Sequential, in order; the refused direct row reached no RPC.
      expect(
        methodsCalled().filter((m) => !m.endsWith('listInstalled')),
      ).toEqual([
        'mcpDirectory:uninstallSmithery',
        'skillsSh:uninstall',
        'skillsSh:uninstall',
      ]);
      // One reload for the whole batch, not one per success.
      expect(clearCache).toHaveBeenCalledTimes(1);
      expect(
        methodsCalled().filter((m) => m === 'skillsSh:listInstalled'),
      ).toHaveLength(1);
      // The failure survives the reload the successes triggered.
      expect(store.installed().state).toBe('ready');
      expect(store.installed().actionError).toBe('Smithery said no');
      expect(store.pendingIds().size).toBe(0);
    });

    it('does not reload when nothing was removed', async () => {
      responders.set('skillsSh:uninstall', () =>
        ok({ success: false, error: 'locked' }),
      );

      const results = await store.removeMany([
        { kind: 'community-skill', name: 'a' },
        { kind: 'community-skill', name: 'b' },
      ]);

      expect(results.map((r) => r.outcome.status)).toEqual([
        'failed',
        'failed',
      ]);
      expect(clearCache).not.toHaveBeenCalled();
      expect(store.community().actionError).toBe('2 removals failed. locked');
    });
  });

  // ── Workspace switch (TASK_2026_540 item 6b) ────────────────────────────────

  describe('workspace switch', () => {
    it('reloads the loaded slices on a generation bump without any navigation', async () => {
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigate');
      const navigateByUrl = jest.spyOn(router, 'navigateByUrl');
      const events: RouterEvent[] = [];
      const subscription = router.events.subscribe((e) => events.push(e));

      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [skill('from-a')] }),
      );
      await store.ensure('community');
      await store.ensure('plugins');
      await settle();
      calls.length = 0;

      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [skill('from-b')] }),
      );
      scope.switchTo('/workspace/b');
      TestBed.tick();
      // The previous workspace's rows are gone the moment the reload starts.
      expect(store.community()).toEqual({ state: 'loading', data: [] });
      await settle();

      expect(methodsCalled()).toEqual(['skillsSh:listInstalled']);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(store.community().data.map((s) => s.name)).toEqual(['from-b']);
      // Idle slices stay idle.
      expect(store.installed().state).toBe('idle');
      expect(store.marketplaces().state).toBe('idle');
      expect(navigate).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      subscription.unsubscribe();
    });

    it('does nothing on a generation bump when no slice was loaded', async () => {
      scope.switchTo('/workspace/b');
      TestBed.tick();
      await settle();

      expect(calls).toEqual([]);
      expect(ensureLoaded).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('drops a read that started under the previous workspace', async () => {
      const gate = deferred<unknown>();
      responders.set('skillsSh:listInstalled', () => gate.promise);
      void store.ensure('community');

      // The switch lands and the old answer arrives before the reload is
      // flushed. Whether or not the scheduler already ran the effect, the old
      // workspace's answer must never be published.
      scope.switchTo('/workspace/b');
      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [skill('from-b')] }),
      );
      gate.resolve(ok({ skills: [skill('from-a')] }));
      await settle();
      expect(store.community().data.map((s) => s.name)).not.toContain('from-a');

      TestBed.tick();
      await settle();

      expect(store.community().data.map((s) => s.name)).toEqual(['from-b']);
    });
  });

  describe('destroy', () => {
    it('publishes nothing that lands after the shell is gone', async () => {
      const injector = createEnvironmentInjector(
        [MarketplaceInventoryStore],
        TestBed.inject(EnvironmentInjector),
      );
      const scoped = injector.get(MarketplaceInventoryStore);
      const gate = deferred<unknown>();
      responders.set('skillsSh:listInstalled', () => gate.promise);

      void scoped.ensure('community');
      injector.destroy();
      gate.resolve(ok({ skills: [skill('late')] }));
      await settle();

      expect(scoped.community()).toEqual({ state: 'loading', data: [] });
    });

    it.each([
      ['succeeds', ok({ success: true })],
      ['is refused', ok({ success: false, error: 'file is locked' })],
    ])(
      'publishes nothing when a removal in flight %s after the shell is gone',
      async (_label, response) => {
        const injector = createEnvironmentInjector(
          [MarketplaceInventoryStore],
          TestBed.inject(EnvironmentInjector),
        );
        const scoped = injector.get(MarketplaceInventoryStore);
        responders.set('skillsSh:listInstalled', () =>
          ok({ skills: [skill('run-tests')] }),
        );
        await scoped.ensure('community');
        await settle();

        const gate = deferred<unknown>();
        responders.set('skillsSh:uninstall', () => gate.promise);
        const removal = scoped.removeCommunitySkill('run-tests');
        const id = removalIdOf({ kind: 'community-skill', name: 'run-tests' });
        expect(scoped.pendingIds().has(id)).toBe(true);

        injector.destroy();
        const pendingAtDestroy = scoped.pendingIds();
        const communityAtDestroy = scoped.community();
        const countsAtDestroy = scoped.counts();
        calls.length = 0;

        gate.resolve(response);
        await removal;
        await settle();

        // Every writer on the removal path stays silent: the pending set
        // (`setPending`), the inline error (`setActionError`), and the
        // cache clear + slice reload (`notifyContentChanged`).
        expect(scoped.pendingIds()).toBe(pendingAtDestroy);
        expect(scoped.community()).toBe(communityAtDestroy);
        expect(scoped.community().actionError).toBeUndefined();
        expect(scoped.counts()).toBe(countsAtDestroy);
        expect(clearCache).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
      },
    );
  });
});
