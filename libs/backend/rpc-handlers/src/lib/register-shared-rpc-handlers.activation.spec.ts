/**
 * activateSessionLifecycleNotifier — eager plan-limit activation
 * (TASK_2026_596, Task 15.2, binding carry-forward from Batches 8 and 11).
 *
 * `activateSessionLifecycleNotifier` is the one startup hook every host calls
 * (VS Code `phase-3-handlers.ts`, Electron `bootstrap.ts`, CLI
 * `cli-engine/container.ts`), after its library registrations. These cases
 * compose a container from the REAL library registrations in host order —
 * `registerAuthProvidersServices`, `registerSdkServices`,
 * `registerCliAgentRuntimeServices`, then `registerSharedRpcHandlers` — with
 * only host-owned ports (`STATE_STORAGE`, `WEBVIEW_MANAGER`, logger, config,
 * secrets) supplied as values, exactly as each host's platform registration
 * supplies them, and prove:
 *
 *   1. activation constructs the plan-limit ledger singleton and the ledger
 *      subscribes to the native stream registry and the proxy quota store;
 *   2. the REAL `AgentProcessManager` then resolves (not a stub) and holds
 *      that same ledger, so lane evidence and startup evidence share one
 *      instance;
 *   3. the broadcaster created by activation is subscribed: a ledger change
 *      reaches the webview as one `planLimits:changed` push.
 */

// The cli-agent-runtime barrel (plan-limit discovery tokens) reaches the
// workspace-intelligence tree-sitter loader, whose `wasm-bundle-dir` reads
// `import.meta.url` (unparseable under CommonJS ts-jest). Nothing here parses.
jest.mock('../../../workspace-intelligence/src/ast/wasm-bundle-dir', () => ({
  BUNDLE_DIR: '',
  resolveWasmPath: (filename: string) => filename,
}));
import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { SDK_TOKENS, registerSdkServices } from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  PLAN_LIMIT_LEDGER_STORAGE_KEY,
  PlanLimitLedgerService,
  registerAuthProvidersServices,
} from '@ptah-extension/auth-providers';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  registerCliAgentRuntimeServices,
} from '@ptah-extension/cli-agent-runtime';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { MESSAGE_TYPES, type QuotaOwnerRef } from '@ptah-extension/shared';

import {
  activateSessionLifecycleNotifier,
  registerSharedRpcHandlers,
} from './register-shared-rpc-handlers';
import { PlanLimitsBroadcaster } from './handlers/plan-limits-broadcaster';

interface Host {
  c: DependencyContainer;
  logger: Logger;
  stateGet: jest.Mock;
  broadcastMessage: jest.Mock;
}

/**
 * The host-owned ports, then the library registrations in the order every
 * host runs them, then the shared RPC registration. Nothing is resolved.
 */
function composeHost(): Host {
  const c = rootContainer.createChildContainer();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;
  const stateGet = jest.fn(() => undefined);
  const broadcastMessage = jest.fn(async () => undefined);

  c.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: c });
  c.register(TOKENS.LOGGER, { useValue: logger });
  c.register(TOKENS.CONFIG_MANAGER, {
    useValue: {
      get: jest.fn(() => undefined),
      set: jest.fn(async () => undefined),
      getWithDefault: jest.fn((_key: string, fallback: unknown) => fallback),
      watch: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  c.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: {
      get: jest.fn(async () => undefined),
      store: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  c.register(TOKENS.AUTH_SECRETS_SERVICE, {
    useValue: {
      getProviderKey: jest.fn(async () => undefined),
      hasProviderKey: jest.fn(async () => false),
    },
  });
  c.register(TOKENS.SUBAGENT_REGISTRY_SERVICE, {
    useValue: { register: jest.fn(), unregister: jest.fn(), get: jest.fn() },
  });
  c.register(TOKENS.GIT_INFO_SERVICE, {
    useValue: { getWorktrees: jest.fn(async () => []) },
  });
  c.register(Symbol.for('WorkspaceScopeResolver'), {
    useValue: { read: jest.fn(() => undefined) },
  });
  c.register(TOKENS.SENTRY_SERVICE, {
    useValue: { captureException: jest.fn(), captureMessage: jest.fn() },
  });
  c.register(TOKENS.WEBVIEW_MANAGER, { useValue: { broadcastMessage } });
  c.register(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV, { useValue: {} });
  c.register(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER, {
    useValue: { resolveModel: jest.fn() },
  });
  c.register(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS, {
    useValue: {
      getModelTiers: jest.fn(() => ({ sonnet: null, opus: null, haiku: null })),
    },
  });
  c.register(AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE, {
    useValue: { setAnalysisReader: jest.fn(), getStatus: jest.fn() },
  });
  // Phase 0 registers it on every host; the lane resume gate resolves it.
  c.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, {
    useValue: {
      appendLine: jest.fn(),
      append: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
    },
  });
  c.register(PLATFORM_TOKENS.PLATFORM_INFO, {
    useValue: {
      platform: process.platform,
      arch: process.arch,
      osVersion: 'test',
    },
  });
  c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getWorkspaceFolders: jest.fn(() => []),
      getWorkspaceRoot: jest.fn(() => undefined),
      getConfiguration: jest.fn(
        (_section: string, _key: string, fallback?: unknown) => fallback,
      ),
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: {
      readFile: jest.fn(async () => ''),
      readDirectory: jest.fn(async () => []),
      stat: jest.fn(async () => undefined),
      exists: jest.fn(async () => false),
    },
  });
  // Global state, as every platform registration provides it. The ledger
  // reads its persisted evidence from here in its constructor.
  c.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: {
      get: stateGet,
      update: jest.fn(async () => undefined),
      keys: jest.fn(() => []),
    },
  });
  c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: {
      get: jest.fn(() => undefined),
      update: jest.fn(async () => undefined),
      keys: jest.fn(() => []),
    },
  });
  c.register(SETTINGS_TOKENS.REASONING_SETTINGS, {
    useValue: { effort: { get: jest.fn(() => '') } },
  });

  registerAuthProvidersServices(c, logger);
  registerSdkServices(c, logger);
  c.register(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, { useValue: {} });
  registerCliAgentRuntimeServices(c, logger);
  registerSharedRpcHandlers(c);
  return { c, logger, stateGet, broadcastMessage };
}

function ledgerReads(stateGet: jest.Mock): number {
  return stateGet.mock.calls.filter(
    ([key]) => key === PLAN_LIMIT_LEDGER_STORAGE_KEY,
  ).length;
}

describe('activateSessionLifecycleNotifier — plan-limit ledger activation', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('constructs the ledger singleton at activation, subscribed to stream and proxy evidence', () => {
    const host = composeHost();
    const registry = host.c.resolve<{
      notifyAll(payload: unknown): void;
    }>(SDK_TOKENS.SDK_SESSION_PLAN_LIMIT_REGISTRY);
    const quotaStore = host.c.resolve<{
      onRateLimit: (...args: unknown[]) => unknown;
      onSuccess: (...args: unknown[]) => unknown;
    }>(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_QUOTA_STORE);
    const onRateLimit = jest.spyOn(quotaStore, 'onRateLimit');
    const onSuccess = jest.spyOn(quotaStore, 'onSuccess');
    const onChange = jest.spyOn(PlanLimitLedgerService.prototype, 'onChange');
    expect(ledgerReads(host.stateGet)).toBe(0);

    activateSessionLifecycleNotifier(host.c);

    // Constructed exactly once, by activation: it loaded its persisted state
    // and subscribed to both proxy observations...
    expect(ledgerReads(host.stateGet)).toBe(1);
    expect(onRateLimit).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const ledger = host.c.resolve<PlanLimitLedgerService>(
      AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER,
    );
    expect(ledger).toBeInstanceOf(PlanLimitLedgerService);
    expect(ledgerReads(host.stateGet)).toBe(1);
    // ...and the broadcaster subscribed to its changes.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.instances[0]).toBe(ledger);
    expect(host.logger.error).not.toHaveBeenCalled();
    // The ledger hears the native stream from startup: a turn-start on the
    // shared registry registers the session with no reader involved. (Other
    // registry subscribers run against this spec's stubbed session manager;
    // only the ledger's effect is asserted.)
    registry.notifyAll({
      sessionId: 'tab-activation',
      signal: { kind: 'turn-start', observedAt: Date.now() },
    });
    expect(Object.keys(ledger.sessionOwners())).toContain('tab-activation');
    onChange.mockRestore();
  });

  it('the REAL AgentProcessManager resolves afterwards and shares the activated ledger', () => {
    const host = composeHost();
    activateSessionLifecycleNotifier(host.c);
    const ledger = host.c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER);

    const manager = host.c.resolve<{
      planLimits: unknown;
      getStatus(): unknown[];
    }>(TOKENS.AGENT_PROCESS_MANAGER);

    expect(manager.constructor.name).toBe('AgentProcessManager');
    expect(manager.planLimits).toBe(ledger);
    expect(manager.getStatus()).toEqual([]);
    expect(ledgerReads(host.stateGet)).toBe(1);
  });

  it('the activated broadcaster pushes planLimits:changed after a ledger change', async () => {
    const host = composeHost();
    // Host-side sources discovery reads; stubbed so the push never probes the
    // machine (no CLI detection, no Ptah CLI settings, no network).
    host.c.register(TOKENS.CLI_DETECTION_SERVICE, {
      useValue: { detectAll: jest.fn(async () => []), getAdapter: jest.fn() },
    });
    host.c.register(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY, {
      useValue: { listAgents: jest.fn(async () => []) },
    });
    host.c.register(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER, {
      useValue: {
        resolveActiveAuth: jest.fn(() => ({
          authMethod: 'thirdParty',
          providerId: 'z-ai',
        })),
      },
    });
    activateSessionLifecycleNotifier(host.c);
    expect(host.c.resolve(PlanLimitsBroadcaster)).toBeInstanceOf(
      PlanLimitsBroadcaster,
    );
    const ledger = host.c.resolve<PlanLimitLedgerService>(
      AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER,
    );
    const owner: QuotaOwnerRef = {
      key: 'openai-codex#cli-store:0123456789abcdef',
      providerId: 'openai-codex',
      identityKind: 'cli-store',
      label: 'Codex account',
    };

    jest.useFakeTimers();
    const now = Date.now();
    ledger.recordCooldown(owner, { until: now + 60_000, observedAt: now });
    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(0);

    expect(host.broadcastMessage).toHaveBeenCalledTimes(1);
    const [type, payload] = host.broadcastMessage.mock.calls[0] as [
      string,
      { owners: Array<{ owner: QuotaOwnerRef }> },
    ];
    expect(type).toBe(MESSAGE_TYPES.PLAN_LIMITS_CHANGED);
    expect(payload.owners.map((entry) => entry.owner.key)).toContain(owner.key);
  });
});
