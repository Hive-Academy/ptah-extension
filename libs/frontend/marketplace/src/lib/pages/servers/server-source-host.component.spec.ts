/**
 * ServerSourceHostComponent specs (plan C7 `ServerSourceHost`): exactly one
 * surface per source, the band as the page's only `<h1>` (storefront at wide,
 * compact otherwise), and every install / uninstall / connect / disconnect
 * output routed to `notifyContentChanged()`. The registry browser is
 * discovery only (plan C11): it reports installs and has no removal output.
 *
 * The three reused surfaces are replaced by same-selector stubs with the same
 * outputs: their own reads and markup are covered by their own specs, and this
 * host only decides which one exists and what their outputs trigger. The
 * store is stubbed, so per D-4.3 it carries `newestSessionStatus` directly.
 */

import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  reflectComponentType,
  signal,
  type Type,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { McpDirectoryBrowserComponent } from '@ptah-extension/chat-ui';
import type { MarketplaceServerSource } from '@ptah-extension/core';

import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import {
  MarketplaceLayout,
  type MarketplaceTier,
} from '../../layout/marketplace-layout';
import { OAuthSurfaceComponent } from '../../oauth-surface.component';
import { SmitherySurfaceComponent } from '../../smithery-surface.component';
import {
  SERVER_SOURCE_PAGES,
  ServerSourceHostComponent,
} from './server-source-host.component';

@Component({
  selector: 'ptah-smithery-surface',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="stub-smithery">smithery</p>`,
})
class StubSmitherySurfaceComponent {
  public readonly serverInstalled = output<string>();
  public readonly serverUninstalled = output<string>();
}

@Component({
  selector: 'ptah-mcp-directory-browser',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="stub-registry">registry</p>`,
})
class StubMcpDirectoryBrowserComponent {
  public readonly refreshTrigger = input(0);
  public readonly serverInstalled = output<{
    serverName: string;
    targets: string[];
  }>();
}

/** Public input and output names a component declares, sorted. */
const bindingNames = (
  component: Type<unknown>,
): { inputs: string[]; outputs: string[] } => {
  const mirror = reflectComponentType(component);
  return {
    inputs: (mirror?.inputs ?? []).map((i) => i.templateName).sort(),
    outputs: (mirror?.outputs ?? []).map((o) => o.templateName).sort(),
  };
};

@Component({
  selector: 'ptah-oauth-surface',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="stub-oauth">custom url</p>`,
})
class StubOAuthSurfaceComponent {
  public readonly serverConnected = output<string>();
  public readonly serverDisconnected = output<string>();
}

const SURFACE_SELECTORS = [
  'ptah-smithery-surface',
  'ptah-mcp-directory-browser',
  'ptah-oauth-surface',
] as const;

describe('ServerSourceHostComponent', () => {
  let fixture: ComponentFixture<ServerSourceHostComponent>;
  let notifyContentChanged: jest.Mock;
  let tier: ReturnType<typeof signal<MarketplaceTier>>;

  const mount = (source: MarketplaceServerSource): void => {
    fixture = TestBed.createComponent(ServerSourceHostComponent);
    fixture.componentRef.setInput('source', source);
    fixture.detectChanges();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const mounted = (): string[] =>
    SURFACE_SELECTORS.filter((selector) => host().querySelector(selector));
  const surface = <T>(selector: string): T =>
    fixture.debugElement.query((el) => el.name === selector)
      .componentInstance as T;

  beforeEach(() => {
    notifyContentChanged = jest.fn();
    tier = signal<MarketplaceTier>('compact');

    TestBed.configureTestingModule({
      imports: [ServerSourceHostComponent],
      providers: [
        {
          provide: MarketplaceInventoryStore,
          useValue: {
            notifyContentChanged,
            newestSessionStatus: signal(null).asReadonly(),
          },
        },
        { provide: MarketplaceLayout, useValue: { tier: tier.asReadonly() } },
      ],
    });
    TestBed.overrideComponent(ServerSourceHostComponent, {
      remove: {
        imports: [
          SmitherySurfaceComponent,
          McpDirectoryBrowserComponent,
          OAuthSurfaceComponent,
        ],
      },
      add: {
        imports: [
          StubSmitherySurfaceComponent,
          StubMcpDirectoryBrowserComponent,
          StubOAuthSurfaceComponent,
        ],
      },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it.each<[MarketplaceServerSource, string]>([
    ['smithery', 'ptah-smithery-surface'],
    ['registry', 'ptah-mcp-directory-browser'],
    ['custom-url', 'ptah-oauth-surface'],
  ])('mounts exactly one surface for %s', (source, selector) => {
    mount(source);

    expect(mounted()).toEqual([selector]);
    expect(host().getAttribute('data-source')).toBe(source);
  });

  it('maps every source to its own surface (the typed map the template switches on)', () => {
    expect(
      Object.fromEntries(
        Object.entries(SERVER_SOURCE_PAGES).map(([source, page]) => [
          source,
          page.surface,
        ]),
      ),
    ).toEqual({
      smithery: 'smithery',
      registry: 'mcp-directory',
      'custom-url': 'oauth',
    });
  });

  it('swaps the surface when the bound source changes', () => {
    mount('smithery');
    fixture.componentRef.setInput('source', 'custom-url');
    fixture.detectChanges();

    expect(mounted()).toEqual(['ptah-oauth-surface']);
  });

  it.each<MarketplaceServerSource>(['smithery', 'registry', 'custom-url'])(
    'renders the band heading as the only <h1> for %s',
    (source) => {
      mount(source);

      const headings = host().querySelectorAll('h1');
      expect(headings).toHaveLength(1);
      expect(headings[0].textContent?.trim()).toBe(
        SERVER_SOURCE_PAGES[source].heading,
      );
    },
  );

  it('uses the storefront band at wide and the compact band otherwise', () => {
    mount('registry');
    const band = (): string | null =>
      host()
        .querySelector('[data-testid="source-band"]')
        ?.getAttribute('data-layout') ?? null;
    expect(band()).toBe('compact');

    tier.set('regular');
    fixture.detectChanges();
    expect(band()).toBe('compact');

    tier.set('wide');
    fixture.detectChanges();
    expect(band()).toBe('storefront');
  });

  it('stubs the registry browser with exactly its real inputs and outputs', () => {
    const real = bindingNames(McpDirectoryBrowserComponent);

    expect(real).toEqual({
      inputs: ['refreshTrigger'],
      outputs: ['serverInstalled'],
    });
    expect(bindingNames(StubMcpDirectoryBrowserComponent)).toEqual(real);
  });

  it('a Smithery install or uninstall tells the inventory', () => {
    mount('smithery');
    const smithery = surface<StubSmitherySurfaceComponent>(
      'ptah-smithery-surface',
    );

    smithery.serverInstalled.emit('smithery-ai/github');
    expect(notifyContentChanged).toHaveBeenCalledTimes(1);
    smithery.serverUninstalled.emit('smithery-ai/github');
    expect(notifyContentChanged).toHaveBeenCalledTimes(2);
  });

  it('a registry install tells the inventory, and no removal event is bound', () => {
    mount('registry');
    const registryEl = fixture.debugElement.query(
      (el) => el.name === 'ptah-mcp-directory-browser',
    );
    const registry =
      registryEl.componentInstance as StubMcpDirectoryBrowserComponent;

    registry.serverInstalled.emit({
      serverName: 'sentry',
      targets: ['claude'],
    });
    expect(notifyContentChanged).toHaveBeenCalledTimes(1);
    // The host binds only the install output. A binding to the removed
    // removal output would still compile (as a DOM listener that never fires).
    expect(registryEl.listeners.map((l) => l.name)).toEqual([
      'serverInstalled',
    ]);
  });

  it('a Custom URL connect or disconnect tells the inventory', () => {
    mount('custom-url');
    const oauth = surface<StubOAuthSurfaceComponent>('ptah-oauth-surface');

    oauth.serverConnected.emit('oauth-mcp.example');
    expect(notifyContentChanged).toHaveBeenCalledTimes(1);
    oauth.serverDisconnected.emit('oauth-mcp.example');
    expect(notifyContentChanged).toHaveBeenCalledTimes(2);
  });

  it('mounting a source alone does not touch the inventory', () => {
    mount('smithery');
    fixture.destroy();

    expect(notifyContentChanged).not.toHaveBeenCalled();
  });
});
