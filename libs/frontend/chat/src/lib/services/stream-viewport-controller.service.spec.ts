import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, SurfaceRouterService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { StreamViewportController } from './stream-viewport-controller.service';

describe('StreamViewportController', () => {
  let activeTabId: ReturnType<typeof signal<string | null>>;
  let visibleTabIds: ReturnType<typeof signal<ReadonlySet<string>>>;
  let currentSurface: ReturnType<typeof signal<string>>;
  let call: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    activeTabId = signal('tab-1');
    visibleTabIds = signal(new Set(['tab-2']));
    currentSurface = signal('chat');
    call = jest.fn().mockResolvedValue({
      success: true,
      data: { acceptedProtocolVersion: 2 },
    });
    TestBed.configureTestingModule({
      providers: [
        StreamViewportController,
        {
          provide: TabManagerService,
          useValue: { activeTabId, visibleTabIds },
        },
        { provide: SurfaceRouterService, useValue: { currentSurface } },
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('declares a distinct, debounced viewport and exposes its tiers after v2 acceptance', async () => {
    const controller = TestBed.inject(StreamViewportController);
    TestBed.flushEffects();
    jest.advanceTimersByTime(50);
    await Promise.resolve();

    expect(call).toHaveBeenCalledWith('chat:setStreamViewport', {
      protocolVersion: 2,
      focusedTabId: 'tab-1',
      visibleTabIds: ['tab-1', 'tab-2'],
    });
    expect(controller.tierFor('tab-1')).toBe('focused');
    expect(controller.tierFor('tab-2')).toBe('visible');
    expect(controller.tierFor('tab-3')).toBe('hidden');

    activeTabId.set('tab-2');
    TestBed.flushEffects();
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith('chat:setStreamViewport', {
      protocolVersion: 2,
      focusedTabId: 'tab-2',
      visibleTabIds: ['tab-2'],
    });
  });

  it('falls back to focused scheduling when v2 is not accepted', async () => {
    call.mockResolvedValueOnce({
      success: true,
      data: { acceptedProtocolVersion: 1 },
    });
    const controller = TestBed.inject(StreamViewportController);
    TestBed.flushEffects();
    jest.advanceTimersByTime(50);
    await Promise.resolve();

    expect(controller.tierFor('hidden-tab')).toBe('focused');
  });

  it('keeps focused scheduling when the declaration resolves without a reply', async () => {
    call.mockResolvedValueOnce(undefined);
    const controller = TestBed.inject(StreamViewportController);
    TestBed.flushEffects();
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    expect(controller.tierFor('tab-2')).toBe('focused');
  });

  it('records an immediate resync declaration before the pending viewport debounce', async () => {
    const controller = TestBed.inject(StreamViewportController);
    TestBed.flushEffects();
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    call.mockClear();
    activeTabId.set('tab-2');
    TestBed.flushEffects();
    await controller.requestStreamResync('tab-3');
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('chat:setStreamViewport', {
      protocolVersion: 2, focusedTabId: 'tab-2', visibleTabIds: ['tab-2'], resyncTabIds: ['tab-3'],
    });
  });

  it('requests one immediate resync with the current viewport only after v2 acceptance', async () => {
    const controller = TestBed.inject(StreamViewportController);
    await controller.requestStreamResync('tab-3');
    expect(call).not.toHaveBeenCalled();
    TestBed.flushEffects();
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    call.mockClear();
    await controller.requestStreamResync('tab-3');
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('chat:setStreamViewport', {
      protocolVersion: 2, focusedTabId: 'tab-1', visibleTabIds: ['tab-1', 'tab-2'], resyncTabIds: ['tab-3'],
    });
    TestBed.flushEffects();
    jest.advanceTimersByTime(50);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('warns and resolves when an immediate resync RPC rejects', async () => {
    const controller = TestBed.inject(StreamViewportController);
    TestBed.flushEffects();
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    call.mockRejectedValueOnce(new Error('offline'));
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    await expect(controller.requestStreamResync('tab-3')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[StreamViewportController] stream resync request failed');
    warn.mockRestore();
  });
});
