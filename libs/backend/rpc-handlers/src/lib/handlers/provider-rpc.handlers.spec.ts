/**
 * ProviderRpcHandlers — unit specs.
 *
 * Surface under test: four RPC methods backing the provider model selector
 * (`listModels`, `setModelTier`, `getModelTiers`, `clearModelTier`) plus
 * the eager dynamic-fetcher registration that `register()` runs for
 * Copilot, Codex, Anthropic-direct, and Ollama.
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` registers the four RPC methods AND
 *     eagerly wires four dynamic fetchers onto `ProviderModelsService`
 *     (github-copilot, openai-codex, anthropic, ollama, ollama-cloud).
 *     These fetchers are registered at startup — not on first provider
 *     selection — so the model dropdown populates independent of the
 *     active provider.
 *
 *   - Schema validation: each method parses its params through the
 *     corresponding schema in `provider-rpc.schema.ts`. Invalid payloads
 *     surface as RPC failures (the handler re-throws the ZodError, which
 *     `MockRpcHandler` maps to `{ success: false, error }`).
 *
 *   - `provider:listModels`: routes `providerId` through
 *     `resolveProviderId()` (param > config > DEFAULT_PROVIDER_ID). For
 *     purely-dynamic providers without an API key it short-circuits to an
 *     empty result (not an error). Auth-failure errors (`401`, `403`,
 *     `Unauthorized`) are mapped to a user-facing "API key invalid" error
 *     message instead of throwing.
 *
 *   - `provider:setModelTier` / `provider:clearModelTier`: on success the
 *     handler MUST call `sdkAdapter.clearModelCache()` so the next
 *     `config:models-list` picks up fresh tier env vars. On failure the
 *     error is captured to Sentry and returned structurally (never throws
 *     to RPC boundary) with fixed text; only a SettingsPersistError's
 *     message passes through.
 *
 *   - `provider:getModelTiers`: returns the service's tier map verbatim.
 *     A service throw is captured to Sentry and re-thrown to the RPC
 *     boundary (the UI treats this as a generic load failure).
 *
 * Mocking posture: direct constructor injection, narrow `jest.Mocked<T>`
 * surfaces, no `as any` casts. We avoid re-implementing ProviderModels,
 * SdkAdapter, and ModelDiscovery — we only expose the methods this
 * handler touches.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts`
 */

// The cli-agent-runtime barrel (plan-limit discovery tokens) reaches the
// workspace-intelligence tree-sitter loader, whose `wasm-bundle-dir` reads
// `import.meta.url` (unparseable under CommonJS ts-jest). Nothing here parses.
jest.mock('../../../../workspace-intelligence/src/ast/wasm-bundle-dir', () => ({
  BUNDLE_DIR: '',
  resolveWasmPath: (filename: string) => filename,
}));
import 'reflect-metadata';

import type {
  ConfigManager,
  IAuthSecretsService,
  Logger,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockAuthSecretsService,
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
  type MockAuthSecretsService,
  type MockConfigManager,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type { IModelDiscovery } from '@ptah-extension/platform-core';
import { SettingsPersistError } from '@ptah-extension/platform-core';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type {
  OllamaModelDiscoveryService,
  ProviderModelsService,
  CopilotAuthService,
  CodexAuthService,
} from '@ptah-extension/auth-providers';
import type { CliDetectionService } from '@ptah-extension/cli-agent-runtime';
import type {
  DiscoveredPlanOwner,
  PlanOwnerDiscoveryRequest,
} from '@ptah-extension/cli-agent-runtime';
import type { PlanOwnerTarget } from '@ptah-extension/auth-providers';
import type {
  AuthEnv,
  PlanLimitOwnerSnapshot,
  PlanLimitsSnapshot,
  ProviderGetAccountUsageResult,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { ConnectionCheckRecorder } from '../utils/connection-check-recorder';
import { PlanLimitsSnapshotService } from '../services/plan-limits-snapshot.service';
import { ProviderRpcHandlers } from './provider-rpc.handlers';

// A thrown error whose text carries a credential and a user path; neither may
// reach the RPC result (TASK_2026_555 Batch 12c).
const FAKE_KEY = 'sk-test-FAKEKEY123';
const LEAKY_MESSAGE = `write failed for ${FAKE_KEY} at C:\\Users\\someone\\.ptah\\settings.json`;

// ---------------------------------------------------------------------------
// Plan-limit fixtures (TASK_2026_596). Owner keys are opaque hashes; labels
// are generic. The three fake secrets stand for what the backend resolves
// while reading (F71) and must never be serialized.
// ---------------------------------------------------------------------------

const FAKE_PROVIDER_KEY = 'ollama-FAKE-provider-key-7f3a';
const FAKE_PTAH_CLI_KEY = 'ptahcli-FAKE-lane-key-91c2';
const FAKE_CSRF_TOKEN = 'csrf-FAKE-token-d04e';

function owner(
  providerId: string,
  identityKind: QuotaOwnerRef['identityKind'],
  fingerprint: string,
  label: string,
): QuotaOwnerRef {
  return {
    key: `${providerId}#${identityKind}:${fingerprint}`,
    providerId,
    identityKind,
    label,
  };
}

const CODEX_OWNER = owner('openai-codex', 'cli-store', 'a1', 'Codex account');
const OLLAMA_OWNER = owner(
  'ollama-cloud',
  'credential',
  'b2',
  'Ollama Cloud key',
);
const PTAH_CLI_OWNER = owner(
  'ollama-cloud',
  'credential',
  'c3',
  'Ollama Cloud key',
);
const ANTIGRAVITY_OWNER = owner(
  'antigravity',
  'cli-store',
  'd4',
  'Antigravity',
);
const CLAUDE_OWNER = owner('anthropic', 'account', 'e5', 'Claude account');
const COPILOT_OWNER = owner('github-copilot', 'unknown', 'f6', 'Unknown owner');

const FIVE_HOUR_WINDOW = {
  key: 'five_hour' as const,
  kind: 'five_hour' as const,
  label: '5-hour',
  used: { kind: 'percent' as const, percent: 40 },
  usedSource: 'provider-api' as const,
  observedAt: 1_000,
};

function ownerSnapshot(
  ownerRef: QuotaOwnerRef,
  status: PlanLimitOwnerSnapshot['status'],
  windows: PlanLimitOwnerSnapshot['windows'],
  extra: Partial<PlanLimitOwnerSnapshot> = {},
): PlanLimitOwnerSnapshot {
  return {
    owner: ownerRef,
    status,
    windowSetEstablished: status === 'available',
    windows,
    ownerEvidence: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Narrow mock surfaces
// ---------------------------------------------------------------------------

type MockProviderModels = jest.Mocked<
  Pick<
    ProviderModelsService,
    | 'registerDynamicFetcher'
    | 'fetchModels'
    | 'setModelTier'
    | 'getModelTiers'
    | 'clearModelTier'
    | 'reapplyTiersForWarmedCatalog'
  >
>;

function createMockProviderModels(): MockProviderModels {
  return {
    registerDynamicFetcher: jest.fn(),
    fetchModels: jest.fn(),
    reapplyTiersForWarmedCatalog: jest.fn(),
    setModelTier: jest.fn().mockResolvedValue(undefined),
    getModelTiers: jest.fn().mockReturnValue({
      sonnet: null,
      opus: null,
      haiku: null,
    }),
    clearModelTier: jest.fn().mockResolvedValue(undefined),
  };
}

type MockSdkAdapter = jest.Mocked<
  Pick<
    SdkAgentAdapter,
    | 'clearModelCache'
    | 'getApiModels'
    | 'getSupportedModels'
    | 'getNativeClaudeModels'
  >
>;

function createMockSdkAdapter(): MockSdkAdapter {
  return {
    clearModelCache: jest.fn(),
    getApiModels: jest.fn().mockResolvedValue([]),
    getSupportedModels: jest.fn().mockResolvedValue([]),
    getNativeClaudeModels: jest.fn().mockResolvedValue([]),
  };
}

type MockCliDetection = jest.Mocked<Pick<CliDetectionService, 'getAdapter'>>;

function createMockCliDetection(): MockCliDetection {
  return { getAdapter: jest.fn().mockReturnValue(undefined) };
}

type MockModelDiscovery = jest.Mocked<IModelDiscovery>;

function createMockModelDiscovery(): MockModelDiscovery {
  return {
    getCopilotModels: jest.fn().mockResolvedValue([]),
    getCodexModels: jest.fn().mockResolvedValue([]),
  };
}

type MockOllamaDiscovery = jest.Mocked<
  Pick<OllamaModelDiscoveryService, 'listLocalModels' | 'listCloudModels'>
>;

function createMockOllamaDiscovery(): MockOllamaDiscovery {
  return {
    listLocalModels: jest.fn().mockResolvedValue([]),
    listCloudModels: jest.fn().mockResolvedValue([]),
  };
}

type MockCopilotAuthService = jest.Mocked<
  Pick<CopilotAuthService, 'listModels'>
>;

function createMockCopilotAuthService(): MockCopilotAuthService {
  return { listModels: jest.fn().mockResolvedValue([]) };
}

type MockCodexAuthService = jest.Mocked<Pick<CodexAuthService, 'listModels'>>;

function createMockCodexAuthService(): MockCodexAuthService {
  return { listModels: jest.fn().mockResolvedValue([]) };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: ProviderRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  configManager: MockConfigManager;
  authSecrets: MockAuthSecretsService;
  providerModels: MockProviderModels;
  cliDetection: MockCliDetection;
  modelDiscovery: MockModelDiscovery;
  sdkAdapter: MockSdkAdapter;
  authEnv: AuthEnv;
  ollamaDiscovery: MockOllamaDiscovery;
  copilotAuthService: MockCopilotAuthService;
  codexAuthService: MockCodexAuthService;
  codexAccountUsage: {
    getAccountUsage: jest.Mock;
    clearCache: jest.Mock;
    close: jest.Mock;
  };
  sentry: MockSentryService;
  planLimits: PlanLimitsFakes;
}

/** Fakes behind the REAL PlanLimitsSnapshotService the handler uses. */
interface PlanLimitsFakes {
  discoverTargets: jest.Mock<
    Promise<DiscoveredPlanOwner[]>,
    [PlanOwnerDiscoveryRequest?]
  >;
  getOwnerSnapshot: jest.Mock<
    Promise<PlanLimitOwnerSnapshot>,
    [PlanOwnerTarget, { refresh?: boolean; signal?: AbortSignal }?]
  >;
  snapshotFor: jest.Mock;
  sessionOwners: jest.Mock;
}

function createPlanLimitsFakes(): PlanLimitsFakes {
  return {
    discoverTargets: jest.fn(async () => []),
    getOwnerSnapshot: jest.fn(),
    snapshotFor: jest.fn(() => undefined),
    sessionOwners: jest.fn(() => ({})),
  };
}

function makeHarness(
  opts: {
    configSeed?: Record<string, unknown>;
    providerKeysSeed?: Record<string, string>;
    authEnv?: Partial<AuthEnv>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const configManager = createMockConfigManager({ values: opts.configSeed });
  const authSecrets = createMockAuthSecretsService({
    providerKeys: opts.providerKeysSeed,
  });
  const providerModels = createMockProviderModels();
  const cliDetection = createMockCliDetection();
  const modelDiscovery = createMockModelDiscovery();
  const sdkAdapter = createMockSdkAdapter();
  const authEnv: AuthEnv = { ...(opts.authEnv ?? {}) };
  const ollamaDiscovery = createMockOllamaDiscovery();
  const copilotAuthService = createMockCopilotAuthService();
  const codexAuthService = createMockCodexAuthService();
  const codexAccountUsage = {
    getAccountUsage: jest.fn().mockResolvedValue({
      status: 'available',
      providerId: 'openai-codex',
      fetchedAt: 1,
    }),
    clearCache: jest.fn(),
    close: jest.fn(),
  };
  const sentry = createMockSentryService();
  const planLimits = createPlanLimitsFakes();
  const planLimitsService = new PlanLimitsSnapshotService(
    logger as unknown as Logger,
    { discoverTargets: planLimits.discoverTargets },
    { getOwnerSnapshot: planLimits.getOwnerSnapshot },
    {
      snapshotFor: planLimits.snapshotFor,
      sessionOwners: planLimits.sessionOwners,
    },
  );

  const handlers = new ProviderRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    configManager as unknown as ConfigManager,
    authSecrets as unknown as IAuthSecretsService,
    providerModels as unknown as ProviderModelsService,
    cliDetection as unknown as CliDetectionService,
    modelDiscovery as unknown as IModelDiscovery,
    sdkAdapter as unknown as SdkAgentAdapter,
    authEnv,
    ollamaDiscovery as unknown as OllamaModelDiscoveryService,
    copilotAuthService as unknown as CopilotAuthService,
    codexAuthService as unknown as CodexAuthService,
    codexAccountUsage,
    sentry as unknown as SentryService,
    // User-defined provider entries (TASK_2026_236). Not exercised by this
    // suite — see provider-rpc.custom-entries.spec.ts for its coverage.
    {
      load: () => ({ entries: [], dropped: [] }),
      list: () => [],
      get: () => undefined,
      add: async () => {
        throw new Error('not used');
      },
      update: async () => {
        throw new Error('not used');
      },
      remove: async () => false,
    } as unknown as import('@ptah-extension/settings-core').CustomProviderStore,
    new ConnectionCheckRecorder(),
    planLimitsService,
  );

  return {
    planLimits,
    handlers,
    logger,
    rpcHandler,
    configManager,
    authSecrets,
    providerModels,
    cliDetection,
    modelDiscovery,
    sdkAdapter,
    authEnv,
    ollamaDiscovery,
    copilotAuthService,
    codexAuthService,
    codexAccountUsage,
    sentry,
  };
}

async function call<TResult>(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<TResult> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
  if (!response.success) {
    throw new Error(`RPC ${method} failed: ${response.error}`);
  }
  return response.data as TResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderRpcHandlers', () => {
  describe('provider:getAccountUsage', () => {
    it('reads the Codex owner through PlanUsageService and keeps every legacy field', async () => {
      const h = makeHarness();
      const target: PlanOwnerTarget = {
        providerId: 'openai-codex',
        ownerRef: CODEX_OWNER,
      };
      h.planLimits.discoverTargets.mockResolvedValue([
        { kind: 'read', origin: 'selected-provider', target },
      ]);
      h.planLimits.getOwnerSnapshot.mockResolvedValue(
        ownerSnapshot(CODEX_OWNER, 'available', [FIVE_HOUR_WINDOW]),
      );
      h.codexAccountUsage.getAccountUsage.mockResolvedValue({
        status: 'available',
        providerId: 'openai-codex',
        fetchedAt: 10,
        account: { planType: 'plus' },
        quota: {
          primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 99 },
          secondary: { usedPercent: 7, windowDurationMins: 10080 },
        },
        activity: { dailyUsage: [] },
      });
      h.handlers.register();

      const result = await call<ProviderGetAccountUsageResult>(
        h,
        'provider:getAccountUsage',
        { providerId: 'openai-codex', refresh: true },
      );

      expect(h.planLimits.discoverTargets).toHaveBeenCalledWith({
        selectedProviderId: 'openai-codex',
      });
      expect(h.planLimits.getOwnerSnapshot).toHaveBeenCalledWith(
        target,
        expect.objectContaining({ refresh: true }),
      );
      // The reader just filled the Codex cache; the legacy call never refetches.
      expect(h.codexAccountUsage.getAccountUsage).toHaveBeenCalledWith({
        refresh: false,
      });
      expect(result).toMatchObject({
        status: 'available',
        providerId: 'openai-codex',
        fetchedAt: 10,
        account: { planType: 'plus' },
        quota: {
          primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 99 },
          secondary: { usedPercent: 7, windowDurationMins: 10080 },
        },
        activity: { dailyUsage: [] },
        owner: CODEX_OWNER,
        windows: [FIVE_HOUR_WINDOW],
        ownerEvidence: [],
        windowSetEstablished: true,
      });
    });

    it('waits out a Codex cold start longer than the 3 s plan-limits deadline', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        const target: PlanOwnerTarget = {
          providerId: 'openai-codex',
          ownerRef: CODEX_OWNER,
        };
        h.planLimits.discoverTargets.mockResolvedValue([
          { kind: 'read', origin: 'selected-provider', target },
        ]);
        // A cold start: the read answers after 5 s, and aborts if signalled.
        h.planLimits.getOwnerSnapshot.mockImplementation(
          (_target, options) =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(
                () =>
                  resolve(
                    ownerSnapshot(CODEX_OWNER, 'available', [FIVE_HOUR_WINDOW]),
                  ),
                5_000,
              );
              options?.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              });
            }),
        );
        h.codexAccountUsage.getAccountUsage.mockResolvedValue({
          status: 'available',
          providerId: 'openai-codex',
          fetchedAt: 10,
          account: { planType: 'plus' },
          quota: {
            primary: { usedPercent: 40, windowDurationMins: 300 },
            secondary: { usedPercent: 7, windowDurationMins: 10080 },
          },
          activity: { dailyUsage: [] },
        });
        h.handlers.register();

        let settled: ProviderGetAccountUsageResult | undefined;
        const pending = call<ProviderGetAccountUsageResult>(
          h,
          'provider:getAccountUsage',
          { providerId: 'openai-codex' },
        ).then((value) => (settled = value));
        await jest.advanceTimersByTimeAsync(3_500);
        expect(settled).toBeUndefined();
        await jest.advanceTimersByTimeAsync(1_500);
        await pending;

        expect(
          h.planLimits.getOwnerSnapshot.mock.calls[0][1]?.signal,
        ).toBeUndefined();
        expect(settled).toMatchObject({
          status: 'available',
          account: { planType: 'plus' },
          quota: {
            primary: { usedPercent: 40, windowDurationMins: 300 },
            secondary: { usedPercent: 7, windowDurationMins: 10080 },
          },
          activity: { dailyUsage: [] },
          windows: [FIVE_HOUR_WINDOW],
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('answers a non-Codex provider with a reader instead of provider-unsupported', async () => {
      const h = makeHarness();
      h.planLimits.discoverTargets.mockResolvedValue([
        {
          kind: 'read',
          origin: 'selected-provider',
          target: {
            providerId: 'ollama-cloud',
            ownerRef: OLLAMA_OWNER,
            credentialRef: { kind: 'provider-key', providerId: 'ollama-cloud' },
          },
        },
      ]);
      h.planLimits.getOwnerSnapshot.mockResolvedValue(
        ownerSnapshot(OLLAMA_OWNER, 'available', [FIVE_HOUR_WINDOW]),
      );
      h.handlers.register();

      const result = await call<ProviderGetAccountUsageResult>(
        h,
        'provider:getAccountUsage',
        { providerId: 'ollama-cloud' },
      );

      expect(result.status).toBe('available');
      expect(result.owner).toEqual(OLLAMA_OWNER);
      expect(result.windows).toEqual([FIVE_HOUR_WINDOW]);
      expect(result).not.toHaveProperty('credentialRef');
      expect(h.codexAccountUsage.getAccountUsage).not.toHaveBeenCalled();
    });

    it('passes a known selected owner through unread and keeps its status', async () => {
      const h = makeHarness();
      const known = ownerSnapshot(COPILOT_OWNER, 'provider-unsupported', []);
      h.planLimits.discoverTargets.mockResolvedValue([
        { kind: 'known', origin: 'selected-provider', snapshot: known },
      ]);
      h.handlers.register();

      await expect(
        call(h, 'provider:getAccountUsage', { providerId: 'github-copilot' }),
      ).resolves.toEqual({
        status: 'provider-unsupported',
        providerId: 'github-copilot',
        owner: COPILOT_OWNER,
        windows: [],
        ownerEvidence: [],
        windowSetEstablished: false,
      });
      expect(h.planLimits.getOwnerSnapshot).not.toHaveBeenCalled();
      expect(h.codexAccountUsage.getAccountUsage).not.toHaveBeenCalled();
    });

    it('returns provider-unsupported when the route names no owner', async () => {
      const h = makeHarness();
      h.handlers.register();

      await expect(
        call(h, 'provider:getAccountUsage', { providerId: 'z-ai' }),
      ).resolves.toEqual({
        status: 'provider-unsupported',
        providerId: 'z-ai',
      });
    });
  });

  describe('provider:getPlanLimits', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('reads only `read` owners and passes `known` snapshots through unread', async () => {
      const h = makeHarness();
      const readTarget: PlanOwnerTarget = {
        providerId: 'openai-codex',
        ownerRef: CODEX_OWNER,
      };
      const known = ownerSnapshot(CLAUDE_OWNER, 'service-unavailable', [], {
        unavailableReason: 'no-open-session',
      });
      const read = ownerSnapshot(CODEX_OWNER, 'available', [FIVE_HOUR_WINDOW]);
      h.planLimits.discoverTargets.mockResolvedValue([
        { kind: 'known', origin: 'selected-provider', snapshot: known },
        { kind: 'read', origin: 'lane', target: readTarget },
      ]);
      h.planLimits.getOwnerSnapshot.mockResolvedValue(read);
      h.handlers.register();

      const result = await call<PlanLimitsSnapshot>(
        h,
        'provider:getPlanLimits',
        { providerId: 'claude-cli', sessionIds: ['s-1'], ownerKeys: ['k'] },
      );

      expect(h.planLimits.discoverTargets).toHaveBeenCalledWith({
        selectedProviderId: 'claude-cli',
        sessionIds: ['s-1'],
        ownerKeys: ['k'],
      });
      // One reader call, for the `read` entry only — never for the known owner.
      expect(h.planLimits.getOwnerSnapshot).toHaveBeenCalledTimes(1);
      expect(h.planLimits.getOwnerSnapshot).toHaveBeenCalledWith(
        readTarget,
        expect.objectContaining({ refresh: false }),
      );
      expect(result.owners).toEqual([known, read]);
      expect(typeof result.generatedAt).toBe('number');
    });

    it('reads owners in parallel, each bounded by its own 3 s deadline', async () => {
      jest.useFakeTimers();
      const h = makeHarness();
      const evidence = {
        owner: CODEX_OWNER,
        windows: [FIVE_HOUR_WINDOW],
        ownerEvidence: [],
      };
      h.planLimits.snapshotFor.mockImplementation((key: string) =>
        key === CODEX_OWNER.key ? evidence : undefined,
      );
      h.planLimits.discoverTargets.mockResolvedValue([
        {
          kind: 'read',
          origin: 'lane',
          target: { providerId: 'openai-codex', ownerRef: CODEX_OWNER },
        },
        {
          kind: 'read',
          origin: 'lane',
          target: { providerId: 'ollama-cloud', ownerRef: OLLAMA_OWNER },
        },
      ]);
      // A read that never answers: it settles only when its signal aborts.
      h.planLimits.getOwnerSnapshot.mockImplementation(
        (_target, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      );
      h.handlers.register();

      let settled: PlanLimitsSnapshot | undefined;
      const pending = call<PlanLimitsSnapshot>(
        h,
        'provider:getPlanLimits',
      ).then((value) => (settled = value));
      await jest.advanceTimersByTimeAsync(2_999);
      expect(h.planLimits.getOwnerSnapshot).toHaveBeenCalledTimes(2);
      expect(settled).toBeUndefined();

      // One deadline releases both owners: the reads ran side by side.
      await jest.advanceTimersByTimeAsync(1);
      await pending;

      expect(settled?.owners).toEqual([
        {
          owner: CODEX_OWNER,
          status: 'service-unavailable',
          windowSetEstablished: false,
          windows: [FIVE_HOUR_WINDOW],
          ownerEvidence: [],
        },
        {
          owner: OLLAMA_OWNER,
          status: 'service-unavailable',
          windowSetEstablished: false,
          windows: [],
          ownerEvidence: [],
        },
      ]);
    });

    it('lists every ledger session and each requested session it has not seen', async () => {
      const h = makeHarness();
      h.planLimits.sessionOwners.mockReturnValue({
        's-1': { ownerKey: CLAUDE_OWNER.key, modelScope: 'opus' },
      });
      h.handlers.register();

      const result = await call<PlanLimitsSnapshot>(
        h,
        'provider:getPlanLimits',
        { sessionIds: ['s-1', 's-2'] },
      );

      expect(result.sessionOwners).toEqual({
        's-1': { ownerKey: CLAUDE_OWNER.key, modelScope: 'opus' },
        's-2': { ownerKey: null, modelScope: null },
      });
    });

    it('rejects unknown fields and malformed ids at the boundary', async () => {
      const h = makeHarness();
      h.handlers.register();

      await expect(
        call(h, 'provider:getPlanLimits', { apiKey: 'sk-nope' }),
      ).rejects.toThrow();
      await expect(
        call(h, 'provider:getPlanLimits', { sessionIds: [''] }),
      ).rejects.toThrow();
      expect(h.planLimits.discoverTargets).not.toHaveBeenCalled();
    });

    it('F71: the serialized result carries no secret, credential reference or email', async () => {
      const h = makeHarness();
      const secrets = [FAKE_PROVIDER_KEY, FAKE_PTAH_CLI_KEY, FAKE_CSRF_TOKEN];
      h.planLimits.discoverTargets.mockResolvedValue([
        {
          kind: 'read',
          origin: 'selected-provider',
          target: {
            providerId: 'ollama-cloud',
            ownerRef: OLLAMA_OWNER,
            credentialRef: { kind: 'provider-key', providerId: 'ollama-cloud' },
          },
        },
        {
          kind: 'read',
          origin: 'lane',
          target: {
            providerId: 'ollama-cloud',
            ownerRef: PTAH_CLI_OWNER,
            credentialRef: { kind: 'ptah-cli-key', ptahCliId: 'glm-lane' },
          },
        },
        {
          kind: 'read',
          origin: 'cli-store',
          target: { providerId: 'antigravity', ownerRef: ANTIGRAVITY_OWNER },
        },
      ]);
      // The backend holds the secrets while reading; a failing reader even
      // quotes them in its error. None of it may reach the wire.
      const resolvedSecret = (target: PlanOwnerTarget): string | undefined =>
        target.credentialRef?.kind === 'provider-key'
          ? FAKE_PROVIDER_KEY
          : target.credentialRef?.kind === 'ptah-cli-key'
            ? FAKE_PTAH_CLI_KEY
            : undefined;
      h.planLimits.getOwnerSnapshot.mockImplementation(async (target) => {
        const secret = resolvedSecret(target);
        if (target.ownerRef === ANTIGRAVITY_OWNER) {
          throw new Error(
            `language server rejected csrf ${FAKE_CSRF_TOKEN} for user@example.com`,
          );
        }
        if (target.ownerRef === PTAH_CLI_OWNER) {
          throw new Error(
            `401 for key ${secret} (fallback ${FAKE_PROVIDER_KEY})`,
          );
        }
        return ownerSnapshot(target.ownerRef, 'available', [FIVE_HOUR_WINDOW]);
      });
      h.handlers.register();

      const result = await call<PlanLimitsSnapshot>(
        h,
        'provider:getPlanLimits',
        { providerId: 'ollama-cloud' },
      );
      const json = JSON.stringify(result);

      expect(result.owners).toHaveLength(3);
      for (const secret of secrets) expect(json).not.toContain(secret);
      expect(json).not.toContain('credentialRef');
      expect(json).not.toContain('ptah-cli-key');
      expect(json).not.toMatch(/[^\s"@]+@[^\s"@]+\.[a-z]{2,}/i);
      // Nor in what was logged about the failure.
      const logged = JSON.stringify(h.logger.debug.mock.calls);
      for (const secret of secrets) expect(logged).not.toContain(secret);
    });
  });
  describe('register()', () => {
    it('registers exactly the methods it declares on METHODS', () => {
      const h = makeHarness();
      h.handlers.register();

      // Pinned against METHODS rather than a hand-written list: the manifest
      // reads the same tuple, so a method added to one and not the other is
      // what `rpc-allowlist.spec.ts` would fail on.
      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [...ProviderRpcHandlers.METHODS].sort(),
      );
      expect(h.rpcHandler.getRegisteredMethods()).toEqual(
        expect.arrayContaining([
          'provider:clearModelTier',
          'provider:getModelTiers',
          'provider:listModels',
          'provider:setModelTier',
          'provider:listCustomEntries',
          'provider:addCustomEntry',
          'provider:updateCustomEntry',
          'provider:removeCustomEntry',
          'provider:testCustomEntry',
          'provider:getAccountUsage',
          // In RpcMethodRegistry since Batch 1; registering it here closes the
          // verifyAndReportRpcRegistration drift on every host (TASK_2026_596).
          'provider:getPlanLimits',
        ]),
      );
    });

    it('eagerly registers dynamic fetchers for copilot / codex / anthropic / ollama / ollama-cloud', () => {
      const h = makeHarness();
      h.handlers.register();

      const registeredProviders =
        h.providerModels.registerDynamicFetcher.mock.calls.map((c) => c[0]);
      expect(registeredProviders).toEqual(
        expect.arrayContaining([
          'github-copilot',
          'openai-codex',
          'anthropic',
          'ollama',
          'ollama-cloud',
        ]),
      );
    });

    it.each(['api', 'sdk', 'fallback', 'claude-cli'])(
      'does not declare provider capacity for Anthropic-direct %s model entries',
      async (source) => {
        const h = makeHarness({
          authEnv:
            source === 'api' || source === 'fallback'
              ? { ANTHROPIC_API_KEY: 'fixture-key' }
              : {},
        });
        const models = [
          {
            value: 'claude-sonnet-4-5',
            displayName: 'Sonnet',
            description: '',
          },
        ];
        h.sdkAdapter.getApiModels.mockResolvedValue(models);
        h.sdkAdapter.getSupportedModels.mockResolvedValue(models);
        h.sdkAdapter.getNativeClaudeModels.mockResolvedValue(models);
        if (source === 'fallback')
          h.sdkAdapter.getApiModels.mockRejectedValue(new Error('offline'));
        h.handlers.register();
        const providerId = source === 'claude-cli' ? 'claude-cli' : 'anthropic';
        const entry = h.providerModels.registerDynamicFetcher.mock.calls.find(
          ([id]) => id === providerId,
        );
        if (!entry) throw new Error('Missing native fetcher');
        const result = await entry[1]();
        expect(result).toHaveLength(1);
        expect(result[0].contextLength).toBeGreaterThan(0);
        expect(result[0]).not.toHaveProperty('contextLengthSource');
      },
    );

    it('declares platform API capacity but leaves the static Copilot fallback unverified', async () => {
      const h = makeHarness();
      h.modelDiscovery.getCopilotModels.mockResolvedValueOnce([
        { id: 'api-model-418', name: 'API model', contextLength: 200000 },
      ]);
      h.handlers.register();
      const entry = h.providerModels.registerDynamicFetcher.mock.calls.find(
        ([id]) => id === 'github-copilot',
      );
      if (!entry) throw new Error('Missing Copilot fetcher');
      expect((await entry[1]())[0]).toMatchObject({
        contextLength: 200000,
        contextLengthSource: 'provider',
      });
      const fallback = await entry[1]();
      expect(fallback.length).toBeGreaterThan(0);
      for (const model of fallback)
        expect(model).not.toHaveProperty('contextLengthSource');
    });

    it('does not certify Codex platform matches without provider identity', async () => {
      const h = makeHarness();
      h.handlers.register();
      const entry = h.providerModels.registerDynamicFetcher.mock.calls.find(
        ([id]) => id === 'openai-codex',
      );
      if (!entry) throw new Error('Missing Codex fetcher');
      const fallback = await entry[1]();
      expect(fallback.length).toBeGreaterThan(0);
      h.modelDiscovery.getCodexModels.mockResolvedValue([
        { id: fallback[0].id, name: 'Shared slug', contextLength: 200000 },
      ]);
      const [model] = await entry[1]();
      expect(model.contextLength).toBe(200000);
      expect(model).not.toHaveProperty('contextLengthSource');
    });

    /**
     * `claude-cli` is a `nativeAuth` provider — a lane on it always runs against
     * the host's ambient Claude login. Its model list must therefore never be
     * derived from the process-global AuthEnv while a third-party
     * Anthropic-compatible provider is active, or the picker leaks that
     * provider's catalog (e.g. bare `kimi-*` ids) into the Claude lane.
     */
    describe('claude-cli dynamic fetcher', () => {
      function claudeCliFetcher(h: Harness): () => Promise<unknown[]> {
        const entry = h.providerModels.registerDynamicFetcher.mock.calls.find(
          (c) => c[0] === 'claude-cli',
        );
        if (!entry) throw new Error('claude-cli fetcher was not registered');
        return entry[1] as () => Promise<unknown[]>;
      }

      it('lists the native Claude login models', async () => {
        const h = makeHarness();
        h.sdkAdapter.getNativeClaudeModels.mockResolvedValue([
          {
            value: 'claude-opus-4-8',
            displayName: 'Claude Opus 4.8',
            description: '',
          },
        ]);
        h.handlers.register();

        await expect(claudeCliFetcher(h)()).resolves.toEqual([
          expect.objectContaining({
            id: 'claude-opus-4-8',
            name: 'Claude Opus 4.8',
          }),
        ]);
      });

      it('still lists the native Claude models while a third-party provider owns the ambient env', async () => {
        const h = makeHarness({
          authEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:58306' },
        });
        h.sdkAdapter.getNativeClaudeModels.mockResolvedValue([
          {
            value: 'opus[1m]',
            displayName: 'Opus (1M context)',
            description: '',
          },
          {
            value: 'claude-fable-5[1m]',
            displayName: 'Fable',
            description: '',
          },
        ]);
        // The active-provider list must never be the source for this provider.
        h.sdkAdapter.getSupportedModels.mockResolvedValue([
          {
            value: 'gpt-5.6-luna',
            displayName: 'gpt-5.6-luna',
            description: '',
          },
        ]);
        h.handlers.register();

        await expect(claudeCliFetcher(h)()).resolves.toEqual([
          expect.objectContaining({ id: 'opus[1m]' }),
          expect.objectContaining({ id: 'claude-fable-5[1m]' }),
        ]);
        expect(h.sdkAdapter.getSupportedModels).not.toHaveBeenCalled();
      });

      it('returns empty (→ static Claude catalog) when the native login reports nothing', async () => {
        const h = makeHarness();
        h.sdkAdapter.getNativeClaudeModels.mockResolvedValue([]);
        h.handlers.register();

        await expect(claudeCliFetcher(h)()).resolves.toEqual([]);
      });
    });
  });

  // -------------------------------------------------------------------------
  // provider:listModels
  // -------------------------------------------------------------------------

  describe('provider:listModels', () => {
    it('resolves providerId from params override', async () => {
      const h = makeHarness({ providerKeysSeed: { moonshot: 'key-m' } });
      h.providerModels.fetchModels.mockResolvedValue({
        models: [],
        totalCount: 0,
        isStatic: true,
      });
      h.handlers.register();

      await call(h, 'provider:listModels', { providerId: 'moonshot' });

      expect(h.providerModels.fetchModels).toHaveBeenCalledWith(
        'moonshot',
        'key-m',
        false,
      );
    });

    it('falls back to configManager.anthropicProviderId when providerId is absent', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'z-ai' },
        providerKeysSeed: { 'z-ai': 'key-z' },
      });
      h.providerModels.fetchModels.mockResolvedValue({
        models: [],
        totalCount: 0,
        isStatic: true,
      });
      h.handlers.register();

      await call(h, 'provider:listModels', {});

      expect(h.providerModels.fetchModels).toHaveBeenCalledWith(
        'z-ai',
        'key-z',
        false,
      );
    });

    it('forwards toolUseOnly flag to the service', async () => {
      // Seed a key for openrouter — it is a purely dynamic provider
      // (modelsEndpoint set, no static fallback), so absent a key the handler
      // short-circuits to an empty result without ever invoking the service.
      const h = makeHarness({
        providerKeysSeed: { openrouter: 'sk-or-test' },
      });
      h.providerModels.fetchModels.mockResolvedValue({
        models: [],
        totalCount: 0,
        isStatic: true,
      });
      h.handlers.register();

      await call(h, 'provider:listModels', {
        providerId: 'openrouter',
        toolUseOnly: true,
      });

      expect(h.providerModels.fetchModels).toHaveBeenCalledWith(
        'openrouter',
        'sk-or-test',
        true,
      );
    });

    it('tells the models service the catalog was warmed, with the RESOLVED provider id', async () => {
      // TASK_2026_262 residual hole 3. Fetching for the picker warms both
      // catalogue caches — which is precisely what the tier derivation reads —
      // and before this nothing said so, leaving the ambient tier env vars
      // unset until the next provider activation.
      //
      // The id has to be the RESOLVED one, not the raw param: the service
      // compares it against the active provider before writing any global env,
      // and an unresolved `undefined` would silently disable that guard.
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'z-ai' },
        providerKeysSeed: { 'z-ai': 'key-z' },
      });
      h.providerModels.fetchModels.mockResolvedValue({
        models: [
          {
            id: 'kimi-k2',
            name: 'Kimi K2',
            description: '',
            contextLength: 200000,
            supportsToolUse: true,
          },
        ],
        totalCount: 1,
        isStatic: false,
      });
      h.handlers.register();

      await call(h, 'provider:listModels', {});

      expect(
        h.providerModels.reapplyTiersForWarmedCatalog,
      ).toHaveBeenCalledWith('z-ai');
    });

    it('does not claim a warm when the provider returned no catalog at all', async () => {
      // Nothing landed, so there is nothing new to derive from. Saying
      // otherwise would push the service into re-applying against the same
      // hole and scheduling a fetch the user's own just failed to satisfy.
      const h = makeHarness({ providerKeysSeed: { moonshot: 'key-m' } });
      h.providerModels.fetchModels.mockResolvedValue({
        models: [],
        totalCount: 0,
        isStatic: false,
      });
      h.handlers.register();

      await call(h, 'provider:listModels', { providerId: 'moonshot' });

      expect(
        h.providerModels.reapplyTiersForWarmedCatalog,
      ).not.toHaveBeenCalled();
    });

    it('short-circuits to empty result for purely-dynamic providers without an API key', async () => {
      // OpenRouter has `modelsEndpoint` set and no static fallback beyond
      // what a key would unlock — the handler must not call fetchModels.
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        models: unknown[];
        totalCount: number;
        isStatic: boolean;
      }>(h, 'provider:listModels', { providerId: 'openrouter' });

      expect(result).toEqual({ models: [], totalCount: 0, isStatic: false });
      expect(h.providerModels.fetchModels).not.toHaveBeenCalled();
    });

    it('Sakana with a bare key → reaches the dynamic fetch path (fetchModels invoked with the key)', async () => {
      // Sakana has modelsEndpoint set, so a present key unlocks the dynamic
      // /v1/models list (incl. dated aliases like fugu-ultra-20260615).
      const h = makeHarness({ providerKeysSeed: { sakana: 'sakana-key' } });
      h.providerModels.fetchModels.mockResolvedValue({
        models: [
          {
            id: 'fugu',
            name: 'Fugu',
            description: '',
            contextLength: 200000,
            supportsToolUse: true,
          },
          {
            id: 'fugu-ultra',
            name: 'Fugu Ultra',
            description: '',
            contextLength: 200000,
            supportsToolUse: true,
          },
          {
            id: 'fugu-ultra-20260615',
            name: 'fugu-ultra-20260615',
            description: '',
            contextLength: 200000,
            supportsToolUse: true,
          },
        ],
        totalCount: 3,
        isStatic: false,
      });
      h.handlers.register();

      const result = await call<{
        models: { id: string }[];
        isStatic: boolean;
      }>(h, 'provider:listModels', { providerId: 'sakana' });

      expect(h.providerModels.fetchModels).toHaveBeenCalledWith(
        'sakana',
        'sakana-key',
        false,
      );
      expect(result.isStatic).toBe(false);
      expect(result.models.map((m) => m.id)).toContain('fugu-ultra-20260615');
    });

    it('Sakana without a key → does NOT short-circuit (has staticModels) and returns the static fallback', async () => {
      // isPurelyDynamic is false for Sakana (staticModels present), so the
      // handler must fall through to fetchModels(null) and serve fugu/fugu-ultra.
      const h = makeHarness();
      h.providerModels.fetchModels.mockResolvedValue({
        models: [
          {
            id: 'fugu',
            name: 'Fugu',
            description: '',
            contextLength: 200000,
            supportsToolUse: true,
          },
          {
            id: 'fugu-ultra',
            name: 'Fugu Ultra',
            description: '',
            contextLength: 200000,
            supportsToolUse: true,
          },
        ],
        totalCount: 2,
        isStatic: true,
      });
      h.handlers.register();

      const result = await call<{
        models: { id: string }[];
        isStatic: boolean;
      }>(h, 'provider:listModels', { providerId: 'sakana' });

      expect(h.providerModels.fetchModels).toHaveBeenCalledWith(
        'sakana',
        null,
        false,
      );
      expect(result.models.map((m) => m.id)).toEqual(['fugu', 'fugu-ultra']);
      expect(result.models.length).toBeGreaterThan(0);
    });

    it('maps 401-ish errors to a friendly "invalid key" response (no throw)', async () => {
      const h = makeHarness({
        providerKeysSeed: { openrouter: 'stale-key' },
      });
      h.providerModels.fetchModels.mockRejectedValue(
        new Error('HTTP 401 Unauthorized'),
      );
      h.handlers.register();

      const result = await call<{
        models: unknown[];
        error?: string;
      }>(h, 'provider:listModels', { providerId: 'openrouter' });

      expect(result.models).toEqual([]);
      expect(result.error).toMatch(/invalid or expired/i);
      // Auth errors are NOT captured to Sentry (expected negative path).
      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });

    it('captures non-auth errors to Sentry and re-throws to the RPC boundary', async () => {
      const h = makeHarness({
        providerKeysSeed: { openrouter: 'key' },
      });
      h.providerModels.fetchModels.mockRejectedValue(
        new Error('ECONNRESET on provider API'),
      );
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'provider:listModels',
        params: { providerId: 'openrouter' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/ECONNRESET/);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // provider:setModelTier
  // -------------------------------------------------------------------------

  describe('provider:setModelTier', () => {
    it('rejects unknown tier values via the schema', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:setModelTier',
        { tier: 'default', modelId: 'x', scope: 'mainAgent' },
      );

      // The handler catches the ZodError and returns structured failure.
      expect(result.success).toBe(false);
      expect(h.providerModels.setModelTier).not.toHaveBeenCalled();
      expect(h.sdkAdapter.clearModelCache).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('rejects empty modelId via the schema', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:setModelTier',
        { tier: 'sonnet', modelId: '', scope: 'mainAgent' },
      );

      expect(result.success).toBe(false);
      expect(h.providerModels.setModelTier).not.toHaveBeenCalled();
    });

    it('writes the tier and clears the SDK model cache on success (mainAgent scope)', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'openrouter' },
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:setModelTier',
        {
          tier: 'sonnet',
          modelId: 'anthropic/claude-3.5-sonnet',
          scope: 'mainAgent',
        },
      );

      expect(result.success).toBe(true);
      expect(h.providerModels.setModelTier).toHaveBeenCalledWith(
        'openrouter',
        'sonnet',
        'anthropic/claude-3.5-sonnet',
        'mainAgent',
      );
      // Contract: clear the SDK cache so the next models-list
      // call re-fetches with fresh tier env vars.
      expect(h.sdkAdapter.clearModelCache).toHaveBeenCalledTimes(1);
    });

    it('forwards cliAgent scope to the service without clearing model cache on failure', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'moonshot' },
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:setModelTier',
        { tier: 'haiku', modelId: 'kimi-k2.6:cloud', scope: 'cliAgent' },
      );

      expect(result.success).toBe(true);
      expect(h.providerModels.setModelTier).toHaveBeenCalledWith(
        'moonshot',
        'haiku',
        'kimi-k2.6:cloud',
        'cliAgent',
      );
      // SDK cache is cleared on success regardless of scope
      expect(h.sdkAdapter.clearModelCache).toHaveBeenCalledTimes(1);
    });

    it('captures service failures to Sentry and returns structured error', async () => {
      const h = makeHarness();
      h.providerModels.setModelTier.mockRejectedValue(new Error('disk full'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:setModelTier',
        {
          tier: 'opus',
          modelId: 'm',
          providerId: 'openrouter',
          scope: 'mainAgent',
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not save the model tier.');
      // On failure the cache is NOT cleared — a retried write must see
      // fresh context, not a stale cleared cache.
      expect(h.sdkAdapter.clearModelCache).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('never returns the raw error text (key or path) to the client', async () => {
      const h = makeHarness();
      const error = new Error(LEAKY_MESSAGE);
      h.providerModels.setModelTier.mockRejectedValue(error);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:setModelTier',
        {
          tier: 'opus',
          modelId: 'm',
          providerId: 'openrouter',
          scope: 'mainAgent',
        },
      );

      expect(result).toEqual({
        success: false,
        error: 'Could not save the model tier.',
      });
      expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
      expect(JSON.stringify(result)).not.toContain('someone');
      // Logging and Sentry keep the original error object.
      expect(h.logger.error).toHaveBeenCalledWith(
        'RPC: provider:setModelTier failed',
        error,
      );
      expect(h.sentry.captureException).toHaveBeenCalledWith(error, {
        errorSource: 'ProviderRpcHandlers.registerSetModelTier',
      });
    });

    it('passes a SettingsPersistError through (fixed text by construction)', async () => {
      const h = makeHarness();
      const error = new SettingsPersistError('EACCES');
      h.providerModels.setModelTier.mockRejectedValue(error);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:setModelTier',
        { tier: 'opus', modelId: 'm', scope: 'mainAgent' },
      );

      expect(result).toEqual({ success: false, error: error.message });
    });
  });

  // -------------------------------------------------------------------------
  // provider:getModelTiers
  // -------------------------------------------------------------------------

  describe('provider:getModelTiers', () => {
    it('returns the service tier map verbatim (mainAgent scope)', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'openrouter' },
      });
      h.providerModels.getModelTiers.mockReturnValue({
        sonnet: 'anthropic/claude-3.5-sonnet',
        opus: null,
        haiku: 'anthropic/claude-haiku',
      });
      h.handlers.register();

      const result = await call<{
        sonnet: string | null;
        opus: string | null;
        haiku: string | null;
      }>(h, 'provider:getModelTiers', { scope: 'mainAgent' });

      expect(result).toEqual({
        sonnet: 'anthropic/claude-3.5-sonnet',
        opus: null,
        haiku: 'anthropic/claude-haiku',
      });
      expect(h.providerModels.getModelTiers).toHaveBeenCalledWith(
        'openrouter',
        'mainAgent',
      );
    });

    it('forwards cliAgent scope to the service', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'moonshot' },
      });
      h.providerModels.getModelTiers.mockReturnValue({
        sonnet: null,
        opus: null,
        haiku: 'kimi-k2.6:cloud',
      });
      h.handlers.register();

      const result = await call<{
        sonnet: string | null;
        opus: string | null;
        haiku: string | null;
      }>(h, 'provider:getModelTiers', { scope: 'cliAgent' });

      expect(result.haiku).toBe('kimi-k2.6:cloud');
      expect(h.providerModels.getModelTiers).toHaveBeenCalledWith(
        'moonshot',
        'cliAgent',
      );
    });

    it('scope is required — missing scope is a validation error', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'moonshot' },
      });
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'provider:getModelTiers',
        params: {},
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(h.providerModels.getModelTiers).not.toHaveBeenCalled();
    });

    it('captures service throws to Sentry and re-throws to RPC boundary', async () => {
      const h = makeHarness();
      h.providerModels.getModelTiers.mockImplementation(() => {
        throw new Error('tier read failed');
      });
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'provider:getModelTiers',
        params: { scope: 'mainAgent' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('tier read failed');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // provider:clearModelTier
  // -------------------------------------------------------------------------

  describe('provider:clearModelTier', () => {
    it('rejects unknown tier values via the schema', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:clearModelTier',
        { tier: 'fast', scope: 'mainAgent' },
      );

      expect(result.success).toBe(false);
      expect(h.providerModels.clearModelTier).not.toHaveBeenCalled();
    });

    it('clears the tier and the SDK model cache on success (mainAgent scope)', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'openrouter' },
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:clearModelTier',
        { tier: 'opus', scope: 'mainAgent' },
      );

      expect(result.success).toBe(true);
      expect(h.providerModels.clearModelTier).toHaveBeenCalledWith(
        'openrouter',
        'opus',
        'mainAgent',
      );
      expect(h.sdkAdapter.clearModelCache).toHaveBeenCalledTimes(1);
    });

    it('forwards cliAgent scope to the service', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'moonshot' },
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:clearModelTier',
        { tier: 'haiku', scope: 'cliAgent' },
      );

      expect(result.success).toBe(true);
      expect(h.providerModels.clearModelTier).toHaveBeenCalledWith(
        'moonshot',
        'haiku',
        'cliAgent',
      );
    });

    it('captures service failures to Sentry and returns structured error', async () => {
      const h = makeHarness();
      h.providerModels.clearModelTier.mockRejectedValue(
        new Error('write blocked'),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:clearModelTier',
        { tier: 'haiku', providerId: 'openrouter', scope: 'mainAgent' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not reset the model tier.');
      expect(h.sdkAdapter.clearModelCache).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('never returns the raw error text (key or path) to the client', async () => {
      const h = makeHarness();
      const error = new Error(LEAKY_MESSAGE);
      h.providerModels.clearModelTier.mockRejectedValue(error);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:clearModelTier',
        { tier: 'haiku', providerId: 'openrouter', scope: 'mainAgent' },
      );

      expect(result).toEqual({
        success: false,
        error: 'Could not reset the model tier.',
      });
      expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
      expect(JSON.stringify(result)).not.toContain('someone');
      expect(h.logger.error).toHaveBeenCalledWith(
        'RPC: provider:clearModelTier failed',
        error,
      );
      expect(h.sentry.captureException).toHaveBeenCalledWith(error, {
        errorSource: 'ProviderRpcHandlers.registerClearModelTier',
      });
    });

    it('passes a SettingsPersistError through (fixed text by construction)', async () => {
      const h = makeHarness();
      const error = new SettingsPersistError('ENOSPC');
      h.providerModels.clearModelTier.mockRejectedValue(error);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:clearModelTier',
        { tier: 'haiku', scope: 'mainAgent' },
      );

      expect(result).toEqual({ success: false, error: error.message });
    });
  });

  // -------------------------------------------------------------------------
  // Scope-isolation scenario: the exact bug repro at the RPC wiring layer
  // -------------------------------------------------------------------------

  describe('Scope-isolation scenario (bug repro)', () => {
    it('routes cliAgent setModelTier and mainAgent getModelTiers to independent service calls', async () => {
      // This is the exact bug scenario: the UI calls setModelTier for a CLI
      // sub-agent, then reads tiers for the main agent.  The two scopes must
      // never bleed into each other at the RPC wiring level.
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'moonshot' },
      });
      h.handlers.register();

      // Step 1: UI sets tier for the CLI sub-agent.
      const setResult = await call<{ success: boolean }>(
        h,
        'provider:setModelTier',
        {
          scope: 'cliAgent',
          providerId: 'moonshot',
          tier: 'haiku',
          modelId: 'kimi-k2.6:cloud',
        },
      );

      expect(setResult.success).toBe(true);
      // The service must have been called with cliAgent scope — NOT mainAgent.
      expect(h.providerModels.setModelTier).toHaveBeenCalledWith(
        'moonshot',
        'haiku',
        'kimi-k2.6:cloud',
        'cliAgent',
      );

      // Step 2: UI reads tiers for the main agent (different scope entirely).
      h.providerModels.getModelTiers.mockReturnValue({
        sonnet: null,
        opus: null,
        haiku: null,
      });

      await call<{ sonnet: null; opus: null; haiku: null }>(
        h,
        'provider:getModelTiers',
        { scope: 'mainAgent' },
      );

      // The service must have been queried with mainAgent scope, not cliAgent.
      expect(h.providerModels.getModelTiers).toHaveBeenCalledWith(
        'moonshot',
        'mainAgent',
      );
    });

    it('cross-scope read independence: setting cliAgent tier for provider X does not surface when reading mainAgent tiers for X', async () => {
      // This is a wiring test — it verifies that the mock is called with the
      // correct scope arguments so the service can enforce independent storage.
      // It does NOT re-test the service's own scope-isolation logic.
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'moonshot' },
      });
      // Simulate independent storage: mainAgent returns empty, cliAgent has a value.
      h.providerModels.getModelTiers.mockImplementation(
        (providerId: string, scope: string) => {
          if (scope === 'cliAgent') {
            return { sonnet: null, opus: null, haiku: 'kimi-k2.6:cloud' };
          }
          return { sonnet: null, opus: null, haiku: null };
        },
      );
      h.handlers.register();

      // Read via mainAgent scope — must get the main-agent shape (all null).
      const mainResult = await call<{
        sonnet: null;
        opus: null;
        haiku: null;
      }>(h, 'provider:getModelTiers', { scope: 'mainAgent' });

      expect(mainResult.haiku).toBeNull();
      expect(h.providerModels.getModelTiers).toHaveBeenCalledWith(
        'moonshot',
        'mainAgent',
      );

      // Read via cliAgent scope — must get the cli-agent shape (haiku populated).
      h.providerModels.getModelTiers.mockClear();
      const cliResult = await call<{
        sonnet: null;
        opus: null;
        haiku: string;
      }>(h, 'provider:getModelTiers', { scope: 'cliAgent' });

      expect(cliResult.haiku).toBe('kimi-k2.6:cloud');
      expect(h.providerModels.getModelTiers).toHaveBeenCalledWith(
        'moonshot',
        'cliAgent',
      );
    });
  });
});
