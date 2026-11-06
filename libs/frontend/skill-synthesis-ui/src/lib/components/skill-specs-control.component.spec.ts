import { signal } from '@angular/core';
import { formatDate } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import {
  SkillSynthesisStateService,
  type SkillsHarvestOutcome,
} from '../services/skill-synthesis-state.service';
import { SkillSpecsControlComponent } from './skill-specs-control.component';

describe('SkillSpecsControlComponent', () => {
  function mount() {
    const specs = signal<readonly { status: string }[]>([]);
    const specsLoading = signal(false);
    const staleSpecCount = signal(0);
    const harvesting = signal(false);
    const harvestError = signal<string | null>(null);
    const lastHarvest = signal<SkillsHarvestOutcome | null>(null);
    const refreshSpecs = jest.fn(async () => undefined);
    const harvestSpecs = jest.fn(async () => undefined);
    const clearStaleSpecs = jest.fn(async (_options: { mode: 'archive' }) => 0);

    TestBed.configureTestingModule({
      imports: [SkillSpecsControlComponent],
      providers: [{
        provide: SkillSynthesisStateService,
        useValue: {
          specs, specsLoading, staleSpecCount, harvesting, harvestError, lastHarvest,
          refreshSpecs, harvestSpecs, clearStaleSpecs,
        },
      }],
    });
    const fixture = TestBed.createComponent(SkillSpecsControlComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const harvest = root.querySelector<HTMLButtonElement>('[data-testid="skills-specs-harvest"]');
    const clear = root.querySelector<HTMLButtonElement>('[data-testid="skills-specs-clear-stale"]');
    if (!harvest || !clear) throw new Error('Spec controls are missing');
    return {
      fixture, root, specs, specsLoading, staleSpecCount, harvesting, harvestError, lastHarvest,
      refreshSpecs, harvestSpecs, clearStaleSpecs, harvest, clear,
    };
  }

  it('refreshes on init and shows the spec counts', () => {
    const { fixture, root, specs, staleSpecCount, refreshSpecs } = mount();
    expect(refreshSpecs).toHaveBeenCalledTimes(1);
    specs.set([{ status: 'harvested' }]);
    staleSpecCount.set(1);
    fixture.detectChanges();
    expect(root.textContent).toContain('1 specs, 1 stale');
    expect(root.querySelector('code')?.textContent).toBe('.ptah/specs');
  });

  it('harvests on click and only enables archive clearing when stale specs exist', () => {
    const { fixture, staleSpecCount, harvestSpecs, clearStaleSpecs, harvest, clear } = mount();
    expect(clear.disabled).toBe(true);
    harvest.click();
    expect(harvestSpecs).toHaveBeenCalledTimes(1);
    staleSpecCount.set(2);
    fixture.detectChanges();
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(clearStaleSpecs).toHaveBeenCalledWith({ mode: 'archive' });
  });

  it('disables both actions while specs are loading', () => {
    const { fixture, specsLoading, harvest, clear, staleSpecCount } = mount();
    staleSpecCount.set(1);
    specsLoading.set(true);
    fixture.detectChanges();
    expect(harvest.disabled).toBe(true);
    expect(clear.disabled).toBe(true);
  });

  const AT = Date.UTC(2026, 10, 6, 9, 30);
  const time = () => formatDate(AT, 'shortTime', 'en-US').replace(/\s+/g, ' ');
  const text = (root: HTMLElement, id: string) =>
    root.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim();

  it('shows Harvesting… with a spinner while a harvest runs', () => {
    const { fixture, harvest, harvesting, specsLoading } = mount();
    expect(harvest.textContent?.trim()).toBe('Harvest now');
    harvesting.set(true);
    specsLoading.set(true);
    fixture.detectChanges();
    expect(harvest.textContent?.trim()).toBe('Harvesting…');
    expect(harvest.querySelector('.loading-spinner')).not.toBeNull();
    expect(harvest.getAttribute('aria-busy')).toBe('true');
    expect(harvest.disabled).toBe(true);
  });

  it('renders the harvest counts as a status line', () => {
    const { fixture, root, lastHarvest } = mount();
    expect(root.querySelector('[data-testid="skills-harvest-result"]')).toBeNull();
    lastHarvest.set({ at: AT, scanned: 12, harvested: 3, reconciled: 7, pending: 2, skippedFolders: 0 });
    fixture.detectChanges();
    const line = root.querySelector('[data-testid="skills-harvest-result"]');
    expect(line?.getAttribute('role')).toBe('status');
    expect(text(root, 'skills-harvest-result')).toBe(
      `Last run ${time()}: 12 tasks scanned, 3 harvested, 7 skill runs reconciled`,
    );
  });

  it('says Nothing new to harvest and lists skipped folders', () => {
    const { fixture, root, lastHarvest } = mount();
    lastHarvest.set({ at: AT, scanned: 1, harvested: 0, reconciled: 1, skippedFolders: 2 });
    fixture.detectChanges();
    expect(text(root, 'skills-harvest-result')).toBe(
      `Last run ${time()}: Nothing new to harvest (1 task scanned, 1 skill run reconciled). 2 folders skipped (no task.md)`,
    );
  });

  it('renders a harvest failure as an alert', () => {
    const { fixture, root, harvestError } = mount();
    harvestError.set('Harvest failed. See the logs for details.');
    fixture.detectChanges();
    const alert = root.querySelector('[data-testid="skills-harvest-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent?.trim()).toBe('Harvest failed. See the logs for details.');
  });

  it('counts specs waiting to harvest from complete-unharvested status', () => {
    const { fixture, root, specs } = mount();
    specs.set([
      { status: 'complete-unharvested' },
      { status: 'complete-unharvested' },
      { status: 'active' },
      { status: 'harvested' },
    ]);
    fixture.detectChanges();
    expect(text(root, 'skills-specs-counts')).toBe('4 specs, 0 stale, 2 waiting to harvest');
  });

  it('renders the how-it-works text verbatim', () => {
    const { root } = mount();
    expect(text(root, 'skills-harvest-how-it-works')).toBe(
      'When a task in .ptah/specs is marked done or cancelled, harvest records the skill and agent runs of that task as succeeded (done, with an approving final review) or failed (cancelled, or a rejecting final review), and adds review grades to skill success rates. It runs automatically about 90 seconds after a chat turn ends; Harvest now runs it immediately. Tasks still in progress, and folders without a task.md, are not harvested.',
    );
  });
});
