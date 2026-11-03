/**
 * closeBackgroundTab (TASK_2026_863) — the machine-driven close of a tab
 * parked in a BACKGROUND workspace partition, against the REAL partition
 * service (removal, session index, persistence). The stream abort and the
 * close event are fakes: the helper's contract is their order and payload.
 *
 * `TabManagerService.closeTab` covers the active workspace's tabs only, so
 * the auto-hand-off source closer needs this path for a source that lives in
 * a non-active workspace. The close event it emits must be the same `close`
 * event `closeTab` emits, so the session ender stops the source's SDK
 * process exactly once.
 */

import { TestBed } from '@angular/core/testing';
import { TabState, type SessionStatus } from '@ptah-extension/chat-types';
import type { SessionId, TabId } from '@ptah-extension/shared';

import type { ClosedTabEvent } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';
import { closeBackgroundTab } from './tab-cross-partition-close';

const makeTab = (
  id: string,
  sessionId: string | null = null,
  status: TabState['status'] = 'loaded',
  isDirty = false,
): TabState => ({
  id: id as TabId,
  claudeSessionId: sessionId as SessionId | null,
  name: id,
  title: id,
  order: 0,
  status,
  isDirty,
  lastActivityAt: 0,
  messages: [],
  streamingState: null,
});

describe('closeBackgroundTab', () => {
  let svc: TabWorkspacePartitionService;
  let abortStreaming: jest.Mock;
  let events: ClosedTabEvent[];

  /** Park the given tabs in /ws/a and make /ws/b the active workspace. */
  function park(...tabs: TabState[]): void {
    svc.switchWorkspace('/ws/a', [], null);
    svc.switchWorkspace('/ws/b', tabs, tabs[0]?.id ?? null);
  }

  function close(tab: TabState, workspacePath: string): boolean {
    return closeBackgroundTab({
      tab,
      workspacePath,
      partition: svc,
      abortStreaming: (tabId: string) => abortStreaming(tabId),
      emitClosed: (event: ClosedTabEvent) => events.push(event),
    });
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [TabWorkspacePartitionService],
    });
    svc = TestBed.inject(TabWorkspacePartitionService);
    svc.initialize(undefined);
    abortStreaming = jest.fn(() => false);
    events = [];
  });

  afterEach(() => localStorage.clear());

  it.each<SessionStatus>([
    'streaming',
    'resuming',
    'switching',
    'awaiting-background',
    'sleeping',
  ])('refuses a busy tab (%s) without aborting or removing it', (status) => {
    park(makeTab('a-1', 'sess-a', status));

    expect(close(makeTab('a-1', 'sess-a', status), '/ws/a')).toBe(false);
    expect(abortStreaming).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(svc.findBackgroundTabIds((tab) => tab.id === 'a-1')).toEqual([
      'a-1',
    ]);
  });

  it('refuses a dirty tab without aborting or removing it', () => {
    park(makeTab('a-1', 'sess-a'));

    expect(close(makeTab('a-1', 'sess-a', 'loaded', true), '/ws/a')).toBe(
      false,
    );
    expect(abortStreaming).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(svc.findBackgroundTabIds((tab) => tab.id === 'a-1')).toEqual([
      'a-1',
    ]);
  });

  it('aborts the stream while the tab is still mounted, then removes it and emits the close event', () => {
    park(makeTab('a-1', 'sess-a'), makeTab('a-2', 'sess-b'));
    let stillMountedAtAbort = false;
    abortStreaming.mockImplementation(() => {
      stillMountedAtAbort =
        svc.findBackgroundTabIds((tab) => tab.id === 'a-1').length === 1;
      return true;
    });

    expect(close(makeTab('a-1', 'sess-a'), '/ws/a')).toBe(true);
    expect(abortStreaming).toHaveBeenCalledWith('a-1');
    // The abort must run BEFORE the removal so the abort listener can still
    // resolve the session and dispatch `chat:abort`.
    expect(stillMountedAtAbort).toBe(true);
    expect(events).toEqual([
      {
        tabId: 'a-1',
        sessionId: 'sess-a',
        kind: 'close',
        streamAbortDispatched: true,
      },
    ]);
    expect(svc.findBackgroundTabIds((tab) => tab.id === 'a-1')).toEqual([]);
    expect(svc.findBackgroundTabIds(() => true)).toEqual(['a-2']);
    expect(svc.findTabBySessionIdAcrossWorkspaces('sess-a', [])).toBeNull();
  });

  it('emits a close event with a null session id for a session-less tab', () => {
    park(makeTab('a-1', null));

    expect(close(makeTab('a-1', null), '/ws/a')).toBe(true);
    expect(events).toEqual([
      {
        tabId: 'a-1',
        sessionId: null,
        kind: 'close',
        streamAbortDispatched: false,
      },
    ]);
  });

  it('reports a refused removal (active workspace, unknown workspace) as not closed', () => {
    park(makeTab('a-1', 'sess-a'));

    // The active workspace's tab set belongs to TabManagerService's signal.
    expect(close(makeTab('a-1', 'sess-a'), '/ws/b')).toBe(false);
    expect(close(makeTab('a-1', 'sess-a'), '/ws/none')).toBe(false);
    expect(events).toEqual([]);
    expect(svc.findBackgroundTabIds(() => true)).toEqual(['a-1']);
  });
});