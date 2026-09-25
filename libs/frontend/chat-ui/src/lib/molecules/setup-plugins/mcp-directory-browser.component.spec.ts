/**
 * McpDirectoryBrowserComponent — the MCP Registry discovery view.
 *
 * After plan C11 the view only browses and installs; the installed list and
 * its removal paths belong to the marketplace (their behaviour is covered by
 * `installed-mcp-groups.spec.ts` and the marketplace removal specs). Axes:
 *
 *   - **No tab strip, no Installed view.** Nothing here removes a server.
 *   - **Results are catalog cards** inside `ptah-catalog-grid`, each a list
 *     item, with the "Installed" badge from the view's own `listInstalled`.
 *   - **A listing's name never earns a vendor mark**: only an allowlisted
 *     namespace or a catalogue URL does; everything else is a monogram.
 *   - **The install path is unchanged**: the same `mcpDirectory:install` call
 *     with the same arguments, from a storefront panel under the card.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  InstalledMcpServer,
  McpRegistryEntry,
} from '@ptah-extension/shared';
import { McpDirectoryBrowserComponent } from './mcp-directory-browser.component';

/**
 * Minimal stand-in for the core `RpcResult` shape: `isSuccess()`, `.data`,
 * `.error`. Mirrors the real class's truthiness rule (success AND data !==
 * undefined) — same idiom as `plugin-catalog-panel.component.spec.ts`.
 */
function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

/** A refused call: not a thrown error, just a result that is not a success. */
function fail(error: string) {
  return {
    success: false,
    data: undefined,
    error,
    isSuccess: (): boolean => false,
  };
}

function entry(over: Partial<McpRegistryEntry> = {}): McpRegistryEntry {
  return {
    name: 'io.github.acme/weather',
    description: 'Forecasts for any city',
    repository: { url: 'https://github.com/acme/weather', id: 'acme/weather' },
    version_detail: {
      version: '1.2.0',
      packages: [{ registry_name: 'npm', name: '@acme/weather-mcp' }],
      transports: [{ type: 'stdio' }],
    },
    ...over,
  };
}

function installed(serverKey: string): InstalledMcpServer {
  return {
    serverKey,
    target: 'claude',
    configPath: 'C:\\Users\\dev\\.mcp.json',
    config: { type: 'stdio', command: 'npx', args: ['-y', serverKey] },
    managedByPtah: true,
    origin: 'harness-config',
    removal: 'ptah-managed',
    originLabel: 'Harness config',
  };
}

interface RpcCall {
  method: string;
  params: unknown;
}

describe('mcp directory browser — registry discovery', () => {
  let calls: RpcCall[];
  let responders: Map<string, () => unknown>;

  const setResponder = (method: string, factory: () => unknown): void => {
    responders.set(method, factory);
  };

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      if (!factory) {
        return Promise.resolve(ok(undefined));
      }
      return Promise.resolve(factory());
    }),
  };

  /** Drain the ngOnInit loads and render the result. */
  const settle = async (fixture: ComponentFixture<unknown>): Promise<void> => {
    fixture.detectChanges();
    for (let pass = 0; pass < 3; pass += 1) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  /** Mount with `popular` as the registry's popular list. */
  const mount = async (
    popular: McpRegistryEntry[],
    installedServers: InstalledMcpServer[] = [],
  ): Promise<ComponentFixture<McpDirectoryBrowserComponent>> => {
    setResponder('mcpDirectory:getPopular', () => ok({ servers: popular }));
    setResponder('mcpDirectory:listInstalled', () =>
      ok({ servers: installedServers }),
    );
    const fixture = TestBed.createComponent(McpDirectoryBrowserComponent);
    await settle(fixture);
    return fixture;
  };

  const host = (fixture: ComponentFixture<unknown>): HTMLElement =>
    fixture.nativeElement as HTMLElement;

  const cards = (fixture: ComponentFixture<unknown>): HTMLElement[] =>
    Array.from(host(fixture).querySelectorAll('ptah-catalog-card'));

  const errorText = (fixture: ComponentFixture<unknown>): string =>
    host(fixture)
      .querySelector('[data-testid="mcp-error"]')
      ?.textContent?.trim() ?? '';

  const clickInstall = async (
    fixture: ComponentFixture<unknown>,
    index = 0,
  ): Promise<void> => {
    const card = cards(fixture)[index];
    card?.querySelector<HTMLButtonElement>('[card-actions] button')?.click();
    await settle(fixture);
  };

  const clickConfirm = async (
    fixture: ComponentFixture<unknown>,
  ): Promise<void> => {
    host(fixture)
      .querySelector<HTMLButtonElement>(
        'ptah-storefront-panel [panel-footer] button',
      )
      ?.click();
    await settle(fixture);
  };

  const installCalls = (): RpcCall[] =>
    calls.filter((c) => c.method === 'mcpDirectory:install');

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    TestBed.configureTestingModule({
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders no tab strip and no Installed view', async () => {
    const fixture = await mount([entry()], [installed('weather')]);

    expect(host(fixture).querySelector('.tabs, [role="tab"]')).toBeNull();
    expect(
      host(fixture).querySelector('[data-testid="installed-row"]'),
    ).toBeNull();
    expect(host(fixture).textContent).not.toMatch(/Installed \(\d+\)/);
  });

  it('renders each result as a catalog card list item inside the catalog grid', async () => {
    const fixture = await mount([
      entry(),
      entry({ name: 'io.github.acme/tides', repository: undefined }),
    ]);

    const grid = host(fixture).querySelector('ptah-catalog-grid');
    expect(grid).not.toBeNull();
    expect(cards(fixture)).toHaveLength(2);
    for (const card of cards(fixture)) {
      expect(card.closest('ptah-catalog-grid')).toBe(grid);
      expect(card.getAttribute('role')).toBe('listitem');
    }

    const first = cards(fixture)[0];
    expect(
      first.querySelector('[data-testid="catalog-card"] h3')?.textContent,
    ).toContain('weather');
    expect(
      first.querySelector('[data-testid="catalog-card-meta"]')?.textContent,
    ).toContain('v1.2.0 · stdio · acme/weather');
  });

  it('shows card-shaped skeletons inside the grid while the popular list loads', async () => {
    setResponder('mcpDirectory:getPopular', () => new Promise(() => undefined));
    const fixture = TestBed.createComponent(McpDirectoryBrowserComponent);
    fixture.detectChanges();

    const skeletons = host(fixture).querySelectorAll(
      'ptah-catalog-grid ptah-catalog-card-skeleton[role="listitem"]',
    );
    expect(skeletons.length).toBeGreaterThan(0);
    expect(cards(fixture)).toHaveLength(0);
  });

  it('badges a result as Installed from its own listInstalled read', async () => {
    const fixture = await mount(
      [entry(), entry({ name: 'io.github.acme/tides' })],
      [installed('weather')],
    );

    const badges = cards(fixture).map(
      (card) =>
        card
          .querySelector('[data-testid="catalog-card-badge"]')
          ?.textContent?.trim() ?? null,
    );
    expect(badges).toEqual(['Installed', null]);
    expect(calls.some((c) => c.method === 'mcpDirectory:listInstalled')).toBe(
      true,
    );
  });

  it('gives a vendor mark only to an allowlisted namespace, a monogram otherwise', async () => {
    const fixture = await mount([
      entry({ name: 'io.github.getsentry/sentry' }),
      entry({ name: 'attacker/github' }),
    ]);

    const [sentry, lookalike] = cards(fixture);
    expect(sentry.querySelector('[card-mark] ptah-brand-mark')).not.toBeNull();
    expect(lookalike.querySelector('ptah-brand-mark')).toBeNull();
    expect(
      lookalike.querySelector('ptah-monogram-tile[card-mark]'),
    ).not.toBeNull();
  });

  it('installs through the same RPC and arguments from the storefront panel', async () => {
    const fixture = await mount([entry()]);
    const emitted: unknown[] = [];
    fixture.componentInstance.serverInstalled.subscribe((e) => emitted.push(e));
    setResponder('mcpDirectory:install', () =>
      ok({
        results: [
          {
            target: 'claude',
            success: true,
            configPath: 'C:\\Users\\dev\\.mcp.json',
          },
        ],
      }),
    );

    await clickInstall(fixture);

    const panel = host(fixture).querySelector('ptah-storefront-panel');
    expect(panel).not.toBeNull();
    const row = panel?.closest('[role="listitem"]');
    expect(row?.classList.contains('col-span-full')).toBe(true);
    expect(row?.closest('ptah-catalog-grid')).not.toBeNull();

    const listInstalledBefore = calls.filter(
      (c) => c.method === 'mcpDirectory:listInstalled',
    ).length;
    await clickConfirm(fixture);

    expect(installCalls()).toHaveLength(1);
    expect(installCalls()[0].params).toEqual({
      serverName: 'io.github.acme/weather',
      serverKey: 'weather',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@acme/weather-mcp'],
      },
      targets: [
        'vscode',
        'claude',
        'cursor',
        'copilot',
        'codex',
        'antigravity',
        'opencode',
      ],
    });
    expect(emitted).toEqual([
      { serverName: 'io.github.acme/weather', targets: ['claude'] },
    ]);
    expect(
      calls.filter((c) => c.method === 'mcpDirectory:listInstalled').length,
    ).toBe(listInstalledBefore + 1);
    expect(host(fixture).querySelector('ptah-storefront-panel')).toBeNull();
  });

  it('fetches details before installing a result that carries none', async () => {
    const bare = entry({ version_detail: undefined });
    setResponder('mcpDirectory:getDetails', () => ok(entry()));
    const fixture = await mount([bare]);

    await clickInstall(fixture);

    const details = calls.filter((c) => c.method === 'mcpDirectory:getDetails');
    expect(details).toHaveLength(1);
    expect(details[0].params).toEqual({ name: 'io.github.acme/weather' });
    expect(
      host(fixture).querySelector(
        'ptah-storefront-panel [panel-footer] button',
      ),
    ).not.toBeNull();
  });

  it('reports the reason when the backend refuses an install', async () => {
    const fixture = await mount([entry()]);
    setResponder('mcpDirectory:install', () =>
      fail('workspace policy blocks new servers'),
    );

    await clickInstall(fixture);
    await clickConfirm(fixture);

    expect(errorText(fixture)).toContain('workspace policy blocks new servers');
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'mcp-directory-browser.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
