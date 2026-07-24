import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';
import { AppStateManager } from '@ptah-extension/core';
import type { HarnessInitializeResponse } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';
import { HarnessRpcService } from './harness-rpc.service';

/** Drain the microtask + macrotask queue so an async re-init settles. */
function flushAsync(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** A manually-resolvable promise, for ordering rapid re-init responses. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Minimal HarnessInitializeResponse for pin/reset assertions. */
function initResponse(
  overrides: Partial<HarnessInitializeResponse> = {},
): HarnessInitializeResponse {
  return {
    workspaceContext: {
      projectName: 'workspace-a',
      projectType: 'nx-monorepo',
      frameworks: [],
      languages: ['TypeScript'],
    },
    availableAgents: [],
    availableSkills: [],
    existingPresets: [],
    workspaceRoot: '/workspace/A',
    ...overrides,
  };
}

describe('HarnessBuilderStateService', () => {
  let service: HarnessBuilderStateService;
  let workspaceInfo: WritableSignal<{ path: string } | null>;
  let mockStreamRouter: jest.Mocked<
    Pick<
      StreamRouter,
      'onSurfaceCreated' | 'onSurfaceClosed' | 'routeStreamEventForSurface'
    >
  >;
  let mockSurfaceRegistry: jest.Mocked<
    Pick<StreamingSurfaceRegistry, 'register' | 'unregister' | 'getAdapter'>
  >;
  let rpcMock: { initialize: jest.Mock };

  beforeEach(() => {
    workspaceInfo = signal<{ path: string } | null>({ path: '/workspace/A' });
    // The store re-runs `harness:initialize` on an idle workspace switch, so it
    // injects HarnessRpcService. Stub only `initialize`; default it to resolve
    // for '/workspace/A' — individual switch tests override per-call.
    rpcMock = {
      initialize: jest
        .fn()
        .mockResolvedValue(initResponse({ workspaceRoot: '/workspace/A' })),
    };
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
        {
          provide: HarnessRpcService,
          useValue: rpcMock as unknown as HarnessRpcService,
        },
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: workspaceInfo.asReadonly(),
          } as unknown as AppStateManager,
        },
      ],
    });

    service = TestBed.inject(HarnessBuilderStateService);
    // Let the constructor effect record its baseline workspace root so a later
    // signal change registers as a genuine switch.
    TestBed.flushEffects();
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

  // ===========================================================================
  // Workspace-switch safety (pin + idle-reset + in-progress-keep).
  // ===========================================================================
  describe('Workspace pinning + switch safety', () => {
    it('initialize() pins workspaceRoot from the response for apply to read', () => {
      expect(service.pinnedWorkspaceRoot()).toBeNull();

      service.initialize(initResponse({ workspaceRoot: '/workspace/A' }));

      expect(service.pinnedWorkspaceRoot()).toBe('/workspace/A');
      // This is exactly the value the view forwards as harness:apply's
      // workspaceRoot param, keeping the write bound to the build's origin.
    });

    it('initialize() pins null when no workspace is open', () => {
      service.initialize(initResponse({ workspaceRoot: null }));
      expect(service.pinnedWorkspaceRoot()).toBeNull();
    });

    it('idle switch after init re-initializes for the new workspace and re-establishes the pin', async () => {
      service.initialize(initResponse({ workspaceRoot: '/workspace/A' }));
      service.updatePrompt({ systemPrompt: 'hello', enhancedSections: {} });
      expect(service.buildInProgress()).toBe(false);

      // The re-init triggered by the switch resolves for the new workspace B.
      rpcMock.initialize.mockResolvedValueOnce(
        initResponse({ workspaceRoot: '/workspace/B' }),
      );

      // Switch active workspace while IDLE.
      workspaceInfo.set({ path: '/workspace/B' });
      TestBed.flushEffects();

      // Synchronously: the old workspace's state was wiped before the re-init
      // response lands (no stale badge, config/pin cleared).
      expect(service.config()).toEqual({});
      expect(service.pinnedWorkspaceRoot()).toBeNull();
      expect(service.workspaceSwitchedDuringBuild()).toBe(false);

      // The switch auto-triggers a fresh harness:initialize for B.
      await flushAsync();
      expect(rpcMock.initialize).toHaveBeenCalledTimes(1);
      // Pin re-established for the NEW workspace — apply now targets B.
      expect(service.pinnedWorkspaceRoot()).toBe('/workspace/B');
    });

    it('idle switch when the builder was never initialized fires no re-init RPC', () => {
      // No initialize() call → nothing to follow.
      workspaceInfo.set({ path: '/workspace/B' });
      TestBed.flushEffects();

      expect(rpcMock.initialize).not.toHaveBeenCalled();
      expect(service.pinnedWorkspaceRoot()).toBeNull();
    });

    it('rapid A→B→C switch applies only the latest re-init (stale response discarded)', async () => {
      service.initialize(initResponse({ workspaceRoot: '/workspace/A' }));

      const toB = deferred<HarnessInitializeResponse>();
      const toC = deferred<HarnessInitializeResponse>();
      rpcMock.initialize
        .mockReturnValueOnce(toB.promise)
        .mockReturnValueOnce(toC.promise);

      // Switch to B, then quickly to C — two overlapping re-inits.
      workspaceInfo.set({ path: '/workspace/B' });
      TestBed.flushEffects();
      workspaceInfo.set({ path: '/workspace/C' });
      TestBed.flushEffects();

      expect(rpcMock.initialize).toHaveBeenCalledTimes(2);

      // Resolve the LATEST (C) first — it wins and pins C.
      toC.resolve(initResponse({ workspaceRoot: '/workspace/C' }));
      await flushAsync();
      expect(service.pinnedWorkspaceRoot()).toBe('/workspace/C');

      // The stale B response resolves later and must be ignored.
      toB.resolve(initResponse({ workspaceRoot: '/workspace/B' }));
      await flushAsync();
      expect(service.pinnedWorkspaceRoot()).toBe('/workspace/C');
    });

    it('re-init failure sets the error state so the view can offer a retry', async () => {
      service.initialize(initResponse({ workspaceRoot: '/workspace/A' }));
      rpcMock.initialize.mockRejectedValueOnce(new Error('backend down'));

      workspaceInfo.set({ path: '/workspace/B' });
      TestBed.flushEffects();
      await flushAsync();

      expect(service.error()).toBe('backend down');
      // Pin stays cleared (the failed re-init never re-pinned).
      expect(service.pinnedWorkspaceRoot()).toBeNull();
    });

    it('in-progress workspace switch KEEPS the pin, flags the switch, and fires no re-init', () => {
      service.initialize(initResponse({ workspaceRoot: '/workspace/A' }));
      service.setBuildInProgress(true);
      service.updatePrompt({ systemPrompt: 'building', enhancedSections: {} });

      // Switch active workspace mid-build.
      workspaceInfo.set({ path: '/workspace/B' });
      TestBed.flushEffects();

      // Pin preserved → apply still targets the original workspace.
      expect(service.pinnedWorkspaceRoot()).toBe('/workspace/A');
      // Config preserved (no reset).
      expect(service.config().prompt?.systemPrompt).toBe('building');
      // Non-blocking indicator raised for the view badge.
      expect(service.workspaceSwitchedDuringBuild()).toBe(true);
      // A mid-build switch must NOT re-initialize (the build keeps its pin).
      expect(rpcMock.initialize).not.toHaveBeenCalled();
    });

    it('after a build ends, a later idle switch re-initializes (no badge)', async () => {
      service.initialize(initResponse({ workspaceRoot: '/workspace/A' }));
      service.setBuildInProgress(true);
      service.setBuildInProgress(false);
      rpcMock.initialize.mockResolvedValueOnce(
        initResponse({ workspaceRoot: '/workspace/B' }),
      );

      workspaceInfo.set({ path: '/workspace/B' });
      TestBed.flushEffects();

      expect(service.workspaceSwitchedDuringBuild()).toBe(false);
      expect(service.pinnedWorkspaceRoot()).toBeNull();

      await flushAsync();
      expect(rpcMock.initialize).toHaveBeenCalledTimes(1);
      expect(service.pinnedWorkspaceRoot()).toBe('/workspace/B');
    });

    it('reset() stops the builder following the workspace (no re-init after close)', async () => {
      service.initialize(initResponse({ workspaceRoot: '/workspace/A' }));

      // Hard teardown (page close).
      service.reset();

      // A later switch must NOT re-initialize — the page is gone.
      workspaceInfo.set({ path: '/workspace/B' });
      TestBed.flushEffects();
      await flushAsync();

      expect(rpcMock.initialize).not.toHaveBeenCalled();
    });

    it('reset() clears the pin, build flag, and switch indicator', () => {
      service.initialize(initResponse({ workspaceRoot: '/workspace/A' }));
      service.setBuildInProgress(true);
      workspaceInfo.set({ path: '/workspace/B' });
      TestBed.flushEffects();
      expect(service.workspaceSwitchedDuringBuild()).toBe(true);

      service.reset();

      expect(service.pinnedWorkspaceRoot()).toBeNull();
      expect(service.buildInProgress()).toBe(false);
      expect(service.workspaceSwitchedDuringBuild()).toBe(false);
    });
  });
});

// =============================================================================
// Construction-baseline hole (review Issue 7).
//
// A dedicated suite because it needs control over the effect's FIRST flush —
// the shared beforeEach above flushes eagerly, which the outer tests rely on.
// Here we switch the workspace BEFORE the first flush to prove the baseline is
// captured synchronously at construction (a differing value at first flush is a
// real switch, not a silent baseline recording).
// =============================================================================
describe('HarnessBuilderStateService — construction baseline (Issue 7)', () => {
  it('treats a workspace change before the first effect flush as a real switch', () => {
    const workspaceInfo = signal<{ path: string } | null>({
      path: '/workspace/A',
    });
    const rpcMock = {
      initialize: jest
        .fn()
        .mockResolvedValue(initResponse({ workspaceRoot: '/workspace/A' })),
    };

    TestBed.configureTestingModule({
      providers: [
        HarnessBuilderStateService,
        {
          provide: StreamRouter,
          useValue: {
            onSurfaceCreated: jest.fn(),
            onSurfaceClosed: jest.fn(),
            routeStreamEventForSurface: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: StreamingSurfaceRegistry,
          useValue: {
            register: jest.fn(),
            unregister: jest.fn(),
            getAdapter: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: HarnessRpcService,
          useValue: rpcMock as unknown as HarnessRpcService,
        },
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: workspaceInfo.asReadonly(),
          } as unknown as AppStateManager,
        },
      ],
    });

    // Construct the service — baseline '/workspace/A' captured synchronously.
    // Do NOT flush yet. A build is in-progress, which is the switch path that
    // does not depend on `initialize()` (and so does not realign the baseline),
    // letting us observe the first-flush comparison in isolation.
    const service = TestBed.inject(HarnessBuilderStateService);
    service.setBuildInProgress(true);

    // Workspace switches BEFORE the effect's first flush.
    workspaceInfo.set({ path: '/workspace/B' });
    TestBed.flushEffects();

    // The first flush compares against the construction baseline (A ≠ B) and
    // treats it as a genuine mid-build switch — raising the badge. Under the
    // old "first emission records the baseline" behaviour this would be missed.
    expect(service.workspaceSwitchedDuringBuild()).toBe(true);
  });
});
