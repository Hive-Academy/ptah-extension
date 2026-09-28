/**
 * SkillDetailComponent specs (plan C9 `SkillDetail`).
 *
 * Mounted as the routed `:skillRef` child through `RouterTestingHarness`, so
 * the ref reaches it the way production delivers it: percent-encoded by the
 * router and decoded back into the parameter (R6).
 *
 * The inventory is stubbed with writable slices (plan Revision 3 D-4.3: a spec
 * that stubs the store sets `newestSessionStatus` directly) so each state can
 * be driven exactly, including the workspace-switch reload where the open ref
 * disappears (TASK_2026_540 item 6c).
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  ExternalPluginListing,
  HarnessHealth,
  HarnessTargetHealth,
  InstalledSkill,
  PluginInfo,
} from '@ptah-extension/shared';
import {
  MarketplaceInventoryStore,
  type InventoryRemovalOutcome,
  type InventorySlice,
} from '../../data/marketplace-inventory.store';
import { encodeSkillRef, type SkillRef } from '../../data/skill-ref';
import { HarnessHealthStore } from '../../harness/harness-health.store';
import { SkillDetailComponent } from './skill-detail.component';

const EXTERNAL_ID = 'external:acme/tools/lint-kit';

function plugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: 'ptah-core',
    name: 'Ptah Core',
    description: 'Core orchestration skills.',
    category: 'core-tools',
    skillCount: 3,
    commandCount: 1,
    isDefault: true,
    keywords: [],
    ...overrides,
  };
}

function skill(): InstalledSkill {
  return {
    name: 'deep-research',
    description: 'Research a topic in depth.',
    source: 'owner/skills',
    path: '/home/me/.ptah/plugins/skills/deep-research',
    scope: 'global',
    agents: [],
  };
}

function listing(
  overrides: Partial<ExternalPluginListing> = {},
): ExternalPluginListing {
  return {
    id: EXTERNAL_ID,
    name: 'lint-kit',
    description: 'Linting commands.',
    source: 'acme/tools',
    path: 'plugins/lint-kit',
    installed: true,
    installedVersion: '1.2.0',
    version: '1.3.0',
    ...overrides,
  };
}

function target(
  id: HarnessTargetHealth['target'],
  overrides: Partial<HarnessTargetHealth> = {},
): HarnessTargetHealth {
  return {
    target: id,
    detected: true,
    facets: {} as HarnessTargetHealth['facets'],
    expected: 4,
    found: 4,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 1,
    ...overrides,
  };
}

const routes: Routes = [
  {
    path: 'marketplace',
    children: [
      {
        path: 'skills',
        children: [
          { path: ':skillRef', component: SkillDetailComponent },
          { path: '', children: [] },
        ],
      },
    ],
  },
];

describe('SkillDetailComponent', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  let plugins: ReturnType<typeof signal<InventorySlice<PluginInfo>>>;
  let community: ReturnType<typeof signal<InventorySlice<InstalledSkill>>>;
  let marketplaces: ReturnType<
    typeof signal<InventorySlice<ExternalPluginListing>>
  >;
  let pendingIds: ReturnType<typeof signal<ReadonlySet<string>>>;
  let health: ReturnType<typeof signal<HarnessHealth | null>>;
  let targets: ReturnType<typeof signal<readonly HarnessTargetHealth[]>>;
  let store: {
    ensure: jest.Mock;
    retry: jest.Mock;
    removeCommunitySkill: jest.Mock<Promise<InventoryRemovalOutcome>, [string]>;
    removeMarketplacePlugin: jest.Mock<
      Promise<InventoryRemovalOutcome>,
      [ExternalPluginListing]
    >;
  };

  beforeEach(async () => {
    plugins = signal<InventorySlice<PluginInfo>>({
      state: 'ready',
      data: [plugin()],
    });
    community = signal<InventorySlice<InstalledSkill>>({
      state: 'ready',
      data: [skill()],
    });
    marketplaces = signal<InventorySlice<ExternalPluginListing>>({
      state: 'ready',
      data: [listing()],
    });
    pendingIds = signal<ReadonlySet<string>>(new Set());
    health = signal<HarnessHealth | null>(null);
    targets = signal<readonly HarnessTargetHealth[]>([]);
    store = {
      ensure: jest.fn().mockResolvedValue(undefined),
      retry: jest.fn().mockResolvedValue(undefined),
      removeCommunitySkill: jest.fn(),
      removeMarketplacePlugin: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        {
          provide: MarketplaceInventoryStore,
          useValue: {
            ...store,
            plugins: plugins.asReadonly(),
            community: community.asReadonly(),
            marketplaces: marketplaces.asReadonly(),
            pendingIds: pendingIds.asReadonly(),
            newestSessionStatus: signal(null).asReadonly(),
          },
        },
        {
          provide: HarnessHealthStore,
          useValue: {
            health: health.asReadonly(),
            targets: targets.asReadonly(),
          },
        },
      ],
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  afterEach(() => TestBed.resetTestingModule());

  const open = async (raw: string | SkillRef): Promise<void> => {
    const segment = typeof raw === 'string' ? raw : encodeSkillRef(raw);
    const url = router.serializeUrl(
      router.createUrlTree(['/', 'marketplace', 'skills', segment]),
    );
    await harness.navigateByUrl(url);
    harness.detectChanges();
  };

  const root = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const byTestId = (id: string): HTMLElement | null =>
    document.querySelector(`[data-testid="${id}"]`);
  const fact = (label: string): string | undefined =>
    root()
      .querySelector(`[data-fact="${label}"]`)
      ?.textContent?.trim();
  const settle = async (): Promise<void> => {
    await harness.fixture.whenStable();
    harness.detectChanges();
  };

  describe('found', () => {
    it('describes a Ptah plugin and links to its source page', async () => {
      await open({ kind: 'ptah-plugin', id: 'ptah-core' });

      expect(
        byTestId('skill-detail-description')?.textContent?.trim(),
      ).toBe('Core orchestration skills.');
      expect(fact('Kind')).toBe('Ptah plugin');
      expect(fact('Source')).toBe('Ptah');
      expect(fact('Category')).toBe('Core tools');
      expect(fact('Contents')).toBe('3 skills · 1 command');
      expect(fact('Plugin id')).toBe('ptah-core');
      expect(
        byTestId('skill-detail-manage')?.getAttribute('href'),
      ).toBe('/marketplace/skills/ptah-plugins');
      expect(byTestId('skill-detail-uninstall')).toBeNull();
    });

    it('shows a community skill path and asks the store for its slice', async () => {
      await open({ kind: 'community-skill', id: 'deep-research' });

      expect(fact('Path')).toBe('/home/me/.ptah/plugins/skills/deep-research');
      expect(store.ensure).toHaveBeenCalledWith('community');
    });

    it('decodes an external id with / and : and shows both versions', async () => {
      await open({ kind: 'marketplace-plugin', id: EXTERNAL_ID });

      expect(router.url).toContain('%2F');
      expect(fact('Plugin id')).toBe(EXTERNAL_ID);
      expect(fact('Installed version')).toBe('1.2.0');
      expect(fact('Latest version')).toBe('1.3.0');
      expect(fact('Path in repository')).toBe('plugins/lint-kit');
    });

    it('says "Not declared" when a marketplace plugin has no version', async () => {
      marketplaces.set({
        state: 'ready',
        data: [listing({ installedVersion: undefined, version: undefined })],
      });
      await open({ kind: 'marketplace-plugin', id: EXTERNAL_ID });

      expect(fact('Version')).toBe('Not declared');
    });

    it('lists the issues of a broken plugin', async () => {
      plugins.set({
        state: 'ready',
        data: [
          plugin({
            status: 'broken',
            issues: [{ path: '/p/skills/x/SKILL.md', message: 'ENOENT' }],
          }),
        ],
      });
      await open({ kind: 'ptah-plugin', id: 'ptah-core' });

      expect(byTestId('skill-detail-broken')?.textContent).toContain(
        '/p/skills/x/SKILL.md',
      );
    });
  });

  describe('harness targets summary', () => {
    it('says no pass has run while there is no report', async () => {
      await open({ kind: 'ptah-plugin', id: 'ptah-core' });

      expect(byTestId('skill-detail-harness-unknown')).toBeTruthy();
    });

    it('counts detected CLIs only and names the ones needing attention', async () => {
      health.set({} as HarnessHealth);
      targets.set([
        target('claude'),
        target('codex', { missing: ['skills/a/SKILL.md'] }),
        target('cursor', { detected: false, missing: ['x'] }),
      ]);
      await open({ kind: 'community-skill', id: 'deep-research' });

      expect(
        byTestId('skill-detail-harness-summary')?.textContent?.trim(),
      ).toBe('In sync on 1 of 2 detected CLIs');
      expect(
        byTestId('skill-detail-harness-attention')?.textContent,
      ).toContain('Codex');
      expect(
        byTestId('skill-detail-harness-attention')?.textContent,
      ).not.toContain('Cursor');
    });

    it('says so when no CLI is detected', async () => {
      health.set({} as HarnessHealth);
      targets.set([target('cursor', { detected: false })]);
      await open({ kind: 'ptah-plugin', id: 'ptah-core' });

      expect(byTestId('skill-detail-harness-none')).toBeTruthy();
    });
  });

  describe('uninstall', () => {
    it('removes a community skill by name and returns to the list', async () => {
      store.removeCommunitySkill.mockResolvedValue({ status: 'removed' });
      await open({ kind: 'community-skill', id: 'deep-research' });

      byTestId('skill-detail-uninstall')?.click();
      await settle();

      expect(store.removeCommunitySkill).toHaveBeenCalledWith('deep-research');
      expect(router.url).toBe('/marketplace/skills');
    });

    it('removes a marketplace plugin with its listing', async () => {
      store.removeMarketplacePlugin.mockResolvedValue({ status: 'removed' });
      await open({ kind: 'marketplace-plugin', id: EXTERNAL_ID });

      byTestId('skill-detail-uninstall')?.click();
      await settle();

      expect(store.removeMarketplacePlugin).toHaveBeenCalledWith(
        expect.objectContaining({ id: EXTERNAL_ID }),
      );
      expect(router.url).toBe('/marketplace/skills');
    });

    it('keeps the detail and shows the failure inline', async () => {
      store.removeCommunitySkill.mockResolvedValue({
        status: 'failed',
        message: 'Could not uninstall "deep-research".',
      });
      await open({ kind: 'community-skill', id: 'deep-research' });

      byTestId('skill-detail-uninstall')?.click();
      await settle();

      expect(
        byTestId('skill-detail-removal-error')?.textContent?.trim(),
      ).toBe('Could not uninstall "deep-research".');
      expect(router.url).toContain('community-skill');
    });

    it('disables the button while the removal is pending', async () => {
      await open({ kind: 'community-skill', id: 'deep-research' });
      pendingIds.set(new Set(['community-skill:deep-research']));
      harness.detectChanges();

      const button = byTestId('skill-detail-uninstall') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent?.trim()).toBe('Removing…');
    });
  });

  describe('not found, loading and error', () => {
    it('renders "Not found" with a link back for an unknown id', async () => {
      await open({ kind: 'community-skill', id: 'never-installed' });

      expect(byTestId('skill-detail-not-found')).toBeTruthy();
      expect(
        byTestId('skill-detail-not-found')
          ?.querySelector('a')
          ?.getAttribute('href'),
      ).toBe('/marketplace/skills');
    });

    it('renders "Not found" for a malformed ref without loading anything', async () => {
      await open('not-a-ref');

      expect(byTestId('skill-detail-not-found')).toBeTruthy();
      expect(store.ensure).not.toHaveBeenCalled();
    });

    it('shows a skeleton while the slice is still loading', async () => {
      community.set({ state: 'loading', data: [] });
      await open({ kind: 'community-skill', id: 'deep-research' });

      expect(byTestId('skill-detail-loading')).toBeTruthy();
      expect(byTestId('skill-detail-not-found')).toBeNull();
    });

    it('shows the slice error with a Retry that re-reads that slice only', async () => {
      marketplaces.set({
        state: 'error',
        data: [],
        error: 'Could not read installed marketplace plugins.',
      });
      await open({ kind: 'marketplace-plugin', id: EXTERNAL_ID });

      expect(byTestId('skill-detail-error')?.textContent).toContain(
        'Could not read installed marketplace plugins.',
      );
      byTestId('skill-detail-retry')?.click();
      expect(store.retry).toHaveBeenCalledWith('marketplaces');
    });

    it('falls back to "Not found" when the ref disappears after a workspace-switch reload', async () => {
      await open({ kind: 'community-skill', id: 'deep-research' });
      expect(byTestId('skill-detail-description')).toBeTruthy();

      // The store's generation effect discards the old workspace's rows and
      // reloads; the new workspace does not have the skill.
      community.set({ state: 'loading', data: [] });
      harness.detectChanges();
      expect(byTestId('skill-detail-loading')).toBeTruthy();

      community.set({ state: 'ready', data: [] });
      harness.detectChanges();
      expect(byTestId('skill-detail-not-found')).toBeTruthy();
    });

    it('keeps a still-valid detail on screen while its slice reloads', async () => {
      await open({ kind: 'community-skill', id: 'deep-research' });

      community.set({ state: 'loading', data: [skill()] });
      harness.detectChanges();

      expect(byTestId('skill-detail-description')).toBeTruthy();
      expect(byTestId('skill-detail-loading')).toBeNull();
    });
  });
});
