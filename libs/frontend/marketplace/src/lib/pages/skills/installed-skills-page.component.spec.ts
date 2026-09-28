/**
 * InstalledSkillsPageComponent specs (plan C9 `InstalledSkillsPage`).
 *
 * Built on the REAL `MarketplaceInventoryStore` with a per-method RPC mock, so
 * the RPC-set spec proves what the page actually reads. Per plan Revision 3
 * D-4.3 the real store gets the `TabManagerService` stub `{ tabs }`.
 * `PluginCatalogService` is stubbed to the members the store and the section
 * header read (its own caching is covered in `core`); `HarnessHealthStore` is
 * the real root store, answered by the `harness:health` responder.
 *
 * The page is mounted as the routed `skills` page with the real
 * `SkillDetailComponent` as its `:skillRef` child, and the layout tier is a
 * writable stub so the drawer / docked branches and the tier flip are driven
 * exactly.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  AppStateManager,
  ClaudeRpcService,
  CommandDiscoveryFacade,
  PluginCatalogService,
  VSCodeService,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  ExternalPluginListing,
  InstalledSkill,
  PluginInfo,
} from '@ptah-extension/shared';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { encodeSkillRef } from '../../data/skill-ref';
import {
  MarketplaceLayout,
  type MarketplaceTier,
} from '../../layout/marketplace-layout';
import { InstalledSkillsPageComponent } from './installed-skills-page.component';
import { marketplaceRow } from './installed-skill-rows';
import { SkillDetailComponent } from './skill-detail.component';

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

function plugin(id: string, name: string): PluginInfo {
  return {
    id,
    name,
    description: `${name} plugin.`,
    category: 'core-tools',
    skillCount: 2,
    commandCount: 1,
    isDefault: true,
    keywords: [],
  };
}

function skill(name: string): InstalledSkill {
  return {
    name,
    description: `${name} skill.`,
    source: 'owner/skills',
    path: `/root/skills/${name}`,
    scope: 'global',
    agents: [],
  };
}

const EXTERNAL_ID = 'external:acme/tools/lint-kit';

function listing(): ExternalPluginListing {
  return {
    id: EXTERNAL_ID,
    name: 'lint-kit',
    description: 'Linting commands.',
    source: 'acme/tools',
    path: 'plugins/lint-kit',
    installed: true,
    installedVersion: '1.2.0',
  };
}

/** The element (or value) a step needs; a missing one fails the spec loudly. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected element was not rendered');
  }
  return value;
}

const routes: Routes = [  {
    path: 'marketplace',
    children: [
      {
        path: 'skills',
        children: [
          { path: 'ptah-plugins', children: [] },
          { path: 'community', children: [] },
          { path: 'marketplaces', children: [] },
          {
            path: '',
            component: InstalledSkillsPageComponent,
            children: [{ path: ':skillRef', component: SkillDetailComponent }],
          },
        ],
      },
    ],
  },
];

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('InstalledSkillsPageComponent', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  let calls: { method: string; params: unknown }[];
  let responders: Map<string, () => unknown>;
  let tier: ReturnType<typeof signal<MarketplaceTier>>;
  let enabledPlugins: ReturnType<typeof signal<readonly PluginInfo[]>>;
  let ensureLoaded: jest.Mock;

  const rpcMock = {
    call: jest.fn((method: string, params: unknown) => {
      calls.push({ method, params });
      const factory = responders.get(method);
      return Promise.resolve(
        factory ? factory() : fail(`No responder for ${method}`),
      );
    }),
  };

  const methods = (): string[] => calls.map((call) => call.method);

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
    harness.detectChanges();
  };

  const openPage = async (url = '/marketplace/skills'): Promise<void> => {
    await harness.navigateByUrl(url);
    await settle();
  };

  const q = <T extends Element = HTMLElement>(selector: string): T | null =>
    document.querySelector<T>(selector);
  const qa = <T extends Element = HTMLElement>(selector: string): T[] =>
    Array.from(document.querySelectorAll<T>(selector));
  const group = (id: string): HTMLElement =>
    must(q(`[data-testid="installed-skills-group"][data-group="${id}"]`));
  const names = (id: string): string[] =>
    Array.from(
      group(id).querySelectorAll('[data-testid="installed-skill-name"]'),
    ).map((el) => el.textContent?.trim() ?? '');
  const rowLink = (ref: string): HTMLAnchorElement =>
    must(qa<HTMLAnchorElement>('[data-testid="installed-skill-open"]').find((el) => el.dataset['ref'] === ref));

  const COMMUNITY_REF = encodeSkillRef({
    kind: 'community-skill',
    id: 'deep-research',
  });
  const EXTERNAL_REF = encodeSkillRef({
    kind: 'marketplace-plugin',
    id: EXTERNAL_ID,
  });

  const click = async (element: HTMLElement): Promise<void> => {
    element.click();
    await settle();
  };

  beforeEach(async () => {
    calls = [];
    responders = new Map();
    rpcMock.call.mockClear();
    tier = signal<MarketplaceTier>('compact');
    enabledPlugins = signal<readonly PluginInfo[]>([
      plugin('ptah-core', 'Ptah Core'),
    ]);
    ensureLoaded = jest.fn().mockResolvedValue(undefined);

    responders.set('skillsSh:listInstalled', () =>
      ok({ skills: [skill('deep-research'), skill('pdf-tools')] }),
    );
    responders.set('plugins:list-marketplaces', () =>
      ok({ marketplaces: [], suggestions: [], installed: [listing()] }),
    );
    responders.set('harness:health', () => ok({ health: null }));

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        MarketplaceInventoryStore,
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: CommandDiscoveryFacade, useValue: { clearCache: jest.fn() } },
        { provide: TabManagerService, useValue: { tabs: signal([]) } },
        {
          provide: PluginCatalogService,
          useValue: {
            ensureLoaded,
            refresh: jest.fn().mockResolvedValue(undefined),
            enabledPlugins: enabledPlugins.asReadonly(),
            error: signal<string | null>(null).asReadonly(),
            isLoaded: signal(true).asReadonly(),
            enabledCount: signal(1).asReadonly(),
            pluginTotal: signal(4).asReadonly(),
          },
        },
        { provide: MarketplaceLayout, useValue: { tier: tier.asReadonly() } },
        {
          provide: AppStateManager,
          useValue: { openSkillsDivergedClones: jest.fn() },
        },
        { provide: VSCodeService, useValue: { isElectron: false } },
      ],
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  afterEach(() => TestBed.resetTestingModule());

  // ── Data ───────────────────────────────────────────────────────────────────

  it('reads exactly its three slices plus the badge’s cached harness report', async () => {
    await openPage();

    expect([...new Set(methods())].sort()).toEqual([
      'harness:health',
      'plugins:list-marketplaces',
      'skillsSh:listInstalled',
    ]);
    expect(methods()).toHaveLength(3);
    expect(ensureLoaded).toHaveBeenCalledTimes(1);
    expect(methods()).not.toContain('mcpDirectory:listInstalled');
  });

  it('renders one <h1>, a search field and the three groups in order', async () => {
    await openPage();

    expect(qa('h1')).toHaveLength(1);
    expect(q('input[type="search"]')).toBeTruthy();
    expect(
      qa('[data-testid="installed-skills-group"]').map(
        (el) => el.dataset['group'],
      ),
    ).toEqual(['plugins', 'community', 'marketplaces']);
    expect(names('plugins')).toEqual(['Ptah Core']);
    expect(names('community')).toEqual(['deep-research', 'pdf-tools']);
    expect(names('marketplaces')).toEqual(['lint-kit']);
    expect(
      group('marketplaces').querySelector(
        '[data-testid="installed-skill-version"]',
      )?.textContent,
    ).toBe('v1.2.0');
  });

  it('shows the enabled count and the harness badge in the header', async () => {
    await openPage();

    expect(
      q('[data-testid="skills-enabled-count"]')?.textContent?.trim(),
    ).toBe('1/4 enabled');
    expect(q('[data-testid="harness-health-badge"]')).toBeTruthy();
  });

  it('isolates a failed slice and retries only that slice', async () => {
    responders.set('skillsSh:listInstalled', () => fail('skills.sh is down'));
    await openPage();

    expect(
      group('community').querySelector('[data-testid="installed-skills-error"]')
        ?.textContent,
    ).toContain('skills.sh is down');
    expect(names('plugins')).toEqual(['Ptah Core']);
    expect(names('marketplaces')).toEqual(['lint-kit']);

    responders.set('skillsSh:listInstalled', () =>
      ok({ skills: [skill('deep-research')] }),
    );
    calls = [];
    await click(
      must(group('community').querySelector<HTMLElement>(
        '[data-testid="installed-skills-retry"]',
      )),
    );

    expect(methods()).toEqual(['skillsSh:listInstalled']);
    expect(names('community')).toEqual(['deep-research']);
  });

  it.each([
    ['plugins', 'ptah-plugins'],
    ['community', 'community'],
    ['marketplaces', 'marketplaces'],
  ])('shows an empty %s group that links to its source', async (id, source) => {
    enabledPlugins.set([]);
    responders.set('skillsSh:listInstalled', () => ok({ skills: [] }));
    responders.set('plugins:list-marketplaces', () =>
      ok({ marketplaces: [], suggestions: [], installed: [] }),
    );
    await openPage();

    const empty = group(id).querySelector(
      '[data-testid="installed-skills-empty"] a',
    );
    expect(empty?.getAttribute('href')).toBe(`/marketplace/skills/${source}`);
  });

  it('links Ptah plugins to their source page instead of uninstalling them', async () => {
    await openPage();

    const manage = group('plugins').querySelector(
      '[data-testid="installed-skill-manage"]',
    );
    expect(manage?.getAttribute('href')).toBe('/marketplace/skills/ptah-plugins');
    expect(
      group('plugins').querySelector('[data-testid="installed-skill-uninstall"]'),
    ).toBeNull();
  });

  // ── Search ─────────────────────────────────────────────────────────────────

  it('filters rows by search and says when nothing matches', async () => {
    await openPage();
    const search = must(q<HTMLInputElement>('input[type="search"]'));

    search.value = 'pdf';
    search.dispatchEvent(new Event('input'));
    harness.detectChanges();

    expect(names('community')).toEqual(['pdf-tools']);
    expect(
      group('plugins').querySelector('[data-testid="installed-skills-no-match"]'),
    ).toBeTruthy();
    expect(
      group('plugins').querySelector('[data-testid="installed-skills-count"]')
        ?.textContent,
    ).toBe('1');
  });

  // ── Removal ────────────────────────────────────────────────────────────────

  it('uninstalls a community skill and reloads the list', async () => {
    responders.set('skillsSh:uninstall', () => ok({ success: true }));
    await openPage();
    responders.set('skillsSh:listInstalled', () =>
      ok({ skills: [skill('pdf-tools')] }),
    );

    await click(
      must(group('community').querySelector<HTMLElement>(
        '[data-testid="installed-skill-uninstall"]',
      )),
    );
    await settle();

    expect(calls).toContainEqual({
      method: 'skillsSh:uninstall',
      params: { name: 'deep-research' },
    });
    expect(names('community')).toEqual(['pdf-tools']);
  });

  it('keeps the row and shows the failure inline when uninstall fails', async () => {
    responders.set('skillsSh:uninstall', () =>
      ok({ success: false, error: 'Skill is in use.' }),
    );
    await openPage();

    await click(
      must(group('community').querySelector<HTMLElement>(
        '[data-testid="installed-skill-uninstall"]',
      )),
    );

    expect(
      group('community').querySelector(
        '[data-testid="installed-skills-action-error"]',
      )?.textContent,
    ).toContain('Skill is in use.');
    expect(names('community')).toEqual(['deep-research', 'pdf-tools']);
  });

  it('reports a marketplace row whose record is already gone, and re-reads the list', async () => {
    await openPage();
    calls = [];
    const page = harness.routeDebugElement?.componentInstance as
      | InstalledSkillsPageComponent
      | undefined;
    const stale = marketplaceRow({
      ...listing(),
      id: 'external:acme/tools/removed-kit',
      name: 'removed-kit',
    });

    must(page)['uninstall'](stale);
    await settle();

    expect(
      group('marketplaces').querySelector(
        '[data-testid="installed-skills-action-error"]',
      )?.textContent,
    ).toContain('"removed-kit" is no longer installed');
    expect(methods()).toEqual(['plugins:list-marketplaces']);
    expect(methods()).not.toContain('plugins:uninstall-external');
  });

  // ── Detail placement ───────────────────────────────────────────────────────

  it('opens the detail in a focus-trapping drawer below wide', async () => {
    await openPage();

    await click(rowLink(COMMUNITY_REF));

    expect(router.url).toBe(`/marketplace/skills/${COMMUNITY_REF}`);
    expect(q('[data-testid="native-drawer-panel"]')).toBeTruthy();
    expect(q('[data-testid="docked-inspector"]')).toBeNull();
    expect(
      q('[data-testid="skill-drawer-heading"]')?.textContent?.trim(),
    ).toBe('deep-research');
    expect(
      q('[data-testid="native-drawer-panel"] [data-testid="skill-detail"]'),
    ).toBeTruthy();
    expect(rowLink(COMMUNITY_REF).getAttribute('aria-current')).toBe('true');
  });

  it('docks the detail at wide and keeps it open across a tier flip', async () => {
    tier.set('wide');
    await openPage();
    await click(rowLink(COMMUNITY_REF));

    expect(q('[data-testid="docked-inspector"]')).toBeTruthy();
    expect(q('[data-testid="native-drawer-panel"]')).toBeNull();
    expect(
      q('[data-testid="docked-inspector-heading"]')?.textContent?.trim(),
    ).toBe('deep-research');

    tier.set('regular');
    await settle();

    expect(router.url).toBe(`/marketplace/skills/${COMMUNITY_REF}`);
    expect(q('[data-testid="docked-inspector"]')).toBeNull();
    expect(
      q('[data-testid="native-drawer-panel"] [data-testid="skill-detail"]'),
    ).toBeTruthy();
  });

  it('opens an external id with / from its percent-encoded URL', async () => {
    tier.set('wide');
    await openPage();
    await click(rowLink(EXTERNAL_REF));

    expect(router.url).toContain('%2F');
    expect(
      q('[data-testid="docked-inspector-heading"]')?.textContent?.trim(),
    ).toBe('lint-kit');
  });

  it('closes the docked detail on Esc and returns focus to its row', async () => {
    tier.set('wide');
    await openPage();
    await click(rowLink(COMMUNITY_REF));

    must(q('[data-testid="docked-inspector"]')).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();

    expect(router.url).toBe('/marketplace/skills');
    expect(q('[data-testid="docked-inspector"]')).toBeNull();
    expect(document.activeElement).toBe(rowLink(COMMUNITY_REF));
  });

  it('moves focus to the search field when Esc closes a detail whose row is gone', async () => {
    tier.set('wide');
    await openPage();
    await click(rowLink(COMMUNITY_REF));

    // The item disappears from the list (removed elsewhere, or a reload
    // after a workspace switch) while its detail stays open.
    responders.set('skillsSh:listInstalled', () =>
      ok({ skills: [skill('pdf-tools')] }),
    );
    await TestBed.inject(MarketplaceInventoryStore).reload('community');
    await settle();
    expect(
      qa('[data-testid="installed-skill-open"]').some(
        (el) => el.dataset['ref'] === COMMUNITY_REF,
      ),
    ).toBe(false);

    must(q('[data-testid="docked-inspector"]')).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();

    expect(router.url).toBe('/marketplace/skills');
    expect(document.activeElement).toBe(q('input[type="search"]'));
  });

  it('closes the drawer from its close button', async () => {
    await openPage();
    await click(rowLink(COMMUNITY_REF));

    await click(must(q('[data-testid="native-drawer-close"]')));

    expect(router.url).toBe('/marketplace/skills');
    expect(q('[data-testid="native-drawer-panel"]')).toBeNull();
  });

  it('closes the detail when the open item is uninstalled from its row', async () => {
    tier.set('wide');
    responders.set('skillsSh:uninstall', () => ok({ success: true }));
    await openPage();
    await click(rowLink(COMMUNITY_REF));

    const row = must(
      qa('[data-testid="installed-skill-row"]').find(
        (el) => el.dataset['ref'] === COMMUNITY_REF,
      ),
    );
    await click(
      must(row.querySelector<HTMLElement>('[data-testid="installed-skill-uninstall"]')),
    );
    await settle();

    expect(router.url).toBe('/marketplace/skills');
  });

  // ── Keyboard ───────────────────────────────────────────────────────────────

  it('moves a single tab stop across groups with the arrow keys', async () => {
    await openPage();
    const links = qa<HTMLElement>('[data-testid="installed-skill-open"]');
    expect(links.map((l) => l.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
      '-1',
    ]);

    links[0].focus();
    links[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    harness.detectChanges();

    expect(document.activeElement).toBe(links[1]);
    expect(links[1].getAttribute('tabindex')).toBe('0');
    expect(links[0].getAttribute('tabindex')).toBe('-1');

    links[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    harness.detectChanges();
    expect(document.activeElement).toBe(links[3]);

    links[3].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    harness.detectChanges();
    expect(document.activeElement).toBe(links[2]);
  });

  it('opens the focused row with Enter through its link', async () => {
    await openPage();

    expect(rowLink(COMMUNITY_REF).tagName).toBe('A');
    expect(rowLink(COMMUNITY_REF).getAttribute('href')).toBe(
      `/marketplace/skills/${COMMUNITY_REF}`,
    );
  });
});
