/**
 * GatewayStateService — MessageHandler migration tests.
 *
 * Locks four invariants introduced by the push-event migration:
 *
 *   1. `handledMessageTypes` declares `'gateway:statusChanged'` so MessageRouterService
 *      can dispatch GATEWAY_STATUS_CHANGED events without polling.
 *
 *   2. `handleMessage` calls `applyStatus` and mutates signal state when a
 *      GATEWAY_STATUS_CHANGED message arrives with no origin match.
 *
 *   3. Self-echo suppression: when `payload.origin` is in `_pendingOrigins`,
 *      the event is dropped (optimistic UI update already applied) and the token consumed.
 *
 *   4. The constructor does NOT call `setInterval` — the old polling fallback was
 *      intentionally removed; any regression would re-introduce the
 *      workspace-loop bug.
 *
 * Mocking posture:
 *   - `GatewayRpcService` is fully mocked via `useValue` in `TestBed.configureTestingModule`.
 *     Its `status()` and `listBindings()` are mocked to return pending Promises so
 *     `initialize()` (called explicitly only if needed) never hits the wire.
 *   - The service constructor does NOT call `initialize()` — it is a separate public
 *     method — so no async setup is needed for these tests.
 *   - `DestroyRef` is provided implicitly by TestBed's component/service context.
 *
 * Source under test:
 *   `libs/frontend/messaging-gateway-ui/src/lib/services/gateway-state.service.ts`
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { GatewayRpcService } from './gateway-rpc.service';
import { GatewayStateService } from './gateway-state.service';

// ---------------------------------------------------------------------------
// Mock GatewayRpcService — only the surface the service constructor touches.
// status() and listBindings() are called by initialize(), NOT the constructor,
// so they only need to be defined (never called during these tests).
// ---------------------------------------------------------------------------

function buildMockRpc(): jest.Mocked<
  Pick<
    GatewayRpcService,
    | 'status'
    | 'listBindings'
    | 'start'
    | 'stop'
    | 'setToken'
    | 'approveBinding'
    | 'blockBinding'
    | 'listMessages'
    | 'test'
  >
> {
  return {
    status: jest.fn().mockReturnValue(new Promise(() => undefined)),
    listBindings: jest.fn().mockReturnValue(new Promise(() => undefined)),
    start: jest.fn().mockResolvedValue({ ok: true }),
    stop: jest.fn().mockResolvedValue({ ok: true }),
    setToken: jest.fn().mockResolvedValue({ ok: true }),
    approveBinding: jest.fn().mockResolvedValue({ ok: true }),
    blockBinding: jest.fn().mockResolvedValue({ ok: true }),
    listMessages: jest.fn().mockResolvedValue({ messages: [] }),
    test: jest.fn().mockResolvedValue({ ok: true }),
  } as unknown as jest.Mocked<
    Pick<
      GatewayRpcService,
      | 'status'
      | 'listBindings'
      | 'start'
      | 'stop'
      | 'setToken'
      | 'approveBinding'
      | 'blockBinding'
      | 'listMessages'
      | 'test'
    >
  >;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GatewayStateService — MessageHandler migration', () => {
  let service: GatewayStateService;
  let mockRpc: ReturnType<typeof buildMockRpc>;

  beforeEach(() => {
    mockRpc = buildMockRpc();

    TestBed.configureTestingModule({
      providers: [
        GatewayStateService,
        { provide: GatewayRpcService, useValue: mockRpc },
      ],
    });

    service = TestBed.inject(GatewayStateService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is registered as a MessageHandler via handledMessageTypes', () => {
    expect(service.handledMessageTypes).toContain(
      MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
    );
    // Also verify the resolved string value to guard against key renames
    expect(service.handledMessageTypes).toContain('gateway:statusChanged');
  });

  it('calls applyStatus when GATEWAY_STATUS_CHANGED message arrives', () => {
    // Access the private applyStatus via cast — this is deliberate test introspection.
    const applyStatusSpy = jest.spyOn(service as never, 'applyStatus');

    service.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      payload: {
        status: { enabled: true, adapters: [] },
        origin: null,
      },
    });

    expect(applyStatusSpy).toHaveBeenCalled();
    // Signal state must reflect the pushed status
    expect(service.enabled()).toBe(true);
  });

  it('drops self-echo when origin matches pending origin', () => {
    const applyStatusSpy = jest.spyOn(service as never, 'applyStatus');

    // Stamp a pending origin exactly as startPlatform/stopPlatform do
    (service as never as { _pendingOrigins: Set<string> })._pendingOrigins.add(
      'my-token',
    );

    service.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      payload: {
        status: { enabled: true, adapters: [] },
        origin: 'my-token',
      },
    });

    // Self-echo MUST be dropped
    expect(applyStatusSpy).not.toHaveBeenCalled();
    // Token MUST be consumed so subsequent events are not incorrectly dropped
    expect(
      (
        service as never as { _pendingOrigins: Set<string> }
      )._pendingOrigins.has('my-token'),
    ).toBe(false);
  });

  it('does NOT call setInterval during initialization', () => {
    // Clean up the service created in beforeEach, so this test gets a fresh instance
    TestBed.resetTestingModule();

    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');

    TestBed.configureTestingModule({
      providers: [
        GatewayStateService,
        { provide: GatewayRpcService, useValue: buildMockRpc() },
      ],
    });

    // Constructing the service (via inject) must not call setInterval
    TestBed.inject(GatewayStateService);

    expect(setIntervalSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
  });

  // Rapid-sequential-action race — Set<string> semantics.
  //
  // The Set<string> implementation handles rapid sequential platform actions
  // (e.g. enable Telegram immediately followed by enable Discord before the
  // first echo arrives). This test verifies that both tokens are independently
  // honoured — i.e. both echoes are dropped and both tokens are consumed.
  it('drops both echoes when two platform actions fire before either echo arrives', () => {
    const applyStatusSpy = jest.spyOn(service as never, 'applyStatus');

    // Stamp two distinct origin tokens — exactly as startPlatform does for each
    // platform action when they fire in rapid succession.
    (service as never as { _pendingOrigins: Set<string> })._pendingOrigins.add(
      'origin-A',
    );
    (service as never as { _pendingOrigins: Set<string> })._pendingOrigins.add(
      'origin-B',
    );

    // First echo arrives matching origin-A
    service.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      payload: {
        status: { enabled: true, adapters: [] },
        origin: 'origin-A',
      },
    });

    // Second echo arrives matching origin-B
    service.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      payload: {
        status: { enabled: false, adapters: [] },
        origin: 'origin-B',
      },
    });

    // Both echoes must be dropped — applyStatus must never be called
    expect(applyStatusSpy).not.toHaveBeenCalled();
    // Both tokens must be consumed so subsequent events are not blocked
    expect(
      (service as never as { _pendingOrigins: Set<string> })._pendingOrigins
        .size,
    ).toBe(0);
  });

  // setToken stamps an origin, calls rpc.start, then calls
  // _pendingOrigins.delete(origin) on the success path. This test verifies:
  //   1. _pendingOrigins is empty after setToken completes
  //   2. Subsequent GATEWAY_STATUS_CHANGED messages are applied (not suppressed)
  it('clears the _pendingOrigins token after setToken completes successfully so subsequent echoes are applied', async () => {
    // rpc.setToken and rpc.start are already mocked to resolve in buildMockRpc().
    // rpc.status is also already mocked to return a pending promise, but
    // refreshStatus() catches the rejection path gracefully; we override it
    // to return a resolved value so refreshStatus completes without error.
    mockRpc.status.mockResolvedValue({
      enabled: true,
      adapters: [],
    });

    await service.setToken('telegram', 'test-token');

    // After setToken completes, the stamped origin must have been deleted.
    expect(
      (service as never as { _pendingOrigins: Set<string> })._pendingOrigins
        .size,
    ).toBe(0);

    // A subsequent GATEWAY_STATUS_CHANGED with any origin must now be applied
    // (no token in the Set to suppress it).
    const applyStatusSpy = jest.spyOn(service as never, 'applyStatus');
    service.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      payload: {
        status: { enabled: false, adapters: [] },
        origin: 'some-random-origin-not-in-set',
      },
    });

    expect(applyStatusSpy).toHaveBeenCalledTimes(1);
  });

  // Three simultaneous tokens — directly exercises the Set data structure's
  // advantage over a single-origin-ref when all three platform toggle actions
  // fire before any echo arrives.
  it('drops three platform echoes independently when all three are pending simultaneously', () => {
    const applyStatusSpy = jest.spyOn(service as never, 'applyStatus');

    // Stamp three tokens — one per platform, all in-flight simultaneously.
    (service as never as { _pendingOrigins: Set<string> })._pendingOrigins.add(
      'o-tg',
    );
    (service as never as { _pendingOrigins: Set<string> })._pendingOrigins.add(
      'o-dc',
    );
    (service as never as { _pendingOrigins: Set<string> })._pendingOrigins.add(
      'o-sl',
    );

    service.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      payload: { status: { enabled: true, adapters: [] }, origin: 'o-tg' },
    });
    service.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      payload: { status: { enabled: true, adapters: [] }, origin: 'o-dc' },
    });
    service.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      payload: { status: { enabled: true, adapters: [] }, origin: 'o-sl' },
    });

    expect(applyStatusSpy).not.toHaveBeenCalled();
    expect(
      (service as never as { _pendingOrigins: Set<string> })._pendingOrigins
        .size,
    ).toBe(0);
  });

  // voiceDownload signal stays null regardless of GATEWAY_STATUS_CHANGED
  // events arriving, locking the deliberate inertness until a real push
  // event is wired.
  it('voiceDownload signal remains null after GATEWAY_STATUS_CHANGED messages arrive', () => {
    service.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
      payload: {
        status: { enabled: true, adapters: [] },
        origin: null,
      },
    });

    expect(service.voiceDownload()).toBeNull();
  });

  // gateway-state.service.ts has `if (!payload) return;`. This test confirms
  // the guard fires, preventing a crash, and applyStatus is never called.
  it('is a no-op when handleMessage receives a gateway:statusChanged message with no payload', () => {
    const applyStatusSpy = jest.spyOn(service as never, 'applyStatus');

    // Send a message with no payload — must not throw and must not call applyStatus
    service.handleMessage({ type: MESSAGE_TYPES.GATEWAY_STATUS_CHANGED });

    expect(applyStatusSpy).not.toHaveBeenCalled();
  });
});
