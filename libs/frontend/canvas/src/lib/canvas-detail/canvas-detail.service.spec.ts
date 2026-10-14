import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CanvasStore } from '../canvas.store';
import { TabManagerService } from '@ptah-extension/chat';
import { AgentMonitorStore, BackgroundAgentStore } from '@ptah-extension/chat-streaming';
import { CanvasDetailService } from './canvas-detail.service';

describe('CanvasDetailService', () => {
  const tiles = signal([
    { tabId: 'a', order: 2 },
    { tabId: 'b', order: 0 },
    { tabId: 'c', order: 1 },
  ]);
  const focusTile = jest.fn();
  const subagents = signal(new Map([
    ['agent', { parentSessionId: 'session', parentToolUseId: 'agent', status: 'running' }],
  ]));
  const agents = signal([{ parentSessionId: 'session', agentId: 'agent-1' }]);
  const onTabClosed = jest.fn((_listener: (event: { tabId: string; kind: string }) => void) => jest.fn());
  let detail: CanvasDetailService;

  beforeEach(() => {
    tiles.set([
      { tabId: 'a', order: 2 },
      { tabId: 'b', order: 0 },
      { tabId: 'c', order: 1 },
    ]);
    focusTile.mockClear();
    onTabClosed.mockClear();
    TestBed.configureTestingModule({
      providers: [
        CanvasDetailService,
        { provide: CanvasStore, useValue: { tiles, focusTile } },
        { provide: TabManagerService, useValue: {
          onTabClosed,
          findTabByIdAcrossWorkspaces: (id: string) =>
            tiles().some((tile) => tile.tabId === id) ? { tab: { claudeSessionId: 'session' } } : null,
        } },
        { provide: AgentMonitorStore, useValue: { subagents, agents } },
        { provide: BackgroundAgentStore, useValue: { agents: signal([]) } },
      ],
    });
    detail = TestBed.inject(CanvasDetailService);
  });

  it('focuses a known tab and accepts chat lane keys', () => {
    detail.open('a', 'cli:agent-1');
    expect(detail.detailTabId()).toBeNull();
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
    expect(focusTile).toHaveBeenCalledWith('a');
    detail.open('missing');
    detail.open('a', 'invalid');
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
  });

  it('restores each tab lane after focusing another tab', () => {
    detail.open('a', 'cli:agent-1');
    detail.open('b', 'sub:agent');
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
    detail.open('a', detail.laneKeyFor('a'));
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
  });

  it('rejects an unknown lane without changing the selected lane or focus', () => {
    expect(detail.open('a', 'cli:agent-1')).toBe(true);
    focusTile.mockClear();
    expect(detail.open('a', 'sub:missing')).toBe(false);
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
    expect(focusTile).not.toHaveBeenCalled();
  });

  it('keeps the lane after detail closes', () => {
    detail.open('a', 'cli:agent-1');
    detail.close();
    expect(detail.laneKeyFor('a')).toBe('cli:agent-1');
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
