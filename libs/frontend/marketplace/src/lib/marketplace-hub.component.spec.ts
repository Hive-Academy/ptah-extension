/**
 * MarketplaceHubComponent specs — the claude.ai connector wiring.
 *
 * What is pinned here is the whole reason the hub reads MCP state at all:
 * `McpDirectoryBrowserComponent.connectorServers` was shipped unbound, so a
 * Gmail / Calendar / Drive / Canva connector reported by a live session
 * appeared nowhere in the Installed tab. These specs mount the REAL child, not
 * a stub, because the three things that can go wrong are all rendering
 * behaviour: the row must appear, it must not offer a Remove button it cannot
 * honour, and a server that already reaches the tab from disk must not be
 * listed a second time under a second origin.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  ClaudeRpcService,
  CommandDiscoveryFacade,
  WebviewNavigationService,
} from '@ptah-extension/core';
import { SessionMcpStatusRegistry } from '@ptah-extension/chat-state';
import type { InstalledMcpServer } from '@ptah-extension/shared';
import { MarketplaceHubComponent } from './marketplace-hub.component';

/** Stand-in for the core `RpcResult` shape: `isSuccess()`, `.data`, `.error`. */
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

/** A disk-sourced row as `mcpDirectory:listInstalled` returns it. */
function diskServer(serverKey: string): InstalledMcpServer {
  return {
    serverKey,
    target: 'claude',
    configPath: `C:\\repo\\.mcp.json`,
    config: { type: 'stdio', command: 'npx', args: ['-y', serverKey] },
    managedByPtah: true,
    origin: 'harness-config',
    originLabel: 'harness config',
    removal: 'ptah-managed',
  };
}

describe('MarketplaceHubComponent — claude.ai connector rows', () => {
  let fixture: ComponentFixture<MarketplaceHubComponent>;
  let hostElement: HTMLElement;
  let appState: AppStateManager;
  let mcpStatus: SessionMcpStatusRegistry;
  let responders: Map<string, () => unknown>;
  let calls: string[];

  const rpcMock = {
    call: jest.fn((method: string) => {
      calls.push(method);
      const factory = responders.get(method);
      return Promise.resolve(
        factory ? factory() : fail(`No responder for ${method}`),
      );
    }),
  };

  const setInstalled = (servers: InstalledMcpServer[]): void => {
    responders.set('mcpDirectory:listInstalled', () => ok({ servers }));
  };

  /** Text of every Installed-tab row the child rendered. */
  const installedRows = (): HTMLElement[] =>
    Array.from(hostElement.querySelectorAll('[data-testid="installed-row"]'));

  const rowFor = (serverKey: string): HTMLElement[] =>
    installedRows().filter((row) =>
      row.querySelector('span')?.textContent?.trim().includes(serverKey),
    );

  const openInstalledTab = async (): Promise<void> => {
    const installedTab = Array.from(
      hostElement.querySelectorAll<HTMLButtonElement>('button.tab'),
    ).find((b) => b.textContent?.includes('Installed'));
    installedTab?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const createComponent = async (): Promise<void> => {
    fixture = TestBed.createComponent(MarketplaceHubComponent);
    hostElement = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // A second settle: the hub's own listInstalled read resolves after the
    // child's, and the connector rows are derived from it.
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    responders.set('mcpDirectory:getPopular', () => ok({ servers: [] }));
    setInstalled([]);

    TestBed.configureTestingModule({
      imports: [MarketplaceHubComponent],
      providers: [
        AppStateManager,
        { provide: ClaudeRpcService, useValue: rpcMock },
        {
          provide: WebviewNavigationService,
          useValue: { navigateToView: jest.fn() },
        },
        {
          provide: CommandDiscoveryFacade,
          useValue: { clearCache: jest.fn() },
        },
      ],
    });

    appState = TestBed.inject(AppStateManager);
    mcpStatus = TestBed.inject(SessionMcpStatusRegistry);
    // The MCP Registry surface is the only one that renders an Installed tab.
    appState.setMarketplaceActiveProvider('official-mcp');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('renders a row for each account connector the session reported', async () => {
    mcpStatus.record('session-a', {
      servers: [
        { name: 'Gmail', status: 'connected' },
        { name: 'Google Calendar', status: 'connected' },
      ],
      notices: [],
    });

    await createComponent();
    await openInstalledTab();

    const text = hostElement.textContent ?? '';
    expect(text).toContain('Gmail');
    expect(text).toContain('Google Calendar');
    expect(text).toContain('claude.ai connector');
    expect(installedRows().length).toBe(2);
  });

  it('gives a connector row no Remove button and says where it is managed', async () => {
    mcpStatus.record('session-a', {
      servers: [{ name: 'Canva', status: 'connected' }],
      notices: [],
    });

    await createComponent();
    await openInstalledTab();

    const [row] = rowFor('Canva');
    expect(row).toBeTruthy();
    expect(row.querySelector('[data-testid="remove-button"]')).toBeNull();
    expect(
      row.querySelector('[data-testid="removal-blocked"]')?.textContent,
    ).toContain('claude.ai');
  });

  it('does not re-list a server that already reaches the tab from disk', async () => {
    setInstalled([diskServer('ptah'), diskServer('firecrawl')]);
    mcpStatus.record('session-a', {
      servers: [
        { name: 'ptah', status: 'connected' },
        { name: 'firecrawl', status: 'connected' },
        { name: 'Gmail', status: 'connected' },
      ],
      notices: [],
    });

    await createComponent();
    await openInstalledTab();

    expect(rowFor('ptah').length).toBe(1);
    expect(rowFor('firecrawl').length).toBe(1);
    expect(rowFor('Gmail').length).toBe(1);
    // Two disk rows plus exactly one connector row.
    expect(installedRows().length).toBe(3);
  });

  it('reads the most recently recorded session', async () => {
    mcpStatus.record('older', {
      servers: [{ name: 'Gmail', status: 'connected' }],
      notices: [],
    });
    mcpStatus.record('newer', {
      servers: [{ name: 'Canva', status: 'connected' }],
      notices: [],
    });

    await createComponent();
    await openInstalledTab();

    expect(rowFor('Canva').length).toBe(1);
    expect(rowFor('Gmail').length).toBe(0);
  });

  it('degrades to today behaviour when no session has ever reported', async () => {
    await createComponent();
    await openInstalledTab();

    expect(installedRows().length).toBe(0);
    expect(hostElement.textContent).toContain('No MCP servers installed yet');
  });

  it('fires no installed read while a different provider is selected', async () => {
    appState.setMarketplaceActiveProvider('composio');

    await createComponent();

    expect(calls).not.toContain('mcpDirectory:listInstalled');
  });
});
