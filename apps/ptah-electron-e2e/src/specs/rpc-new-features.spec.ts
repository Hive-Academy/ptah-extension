import { test, expect } from '../support/fixtures';

/**
 * RPC contract specs for the namespaces added by the recent Electron
 * enhancements: task specs (`tasks:*`), the messaging gateway (`gateway:*`),
 * voice providers (`voice:*`), and the read-only in-app MCP OAuth methods
 * (`mcpDirectory:listOAuthConnected`, `mcpDirectory:oauthStatus`).
 *
 * These complement rpc.spec.ts (envelope mechanics) by asserting each NEW
 * read-only method is wired end-to-end in the Electron host. A namespace
 * missing from `ALLOWED_METHOD_PREFIXES`
 * (libs/backend/vscode-core/.../rpc-handler.ts) or from `registerAllRpcHandlers`
 * would surface here as a transport-level rejection — catching the
 * dual-registration bug class the repo has hit before — instead of silently at
 * runtime.
 *
 * The harness launches WITHOUT a workspace, so methods split into two groups:
 *   - no-precondition reads → must resolve to a SUCCESS envelope.
 *   - workspace/SQLite-gated reads → must resolve to a graceful HANDLER-level
 *     error envelope (proving the method routed to a real handler and degraded
 *     cleanly, not a crash/timeout/unregistered rejection).
 *
 * Only side-effect-free (read/list/status) methods are exercised.
 */

interface RpcResponseEnvelope {
  type?: string;
  correlationId?: string;
  success?: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
}

function rpcCall(method: string, params: unknown = {}, correlationId?: string) {
  return {
    type: 'rpc:call',
    payload: {
      method,
      params,
      correlationId:
        correlationId ??
        `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  };
}

/** Phrases that indicate the transport rejected the call before any handler ran. */
const TRANSPORT_REJECTION =
  /allowed prefix|invalid method|unknown method|no handler|not registered|method not found/i;

/** Read methods that succeed on a fresh, workspace-less launch. */
const SUCCESS_METHODS = [
  'gateway:status',
  'voice:listProviders',
  'voice:getConfig',
  'voice:getTtsConfig',
  'mcpDirectory:listOAuthConnected',
] as const;

/**
 * Read methods gated on a workspace / initialized SQLite. Without those, they
 * must still route to their handler and return a graceful error envelope.
 */
const GRACEFUL_METHODS = [
  'tasks:list',
  'tasks:board',
  'gateway:listBindings',
] as const;

test.describe('new-feature RPC contracts', () => {
  for (const method of SUCCESS_METHODS) {
    test(`${method} is registered and returns a success envelope`, async ({
      rpcBridge,
      mainWindow,
    }) => {
      await mainWindow.waitForLoadState('domcontentloaded');
      const cid = `cid-${method}-${Date.now()}`;
      const res = (await rpcBridge.sendRpc(
        'rpc',
        rpcCall(method, {}, cid),
      )) as RpcResponseEnvelope;

      expect(res.type).toBe('rpc:response');
      expect(res.correlationId).toBe(cid);
      expect(
        res.success,
        `Expected "${method}" to succeed. error=${res.error ?? '(none)'}`,
      ).toBe(true);
      expect(res.data).toBeDefined();
      expect(typeof res.data).toBe('object');
    });
  }

  for (const method of GRACEFUL_METHODS) {
    test(`${method} is registered and degrades gracefully without a workspace`, async ({
      rpcBridge,
      mainWindow,
    }) => {
      await mainWindow.waitForLoadState('domcontentloaded');
      const cid = `cid-${method}-${Date.now()}`;
      const res = (await rpcBridge.sendRpc(
        'rpc',
        rpcCall(method, {}, cid),
      )) as RpcResponseEnvelope;

      // A well-formed envelope came back (not a crash or timeout).
      expect(res.type).toBe('rpc:response');
      expect(res.correlationId).toBe(cid);
      expect(typeof res.success).toBe('boolean');

      // Either it succeeded, or it failed at the HANDLER (missing workspace /
      // SQLite) — never a transport-level rejection, which would mean the
      // namespace is not registered.
      if (!res.success) {
        expect(typeof res.error).toBe('string');
        expect(
          res.error,
          `"${method}" failed with a transport rejection — namespace likely ` +
            `not registered in ALLOWED_METHOD_PREFIXES / registerAllRpcHandlers.`,
        ).not.toMatch(TRANSPORT_REJECTION);
      }
    });
  }

  test('gateway:status reports a structured, disabled-by-default state', async ({
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const res = (await rpcBridge.sendRpc(
      'rpc',
      rpcCall('gateway:status'),
    )) as RpcResponseEnvelope;

    expect(res.success).toBe(true);
    const data = res.data as { enabled?: unknown; adapters?: unknown };
    // Shape contract: an `enabled` flag and an `adapters` array are always
    // present, even with no messaging platforms configured.
    expect(typeof data.enabled).toBe('boolean');
    expect(Array.isArray(data.adapters)).toBe(true);
  });

  test('voice:listProviders returns a provider catalog array', async ({
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const res = (await rpcBridge.sendRpc(
      'rpc',
      rpcCall('voice:listProviders'),
    )) as RpcResponseEnvelope;

    expect(res.success).toBe(true);
    const data = res.data as { providers?: unknown } | unknown[];
    const providers = Array.isArray(data)
      ? data
      : (data as { providers?: unknown }).providers;
    expect(Array.isArray(providers)).toBe(true);
  });

  test('mcpDirectory:listOAuthConnected returns an empty servers array on a fresh launch', async ({
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const res = (await rpcBridge.sendRpc(
      'rpc',
      rpcCall('mcpDirectory:listOAuthConnected'),
    )) as RpcResponseEnvelope;

    expect(res.success).toBe(true);
    const data = res.data as { servers?: unknown };
    expect(Array.isArray(data.servers)).toBe(true);
    expect((data.servers as unknown[]).length).toBe(0);
  });

  test('mcpDirectory:oauthStatus reports disconnected for an unknown serverKey', async ({
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const res = (await rpcBridge.sendRpc(
      'rpc',
      rpcCall('mcpDirectory:oauthStatus', {
        serverKey: 'oauth-nonexistent-e2e',
      }),
    )) as RpcResponseEnvelope;

    expect(res.success).toBe(true);
    const data = res.data as { state?: string };
    expect(data.state).toBe('disconnected');
  });
});
