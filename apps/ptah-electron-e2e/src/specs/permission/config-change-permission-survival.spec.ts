import { randomUUID } from 'crypto';
import { test, expect } from '../../support/permission-seam-fixtures';

/**
 * Pins TASK_2026_247's fix at the wiring level the unit specs mock out
 * (TASK_2026_264).
 *
 * `session-lifecycle-manager-dispose.spec.ts` and `sdk-permission-handler.spec.ts`
 * prove the SCOPE and MAPPING of the fix by calling
 * `SessionLifecycleManager.disposeAllSessions()` / `cleanupPendingPermissions()`
 * directly, in-process, with `ConfigWatcher` mocked out entirely. Nothing in
 * that suite proves a REAL settings write reaches `disposeAllSessions()` at
 * all. This spec closes that gap: it drives a real `auth:saveSettings` RPC
 * call through the real `ConfigWatcher` → `SdkAgentAdapter.onConfigChanged`
 * → `SessionLifecycleManager.disposeAllSessions()` chain, against the real,
 * DI-resolved `SdkPermissionHandler` singleton.
 *
 * The seam: `agent:e2eSeedPermission` (added for this task,
 * `agent-rpc.handlers.ts`, PTAH_E2E-gated) calls the exact same
 * `SdkPermissionHandler.createCallback()` entry point the SDK itself calls
 * for every tool permission check, so the permission this spec observes is a
 * REAL entry in the REAL `pendingRequests` map — not a lookalike. See that
 * method's docblock for the full argument against a production seam here,
 * and .ptah/specs/TASK_2026_264/context.md for the constraints it satisfies.
 *
 * lm-studio is the provider under test (not ollama): it declares no
 * `defaultTiers` in the registry, so the same real provider switch this spec
 * needs for TASK_2026_247 also exercises TASK_2026_262's live-tier-derivation
 * path. lm-studio's `authType` is 'none' — no server needs to be running for
 * the SETTINGS WRITE (which is what trips `ConfigWatcher`) to happen; the
 * later connection attempt against the (absent) local server fails fast
 * (ECONNREFUSED, not a network timeout) and only affects whether the SDK
 * adapter ends up "configured", which this spec does not depend on.
 */

const REAL_BOOT_AND_WRITE_BUDGET_MS = 240_000;

test.describe('Config-change permission survival (TASK_2026_264, pins TASK_2026_247)', () => {
  test('a pending permission on an unregistered session survives a real provider switch and is still answerable; ConfigWatcher actually fired', async ({
    rpcBridge,
    messageLog,
    stdoutLog,
  }) => {
    test.setTimeout(REAL_BOOT_AND_WRITE_BUDGET_MS);

    // A random, valid UUID sessionId. Routable (SdkPermissionHandler.
    // isRoutablePermissionRequest accepts a UUID sessionId with no tabId), but
    // deliberately NOT bound to any SessionRecord in the real
    // SessionLifecycleManager's registry — nothing in this test ever starts a
    // chat session. That is exactly the shape TASK_2026_247 fix 1 protects:
    // disposeAllSessions() must only clean up pending permissions for records
    // it actually holds, never sweep the whole pendingRequests map. A request
    // belonging to nobody currently registered — a background subagent, a
    // second window's session, a gateway lane — is the case the bug hit
    // hardest, per that task's "Cross-session is not hypothetical" note.
    const orphanSessionId = randomUUID();
    const toolUseId = `e2e-scope-probe-${randomUUID()}`;
    const seedCorrelationId = `e2e-seed-scope-${randomUUID()}`;

    // Assertion 3, isolated: prove ConfigWatcher itself fires and reaches
    // SdkAgentAdapter, using the ONE production write that can only reach
    // disposeAllSessions() through ConfigWatcher's event bus. `auth:setApiKey`
    // writes a `ptah.auth.*` secret via `AuthSecretsService` and does nothing
    // else — no adapter reset, no other call in its handler body — so this
    // cannot be confused with any other trigger. (`auth:saveSettings` below is
    // NOT used for this half of the check: run first, it turned out its own
    // explicit `sdkAdapter.reset()` call reaches `disposeAllSessions()` before
    // the 'authMethod'/'anthropicProviderId' watcher fires, and `reset()`'s
    // `dispose()` tears the watcher down before it gets the chance —
    // confirmed by this spec's own first failing run, where "[SessionLifecycle]
    // Disposing all active sessions..." appeared but neither ConfigWatcher log
    // line ever did. That is a real, if inert, gap in the watcher's own
    // reachability via that RPC — reported as a finding, not silently worked
    // around.)
    const setKeyResponse = (await rpcBridge.sendRpc(
      'rpc',
      {
        type: 'rpc:call',
        payload: {
          method: 'auth:setApiKey',
          params: { provider: 'lm-studio', apiKey: 'e2e-dummy-test-key' },
        },
      },
      15_000,
    )) as { data?: { success?: boolean } };
    expect(setKeyResponse.data?.success).toBe(true);
    await stdoutLog.waitForLine(
      '[ConfigWatcher] Configuration changed',
      15_000,
    );
    await stdoutLog.waitForLine(
      '[SdkAgentAdapter] Config change detected, re-initializing...',
      5_000,
    );

    // Fire-and-forget: this RPC call does not resolve until something answers
    // or tears down the permission it creates, so it must not be awaited here
    // (see `agent:e2eSeedPermission`'s docblock and `messageLog`'s docblock
    // for why this spec never has two `sendRpc` calls in flight at once).
    await rpcBridge.sendFireAndForget('rpc', {
      type: 'rpc:call',
      payload: {
        method: 'agent:e2eSeedPermission',
        params: {
          toolName: 'Bash',
          input: { command: 'echo e2e-scope-probe' },
          toolUseId,
          sessionId: orphanSessionId,
        },
        correlationId: seedCorrelationId,
      },
    });

    // The real SdkPermissionHandler broadcasts a real 'permission:request' —
    // this is proof the request reached the real pendingRequests map, and is
    // where this spec learns the server-generated requestId (never something
    // this spec invents).
    const pushMsg = await messageLog.waitFor<{
      type: string;
      payload: { id: string; toolUseId: string };
    }>((msg) => {
      const m = msg as { type?: string; payload?: { toolUseId?: string } };
      return (
        m?.type === 'permission:request' && m?.payload?.toolUseId === toolUseId
      );
    }, 20_000);
    const requestId = pushMsg.payload.id;
    expect(requestId).toBeTruthy();

    // The real switch. `auth:saveSettings` is what the Settings UI itself
    // calls; `AuthManager.doConfigureAuthentication` is reached through it
    // (via `SdkAgentAdapter.initialize()`, both directly at the end of this
    // RPC handler AND indirectly through ConfigWatcher's own re-init). A
    // synthetic settings-file write would prove less: this goes through the
    // same `IScopeResolver.write('authMethod', ...)` call the UI makes.
    const authResponse = (await rpcBridge.sendRpc(
      'rpc',
      {
        type: 'rpc:call',
        payload: {
          method: 'auth:saveSettings',
          params: {
            authMethod: 'thirdParty',
            anthropicProviderId: 'lm-studio',
            applyTo: 'global',
          },
        },
      },
      45_000,
    )) as { data?: { success?: boolean } };
    expect(authResponse.data?.success).toBe(true);

    // Placebo guard for THIS trigger: prove a real disposal actually ran
    // rather than the request surviving because nothing happened at all.
    // `auth:saveSettings` reaches `disposeAllSessions()` through its own
    // explicit `sdkAdapter.reset()` (see the note above) rather than through
    // ConfigWatcher for this particular RPC — that is still a real,
    // production-triggered disposal, just not the watcher-mediated one.
    await stdoutLog.waitForLine(
      '[SessionLifecycle] Disposing all active sessions...',
      15_000,
    );

    // Assertion 1, part 2: the request is not just un-denied, it is
    // ANSWERABLE — resolve it for real, the same way a webview response
    // would (`agent:permissionResponse` is the production RPC the Settings/
    // Chat UI itself uses).
    const answerResponse = (await rpcBridge.sendRpc(
      'rpc',
      {
        type: 'rpc:call',
        payload: {
          method: 'agent:permissionResponse',
          params: { requestId, decision: 'allow' },
        },
      },
      10_000,
    )) as { data?: { success?: boolean } };
    expect(answerResponse.data?.success).toBe(true);

    // The seed call's own RPC response only arrives once the permission it
    // created resolves — which just happened above. If the config-change had
    // wrongly denied this request (the pre-fix behaviour), this response
    // would already have been sent — with `behavior: 'deny'` — the moment
    // `auth:saveSettings` ran, long before this `waitFor` call. Finding it
    // AND getting 'allow' is what proves it was still pending when answered.
    const seedResponse = await messageLog.waitFor<{
      type: string;
      correlationId: string;
      data?: { success?: boolean; behavior?: string; message?: string };
    }>((msg) => {
      const m = msg as { type?: string; correlationId?: string };
      return (
        m?.type === 'rpc:response' && m?.correlationId === seedCorrelationId
      );
    }, 15_000);

    expect(seedResponse.data?.success).toBe(true);
    expect(seedResponse.data?.behavior).toBe('allow');
  });

  test('a genuinely disposed (unroutable) permission maps to a system-abort message, not a canned user-denial', async ({
    rpcBridge,
  }) => {
    // 60s unroutable-deny timeout + real boot.
    test.setTimeout(REAL_BOOT_AND_WRITE_BUDGET_MS);

    // No sessionId, no tabId: SdkPermissionHandler.isRoutablePermissionRequest
    // classifies this UNROUTABLE, which arms the real 60s deny timer
    // (sdk-permission-handler.ts UNROUTABLE_PERMISSION_TIMEOUT_MS). Letting
    // that timer actually fire is a genuine disposal Ptah performs on its
    // own — not a fabrication this spec constructs — and it resolves through
    // the exact same `systemAbort` branch a real auth-change's
    // `cleanupPendingPermissions()` call does. This is fix 2 (mapping): the
    // model must receive "system abort, retryable", never the hard-deny
    // wording that reads as a deliberate user refusal.
    const response = (await rpcBridge.sendRpc(
      'rpc',
      {
        type: 'rpc:call',
        payload: {
          method: 'agent:e2eSeedPermission',
          params: {
            toolName: 'Bash',
            input: { command: 'echo e2e-mapping-probe' },
            toolUseId: `e2e-mapping-probe-${randomUUID()}`,
          },
        },
      },
      90_000,
    )) as {
      data?: {
        success?: boolean;
        behavior?: string;
        message?: string;
        interrupt?: boolean;
      };
    };

    expect(response.data?.success).toBe(true);
    expect(response.data?.behavior).toBe('deny');
    expect(response.data?.interrupt).toBe(false);
    expect(response.data?.message).toContain('SYSTEM ABORT');
    expect(response.data?.message).toContain('NOT a user decision');
    // The canned string a real CLI substitutes for a hard deny
    // (interrupt: true) — this must be a system-abort deny, not that one.
    expect(response.data?.message).not.toContain(
      "doesn't want to take this action",
    );
  });
});
