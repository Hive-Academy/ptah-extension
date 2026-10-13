import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CanvasStore } from '../canvas.store';
import { TabManagerService } from '@ptah-extension/chat';
import { CanvasDetailService } from './canvas-detail.service';

describe('CanvasDetailService', () => {
  const tiles = signal([
    { tabId: 'a', order: 2 },
    { tabId: 'b', order: 0 },
    { tabId: 'c', order: 1 },
  ]);
  const focusTile = jest.fn();
  const onTabClosed = jest.fn((_listener: (event: { tabId: string; kind: string }) => void) => jest.fn());
  const board = { mode: 'grid' };
  let detail: CanvasDetailService;

  beforeEach(() => {
    tiles.set([
      { tabId: 'a', order: 2 },
      { tabId: 'b', order: 0 },
      { tabId: 'c', order: 1 },
    ]);
    focusTile.mockClear();
    onTabClosed.mockClear();
    board.mode = 'grid';
    TestBed.configureTestingModule({
      providers: [
        CanvasDetailService,
        { provide: CanvasStore, useValue: { tiles, focusTile, boardFor: () => board, activeWorkspacePath: signal('/ws') } },
        { provide: TabManagerService, useValue: { onTabClosed } },
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

  it('restores each tab lane after focusing another tab', () => {
    detail.open('a', 'cli:agent-1');
    detail.open('b', 'sub:agent');
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
    detail.open('a', detail.laneKeyFor('a'));
    expect(detail.laneKey()).toBe('cli:agent-1');
  });

  it('focuses and selects a lane without opening Grid detail in Rail mode', () => {
    board.mode = 'rail';
    detail.open('a', 'cli:agent-1');
    expect(focusTile).toHaveBeenCalledWith('a');
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
    expect(detail.detailTabId()).toBeNull();
    board.mode = 'grid';
  });

  it('keeps the lane after detail closes', () => {
    detail.open('a', 'cli:agent-1');
    detail.close();
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
    expect(detail.laneKey()).toBe('orchestrator');
  });

  it('prunes a closed tab and ignores reset', () => {
    detail.selectLaneFor('a', 'cli:agent-1');
    const listener = onTabClosed.mock.calls[0][0] as (event: { tabId: string; kind: string }) => void;
    listener({ tabId: 'a', kind: 'reset' });
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
    listener({ tabId: 'a', kind: 'close' });
    expect(detail.laneKeyFor('a')).toBe('orchestrator');
  });

  it('keeps map identity when selecting the same lane', () => {
    detail.selectLaneFor('a', 'cli:agent-1');
    const map = (detail as unknown as { _laneKeys: () => ReadonlyMap<string, string> })._laneKeys();
    detail.selectLaneFor('a', 'cli:agent-1');
    expect((detail as unknown as { _laneKeys: () => ReadonlyMap<string, string> })._laneKeys()).toBe(map);
    expect(onTabClosed).toHaveBeenCalledTimes(1);
  });
});
