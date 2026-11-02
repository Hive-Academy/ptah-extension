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
 * Install scope (TASK_2026_853 F-D1): row scope for MCP groups (including
 * external-plugin intent rows) and skills, which rows may be made global, and
 * the `mcpDirectory:makeGlobal` / `skillsSh:makeGlobal` conversions with their
 * fixed copy, opt-in home targets, in-flight refusal and reload on success.
 *
 * `ClaudeRpcService` is mocked per method. `PluginCatalogService` is stubbed to
 * the four members the store reads; its own caching is covered in `core`.
 * `WorkspaceScopeService` and `SessionMcpStatusRegistry` are the real root
 * services. `TabManagerService` is a stub whose writable `tabs` is the active
 * workspace's tab set (plan Revision 3, D-4): the real one needs
 * `MODEL_REFRESH_CONTROL`, which has no default provider.
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
  VSCodeService,
  WorkspaceScopeService,
} from '@ptah-extension/core';
import {
  SessionMcpStatusRegistry,
  TabManagerService,
} from '@ptah-extension/chat-state';
import type { InstalledServerGroup } from '@ptah-extension/chat-ui';
import {
  MCP_DIRECTORY_CALL_FAILURE_COPY,
  MESSAGE_TYPES,
  type CloneSummary,
  type ExternalPluginListing,
  type InstalledMcpServer,
  type InstalledSkill,
  type PluginInfo,
} from '@ptah-extension/shared';
import { LibraryChangeFeed } from '../services/library-change-feed';
import {
  MarketplaceInventoryStore,
  canMakeServerGlobal,
  canMakeSkillGlobal,
  removalIdOf,
  removalLockOf,
  serverGroupScope,
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

/** The two `TabState` fields the session scoping reads. */
interface TabStub {
  readonly id: string;
  readonly claudeSessionId: string | null;
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
  let tabs: ReturnType<typeof signal<readonly TabStub[]>>;
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
    tabs = signal<readonly TabStub[]>([]);

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
        { provide: TabManagerService, useValue: { tabs } },
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

    it('fails the installed slice with the coded copy instead of showing zero servers', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({
          servers: [],
          code: 'intent-unreadable',
          error: MCP_DIRECTORY_CALL_FAILURE_COPY['intent-unreadable'],
        }),
      );

      await store.ensure('installed');
      await settle();

      expect(store.installed().state).toBe('error');
      expect(store.installed().error).toBe(
        MCP_DIRECTORY_CALL_FAILURE_COPY['intent-unreadable'],
      );
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
    const record = (key: string, names: readonly string[]): void => {
      mcpStatus.record(key, {
        servers: names.map((name) => ({ name, status: 'connected' as const })),
        notices: [],
      });
    };

    /** A session of the ACTIVE workspace: its tab is open, then it reports. */
    const report = (sessionId: string, names: readonly string[]): void => {
      if (!tabs().some((tab) => tab.claudeSessionId === sessionId)) {
        tabs.update((open) => [
          ...open,
          { id: `tab-${sessionId}`, claudeSessionId: sessionId },
        ]);
      }
      record(sessionId, names);
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

    // ── Revision 3, D-4: only sessions of the active workspace count ────────

    // Spec 8
    it('ignores a newer session that has no tab in the active workspace', async () => {
      report('session-a', ['Gmail']);
      record('background-session', ['Canva', 'b-project-server']);

      await store.ensure('installed');
      await settle();

      expect(keysOf()).toEqual(['Gmail']);
      expect(store.newestSessionStatus()?.servers.map((s) => s.name)).toEqual([
        'Gmail',
      ]);
    });

    // Spec 9
    it("never labels workspace A's project server a connector in B", async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [diskServer('a-project-server')] }),
      );
      report('session-a', ['a-project-server']);
      await store.ensure('installed');
      await settle();
      expect(groupFor('a-project-server').origin).toBe('harness-config');

      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [diskServer('b-server')] }),
      );
      // The coordinator swaps the tab set in the same fan-out as the switch.
      scope.switchTo('/workspace/b');
      tabs.set([]);
      TestBed.tick();
      await settle();

      expect(store.installed().state).toBe('ready');
      expect(keysOf()).toEqual(['b-server']);
      expect(
        store
          .installed()
          .data.filter((group) => group.origin === 'claude-connector'),
      ).toEqual([]);
      expect(store.newestSessionStatus()).toBeNull();
    });

    // Spec 10
    it('adds connector rows once a session of B reports, without a new read', async () => {
      report('session-a', ['Gmail']);
      await store.ensure('installed');
      await settle();

      scope.switchTo('/workspace/b');
      tabs.set([]);
      TestBed.tick();
      await settle();
      expect(keysOf()).toEqual([]);
      calls.length = 0;

      // A fresh B tab streams under its tabId before the SDK id is known.
      tabs.set([{ id: 'tab-b', claudeSessionId: null }]);
      record('tab-b', ['Canva']);

      expect(keysOf()).toEqual(['Canva']);
      expect(groupFor('Canva').origin).toBe('claude-connector');
      expect(calls).toEqual([]);
    });

    // Accepted behaviour change (plan Revision 3): a closed tab's session.
    it("drops a session's connector rows when its tab closes", async () => {
      report('session-a', ['Gmail']);
      await store.ensure('installed');
      await settle();
      expect(keysOf()).toEqual(['Gmail']);
      calls.length = 0;

      tabs.set([]);

      expect(keysOf()).toEqual([]);
      expect(store.newestSessionStatus()).toBeNull();
      expect(calls).toEqual([]);
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

  // ── Library copies for the agent shadow state (F7f) ────────────────────────

  describe('library copies (F7f)', () => {
    const clone = (slug: string): CloneSummary => ({
      slug,
      kind: 'agent',
      cloneStatus: 'clone',
      diverged: false,
      invocationCount: 0,
      successRate: null,
      lastEnhancedAt: null,
      historyCount: 0,
      pendingSourceHash: null,
      enhanceMinInvocations: 3,
      enhanceCooldownUntil: null,
      provenance: { kind: 'setup-wizard' },
    });

    const asElectron = (): void => {
      jest
        .spyOn(TestBed.inject(VSCodeService), 'isElectron', 'get')
        .mockReturnValue(true);
    };

    it('reads nothing outside Electron', async () => {
      await store.ensure('plugins');
      await settle();

      expect(methodsCalled()).not.toContain('skillSynthesis:listClones');
      expect(store.libraryClones()).toEqual([]);
    });

    it('reads the copies with the plugins slice in Electron', async () => {
      asElectron();
      responders.set('skillSynthesis:listClones', () =>
        ok({ clones: [clone('release-manager')] }),
      );
      await store.ensure('plugins');
      await settle();

      expect(methodsCalled()).toEqual(['skillSynthesis:listClones']);
      expect(store.plugins().state).toBe('ready');
      expect(store.libraryClones().map((c) => c.slug)).toEqual([
        'release-manager',
      ]);
    });

    it('degrades to no copies when the read fails, keeping the plugins', async () => {
      asElectron();
      responders.set('skillSynthesis:listClones', () => fail('no library'));
      enabledPlugins.set([plugin('ptah-core', 'Ptah Core')]);
      await store.ensure('plugins');
      await settle();

      expect(store.plugins().state).toBe('ready');
      expect(store.plugins().data).toHaveLength(1);
      expect(store.libraryClones()).toEqual([]);
    });

    it('drops the copies on a workspace switch and reads the new ones', async () => {
      asElectron();
      responders.set('skillSynthesis:listClones', () =>
        ok({ clones: [clone('from-a')] }),
      );
      await store.ensure('plugins');
      await settle();
      expect(store.libraryClones().map((c) => c.slug)).toEqual(['from-a']);

      const gate = deferred<unknown>();
      responders.set('skillSynthesis:listClones', () => gate.promise);
      scope.switchTo('/workspace/b');
      TestBed.tick();

      // Gone the moment the switch lands, before the new read answers.
      expect(store.libraryClones()).toEqual([]);

      gate.resolve(ok({ clones: [clone('from-b')] }));
      await settle();
      expect(store.libraryClones().map((c) => c.slug)).toEqual(['from-b']);
    });
  });

  // ── library:changed pushes and the failed-pass state (P3 L2) ────────────────

  describe('library:changed pushes', () => {
    const ROOT = '/workspace/a';
    const copy = (slug: string): CloneSummary => ({
      slug,
      kind: 'agent',
      cloneStatus: 'clone',
      diverged: false,
      invocationCount: 0,
      successRate: null,
      lastEnhancedAt: null,
      historyCount: 0,
      pendingSourceHash: null,
      enhanceMinInvocations: 3,
      enhanceCooldownUntil: null,
      provenance: { kind: 'workspace' },
    });

    const asElectron = (): void => {
      jest
        .spyOn(TestBed.inject(VSCodeService), 'isElectron', 'get')
        .mockReturnValue(true);
    };
    const push = (status: 'updated' | 'failed', workspaceRoot = ROOT): void => {
      TestBed.inject(LibraryChangeFeed).handleMessage({
        type: MESSAGE_TYPES.LIBRARY_CHANGED,
        payload: { workspaceRoot, status, reasons: ['setup-wizard'] },
      });
      TestBed.tick();
    };
    const listCloneCalls = (): number =>
      methodsCalled().filter((m) => m === 'skillSynthesis:listClones').length;

    beforeEach(() => {
      asElectron();
      responders.set('skillSynthesis:listClones', () =>
        ok({ clones: [copy('from-a')], scopeRoot: ROOT }),
      );
    });

    it('reads nothing for a push before any slice was requested', async () => {
      push('failed');
      await settle();

      expect(calls).toEqual([]);
      expect(store.libraryPassFailed()).toBe(false);
    });

    it('reloads only the requested slices and clears the autocomplete cache', async () => {
      await store.ensure('plugins');
      await store.ensure('community');
      await settle();
      calls.length = 0;

      responders.set('skillSynthesis:listClones', () =>
        ok({ clones: [copy('from-a'), copy('new-one')], scopeRoot: ROOT }),
      );
      push('updated');
      await settle();

      expect([...methodsCalled()].sort()).toEqual([
        'skillSynthesis:listClones',
        'skillsSh:listInstalled',
      ]);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(clearCache).toHaveBeenCalled();
      expect(store.libraryClones().map((c) => c.slug)).toEqual([
        'from-a',
        'new-one',
      ]);
      expect(store.libraryPassFailed()).toBe(false);
    });

    it('ignores the push the feed held before the store existed', async () => {
      push('failed');
      const injector = createEnvironmentInjector(
        [MarketplaceInventoryStore],
        TestBed.inject(EnvironmentInjector),
      );
      const fresh = injector.get(MarketplaceInventoryStore);
      await fresh.ensure('plugins');
      await settle();
      TestBed.tick();
      await settle();

      expect(listCloneCalls()).toBe(1);
      expect(fresh.libraryPassFailed()).toBe(false);
      injector.destroy();
    });

    it('sets the failed-pass state for a failed pass of this root, clears it on a good one', async () => {
      await store.ensure('plugins');
      await settle();

      push('failed');
      await settle();
      expect(listCloneCalls()).toBe(2);
      expect(store.libraryPassFailed()).toBe(true);

      push('updated');
      await settle();
      expect(store.libraryPassFailed()).toBe(false);
    });

    it('leaves the state alone for a pass of another root', async () => {
      await store.ensure('plugins');
      await settle();

      push('failed', '/workspace/other');
      await settle();

      expect(listCloneCalls()).toBe(2);
      expect(store.libraryPassFailed()).toBe(false);
    });

    it('records nothing when the host sends no scopeRoot', async () => {
      responders.set('skillSynthesis:listClones', () =>
        ok({ clones: [copy('from-a')] }),
      );
      await store.ensure('plugins');
      await settle();

      push('failed');
      await settle();

      expect(store.libraryPassFailed()).toBe(false);
    });

    it('drops the reply of a reload that a workspace switch overtook', async () => {
      await store.ensure('plugins');
      await settle();

      const stale = deferred<unknown>();
      responders.set('skillSynthesis:listClones', () => stale.promise);
      push('failed');

      // The switch lands while the push's read is in flight.
      const fresh = deferred<unknown>();
      responders.set('skillSynthesis:listClones', () => fresh.promise);
      scope.switchTo('/workspace/b');
      TestBed.tick();

      stale.resolve(ok({ clones: [copy('stale-a')], scopeRoot: ROOT }));
      await settle();
      expect(store.libraryClones()).toEqual([]);
      expect(store.libraryPassFailed()).toBe(false);

      fresh.resolve(
        ok({ clones: [copy('from-b')], scopeRoot: '/workspace/b' }),
      );
      await settle();
      expect(store.libraryClones().map((c) => c.slug)).toEqual(['from-b']);
      expect(store.libraryPassFailed()).toBe(false);
    });

    it('clears the failed-pass state on a workspace switch', async () => {
      await store.ensure('plugins');
      await settle();
      push('failed');
      await settle();
      expect(store.libraryPassFailed()).toBe(true);

      scope.switchTo('/workspace/b');
      TestBed.tick();

      expect(store.libraryPassFailed()).toBe(false);
    });

    describe('recordLibraryPass', () => {
      it('sets the state for the current workspace and clears it on updated', () => {
        const generation = scope.generation();
        store.recordLibraryPass('failed', generation);
        expect(store.libraryPassFailed()).toBe(true);

        store.recordLibraryPass('not-applicable', generation);
        store.recordLibraryPass(undefined, generation);
        expect(store.libraryPassFailed()).toBe(true);

        store.recordLibraryPass('updated', generation);
        expect(store.libraryPassFailed()).toBe(false);
      });

      it('drops an answer for a workspace that is no longer active', () => {
        const generation = scope.generation();
        scope.switchTo('/workspace/b');
        TestBed.tick();

        store.recordLibraryPass('failed', generation);

        expect(store.libraryPassFailed()).toBe(false);
      });

      it('records nothing outside Electron', () => {
        jest
          .spyOn(TestBed.inject(VSCodeService), 'isElectron', 'get')
          .mockReturnValue(false);

        store.recordLibraryPass('failed', scope.generation());

        expect(store.libraryPassFailed()).toBe(false);
      });
    });
  });

  describe('install scope and Make global (F-D1)', () => {
    const workspaceServer = (serverKey: string): InstalledMcpServer => ({
      ...diskServer(serverKey),
      scope: 'workspace',
    });
    const globalServer = (serverKey: string): InstalledMcpServer => ({
      ...diskServer(serverKey),
      configPath: 'C:\\Users\\me\\.ptah\\mcp.json',
      scope: 'global',
    });
    const workspaceSkill = (name: string): InstalledSkill => ({
      ...skill(name),
      scope: 'workspace',
    });

    const loadServers = async (
      servers: InstalledMcpServer[],
    ): Promise<void> => {
      responders.set('mcpDirectory:listInstalled', () => ok({ servers }));
      await store.ensure('installed');
      await settle();
    };

    const callsOf = (method: string): RpcCall[] =>
      calls.filter((c) => c.method === method);

    it('reports each group scope, workspace first, null when the payload names none', async () => {
      await loadServers([
        workspaceServer('acme'),
        globalServer('home'),
        diskServer('legacy'),
        { ...globalServer('mixed'), target: 'codex' },
        workspaceServer('mixed'),
      ]);

      expect(serverGroupScope(groupFor('acme'))).toBe('workspace');
      expect(serverGroupScope(groupFor('home'))).toBe('global');
      expect(serverGroupScope(groupFor('legacy'))).toBeNull();
      expect(serverGroupScope(groupFor('mixed'))).toBe('workspace');
    });

    it("reports Ptah's own unmanaged server as global, with no Make global (visual review V3)", async () => {
      await loadServers([
        { ...directServer('ptah'), target: 'claude', scope: 'workspace' },
        { ...directServer('ptah'), target: 'codex', scope: 'global' },
      ]);

      expect(serverGroupScope(groupFor('ptah'))).toBe('global');
      expect(canMakeServerGlobal(groupFor('ptah'))).toBe(false);
    });

    it('keeps the recorded scope of a Ptah intent named ptah', async () => {
      await loadServers([workspaceServer('ptah')]);

      expect(serverGroupScope(groupFor('ptah'))).toBe('workspace');
    });

    it('offers Make global only for a Ptah-managed workspace harness install', async () => {
      await loadServers([
        workspaceServer('acme'),
        globalServer('home'),
        { ...directServer('hand'), scope: 'workspace' },
        { ...smitheryServer('smith'), scope: 'workspace' },
      ]);

      expect(canMakeServerGlobal(groupFor('acme'))).toBe(true);
      expect(canMakeServerGlobal(groupFor('home'))).toBe(false);
      expect(canMakeServerGlobal(groupFor('hand'))).toBe(false);
      expect(canMakeServerGlobal(groupFor('smith'))).toBe(false);
      expect(canMakeSkillGlobal(workspaceSkill('a'))).toBe(true);
      expect(canMakeSkillGlobal(skill('b'))).toBe(false);
    });

    it('makes a server global with only the ticked home targets, then reloads', async () => {
      await loadServers([workspaceServer('acme')]);
      responders.set('mcpDirectory:makeGlobal', () =>
        ok({
          success: true,
          results: [
            { target: 'claude', success: true, configPath: '.mcp.json' },
            {
              target: 'codex',
              success: false,
              error: 'raw EACCES /home/me/.codex',
            },
          ],
        }),
      );
      const listsBefore = callsOf('mcpDirectory:listInstalled').length;

      const outcome = await store.makeServerGlobal(groupFor('acme'), ['codex']);
      await settle();

      expect(paramsOf('mcpDirectory:makeGlobal')).toEqual({
        serverKey: 'acme',
        homeTargets: ['codex'],
      });
      expect(outcome).toEqual({
        status: 'converted',
        message: 'acme is now available in all workspaces.',
        convertedSkills: [],
        failedTargets: ['codex'],
      });
      expect(callsOf('mcpDirectory:listInstalled').length).toBe(
        listsBefore + 1,
      );
      expect(clearCache).toHaveBeenCalled();
    });

    it('sends an empty home-target list when none were ticked', async () => {
      await loadServers([workspaceServer('acme')]);
      responders.set('mcpDirectory:makeGlobal', () =>
        ok({ success: true, results: [] }),
      );

      await store.makeServerGlobal(groupFor('acme'), []);

      expect(paramsOf('mcpDirectory:makeGlobal')).toEqual({
        serverKey: 'acme',
        homeTargets: [],
      });
    });

    it('answers a refused or thrown conversion with the fixed copy and no reload', async () => {
      await loadServers([workspaceServer('acme')]);
      const listsBefore = callsOf('mcpDirectory:listInstalled').length;

      responders.set('mcpDirectory:makeGlobal', () =>
        ok({ success: false, results: [], error: 'raw /home/me detail' }),
      );
      const refused = await store.makeServerGlobal(groupFor('acme'), []);

      responders.set('mcpDirectory:makeGlobal', () => {
        throw new Error('socket closed /home/me');
      });
      const thrown = await store.makeServerGlobal(groupFor('acme'), []);
      await settle();

      for (const outcome of [refused, thrown]) {
        expect(outcome).toEqual({
          status: 'failed',
          message: 'Could not change where acme is installed.',
        });
      }
      expect(callsOf('mcpDirectory:listInstalled').length).toBe(listsBefore);
      expect(store.convertingIds().size).toBe(0);
    });

    it('refuses a row that cannot be made global without calling the host', async () => {
      await loadServers([globalServer('home')]);

      const outcome = await store.makeServerGlobal(groupFor('home'), []);
      const skillOutcome = await store.makeSkillGlobal(skill('shared'));

      expect(outcome).toMatchObject({
        status: 'refused',
        reason: 'not-convertible',
      });
      expect(skillOutcome).toMatchObject({
        status: 'refused',
        reason: 'not-convertible',
      });
      expect(callsOf('mcpDirectory:makeGlobal')).toHaveLength(0);
      expect(callsOf('skillsSh:makeGlobal')).toHaveLength(0);
    });

    it('marks the row converting while in flight and refuses a second conversion or a removal', async () => {
      await loadServers([workspaceServer('acme')]);
      const gate = deferred<unknown>();
      responders.set('mcpDirectory:makeGlobal', () => gate.promise);
      const group = groupFor('acme');
      const id = removalIdOf({ kind: 'server', group });

      const first = store.makeServerGlobal(group, []);
      expect(store.convertingIds().has(id)).toBe(true);
      expect(store.pendingIds().has(id)).toBe(false);

      const second = await store.makeServerGlobal(group, []);
      const removal = await store.removeServer(group);
      expect(second).toMatchObject({
        status: 'refused',
        reason: 'in-progress',
      });
      expect(removal).toMatchObject({
        status: 'refused',
        reason: 'in-progress',
      });
      expect(callsOf('mcpDirectory:makeGlobal')).toHaveLength(1);

      gate.resolve(ok({ success: true, results: [] }));
      expect((await first).status).toBe('converted');
      expect(store.convertingIds().has(id)).toBe(false);
    });

    it('makes a skills.sh root global and lists every converted skill', async () => {
      responders.set('skillsSh:listInstalled', () =>
        ok({ skills: [workspaceSkill('lint'), workspaceSkill('format')] }),
      );
      await store.ensure('community');
      await settle();
      responders.set('skillsSh:makeGlobal', () =>
        ok({ success: true, convertedSkills: ['lint', 'format'] }),
      );
      const listsBefore = callsOf('skillsSh:listInstalled').length;

      const target = store.community().data[0];
      const outcome = await store.makeSkillGlobal(target);
      await settle();

      expect(paramsOf('skillsSh:makeGlobal')).toEqual({ name: 'lint' });
      expect(outcome).toEqual({
        status: 'converted',
        message: 'lint is now available in all workspaces.',
        convertedSkills: ['lint', 'format'],
        failedTargets: [],
      });
      expect(callsOf('skillsSh:listInstalled').length).toBe(listsBefore + 1);
    });

    it('answers a failed skills conversion with the fixed copy', async () => {
      responders.set('skillsSh:makeGlobal', () =>
        ok({ success: false, error: 'raw /home/me/.ptah detail' }),
      );

      const outcome = await store.makeSkillGlobal(workspaceSkill('lint'));

      expect(outcome).toEqual({
        status: 'failed',
        message: 'Could not change where lint is installed.',
      });
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
