import { TestBed } from '@angular/core/testing';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessStreamingService } from './harness-streaming.service';

/**
 * TASK_2026_107 Phase 4 — HarnessStreamingService now delegates flat-event
 * accumulation to the canonical StreamRouter via the surface façade exposed
 * on HarnessBuilderStateService. These tests verify the message-bridge
 * routing path: harness:flat-stream → state.routeOperationEvent (lazy-mint
 * + forward), harness:flat-stream-complete → state.unregisterOperationSurface.
 */
describe('HarnessStreamingService', () => {
  let service: HarnessStreamingService;
  let state: HarnessBuilderStateService;
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
        HarnessStreamingService,
        { provide: StreamRouter, useValue: mockStreamRouter },
        { provide: StreamingSurfaceRegistry, useValue: mockSurfaceRegistry },
      ],
    });

    state = TestBed.inject(HarnessBuilderStateService);
    service = TestBed.inject(HarnessStreamingService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /**
   * Helper — dispatch a structured `MessageEvent` on the global window so
   * the service's listener fires synchronously. Mirrors how the VS Code
   * webview message bridge delivers payloads.
   */
  function postMessage(type: string, payload: unknown): void {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type, payload } }),
    );
  }

  describe('harness:flat-stream', () => {
    it('routes the flat event through state.routeOperationEvent (lazy-mint + forward)', () => {
      const event = {
        eventType: 'message_start',
        messageId: 'm1',
        sessionId: 'sess-1',
      };
      const payload = { operationId: 'op-1', event };

      postMessage('harness:flat-stream', payload);

      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.routeStreamEventForSurface).toHaveBeenCalledWith(
        event,
        state.surfaceForOperation('op-1'),
      );
      expect(state.isConversing()).toBe(true);
      expect(state.currentOperationId()).toBe('op-1');
    });

    it('does NOT call startStreaming a second time when already conversing', () => {
      const startSpy = jest.spyOn(state, 'startStreaming');

      postMessage('harness:flat-stream', {
        operationId: 'op-1',
        event: {
          eventType: 'message_start',
          messageId: 'm1',
          sessionId: 'sess-1',
        },
      });

      postMessage('harness:flat-stream', {
        operationId: 'op-1',
        event: {
          eventType: 'text_delta',
          messageId: 'm1',
          sessionId: 'sess-1',
          blockIndex: 0,
          delta: 'hi',
        },
      });

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.routeStreamEventForSurface).toHaveBeenCalledTimes(
        2,
      );
      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
    });

    it('reuses the same surface across many events for the same operationId', () => {
      const events = [
        {
          eventType: 'message_start',
          messageId: 'm1',
          sessionId: 'sess-1',
        },
        {
          eventType: 'tool_start',
          messageId: 'm1',
          sessionId: 'sess-1',
          toolCallId: 't1',
          id: 'evt-2',
        },
        {
          eventType: 'tool_result',
          messageId: 'm1',
          sessionId: 'sess-1',
          toolCallId: 't1',
          id: 'evt-3',
        },
      ];

      for (const event of events) {
        postMessage('harness:flat-stream', { operationId: 'op-1', event });
      }

      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.routeStreamEventForSurface).toHaveBeenCalledTimes(
        3,
      );
    });
  });

  describe('harness:flat-stream-complete', () => {
    it('triggers state.unregisterOperationSurface and stopStreaming', () => {
      // First, prime an in-flight operation.
      postMessage('harness:flat-stream', {
        operationId: 'op-1',
        event: {
          eventType: 'message_start',
          messageId: 'm1',
          sessionId: 'sess-1',
        },
      });

      const surfaceId = state.surfaceForOperation('op-1');
      expect(surfaceId).not.toBeNull();

      // Now complete it.
      postMessage('harness:flat-stream-complete', {
        operationId: 'op-1',
        success: true,
      });

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledWith(surfaceId);
      expect(state.surfaceForOperation('op-1')).toBeNull();
      expect(state.isConversing()).toBe(false);
      expect(service.completionResult()).toEqual({
        operationId: 'op-1',
        success: true,
      });
    });

    it('exposes hasError + errorMessage when completion payload signals failure', () => {
      postMessage('harness:flat-stream-complete', {
        operationId: 'op-1',
        success: false,
        error: 'kaboom',
      });

      expect(service.hasError()).toBe(true);
      expect(service.errorMessage()).toBe('kaboom');
    });
  });

  describe('Message bridge filtering', () => {
    it('ignores messages without a `type` property', () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { not: 'a real message' } }),
      );

      expect(
        mockStreamRouter.routeStreamEventForSurface,
      ).not.toHaveBeenCalled();
      expect(mockStreamRouter.onSurfaceClosed).not.toHaveBeenCalled();
    });

    it('ignores messages whose type is unrelated to harness streaming', () => {
      postMessage('chat:something-else', { foo: 'bar' });

      expect(
        mockStreamRouter.routeStreamEventForSurface,
      ).not.toHaveBeenCalled();
      expect(mockStreamRouter.onSurfaceClosed).not.toHaveBeenCalled();
    });
  });

  describe('reset()', () => {
    it('clears completion result and resets streaming state via the state service', () => {
      postMessage('harness:flat-stream-complete', {
        operationId: 'op-1',
        success: false,
        error: 'boom',
      });

      expect(service.completionResult()).not.toBeNull();

      service.reset();

      expect(service.completionResult()).toBeNull();
      expect(state.streamingState().events.size).toBe(0);
    });
  });
});
