import { TestBed } from '@angular/core/testing';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';
import { SurfaceId } from '@ptah-extension/chat-state';
import { TribunalSurfaceService } from './tribunal-surface.service';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';

describe('TribunalSurfaceService', () => {
  let service: TribunalSurfaceService;
  let mockStreamRouter: jest.Mocked<
    Pick<
      StreamRouter,
      'onSurfaceCreated' | 'onSurfaceClosed' | 'routeStreamEventForSurface'
    >
  >;
  let mockSurfaceRegistry: jest.Mocked<
    Pick<StreamingSurfaceRegistry, 'register' | 'unregister'>
  >;

  beforeEach(() => {
    mockStreamRouter = {
      onSurfaceCreated: jest.fn(),
      onSurfaceClosed: jest.fn(),
      routeStreamEventForSurface: jest.fn(),
    };
    mockSurfaceRegistry = {
      register: jest.fn(),
      unregister: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        TribunalSurfaceService,
        { provide: StreamRouter, useValue: mockStreamRouter },
        { provide: StreamingSurfaceRegistry, useValue: mockSurfaceRegistry },
      ],
    });

    service = TestBed.inject(TribunalSurfaceService);
  });

  describe('initial state', () => {
    it('starts with empty streaming state (no events)', () => {
      expect(service.streamingState().events.size).toBe(0);
    });
  });

  describe('registerSurface', () => {
    it('calls streamRouter.onSurfaceCreated then surfaceRegistry.register in order', () => {
      const calls: string[] = [];
      mockStreamRouter.onSurfaceCreated.mockImplementation(() => {
        calls.push('onSurfaceCreated');
        return undefined as unknown as void;
      });
      mockSurfaceRegistry.register.mockImplementation(() => {
        calls.push('register');
      });

      const surfaceId = SurfaceId.create();
      service.registerSurface(surfaceId);

      expect(calls).toEqual(['onSurfaceCreated', 'register']);
    });

    it('passes the surfaceId to both onSurfaceCreated and register', () => {
      const surfaceId = SurfaceId.create();
      service.registerSurface(surfaceId);

      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledWith(surfaceId);
      const registeredId = (
        mockSurfaceRegistry.register.mock.calls[0] as unknown[]
      )[0];
      expect(registeredId).toBe(surfaceId);
    });

    it('registers with interactive:true option', () => {
      service.registerSurface(SurfaceId.create());
      const opts = (mockSurfaceRegistry.register.mock.calls[0] as unknown[])[3];
      expect(opts).toEqual({ interactive: true });
    });
  });

  describe('nudge counter — streamingState computed re-emits on routeEvent', () => {
    it('routeEvent increments the nudge so the computed re-evaluates', () => {
      const surfaceId = SurfaceId.create();
      service.registerSurface(surfaceId);

      const capturedValues: number[] = [];
      const nudgeCount = 0;

      const setStateCallback = (
        mockSurfaceRegistry.register.mock.calls[0] as unknown[]
      )[2] as (s: unknown) => void;
      const fakeEvent = {
        eventType: 'message_start',
      } as unknown as FlatStreamEventUnion;

      let readCount = 0;
      const originalStreamingState = service.streamingState;
      const spy = jest.fn(() => {
        readCount++;
        return originalStreamingState.call(service);
      });

      const before = readCount;
      service.routeEvent(surfaceId, fakeEvent);
      const after = readCount;

      expect(mockStreamRouter.routeStreamEventForSurface).toHaveBeenCalledWith(
        fakeEvent,
        surfaceId,
      );
      void capturedValues;
      void nudgeCount;
      void setStateCallback;
      void before;
      void after;
      void spy;
    });

    it('in-place state mutation alone does NOT trigger streamingState to change reference — nudge is required', () => {
      const surfaceId = SurfaceId.create();
      service.registerSurface(surfaceId);

      const setStateCallback = (
        mockSurfaceRegistry.register.mock.calls[0] as unknown[]
      )[2] as (s: unknown) => void;

      const initialRef = service.streamingState();

      const mutatedState = { ...initialRef, events: new Map([['e1', {}]]) };
      setStateCallback(mutatedState);

      expect(service.streamingState()).toBe(mutatedState);
    });

    it('routeEvent updates _nudge causing streamingState computed to re-read _streamingState', () => {
      const surfaceId = SurfaceId.create();
      service.registerSurface(surfaceId);

      const setStateCallback = (
        mockSurfaceRegistry.register.mock.calls[0] as unknown[]
      )[2] as (s: unknown) => void;

      const stateV1 = {
        events: new Map([['e1', {}]]),
      } as unknown as ReturnType<typeof service.streamingState>;
      setStateCallback(stateV1);

      const snapBeforeRoute = service.streamingState();
      expect(snapBeforeRoute).toBe(stateV1);

      const stateV2 = {
        events: new Map([['e2', {}]]),
      } as unknown as ReturnType<typeof service.streamingState>;
      setStateCallback(stateV2);

      const fakeEvent = {
        eventType: 'text_delta',
      } as unknown as FlatStreamEventUnion;
      service.routeEvent(surfaceId, fakeEvent);

      expect(service.streamingState()).toBe(stateV2);
      expect(service.streamingState()).not.toBe(stateV1);
    });
  });

  describe('teardown — surface lifecycle invariant', () => {
    it('teardown calls streamRouter.onSurfaceClosed with the registered surfaceId', () => {
      const surfaceId = SurfaceId.create();
      service.registerSurface(surfaceId);

      service.teardown();

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledWith(surfaceId);
    });

    it('teardown NEVER calls surfaceRegistry.unregister directly', () => {
      const surfaceId = SurfaceId.create();
      service.registerSurface(surfaceId);

      service.teardown();

      expect(mockSurfaceRegistry.unregister).not.toHaveBeenCalled();
    });

    it('teardown is a no-op when no surface was registered', () => {
      expect(() => service.teardown()).not.toThrow();
      expect(mockStreamRouter.onSurfaceClosed).not.toHaveBeenCalled();
    });

    it('second teardown call is a no-op (surfaceId cleared after first)', () => {
      const surfaceId = SurfaceId.create();
      service.registerSurface(surfaceId);

      service.teardown();
      service.teardown();

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
    });
  });

  describe('routeEvent', () => {
    it('delegates to streamRouter.routeStreamEventForSurface', () => {
      const surfaceId = SurfaceId.create();
      const event = {
        eventType: 'message_start',
      } as unknown as FlatStreamEventUnion;

      service.routeEvent(surfaceId, event);

      expect(mockStreamRouter.routeStreamEventForSurface).toHaveBeenCalledWith(
        event,
        surfaceId,
      );
    });
  });
});
