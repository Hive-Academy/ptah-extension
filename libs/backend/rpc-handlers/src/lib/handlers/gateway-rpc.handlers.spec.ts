/**
 * GatewayRpcHandlers — thin facade specs (TASK_2026_HERMES_FINISH Batch C1).
 *
 * Locks two invariants critical to the "Send test" button flow shipped in
 * commit eb6d236c:
 *
 *   1. `register()` wires every entry in the static `METHODS` list onto the
 *      injected `RpcHandler`, including the new `gateway:test` method. This
 *      is the contract the dispatcher uses to know what is callable.
 *   2. `gateway:test` delegates to `GatewayService.sendTest` and forwards
 *      both the success-shape and the error-shape result through the wire
 *      unchanged. The handler is intentionally thin — no mapping, no
 *      retries — so the UI can reason about precise error strings.
 *
 * Service-level branches (no-approved-binding, adapter errors, etc.) are
 * covered in `gateway.service.spec.ts`. This spec only exercises the RPC
 * registration + dispatch wiring.
 */

import 'reflect-metadata';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';

import { GatewayRpcHandlers } from './gateway-rpc.handlers';
import type { GatewayService } from '@ptah-extension/messaging-gateway';

interface Suite {
  handlers: GatewayRpcHandlers;
  rpc: MockRpcHandler;
  gateway: jest.Mocked<GatewayService>;
}

function buildSuite(): Suite {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const rpc = createMockRpcHandler();
  const gateway = {
    status: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    startPlatform: jest.fn(),
    stopPlatform: jest.fn(),
    setToken: jest.fn(),
    listBindings: jest.fn().mockReturnValue([]),
    listMessages: jest.fn().mockReturnValue([]),
    approveBinding: jest.fn(),
    setBindingStatus: jest.fn(),
    sendTest: jest.fn(),
  } as unknown as jest.Mocked<GatewayService>;

  const webviewManager = {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };

  const handlers = new GatewayRpcHandlers(
    logger,
    rpc as unknown as RpcHandler,
    gateway,
    webviewManager,
  );
  handlers.register();
  return { handlers, rpc, gateway };
}

describe('GatewayRpcHandlers', () => {
  describe('register()', () => {
    it('wires every method in METHODS onto the RpcHandler, including gateway:test', () => {
      const { rpc } = buildSuite();
      const registered = (rpc.registerMethod as jest.Mock).mock.calls.map(
        (c) => c[0] as string,
      );
      // Spot-check the expected set without enforcing call order.
      for (const method of GatewayRpcHandlers.METHODS) {
        expect(registered).toContain(method);
      }
      expect(registered).toContain('gateway:test');
      // Each METHODS entry must register exactly once (no double-binding).
      expect(registered.length).toBe(GatewayRpcHandlers.METHODS.length);
    });
  });

  // ---------------------------------------------------------------------------
  // GATEWAY_STATUS_CHANGED emission (TASK_2026_115 Batch 9 — T9.1)
  // ---------------------------------------------------------------------------

  describe('GatewayRpcHandlers — GATEWAY_STATUS_CHANGED emission', () => {
    interface EmissionSuite {
      handlers: GatewayRpcHandlers;
      rpc: MockRpcHandler;
      gateway: jest.Mocked<GatewayService>;
      webviewManager: { broadcastMessage: jest.Mock };
    }

    function buildEmissionSuite(
      gatewayStatusOverride?: ReturnType<jest.Mocked<GatewayService>['status']>,
    ): EmissionSuite {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as Logger;
      const rpc = createMockRpcHandler();
      const gateway = {
        status: jest
          .fn()
          .mockReturnValue(
            gatewayStatusOverride ?? { enabled: true, adapters: [] },
          ),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        startPlatform: jest.fn().mockResolvedValue(undefined),
        stopPlatform: jest.fn().mockResolvedValue(undefined),
        setToken: jest.fn().mockResolvedValue(undefined),
        listBindings: jest.fn().mockReturnValue([]),
        listMessages: jest.fn().mockReturnValue([]),
        approveBinding: jest.fn(),
        setBindingStatus: jest.fn(),
        sendTest: jest.fn(),
      } as unknown as jest.Mocked<GatewayService>;

      const webviewManager = {
        broadcastMessage: jest.fn().mockResolvedValue(undefined),
      };

      const handlers = new GatewayRpcHandlers(
        logger,
        rpc as unknown as RpcHandler,
        gateway,
        webviewManager,
      );
      handlers.register();
      return { handlers, rpc, gateway, webviewManager };
    }

    it('broadcasts GATEWAY_STATUS_CHANGED after gateway:start resolves', async () => {
      const { rpc, webviewManager } = buildEmissionSuite();

      await rpc.handleMessage({
        method: 'gateway:start',
        params: { platform: 'telegram' },
        correlationId: 'corr-start-1',
      });

      // broadcastMessage is called via void — flush microtasks
      await Promise.resolve();

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'gateway:statusChanged',
        expect.objectContaining({ origin: null }),
      );
    });

    it('broadcasts GATEWAY_STATUS_CHANGED after gateway:stop resolves', async () => {
      const { rpc, webviewManager } = buildEmissionSuite();

      await rpc.handleMessage({
        method: 'gateway:stop',
        params: { platform: 'telegram' },
        correlationId: 'corr-stop-1',
      });

      await Promise.resolve();

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'gateway:statusChanged',
        expect.objectContaining({ origin: null }),
      );
    });

    it('threads origin through from RPC params to broadcast payload', async () => {
      const { rpc, webviewManager } = buildEmissionSuite();

      await rpc.handleMessage({
        method: 'gateway:start',
        params: { platform: 'telegram', origin: 'test-origin-uuid' },
        correlationId: 'corr-start-2',
      });

      await Promise.resolve();

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'gateway:statusChanged',
        expect.objectContaining({ origin: 'test-origin-uuid' }),
      );
    });

    // ── RED-2: broadcastStatus error path — warn logged, RPC still succeeds ──
    //
    // When webviewManager.broadcastMessage rejects, the handler catches via
    // `.catch(logger.warn)` and still returns { ok: true }. Without this test,
    // a broken broadcast silently swallows with no log validation, and an
    // accidental `await broadcastStatus(...)` (without the .catch) would cause
    // the RPC handler to reject instead of resolve.
    it('logs a warning when broadcastMessage rejects but still returns success from gateway:start', async () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as import('@ptah-extension/vscode-core').Logger;
      const rpc = createMockRpcHandler();
      const gateway = {
        status: jest.fn().mockReturnValue({ enabled: true, adapters: [] }),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        startPlatform: jest.fn().mockResolvedValue(undefined),
        stopPlatform: jest.fn().mockResolvedValue(undefined),
        setToken: jest.fn().mockResolvedValue(undefined),
        listBindings: jest.fn().mockReturnValue([]),
        listMessages: jest.fn().mockReturnValue([]),
        approveBinding: jest.fn(),
        setBindingStatus: jest.fn(),
        sendTest: jest.fn(),
      } as unknown as jest.Mocked<GatewayService>;

      // broadcastMessage rejects — simulates IPC transport failure
      const webviewManager = {
        broadcastMessage: jest.fn().mockRejectedValue(new Error('ipc-fail')),
      };

      const handlers = new GatewayRpcHandlers(
        logger,
        rpc as unknown as import('@ptah-extension/vscode-core').RpcHandler,
        gateway,
        webviewManager,
      );
      handlers.register();

      const response = await rpc.handleMessage({
        method: 'gateway:start',
        params: { platform: 'telegram' },
        correlationId: 'r2-corr-1',
      });

      // Flush the microtask queue so the .catch(logger.warn) continuation runs
      await Promise.resolve();

      // The RPC handler must still return success — broadcastStatus failure must
      // not propagate to the caller.
      expect(response.success).toBe(true);

      // logger.warn must have been called with context referencing the broadcast
      // or gateway operation, confirming the error was captured and not silently swallowed.
      expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
        expect.stringMatching(/broadcastStatus|gateway/i),
        expect.anything(),
      );

      // broadcastMessage was attempted (it failed, but the attempt was made)
      expect(webviewManager.broadcastMessage).toHaveBeenCalled();
    });
  });

  describe('gateway:test', () => {
    it('dispatches to GatewayService.sendTest and returns the success shape', async () => {
      const { rpc, gateway } = buildSuite();
      gateway.sendTest.mockResolvedValue({
        ok: true,
        bindingId: 'binding-1',
        externalMsgId: 'msg-99',
      });

      const response = await rpc.handleMessage({
        method: 'gateway:test',
        params: { platform: 'telegram' },
        correlationId: 'cor-1',
      });

      expect(gateway.sendTest).toHaveBeenCalledWith({ platform: 'telegram' });
      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        ok: true,
        bindingId: 'binding-1',
        externalMsgId: 'msg-99',
      });
    });

    it('passes through service error results without throwing', async () => {
      const { rpc, gateway } = buildSuite();
      gateway.sendTest.mockResolvedValue({
        ok: false,
        error: 'no-approved-binding',
      });

      const response = await rpc.handleMessage({
        method: 'gateway:test',
        params: { platform: 'telegram' },
        correlationId: 'cor-2',
      });

      // RpcHandler treats it as a successful dispatch (no exception); the
      // payload itself encodes the failure. UI surfaces the precise reason.
      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        ok: false,
        error: 'no-approved-binding',
      });
    });

    it('rejects unknown platforms before reaching the gateway service', async () => {
      const { rpc, gateway } = buildSuite();

      const response = await rpc.handleMessage({
        method: 'gateway:test',
        params: { platform: 'whatsapp' },
        correlationId: 'cor-3',
      });

      expect(gateway.sendTest).not.toHaveBeenCalled();
      // Returned via the structured `{ ok: false, error }` shape, not thrown.
      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({ ok: false });
      expect((response.data as { error: string }).error).toMatch(
        /unknown platform/,
      );
    });
  });
});
