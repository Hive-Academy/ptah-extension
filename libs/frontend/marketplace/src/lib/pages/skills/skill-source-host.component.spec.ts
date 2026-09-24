/**
 * SkillSourceHostComponent specs (plan C9 `SkillSourceHost`): exactly one
 * surface per source, the band as the page's only `<h1>`, and every change
 * output routed to `notifyContentChanged()` (plus the fresh harness read after
 * a plugin save, `skills-section.component.ts:140-143`).
 *
 * The three reused surfaces are replaced by same-selector stubs: their own
 * reads and markup are covered by their own specs, and this host only decides
 * which one exists and what their outputs trigger. The "no tab strip"
 * assertion for the skills.sh browser belongs to Batch 23.
 */

import {
  ChangeDetectionStrategy,
  Component,
  output,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  PluginCatalogPanelComponent,
  SkillShBrowserComponent,
} from '@ptah-extension/chat-ui';
import type { MarketplaceSkillSource } from '@ptah-extension/core';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { ExternalMarketplacesComponent } from '../../external-marketplaces.component';
import { HarnessHealthStore } from '../../harness/harness-health.store';
import {
  MarketplaceLayout,
  type MarketplaceTier,
} from '../../layout/marketplace-layout';
import { SkillsSectionHeaderComponent } from './skills-section-header.component';
import {
  SKILL_SOURCE_BANDS,
  SkillSourceHostComponent,
} from './skill-source-host.component';

@Component({
  selector: 'ptah-plugin-catalog-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="stub-plugin-panel">plugins</p>`,
})
class StubPluginPanelComponent {
  public readonly saved = output<string[]>();
}

@Component({
  selector: 'ptah-skill-sh-browser',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="stub-skill-sh">skills.sh</p>`,
})
class StubSkillShBrowserComponent {
  public readonly skillInstalled = output<unknown>();
  public readonly skillUninstalled = output<string>();
}

@Component({
  selector: 'ptah-external-marketplaces',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-testid="stub-external">marketplaces</p>`,
})
class StubExternalMarketplacesComponent {}

@Component({
  selector: 'ptah-skills-section-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span data-testid="stub-section-header">3/9 enabled</span>`,
})
class StubSectionHeaderComponent {}

const SURFACE_SELECTORS = [
  'ptah-plugin-catalog-panel',
  'ptah-skill-sh-browser',
  'ptah-external-marketplaces',
] as const;

describe('SkillSourceHostComponent', () => {
  let fixture: ComponentFixture<SkillSourceHostComponent>;
  let notifyContentChanged: jest.Mock;
  let harnessRefresh: jest.Mock;
  let tier: ReturnType<typeof signal<MarketplaceTier>>;

  const mount = (source: MarketplaceSkillSource): void => {
    fixture = TestBed.createComponent(SkillSourceHostComponent);
    fixture.componentRef.setInput('source', source);
    fixture.detectChanges();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const mounted = (): string[] =>
    SURFACE_SELECTORS.filter((selector) => host().querySelector(selector));

  beforeEach(() => {
    notifyContentChanged = jest.fn();
    harnessRefresh = jest.fn().mockResolvedValue(undefined);
    tier = signal<MarketplaceTier>('compact');

    TestBed.configureTestingModule({
      imports: [SkillSourceHostComponent],
      providers: [
        {
          provide: MarketplaceInventoryStore,
          useValue: {
            notifyContentChanged,
            newestSessionStatus: signal(null).asReadonly(),
          },
        },
        { provide: HarnessHealthStore, useValue: { refresh: harnessRefresh } },
        { provide: MarketplaceLayout, useValue: { tier: tier.asReadonly() } },
      ],
    });
    TestBed.overrideComponent(SkillSourceHostComponent, {
      remove: {
        imports: [
          PluginCatalogPanelComponent,
          SkillShBrowserComponent,
          ExternalMarketplacesComponent,
          SkillsSectionHeaderComponent,
        ],
      },
      add: {
        imports: [
          StubPluginPanelComponent,
          StubSkillShBrowserComponent,
          StubExternalMarketplacesComponent,
          StubSectionHeaderComponent,
        ],
      },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it.each<[MarketplaceSkillSource, string]>([
    ['ptah-plugins', 'ptah-plugin-catalog-panel'],
    ['community', 'ptah-skill-sh-browser'],
    ['marketplaces', 'ptah-external-marketplaces'],
  ])('mounts exactly one surface for %s', (source, selector) => {
    mount(source);

    expect(mounted()).toEqual([selector]);
    expect(host().getAttribute('data-source')).toBe(source);
  });

  it('swaps the surface when the bound source changes', () => {
    mount('community');
    fixture.componentRef.setInput('source', 'marketplaces');
    fixture.detectChanges();

    expect(mounted()).toEqual(['ptah-external-marketplaces']);
  });

  it.each<MarketplaceSkillSource>(['ptah-plugins', 'community', 'marketplaces'])(
    'renders the band heading as the only <h1> for %s',
    (source) => {
      mount(source);

      const headings = host().querySelectorAll('h1');
      expect(headings).toHaveLength(1);
      expect(headings[0].textContent?.trim()).toBe(
        SKILL_SOURCE_BANDS[source].heading,
      );
    },
  );

  it('uses the storefront band at wide and the compact band otherwise', () => {
    mount('community');
    const band = (): string | null =>
      host()
        .querySelector('[data-testid="source-band"]')
        ?.getAttribute('data-layout') ?? null;
    expect(band()).toBe('compact');

    tier.set('wide');
    fixture.detectChanges();
    expect(band()).toBe('storefront');
  });

  it('shows the enabled count and harness badge on Ptah Plugins only', () => {
    mount('ptah-plugins');
    expect(
      host().querySelector('[data-testid="source-band-actions"] ptah-skills-section-header'),
    ).toBeTruthy();

    fixture.componentRef.setInput('source', 'community');
    fixture.detectChanges();
    expect(host().querySelector('ptah-skills-section-header')).toBeNull();
  });

  it('a plugin save tells the inventory and asks for a FRESH harness report', () => {
    mount('ptah-plugins');
    const panel = fixture.debugElement.query(
      (el) => el.name === 'ptah-plugin-catalog-panel',
    ).componentInstance as StubPluginPanelComponent;

    panel.saved.emit(['ptah-core']);

    expect(notifyContentChanged).toHaveBeenCalledTimes(1);
    expect(harnessRefresh).toHaveBeenCalledWith({ refresh: true });
  });

  it('a skills.sh install or uninstall tells the inventory', () => {
    mount('community');
    const browser = fixture.debugElement.query(
      (el) => el.name === 'ptah-skill-sh-browser',
    ).componentInstance as StubSkillShBrowserComponent;

    browser.skillInstalled.emit({});
    browser.skillUninstalled.emit('deep-research');

    expect(notifyContentChanged).toHaveBeenCalledTimes(2);
    expect(harnessRefresh).not.toHaveBeenCalled();
  });

  it('tells the inventory when the user leaves the Marketplaces source, and only then', () => {
    mount('marketplaces');
    expect(notifyContentChanged).not.toHaveBeenCalled();

    fixture.destroy();
    expect(notifyContentChanged).toHaveBeenCalledTimes(1);
  });

  it('leaving another source does not touch the inventory', () => {
    mount('community');
    fixture.destroy();

    expect(notifyContentChanged).not.toHaveBeenCalled();
  });
});
