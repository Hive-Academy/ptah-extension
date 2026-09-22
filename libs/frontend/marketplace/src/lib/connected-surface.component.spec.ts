/**
 * ConnectedSurfaceComponent specs.
 *
 * Coverage, in the order the plan pins it:
 *   - All four groups populate from their own RPC.
 *   - ONE failing group renders an inline error and a Retry while the other
 *     three render their rows (requirement 5). This is the whole reason the
 *     loads run under `Promise.allSettled` with per-group state.
 *   - A connector that already reaches the surface from `listInstalled` is
 *     listed once, not twice under two origins.
 *   - A `removal: 'none'` row renders no button and shows why.
 *   - Each remove action reaches the right RPC.
 *   - A per-group empty state emits `navigateRequested` with the right target.
 *   - The two status-decoration reads add badges and never fail a group.
 *
 * `ClaudeRpcService` is mocked per method; `PluginCatalogService` is stubbed to
 * its two members this surface uses, because the surface treats it as a read
 * model and the catalogue's own derivation is covered in `core`.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ClaudeRpcService, PluginCatalogService } from '@ptah-extension/core';
import type {
  InstalledMcpServer,
  PluginInfo,
  ExternalPluginListing,
} from '@ptah-extension/shared';
import { ConnectedSurfaceComponent } from './connected-surface.component';

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

function diskServer(serverKey: string): InstalledMcpServer {
  return {
    serverKey,
    target: 'claude',
    configPath: 'C:\\repo\\.mcp.json',
    config: { type: 'stdio', command: 'npx', args: ['-y', serverKey] },
    managedByPtah: true,
    origin: 'harness-config',
    originLabel: 'harness config',
    removal: 'ptah-managed',
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

function connectorRow(serverKey: string): InstalledMcpServer {
  return {
    serverKey,
    configPath: '',
    config: { type: 'http', url: '' },
    managedByPtah: false,
    origin: 'claude-connector',
    originLabel: 'claude.ai connector',
    removal: 'none',
    removalBlockedReason: 'This connector lives in your claude.ai account.',
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

interface RpcCall {
  method: string;
  params: unknown;
}

describe('ConnectedSurfaceComponent', () => {
  let fixture: ComponentFixture<ConnectedSurfaceComponent>;
  let host: HTMLElement;
  let responders: Map<string, () => unknown>;
  let calls: RpcCall[];
  let enabledPlugins: ReturnType<typeof signal<readonly PluginInfo[]>>;
  let ensureLoaded: jest.Mock<Promise<void>, []>;

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      return Promise.resolve(
        factory ? factory() : fail(`No responder for ${method}`),
      );
    }),
  };

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // The Apps group's status decoration resolves one microtask turn after the
    // rows land, so a second settle is what makes a badge assertable.
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const create = async (
    connectorServers: InstalledMcpServer[] = [],
  ): Promise<void> => {
    fixture = TestBed.createComponent(ConnectedSurfaceComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('connectorServers', connectorServers);
    await settle();
  };

  const group = (id: string): HTMLElement => {
    const element = host.querySelector<HTMLElement>(
      `[data-testid="connected-group-${id}"]`,
    );
    if (!element) throw new Error(`Group '${id}' did not render`);
    return element;
  };

  const rowsIn = (id: string): HTMLElement[] =>
    Array.from(group(id).querySelectorAll('[data-testid="connected-row"]'));

  const titlesIn = (id: string): string[] =>
    rowsIn(id).map(
      (row) =>
        row
          .querySelector('[data-testid="connected-row-title"]')
          ?.textContent?.trim() ?? '',
    );

  const methodsCalled = (): string[] => calls.map((c) => c.method);

  const paramsOf = (method: string): unknown =>
    calls.find((c) => c.method === method)?.params;

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    enabledPlugins = signal<readonly PluginInfo[]>([]);
    ensureLoaded = jest.fn().mockResolvedValue(undefined);

    responders.set('mcpDirectory:listInstalled', () => ok({ servers: [] }));
    responders.set('skillsSh:listInstalled', () => ok({ skills: [] }));
    responders.set('plugins:list-marketplaces', () =>
      ok({ marketplaces: [], suggestions: [], installed: [] }),
    );
    responders.set('mcpDirectory:listSmitheryConnections', () =>
      ok({ connections: [], namespace: 'ns' }),
    );

    TestBed.configureTestingModule({
      imports: [ConnectedSurfaceComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpcMock },
        {
          provide: PluginCatalogService,
          useValue: {
            ensureLoaded: () => ensureLoaded(),
            enabledPlugins: enabledPlugins.asReadonly(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('populates all four groups from their own reads', async () => {
    responders.set('mcpDirectory:listInstalled', () =>
      ok({ servers: [diskServer('ptah'), smitheryServer('hubspot')] }),
    );
    responders.set('skillsSh:listInstalled', () =>
      ok({
        skills: [
          {
            name: 'run-tests',
            description: 'Run the suite',
            source: 'owner/skills',
            path: '/root/skills/run-tests',
            scope: 'global',
          },
        ],
      }),
    );
    responders.set('plugins:list-marketplaces', () =>
      ok({
        marketplaces: [],
        suggestions: [],
        installed: [listing('external:owner/repo/alpha', 'Alpha')],
      }),
    );
    enabledPlugins.set([plugin('ptah-core', 'Ptah Core')]);

    await create();

    expect(titlesIn('apps')).toEqual(['ptah', 'hubspot']);
    expect(titlesIn('plugins')).toEqual(['Ptah Core']);
    expect(titlesIn('community')).toEqual(['run-tests']);
    expect(titlesIn('marketplaces')).toEqual(['Alpha']);
  });

  it('keeps one failing group from hiding the other three', async () => {
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

    await create();

    expect(
      group('community').querySelector(
        '[data-testid="connected-error-community"]',
      )?.textContent,
    ).toContain('skills.sh is unreachable');
    expect(
      group('community').querySelector(
        '[data-testid="connected-retry-community"]',
      ),
    ).toBeTruthy();

    expect(titlesIn('apps')).toEqual(['ptah']);
    expect(titlesIn('plugins')).toEqual(['Ptah Core']);
    expect(titlesIn('marketplaces')).toEqual(['Alpha']);
    // No surface-wide banner: the three healthy groups keep their own state.
    expect(
      host.querySelectorAll('[data-testid^="connected-error-"]'),
    ).toHaveLength(1);
  });

  it('retries only the failed group', async () => {
    responders.set('skillsSh:listInstalled', () => fail('temporary'));
    await create();

    calls.length = 0;
    responders.set('skillsSh:listInstalled', () =>
      ok({
        skills: [
          {
            name: 'run-tests',
            description: '',
            source: 'owner/skills',
            path: '/root/skills/run-tests',
            scope: 'global',
          },
        ],
      }),
    );
    group('community')
      .querySelector<HTMLButtonElement>(
        '[data-testid="connected-retry-community"]',
      )
      ?.click();
    await settle();

    expect(methodsCalled()).toEqual(['skillsSh:listInstalled']);
    expect(titlesIn('community')).toEqual(['run-tests']);
  });

  it('does not re-list a connector that already reaches it from disk', async () => {
    responders.set('mcpDirectory:listInstalled', () =>
      ok({ servers: [diskServer('ptah')] }),
    );

    await create([connectorRow('ptah'), connectorRow('Gmail')]);

    expect(titlesIn('apps')).toEqual(['ptah', 'Gmail']);
  });

  it('re-derives the Apps rows when the connectorServers input changes', async () => {
    responders.set('mcpDirectory:listInstalled', () =>
      ok({ servers: [diskServer('ptah')] }),
    );

    await create();

    calls.length = 0;
    // A new connector appears; one whose serverKey is already installed does
    // not duplicate.
    fixture.componentRef.setInput('connectorServers', [
      connectorRow('Gmail'),
      connectorRow('ptah'),
    ]);
    await settle();

    expect(titlesIn('apps')).toEqual(['ptah', 'Gmail']);
    // Re-derived from the signals, not re-read from the backend.
    expect(methodsCalled()).not.toContain('mcpDirectory:listInstalled');
  });

  it('gives a removal-blocked row no button and says why', async () => {
    await create([connectorRow('Canva')]);

    const [row] = rowsIn('apps');
    expect(row.querySelector('[data-testid="connected-remove"]')).toBeNull();
    expect(
      row.querySelector('[data-testid="removal-blocked"]')?.textContent,
    ).toContain('claude.ai');
  });

  it('decorates Smithery and OAuth rows with their live state', async () => {
    responders.set('mcpDirectory:listInstalled', () =>
      ok({ servers: [smitheryServer('hubspot'), oauthServer('sentry')] }),
    );
    responders.set('mcpDirectory:listSmitheryConnections', () =>
      ok({
        connections: [
          {
            connectionId: 'c1',
            name: 'HubSpot',
            status: 'connected',
            managedByPtah: true,
            serverKey: 'hubspot',
          },
        ],
        namespace: 'ns',
      }),
    );
    responders.set('mcpDirectory:oauthStatus', () => ok({ state: 'expired' }));

    await create();

    const statuses = Array.from(
      group('apps').querySelectorAll('[data-testid="connected-row-status"]'),
    ).map((el) => el.textContent?.trim());
    expect(statuses).toEqual(['connected', 'expired']);
  });

  it('keeps the Apps group healthy when both decoration reads fail', async () => {
    responders.set('mcpDirectory:listInstalled', () =>
      ok({ servers: [smitheryServer('hubspot'), oauthServer('sentry')] }),
    );
    responders.set('mcpDirectory:listSmitheryConnections', () =>
      fail('no api key'),
    );
    responders.set('mcpDirectory:oauthStatus', () => fail('no token'));

    await create();

    expect(titlesIn('apps')).toEqual(['hubspot', 'sentry']);
    expect(
      group('apps').querySelector('[data-testid="connected-error-apps"]'),
    ).toBeNull();
    expect(
      group('apps').querySelectorAll('[data-testid="connected-row-status"]'),
    ).toHaveLength(0);
  });

  describe('removal routing', () => {
    const clickRemove = async (groupId: string): Promise<void> => {
      rowsIn(groupId)[0]
        .querySelector<HTMLButtonElement>('[data-testid="connected-remove"]')
        ?.click();
      await settle();
    };

    it('routes an MCP group through its removal kind', async () => {
      responders.set('mcpDirectory:listInstalled', () =>
        ok({ servers: [smitheryServer('hubspot')] }),
      );
      responders.set('mcpDirectory:uninstallSmithery', () =>
        ok({ success: true }),
      );
      await create();

      expect(
        rowsIn('apps')[0].querySelector('[data-testid="connected-remove"]')
          ?.textContent,
      ).toContain('Disconnect');

      calls.length = 0;
      await clickRemove('apps');

      expect(methodsCalled()).toContain('mcpDirectory:uninstallSmithery');
      expect(paramsOf('mcpDirectory:uninstallSmithery')).toEqual({
        serverKey: 'hubspot',
      });
    });

    it('uninstalls a community skill by name and defers the reload to the hub', async () => {
      responders.set('skillsSh:listInstalled', () =>
        ok({
          skills: [
            {
              name: 'run-tests',
              description: '',
              source: 'owner/skills',
              path: '/root/skills/run-tests',
              scope: 'global',
            },
          ],
        }),
      );
      responders.set('skillsSh:uninstall', () => ok({ success: true }));
      await create();

      const changed = jest.fn();
      fixture.componentInstance.contentChanged.subscribe(changed);
      calls.length = 0;
      await clickRemove('community');

      expect(paramsOf('skillsSh:uninstall')).toEqual({ name: 'run-tests' });
      // The surface does NOT reload on its own: the hub answers
      // `contentChanged` with a `refreshTrigger` bump, which reloads every
      // group. A direct reload here would race that one.
      expect(methodsCalled()).not.toContain('skillsSh:listInstalled');
      expect(changed).toHaveBeenCalled();

      calls.length = 0;
      fixture.componentRef.setInput('refreshTrigger', 1);
      await settle();
      expect(methodsCalled()).toContain('skillsSh:listInstalled');
    });

    it('uninstalls a marketplace plugin by plugin id', async () => {
      responders.set('plugins:list-marketplaces', () =>
        ok({
          marketplaces: [],
          suggestions: [],
          installed: [listing('external:owner/repo/alpha', 'Alpha')],
        }),
      );
      responders.set('plugins:uninstall-external', () =>
        ok({ pluginId: 'external:owner/repo/alpha', removed: true }),
      );
      await create();

      calls.length = 0;
      await clickRemove('marketplaces');

      expect(paramsOf('plugins:uninstall-external')).toEqual({
        pluginId: 'external:owner/repo/alpha',
      });
    });

    it('leaves the row in place and reports a refused removal inline', async () => {
      responders.set('skillsSh:listInstalled', () =>
        ok({
          skills: [
            {
              name: 'run-tests',
              description: '',
              source: 'owner/skills',
              path: '/root/skills/run-tests',
              scope: 'global',
            },
          ],
        }),
      );
      responders.set('skillsSh:uninstall', () =>
        ok({ success: false, error: 'file is locked' }),
      );
      await create();

      const changed = jest.fn();
      fixture.componentInstance.contentChanged.subscribe(changed);
      await clickRemove('community');

      expect(titlesIn('community')).toEqual(['run-tests']);
      expect(
        group('community').querySelector(
          '[data-testid="connected-error-community"]',
        )?.textContent,
      ).toContain('file is locked');
      expect(changed).not.toHaveBeenCalled();
    });
  });

  describe('empty states', () => {
    it.each([
      ['apps', 'apps', 'connectors'],
      ['plugins', 'skills', 'ptah-plugins'],
      ['community', 'skills', 'community'],
      ['marketplaces', 'skills', 'marketplaces'],
    ])('%s asks the hub for %s/%s', async (groupId, section, source) => {
      await create();

      const emitted: unknown[] = [];
      fixture.componentInstance.navigateRequested.subscribe((t) =>
        emitted.push(t),
      );
      group(groupId)
        .querySelector<HTMLButtonElement>(
          `[data-testid="connected-empty-${groupId}"]`,
        )
        ?.click();

      expect(emitted).toEqual([{ section, source }]);
    });

    it('offers Manage rather than a remove button for a Ptah plugin', async () => {
      enabledPlugins.set([plugin('ptah-core', 'Ptah Core')]);
      await create();

      const [row] = rowsIn('plugins');
      expect(row.querySelector('[data-testid="connected-remove"]')).toBeNull();

      const emitted: unknown[] = [];
      fixture.componentInstance.navigateRequested.subscribe((t) =>
        emitted.push(t),
      );
      row
        .querySelector<HTMLButtonElement>('[data-testid="connected-manage"]')
        ?.click();

      expect(emitted).toEqual([{ section: 'skills', source: 'ptah-plugins' }]);
    });
  });

  it('reloads every group when the refresh trigger advances', async () => {
    await create();
    calls.length = 0;

    fixture.componentRef.setInput('refreshTrigger', 1);
    await settle();

    expect(methodsCalled()).toEqual(
      expect.arrayContaining([
        'mcpDirectory:listInstalled',
        'skillsSh:listInstalled',
        'plugins:list-marketplaces',
      ]),
    );
    expect(ensureLoaded).toHaveBeenCalledTimes(2);
  });
});
