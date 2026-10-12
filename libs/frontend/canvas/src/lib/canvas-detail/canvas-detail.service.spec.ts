import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from './canvas-detail.service';

describe('CanvasDetailService', () => {
  const tiles = signal([
    { tabId: 'a', order: 2 },
    { tabId: 'b', order: 0 },
    { tabId: 'c', order: 1 },
  ]);
  const focusTile = jest.fn();
  let detail: CanvasDetailService;

  beforeEach(() => {
    tiles.set([
      { tabId: 'a', order: 2 },
      { tabId: 'b', order: 0 },
      { tabId: 'c', order: 1 },
    ]);
    focusTile.mockClear();
    TestBed.configureTestingModule({
      providers: [
        CanvasDetailService,
        { provide: CanvasStore, useValue: { tiles, focusTile } },
      ],
    });
    detail = TestBed.inject(CanvasDetailService);
  });

  it('focuses a known tab and accepts chat lane keys', () => {
    detail.open('a', 'cli:agent-1');
    expect(detail.detailTabId()).toBe('a');
    expect(detail.laneKey()).toBe('cli:agent-1');
    expect(focusTile).toHaveBeenCalledWith('a');
    detail.open('missing');
    detail.open('a', 'invalid');
    expect(detail.laneKey()).toBe('cli:agent-1');
  });

  it('toggles the same tab and lane closed', () => {
    detail.toggle('a');
    detail.toggle('a');
    expect(detail.detailTabId()).toBeNull();
    expect(detail.laneKey()).toBe('orchestrator');
    detail.open('a', 'cli:agent-1');
    detail.toggle('a');
    expect(detail.detailTabId()).toBeNull();
  });

  it('steps through tile order and wraps in both directions', () => {
    detail.open('a', 'sub:agent');
    detail.next();
    expect(detail.detailTabId()).toBe('b');
    expect(detail.laneKey()).toBe('orchestrator');
    detail.prev();
    expect(detail.detailTabId()).toBe('a');
    tiles.set(tiles().filter((tile) => tile.tabId !== 'a'));
    detail.next();
    expect(detail.detailTabId()).toBeNull();
  });
});
