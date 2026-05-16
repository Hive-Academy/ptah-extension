import { TestBed } from '@angular/core/testing';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';
import { HarnessBuilderStateService } from './harness-builder-state.service';

describe('HarnessBuilderStateService', () => {
  let service: HarnessBuilderStateService;
  let mockStreamRouter: jest.Mocked<
    Pick<
      StreamRouter,
      'onSurfaceCreated' | 'onSurfaceClosed' | 'routeStreamEventForSurface'
    >
  >;
  let mockSurfaceRegistry: jest.Mocked<
    Pick<StreamingSurfaceRegistry, 'register' | 'unregister' | 'getAdapter'>
  >;

  beforeEach(() => {
    // HarnessBuilderStateService injects StreamRouter and
    // StreamingSurfaceRegistry to route per-operation stream events through
    // the canonical pipeline. Stub both with `jest.Mocked<Pick<...>>` to
    // avoid pulling in TabManagerService and the MODEL_REFRESH_CONTROL
    // NullInjectorError cascade.
    mockStreamRouter = {
      onSurfaceCreated: jest.fn(),
      onSurfaceClosed: jest.fn(),
      routeStreamEventForSurface: jest.fn().mockReturnValue(null),
    };
    mockSurfaceRegistry = {
      register: jest.fn(),
      unregister: jest.fn(),
      getAdapter: jest.fn().mockReturnValue(null),
    };

    TestBed.configureTestingModule({
      providers: [
        HarnessBuilderStateService,
        { provide: StreamRouter, useValue: mockStreamRouter },
        { provide: StreamingSurfaceRegistry, useValue: mockSurfaceRegistry },
      ],
    });

    service = TestBed.inject(HarnessBuilderStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Initial State', () => {
    it('initialises with empty streaming state', () => {
      expect(service.streamingState().events.size).toBe(0);
    });

    it('initialises with isConversing=false and currentOperationId=null', () => {
      expect(service.isConversing()).toBe(false);
      expect(service.currentOperationId()).toBeNull();
    });
  });

  // ===========================================================================
  // Surface routing.
  //
  // Verifies the per-operation SurfaceId lifecycle: lazy registration,
  // idempotent re-mint, sibling lookup, teardown semantics. Adapted to
  // harness's single-operation assumption (spec §6 R3).
  // ===========================================================================
  describe('Operation Surface Routing (TASK_2026_107 Phase 4)', () => {
    it('registerOperationSurface mints a SurfaceId, binds via StreamRouter, and registers the adapter', () => {
      const surfaceId = service.registerOperationSurface('op-1');

      expect(typeof surfaceId).toBe('string');
      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledWith(surfaceId);
      expect(mockSurfaceRegistry.register).toHaveBeenCalledTimes(1);

      // The registry receives the surfaceId + getState/setState callbacks.
      const [registeredId, getState, setState] =
        mockSurfaceRegistry.register.mock.calls[0];
      expect(registeredId).toBe(surfaceId);
      expect(typeof getState).toBe('function');
      expect(typeof setState).toBe('function');
    });

    it('registerOperationSurface is idempotent — repeat call returns same SurfaceId', () => {
      const first = service.registerOperationSurface('op-1');
      const second = service.registerOperationSurface('op-1');

      expect(second).toBe(first);
      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockSurfaceRegistry.register).toHaveBeenCalledTimes(1);
    });

    it('surfaceForOperation returns the SurfaceId after register and null otherwise', () => {
      expect(service.surfaceForOperation('op-1')).toBeNull();
      const surfaceId = service.registerOperationSurface('op-1');
      expect(service.surfaceForOperation('op-1')).toBe(surfaceId);
      expect(service.surfaceForOperation('op-other')).toBeNull();
    });

    it('adapter.getState returns the live _streamingState signal value; setState writes back', () => {
      service.registerOperationSurface('op-1');
      const [, getState, setState] = mockSurfaceRegistry.register.mock.calls[0];

      // getState returns the empty initial state.
      expect(getState().events.size).toBe(0);

      // setState mutates the underlying signal — verify by re-reading the
      // public signal accessor.
      const replacement = {
        events: new Map([['e1', { eventType: 'message_start' }]]),
        messageEventIds: ['m1'],
        toolCallMap: new Map(),
        textAccumulators: new Map(),
        toolInputAccumulators: new Map(),
        agentSummaryAccumulators: new Map(),
        agentContentBlocksMap: new Map(),
        currentMessageId: 'm1',
        currentTokenUsage: undefined,
        eventsByMessage: new Map(),
        pendingStats: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      setState(replacement);
      expect(service.streamingState()).toBe(replacement);
    });

    it('unregisterOperationSurface calls StreamRouter.onSurfaceClosed and removes the mapping', () => {
      const surfaceId = service.registerOperationSurface('op-1');

      service.unregisterOperationSurface('op-1');

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledWith(surfaceId);
      expect(service.surfaceForOperation('op-1')).toBeNull();
      // The router's onSurfaceClosed handles surfaceRegistry.unregister
      // internally — the harness MUST NOT call surfaceRegistry.unregister
      // itself (would race residual events).
      expect(mockSurfaceRegistry.unregister).not.toHaveBeenCalled();
    });

    it('unregisterOperationSurface is a no-op for unknown operationId', () => {
      service.unregisterOperationSurface('op-never-seen');
      expect(mockStreamRouter.onSurfaceClosed).not.toHaveBeenCalled();
    });

    it('unregisterOperationSurface PRESERVES accumulated _streamingState', () => {
      service.registerOperationSurface('op-1');
      const [, , setState] = mockSurfaceRegistry.register.mock.calls[0];

      // Simulate the accumulator handing back a replacement state.
      const populated = {
        events: new Map([['e1', { eventType: 'message_start' }]]),
        messageEventIds: ['m1'],
        toolCallMap: new Map(),
        textAccumulators: new Map(),
        toolInputAccumulators: new Map(),
        agentSummaryAccumulators: new Map(),
        agentContentBlocksMap: new Map(),
        currentMessageId: 'm1',
        currentTokenUsage: undefined,
        eventsByMessage: new Map(),
        pendingStats: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      setState(populated);

      service.unregisterOperationSurface('op-1');

      // Routing/registry teardown happened, but accumulated state remains
      // visible so the execution tree continues to render.
      expect(service.streamingState()).toBe(populated);
    });

    it('routeOperationEvent lazy-mints a surface on first event for an unknown operationId', () => {
      const fakeEvent = {
        eventType: 'message_start',
        messageId: 'm1',
        sessionId: 'sess-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      service.routeOperationEvent('op-1', fakeEvent);

      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.routeStreamEventForSurface).toHaveBeenCalledWith(
        fakeEvent,
        service.surfaceForOperation('op-1'),
      );
    });

    it('routeOperationEvent reuses the existing surface for repeat events on the same operationId', () => {
      const evt1 = {
        eventType: 'message_start',
        messageId: 'm1',
        sessionId: 'sess-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const evt2 = {
        eventType: 'text_delta',
        messageId: 'm1',
        sessionId: 'sess-1',
        blockIndex: 0,
        delta: 'hi',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      service.routeOperationEvent('op-1', evt1);
      service.routeOperationEvent('op-1', evt2);

      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.routeStreamEventForSurface).toHaveBeenCalledTimes(
        2,
      );
    });

    it('routeOperationEvent emits harness.surface.concurrent-operation warning when a second operationId arrives mid-build', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
        /* noop */
      });

      const evt1 = {
        eventType: 'message_start',
        messageId: 'm1',
        sessionId: 'sess-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const evt2 = {
        eventType: 'message_start',
        messageId: 'm2',
        sessionId: 'sess-2',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      service.routeOperationEvent('op-1', evt1);
      // Second operationId arrives while op-1 is still in flight.
      service.routeOperationEvent('op-2', evt2);

      // Warning must mention the structured topic so callers can grep logs.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('harness.surface.concurrent-operation'),
        expect.objectContaining({
          incomingOperationId: 'op-2',
          inFlightOperationId: 'op-1',
        }),
      );

      // The new operation still gets routed (overwrite-not-block per
      // spec §6 R3).
      expect(
        mockStreamRouter.routeStreamEventForSurface,
      ).toHaveBeenLastCalledWith(evt2, service.surfaceForOperation('op-2'));

      warnSpy.mockRestore();
    });

    it('routeOperationEvent does NOT warn when the same operationId is re-used (in-flight idempotency)', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
        /* noop */
      });

      const evt1 = {
        eventType: 'message_start',
        messageId: 'm1',
        sessionId: 'sess-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const evt2 = {
        eventType: 'text_delta',
        messageId: 'm1',
        sessionId: 'sess-1',
        blockIndex: 0,
        delta: 'hello',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      service.routeOperationEvent('op-1', evt1);
      service.routeOperationEvent('op-1', evt2);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('unregisterAllOperationSurfaces tears down routing for every operation', () => {
      service.registerOperationSurface('op-1');
      service.registerOperationSurface('op-2');

      service.unregisterAllOperationSurfaces();

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(2);
      expect(service.surfaceForOperation('op-1')).toBeNull();
      expect(service.surfaceForOperation('op-2')).toBeNull();
    });

    it('resetOperationSurfaces tears down routing AND wipes accumulated _streamingState', () => {
      service.registerOperationSurface('op-1');
      const [, , setState] = mockSurfaceRegistry.register.mock.calls[0];

      // Populate state.
      const populated = {
        events: new Map([['e1', { eventType: 'message_start' }]]),
        messageEventIds: ['m1'],
        toolCallMap: new Map(),
        textAccumulators: new Map(),
        toolInputAccumulators: new Map(),
        agentSummaryAccumulators: new Map(),
        agentContentBlocksMap: new Map(),
        currentMessageId: 'm1',
        currentTokenUsage: undefined,
        eventsByMessage: new Map(),
        pendingStats: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      setState(populated);

      service.resetOperationSurfaces();

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
      expect(service.surfaceForOperation('op-1')).toBeNull();
      // Wiped to a fresh empty state (NOT the populated one).
      expect(service.streamingState()).not.toBe(populated);
      expect(service.streamingState().events.size).toBe(0);
    });

    it('resetStreamingState invokes resetOperationSurfaces (full nuke)', () => {
      service.registerOperationSurface('op-1');
      service.startStreaming('op-1');

      service.resetStreamingState();

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
      expect(service.surfaceForOperation('op-1')).toBeNull();
      expect(service.streamingState().events.size).toBe(0);
      expect(service.isConversing()).toBe(false);
      expect(service.currentOperationId()).toBeNull();
    });

    it('reset() invokes resetOperationSurfaces (full nuke on builder reset)', () => {
      service.registerOperationSurface('op-1');

      service.reset();

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
      expect(service.surfaceForOperation('op-1')).toBeNull();
      expect(service.streamingState().events.size).toBe(0);
    });
  });

  // ===========================================================================
  // Pre-existing behaviour smoke tests (config, conversation messages,
  // intent analysis, loading state). Kept minimal — extensive coverage
  // belongs in a dedicated suite.
  // ===========================================================================
  describe('Conversation Messages', () => {
    it('addConversationMessage appends to the list', () => {
      const msg = {
        role: 'user' as const,
        content: 'hi',
        timestamp: Date.now(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      service.addConversationMessage(msg);

      expect(service.conversationMessages()).toHaveLength(1);
      expect(service.conversationMessages()[0]).toBe(msg);
    });
  });

  describe('Streaming start/stop', () => {
    it('startStreaming sets isConversing and currentOperationId', () => {
      service.startStreaming('op-42');
      expect(service.isConversing()).toBe(true);
      expect(service.currentOperationId()).toBe('op-42');
    });

    it('stopStreaming clears isConversing and currentOperationId', () => {
      service.startStreaming('op-42');
      service.stopStreaming();
      expect(service.isConversing()).toBe(false);
      expect(service.currentOperationId()).toBeNull();
    });
  });
});
