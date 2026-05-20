import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  GatewayApprovalStatus,
  GatewayApproveBindingResult,
  GatewayBlockBindingResult,
  GatewayListBindingsResult,
  GatewayListMessagesResult,
  GatewayPlatformId,
  GatewaySetTokenResult,
  GatewayStartResult,
  GatewayStatusResult,
  GatewayStopResult,
  GatewayTestPlatform,
  GatewayTestResult,
} from '@ptah-extension/shared';

/**
 * Per-method timeout budget for `gateway:*` RPC calls.
 *
 * - LIST_MS:     status / listBindings / listMessages — bounded reads.
 * - SHORT_MS:    start / stop / approveBinding / blockBinding — single writes.
 * - SET_TOKEN_MS: setToken — Electron `safeStorage` round-trip + adapter init.
 * - TEST_MS:     test — fires a real outbound message via the platform adapter.
 */
const GATEWAY_RPC_TIMEOUTS = {
  LIST_MS: 10_000,
  SHORT_MS: 8_000,
  SET_TOKEN_MS: 15_000,
  TEST_MS: 20_000,
} as const;

/**
 * GatewayRpcService
 *
 * Thin facade for the 9 `gateway:*` RPC methods. Mirrors the pattern used by
 * {@link MemoryRpcService} — each method delegates to {@link ClaudeRpcService}
 * and returns the typed `result.data` on success or throws with the RPC error
 * string on failure.
 *
 * SECURITY: The plaintext token is the only sensitive parameter. It travels
 * directly from the component's local `setToken(...)` call into `rpc.call(...)`
 * — this service does not retain it, log it, or store it.
 *
 * Supported RPC methods (9):
 * - gateway:status
 * - gateway:start
 * - gateway:stop
 * - gateway:setToken
 * - gateway:listBindings
 * - gateway:approveBinding
 * - gateway:blockBinding
 * - gateway:listMessages
 * - gateway:test
 */
@Injectable({ providedIn: 'root' })
export class GatewayRpcService {
  private readonly rpc = inject(ClaudeRpcService);

  public async status(): Promise<GatewayStatusResult> {
    const result = await this.rpc.call(
      'gateway:status',
      {},
      { timeout: GATEWAY_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'gateway:status failed');
  }

  public async start(
    platform?: GatewayPlatformId,
    origin?: string,
  ): Promise<GatewayStartResult> {
    const params: { platform?: GatewayPlatformId; origin?: string } = {};
    if (platform !== undefined) params.platform = platform;
    if (origin !== undefined) params.origin = origin;
    const result = await this.rpc.call('gateway:start', params, {
      timeout: GATEWAY_RPC_TIMEOUTS.SHORT_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'gateway:start failed');
  }

  public async stop(
    platform?: GatewayPlatformId,
    origin?: string,
  ): Promise<GatewayStopResult> {
    const params: { platform?: GatewayPlatformId; origin?: string } = {};
    if (platform !== undefined) params.platform = platform;
    if (origin !== undefined) params.origin = origin;
    const result = await this.rpc.call('gateway:stop', params, {
      timeout: GATEWAY_RPC_TIMEOUTS.SHORT_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'gateway:stop failed');
  }

  /**
   * SECURITY-SENSITIVE: this is the only method on this service that carries
   * a plaintext token. The caller MUST clear the source field synchronously
   * after the returned Promise settles (see component `submitToken` flow).
   * This service deliberately does NOT keep a reference to `token` after the
   * call — it is passed straight to `rpc.call` and forgotten.
   */
  public async setToken(params: {
    platform: GatewayPlatformId;
    token: string;
    slackAppToken?: string;
  }): Promise<GatewaySetTokenResult> {
    const result = await this.rpc.call('gateway:setToken', params, {
      timeout: GATEWAY_RPC_TIMEOUTS.SET_TOKEN_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'gateway:setToken failed');
  }

  public async listBindings(filter?: {
    platform?: GatewayPlatformId;
    status?: GatewayApprovalStatus;
  }): Promise<GatewayListBindingsResult> {
    const params: {
      platform?: GatewayPlatformId;
      status?: GatewayApprovalStatus;
    } = {};
    if (filter?.platform) params.platform = filter.platform;
    if (filter?.status) params.status = filter.status;
    const result = await this.rpc.call('gateway:listBindings', params, {
      timeout: GATEWAY_RPC_TIMEOUTS.LIST_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'gateway:listBindings failed');
  }

  public async approveBinding(
    bindingId: string,
    code: string,
    opts?: { ptahSessionId?: string; workspaceRoot?: string },
  ): Promise<GatewayApproveBindingResult> {
    const params: {
      bindingId: string;
      code: string;
      ptahSessionId?: string;
      workspaceRoot?: string;
    } = { bindingId, code };
    if (opts?.ptahSessionId) params.ptahSessionId = opts.ptahSessionId;
    if (opts?.workspaceRoot) params.workspaceRoot = opts.workspaceRoot;
    const result = await this.rpc.call('gateway:approveBinding', params, {
      timeout: GATEWAY_RPC_TIMEOUTS.SHORT_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'gateway:approveBinding failed');
  }

  /**
   * Combined reject + revoke — backend exposes a single `gateway:blockBinding`
   * RPC accepting either `'rejected'` or `'revoked'`. Defaults to `'rejected'`.
   */
  public async blockBinding(
    bindingId: string,
    status: 'rejected' | 'revoked' = 'rejected',
  ): Promise<GatewayBlockBindingResult> {
    const result = await this.rpc.call(
      'gateway:blockBinding',
      { bindingId, status },
      { timeout: GATEWAY_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'gateway:blockBinding failed');
  }

  public async listMessages(params: {
    bindingId: string;
    limit?: number;
    before?: number;
  }): Promise<GatewayListMessagesResult> {
    const result = await this.rpc.call('gateway:listMessages', params, {
      timeout: GATEWAY_RPC_TIMEOUTS.LIST_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'gateway:listMessages failed');
  }

  /**
   * `gateway:test` — fire a single canned message at an approved binding.
   * Powers the "Send test" button. Returns a structured result; failure modes
   * are surfaced via `{ ok: false, error }` rather than thrown errors so the
   * UI can show a precise reason ("no-approved-binding", etc.).
   */
  public async test(
    platform: GatewayTestPlatform,
    bindingId?: string,
  ): Promise<GatewayTestResult> {
    const params: { platform: GatewayTestPlatform; bindingId?: string } = {
      platform,
    };
    if (bindingId) params.bindingId = bindingId;
    const result = await this.rpc.call('gateway:test', params, {
      timeout: GATEWAY_RPC_TIMEOUTS.TEST_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'gateway:test failed');
  }
}
