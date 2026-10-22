import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';
import { SkillSpecsControlComponent } from './skill-specs-control.component';

describe('SkillSpecsControlComponent', () => {
  function mount() {
    const specs = signal<readonly { status: string }[]>([]);
    const specsLoading = signal(false);
    const staleSpecCount = signal(0);
    const refreshSpecs = jest.fn(async () => undefined);
    const harvestSpecs = jest.fn(async () => undefined);
    const clearStaleSpecs = jest.fn(async (_options: { mode: 'archive' }) => 0);

    TestBed.configureTestingModule({
      imports: [SkillSpecsControlComponent],
      providers: [{
        provide: SkillSynthesisStateService,
        useValue: { specs, specsLoading, staleSpecCount, refreshSpecs, harvestSpecs, clearStaleSpecs },
      }],
    });
    const fixture = TestBed.createComponent(SkillSpecsControlComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const harvest = root.querySelector<HTMLButtonElement>('[data-testid="skills-specs-harvest"]');
    const clear = root.querySelector<HTMLButtonElement>('[data-testid="skills-specs-clear-stale"]');
    if (!harvest || !clear) throw new Error('Spec controls are missing');
    return { fixture, root, specs, specsLoading, staleSpecCount, refreshSpecs, harvestSpecs, clearStaleSpecs, harvest, clear };
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
});
