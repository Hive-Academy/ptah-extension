/**
 * Shared fixtures for the Settings e2e scenarios (TASK_2026_555 Batch 16,
 * Task 16.1 — S4, plan Component 14).
 *
 * Data reproduces `prototypes/BRIEF.md:44-69` ("Realistic data — use exactly
 * this so variants can be compared"), MINUS the OpenCode "quota reached"
 * state (D11 — `agent-process.types.ts:282-313` has no quota field on
 * `CliDetectionResult`, re-confirmed by this batch's report).
 *
 * Host/RPC mechanism reused from `../marketplace/marketplace.fixtures.ts`
 * (`installHost`, `installRpcAutoResponder`, `waitForAnimationsSettled`) —
 * that file's own doc comment explains why a working responder is
 * centralised rather than re-invented per scenario folder; the Settings
 * fixtures below are the DATA half only, following the same
 * stateful-resolver precedent (`marketplace.fixtures.ts:969-982`) for every
 * write this file's resolvers need to read back.
 *
 * `ProvidersSettingsStateService.open()`/`refresh()`
 * (`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:270-294`)
 * fires every RPC below on mount; `AgentOrchestrationConfigComponent` reuses
 * `agent:getConfig` from the same service. Everything NOT listed here is
 * deliberately left unanswered (thoth/marketplace fixture convention): the
 * caller's own RPC timeout/loading state handles it without touching an
 * unrelated assertion. The catalogue of 15 providers itself is NOT a fixture
 * value — `ProvidersSettingsComponent` derives its connection list from the
 * real, shipped provider registry (`getAllAnthropicProviders()`); this file
 * only answers the per-provider/per-key RPCs that registry-derived list asks
 * for.
 */
import { expect, type Page } from '@playwright/test';
import {
  installHost,
  installRpcAutoResponder,
  waitForAnimationsSettled,
  type RpcFixtureResolver,
} from '../marketplace/marketplace.fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import { withAdvancedSearchVoice } from './settings-advanced-search-voice.fixtures';

export { installHost, installRpcAutoResponder, waitForAnimationsSettled };

// ---------------------------------------------------------------------------
// Reference data — prototypes/BRIEF.md:44-69
// ---------------------------------------------------------------------------

/** `auth:getAuthStatus` — main agent is Claude (Subscription), CLI auth. */
export const AUTH_STATUS_FIXTURE = {
  hasApiKey: false,
  hasOpenRouterKey: false,
  hasAnyProviderKey: true,
  authMethod: 'claudeCli' as const,
  anthropicProviderId: 'claude-cli',
  availableProviders: [],
  copilotAuthenticated: false,
  codexAuthenticated: true,
  codexTokenStale: false,
  claudeCliInstalled: true,
};

/** The host's masked hint of Moonshot's stored key (prototype "•••• 8f21"; four U+2022, a space, the last 4). */
export const MOONSHOT_KEY_HINT = '•••• 8f21';

/** `auth:getApiKeyStatus` — per-provider key presence (BRIEF connections table); Moonshot carries a key hint (28c). */
export const API_KEY_STATUS_FIXTURE = {
  providers: [
    { provider: 'moonshot', displayName: 'Moonshot (Kimi)', hasApiKey: true, isDefault: false, keyHint: MOONSHOT_KEY_HINT },
    { provider: 'ollama-cloud', displayName: 'Ollama Cloud', hasApiKey: true, isDefault: false },
    { provider: 'sovereigneg', displayName: 'sovereigneg', hasApiKey: true, isDefault: false },
  ],
};

/** `provider:listCustomEntries` — the one custom endpoint, "sovereigneg". */
export const CUSTOM_ENTRIES_FIXTURE = {
  entries: [
    {
      id: 'sovereigneg',
      name: 'sovereigneg',
      baseUrl: 'https://sovereigneg.example.internal/v1',
      lane: 'openai' as const,
      authEnvVar: 'ANTHROPIC_API_KEY' as const,
      keyPrefix: '',
      helpUrl: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

/**
 * `provider:listModels` — one small catalogue for every provider (Batch 22): two tool-capable models and
 * one without tool use, so the drawer's pickers render their tool-use summary (#38) and search (#34).
 */
export const PROVIDER_MODELS_FIXTURE = {
  models: [
    { id: 'kimi-k2.5', name: 'Kimi K2.5', description: '', contextLength: 131072, supportsToolUse: true },
    { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', description: '', contextLength: 131072, supportsToolUse: true },
    { id: 'kimi-lite', name: 'Kimi Lite', description: '', contextLength: 32768, supportsToolUse: false },
  ],
  totalCount: 3,
  isStatic: true,
};

/** `agent:getConfig` — system CLIs + Ptah CLI instance policy (BRIEF:63-68). */
export const AGENT_CONFIG_FIXTURE = {
  detectedClis: [
    { cli: 'codex', installed: true, version: '1.4.0', messagingMode: 'none' },
    { cli: 'copilot', installed: true, version: '0.9.2', messagingMode: 'none' },
    { cli: 'cursor', installed: false, messagingMode: 'none' },
    { cli: 'antigravity', installed: true, version: '2.1.0', messagingMode: 'none' },
    { cli: 'opencode', installed: true, version: '0.6.0', messagingMode: 'none' },
    { cli: 'pi', installed: false, messagingMode: 'none' },
    {
      cli: 'ptah-cli', installed: true, messagingMode: 'none',
      ptahCliId: 'glm-instance-1', ptahCliName: 'Glm', providerName: 'Ollama Cloud', providerId: 'ollama-cloud',
    },
  ],
  preferredAgentOrder: ['codex', 'antigravity', 'glm-instance-1', 'copilot'],
  maxConcurrentAgents: 3,
  codexModel: 'gpt-5.5-codex',
  copilotModel: '',
  cursorModel: '',
  antigravityModel: 'claude-sonnet-4-6',
  opencodeModel: 'opencode/nemotron-3-ultra-free',
  piModel: '',
  cursorApiKeyConfigured: false,
  cursorApiKeyStored: false,
  cursorApiKeyEnvSet: false,
  codexReasoningEffort: 'medium',
  copilotReasoningEffort: '',
  piReasoningEffort: '',
  codexAutoApprove: true,
  copilotAutoApprove: false,
  mcpPort: 51820,
  disabledClis: ['copilot'],
  disabledMcpNamespaces: [],
  browserAllowLocalhost: false,
  workflowsDisabled: false,
};

/** `ptahCli:list` — the one Ptah CLI instance, "Glm" (BRIEF:66-67). */
export const PTAH_CLI_LIST_FIXTURE = {
  agents: [
    {
      id: 'glm-instance-1',
      name: 'Glm',
      providerName: 'Ollama Cloud',
      providerId: 'ollama-cloud',
      hasApiKey: true,
      hasStoredKey: true,
      status: 'available' as const,
      enabled: true,
      modelCount: 12,
    },
  ],
};

/** `settings:get({key:'ptahCliAgents'})` — persisted config `refreshCliModels` re-derives from. */
export const PTAH_CLI_AGENTS_SETTING_FIXTURE = {
  success: true,
  value: [
    {
      id: 'glm-instance-1',
      selectedModel: 'glm-5.3:cloud',
      tierMappings: { sonnet: 'glm-5.3:cloud', opus: 'glm-5.3:cloud', haiku: 'glm-5.3:cloud' },
    },
  ],
};

/** `memory:getTriggers` — memory-curator background role (BRIEF:60-61). */
export const MEMORY_TRIGGERS_FIXTURE = {
  triggers: {
    preCompact: true,
    idleMs: 60000,
    turnThreshold: 8,
    bootScan: true,
    curatorProvider: 'openai-codex',
    curatorModel: 'gpt-5.6-luna',
  },
};

/** `skillSynthesis:getLanes` — archaeologist/synthesis/judge/replay (BRIEF:60-62). */
export const SKILL_LANES_FIXTURE = {
  lanes: {
    archaeologist: { id: 'archaeologist', provider: '', model: '', defaultTier: 'haiku', structuredOutput: 'parse', retrievalDepth: 'none' },
    synthesis: { id: 'synthesis', provider: '', model: '', defaultTier: 'sonnet', structuredOutput: 'parse', retrievalDepth: 'none' },
    judge: { id: 'judge', provider: 'moonshot', model: 'kimi-k2.5', defaultTier: 'sonnet', structuredOutput: 'parse', retrievalDepth: 'none' },
    replay: { id: 'replay', provider: '', model: '', defaultTier: 'haiku', structuredOutput: 'parse', retrievalDepth: 'none' },
  },
};

/** `skillSynthesis:getSettings` — judging & enhancement lane (BRIEF:62). */
export const SKILL_SYNTHESIS_SETTINGS_FIXTURE = {
  settings: {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.92,
    maxActiveSkills: 40,
    candidatesDir: '.ptah/skill-candidates',
    evictionDecayRate: 0.1,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.85,
    prefilterMinEdits: 2,
    prefilterMinToolUses: 1,
    judgeEnabled: true,
    minJudgeScore: 0.7,
    judgeModel: 'inherit',
    judgeProvider: '',
    enhanceTimeoutMs: { value: 120000, default: 120000, min: 30000, max: 600000 },
  },
};

/** `config:model-get` / `config:effort-get` — main agent (BRIEF:47-49). */
export const MODEL_GET_FIXTURE = { model: '' };
export const EFFORT_GET_FIXTURE = { effort: 'medium' as const };

/**
 * `auth:getEffectiveRoute` — "Next request uses: Claude (Subscription)".
 * `providers[].status` drives `ProvidersSettingsComponent.connectionStatus()`
 * (`providers-settings.component.ts:425-429`) for every OTHER connection card
 * ('not-checked' when a provider is absent from this array), so every BRIEF
 * connection needs an entry here, not just the driver.
 */
export const EFFECTIVE_ROUTE_FIXTURE = {
  route: 'cli' as const,
  ready: true,
  blockers: [],
  driverProviderId: 'claude-cli',
  resolvedAuthModality: 'cli' as const,
  resolvedModel: { kind: 'unresolved' as const },
  storedAuthMethodDiagnostic: null,
  // BRIEF:48-49: "provider is from App · Desktop" — not global.
  storedAuthMethodScope: 'app' as const,
  providers: [
    { id: 'claude-cli', type: 'cli' as const, status: 'connected' as const },
    { id: 'moonshot', type: 'apiKey' as const, status: 'connected' as const },
    { id: 'openai-codex', type: 'oauth' as const, status: 'connected' as const },
    { id: 'ollama-cloud', type: 'local-native' as const, status: 'unreachable' as const },
    { id: 'sovereigneg', type: 'apiKey' as const, status: 'connected' as const },
  ],
  lastSuccessfulProbeAt: '2026-01-01T00:00:00.000Z',
  lastFailedProbeAt: null,
  probedAt: '2026-01-01T00:00:00.000Z',
  fromCache: false,
};

/** One recorded connection check (`ConnectionCheckRecord`, Batch 28c), as `auth:getEffectiveRoute` reports it. */
export interface FixtureCheckRecord {
  readonly status: 'verified' | 'failed';
  readonly reason: string | null;
  readonly latencyMs: number | null;
  readonly checkedAt: string;
}

/**
 * Latency `auth:checkConnection` records per connection: Moonshot is the prototype's "(92ms)"; CLI and sign-in
 * connections time no request (`latencyMs: null`, 28c).
 */
const CHECK_LATENCY_MS: Readonly<Record<string, number | null>> = {
  moonshot: 92, sovereigneg: 140, anthropic: 75, 'claude-cli': null, 'github-copilot': null, 'openai-codex': null,
};

/**
 * `auth:checkConnection` resolver: records the call and a verified check for a connection the host can check (the
 * route then reports it as `lastCheck`). A local or key-optional connection is refused by the real host; the UI
 * must never send one, so it is recorded and left unanswered (a spec asserting it was never called sees it).
 */
function checkConnectionResolver(state: FixtureState): RpcFixtureResolver {
  return (params) => {
    record(state, 'auth:checkConnection', params);
    const providerId = (params as { providerId?: string } | null)?.providerId ?? '';
    if (!Object.hasOwn(CHECK_LATENCY_MS, providerId)) throw new Error(`This connection cannot be checked here: ${providerId}`);
    const check: FixtureCheckRecord = { status: 'verified', reason: null, latencyMs: CHECK_LATENCY_MS[providerId], checkedAt: new Date().toISOString() };
    state.connectionChecks.set(providerId, check);
    return check;
  };
}

/**
 * `llm:getProviderBaseUrl` resolver — most local/native providers have no
 * override; Ollama Cloud is the only BRIEF connection whose base URL is
 * queried for setup. Resolver, not a static map, because
 * `ProvidersSettingsStateService.refreshConnections` calls it once per LOCAL
 * registry entry with a different `params.provider` each time.
 */
export function llmProviderBaseUrlResolver(): RpcFixtureResolver {
  return (params) => {
    const provider = (params as { provider?: string } | null)?.provider ?? '';
    return { baseUrl: null, defaultBaseUrl: provider ? `https://${provider}.example` : null };
  };
}

/**
 * The one typed API-key value that makes {@link verifyDraftConnectionResolver}
 * report a real failure (`outcome: 'failed'`, `reason: 'credential-rejected'`)
 * instead of the default success — the diagnostics-copy capability (#20)
 * needs a genuine failed probe, not a hardcoded always-succeeds stub.
 */
export const INVALID_PROBE_KEY = 'invalid-key-e2e';

/**
 * `auth:verifyDraftConnection` resolver — verifies every probe EXCEPT one
 * typed with {@link INVALID_PROBE_KEY}, which fails with a real
 * `credential-rejected` (401-shaped) result. Reachability only needs one
 * scripted failure path (#20); a fuller probe matrix is Providers-batch
 * (S5) work.
 */
export function verifyDraftConnectionResolver(): RpcFixtureResolver {
  return (params) => {
    const p = params as {
      probeId?: string;
      credential?: { kind: 'apiKey' | 'stored'; value?: string };
    } | null;
    const probeId = p?.probeId ?? 'probe-1';
    if (p?.credential?.kind === 'apiKey' && p.credential.value === INVALID_PROBE_KEY) {
      return {
        probeId, outcome: 'failed', reason: 'credential-rejected',
        detail: 'The provider rejected this key (401).', latencyMs: 80, modelUsed: null,
        checkedAt: '2026-01-01T00:00:00.000Z',
      };
    }
    return {
      probeId, outcome: 'verified', reason: null, detail: null,
      latencyMs: 120, modelUsed: null, checkedAt: '2026-01-01T00:00:00.000Z',
    };
  };
}

/**
 * `license:getStatus` — the Advanced tab's `LicenseStatusCardComponent`
 * (`license-status-card.component.ts:264-266`) never leaves its loading
 * branch without this: `isLoadingLicenseStatus()` is `chatStore.licenseStatus()
 * === null` and nothing else in the app's boot path calls this method.
 */
export const LICENSE_STATUS_FIXTURE = {
  valid: true,
  tier: 'community' as const,
  isPremium: false,
  isCommunity: true,
  daysRemaining: null,
};

/**
 * `llm:getProviderStatus` — the Advanced tab's `VscodeLmConfigComponent`
 * (`vscode-lm-config.component.ts:149-151`) renders nothing until its
 * `vscodeLmProvider` computed finds a `provider: 'vscode-lm'` row here.
 */
export const LLM_PROVIDER_STATUS_FIXTURE = {
  providers: [
    { provider: 'vscode-lm', displayName: 'VS Code Language Model', isConfigured: true, defaultModel: '', capabilities: [] },
  ],
  defaultProvider: 'vscode-lm' as const,
};

/** `llm:listProviderModels` — the model `<select>` options for the card above. */
export const VSCODE_LM_MODELS_FIXTURE = { models: [{ id: 'copilot-gpt-4o', displayName: 'GitHub Copilot GPT-4o' }] };

/** `agent:listCliModels` — delegated-model pickers' option lists. */
export const CLI_MODELS_FIXTURE = {
  codex: [{ id: 'gpt-5.5-codex', name: 'GPT 5.5 Codex' }],
  copilot: [{ id: 'gpt-5.4', name: 'GPT 5.4' }],
  cursor: [{ id: 'cursor-default', name: 'Cursor default' }],
  antigravity: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 Thinking' }],
  opencode: [{ id: 'opencode/nemotron-3-ultra-free', name: 'nemotron-3-ultra-free' }],
  pi: [{ id: 'pi-default', name: 'Pi default' }],
};

// ---------------------------------------------------------------------------
// Stateful write resolvers (code-logic-review Serious #3, batch-16 revision).
//
// `baseMarketplaceFixtures` answers every read with a frozen constant because
// no marketplace scenario writes through this fixture set. Settings is
// different: every present capability that has a Save/Toggle/Create control
// is a write, and the very next assertion in most of those reach steps is
// "the value I just saved is now what reads back" — a stateless `{success:
// true}` stub cannot support that (implementation-plan.md:788, the
// `marketplace.fixtures.ts:969-982` stateful-resolver precedent this batch
// was told to follow). `FixtureState` holds ONE mutable copy per read/write
// pair; every write resolver below mutates it AND appends to `calls` so a
// reach step can assert both "the RPC fired with these params" and "the next
// read reflects it" — the read resolvers close over the SAME object instead
// of the frozen `*_FIXTURE` constants.
// ---------------------------------------------------------------------------

export interface RecordedCall {
  readonly method: string;
  readonly params: unknown;
}

type MutableAgentConfig = typeof AGENT_CONFIG_FIXTURE;
type MutableAuthStatus = typeof AUTH_STATUS_FIXTURE;
type MutablePtahCliAgent = (typeof PTAH_CLI_LIST_FIXTURE)['agents'][number];
type ModelTiers = { sonnet: string | null; opus: string | null; haiku: string | null };

export interface FixtureState {
  readonly calls: RecordedCall[];
  agentConfig: MutableAgentConfig;
  authStatus: MutableAuthStatus;
  effort: string;
  model: string;
  ptahCliAgents: MutablePtahCliAgent[];
  /** `${providerId}:${scope}` -> tiers, mutated by `provider:setModelTier`/`clearModelTier`. */
  readonly modelTiers: Map<string, ModelTiers>;
  /** Scope keys cleared via `config:clearScopeOverride` (read back by `statefulConfigGetScopesResolver`). */
  readonly clearedOverrides: Set<string>;
  /** `provider:listCustomEntries`, mutated by `provider:updateCustomEntry` (Batch 22 drawer Advanced tab). */
  customEntries: Array<(typeof CUSTOM_ENTRIES_FIXTURE)['entries'][number] & Record<string, unknown>>;
  /** Recorded checks by provider id (`auth:checkConnection`), read back as the route's `providers[].lastCheck`. */
  readonly connectionChecks: Map<string, FixtureCheckRecord>;
}

function createFixtureState(): FixtureState {
  return {
    calls: [],
    agentConfig: { ...AGENT_CONFIG_FIXTURE, detectedClis: AGENT_CONFIG_FIXTURE.detectedClis.map((c) => ({ ...c })), disabledClis: [...AGENT_CONFIG_FIXTURE.disabledClis] },
    authStatus: { ...AUTH_STATUS_FIXTURE },
    effort: EFFORT_GET_FIXTURE.effort,
    model: MODEL_GET_FIXTURE.model,
    ptahCliAgents: PTAH_CLI_LIST_FIXTURE.agents.map((a) => ({ ...a })),
    modelTiers: new Map(),
    clearedOverrides: new Set(),
    customEntries: CUSTOM_ENTRIES_FIXTURE.entries.map((entry) => ({ ...entry })),
    // The prototype's Moonshot drawer: "Connected & verified (92ms)", checked in this session (boot time).
    connectionChecks: new Map([['moonshot', { status: 'verified', reason: null, latencyMs: 92, checkedAt: new Date().toISOString() }]]),
  };
}

function record(state: FixtureState, method: string, params: unknown): void {
  state.calls.push({ method, params });
}

function tierKey(providerId: string, scope: string): string {
  return `${providerId}:${scope}`;
}

/** `config:getScopes` resolver, state-aware version of the plain one above. */
function statefulConfigGetScopesResolver(state: FixtureState, workspaceName = 'ptah-e2e-ws-a'): RpcFixtureResolver {
  return (params) => {
    const keys = (params as { keys?: readonly string[] } | null)?.keys ?? [];
    return {
      activePath: `C:\\${workspaceName}`,
      entries: keys.map((key) => {
        const isEffortKey = key.endsWith('.reasoningEffort');
        const hasOverride = isEffortKey && !state.clearedOverrides.has(key);
        return {
          key,
          scope: hasOverride ? 'workspace' : 'global',
          hasOverride,
          effectiveKey: key,
          supportedTargets: ['global', 'app', 'workspace'],
          fallbackPreview: hasOverride ? { scope: 'global', value: null } : null,
          credentialSource: 'not-a-secret',
        };
      }),
    };
  };
}

/**
 * The stateful RPC set for one boot. `getFixtureState(page)` retrieves the
 * SAME `FixtureState` a reach step needs to assert "the write fired" and
 * "the read-back changed" — `bootSettings` registers it against `page`
 * before installing the responder, so both sides of a write/read pair share
 * one mutable object.
 */
function statefulSettingsFixtures(
  state: FixtureState,
  workspaceFolders: readonly string[] = ['C:\\ptah-e2e-ws-a'],
): Record<string, unknown> {
  return {
    'workspace:getInfo': {
      folders: [...workspaceFolders],
      activeFolder: workspaceFolders[0],
    },
    'auth:getAuthStatus': () => ({ ...state.authStatus }),
    'auth:getApiKeyStatus': API_KEY_STATUS_FIXTURE,
    // Each provider carries its recorded check (`lastCheck`), as the host's route read does (28c).
    'auth:getEffectiveRoute': () => ({
      ...EFFECTIVE_ROUTE_FIXTURE,
      providers: EFFECTIVE_ROUTE_FIXTURE.providers.map((provider) => {
        const lastCheck = state.connectionChecks.get(provider.id);
        return lastCheck ? { ...provider, lastCheck } : { ...provider };
      }),
    }),
    'auth:checkConnection': checkConnectionResolver(state),
    'provider:listCustomEntries': () => ({ entries: state.customEntries.map((entry) => ({ ...entry })) }),
    'provider:updateCustomEntry': (params: unknown) => {
      record(state, 'provider:updateCustomEntry', params);
      const p = params as { id: string; changes: Record<string, unknown> };
      const entry = state.customEntries.find((candidate) => candidate.id === p.id);
      if (!entry) return { entry: null };
      Object.assign(entry, p.changes);
      return { entry: { ...entry } };
    },
    'provider:listModels': (params: unknown) => {
      record(state, 'provider:listModels', params);
      return PROVIDER_MODELS_FIXTURE;
    },
    'provider:getModelTiers': (params: unknown) => {
      const p = params as { providerId: string; scope: string };
      return { ...(state.modelTiers.get(tierKey(p.providerId, p.scope)) ?? { sonnet: null, opus: null, haiku: null }) };
    },
    'provider:setModelTier': (params: unknown) => {
      record(state, 'provider:setModelTier', params);
      const p = params as { providerId: string; scope: string; tier: keyof ModelTiers; modelId: string };
      const tiers = state.modelTiers.get(tierKey(p.providerId, p.scope)) ?? { sonnet: null, opus: null, haiku: null };
      tiers[p.tier] = p.modelId;
      state.modelTiers.set(tierKey(p.providerId, p.scope), tiers);
      return { success: true };
    },
    'provider:clearModelTier': (params: unknown) => {
      record(state, 'provider:clearModelTier', params);
      const p = params as { providerId: string; scope: string; tier: keyof ModelTiers };
      const tiers = state.modelTiers.get(tierKey(p.providerId, p.scope)) ?? { sonnet: null, opus: null, haiku: null };
      tiers[p.tier] = null;
      state.modelTiers.set(tierKey(p.providerId, p.scope), tiers);
      return { success: true };
    },
    'llm:getProviderBaseUrl': llmProviderBaseUrlResolver(),
    'auth:verifyDraftConnection': verifyDraftConnectionResolver(),
    'auth:cancelDraftVerification': () => ({ cancelled: true }),
    'config:getScopes': statefulConfigGetScopesResolver(state),
    'config:model-get': () => ({ model: state.model }),
    'config:effort-get': () => ({ effort: state.effort }),
    'memory:getTriggers': MEMORY_TRIGGERS_FIXTURE,
    'skillSynthesis:getLanes': SKILL_LANES_FIXTURE,
    'skillSynthesis:getSettings': SKILL_SYNTHESIS_SETTINGS_FIXTURE,
    'ptahCli:list': () => ({ agents: state.ptahCliAgents }),
    'ptahCli:testConnection': (params: unknown) => {
      record(state, 'ptahCli:testConnection', params);
      return { success: true };
    },
    'settings:get': PTAH_CLI_AGENTS_SETTING_FIXTURE,
    'agent:getConfig': () => ({ ...state.agentConfig }),
    'agent:setConfig': (params: unknown) => {
      record(state, 'agent:setConfig', params);
      Object.assign(state.agentConfig, params as Partial<MutableAgentConfig>);
      return { success: true };
    },
    'agent:detectClis': () => ({ clis: state.agentConfig.detectedClis }),
    'agent:listCliModels': CLI_MODELS_FIXTURE,
    'auth:saveSettings': (params: unknown) => {
      record(state, 'auth:saveSettings', params);
      Object.assign(state.authStatus, params as Partial<MutableAuthStatus>);
      return { success: true };
    },
    'auth:deleteStoredKey': (params: unknown) => {
      record(state, 'auth:deleteStoredKey', params);
      return { success: true };
    },
    'auth:copilotLogout': (params: unknown) => {
      record(state, 'auth:copilotLogout', params);
      state.authStatus.copilotAuthenticated = false;
      return { success: true };
    },
    'provider:removeCustomEntry': (params: unknown) => {
      record(state, 'provider:removeCustomEntry', params);
      return { success: true };
    },
    'config:clearScopeOverride': (params: unknown) => {
      record(state, 'config:clearScopeOverride', params);
      const p = params as { key: string };
      state.clearedOverrides.add(p.key);
      return { success: true, cleared: [p.key], resolvesFrom: 'global' };
    },
    'config:model-switch': (params: unknown) => {
      record(state, 'config:model-switch', params);
      state.model = (params as { model?: string })?.model ?? '';
      return { success: true };
    },
    'config:effort-set': (params: unknown) => {
      record(state, 'config:effort-set', params);
      state.effort = (params as { effort?: string })?.effort ?? '';
      return { effort: state.effort };
    },
    'memory:setTriggers': (params: unknown) => {
      record(state, 'memory:setTriggers', params);
      return { success: true };
    },
    'skillSynthesis:setLanes': (params: unknown) => {
      record(state, 'skillSynthesis:setLanes', params);
      return { success: true };
    },
    'skillSynthesis:updateSettings': (params: unknown) => {
      record(state, 'skillSynthesis:updateSettings', params);
      return { updated: true };
    },
    'ptahCli:create': (params: unknown) => {
      record(state, 'ptahCli:create', params);
      const p = params as { name: string; providerId: string };
      const agent: MutablePtahCliAgent = {
        id: `created-${state.ptahCliAgents.length + 1}`, name: p.name, providerName: p.providerId,
        providerId: p.providerId, hasApiKey: true, hasStoredKey: true, status: 'available', enabled: true, modelCount: 0,
      };
      state.ptahCliAgents.push(agent);
      return { success: true, agent };
    },
    'ptahCli:update': (params: unknown) => {
      record(state, 'ptahCli:update', params);
      const p = params as { id: string } & Partial<MutablePtahCliAgent>;
      const agent = state.ptahCliAgents.find((a) => a.id === p.id);
      if (agent) Object.assign(agent, p);
      return { success: true };
    },
    'ptahCli:delete': (params: unknown) => {
      record(state, 'ptahCli:delete', params);
      const p = params as { id: string };
      state.ptahCliAgents = state.ptahCliAgents.filter((a) => a.id !== p.id);
      return { success: true };
    },
    'settings:export': (params: unknown) => {
      record(state, 'settings:export', params);
      return { success: true };
    },
    'settings:import': (params: unknown) => {
      record(state, 'settings:import', params);
      return { success: true };
    },
    'license:getStatus': LICENSE_STATUS_FIXTURE,
    'llm:getProviderStatus': LLM_PROVIDER_STATUS_FIXTURE,
    'llm:listProviderModels': VSCODE_LM_MODELS_FIXTURE,
  };
}

/**
 * Back-compat export for anything constructing the RPC map directly (none in
 * this batch, kept for the doc comment's own precedent). Prefer
 * `bootSettings` + `getFixtureState(page)`.
 */
export function baseSettingsFixtures(
  workspaceFolders: readonly string[] = ['C:\\ptah-e2e-ws-a'],
): Record<string, unknown> {
  return statefulSettingsFixtures(createFixtureState(), workspaceFolders);
}

/** Every `<h2>`/tab label the reachability spec drives by name. */
export const SETTINGS_TAB_LABELS = ['Providers', 'Agent Orchestration', 'Advanced', 'Search & Voice'] as const;

const stateByPage = new WeakMap<Page, FixtureState>();

/**
 * The `FixtureState` `bootSettings(page, ...)` registered for `page` — reach
 * steps use this to assert a write RPC fired (`state.calls`) and that the
 * next read reflects it (e.g. `state.agentConfig.copilotAutoApprove`).
 * Throws if `bootSettings` was never called on this exact `page` object.
 */
export function getFixtureState(page: Page): FixtureState {
  const state = stateByPage.get(page);
  if (!state) throw new Error('getFixtureState: bootSettings() was never called on this page.');
  return state;
}

/**
 * Boots to chat and enters Settings via SWITCH_VIEW, then waits for the
 * `settings-back` button — settings.component.html has no wrapping shell
 * testid, so the always-present back button is the mount signal, mirroring
 * `marketplace-visual.e2e.spec.ts`'s `boot()`. `overrides` (Batch 36) replaces single RPC answers for this boot.
 */
export async function bootSettings(
  page: Page,
  fixtureUrl: string,
  host: 'electron' | 'vscode',
  theme: 'anubis' | 'anubis-light' = 'anubis',
  overrides: Record<string, unknown> = {},
): Promise<FixtureState> {
  const state = createFixtureState();
  stateByPage.set(page, state);
  await installCspStub(page);
  const bridge = await installPostMessageBridge(page);
  await installHost(page, host, 'chat');
  await installRpcAutoResponder(page, { ...withAdvancedSearchVoice(state, statefulSettingsFixtures(state)), ...overrides });
  await page.addInitScript((t: string) => {
    localStorage.setItem('ptah-theme', t);
  }, theme);
  // Batch 53.6: the app build's `load` takes 2-3 s here, but on a machine at 100 % CPU it was seen past the 15 s
  // navigation default. Boot is setup, not what these tests measure, so it gets 30 s; every assertion keeps its own.
  await page.goto(fixtureUrl, { timeout: 30_000 });
  const readySelector = host === 'electron' ? 'ptah-electron-shell' : 'ptah-app-shell';
  await expect(page.locator(readySelector).first()).toBeVisible();
  await bridge.inject({ type: 'switchView', payload: { view: 'settings' } });
  await expect(page.locator('[data-testid="settings-back"]')).toBeVisible();
  return state;
}

/**
 * Waits for every currently-loading region (`role="status"` "Loading …" rows,
 * daisyUI `.loading-spinner`, and `aria-busy="true"` sections) to leave its
 * transient state — the Settings equivalent of
 * `marketplace-visual.e2e.spec.ts`'s `waitForSettled`. Settings has no
 * skeleton-grid convention of its own; it renders a plain
 * `role="status"`/`aria-live="polite"` "Loading X…" paragraph per read
 * section (`providers-settings.component.ts:66-68`) and `[attr.aria-busy]`
 * on the section wrapper.
 */
export async function waitForSettled(page: Page, scope = page.locator('body')): Promise<void> {
  await expect(
    scope.locator('[aria-busy="true"], .loading-spinner, [data-read-loading]'),
  ).toHaveCount(0);
}

/** Switches the active Settings tab by its visible label (kept-selector check, plan §6 finding 7). */
export async function gotoSettingsTab(
  page: Page,
  label: (typeof SETTINGS_TAB_LABELS)[number],
): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}
