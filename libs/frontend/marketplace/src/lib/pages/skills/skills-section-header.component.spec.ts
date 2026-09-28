/**
 * SkillsSectionHeaderComponent specs (plan C9): the `{enabled}/{total}` line
 * reads the root catalogue without loading it, and the harness badge renders
 * beside it.
 */

import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AppStateManager,
  ClaudeRpcService,
  PluginCatalogService,
  VSCodeService,
} from '@ptah-extension/core';
import { SkillsSectionHeaderComponent } from './skills-section-header.component';

describe('SkillsSectionHeaderComponent', () => {
  let fixture: ComponentFixture<SkillsSectionHeaderComponent>;
  let isLoaded: ReturnType<typeof signal<boolean>>;
  let enabledCount: ReturnType<typeof signal<number>>;
  let pluginTotal: ReturnType<typeof signal<number>>;
  let catalog: { ensureLoaded: jest.Mock; refresh: jest.Mock };
  let rpcCall: jest.Mock;

  beforeEach(() => {
    isLoaded = signal(false);
    enabledCount = signal(0);
    pluginTotal = signal(0);
    catalog = { ensureLoaded: jest.fn(), refresh: jest.fn() };
    rpcCall = jest.fn().mockResolvedValue({
      isSuccess: () => true,
      data: { health: null },
    });

    TestBed.configureTestingModule({
      imports: [SkillsSectionHeaderComponent],
      providers: [
        {
          provide: PluginCatalogService,
          useValue: {
            ...catalog,
            isLoaded: isLoaded.asReadonly(),
            enabledCount: enabledCount.asReadonly(),
            pluginTotal: pluginTotal.asReadonly(),
          },
        },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: AppStateManager,
          useValue: { openSkillsDivergedClones: jest.fn() },
        },
        { provide: VSCodeService, useValue: { isElectron: false } },
      ],
    });

    fixture = TestBed.createComponent(SkillsSectionHeaderComponent);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const count = (): HTMLElement | null =>
    host().querySelector('[data-testid="skills-enabled-count"]');

  it('leaves the count out until the catalogue has been read, and never loads it', () => {
    expect(count()).toBeNull();
    expect(catalog.ensureLoaded).not.toHaveBeenCalled();
    expect(catalog.refresh).not.toHaveBeenCalled();
  });

  it('renders {enabled}/{total} with a spoken alternative once loaded', () => {
    isLoaded.set(true);
    enabledCount.set(3);
    pluginTotal.set(9);
    fixture.detectChanges();

    expect(count()?.textContent?.trim()).toBe('3/9 enabled');
    expect(count()?.getAttribute('aria-hidden')).toBe('true');
    expect(host().querySelector('.sr-only')?.textContent?.trim()).toBe(
      '3 of 9 Ptah plugins enabled',
    );
  });

  it('renders the harness health badge, which reads its cached report', () => {
    expect(
      host().querySelector('[data-testid="harness-health-badge"]'),
    ).toBeTruthy();
    expect(rpcCall).toHaveBeenCalledWith('harness:health', {}, expect.anything());
  });
});
