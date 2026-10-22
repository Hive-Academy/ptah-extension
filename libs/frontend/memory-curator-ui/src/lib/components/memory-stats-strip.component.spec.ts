import { TestBed } from '@angular/core/testing';

import { MemoryStatsStripComponent } from './memory-stats-strip.component';

describe('MemoryStatsStripComponent', () => {
  it('uses a container-sized grid for its five tiles', () => {
    TestBed.configureTestingModule({ imports: [MemoryStatsStripComponent] });
    const fixture = TestBed.createComponent(MemoryStatsStripComponent);
    fixture.componentRef.setInput('counts', {
      core: 1,
      recall: 2,
      archival: 3,
      codeIndex: 4,
    });
    fixture.detectChanges();

    const grid = fixture.nativeElement.querySelector(
      '[aria-label="Memory tier statistics"]',
    ) as HTMLElement;
    expect(grid.classList.contains('grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]')).toBe(true);
    expect(grid.className).not.toContain('xl:grid-cols-');
    expect(grid.children).toHaveLength(5);
  });
});
