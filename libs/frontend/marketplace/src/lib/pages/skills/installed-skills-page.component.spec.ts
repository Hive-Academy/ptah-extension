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
import {
  MESSAGE_TYPES,
  type CloneSummary,
  type ExternalPluginListing,
  type InstalledSkill,
  type PluginConfigHomeStatus,
  type PluginInfo,
} from '@ptah-extension/shared';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { encodeSkillRef } from '../../data/skill-ref';
import {
  MarketplaceLayout,
  type MarketplaceTier,
} from '../../layout/marketplace-layout';
import { LibraryChangeFeed } from '../../services/library-change-feed';
import { INSTALLED_LIBRARY_STALE_COPY } from './installed-library-stale-notice.component';
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

const routes: Routes = [
  {
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
  let refresh: jest.Mock;
  let configHome: ReturnType<typeof signal<PluginConfigHomeStatus | null>>;
  let vscodeStub: { isElectron: boolean };

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
    must(
      qa<HTMLAnchorElement>('[data-testid="installed-skill-open"]').find(
        (el) => el.dataset['ref'] === ref,
      ),
    );

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
    refresh = jest.fn().mockResolvedValue(undefined);
    configHome = signal<PluginConfigHomeStatus | null>(null);
    vscodeStub = { isElectron: false };

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
        {
          provide: CommandDiscoveryFacade,
          useValue: { clearCache: jest.fn() },
        },
        { provide: TabManagerService, useValue: { tabs: signal([]) } },
        {
          provide: PluginCatalogService,
          useValue: {
            ensureLoaded,
            refresh,
            configHome: configHome.asReadonly(),
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
        { provide: VSCodeService, useValue: vscodeStub },
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

    expect(q('[data-testid="skills-enabled-count"]')?.textContent?.trim()).toBe(
      '1/4 enabled',
    );
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
      must(
        group('community').querySelector<HTMLElement>(
          '[data-testid="installed-skills-retry"]',
        ),
      ),
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
    expect(manage?.getAttribute('href')).toBe(
      '/marketplace/skills/ptah-plugins',
    );
    expect(
      group('plugins').querySelector(
        '[data-testid="installed-skill-uninstall"]',
      ),
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
      group('plugins').querySelector(
        '[data-testid="installed-skills-no-match"]',
      ),
    ).toBeTruthy();
    expect(
      group('plugins').querySelector('[data-testid="installed-skills-count"]')
        ?.textContent,
    ).toBe('1');
  });

  it('matches every query word across name, description, source and kind', async () => {
    await openPage();
    const search = must(q<HTMLInputElement>('input[type="search"]'));

    search.value = 'marketplace acme/tools';
    search.dispatchEvent(new Event('input'));
    harness.detectChanges();

    expect(names('marketplaces')).toEqual(['lint-kit']);
    expect(names('community')).toEqual([]);
    expect(names('plugins')).toEqual([]);
  });

  // ── Provenance, contents and shadow state ─────────────────────────────────

  it('shows a provenance badge on every row and the agent count', async () => {
    enabledPlugins.set([
      {
        ...plugin('ptah-release-kit', 'Ptah Release Kit'),
        agentCount: 1,
        agentNames: ['release-manager'],
      },
    ]);
    await openPage();

    const badges = qa('[data-testid="installed-skill-provenance"]').map((el) =>
      el.textContent?.trim(),
    );
    expect(badges).toEqual([
      'Plugin: Ptah Release Kit',
      'skills.sh: owner/skills',
      'skills.sh: owner/skills',
      'Plugin: lint-kit',
    ]);
    // Narrow windows: the badge stays one line and truncates, the full
    // origin stays in its title.
    const first = q('[data-testid="installed-skill-provenance"]');
    expect(first?.getAttribute('title')).toBe(
      'Origin: Plugin: Ptah Release Kit',
    );
    expect(first?.querySelector('.truncate')?.textContent).toBe(
      'Plugin: Ptah Release Kit',
    );
    expect(group('plugins').textContent).toContain(
      '2 skills · 1 command · 1 agent',
    );
    // Not Electron: no Library read, so nothing is shadowed.
    expect(methods()).not.toContain('skillSynthesis:listClones');
    expect(q('[data-testid="installed-skill-shadowed"]')).toBeNull();
  });

  it('marks shadowed agents and names orphaned copies in Electron (F7f)', async () => {
    vscodeStub.isElectron = true;
    enabledPlugins.set([
      {
        ...plugin('ptah-release-kit', 'Ptah Release Kit'),
        agentNames: ['release-manager'],
      },
    ]);
    const copy = (
      slug: string,
      provenance: CloneSummary['provenance'],
    ): CloneSummary => ({
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
      provenance,
    });
    responders.set('skillSynthesis:listClones', () =>
      ok({
        clones: [
          copy('release-manager', { kind: 'workspace' }),
          copy('legacy-linter', {
            kind: 'plugin',
            pluginId: 'former-helper',
            name: 'Former Helper',
            state: 'uninstalled',
          }),
        ],
      }),
    );
    await openPage();

    expect(
      group('plugins')
        .querySelector('[data-testid="installed-skill-shadowed"]')
        ?.textContent?.trim(),
    ).toBe('1 agent shadowed');
    expect(
      q('[data-testid="installed-skills-orphaned"]')?.textContent,
    ).toContain('legacy-linter (plugin "Former Helper")');
  });

  // ── Plugin settings notice (D14) ──────────────────────────────────────────

  it('renders no notice while the catalogue has no config-home status', async () => {
    vscodeStub.isElectron = true;
    responders.set('skillSynthesis:listClones', () => ok({ clones: [] }));
    await openPage();

    expect(q('ptah-plugin-config-home-notice')).toBeTruthy();
    expect(q('[data-testid="plugin-config-home-notice"]')).toBeNull();
  });

  it('never mounts the notice outside Electron', async () => {
    configHome.set({
      harnessRoot: '/repo',
      state: 'imported',
      candidates: [
        {
          folder: '/repo/api',
          enabledCount: 1,
          disabledCount: 0,
          differsFromHome: false,
        },
      ],
    });
    await openPage();

    expect(q('ptah-plugin-config-home-notice')).toBeNull();
  });

  it('puts the notice under the header and shows its failure as the plugins actionError', async () => {
    vscodeStub.isElectron = true;
    responders.set('skillSynthesis:listClones', () => ok({ clones: [] }));
    configHome.set({
      harnessRoot: '/repo',
      state: 'imported',
      candidates: [
        {
          folder: '/repo/packages/app',
          enabledCount: 1,
          disabledCount: 0,
          differsFromHome: false,
        },
      ],
    });
    responders.set('plugins:resolve-config-home', () =>
      fail('EACCES: /repo/.ptah/plugins.json'),
    );
    await openPage();

    const notice = must(q('[data-testid="plugin-config-home-notice"]'));
    const header = must(q('[data-testid="installed-skills-page"] header'));
    const search = must(q('[data-testid="installed-skills-search"]'));
    expect(
      header.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      notice.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(notice.textContent).toContain('packages/app');
    expect(notice.textContent).not.toContain('/repo/packages/app');

    await click(
      must(notice.querySelector<HTMLElement>('[data-action="dismiss"]')),
    );

    const error = group('plugins').querySelector(
      '[data-testid="installed-skills-action-error"]',
    );
    expect(error?.textContent?.trim()).toBe(
      'Could not dismiss the plugin settings notice. Try again.',
    );
    expect(error?.textContent).not.toContain('EACCES');
    expect(refresh).not.toHaveBeenCalled();
  });

  // ── Removal ────────────────────────────────────────────────────────────────

  it('uninstalls a community skill and reloads the list', async () => {
    responders.set('skillsSh:uninstall', () => ok({ success: true }));
    await openPage();
    responders.set('skillsSh:listInstalled', () =>
      ok({ skills: [skill('pdf-tools')] }),
    );

    await click(
      must(
        group('community').querySelector<HTMLElement>(
          '[data-testid="installed-skill-uninstall"]',
        ),
      ),
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
      must(
        group('community').querySelector<HTMLElement>(
          '[data-testid="installed-skill-uninstall"]',
        ),
      ),
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
      InstalledSkillsPageComponent | undefined;
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
    expect(q('[data-testid="skill-drawer-heading"]')?.textContent?.trim()).toBe(
      'deep-research',
    );
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
      must(
        row.querySelector<HTMLElement>(
          '[data-testid="installed-skill-uninstall"]',
        ),
      ),
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

  // ── Library-change pushes and the C10 notice (P3 L2, D41c) ────────────────

  describe('library:changed and C10', () => {
    const ROOT = '/repo';
    const releaseKit = {
      ...plugin('ptah-release-kit', 'Ptah Release Kit'),
      agentNames: ['release-manager'],
    };
    const workspaceCopy = (slug: string): CloneSummary => ({
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
    const differsStatus = (): PluginConfigHomeStatus => ({
      harnessRoot: ROOT,
      state: 'differs',
      candidates: [
        {
          folder: `${ROOT}/web`,
          enabledCount: 1,
          disabledCount: 0,
          differsFromHome: true,
        },
      ],
    });

    const push = async (
      status: 'updated' | 'failed',
      workspaceRoot = ROOT,
    ): Promise<void> => {
      TestBed.inject(LibraryChangeFeed).handleMessage({
        type: MESSAGE_TYPES.LIBRARY_CHANGED,
        payload: { workspaceRoot, status, reasons: ['setup-wizard'] },
      });
      TestBed.tick();
      await settle();
    };
    const listCloneCalls = (): number =>
      methods().filter((m) => m === 'skillSynthesis:listClones').length;
    const notice = (): HTMLElement | null =>
      q('[data-testid="installed-library-stale-notice"]');
    const shadowMark = (): string | undefined =>
      group('plugins')
        .querySelector('[data-testid="installed-skill-shadowed"]')
        ?.textContent?.trim();
    const adoptButton = (): HTMLButtonElement =>
      must(
        qa<HTMLButtonElement>('[data-testid="plugin-config-home-action"]').find(
          (b) => b.dataset['action'] === 'adopt',
        ),
      );

    beforeEach(() => {
      vscodeStub.isElectron = true;
      enabledPlugins.set([releaseKit]);
      responders.set('skillSynthesis:listClones', () =>
        ok({ clones: [], scopeRoot: ROOT }),
      );
    });

    it('re-reads the Library copies on a same-root push while the page is mounted', async () => {
      await openPage();
      expect(listCloneCalls()).toBe(1);
      expect(shadowMark()).toBeUndefined();

      // A workspace agent with a plugin agent's slug was generated elsewhere.
      responders.set('skillSynthesis:listClones', () =>
        ok({ clones: [workspaceCopy('release-manager')], scopeRoot: ROOT }),
      );
      await push('updated');

      expect(listCloneCalls()).toBe(2);
      expect(refresh).toHaveBeenCalled();
      expect(shadowMark()).toBe('1 agent shadowed');
      expect(notice()).toBeNull();
    });

    it('shows C10 for a failed same-root pass and clears it on the next good pass', async () => {
      await openPage();

      await push('failed');
      const shown = must(notice());
      expect(shown.getAttribute('role')).toBe('status');
      expect(shown.textContent?.trim()).toBe(INSTALLED_LIBRARY_STALE_COPY);

      await push('updated');
      expect(notice()).toBeNull();
    });

    it('keeps the inventory current after the page was visited and left', async () => {
      await openPage();
      expect(listCloneCalls()).toBe(1);

      // Leave the page for a sibling route with no component: the page is
      // destroyed, the shell-scoped store stays.
      await harness.navigateByUrl('/marketplace/skills/community');
      await settle();
      expect(q('[data-testid="installed-skills-page"]')).toBeNull();

      responders.set('skillSynthesis:listClones', () =>
        ok({ clones: [workspaceCopy('release-manager')], scopeRoot: ROOT }),
      );
      await push('failed');
      // Re-read while nobody shows it, not on the way back.
      expect(listCloneCalls()).toBe(2);

      await openPage();
      expect(listCloneCalls()).toBe(2);
      expect(shadowMark()).toBe('1 agent shadowed');
      expect(must(notice()).textContent?.trim()).toBe(
        INSTALLED_LIBRARY_STALE_COPY,
      );
    });

    it('shows nothing for a failed pass of another root', async () => {
      await openPage();

      await push('failed', '/other-repo');

      expect(listCloneCalls()).toBe(2);
      expect(notice()).toBeNull();
    });

    it('never reacts outside Electron', async () => {
      vscodeStub.isElectron = false;
      await openPage();
      const before = calls.length;

      await push('failed');

      expect(calls.length).toBe(before);
      expect(q('ptah-installed-library-stale-notice')).toBeNull();
    });

    it('shows C10 when a config-home choice answers libraryPass failed (D41c)', async () => {
      configHome.set(differsStatus());
      responders.set('plugins:resolve-config-home', () =>
        ok({ libraryPass: 'failed' }),
      );
      await openPage();
      expect(notice()).toBeNull();

      await click(adoptButton());

      expect(methods()).toContain('plugins:resolve-config-home');
      expect(must(notice()).textContent?.trim()).toBe(
        INSTALLED_LIBRARY_STALE_COPY,
      );
    });

    it('shows no C10 when the config-home choice refreshed the Library', async () => {
      configHome.set(differsStatus());
      responders.set('plugins:resolve-config-home', () =>
        ok({ libraryPass: 'updated' }),
      );
      await openPage();

      await click(adoptButton());

      expect(methods()).toContain('plugins:resolve-config-home');
      expect(notice()).toBeNull();
    });
  });
});
