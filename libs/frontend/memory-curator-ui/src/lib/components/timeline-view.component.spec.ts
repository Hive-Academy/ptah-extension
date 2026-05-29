import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppStateManager } from '@ptah-extension/core';

import { MemoryRpcService } from '../services/memory-rpc.service';
import { TimelineStateService } from '../services/timeline-state.service';

import { TimelineViewComponent } from './timeline-view.component';

describe('TimelineViewComponent', () => {
  let searchIndexMock: jest.Mock;
  let timelineMock: jest.Mock;

  beforeEach(async () => {
    searchIndexMock = jest
      .fn()
      .mockResolvedValue({ rows: [], bm25Only: false });
    timelineMock = jest.fn().mockResolvedValue({ rows: [], anchorIndex: 0 });

    await TestBed.configureTestingModule({
      imports: [TimelineViewComponent],
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

  it('renders the empty-state placeholder when no rows match', async () => {
    const fixture = TestBed.createComponent(TimelineViewComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No memories match');
    expect(searchIndexMock).toHaveBeenCalled();
  });

  it('renders rows fetched from the state service', async () => {
    searchIndexMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'mem-1',
          subject: 'Auth bug fix',
          type: 'bugfix',
          concepts: ['auth', 'session'],
          files: ['libs/foo.ts'],
          capturedAt: 1700000000000,
          score: 0.92,
          workspaceRoot: '/ws',
        },
      ],
      bm25Only: false,
    });

    const fixture = TestBed.createComponent(TimelineViewComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Auth bug fix');
    expect(text).toContain('bugfix');
    expect(text).toContain('auth');
  });

  it('clicking Timeline button drills into mem:timeline', async () => {
    searchIndexMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'mem-drill',
          subject: 'pick me',
          type: 'feature',
          concepts: [],
          files: [],
          capturedAt: 1700000000000,
          score: 0.5,
          workspaceRoot: '/ws',
        },
      ],
      bm25Only: false,
    });

    const fixture = TestBed.createComponent(TimelineViewComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    const drillBtn = buttons.find(
      (b) => (b.textContent ?? '').trim() === 'Timeline',
    );
    expect(drillBtn).toBeDefined();
    drillBtn?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(timelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorId: 'mem-drill',
        before: 5,
        after: 5,
      }),
    );
  });
});
