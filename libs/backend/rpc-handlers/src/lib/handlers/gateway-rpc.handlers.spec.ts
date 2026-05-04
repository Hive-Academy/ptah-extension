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

  const handlers = new GatewayRpcHandlers(
    logger,
    rpc as unknown as RpcHandler,
    gateway,
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
