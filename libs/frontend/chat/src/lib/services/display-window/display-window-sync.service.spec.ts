import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ThemeService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  DISPLAY_WINDOW_STATE_MAX_BYTES,
  type ArtifactRecord,
} from '@ptah-extension/shared';
import { ArtifactStore } from '../artifact.store';
import { ChangeSetActionsService } from '../change-set/change-set-actions.service';
import { DisplayDockState } from '../display-dock/display-dock.state';
import { DisplayWindowSync } from './display-window-sync.service';

const artifact: ArtifactRecord = {
  id: 'abcdefghijklmnop',
  title: 'Preview',
  revision: 1,
  sessionId: 'tab-1',
  viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
  createdAt: '2026-10-20T12:00:00.000Z',
};

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

type RpcReply = { success: boolean; data?: unknown; error?: string };

describe('DisplayWindowSync', () => {
  let replies: Record<string, RpcReply>;
  let call: jest.Mock;
  // Pending animation frames by id. Angular's zoneless scheduler also uses
  // requestAnimationFrame and cancels its own frame, so cancel removes one id only.
  let frames: Map<number, () => void>;
  let nextFrameId: number;
  let isElectron: boolean;
  const theme = signal('ptah-glass');
  const artifacts = signal<readonly ArtifactRecord[]>([]);
  const review = jest.fn();

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 0;
    isElectron = true;
    theme.set('ptah-glass');
    artifacts.set([]);
    review.mockReset().mockResolvedValue(undefined);
    replies = {
      'displayWindow:status': {
        success: true,
        data: { supported: true, open: false },
      },
      'displayWindow:open': { success: true, data: { ok: true } },
      'displayWindow:close': { success: true, data: { closed: true } },
      'displayWindow:publishState': {
        success: true,
        data: { delivered: true },
      },
    };
    call = jest.fn(
      async (method: string) =>
        replies[method] ?? { success: false, error: 'unknown' },
    );
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        nextFrameId += 1;
        frames.set(nextFrameId, () => callback(0));
        return nextFrameId;
      });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function setup(): {
    sync: DisplayWindowSync;
    dock: DisplayDockState;
    tabId: WritableSignal<string | null>;
  } {
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: VSCodeService, useValue: { isElectron } },
        {
          provide: ThemeService,
          useValue: {
            currentTheme: theme,
            isDarkMode: () => theme() !== 'ptah-glass-light',
          },
        },
        {
          provide: ArtifactStore,
          useValue: { panelArtifacts: () => artifacts() },
        },
        {
          provide: ChangeSetActionsService,
          useValue: { review, openFile: jest.fn() },
        },
      ],
    });
    const sync = TestBed.inject(DisplayWindowSync);
    const dock = new DisplayDockState();
    const tabId = signal<string | null>('tab-1');
    sync.bindSource({ tabId, dock });
    return { sync, dock, tabId };
  }

  function publishCalls(): unknown[][] {
    return call.mock.calls.filter(
      ([method]) => method === 'displayWindow:publishState',
    );
  }

  /** Runs effects, waits past the publish timer, and runs pending rAF frames. */
  async function flushFrame(): Promise<void> {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame();
    await Promise.resolve();
  }

  function lastPublished(): { tabId: string; state: Record<string, unknown> } {
    const last = publishCalls().at(-1) as [
      string,
      { tabId: string; state: Record<string, unknown> },
    ];
    return last[1];
  }

  it('asks the status once on Electron and restores a detached window', async () => {
    replies['displayWindow:status'] = {
      success: true,
      data: { supported: true, open: true },
    };
    const { sync } = setup();
    await settle();
    expect(call).toHaveBeenCalledWith('displayWindow:status', {});
    expect(sync.detached()).toBe(true);
  });

  it('does not ask the status outside Electron', () => {
    isElectron = false;
    setup();
    expect(call).not.toHaveBeenCalledWith('displayWindow:status', {});
  });

  it('detach opens the window and publishes the bound tab once per tick, only on change', async () => {
    artifacts.set([artifact]);
    const { sync, dock } = setup();
    await sync.detach();
    expect(sync.detached()).toBe(true);
    expect(sync.error()).toBeNull();

    await flushFrame();
    expect(publishCalls()).toHaveLength(1);
    const [, params] = publishCalls()[0] as [
      string,
      { tabId: string; revision: number; state: Record<string, unknown> },
    ];
    expect(params.tabId).toBe('tab-1');
    expect(params.revision).toBe(1);
    expect(params.state['artifacts']).toEqual([artifact]);
    expect(params.state['theme']).toEqual({ name: 'ptah-glass', mode: 'dark' });

    // No change: no publish.
    await flushFrame();
    expect(publishCalls()).toHaveLength(1);

    // Two changes in one tick: one publish.
    dock.openArtifact('tab-1', artifact.id);
    theme.set('ptah-glass-light');
    await flushFrame();
    expect(publishCalls()).toHaveLength(2);
    const [, next] = publishCalls()[1] as [
      string,
      { revision: number; state: Record<string, unknown> },
    ];
    expect(next.revision).toBe(2);
    expect(next.state['selectedKey']).toBe(`artifact:${artifact.id}`);
    expect(next.state['theme']).toEqual({
      name: 'ptah-glass-light',
      mode: 'light',
    });
  });

  it('keeps publishing while no animation frame runs (main window minimized)', async () => {
    const { sync, dock } = setup();
    await sync.detach();
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(publishCalls()).toHaveLength(1);
    dock.openArtifact('tab-1', artifact.id);
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 25));
    // No rAF frame was run, yet both publishes went out.
    expect(publishCalls()).toHaveLength(2);
  });

  it('retries a failed publish a bounded number of times', async () => {
    jest.useFakeTimers();
    replies['displayWindow:publishState'] = { success: false, error: 'down' };
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { sync } = setup();
    await sync.detach();
    TestBed.tick();
    await jest.advanceTimersByTimeAsync(16);
    expect(publishCalls()).toHaveLength(1);
    // 500, 1000 and 1500 ms backoff: three retries, then it stops.
    await jest.advanceTimersByTimeAsync(10_000);
    expect(publishCalls()).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(publishCalls()).toHaveLength(4);
  });

  it('a retry after a failed publish succeeds without a dock change', async () => {
    jest.useFakeTimers();
    replies['displayWindow:publishState'] = { success: false, error: 'down' };
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sync } = setup();
    await sync.detach();
    TestBed.tick();
    await jest.advanceTimersByTimeAsync(16);
    replies['displayWindow:publishState'] = {
      success: true,
      data: { delivered: true },
    };
    await jest.advanceTimersByTimeAsync(500);
    expect(publishCalls()).toHaveLength(2);
    expect((publishCalls()[1] as [string, { tabId: string }])[1].tabId).toBe(
      'tab-1',
    );
    await jest.advanceTimersByTimeAsync(10_000);
    expect(publishCalls()).toHaveLength(2);
  });

  it('publishes nothing while attached', async () => {
    const { dock } = setup();
    dock.openArtifact('tab-1', artifact.id);
    await flushFrame();
    expect(publishCalls()).toHaveLength(0);
  });

  it('reports a host without a window and stays attached', async () => {
    replies['displayWindow:open'] = {
      success: true,
      data: { ok: false, reason: 'desktop-only' },
    };
    const { sync } = setup();
    await sync.detach();
    expect(sync.detached()).toBe(false);
    expect(sync.error()).toContain('desktop app only');
  });

  it('refuses a snapshot over the size cap', async () => {
    artifacts.set([
      { ...artifact, title: 'x'.repeat(DISPLAY_WINDOW_STATE_MAX_BYTES) },
    ]);
    const { sync } = setup();
    await sync.detach();
    await flushFrame();
    // The window gets a small notice instead of keeping old content.
    expect(publishCalls()).toHaveLength(1);
    expect(lastPublished().state['notice']).toContain('too large');
    expect(lastPublished().state['artifacts']).toEqual([]);
    expect(sync.error()).toContain('too large');
  });

  it('publishes a notice when the source unbinds while detached', async () => {
    artifacts.set([artifact]);
    const { sync, tabId } = setup();
    await sync.detach();
    await flushFrame();
    expect(lastPublished().state['artifacts']).toEqual([artifact]);
    tabId.set(null);
    await flushFrame();
    expect(publishCalls()).toHaveLength(2);
    expect(lastPublished().tabId).toBe('tab-1');
    expect(lastPublished().state['notice']).toContain('no chat tab');
    expect(lastPublished().state['artifacts']).toEqual([]);
  });

  it('the closed push attaches again', async () => {
    const { sync } = setup();
    await sync.detach();
    sync.handleMessage({ type: 'displayWindow:closed' });
    expect(sync.detached()).toBe(false);
  });

  it('applies an action only to the bound tab', async () => {
    const { sync, dock } = setup();
    sync.handleMessage({
      type: 'displayWindow:action',
      payload: { tabId: 'tab-1', action: { type: 'select', key: 'id:stats' } },
    });
    expect(dock.tab('tab-1').selection).toEqual({
      kind: 'surface',
      surfaceKey: 'id:stats',
    });

    sync.handleMessage({
      type: 'displayWindow:action',
      payload: { tabId: 'tab-2', action: { type: 'select', key: 'summary' } },
    });
    expect(dock.tab('tab-2').selection).toBeNull();
    expect(dock.tab('tab-1').selection).toEqual({
      kind: 'surface',
      surfaceKey: 'id:stats',
    });
  });

  it('republishes the current view after dropping a stale-tab action', async () => {
    const { sync } = setup();
    await sync.detach();
    await flushFrame();
    expect(publishCalls()).toHaveLength(1);
    sync.handleMessage({
      type: 'displayWindow:action',
      payload: { tabId: 'tab-old', action: { type: 'select', key: 'summary' } },
    });
    await flushFrame();
    expect(publishCalls()).toHaveLength(2);
    expect(lastPublished().tabId).toBe('tab-1');
  });

  it('the attach action from a stale tab still closes the window', async () => {
    const { sync } = setup();
    await sync.detach();
    sync.handleMessage({
      type: 'displayWindow:action',
      payload: { tabId: 'tab-old', action: { type: 'attach' } },
    });
    await settle();
    expect(call).toHaveBeenCalledWith('displayWindow:close', {});
    expect(sync.detached()).toBe(false);
  });

  it('ignores an invalid action payload', () => {
    const { sync, dock } = setup();
    const before = dock.tab('tab-1');
    sync.handleMessage({
      type: 'displayWindow:action',
      payload: { tabId: 'tab-1', action: { type: 'eval' } },
    });
    expect(dock.tab('tab-1')).toBe(before);
  });

  it('clears the full-screen request when the window leaves full screen', () => {
    const { sync, dock } = setup();
    dock.requestFullscreenArtifact('tab-1', artifact.id);
    sync.handleMessage({
      type: 'displayWindow:action',
      payload: { tabId: 'tab-1', action: { type: 'fullscreen-closed' } },
    });
    expect(dock.fullscreenArtifact('tab-1')).toBeNull();
  });

  it('the attach action closes the window', async () => {
    const { sync } = setup();
    await sync.detach();
    sync.handleMessage({
      type: 'displayWindow:action',
      payload: { tabId: 'tab-1', action: { type: 'attach' } },
    });
    await settle();
    expect(call).toHaveBeenCalledWith('displayWindow:close', {});
    expect(sync.detached()).toBe(false);
  });

  it('review without a change set reports the error in the next snapshot', async () => {
    const { sync } = setup();
    await sync.detach();
    sync.handleMessage({
      type: 'displayWindow:action',
      payload: { tabId: 'tab-1', action: { type: 'review' } },
    });
    await flushFrame();
    expect(review).not.toHaveBeenCalled();
    expect(lastPublished().state['actionError']).toBe(
      'This turn has no recorded file changes to open.',
    );
  });

  it('unbinding stops the actions and the snapshot', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: VSCodeService, useValue: { isElectron: false } },
        {
          provide: ThemeService,
          useValue: { currentTheme: theme, isDarkMode: () => true },
        },
        { provide: ArtifactStore, useValue: { panelArtifacts: () => [] } },
      ],
    });
    const sync = TestBed.inject(DisplayWindowSync);
    const dock = new DisplayDockState();
    const unbind = sync.bindSource({ tabId: signal('tab-1'), dock });
    unbind();
    sync.handleMessage({
      type: 'displayWindow:action',
      payload: { tabId: 'tab-1', action: { type: 'select', key: 'summary' } },
    });
    expect(dock.tab('tab-1').selection).toBeNull();
    expect(sync.count()).toBe(0);
  });
});
