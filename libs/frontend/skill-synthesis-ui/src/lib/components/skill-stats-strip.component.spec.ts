import { TestBed } from '@angular/core/testing';

import { SkillStatsStripComponent } from './skill-stats-strip.component';

describe('SkillStatsStripComponent', () => {
  it('uses a container-sized grid for populated and loading tiles', () => {
    TestBed.configureTestingModule({ imports: [SkillStatsStripComponent] });
    const fixture = TestBed.createComponent(SkillStatsStripComponent);
    fixture.componentRef.setInput('stats', {
      totalCandidates: 1,
      totalPromoted: 2,
      totalRejected: 3,
      activeSkills: 4,
      totalInvocations: 5,
    });
    fixture.detectChanges();

    const grid = fixture.nativeElement.querySelector(
      '[aria-label="Skill synthesis statistics"]',
    ) as HTMLElement;
    expect(grid.classList.contains('grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]')).toBe(true);
    expect(grid.className).not.toContain('xl:grid-cols-');
    expect(grid.children).toHaveLength(5);

    fixture.componentRef.setInput('stats', null);
    fixture.detectChanges();
    const loadingGrid = fixture.nativeElement.querySelector(
      '[aria-label="Skill synthesis statistics"]',
    ) as HTMLElement;
    expect(loadingGrid.classList.contains('grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]')).toBe(true);
    expect(loadingGrid.className).not.toContain('xl:grid-cols-');
  });
});
