/**
 * OAuthSurfaceComponent (Custom URL) — storefront layout, plan C13
 * (TASK_2026_533 Batch 21): the form is one storefront panel, the suggestions
 * are interactive catalog cards marked by the LISTING resolver, and the
 * connected servers are catalog cards marked by the INSTALLED resolver with
 * the status word from `statusPresentation()`.
 *
 * A sibling of `oauth-surface.component.spec.ts` (671 lines, near the 700-line
 * cap), which keeps the RPC and form behaviour.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { McpOAuthConnectionState } from '@ptah-extension/shared';
import {
  BrandMarkComponent,
  resolveInstalledBrandSlug,
  resolveListingBrandSlug,
} from '@ptah-extension/ui';
import { OAuthSurfaceComponent } from './oauth-surface.component';
import { statusPresentation } from './ui/status-pill.component';

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: undefined as string | undefined,
    isSuccess: (): boolean => data !== undefined,
  };
}

/** A connected record whose KEY names a catalogue connector but whose URL does not. */
const GITHUB_BY_KEY = {
  serverKey: 'github',
  name: 'My GitHub',
  serverUrl: 'https://example.invalid/mcp',
  connectedAt: '2026-07-22T00:00:00.000Z',
};

describe('OAuthSurfaceComponent — storefront layout', () => {
  let fixture: ComponentFixture<OAuthSurfaceComponent>;
  let component: OAuthSurfaceComponent;
  let host: HTMLElement;
  let responders: Map<string, () => unknown>;

  const rpcMock = {
    call: jest.fn((method: string) => {
      const factory = responders.get(method);
      return Promise.resolve(factory ? factory() : ok(undefined));
    }),
  };

  const createComponent = async (): Promise<void> => {
    fixture = TestBed.createComponent(OAuthSurfaceComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** The `ptah-brand-mark` inside a card, read through its public input. */
  const markSlug = (card: DebugElement): string | null =>
    (
      card.query(By.directive(BrandMarkComponent))
        .componentInstance as BrandMarkComponent
    ).brandSlug();

  const allCards = (): DebugElement[] =>
    fixture.debugElement.queryAll(
      By.css('ptah-catalog-grid ptah-catalog-card[role="listitem"]'),
    );
  const inPanel = (card: DebugElement): boolean =>
    (card.nativeElement as HTMLElement).closest('ptah-storefront-panel') !==
    null;
  const suggestionCards = (): DebugElement[] => allCards().filter(inPanel);
  const connectedCards = (): DebugElement[] =>
    allCards().filter((card) => !inPanel(card));

  beforeEach(() => {
    responders = new Map();
    rpcMock.call.mockClear();
    responders.set('mcpDirectory:listOAuthConnected', () =>
      ok({ servers: [] }),
    );
    responders.set('mcpDirectory:getOAuthRedirectUri', () =>
      ok({ redirectUri: 'http://127.0.0.1:41739/callback' }),
    );
    TestBed.configureTestingModule({
      imports: [OAuthSurfaceComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  it('renders the whole form, Advanced disclosure included, inside one storefront panel', async () => {
    await createComponent();

    const panels = host.querySelectorAll('ptah-storefront-panel');
    expect(panels).toHaveLength(1);
    const panel = panels[0];
    expect(panel.querySelector('h3')?.textContent?.trim()).toBe(
      'Connect an OAuth MCP server',
    );
    for (const selector of [
      'input[aria-label="MCP server URL"]',
      'input[aria-label="Friendly name"]',
      'details input[aria-label="Client ID"]',
      'button[type="submit"]',
    ]) {
      expect(panel.querySelector(selector)).toBeTruthy();
    }
    const legends = Array.from(panel.querySelectorAll('legend')).map((el) =>
      el.textContent?.trim(),
    );
    expect(legends).toEqual(['Quick connect', 'Server']);
  });

  it('renders the suggestions as interactive catalog cards inside the panel', async () => {
    await createComponent();

    const cards = suggestionCards();
    expect(cards.map((card) => card.nativeElement.textContent)).toEqual([
      expect.stringContaining('Sentry'),
      expect.stringContaining('Notion'),
      expect.stringContaining('Linear'),
      expect.stringContaining('HubSpot'),
    ]);
    for (const card of cards) {
      expect(
        card.nativeElement.querySelector(
          '[data-testid="catalog-card-activator"]',
        ),
      ).toBeTruthy();
    }
  });

  it('activating a suggestion card picks it', async () => {
    await createComponent();

    const notion = suggestionCards()[1];
    (
      notion.nativeElement.querySelector(
        '[data-testid="catalog-card-activator"]',
      ) as HTMLButtonElement
    ).click();

    expect(component.urlInput()).toBe('https://mcp.notion.com/mcp');
    expect(component.nameInput()).toBe('Notion');
    // Activation is a pick, never a submit.
    expect(
      rpcMock.call.mock.calls.filter(
        ([method]) => method === 'mcpDirectory:connectOAuth',
      ),
    ).toHaveLength(0);
  });

  it('marks each suggestion with the LISTING resolver, URL only', async () => {
    await createComponent();

    const urls = [
      'https://mcp.sentry.dev/mcp',
      'https://mcp.notion.com/mcp',
      'https://mcp.linear.app/mcp',
      'https://mcp.hubspot.com',
    ];
    const slugs = suggestionCards().map(markSlug);
    expect(slugs).toEqual(
      urls.map((url) => resolveListingBrandSlug({ remoteUrls: [url] })),
    );
    // Sentry's endpoint is a catalogue URL, so it earns its vendor mark.
    expect(slugs[0]).toBe('sentry');
  });

  it('marks a connected server with the INSTALLED resolver (key match, not only URL)', async () => {
    responders.set('mcpDirectory:listOAuthConnected', () =>
      ok({ servers: [GITHUB_BY_KEY] }),
    );
    responders.set('mcpDirectory:oauthStatus', () =>
      ok({ state: 'connected' }),
    );
    await createComponent();

    const [card] = connectedCards();
    const expected = resolveInstalledBrandSlug({
      serverKey: GITHUB_BY_KEY.serverKey,
      serverUrl: GITHUB_BY_KEY.serverUrl,
    });
    expect(expected).not.toBeNull();
    expect(markSlug(card)).toBe(expected);
    // The listing resolver would have refused this row (its URL is unknown).
    expect(
      resolveListingBrandSlug({ remoteUrls: [GITHUB_BY_KEY.serverUrl] }),
    ).toBeNull();
    expect(card.nativeElement.querySelector('h4')?.textContent?.trim()).toBe(
      'My GitHub',
    );
  });

  it.each<McpOAuthConnectionState>(['connected', 'expired', 'disconnected'])(
    'a %s server shows the statusPresentation() word as its badge, with Disconnect',
    async (state) => {
      responders.set('mcpDirectory:listOAuthConnected', () =>
        ok({ servers: [GITHUB_BY_KEY] }),
      );
      responders.set('mcpDirectory:oauthStatus', () => ok({ state }));
      await createComponent();

      const card = connectedCards()[0]?.nativeElement as
        HTMLElement | undefined;
      const badge = card?.querySelector('[data-testid="catalog-card-badge"]');
      const { label, tone } = statusPresentation(state);
      expect(badge?.textContent?.trim()).toBe(label);
      expect(badge?.getAttribute('data-tone')).toBe(tone);

      const actions = card?.querySelector(
        '[data-testid="catalog-card-actions"]',
      );
      expect(
        actions?.querySelector('button[aria-label="Disconnect My GitHub"]'),
      ).toBeTruthy();
      expect(
        actions?.querySelector('button[aria-label="Reconnect My GitHub"]') !==
          null,
      ).toBe(state !== 'connected');
    },
  );

  it('shows skeleton tiles in a grid while the connected list loads', async () => {
    await createComponent();

    component.isLoading.set(true);
    fixture.detectChanges();

    expect(
      host.querySelectorAll(
        'ptah-catalog-grid ptah-catalog-card-skeleton[role="listitem"]',
      ),
    ).toHaveLength(3);
  });

  it('does not use innerHTML in the component source', () => {
    expect(
      readFileSync(join(__dirname, 'oauth-surface.component.ts'), 'utf8'),
    ).not.toMatch(/innerHTML/i);
  });
});
