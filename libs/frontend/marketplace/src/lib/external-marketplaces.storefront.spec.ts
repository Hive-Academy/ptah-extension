/**
 * ExternalMarketplacesComponent — storefront layout (plan C13, TASK_2026_533
 * Batch 21) and the install / uninstall change outputs the Skills source host
 * binds (Batch 16 follow-up).
 *
 * A sibling of `external-marketplaces.component.spec.ts`, which is over the
 * 700-line cap and must not grow: that file keeps the RPC protocol; this one
 * pins where things render and what the outputs emit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  ExternalMarketplace,
  ExternalPluginListing,
} from '@ptah-extension/shared';
import { ExternalMarketplacesComponent } from './external-marketplaces.component';

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

const SOURCE = 'dotnet/skills';
const PLUGIN_ID = 'external:dotnet/skills/dotnet-test';

const MARKETPLACE: ExternalMarketplace = {
  source: SOURCE,
  name: '.NET Agent Skills',
  pluginCount: 12,
  addedAt: '2026-01-01T00:00:00.000Z',
};

function makeListing(
  overrides: Partial<ExternalPluginListing> = {},
): ExternalPluginListing {
  return {
    id: PLUGIN_ID,
    name: 'dotnet-test',
    description: 'Run and debug .NET tests',
    source: SOURCE,
    path: 'skills/dotnet-test',
    version: '1.2.0',
    installed: false,
    ...overrides,
  };
}

const PLAN = {
  pluginId: PLUGIN_ID,
  source: SOURCE,
  plugin: 'dotnet-test',
  displayName: '.NET Test',
  version: '1.2.0',
  skills: ['dotnet-test'],
  fileCount: 4,
  totalBytes: 1024,
  scriptFiles: [],
  skippedBinaryFiles: [],
  mcpServers: [],
  collisions: [],
  consentToken: 'token-v1',
};

const INSTALL_RESULT = {
  pluginId: PLUGIN_ID,
  displayName: '.NET Test',
  installedVersion: '1.2.0',
  filesWritten: 4,
  skippedBinaryFiles: [],
  collisions: [],
};

describe('ExternalMarketplacesComponent — storefront layout and outputs', () => {
  let fixture: ComponentFixture<ExternalMarketplacesComponent>;
  let component: ExternalMarketplacesComponent;
  let host: HTMLElement;
  let responders: Map<string, (params: unknown) => unknown>;

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      const factory = responders.get(method);
      return factory
        ? Promise.resolve(factory(params))
        : Promise.resolve(fail(`No responder for ${method}`));
    }),
  };

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const createComponent = async (): Promise<void> => {
    fixture = TestBed.createComponent(ExternalMarketplacesComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await settle();
  };

  const listResult = (installed: ExternalPluginListing[] = []) =>
    ok({ marketplaces: [MARKETPLACE], suggestions: [], installed });

  const browseResult = (plugins: ExternalPluginListing[]) =>
    ok({ marketplace: MARKETPLACE, plugins, fromCache: false });

  beforeEach(() => {
    responders = new Map();
    rpcMock.call.mockClear();
    responders.set('plugins:list-marketplaces', () => listResult());
    TestBed.configureTestingModule({
      imports: [ExternalMarketplacesComponent],
      providers: [{ provide: ClaudeRpcService, useValue: rpcMock }],
    });
  });

  it('renders the add form inside one storefront panel', async () => {
    await createComponent();

    const panel = host.querySelector('ptah-storefront-panel');
    expect(panel?.querySelector('h2')?.textContent?.trim()).toBe(
      'External marketplaces',
    );
    expect(
      panel?.querySelector('[data-testid="marketplace-source"]'),
    ).toBeTruthy();
    expect(
      panel?.querySelector('[data-testid="marketplace-add"]'),
    ).toBeTruthy();
  });

  it('renders each registered marketplace as a catalog card list item', async () => {
    await createComponent();

    const cards = host.querySelectorAll(
      'ptah-catalog-grid ptah-catalog-card[role="listitem"]',
    );
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.querySelector('h3')?.textContent?.trim()).toBe(
      '.NET Agent Skills',
    );
    expect(
      card
        .querySelector('[data-testid="catalog-card-meta"]')
        ?.textContent?.trim(),
    ).toBe('dotnet/skills · 12 plugins');
    expect(
      card.querySelector(
        '[data-testid="catalog-card-mark"] ptah-monogram-tile',
      ),
    ).toBeTruthy();
    const actions = card.querySelector('[data-testid="catalog-card-actions"]');
    expect(
      actions?.querySelector(`button[aria-label="Browse ${SOURCE}"]`),
    ).toBeTruthy();
    expect(
      actions?.querySelector(`button[aria-label="Remove ${SOURCE}"]`),
    ).toBeTruthy();
  });

  it('puts the remove confirmation in the source card status slot', async () => {
    await createComponent();

    component.requestRemove(MARKETPLACE);
    fixture.detectChanges();

    const status = host.querySelector(
      'ptah-catalog-card [data-testid="catalog-card-status"]',
    );
    expect(status?.textContent).toContain('are NOT');
    expect(status?.textContent).toContain('Remove marketplace');
  });

  it('shows skeleton tiles in a grid while the list loads', async () => {
    await createComponent();

    component.isLoading.set(true);
    fixture.detectChanges();

    expect(
      host.querySelectorAll(
        'ptah-catalog-grid ptah-catalog-card-skeleton[role="listitem"]',
      ),
    ).toHaveLength(2);
    expect(host.querySelector('ptah-catalog-card')).toBeNull();
  });

  it('browses into a full-width storefront panel whose grid holds the plugin cards', async () => {
    let release: (value: unknown) => void = () => undefined;
    responders.set(
      'plugins:browse-marketplace',
      () => new Promise((resolve) => (release = resolve)),
    );
    await createComponent();

    const browsing = component.refreshBrowse(SOURCE);
    fixture.detectChanges();

    const expansion = host.querySelector(
      'ptah-catalog-grid [role="listitem"].col-span-full ptah-storefront-panel',
    );
    expect(expansion?.querySelector('h3')?.textContent?.trim()).toBe(
      'Plugins in .NET Agent Skills',
    );
    // First fetch in flight: skeleton tiles, not the "no plugins" copy.
    expect(
      expansion?.querySelectorAll(
        'ptah-catalog-card-skeleton[role="listitem"]',
      ),
    ).toHaveLength(2);
    expect(expansion?.textContent).not.toContain('advertises no plugins');

    release(browseResult([makeListing()]));
    await browsing;
    fixture.detectChanges();

    const row = expansion?.querySelector(
      'ptah-catalog-grid ptah-external-plugin-row[role="listitem"]',
    );
    expect(
      row?.querySelector(
        `ptah-catalog-card[data-testid="external-plugin-${PLUGIN_ID}"]`,
      ),
    ).toBeTruthy();
    expect(expansion?.querySelector('ptah-catalog-card-skeleton')).toBeNull();
  });

  it('renders installed plugins as catalog cards with the installed version and orphan state', async () => {
    responders.set('plugins:list-marketplaces', () =>
      ok({
        marketplaces: [],
        suggestions: [],
        installed: [
          makeListing({ installed: true, installedVersion: '1.1.0' }),
        ],
      }),
    );
    await createComponent();

    const row = host.querySelector(
      'ptah-catalog-grid ptah-external-installed-row[role="listitem"]',
    );
    const card = row?.querySelector(
      `ptah-catalog-card[data-testid="external-installed-${PLUGIN_ID}"]`,
    );
    expect(card).toBeTruthy();
    const badge = card?.querySelector('[data-testid="catalog-card-badge"]');
    expect(badge?.textContent?.trim()).toBe('Installed 1.1.0');
    expect(
      card?.querySelector('[data-testid="catalog-card-status"]')?.textContent,
    ).toContain('Marketplace removed');
    expect(
      card?.querySelector('[data-testid="catalog-card-actions"] button')
        ?.textContent,
    ).toContain('Uninstall');
  });

  it('emits pluginInstalled with the plugin id once the authorized call installs', async () => {
    let installCalls = 0;
    responders.set('plugins:browse-marketplace', () =>
      browseResult([makeListing()]),
    );
    responders.set('plugins:install-external', () =>
      ++installCalls === 1
        ? ok({
            status: 'consent-required',
            reason: 'not-yet-approved',
            plan: PLAN,
          })
        : ok({ status: 'installed', result: INSTALL_RESULT }),
    );
    await createComponent();
    const installed: string[] = [];
    component.pluginInstalled.subscribe((id) => installed.push(id));

    await component.install(makeListing());
    expect(installed).toEqual([]);

    await component.confirmInstall();
    expect(installed).toEqual([PLUGIN_ID]);
  });

  it('does not emit pluginInstalled when the user cancels the consent dialog', async () => {
    responders.set('plugins:install-external', () =>
      ok({
        status: 'consent-required',
        reason: 'not-yet-approved',
        plan: PLAN,
      }),
    );
    await createComponent();
    const installed: string[] = [];
    component.pluginInstalled.subscribe((id) => installed.push(id));

    await component.install(makeListing());
    component.cancelInstall();

    expect(installed).toEqual([]);
  });

  it.each([
    ['removed', ok({ pluginId: PLUGIN_ID, removed: true }), [PLUGIN_ID]],
    ['had no record', ok({ pluginId: PLUGIN_ID, removed: false }), []],
    ['failed', fail('locked'), []],
  ])(
    'emits pluginUninstalled only when the plugin was removed (%s)',
    async (_case, answer, expected) => {
      responders.set('plugins:uninstall-external', () => answer);
      await createComponent();
      const uninstalled: string[] = [];
      component.pluginUninstalled.subscribe((id) => uninstalled.push(id));

      await component.uninstall(makeListing({ installed: true }));

      expect(uninstalled).toEqual(expected);
    },
  );

  describe('uninstall from the flat Installed list', () => {
    const installedEntry = makeListing({
      installed: true,
      installedVersion: '1.2.0',
    });
    const methods = (): string[] =>
      rpcMock.call.mock.calls.map(([method]) => method);
    const installedCard = (): HTMLElement | null =>
      host.querySelector(
        `ptah-catalog-card[data-testid="external-installed-${PLUGIN_ID}"]`,
      );

    it('reloads the Installed list and does not expand or browse the marketplace', async () => {
      let removed = false;
      responders.set('plugins:list-marketplaces', () =>
        listResult(removed ? [] : [installedEntry]),
      );
      responders.set('plugins:uninstall-external', () => {
        removed = true;
        return ok({ pluginId: PLUGIN_ID, removed: true });
      });
      await createComponent();
      expect(installedCard()).toBeTruthy();

      await component.uninstall(installedEntry);
      fixture.detectChanges();

      expect(component.installed()).toEqual([]);
      expect(installedCard()).toBeNull();
      expect(component.expandedSource()).toBeNull();
      expect(methods()).not.toContain('plugins:browse-marketplace');
    });

    it('re-reads the browse list only when that marketplace is already open', async () => {
      responders.set('plugins:list-marketplaces', () =>
        listResult([installedEntry]),
      );
      responders.set('plugins:browse-marketplace', () =>
        browseResult([installedEntry]),
      );
      responders.set('plugins:uninstall-external', () =>
        ok({ pluginId: PLUGIN_ID, removed: true }),
      );
      await createComponent();
      await component.refreshBrowse(SOURCE);
      rpcMock.call.mockClear();

      await component.uninstall(installedEntry);

      expect(methods()).toEqual([
        'plugins:uninstall-external',
        'plugins:list-marketplaces',
        'plugins:browse-marketplace',
      ]);
      expect(component.expandedSource()).toBe(SOURCE);
    });

    it('shows a failed uninstall of an orphaned plugin on its Installed card', async () => {
      responders.set('plugins:list-marketplaces', () =>
        ok({ marketplaces: [], suggestions: [], installed: [installedEntry] }),
      );
      responders.set('plugins:uninstall-external', () =>
        fail('plugin directory is locked'),
      );
      await createComponent();

      await component.uninstall(installedEntry);
      fixture.detectChanges();

      const alert = installedCard()?.querySelector(
        '[data-testid="catalog-card-status"] [role="alert"]',
      );
      expect(alert?.textContent?.trim()).toBe('plugin directory is locked');
      expect(component.browseError()).toBeNull();
      expect(methods()).not.toContain('plugins:browse-marketplace');

      // A successful retry clears the card error.
      responders.set('plugins:uninstall-external', () =>
        ok({ pluginId: PLUGIN_ID, removed: true }),
      );
      await component.uninstall(installedEntry);
      fixture.detectChanges();
      expect(component.uninstallErrors()).toEqual({});
    });

    it('shows a failed uninstall in the open browse panel of its source', async () => {
      responders.set('plugins:list-marketplaces', () =>
        listResult([installedEntry]),
      );
      responders.set('plugins:browse-marketplace', () =>
        browseResult([installedEntry]),
      );
      responders.set('plugins:uninstall-external', () => fail('locked'));
      await createComponent();
      await component.refreshBrowse(SOURCE);

      await component.uninstall(installedEntry);
      fixture.detectChanges();

      expect(component.browseError()).toBe('locked');
      expect(component.uninstallErrors()).toEqual({});
      expect(
        host.querySelector(
          '.col-span-full ptah-storefront-panel [role="alert"]',
        )?.textContent,
      ).toContain('locked');
    });

    it('keeps each orphaned plugin its own error; a retry clears only its own', async () => {
      const orphanA = makeListing({
        id: 'external:a/a/alpha',
        name: 'alpha',
        source: 'a/a',
        installed: true,
      });
      const orphanB = makeListing({
        id: 'external:b/b/beta',
        name: 'beta',
        source: 'b/b',
        installed: true,
      });
      responders.set('plugins:list-marketplaces', () =>
        ok({
          marketplaces: [],
          suggestions: [],
          installed: [orphanA, orphanB],
        }),
      );
      responders.set('plugins:uninstall-external', (params) =>
        fail(`${(params as { pluginId: string }).pluginId} is locked`),
      );
      await createComponent();
      const alertOf = (id: string): string | undefined =>
        host
          .querySelector(
            `ptah-catalog-card[data-testid="external-installed-${id}"] [role="alert"]`,
          )
          ?.textContent?.trim();

      await component.uninstall(orphanA);
      await component.uninstall(orphanB);
      fixture.detectChanges();

      expect(alertOf(orphanA.id)).toBe('external:a/a/alpha is locked');
      expect(alertOf(orphanB.id)).toBe('external:b/b/beta is locked');

      responders.set('plugins:uninstall-external', () =>
        ok({ pluginId: orphanA.id, removed: true }),
      );
      responders.set('plugins:list-marketplaces', () =>
        ok({ marketplaces: [], suggestions: [], installed: [orphanB] }),
      );
      await component.uninstall(orphanA);
      fixture.detectChanges();

      expect(component.uninstallErrors()).toEqual({
        [orphanB.id]: 'external:b/b/beta is locked',
      });
      expect(alertOf(orphanB.id)).toBe('external:b/b/beta is locked');
    });

    it('leaves an open panel’s browse error alone when an unrelated plugin is uninstalled', async () => {
      const orphan = makeListing({
        id: 'external:y/y/gamma',
        name: 'gamma',
        source: 'y/y',
        installed: true,
      });
      responders.set('plugins:list-marketplaces', () => listResult([orphan]));
      responders.set('plugins:browse-marketplace', () =>
        fail(`Failed to browse ${SOURCE}`),
      );
      responders.set('plugins:uninstall-external', () =>
        ok({ pluginId: orphan.id, removed: true }),
      );
      await createComponent();
      await component.refreshBrowse(SOURCE);
      expect(component.browseError()).toBe(`Failed to browse ${SOURCE}`);

      await component.uninstall(orphan);
      fixture.detectChanges();

      expect(component.expandedSource()).toBe(SOURCE);
      expect(component.browseError()).toBe(`Failed to browse ${SOURCE}`);
      expect(
        host.querySelector(
          '.col-span-full ptah-storefront-panel [role="alert"]',
        )?.textContent,
      ).toContain(`Failed to browse ${SOURCE}`);
    });
  });

  it('renders the post-install report and clears it on Dismiss', async () => {
    await createComponent();
    component.lastInstall.set({
      ...INSTALL_RESULT,
      skippedBinaryFiles: ['assets/logo.png'],
    });
    fixture.detectChanges();

    const report = host.querySelector('ptah-external-install-report');
    expect(report?.textContent).toContain(
      'Installed .NET Test 1.2.0 (4 files)',
    );
    expect(report?.textContent).toContain('assets/logo.png');

    const dismiss = Array.from(
      report?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    ).find((button) => button.textContent?.trim() === 'Dismiss');
    dismiss?.click();
    fixture.detectChanges();

    expect(component.lastInstall()).toBeNull();
    expect(host.querySelector('ptah-external-install-report')).toBeNull();
  });

  it.each([
    'external-marketplaces.component.ts',
    'external-plugin-row.component.ts',
    'external-installed-row.component.ts',
    'external-install-report.component.ts',
  ])('%s does not use innerHTML', (file) => {
    expect(readFileSync(join(__dirname, file), 'utf8')).not.toMatch(
      /innerHTML/i,
    );
  });
});
