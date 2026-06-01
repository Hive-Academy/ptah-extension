import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppStateManager } from '@ptah-extension/core';

import { MemoryRpcService } from '../services/memory-rpc.service';
import { TimelineStateService } from '../services/timeline-state.service';

import { TimelineFiltersComponent } from './timeline-filters.component';

describe('TimelineFiltersComponent', () => {
  let searchIndexMock: jest.Mock;
  let timelineMock: jest.Mock;

  beforeEach(async () => {
    searchIndexMock = jest
      .fn()
      .mockResolvedValue({ rows: [], bm25Only: false });
    timelineMock = jest.fn().mockResolvedValue({ rows: [], anchorIndex: 0 });

    await TestBed.configureTestingModule({
      imports: [TimelineFiltersComponent],
      providers: [
        TimelineStateService,
        {
          provide: MemoryRpcService,
          useValue: {
            searchIndex: searchIndexMock,
            timeline: timelineMock,
          },
        },
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: signal({
              name: 'w',
              path: '/ws',
              type: 'workspace',
            }),
          },
        },
      ],
    }).compileComponents();
  });

  function findButton(
    fixture: ReturnType<typeof TestBed.createComponent>,
    label: string,
  ): HTMLButtonElement | undefined {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').trim() === label) as
      | HTMLButtonElement
      | undefined;
  }

  it('clicking a type chip toggles the corresponding state filter on/off', () => {
    const fixture = TestBed.createComponent(TimelineFiltersComponent);
    const state = TestBed.inject(TimelineStateService);
    fixture.detectChanges();

    expect(state.typeFilter()).toEqual([]);

    const bugfixChip = findButton(fixture, 'Bugfix');
    expect(bugfixChip).toBeDefined();

    bugfixChip?.click();
    fixture.detectChanges();
    expect(state.typeFilter()).toEqual(['bugfix']);

    bugfixChip?.click();
    fixture.detectChanges();
    expect(state.typeFilter()).toEqual([]);
  });

  it('Apply button invokes state.search() which triggers mem:searchIndex', async () => {
    const fixture = TestBed.createComponent(TimelineFiltersComponent);
    fixture.detectChanges();

    searchIndexMock.mockClear();
    const applyBtn = findButton(fixture, 'Apply');
    expect(applyBtn).toBeDefined();
    applyBtn?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(searchIndexMock).toHaveBeenCalledTimes(1);
  });

  it('Reset clears state + local input signals', async () => {
    const fixture = TestBed.createComponent(TimelineFiltersComponent);
    const state = TestBed.inject(TimelineStateService);
    fixture.detectChanges();

    state.setQuery('hello');
    state.setTypeFilter(['feature']);
    state.setConceptFilter(['auth']);
    fixture.detectChanges();

    const resetBtn = findButton(fixture, 'Reset');
    expect(resetBtn).toBeDefined();
    resetBtn?.click();
    fixture.detectChanges();

    expect(state.query()).toBe('');
    expect(state.typeFilter()).toEqual([]);
    expect(state.conceptFilter()).toEqual([]);
  });
});
