/**
 * Test doubles shared by the ProviderListView specs
 * (`provider-list-view.component.spec.ts`, `provider-list-view.removal.spec.ts`).
 * Spec-only: no production file imports this module (precedent:
 * `dashboard/.../session-analytics-state.testing.ts`). No jest globals here —
 * specs spy on the stub's methods with `jest.spyOn`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
  type WritableSignal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import {
  Router,
  provideRouter,
  withComponentInputBinding,
  type Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  groupInstalledServers,
  type InstalledServerGroup,
} from '@ptah-extension/chat-ui';
import type { SessionMcpStatus } from '@ptah-extension/chat-state';
import type { InstalledMcpServer } from '@ptah-extension/shared';

import { ConnectorLinksStore } from '../../data/connector-links.store';
import {
  MarketplaceInventoryStore,
  removalIdOf,
  type InventoryRemovalOutcome,
  type InventoryRemovalRef,
  type InventoryRemovalResult,
  type InventorySlice,
} from '../../data/marketplace-inventory.store';
import {
  MarketplaceLayout,
  type MarketplaceTier,
} from '../../layout/marketplace-layout';
import { ProviderListViewComponent } from './provider-list-view.component';

// ── Fixtures ──────────────────────────────────────────────────────────────────

export function testServer(
  serverKey: string,
  overrides: Partial<InstalledMcpServer> = {},
): InstalledMcpServer {
  return {
    serverKey,
    target: 'claude',
    configPath: 'C:\\repo\\claude.json',
    config: { type: 'stdio', command: 'npx', args: ['-y', serverKey] },
    managedByPtah: true,
    origin: 'harness-config',
    originLabel: 'Config file',
    removal: 'ptah-managed',
    ...overrides,
  };
}

/** Two managed, one direct, one blocked (Claude CLI), one Smithery server. */
export const TEST_SERVERS: readonly InstalledMcpServer[] = [
  testServer('firecrawl'),
  testServer('node_repl', { target: 'codex' }),
  testServer('linear', {
    target: 'cursor',
    configPath: 'C:\\Users\\me\\.cursor\\mcp.json',
    managedByPtah: false,
    removal: 'direct',
  }),
  testServer('sentry', {
    target: undefined,
    configPath: 'C:\\Users\\me\\.claude.json',
    managedByPtah: false,
    origin: 'claude-user',
    originLabel: 'Claude CLI',
    removal: 'none',
    removalBlockedReason: 'Declared in ~/.claude.json.',
    removalFixCommand: 'claude mcp remove sentry',
  }),
  testServer('exa', {
    target: undefined,
    configPath: '',
    config: { type: 'http', url: 'https://server.smithery.ai/exa/mcp' },
    origin: 'smithery',
    originLabel: 'Smithery',
    removal: 'smithery',
  }),
];

export const TEST_REF = {
  firecrawl: 'harness-config:firecrawl',
  nodeRepl: 'harness-config:node_repl',
  linear: 'harness-config:linear',
  sentry: 'claude-user:sentry',
  exa: 'smithery:exa',
} as const;

export function readySlice(
  servers: readonly InstalledMcpServer[] = TEST_SERVERS,
): InventorySlice<InstalledServerGroup> {
  return { state: 'ready', data: groupInstalledServers([...servers]) };
}

/** The inventory surface the list view reads; every removal succeeds. */
export function createInventoryStub(
  installed: InventorySlice<InstalledServerGroup> = readySlice(),
) {
  return {
    installed: signal(installed),
    newestSessionStatus: signal<SessionMcpStatus | null>(null),
    pendingIds: signal<ReadonlySet<string>>(new Set()),
    removeServer: async (
      _group: InstalledServerGroup,
      _options?: { confirmedDirect?: boolean },
    ): Promise<InventoryRemovalOutcome> => ({ status: 'removed' }),
    removeMany: async (
      refs: readonly InventoryRemovalRef[],
    ): Promise<readonly InventoryRemovalResult[]> =>
      refs.map((ref) => ({
        id: removalIdOf(ref),
        ref,
        outcome: { status: 'removed' as const },
      })),
    retry: async (_id: string): Promise<void> => undefined,
  };
}

export type InventoryStub = ReturnType<typeof createInventoryStub>;

// ── Routed host ───────────────────────────────────────────────────────────────

@Component({
  selector: 'ptah-test-servers-page',
  standalone: true,
  imports: [ProviderListViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>MCP servers</h1>
    <ptah-provider-list-view [groupByOrigin]="true" />`,
})
class TestServersPageComponent {}

@Component({
  selector: 'ptah-test-server-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="detail-stub">{{ serverRef() }}</p>
    <button type="button" data-testid="detail-stub-button">Act</button>`,
})
class TestServerDetailComponent {
  public readonly serverRef = input<string>();
}

const routes: Routes = [
  {
    path: 'marketplace',
    children: [
      {
        path: 'servers',
        children: [
          {
            path: '',
            component: TestServersPageComponent,
            children: [
              { path: ':serverRef', component: TestServerDetailComponent },
            ],
          },
        ],
      },
      { path: 'connectors', children: [] },
    ],
  },
];

/** TestBed with the routed host, the stores stubbed and a flippable tier. */
export function configureListViewTestBed(
  inventory: InventoryStub,
  tier: WritableSignal<MarketplaceTier>,
): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      provideLocationMocks(),
      { provide: MarketplaceInventoryStore, useValue: inventory },
      {
        provide: ConnectorLinksStore,
        useValue: { statusFor: () => null, datesFor: () => ({}) },
      },
      { provide: MarketplaceLayout, useValue: { tier } },
    ],
  });
}

// ── DOM driver ────────────────────────────────────────────────────────────────

/** Mounts the routed list and reads / drives its DOM. */
export class ListViewPage {
  private harness: RouterTestingHarness | null = null;

  public async mount(url = '/marketplace/servers'): Promise<void> {
    this.harness = await RouterTestingHarness.create(url);
    await this.settle();
  }

  public async navigate(url: string): Promise<void> {
    await this.fixture().navigateByUrl(url);
    await this.settle();
  }

  public async settle(): Promise<void> {
    const harness = this.fixture();
    harness.detectChanges();
    await harness.fixture.whenStable();
    await Promise.resolve();
    harness.detectChanges();
  }

  public url(): string {
    return TestBed.inject(Router).url;
  }

  public q<T extends HTMLElement = HTMLElement>(selector: string): T | null {
    return this.root().querySelector<T>(selector);
  }

  public qa<T extends HTMLElement = HTMLElement>(selector: string): T[] {
    return Array.from(this.root().querySelectorAll<T>(selector));
  }

  public byTestId<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return this.q<T>(`[data-testid="${id}"]`);
  }

  /** The rendered row (table row or card) for a ref. */
  public rowOf(ref: string): HTMLElement | null {
    return (
      this.qa('[data-list-rows] [data-ref]').find(
        (el) => el.getAttribute('data-ref') === ref,
      ) ?? null
    );
  }

  public openButtonOf(ref: string): HTMLButtonElement | null {
    return (
      this.rowOf(ref)?.querySelector<HTMLButtonElement>(
        '[data-testid="provider-row-open"], [data-testid="provider-card-open"]',
      ) ?? null
    );
  }

  public removeButtonOf(ref: string): HTMLButtonElement | null {
    return (
      this.rowOf(ref)?.querySelector<HTMLButtonElement>(
        '[data-testid="provider-row-remove"], [data-testid="provider-card-remove"]',
      ) ?? null
    );
  }

  public checkboxOf(ref: string): HTMLInputElement | null {
    return (
      this.rowOf(ref)?.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      ) ?? null
    );
  }

  public async check(ref: string): Promise<void> {
    const box = this.checkboxOf(ref);
    if (!box) throw new Error(`no checkbox for ${ref}`);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await this.settle();
  }

  public async click(testId: string): Promise<void> {
    this.byTestId<HTMLButtonElement>(testId)?.click();
    await this.settle();
  }

  public async key(target: Element, key: string): Promise<void> {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    await this.settle();
  }

  public async typeSearch(text: string): Promise<void> {
    const search = this.q<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('no search');
    search.value = text;
    search.dispatchEvent(new Event('input'));
    await this.settle();
  }

  private root(): HTMLElement {
    return this.fixture().fixture.nativeElement as HTMLElement;
  }

  private fixture(): RouterTestingHarness {
    if (this.harness === null) throw new Error('mount() first');
    return this.harness;
  }
}
