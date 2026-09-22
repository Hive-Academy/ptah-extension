/**
 * MarketplaceHubComponent specs — the section strip and the claude.ai
 * connector wiring.
 *
 * The section strip is asserted at the level the hub owns: three tabs, a
 * default of `connected`, and the standing rule that an unselected section
 * fires zero RPC. Each section's own chips and surfaces are covered by their
 * own specs.
 *
 * What is pinned below that is the whole reason the hub reads MCP state at all:
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
  VSCodeService,
} from '@ptah-extension/core';
import { provideSurfaceRouterTesting } from '@ptah-extension/core/testing';
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

describe('MarketplaceHubComponent', () => {
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
        // The real `AppStateManager` reads the current surface off the Router
        // (TASK_2026_524), so it needs the Router wired even though nothing
        // here navigates — the hub's only navigation is its Back button.
        ...provideSurfaceRouterTesting(),
        AppStateManager,
        { provide: ClaudeRpcService, useValue: rpcMock },
        {
          provide: CommandDiscoveryFacade,
          useValue: { clearCache: jest.fn() },
        },
        {
          provide: VSCodeService,
          useValue: { isElectron: false, postMessage: jest.fn() },
        },
      ],
    });

    appState = TestBed.inject(AppStateManager);
    mcpStatus = TestBed.inject(SessionMcpStatusRegistry);
    // The MCP Registry chip is the only one that renders an Installed tab, and
    // the only selection that justifies the hub's own `listInstalled` read.
    appState.setMarketplaceActiveProvider('apps:mcp-registry');
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

  it('fires no installed read while a different section is selected', async () => {
    appState.setMarketplaceActiveProvider('skills');

    await createComponent();

    expect(calls).not.toContain('mcpDirectory:listInstalled');
  });

  it('fires no installed read while another Apps chip is selected', async () => {
    appState.setMarketplaceActiveProvider('apps:connectors');

    await createComponent();

    expect(calls).not.toContain('mcpDirectory:listInstalled');
  });

  describe('section strip', () => {
    const tabs = (): HTMLElement[] =>
      Array.from(hostElement.querySelectorAll('[data-testid="native-tab"]'));

    it('renders the three sections and keeps the Marketplace heading', async () => {
      await createComponent();

      expect(tabs().map((t) => t.textContent?.trim())).toEqual([
        'Connected',
        'Apps',
        'Skills',
      ]);
      expect(hostElement.querySelector('h1')?.textContent?.trim()).toBe(
        'Marketplace',
      );
    });

    it('opens on Connected when nothing is persisted', async () => {
      appState.setMarketplaceActiveProvider(null);

      await createComponent();

      const selected = tabs().find(
        (t) => t.getAttribute('aria-selected') === 'true',
      );
      expect(selected?.textContent?.trim()).toBe('Connected');
      expect(
        hostElement.querySelector('[data-testid="connected-surface"]'),
      ).toBeTruthy();
    });

    it('opens Connected for a retired provider id (AC5)', async () => {
      appState.setMarketplaceActiveProvider('composio');

      await createComponent();

      expect(
        hostElement.querySelector('[data-testid="connected-surface"]'),
      ).toBeTruthy();
    });

    it('mounts exactly one section at a time', async () => {
      await createComponent();

      expect(
        hostElement.querySelector('[data-testid="apps-chips"]'),
      ).toBeTruthy();
      expect(
        hostElement.querySelector('[data-testid="connected-surface"]'),
      ).toBeNull();
      expect(
        hostElement.querySelector('[data-testid="skills-chips"]'),
      ).toBeNull();
    });

    it('swaps the mounted surface when a chip is clicked', async () => {
      await createComponent();
      expect(installedRows()).toHaveLength(0);

      const connectorsChip = Array.from(
        hostElement.querySelectorAll<HTMLButtonElement>(
          '[data-testid="marketplace-chip"]',
        ),
      ).find((b) => b.dataset['sourceId'] === 'connectors');
      connectorsChip?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(connectorsChip?.getAttribute('aria-pressed')).toBe('true');
      expect(
        hostElement.querySelector('ptah-mcp-directory-browser'),
      ).toBeNull();
      expect(hostElement.querySelector('ptah-connectors-surface')).toBeTruthy();
    });
  });
});
