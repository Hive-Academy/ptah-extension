import type {
  AuthGetEffectiveRouteResult,
  AuthSaveSettingsParams,
  AuthVerifyDraftConnectionParams,
  PtahCliConfig,
  RpcMethodParams,
  RpcMethodResult,
  ScopedSettingEntry,
  SettingScope,
  SkillLaneIdDto,
  SkillSynthesisSettingsDto,
  SkillSynthesisSettingsWriteDto,
} from '@ptah-extension/shared';

/**
 * Types of the Providers settings state. The public ones are re-exported by
 * `providers-settings-state.service.ts`, which stays the entry point for consumers.
 */

export interface ProvidersSettingsSection<T> {
  readonly status: 'unloaded' | 'loading' | 'ready' | 'error';
  /** null means not loaded; an empty collection is a successful empty read. */
  readonly data: T | null;
  readonly error: 'Could not load this section. Retry.' | null;
}

/** No raw stored auth method, including in resolver blocker strings. */
export type ProvidersEffectiveRoute = Omit<
  AuthGetEffectiveRouteResult,
  'storedAuthMethodDiagnostic'
>;
export type ProvidersJudgingSettings = Pick<
  SkillSynthesisSettingsDto,
  'judgeProvider' | 'judgeModel' | 'enhanceTimeoutMs'
>;
export type ProvidersJudgingPatch = Partial<
  Pick<
    SkillSynthesisSettingsWriteDto,
    'judgeProvider' | 'judgeModel' | 'enhanceTimeoutMs'
  >
>;
export interface ProvidersEditContext {
  readonly scopeKey: string;
  readonly activePath: string | null;
}
export interface ProvidersSettingsCommit {
  readonly status:
    | 'idle'
    | 'saving'
    | 'saved'
    | 'partial'
    | 'failed'
    | 'unconfirmed'
    | 'blocked';
  readonly saved: readonly string[];
  readonly unsaved: readonly string[];
  /** A rejected/timeout RPC can have written before failing. Never call it rolled back. */
  readonly unconfirmed: readonly string[];
  readonly refreshFailed: boolean;
  readonly message: string | null;
}

/** Per-CLI orchestration fields the Providers page reads and writes. Internal to the state service. */
export type ProvidersOrchestrationField =
  | 'codexModel'
  | 'copilotModel'
  | 'cursorModel'
  | 'antigravityModel'
  | 'opencodeModel'
  | 'piModel'
  | 'codexReasoningEffort'
  | 'copilotReasoningEffort'
  | 'piReasoningEffort';
/** Orchestration policy the CLI matrix writes. Array fields are read back order-sensitively. */
export type ProvidersOrchestrationPolicyField =
  | 'disabledClis'
  | 'preferredAgentOrder'
  | 'maxConcurrentAgents'
  | 'copilotAutoApprove';
export interface ProvidersSettingsPatch {
  readonly auth?: AuthSaveSettingsParams;
  readonly model?: RpcMethodParams<'config:model-switch'>;
  readonly effort?: RpcMethodParams<'config:effort-set'>;
  readonly memory?: { curatorProvider?: string; curatorModel?: string };
  readonly lanes?: Partial<
    Record<SkillLaneIdDto, { provider?: string; model?: string }>
  >;
  readonly judging?: ProvidersJudgingPatch;
  readonly orchestration?: Partial<
    Pick<
      RpcMethodParams<'agent:setConfig'>,
      ProvidersOrchestrationField | ProvidersOrchestrationPolicyField
    >
  >;
  readonly tiers?: readonly RpcMethodParams<'provider:setModelTier'>[];
  readonly cli?: readonly (
    | { action: 'create'; params: RpcMethodParams<'ptahCli:create'> }
    | { action: 'update'; params: RpcMethodParams<'ptahCli:update'> }
    | { action: 'delete'; params: RpcMethodParams<'ptahCli:delete'> }
  )[];
}

/**
 * Orchestration settings the Settings page renders: the per-CLI models and efforts, the CLI
 * matrix inputs, and the Cursor credential flags (never the key). `detectedClis` is the host's
 * last detection; `redetectClis()` refreshes it.
 */
export type ProvidersOrchestration = Pick<
  RpcMethodResult<'agent:getConfig'>,
  | ProvidersOrchestrationField
  | ProvidersOrchestrationPolicyField
  | 'detectedClis'
  | 'cursorApiKeyConfigured'
  | 'cursorApiKeyStored'
  | 'cursorApiKeyEnvSet'
>;
export type ProvidersDetectedClis = RpcMethodResult<'agent:detectClis'>['clis'];
/** Result of the last Ptah CLI connection test. `reason` is the host's sanitized error text only. */
export interface ProvidersCliTest {
  readonly id: string;
  readonly success: boolean;
  readonly latencyMs: number | null;
  readonly reason: string | null;
}
/** Non-secret metadata of a user-defined connection, for its Advanced settings. */
export type ProvidersCustomEntry = Pick<
  RpcMethodResult<'provider:listCustomEntries'>['entries'][number],
  'id' | 'name' | 'baseUrl' | 'lane' | 'modelsEndpoint' | 'helpUrl' | 'pricing'
>;

/** Non-secret connection metadata. Connectivity comes separately from route/probe evidence. */
export interface ProvidersConnection {
  readonly id: string;
  readonly name: string;
  readonly hasKey: boolean;
  readonly configured: boolean;
  readonly custom: boolean;
  readonly defaultsResolvable: boolean;
  readonly authMode: AuthVerifyDraftConnectionParams['authMode'];
  /** Signed-in account shown for GitHub Copilot; null for every other connection or when signed out. */
  readonly accountLabel: string | null;
  /** The OpenAI Codex login exists but its token expired. Always false for other connections. */
  readonly tokenStale: boolean;
}
export type ProvidersCliModels = Readonly<Record<string, Pick<PtahCliConfig, 'selectedModel' | 'tierMappings'>>>;
export type ProvidersMainSources = Readonly<Partial<Record<'model' | 'effort', ScopedSettingEntry>>>;
/** Transient wizard command. The service never retains its credential in a signal. */
export interface ProvidersConnectionDraft {
  readonly providerId: string;
  readonly displayName: string;
  readonly authMode: AuthVerifyDraftConnectionParams['authMode'];
  readonly customName: string | null;
  readonly customProtocol: 'openai' | 'anthropic' | null;
  readonly credential: { kind: 'apiKey'; value: string } | null;
  readonly baseUrl: string | null;
  readonly verified: { readonly probeId: string } | null;
  readonly tiers: { readonly everyday: string; readonly complex: string; readonly fast: string };
  /** Stored main-agent tiers as the wizard loaded them; the compare-and-set baseline for edits. */
  readonly tierSnapshot: { readonly everyday: string | null; readonly complex: string | null; readonly fast: string | null };
  /** Tiers the user changed from the snapshot. Only these are written. */
  readonly editedTiers: readonly ('everyday' | 'complex' | 'fast')[];
  readonly saveTo: SettingScope;
  readonly activation: 'connect-only' | 'use-main-agent';
}
export type ProvidersExternalAuthAction = 'sign-in' | 'sign-in-cancel' | 'cli-login' | 'cli-check';
export interface ProvidersExternalAuth {
  readonly providerId: string | null;
  readonly signInState: 'idle' | 'in-flight' | 'signed-in' | 'failed';
  readonly accountLabel: string | null;
  readonly cliInstalled: boolean | null;
  readonly message: string | null;
}

/**
 * Dependency stage of a connection-setup write. An operation without a stage is independent.
 * - `setup` (credential, endpoint, custom entry) is skipped when an earlier `setup` write did not save.
 * - `tier` is skipped only when a `setup` write did not save, never because another tier conflicted.
 * - `activation` is skipped when any earlier write did not save, including a tier conflict.
 * Internal to the state service.
 */
export type SaveStage = 'setup' | 'tier' | 'activation';
/** One write of a commit. Internal to the state service. */
export interface SaveOperation {
  readonly fields: readonly string[];
  /**
   * `true`: the host acknowledged the write. `false`: the host rejected it, nothing to confirm.
   * `'conflict'`: nothing was written because the stored value changed since the draft was read.
   * A throw means the write may or may not have landed.
   */
  readonly write: () => Promise<boolean | 'conflict'>;
  /** Runs only after an acknowledged write; it can confirm or refute it, never rescue a failed one. */
  readonly readBack?: () => Promise<boolean>;
  readonly stage?: SaveStage;
}
export type SaveOutcome = 'saved' | 'unsaved' | 'unconfirmed' | 'conflict';
