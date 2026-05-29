import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';

import { MemoryRpcService } from './memory-rpc.service';
import {
  TIMELINE_PAGE_SIZE,
  TimelineStateService,
} from './timeline-state.service';

describe('TimelineStateService', () => {
  let service: TimelineStateService;
  let searchIndexMock: jest.Mock;
  let timelineMock: jest.Mock;

  beforeEach(() => {
    searchIndexMock = jest.fn();
    timelineMock = jest.fn();
    TestBed.configureTestingModule({
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
    });
    service = TestBed.inject(TimelineStateService);
  });

  it('starts with empty filters and zero rows', () => {
    expect(service.rows().length).toBe(0);
    expect(service.hasActiveFilters()).toBe(false);
    expect(service.topK()).toBe(TIMELINE_PAGE_SIZE);
    expect(service.exhausted()).toBe(false);
  });

  it('hasActiveFilters() flips true when a type chip is toggled', () => {
    service.toggleType('bugfix');
    expect(service.hasActiveFilters()).toBe(true);
    expect(service.typeFilter()).toEqual(['bugfix']);
    service.toggleType('bugfix');
    expect(service.typeFilter()).toEqual([]);
    expect(service.hasActiveFilters()).toBe(false);
  });

  it('search() calls mem:searchIndex with the workspace + filters + topK', async () => {
    searchIndexMock.mockResolvedValue({ rows: [], bm25Only: true });
    service.setQuery('auth');
    service.toggleType('bugfix');

    await service.search();

    expect(searchIndexMock).toHaveBeenCalledWith({
      topK: TIMELINE_PAGE_SIZE,
      workspaceRoot: '/ws',
      query: 'auth',
      type: ['bugfix'],
    });
    expect(service.bm25Only()).toBe(true);
    expect(service.loading()).toBe(false);
  });

  it('search() marks exhausted when backend returns fewer rows than requested', async () => {
    searchIndexMock.mockResolvedValue({
      rows: [{ id: 'm-1' }],
      bm25Only: false,
    });

    await service.search();

    expect(service.exhausted()).toBe(true);
  });

  it('search() captures errors into the error signal and clears loading', async () => {
    searchIndexMock.mockRejectedValue(new Error('boom'));

    await service.search();

    expect(service.error()).toBe('boom');
    expect(service.loading()).toBe(false);
  });

  it('loadMore() grows topK by PAGE_SIZE and re-runs search', async () => {
    searchIndexMock.mockResolvedValue({
      rows: new Array(TIMELINE_PAGE_SIZE).fill({ id: 'r' }),
      bm25Only: false,
    });

    await service.search();
    expect(service.exhausted()).toBe(false);

    await service.loadMore();

    expect(service.topK()).toBe(TIMELINE_PAGE_SIZE * 2);
    expect(searchIndexMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ topK: TIMELINE_PAGE_SIZE * 2 }),
    );
  });

  it('loadMore() is a no-op once exhausted is true', async () => {
    searchIndexMock.mockResolvedValue({
      rows: [{ id: 'm-only' }],
      bm25Only: false,
    });
    await service.search();
    expect(service.exhausted()).toBe(true);

    searchIndexMock.mockClear();
    await service.loadMore();

    expect(searchIndexMock).not.toHaveBeenCalled();
  });

  it('drillToTimeline() calls mem:timeline with the anchor + ±5 window', async () => {
    timelineMock.mockResolvedValue({
      rows: [{ id: 'a' }, { id: 'b' }],
      anchorIndex: 1,
    });

    await service.drillToTimeline('mem-xyz');

    expect(timelineMock).toHaveBeenCalledWith({
      anchorId: 'mem-xyz',
      before: 5,
      after: 5,
      workspaceRoot: '/ws',
    });
    expect(service.anchorId()).toBe('mem-xyz');
    expect(service.rows().length).toBe(2);
    expect(service.exhausted()).toBe(true);
  });

  it('reset() clears every signal back to its initial value', async () => {
    searchIndexMock.mockResolvedValue({ rows: [{ id: 'a' }], bm25Only: true });
    service.setQuery('x');
    service.toggleType('bugfix');
    await service.search();

    service.reset();

    expect(service.query()).toBe('');
    expect(service.typeFilter()).toEqual([]);
    expect(service.rows().length).toBe(0);
    expect(service.topK()).toBe(TIMELINE_PAGE_SIZE);
    expect(service.exhausted()).toBe(false);
    expect(service.error()).toBeNull();
    expect(service.anchorId()).toBeNull();
  });
});
