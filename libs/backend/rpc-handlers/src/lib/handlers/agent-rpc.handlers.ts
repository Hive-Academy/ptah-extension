/**
 * Agent Orchestration RPC Handlers.
 *
 * Owns the `agent:*` namespace on every host:
 * - agent:getConfig / agent:setConfig — orchestration config via IWorkspaceProvider.
 *   Decision-model fields delegate to DECISION_MODEL_CONFIG (lane-routing).
 * - agent:detectClis / agent:listCliModels — rival-CLI detection and models
 * - agent:permissionResponse — routes decisions to the SDK + Copilot bridges
 * - agent:stop / agent:continue / agent:resumeCliSession — process control
 *
 * Unified from three byte-for-byte-equivalent copies (VS Code, Electron,
 * cli-engine). Electron's implementation is the base; the only host-specific
 * behaviour left is Copilot model discovery, which goes through
 * {@link IModelDiscovery} — VS Code's adapter queries the editor's Language
 * Model API, the other hosts return nothing and the curated CLI list is used.
 */

import { injectable, inject, type DependencyContainer } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type {
  IAuthSecretsService,
  Logger,
  RpcHandler,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  SettingsPersistError,
} from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IPlatformInfo,
  IWorkspaceProvider,
  IStateStorage,
} from '@ptah-extension/platform-core';
import {
  CliDetectionService,
  CopilotPermissionBridge,
  AgentProcessManager,
  AgentContinueError,
  LaneAccountResumeError,
  CLI_AGENT_RUNTIME_TOKENS,
  PtahCliRegistry,
  PTAH_CLI_ROLE_DELIVERY,
  MIN_CONCURRENT_AGENTS,
  MAX_CONCURRENT_AGENTS,
} from '@ptah-extension/cli-agent-runtime';
import {
  CLAUDE_BUILTIN_TERMINAL_SKILLS,
  CLAUDE_BUILTIN_TERMINAL_SKILL_IDS,
  CLAUDE_BUILTIN_TOOLS,
  CLAUDE_BUILTIN_TOOL_IDS,
  SDK_TOKENS,
  SessionMetadataStore,
  SdkPermissionHandler,
  isSyncedClaudeSkillId,
  normalizeClaudeBuiltinIds,
  readClaudeBuiltinOptIns,
  readSyncedClaudeSkills,
  resolveClaudeConfigDir,
  resolveSessionCapabilityPolicy,
  type SyncedClaudeSkill,
} from '@ptah-extension/agent-sdk';
import {
  DecisionModelSelectionSchema,
  LANE_ROUTING_TOKENS,
  type DecisionModelConfig,
  type DecisionModelLocality,
  type DecisionModelSelection,
  type DecisionModelStatusDto,
} from '@ptah-extension/lane-routing';
import { z } from 'zod';
import type {
  AuthEnv,
  AgentGetClaudeBuiltinsParams,
  AgentGetClaudeBuiltinsResult,
  AgentSetClaudeBuiltinParams,
  AgentSetClaudeBuiltinResult,
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  CapabilityPolicyStatus,
  ICapabilityResolver,
  AgentListCliModelsResult,
  AgentPermissionDecision,
  AgentContinueErrorCode,
  AgentResumeOutcome,
  CliDetectionResult,
  CliType,
  SpawnAgentResult,
  ISdkPermissionHandler,
  PermissionResponse,
  SessionId,
  SubagentPromptCacheTtlSetting,
  TabId,
  ProviderAccountBindingPresence,
  ProviderAccountResultCode,
  ProviderAccountSelection,
} from '@ptah-extension/shared';
import {
  PROVIDER_ACCOUNT_RESULT_CODES,
  CLI_REASONING_EFFORT_VALUES,
  CLAUDE_REASONING_EFFORT_VALUES,
  PI_REASONING_EFFORT_VALUES,
  classifyAgentResumeAccountSelection,
  SUBAGENT_PROMPT_CACHE_TTL_SETTINGS,
  resolveSubagentPromptCacheTtl,
  DECISION_MODEL_INVALID_BASE_URL,
  DECISION_MODEL_INVALID_MODEL,
} from '@ptah-extension/shared';
import { classifyProviderAccountBinding } from '@ptah-extension/shared/schemas';
import {
  AUTH_PROVIDERS_TOKENS,
  ProviderAccountService,
} from '@ptah-extension/auth-providers';
import { AgentResumeCliSessionParamsSchema } from './agent-rpc.schema';
import {
  DecisionModelWriter,
  type DecisionKeyWrite,
} from './decision-model-writer';
import { CliModelListService } from '../services/cli-model-list.service';
import { resolveSessionFolder } from '../chat/session/session-folder';

/** `agent:setConfig` keys that hold a Claude built-in opt-in list (TASK_2026_853). */
const CLAUDE_BUILTIN_OPT_IN_KEYS = [
  'enabledClaudeBuiltinTools',
  'enabledClaudeBuiltinSkills',
] as const satisfies readonly (keyof AgentSetConfigParams)[];

/** The first Claude built-in opt-in field that is present but not a string array, or null. */
function invalidClaudeBuiltinOptIns(
  params: AgentSetConfigParams,
): string | null {
  const isStringArray = (value: unknown): boolean =>
    Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  return (
    CLAUDE_BUILTIN_OPT_IN_KEYS.find(
      (key) => params[key] !== undefined && !isStringArray(params[key]),
    ) ?? null
  );
}

/** `agent:setConfig` keys that hold one CLI's model id. Written in this order. */
const CLI_MODEL_KEYS = [
  'codexModel',
  'copilotModel',
  'cursorModel',
  'antigravityModel',
  'grokModel',
  'opencodeModel',
  'piModel',
  'claudeModel',
] as const satisfies readonly (keyof AgentSetConfigParams)[];

/** The first CLI model field that is present but not a string, or null. */
function invalidCliModel(params: AgentSetConfigParams): string | null {
  return (
    CLI_MODEL_KEYS.find(
      (key) => params[key] !== undefined && typeof params[key] !== 'string',
    ) ?? null
  );
}

/**
 * Host-boundary allowlist for reasoning-effort writes. Pi's value reaches
 * `pi --thinking` unchanged, so an unsupported value must never be persisted.
 * Returns the first invalid field, or null.
 */
function invalidReasoningEffort(params: AgentSetConfigParams): string | null {
  const checks: ReadonlyArray<[keyof AgentSetConfigParams, readonly string[]]> =
    [
      ['codexReasoningEffort', CLI_REASONING_EFFORT_VALUES],
      ['copilotReasoningEffort', CLI_REASONING_EFFORT_VALUES],
      ['grokReasoningEffort', CLI_REASONING_EFFORT_VALUES],
      ['antigravityReasoningEffort', CLI_REASONING_EFFORT_VALUES],
      ['piReasoningEffort', PI_REASONING_EFFORT_VALUES],
      ['claudeReasoningEffort', CLAUDE_REASONING_EFFORT_VALUES],
    ];
  for (const [field, allowed] of checks) {
    const value = params[field];
    if (
      value !== undefined &&
      (typeof value !== 'string' || !allowed.includes(value))
    ) {
      return field;
    }
  }
  return null;
}

/** Codex lane token budgets: integers >= 0, where 0 = Codex runtime default. */
const CODEX_BUDGET_TOKEN_FIELDS = [
  'codexAutoCompactTokens',
  'codexToolOutputTokenLimit',
] as const;

type CodexBudgetTokenField = (typeof CODEX_BUDGET_TOKEN_FIELDS)[number];

/**
 * Read-side defaults for the Codex lane budget keys. Mirrors
 * `FILE_BASED_SETTINGS_DEFAULTS` in `platform-core`; the set-config spec pins
 * the two against each other.
 */
const CODEX_BUDGET_DEFAULTS: Readonly<
  Record<CodexBudgetTokenField, number> & { codexWebSearch: boolean }
> = {
  codexAutoCompactTokens: 120000,
  codexToolOutputTokenLimit: 2500,
  codexWebSearch: true,
};

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Host-boundary check for the Codex lane budget writes. An invalid value is
 * rejected with its field name and never clamped, so the user sees exactly
 * which setting was refused. Returns the first invalid field, or null.
 */
function invalidCodexBudget(params: AgentSetConfigParams): string | null {
  for (const field of CODEX_BUDGET_TOKEN_FIELDS) {
    const value: unknown = params[field];
    if (value !== undefined && !isNonNegativeInteger(value)) {
      return field;
    }
  }
  const webSearch: unknown = params.codexWebSearch;
  if (webSearch !== undefined && typeof webSearch !== 'boolean') {
    return 'codexWebSearch';
  }
  return null;
}

/** `-0` passes the integer check; it is persisted as `0`. */
function withoutNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/** Lane tool-call guards: steer at N calls, stop at N calls, stop at N identical calls. */
const LANE_GUARD_FIELDS = [
  'laneToolCallSteerAt',
  'laneToolCallStopAt',
  'laneRepeatCallStopAt',
] as const;

type LaneGuardField = (typeof LANE_GUARD_FIELDS)[number];

/**
 * Read-side defaults for the lane guard keys. Mirrors
 * `FILE_BASED_SETTINGS_DEFAULTS` in `platform-core`; the set-config spec pins
 * the two against each other.
 */
const LANE_GUARD_DEFAULTS: Readonly<Record<LaneGuardField, number>> = {
  laneToolCallSteerAt: 40,
  laneToolCallStopAt: 60,
  laneRepeatCallStopAt: 20,
};

/**
 * Smallest value each guard accepts on its own: steer >= 1, repeat >= 2, and
 * stop >= 2 because it must also exceed steer (checked as a pair below).
 */
const LANE_GUARD_MINIMUMS: Readonly<Record<LaneGuardField, number>> = {
  laneToolCallSteerAt: 1,
  laneToolCallStopAt: 2,
  laneRepeatCallStopAt: 2,
};

function isLaneGuardValue(
  field: LaneGuardField,
  value: unknown,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= LANE_GUARD_MINIMUMS[field]
  );
}

/**
 * Host-boundary check for the lane guard writes, rejected with the field name
 * and never clamped. Stop must exceed steer; a write that changes only one of
 * the pair is checked against the stored value of the other (`readStored`).
 * Returns the first invalid field, or null.
 */
function invalidLaneGuard(
  params: AgentSetConfigParams,
  readStored: (field: LaneGuardField) => number,
): string | null {
  for (const field of LANE_GUARD_FIELDS) {
    const value: unknown = params[field];
    if (value !== undefined && !isLaneGuardValue(field, value)) {
      return field;
    }
  }
  const { laneToolCallSteerAt: steer, laneToolCallStopAt: stop } = params;
  if (steer === undefined && stop === undefined) return null;
  const effectiveSteer = steer ?? readStored('laneToolCallSteerAt');
  const effectiveStop = stop ?? readStored('laneToolCallStopAt');
  if (effectiveStop <= effectiveSteer) {
    return stop === undefined ? 'laneToolCallSteerAt' : 'laneToolCallStopAt';
  }
  return null;
}

/**
 * Order for writing the lane guard keys of an already-validated request. The
 * settings store writes one key at a time, so when both steer and stop change
 * the stored pair must stay valid (stop > steer) between the two writes: stop
 * goes first when the new stop already exceeds the stored steer (raising
 * both), else steer goes first (lowering both). One of the two always holds,
 * because both the stored and the requested pair are valid.
 */
function laneGuardWriteOrder(
  params: AgentSetConfigParams,
  readStored: (field: LaneGuardField) => number,
): readonly LaneGuardField[] {
  const stop = params.laneToolCallStopAt;
  const stopFirst =
    params.laneToolCallSteerAt === undefined ||
    stop === undefined ||
    stop > readStored('laneToolCallSteerAt');
  return stopFirst
    ? ['laneToolCallStopAt', 'laneToolCallSteerAt', 'laneRepeatCallStopAt']
    : ['laneToolCallSteerAt', 'laneToolCallStopAt', 'laneRepeatCallStopAt'];
}

/** Host env var that overrides the subagent prompt-cache TTL inside the SDK. */
const SUBAGENT_PROMPT_CACHE_TTL_ENV = 'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL';

function isSubagentPromptCacheTtlSetting(
  value: unknown,
): value is SubagentPromptCacheTtlSetting {
  return (SUBAGENT_PROMPT_CACHE_TTL_SETTINGS as readonly unknown[]).includes(
    value,
  );
}

/**
 * Fixed `detail` texts for a decision-model row whose status read failed.
 * Never the raw error: provider and storage errors can carry paths or
 * credentials. The real Error goes to the host log only.
 */
const DECISION_STATUS_UNREAD_DETAIL =
  'The status could not be read. The saved choice is unchanged.';
const DECISION_SELECTION_UNREAD_DETAIL =
  'The saved decision model could not be read. It is unchanged.';

/** Kinds whose refused fields get a field-named save error (DC12). */
const ENDPOINT_DECISION_KINDS: ReadonlySet<unknown> = new Set([
  'ollama-cloud',
  'custom',
]);

/**
 * The fixed `agent:setConfig` error for a refused decision-model selection.
 * For an `ollama-cloud` or `custom` selection the first refused field picks
 * the field-named constant the settings row shows next to that field; every
 * other refusal keeps the generic text. Never the issue text, which is built
 * from what the user typed.
 */
function decisionModelRefusal(
  input: unknown,
  issues: ReadonlyArray<{ readonly path: readonly PropertyKey[] }>,
): string {
  const kind =
    typeof input === 'object' && input !== null && 'kind' in input
      ? input.kind
      : undefined;
  if (ENDPOINT_DECISION_KINDS.has(kind)) {
    const fields = new Set(issues.map((issue) => issue.path[0]));
    if (fields.has('baseUrl')) return DECISION_MODEL_INVALID_BASE_URL;
    if (fields.has('model')) return DECISION_MODEL_INVALID_MODEL;
  }
  return 'Unsupported decisionModel value';
}

/**
 * The reply text when the runtime refuses a `claude` lane's named account on
 * continue or resume. Fixed: the thrown text and the refusal code stay in the
 * host log, so no path, email, secret or CLI output reaches the caller.
 */
const LANE_ACCOUNT_REFUSED_ERROR =
  'The Claude account for this agent was refused. The agent did not run on another account.';

/**
 * The refusal code of a `LaneAccountResumeError` (cli-agent-runtime
 * `lane-resume-gate.ts`) for the host log, or undefined for any other error.
 * The class already narrows its code to the provider-account whitelist; a
 * code outside it is logged as `unavailable-storage`, the class's own default.
 */
function laneAccountRefusalCode(
  error: unknown,
): Exclude<ProviderAccountResultCode, 'ok'> | undefined {
  if (!(error instanceof LaneAccountResumeError)) return undefined;
  return (
    PROVIDER_ACCOUNT_RESULT_CODES.find(
      (known): known is Exclude<ProviderAccountResultCode, 'ok'> =>
        known !== 'ok' && known === error.code,
    ) ?? 'unavailable-storage'
  );
}

/**
 * `agent:resumeCliSession` error text for a refused account. Built from a
 * whitelisted refusal code only, never from thrown text, which can carry a
 * path.
 */
function resumeAccountRefusal(
  code: Exclude<ProviderAccountResultCode, 'ok'>,
): string {
  return `Agent resume account refused (${code}).`;
}

/**
 * The account selection a `claude` resume forwards into its spawn request,
 * after `resumeAccountRefusal` returned no refusal (so it matches the stored
 * binding). A restated named selection is forwarded as-is; the runtime
 * resumes it on the stored binding without a second binding or lease.
 * Other CLIs have no account bindings and never carry a selection.
 */
function resumeSpawnAccountSelection(
  cli: CliType,
  selection: ProviderAccountSelection | undefined,
): ProviderAccountSelection | undefined {
  return cli === 'claude' ? selection : undefined;
}

/** Wire shape of `agent:setClaudeBuiltin`; ids are checked against the catalog. */
const SetClaudeBuiltinParamsSchema = z.object({
  kind: z.enum(['tool', 'skill']),
  id: z.string().min(1),
  enabled: z.boolean(),
});

@injectable()
export class AgentRpcHandlers {
  /**
   * Method names registered against the global `RpcHandler`. Order matches
   * `register()` invocation order.
   */
  static readonly METHODS = [
    'agent:getConfig',
    'agent:setConfig',
    'agent:getClaudeBuiltins',
    'agent:setClaudeBuiltin',
    'agent:detectClis',
    'agent:listCliModels',
    'agent:permissionResponse',
    'agent:e2eSeedPermission',
    'agent:stop',
    'agent:continue',
    'agent:resumeCliSession',
  ] as const;

  /**
   * Tail of the settings-write chain shared by `agent:setConfig` and
   * `agent:setClaudeBuiltin`; settles, never rejects.
   */
  private setConfigQueue: Promise<void> = Promise.resolve();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry,
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agentProcessManager: AgentProcessManager,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.STATE_STORAGE)
    private readonly stateStorage: IStateStorage,
    @inject(CliModelListService)
    private readonly cliModelList: CliModelListService,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly runtimeContainer: DependencyContainer,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystemProvider: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
    /** Registered by `registerLaneRoutingServices` (Batch 21). */
    @inject(LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG)
    private readonly decisionModelConfig: Pick<
      DecisionModelConfig,
      'getStatus' | 'getSelection' | 'localityOf' | 'setSelection' | 'keys'
    >,
  ) {
    this.decisionModelWriter = new DecisionModelWriter(
      decisionModelConfig,
      logger,
    );
  }

  /** Decision-model selection and key writes, with rollback (Component 9). */
  private readonly decisionModelWriter: DecisionModelWriter;

  register(): void {
    void this.migrateAgentOrchestrationSettings();

    this.registerGetConfig();
    this.registerSetConfig();
    this.registerGetClaudeBuiltins();
    this.registerSetClaudeBuiltin();
    this.registerDetectClis();
    this.registerListCliModels();
    this.registerPermissionResponse();
    this.registerE2eSeedPermission();
    this.registerAgentStop();
    this.registerAgentContinue();
    this.registerResumeCliSession();
    const copilotAutoApprove = this.getAgentCfg<boolean>(
      'copilotAutoApprove',
      true,
    );
    const copilotAdapter = this.cliDetection.getAdapter('copilot');
    if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
      const bridge = (
        copilotAdapter as { permissionBridge: CopilotPermissionBridge }
      ).permissionBridge;
      bridge.setAutoApprove(copilotAutoApprove);
    }

    this.logger.debug('Agent RPC handlers registered', {
      methods: [
        'agent:getConfig',
        'agent:setConfig',
        'agent:getClaudeBuiltins',
        'agent:setClaudeBuiltin',
        'agent:detectClis',
        'agent:listCliModels',
        'agent:permissionResponse',
        'agent:e2eSeedPermission',
        'agent:stop',
        'agent:continue',
        'agent:resumeCliSession',
      ],
    });
  }

  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<void, AgentOrchestrationConfig>(
      'agent:getConfig',
      async () => {
        try {
          this.logger.debug('RPC: agent:getConfig called');

          const cliResults = await this.cliDetection.detectAll();
          const detectedClis = await this.mergePtahCliAgents(cliResults);
          const cursorKey = await this.getCursorApiKeyStatus();

          const result: AgentOrchestrationConfig = {
            detectedClis,
            preferredAgentOrder: this.getAgentCfg<string[]>(
              'preferredAgentOrder',
              [],
            ),
            maxConcurrentAgents: this.getAgentCfg<number>(
              'maxConcurrentAgents',
              5,
            ),
            codexModel: this.getAgentCfg<string>('codexModel', ''),
            copilotModel: this.getAgentCfg<string>('copilotModel', ''),
            cursorModel: this.getAgentCfg<string>('cursorModel', ''),
            antigravityModel: this.getAgentCfg<string>('antigravityModel', ''),
            grokModel: this.getAgentCfg<string>('grokModel', ''),
            opencodeModel: this.getAgentCfg<string>('opencodeModel', ''),
            piModel: this.getAgentCfg<string>('piModel', ''),
            claudeModel: this.getAgentCfg<string>('claudeModel', ''),
            cursorApiKeyConfigured: cursorKey.configured,
            cursorApiKeyStored: cursorKey.stored,
            cursorApiKeyEnvSet: cursorKey.envSet,
            codexAutoApprove: this.getAgentCfg<boolean>(
              'codexAutoApprove',
              true,
            ),
            copilotAutoApprove: this.getAgentCfg<boolean>(
              'copilotAutoApprove',
              true,
            ),
            codexReasoningEffort: this.getAgentCfg<string>(
              'codexReasoningEffort',
              '',
            ),
            codexAutoCompactTokens: this.getCodexBudgetTokens(
              'codexAutoCompactTokens',
            ),
            codexToolOutputTokenLimit: this.getCodexBudgetTokens(
              'codexToolOutputTokenLimit',
            ),
            codexWebSearch: this.getCodexWebSearch(),
            laneToolCallSteerAt: this.getLaneGuard('laneToolCallSteerAt'),
            laneToolCallStopAt: this.getLaneGuard('laneToolCallStopAt'),
            laneRepeatCallStopAt: this.getLaneGuard('laneRepeatCallStopAt'),
            ...this.getSubagentPromptCacheTtl(),
            copilotReasoningEffort: this.getAgentCfg<string>(
              'copilotReasoningEffort',
              '',
            ),
            grokReasoningEffort: this.getAgentCfg<string>(
              'grokReasoningEffort',
              '',
            ),
            antigravityReasoningEffort: this.getAgentCfg<string>(
              'antigravityReasoningEffort',
              '',
            ),
            piReasoningEffort: this.getAgentCfg<string>(
              'piReasoningEffort',
              '',
            ),
            claudeReasoningEffort: this.getAgentCfg<string>(
              'claudeReasoningEffort',
              '',
            ),
            mcpPort:
              this.stateStorage.get<number>(
                'agentOrchestration.mcpPort',
                51820,
              ) ?? 51820,
            disabledClis: this.getAgentCfg<string[]>('disabledClis', []),
            disabledMcpNamespaces: this.getAgentCfg<string[]>(
              'disabledMcpNamespaces',
              [],
            ),
            browserAllowLocalhost:
              this.workspace.getConfiguration<boolean>(
                'ptah',
                'browser.allowLocalhost',
                false,
              ) ?? false,
            workflowsDisabled:
              this.workspace.getConfiguration<boolean>(
                'ptah',
                'workflows.disabled',
                false,
              ) ?? false,
            ...this.getClaudeBuiltinOptIns(),
            decisionModel: await this.readDecisionModelStatus(),
          };

          this.logger.debug('RPC: agent:getConfig success', {
            cliCount: detectedClis.length,
            installedCount: detectedClis.filter((c) => c.installed).length,
          });

          return result;
        } catch (error) {
          this.logger.error(
            'RPC: agent:getConfig failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  /**
   * `agent:getClaudeBuiltins` — the Claude built-in catalog (TASK_2026_853),
   * the stored opt-ins and the active workspace's capability-policy status.
   * Read failures propagate, so the UI shows its load error instead of an
   * all-off list it could then save over the stored one.
   */
  private registerGetClaudeBuiltins(): void {
    this.rpcHandler.registerMethod<
      AgentGetClaudeBuiltinsParams,
      AgentGetClaudeBuiltinsResult
    >('agent:getClaudeBuiltins', async () => {
      const optIns = this.getClaudeBuiltinOptIns();
      const [syncedSkills, policyStatus] = await Promise.all([
        this.readSyncedSkills(),
        this.activeCapabilityPolicyStatus(),
      ]);
      return {
        tools: CLAUDE_BUILTIN_TOOLS.map((row) => ({
          id: row.id,
          description: row.description,
          approxTokens: row.approxTokens,
          skillsNeedingIt: [...row.skillsNeedingIt],
        })),
        terminalSkills: CLAUDE_BUILTIN_TERMINAL_SKILLS.map((row) => ({
          id: row.id,
          description: row.description,
          approxTokens: row.approxTokens,
          ...(row.needsTool === undefined ? {} : { needsTool: row.needsTool }),
        })),
        // The account-synced skills a new main session would list, under
        // their qualified `anthropic-skills:<name>` ids (Phase B).
        syncedSkills: syncedSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          approxTokens: skill.approxTokens,
        })),
        enabledTools: optIns.enabledClaudeBuiltinTools,
        enabledSkills: optIns.enabledClaudeBuiltinSkills,
        policyStatus,
      };
    });
  }

  /**
   * `agent:setClaudeBuiltin` — turn ONE catalog tool or skill on or off
   * (TASK_2026_853, review fix R2). A whole-array `agent:setConfig` write
   * from a window that read before another window's change would drop that
   * change; this method instead changes only its own id in the list as
   * stored at write time. Calls join the `agent:setConfig` chain, so no
   * other settings write runs between the read and the write. Never rejects.
   */
  private registerSetClaudeBuiltin(): void {
    this.rpcHandler.registerMethod<
      AgentSetClaudeBuiltinParams,
      AgentSetClaudeBuiltinResult
    >('agent:setClaudeBuiltin', (params) => {
      const run = this.setConfigQueue.then(() =>
        this.applySetClaudeBuiltin(params),
      );
      this.setConfigQueue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });
  }

  /** Validate and apply one per-item change. Run only through the queue. */
  private async applySetClaudeBuiltin(
    params: unknown,
  ): Promise<AgentSetClaudeBuiltinResult> {
    const parsed = SetClaudeBuiltinParamsSchema.safeParse(params);
    if (!parsed.success) {
      return this.claudeBuiltinFailure('Unsupported Claude built-in change.');
    }
    const { kind, id, enabled } = parsed.data;
    // A skill id is a terminal skill or a synced skill the reader finds now
    // for the main session's config dir (decision #37).
    const catalog =
      kind === 'tool'
        ? CLAUDE_BUILTIN_TOOL_IDS
        : await this.knownClaudeSkillIds();
    if (!catalog.includes(id)) {
      return this.claudeBuiltinFailure('Unknown Claude built-in.');
    }
    try {
      const key =
        kind === 'tool'
          ? 'enabledClaudeBuiltinTools'
          : 'enabledClaudeBuiltinSkills';
      // Read and compute synchronously; the write is the only await. The
      // read keeps stored synced opt-ins the reader does not find now (for
      // example another account's), so this write never drops them.
      const stored = this.getClaudeBuiltinOptIns()[key];
      const next = normalizeClaudeBuiltinIds(
        enabled ? [...stored, id] : stored.filter((entry) => entry !== id),
        [...catalog, ...stored],
      );
      await this.setAgentCfg(key, next);
      const after = this.getClaudeBuiltinOptIns();
      return {
        success: true,
        enabledTools: after.enabledClaudeBuiltinTools,
        enabledSkills: after.enabledClaudeBuiltinSkills,
      };
    } catch (error: unknown) {
      // Settings errors can carry paths; log the type, return fixed text.
      this.logger.error('RPC: agent:setClaudeBuiltin failed', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return this.claudeBuiltinFailure(
        error instanceof SettingsPersistError
          ? error.message
          : 'Could not save the Claude built-in setting.',
      );
    }
  }

  /**
   * A failed `agent:setClaudeBuiltin` result carrying the lists as stored
   * now, or empty lists when even that read fails.
   */
  private claudeBuiltinFailure(error: string): AgentSetClaudeBuiltinResult {
    try {
      const stored = this.getClaudeBuiltinOptIns();
      return {
        success: false,
        enabledTools: stored.enabledClaudeBuiltinTools,
        enabledSkills: stored.enabledClaudeBuiltinSkills,
        error,
      };
    } catch {
      return { success: false, enabledTools: [], enabledSkills: [], error };
    }
  }

  /**
   * The stored Claude built-in opt-ins: tools kept to the catalog, skills
   * kept to the terminal catalog plus every qualified synced id
   * (`anthropic-skills:<name>`), which the session build reads from the same
   * list. A malformed hand-edited value reads as `[]`, the same value a
   * session build uses.
   */
  private getClaudeBuiltinOptIns(): Pick<
    AgentOrchestrationConfig,
    'enabledClaudeBuiltinTools' | 'enabledClaudeBuiltinSkills'
  > {
    const skills = readClaudeBuiltinOptIns(
      this.getAgentCfg<unknown>('enabledClaudeBuiltinSkills', []),
    );
    return {
      enabledClaudeBuiltinTools: normalizeClaudeBuiltinIds(
        readClaudeBuiltinOptIns(
          this.getAgentCfg<unknown>('enabledClaudeBuiltinTools', []),
        ),
        CLAUDE_BUILTIN_TOOL_IDS,
      ),
      enabledClaudeBuiltinSkills: normalizeClaudeBuiltinIds(skills, [
        ...CLAUDE_BUILTIN_TERMINAL_SKILL_IDS,
        ...skills.filter(isSyncedClaudeSkillId),
      ]),
    };
  }

  /**
   * The config dir a new main session's Claude child reads, in the order
   * `SdkQueryOptionsBuilder` uses for a session without a named launch: the
   * auth env, then the host env, then `~/.claude` (decision #42). The
   * settings card serves no named launch, so that branch does not apply.
   */
  private mainSessionClaudeConfigDir(): string {
    const authEnv = this.runtimeContainer.isRegistered(
      AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV,
      true,
    )
      ? this.runtimeContainer.resolve<AuthEnv>(
          AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV,
        )
      : undefined;
    return resolveClaudeConfigDir([authEnv, process.env]);
  }

  /** The account-synced skills for that config dir; `[]` on any read error. */
  private readSyncedSkills(): Promise<SyncedClaudeSkill[]> {
    return readSyncedClaudeSkills(
      this.mainSessionClaudeConfigDir(),
      this.logger,
    );
  }

  /** Skill ids a write may store: the terminal catalog plus the synced skills found now. */
  private async knownClaudeSkillIds(): Promise<string[]> {
    return [
      ...CLAUDE_BUILTIN_TERMINAL_SKILL_IDS,
      ...(await this.readSyncedSkills()).map((skill) => skill.id),
    ];
  }

  /**
   * The capability-policy status a session in the active workspace would get:
   * the same resolver and the same never-throwing, never-widening resolution
   * `SessionQueryExecutor` uses. No workspace, or no registered resolver,
   * is `unverified`, exactly as a session build treats it.
   */
  private async activeCapabilityPolicyStatus(): Promise<CapabilityPolicyStatus> {
    // eslint-disable-next-line no-restricted-properties -- a settings read with no session; it reports what a NEW session in the active workspace would get
    const root = this.workspace.getWorkspaceRoot();
    if (!root) return 'unverified';
    const resolver = this.runtimeContainer.isRegistered(
      SDK_TOKENS.SDK_CAPABILITY_RESOLVER,
      true,
    )
      ? this.runtimeContainer.resolve<ICapabilityResolver>(
          SDK_TOKENS.SDK_CAPABILITY_RESOLVER,
        )
      : null;
    const policy = await resolveSessionCapabilityPolicy(
      resolver,
      root,
      this.logger,
    );
    return policy.status;
  }

  /**
   * The `decisionModel` field of `agent:getConfig`. A status failure stays
   * local to this field, so the rest of the config is still returned. The
   * fallback reads the stored selection without the probe and reports it as
   * `unreachable` with fixed detail; a stored `unset` stays `unset`, since an
   * unset selection sends no request that could be unreachable.
   */
  private async readDecisionModelStatus(): Promise<DecisionModelStatusDto> {
    try {
      return await this.decisionModelConfig.getStatus();
    } catch (error: unknown) {
      this.logger.error(
        'RPC: agent:getConfig decision model status failed; returning the stored selection',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    let selection: DecisionModelSelection;
    try {
      selection = this.decisionModelConfig.getSelection();
    } catch (error: unknown) {
      this.logger.error(
        'RPC: agent:getConfig decision model selection could not be read',
        error instanceof Error ? error : new Error(String(error)),
      );
      // No `unknown` selection exists in the contract (decision #46), so the
      // row reads as unset with the fixed "could not be read" detail. Loading
      // never writes: only a user save changes the stored selection.
      return {
        selection: { kind: 'unset' },
        locality: null,
        reportsConfidence: false,
        state: 'unreachable',
        detail: DECISION_SELECTION_UNREAD_DETAIL,
      };
    }
    if (selection.kind === 'unset') {
      return {
        selection,
        locality: null,
        reportsConfidence: false,
        state: 'unset',
        detail: null,
      };
    }
    let locality: DecisionModelLocality | null = null;
    try {
      locality = this.decisionModelConfig.localityOf(selection);
    } catch (error: unknown) {
      // The row stays readable without a locality line; the cause is logged.
      this.logger.warn(
        'RPC: agent:getConfig decision model locality could not be read',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return {
      selection,
      locality,
      // Same rule as the service's status rows: every System One kind
      // reports a confidence; structured reports none.
      reportsConfidence: selection.kind !== 'structured',
      state: 'unreachable',
      detail: DECISION_STATUS_UNREAD_DETAIL,
    };
  }

  private registerSetConfig(): void {
    this.rpcHandler.registerMethod<
      AgentSetConfigParams,
      { success: boolean; error?: string }
    >('agent:setConfig', (params) => {
      // One call at a time: validation reads stored values and the writes
      // await one key after another, so two overlapping calls could leave a
      // stop <= steer pair. Each call waits for the previous one to settle.
      const run = this.setConfigQueue.then(() => this.applySetConfig(params));
      this.setConfigQueue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });
  }

  /**
   * Validate and write one `agent:setConfig` request. Never rejects: every
   * failure becomes `{ success: false, error }`. Run only through
   * {@link setConfigQueue}.
   */
  private async applySetConfig(
    params: AgentSetConfigParams,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Field names only: params can carry credentials such as cursorApiKey.
      this.logger.debug('RPC: agent:setConfig called', {
        fields: Object.keys(params ?? {}),
      });
      // Validate before ANY write so a rejected request changes nothing.
      if (
        params.cursorApiKey !== undefined &&
        typeof params.cursorApiKey !== 'string'
      ) {
        return { success: false, error: 'Unsupported cursorApiKey value' };
      }
      if (
        params.decisionModelJevApiKey !== undefined &&
        typeof params.decisionModelJevApiKey !== 'string'
      ) {
        return {
          success: false,
          error: 'Unsupported decisionModelJevApiKey value',
        };
      }
      if (
        params.decisionModelCustomApiKey !== undefined &&
        typeof params.decisionModelCustomApiKey !== 'string'
      ) {
        return {
          success: false,
          error: 'Unsupported decisionModelCustomApiKey value',
        };
      }
      // DC10: one key slot per request keeps the rollback to one snapshot.
      if (
        params.decisionModelJevApiKey !== undefined &&
        params.decisionModelCustomApiKey !== undefined
      ) {
        return {
          success: false,
          error:
            'Unsupported decisionModelJevApiKey with decisionModelCustomApiKey',
        };
      }
      // The same schema `setSelection` applies, run here so an invalid
      // selection is refused before a key (or anything else) is written.
      let decisionModel: DecisionModelSelection | undefined;
      if (params.decisionModel !== undefined) {
        const parsed = DecisionModelSelectionSchema.safeParse(
          params.decisionModel,
        );
        if (!parsed.success) {
          return {
            success: false,
            error: decisionModelRefusal(
              params.decisionModel,
              parsed.error.issues,
            ),
          };
        }
        decisionModel = parsed.data;
      }
      const decisionKey: DecisionKeyWrite | undefined =
        params.decisionModelJevApiKey !== undefined
          ? { slot: 'jev', key: params.decisionModelJevApiKey }
          : params.decisionModelCustomApiKey !== undefined
            ? { slot: 'custom', key: params.decisionModelCustomApiKey }
            : undefined;
      const invalidModel = invalidCliModel(params);
      if (invalidModel) {
        return { success: false, error: `Unsupported ${invalidModel} value` };
      }
      const invalidEffort = invalidReasoningEffort(params);
      if (invalidEffort) {
        return {
          success: false,
          error: `Unsupported ${invalidEffort} value`,
        };
      }
      const invalidBudget = invalidCodexBudget(params);
      if (invalidBudget) {
        return {
          success: false,
          error: `Unsupported ${invalidBudget} value`,
        };
      }
      const invalidGuard = invalidLaneGuard(params, (field) =>
        this.getLaneGuard(field),
      );
      if (invalidGuard) {
        return {
          success: false,
          error: `Unsupported ${invalidGuard} value`,
        };
      }
      const invalidOptIns = invalidClaudeBuiltinOptIns(params);
      if (invalidOptIns) {
        return { success: false, error: `Unsupported ${invalidOptIns} value` };
      }
      if (
        params.subagentPromptCacheTtl !== undefined &&
        !isSubagentPromptCacheTtlSetting(params.subagentPromptCacheTtl)
      ) {
        return {
          success: false,
          error: 'Unsupported subagentPromptCacheTtl value',
        };
      }
      // Decision-model writes run before the other writes, so a failed or
      // refused one (D4, DC10) leaves those fields unchanged. The selection
      // was validated above. See DecisionModelWriter.write for the
      // key-then-selection order and rollback.
      const decisionModelFailure = await this.decisionModelWriter.write(
        decisionKey,
        decisionModel,
      );
      if (decisionModelFailure) {
        return { success: false, error: decisionModelFailure };
      }
      if (params.preferredAgentOrder !== undefined) {
        await this.setAgentCfg(
          'preferredAgentOrder',
          params.preferredAgentOrder,
        );
      }
      if (params.maxConcurrentAgents !== undefined) {
        await this.setAgentCfg(
          'maxConcurrentAgents',
          Math.max(
            MIN_CONCURRENT_AGENTS,
            Math.min(MAX_CONCURRENT_AGENTS, params.maxConcurrentAgents),
          ),
        );
      }
      for (const key of CLI_MODEL_KEYS) {
        const model = params[key];
        // Stored trimmed: a whitespace-only id would reach the CLI as a model.
        if (model !== undefined) await this.setAgentCfg(key, model.trim());
      }
      if (params.cursorApiKey !== undefined) {
        const failure = await this.writeCursorApiKey(
          params.cursorApiKey.trim(),
        );
        if (failure) return { success: false, error: failure };
      }
      if (params.copilotAutoApprove !== undefined) {
        await this.setAgentCfg('copilotAutoApprove', params.copilotAutoApprove);
        const copilotAdapter = this.cliDetection.getAdapter('copilot');
        if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
          const bridge = (
            copilotAdapter as { permissionBridge: CopilotPermissionBridge }
          ).permissionBridge;
          bridge.setAutoApprove(params.copilotAutoApprove);
        }
      }
      if (params.codexReasoningEffort !== undefined) {
        await this.setAgentCfg(
          'codexReasoningEffort',
          params.codexReasoningEffort,
        );
      }
      for (const field of CODEX_BUDGET_TOKEN_FIELDS) {
        const value = params[field];
        if (value !== undefined) {
          await this.setAgentCfg(field, withoutNegativeZero(value));
        }
      }
      const guardOrder = laneGuardWriteOrder(params, (field) =>
        this.getLaneGuard(field),
      );
      for (const field of guardOrder) {
        const value = params[field];
        if (value !== undefined) {
          await this.setAgentCfg(field, value);
        }
      }
      if (params.codexWebSearch !== undefined) {
        await this.setAgentCfg('codexWebSearch', params.codexWebSearch);
      }
      if (params.subagentPromptCacheTtl !== undefined) {
        await this.setAgentCfg(
          'subagentPromptCacheTtl',
          params.subagentPromptCacheTtl,
        );
      }
      if (params.copilotReasoningEffort !== undefined) {
        await this.setAgentCfg(
          'copilotReasoningEffort',
          params.copilotReasoningEffort,
        );
      }
      if (params.grokReasoningEffort !== undefined) {
        await this.setAgentCfg(
          'grokReasoningEffort',
          params.grokReasoningEffort,
        );
      }
      if (params.antigravityReasoningEffort !== undefined) {
        await this.setAgentCfg(
          'antigravityReasoningEffort',
          params.antigravityReasoningEffort,
        );
      }
      if (params.piReasoningEffort !== undefined) {
        await this.setAgentCfg('piReasoningEffort', params.piReasoningEffort);
      }
      if (params.claudeReasoningEffort !== undefined) {
        await this.setAgentCfg(
          'claudeReasoningEffort',
          params.claudeReasoningEffort,
        );
      }
      if (params.mcpPort !== undefined) {
        await this.stateStorage.update(
          'agentOrchestration.mcpPort',
          Math.max(1024, Math.min(65535, params.mcpPort)),
        );
      }
      if (params.disabledClis !== undefined) {
        await this.setAgentCfg('disabledClis', params.disabledClis);
      }
      if (params.disabledMcpNamespaces !== undefined) {
        await this.setAgentCfg(
          'disabledMcpNamespaces',
          params.disabledMcpNamespaces,
        );
      }
      if (params.browserAllowLocalhost !== undefined) {
        await this.workspace.setConfiguration(
          'ptah',
          'browser.allowLocalhost',
          params.browserAllowLocalhost,
        );
      }
      if (params.workflowsDisabled !== undefined) {
        await this.workspace.setConfiguration(
          'ptah',
          'workflows.disabled',
          params.workflowsDisabled,
        );
      }
      // Global file settings, read by the next main session and Claude lane
      // build. Stored filtered to the catalog, deduped and sorted.
      if (params.enabledClaudeBuiltinTools !== undefined) {
        await this.setAgentCfg(
          'enabledClaudeBuiltinTools',
          normalizeClaudeBuiltinIds(
            params.enabledClaudeBuiltinTools,
            CLAUDE_BUILTIN_TOOL_IDS,
          ),
        );
      }
      if (params.enabledClaudeBuiltinSkills !== undefined) {
        // The submitted list decides the ids the reader finds now. A stored
        // synced opt-in the reader does not find now (another account's, or
        // any after a read error) is kept, as `agent:setClaudeBuiltin` does.
        const known = await this.knownClaudeSkillIds();
        const kept =
          this.getClaudeBuiltinOptIns().enabledClaudeBuiltinSkills.filter(
            (id) => isSyncedClaudeSkillId(id) && !known.includes(id),
          );
        await this.setAgentCfg(
          'enabledClaudeBuiltinSkills',
          normalizeClaudeBuiltinIds(
            [...params.enabledClaudeBuiltinSkills, ...kept],
            [...known, ...kept],
          ),
        );
      }
      this.logger.debug('RPC: agent:setConfig success');
      return { success: true };
    } catch (error: unknown) {
      // Raw errors can carry paths or credentials (params may hold
      // cursorApiKey), so the log gets the error type and the client gets
      // fixed text. SettingsPersistError's message is fixed by construction.
      this.logger.error('RPC: agent:setConfig failed', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return {
        success: false,
        error:
          error instanceof SettingsPersistError
            ? error.message
            : 'Could not save the orchestration settings.',
      };
    }
  }

  /**
   * Store (non-blank) or delete (blank) the Cursor key in the secret store
   * and remove the legacy plain `provider.cursor.apiKey` copy. Returns fixed
   * failure text, or `undefined` when the key is in the state the user asked
   * for. Secret-store and settings errors can carry credentials, so only
   * their type is logged.
   *
   * - Store: the secret is written first. Clearing the legacy copy afterwards
   *   is best-effort: the stored key wins on every read, and the startup
   *   migration clears a legacy copy that sits beside a stored key. A failed
   *   clear therefore never reports "not saved" for a key that was saved.
   * - Delete: the legacy copy is cleared FIRST. The startup migration would
   *   re-import a legacy copy into an empty store, so if the clear fails the
   *   stored key is left alone and the result says nothing was removed.
   */
  private async writeCursorApiKey(value: string): Promise<string | undefined> {
    const clearLegacy = () =>
      this.workspace.setConfiguration(
        'ptah',
        'provider.cursor.apiKey',
        undefined,
      );
    const errorType = (error: unknown) =>
      error instanceof Error ? error.name : 'unknown';

    if (value) {
      try {
        await this.authSecrets.setProviderKey('cursor', value);
      } catch {
        // Secret-store errors can carry credentials; discard their details.
        this.logger.error('RPC: agent:setConfig Cursor API key update failed');
        return 'Failed to update the Cursor API key';
      }
      try {
        await clearLegacy();
      } catch (error: unknown) {
        this.logger.warn(
          'RPC: agent:setConfig Cursor key stored; legacy plain copy not cleared (cleared at next start)',
          { errorType: errorType(error) },
        );
      }
      this.cliDetection.invalidateCache();
      return undefined;
    }

    try {
      await clearLegacy();
    } catch (error: unknown) {
      this.logger.error(
        'RPC: agent:setConfig Cursor key not removed; legacy plain copy could not be cleared',
        { errorType: errorType(error) },
      );
      return 'Could not remove the Cursor API key.';
    }
    try {
      await this.authSecrets.deleteProviderKey('cursor');
    } catch {
      this.logger.error('RPC: agent:setConfig Cursor API key update failed');
      return 'Failed to update the Cursor API key';
    }
    this.cliDetection.invalidateCache();
    return undefined;
  }

  private registerDetectClis(): void {
    this.rpcHandler.registerMethod<void, { clis: CliDetectionResult[] }>(
      'agent:detectClis',
      async () => {
        try {
          this.logger.debug('RPC: agent:detectClis called');
          this.cliDetection.invalidateCache();
          const cliResults = await this.cliDetection.detectAll();
          const detectedClis = await this.mergePtahCliAgents(cliResults);

          this.logger.debug('RPC: agent:detectClis success', {
            cliCount: detectedClis.length,
            installedCount: detectedClis.filter((c) => c.installed).length,
          });

          return { clis: detectedClis };
        } catch (error) {
          this.logger.error(
            'RPC: agent:detectClis failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  private registerListCliModels(): void {
    this.rpcHandler.registerMethod<void, AgentListCliModelsResult>(
      'agent:listCliModels',
      async () => {
        try {
          this.logger.debug('RPC: agent:listCliModels called');

          const result = await this.cliModelList.listAll();

          this.logger.debug('RPC: agent:listCliModels success', {
            codexCount: result.codex.length,
            copilotCount: result.copilot.length,
            cursorCount: result.cursor.length,
            antigravityCount: result.antigravity.length,
            opencodeCount: result.opencode.length,
            piCount: result.pi.length,
            grokCount: result.grok.length,
          });

          return result;
        } catch (error: unknown) {
          this.captureException(
            error,
            'AgentRpcHandlers.registerListCliModels',
          );
          this.logger.error(
            'RPC: agent:listCliModels failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  /**
   * Forward an error to Sentry when the host registered it. Guarded rather
   * than injected because the headless hosts boot without Sentry.
   */
  private captureException(error: unknown, errorSource: string): void {
    if (!this.runtimeContainer.isRegistered(TOKENS.SENTRY_SERVICE)) return;
    try {
      this.runtimeContainer
        .resolve<{
          captureException(e: Error, ctx: { errorSource: string }): void;
        }>(TOKENS.SENTRY_SERVICE)
        .captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource },
        );
    } catch {
      // Observability must never break an RPC call.
    }
  }

  /**
   * agent:permissionResponse - Route user's permission decision to handlers
   *
   * Tries both:
   * 1. SdkPermissionHandler (Ptah CLI agent permissions) - via lazy container resolution
   * 2. CopilotPermissionBridge (Copilot SDK permissions) - via CLI adapter
   *
   * Both handlers silently ignore unknown requestIds, so trying both is safe.
   */
  private registerPermissionResponse(): void {
    this.rpcHandler.registerMethod<
      AgentPermissionDecision,
      { success: boolean; error?: string }
    >('agent:permissionResponse', async (params) => {
      try {
        this.logger.debug('RPC: agent:permissionResponse called', {
          requestId: params.requestId,
          decision: params.decision,
        });

        let handled = false;
        if (
          this.runtimeContainer.isRegistered(SDK_TOKENS.SDK_PERMISSION_HANDLER)
        ) {
          const permissionHandler =
            this.runtimeContainer.resolve<ISdkPermissionHandler>(
              SDK_TOKENS.SDK_PERMISSION_HANDLER,
            );
          const response: PermissionResponse = {
            id: params.requestId,
            decision: params.decision,
            reason: params.reason,
          };
          permissionHandler.handleResponse(params.requestId, response);
          handled = true;
        }
        const copilotAdapter = this.cliDetection.getAdapter('copilot');
        if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
          const bridge = (
            copilotAdapter as { permissionBridge: CopilotPermissionBridge }
          ).permissionBridge;
          bridge.resolvePermission(params.requestId, params);
          handled = true;
        }

        if (handled) {
          return { success: true };
        }

        return {
          success: false,
          error: 'No permission handler available (neither SDK nor Copilot)',
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:permissionResponse failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * agent:e2eSeedPermission — TEST-ONLY seam (TASK_2026_264).
   *
   * TASK_2026_247 fixed the scope and mapping of a permission-cleanup path
   * that only runs when a permission is genuinely IN FLIGHT at the moment a
   * config change or teardown disposes sessions. Nothing outside a live SDK
   * tool call ever reaches `SdkPermissionHandler.createCallback()`, and the
   * unit specs that pin the fix (`sdk-permission-handler.spec.ts`,
   * `session-lifecycle-manager-dispose.spec.ts`) get there by importing the
   * class directly in-process. An Electron e2e cannot import backend classes
   * — it only has the RPC transport — so without this method there is no way
   * to put a REAL, ROUTABLE entry in the REAL `pendingRequests` map from
   * outside the process, and the fix's wiring-level gap (does a real
   * `auth:saveSettings` write actually reach `disposeAllSessions()`?) would
   * stay unverifiable by anything but a live model + real credentials, which
   * `.ptah/specs/TASK_2026_264/context.md` rules out as too
   * environment-dependent for CI.
   *
   * This method does nothing a unit test could not already do in-process: it
   * calls the same public `createCallback()` the SDK itself calls for every
   * tool permission check, with the same arguments shape the specs already
   * use. It is not a new capability, only a new place to reach an existing
   * one from. Gated on `PTAH_E2E==='1'` — the flag
   * `apps/ptah-electron-e2e/src/support/electron-launcher.ts` always sets and
   * a real user's build never has — as belt-and-braces on top of the RPC
   * channel already being unreachable outside the app's own IPC.
   *
   * Awaits the full permission round trip rather than firing-and-forgetting:
   * the caller needs the actual resolved `behavior`/`message`/`interrupt`
   * (not just "did it arrive"), and that value only exists once something
   * resolves the pending request — a webview answer, a session teardown, or
   * (for an unroutable request) the 60s deny timeout. A caller that seeds an
   * unroutable request should pass a `sendRpc` timeout comfortably past 60s.
   */
  private registerE2eSeedPermission(): void {
    const paramsSchema = z.object({
      toolName: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
      toolUseId: z.string().min(1),
      sessionId: z.string().optional(),
      tabId: z.string().optional(),
    });

    this.rpcHandler.registerMethod<
      unknown,
      {
        success: boolean;
        error?: string;
        behavior?: 'allow' | 'deny';
        message?: string;
        interrupt?: boolean;
      }
    >('agent:e2eSeedPermission', async (rawParams) => {
      if (process.env['PTAH_E2E'] !== '1') {
        return { success: false, error: 'e2e-only' };
      }
      try {
        const params = paramsSchema.parse(rawParams);
        if (
          !this.runtimeContainer.isRegistered(SDK_TOKENS.SDK_PERMISSION_HANDLER)
        ) {
          return {
            success: false,
            error: 'SdkPermissionHandler not registered',
          };
        }
        const permissionHandler =
          this.runtimeContainer.resolve<SdkPermissionHandler>(
            SDK_TOKENS.SDK_PERMISSION_HANDLER,
          );
        const callback = permissionHandler.createCallback(
          params.sessionId as SessionId | undefined,
          undefined,
          params.tabId as TabId | undefined,
        );
        const result = await callback(params.toolName, params.input, {
          signal: new AbortController().signal,
          toolUseID: params.toolUseId,
          // SDK 0.3.278 made `requestId` required. On this e2e seeding path the
          // tool-use id is the only per-request identifier available, and it is
          // already unique per seeded permission.
          requestId: params.toolUseId,
        });
        // SDK 0.3.278 widened the callback's return to include `null`, meaning
        // the handler reached no decision. Report that rather than crashing, so
        // an e2e run that seeds an undecidable permission fails legibly.
        if (result === null) {
          return { success: false, error: 'permission-callback-undecided' };
        }
        return {
          success: true,
          behavior: result.behavior,
          message: 'message' in result ? result.message : undefined,
          interrupt: 'interrupt' in result ? result.interrupt : undefined,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:e2eSeedPermission failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  private registerAgentStop(): void {
    this.rpcHandler.registerMethod<
      { agentId: string },
      { success: boolean; error?: string }
    >('agent:stop', async (params) => {
      try {
        this.logger.debug('RPC: agent:stop called', {
          agentId: params.agentId,
        });

        const result = await this.agentProcessManager.stop(params.agentId);

        this.logger.info('RPC: agent:stop success', {
          agentId: params.agentId,
          status: result.status,
        });

        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:stop failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  private registerAgentContinue(): void {
    this.rpcHandler.registerMethod<
      { agentId: string; message: string },
      { success: boolean; error?: string; code?: AgentContinueErrorCode }
    >('agent:continue', async (params) => {
      try {
        this.logger.debug('RPC: agent:continue called', {
          agentId: params.agentId,
        });

        await this.agentProcessManager.continueConversation(
          params.agentId,
          params.message,
        );

        this.logger.info('RPC: agent:continue success', {
          agentId: params.agentId,
        });

        return { success: true };
      } catch (error) {
        if (error instanceof AgentContinueError) {
          this.logger.warn('RPC: agent:continue rejected', {
            agentId: params.agentId,
            code: error.code,
          });
          return { success: false, code: error.code, error: error.message };
        }
        const accountRefusal = laneAccountRefusalCode(error);
        if (accountRefusal) {
          // A `claude` lane's account was refused on continue (D28). The
          // dedicated code is not a resume-fallback code: a resume would hit
          // the same account gate. The refusal code goes to the log only.
          this.logger.warn('RPC: agent:continue account refused', {
            agentId: params.agentId,
            code: accountRefusal,
          });
          return {
            success: false,
            code: 'account_refused',
            error: LANE_ACCOUNT_REFUSED_ERROR,
          };
        }
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:continue failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return {
          success: false,
          code: 'unknown',
          error: 'Failed to continue agent conversation',
        };
      }
    });
  }

  private registerResumeCliSession(): void {
    this.rpcHandler.registerMethod<
      {
        cliSessionId: string;
        cli: CliType;
        task: string;
        parentSessionId?: string;
        ptahCliId?: string;
        previousAgentId?: string;
      },
      {
        success: boolean;
        agentId?: string;
        error?: string;
        resumeDecision?: AgentResumeOutcome;
        code?: 'account_refused';
      }
    >('agent:resumeCliSession', async (params) => {
      try {
        // Validate BEFORE anything reads the params. The static type above
        // says what the webview is supposed to send; it cannot stop an
        // outdated webview, the CLI or an MCP caller sending `''` for an id.
        // Parsing inside this try is deliberate: the catch below returns
        // `{ success: false, error }` — the shape AgentMonitorStore already
        // reads — and keeps this handler's own error logging in the path.
        const parsed = AgentResumeCliSessionParamsSchema.safeParse(params);
        if (!parsed.success) {
          throw new RpcUserError(
            `agent:resumeCliSession: invalid params — ${parsed.error.message}`,
            'INVALID_PARAMS',
          );
        }

        this.logger.debug('RPC: agent:resumeCliSession called', {
          cliSessionId: params.cliSessionId,
          cli: params.cli,
          ptahCliId: params.ptahCliId,
        });

        // Plan 237: a resume never switches accounts. A supplied selection
        // that conflicts with the stored binding is refused here, before the
        // session folder is read or anything is spawned. On `inherit` the
        // runtime resumes on the stored binding, which stays authoritative
        // and fail-closed.
        const accountRefusal = await this.resumeAccountRefusal(
          parsed.data.cli,
          parsed.data.cliSessionId,
          parsed.data.accountSelection,
        );
        if (accountRefusal) {
          this.logger.warn('RPC: agent:resumeCliSession account refused', {
            cli: parsed.data.cli,
            code: accountRefusal,
          });
          return {
            success: false,
            error: resumeAccountRefusal(accountRefusal),
          };
        }

        let result: SpawnAgentResult;
        const workspaceRoot = await this.resumeFolder(params.parentSessionId);

        let ptahCliId = params.ptahCliId;
        if (params.cli === 'ptah-cli' && !ptahCliId) {
          ptahCliId = await this.resolveDefaultPtahCliId();
        }

        if (params.cli === 'ptah-cli' && ptahCliId) {
          result = await this.resumePtahCliSession(
            { ...params, ptahCliId },
            workspaceRoot,
          );
        } else if (params.cli === 'ptah-cli') {
          throw new Error(
            'No Ptah CLI agents configured. Add one in Settings > Providers > CLI Agents.',
          );
        } else {
          const accountSelection = resumeSpawnAccountSelection(
            parsed.data.cli,
            parsed.data.accountSelection,
          );
          result = await this.agentProcessManager.spawn({
            cli: params.cli,
            task: params.task,
            workingDirectory: workspaceRoot,
            resumeSessionId: params.cliSessionId,
            parentSessionId: params.parentSessionId,
            ptahCliId: params.ptahCliId,
            resumedFromAgentId: params.previousAgentId,
            ...(accountSelection ? { accountSelection } : {}),
          });
        }

        // G.6: the resume gate's decision goes to the caller and the log, so
        // a lane started fresh (with a handoff brief) is not mistaken for a
        // resumed one.
        const { resumeDecision } = result;
        this.logger.info('RPC: agent:resumeCliSession success', {
          agentId: result.agentId,
          cli: params.cli,
          resumedFrom: params.cliSessionId,
          ...(resumeDecision ? { resumeDecision } : {}),
        });

        return {
          success: true,
          agentId: result.agentId,
          ...(resumeDecision ? { resumeDecision } : {}),
        };
      } catch (error) {
        const laneRefusal = laneAccountRefusalCode(error);
        if (laneRefusal) {
          // The runtime refused the lane's account (D28). The reply is the
          // fixed text; the refusal code goes to the log only.
          this.logger.warn('RPC: agent:resumeCliSession account refused', {
            cli: params.cli,
            code: laneRefusal,
          });
          return {
            success: false,
            code: 'account_refused',
            error: LANE_ACCOUNT_REFUSED_ERROR,
          };
        }
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:resumeCliSession failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * Where a resumed CLI agent runs: its parent session's own folder, never
   * the active one, which may be another project's (PTAH-37). An unknown
   * parent or one whose folder is gone fails the resume.
   *
   * Without a parent (the Ptah CLI app's `agent resume`) there is no session
   * to ask, so the host default stands, as it does for chat:start.
   */
  private async resumeFolder(
    parentSessionId: string | undefined,
  ): Promise<string> {
    if (!parentSessionId) {
      // eslint-disable-next-line no-restricted-properties -- no parent session to ask; the Ptah CLI app's host default (its --cwd) is the folder
      return this.workspace.getWorkspaceRoot() ?? '';
    }
    return resolveSessionFolder({
      sessionId: parentSessionId,
      metadataStore: this.sessionMetadataStore,
      workspaceProvider: this.workspace,
      fileSystemProvider: this.fileSystemProvider,
      platformInfo: this.platformInfo,
      logger: this.logger,
    });
  }

  /**
   * The refusal for a resume's supplied account selection, or undefined when
   * the resume may go on (plan 237, `classifyAgentResumeAccountSelection`).
   * An absent or `omitted` selection never reads the account store, so
   * existing callers keep their behaviour exactly.
   */
  private async resumeAccountRefusal(
    cli: CliType,
    cliSessionId: string,
    selection: ProviderAccountSelection | undefined,
  ): Promise<Exclude<ProviderAccountResultCode, 'ok'> | undefined> {
    if (selection === undefined || selection.kind === 'omitted') {
      return undefined;
    }
    const stored = await this.storedResumeBinding(cli, cliSessionId);
    if (stored === 'unavailable-storage') return stored;
    const decision = classifyAgentResumeAccountSelection(
      { status: 'present', selection },
      stored,
    );
    if (decision === 'inherit') return undefined;
    return decision === 'conflict' ? 'conflict' : 'invalid-bound';
  }

  /**
   * The stored account binding of the session being resumed. Only `claude`
   * lanes are bound to provider accounts; every other CLI and every Ptah CLI
   * agent runs on its own ambient route, so its binding is `absent`. The
   * lookup is the same authority the runtime's resume gate reads; a missing
   * or failing account service is `unavailable-storage`, never `absent`.
   */
  private async storedResumeBinding(
    cli: CliType,
    cliSessionId: string,
  ): Promise<ProviderAccountBindingPresence | 'unavailable-storage'> {
    if (cli !== 'claude') return { status: 'absent' };
    try {
      if (!this.runtimeContainer.isRegistered(ProviderAccountService, true)) {
        return 'unavailable-storage';
      }
      const found = await this.runtimeContainer
        .resolve(ProviderAccountService)
        .lookupBySdkSession({ provider: 'claude', sdkSessionId: cliSessionId });
      if (found.status === 'absent') return { status: 'absent' };
      if (found.status === 'bound') {
        const parsed = classifyProviderAccountBinding(found.binding);
        return parsed.status === 'bound' && parsed.binding.provider === 'claude'
          ? parsed
          : { status: 'invalid-bound' };
      }
      return found.status === 'invalid-bound'
        ? { status: 'invalid-bound' }
        : 'unavailable-storage';
    } catch (error) {
      // degradation-audit: optional-capability - a failing account store is a typed storage refusal before spawn, never an ambient absence
      this.logger.warn('RPC: agent:resumeCliSession account lookup failed', {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return 'unavailable-storage';
    }
  }

  private async mergePtahCliAgents(
    cliResults: CliDetectionResult[],
  ): Promise<CliDetectionResult[]> {
    try {
      const ptahCliAgents = await this.ptahCliRegistry.listAgents();
      const ptahClis: CliDetectionResult[] = ptahCliAgents
        .filter((a) => a.enabled && a.hasApiKey)
        .map((a) => ({
          cli: 'ptah-cli' as const,
          installed: true,
          messagingMode: 'queue',
          ptahCliId: a.id,
          ptahCliName: a.name,
          providerName: a.providerName,
          providerId: a.providerId,
          ...PTAH_CLI_ROLE_DELIVERY,
        }));
      return [...cliResults, ...ptahClis];
    } catch {
      return cliResults;
    }
  }

  private async resumePtahCliSession(
    params: {
      cliSessionId: string;
      cli: CliType;
      task: string;
      parentSessionId?: string;
      ptahCliId: string;
      previousAgentId?: string;
    },
    workspaceRoot: string,
  ): Promise<SpawnAgentResult> {
    // The parent session must reach BOTH halves of the resume. spawnAgent used
    // to be called without it while spawnFromSdkHandle below received it, so
    // the SDK-side agent ran with no parent: its nested subagents registered
    // against nothing and its CLI session reference was dropped on persist.
    // An empty id is not a parent — normalize it to absent rather than
    // threading a value that identifies no session.
    const parentSessionId = params.parentSessionId
      ? params.parentSessionId
      : undefined;

    // The registry builds AND starts the handle, so the resume gate (R9.1) and
    // the blocked-model check (R9.5) run here, before it does (TASK_2026_614,
    // E.4 and B-m2). On `fresh` the lane gets the handoff task and no resume
    // id; the record keeps the caller's task.
    const prepared = await this.agentProcessManager.prepareSdkHandleSpawn({
      cli: 'ptah-cli',
      task: params.task,
      resumeSessionId: params.cliSessionId,
    });

    // ONE id, minted before the handle exists (TASK_2026_402). The handle
    // carries the MCP URL the resumed agent calls back on, and
    // `spawnFromSdkHandle` would otherwise mint the record's id AFTER that URL
    // was baked in — so the URL would name no agent, and every
    // `ptah_agent_report` from a RESUMED agent would be refused as an
    // `unattributed-caller`. Same reservation `agent-namespace.builder.ts`
    // makes on the fresh-spawn path.
    const agentId = this.agentProcessManager.reserveAgentId();

    const spawnResult = await this.ptahCliRegistry.spawnAgent(
      params.ptahCliId,
      prepared.task,
      {
        workingDirectory: workspaceRoot,
        resumeSessionId: prepared.resumeSessionId,
        parentSessionId,
        agentId,
      },
    );

    if ('status' in spawnResult) {
      throw new Error(`Ptah CLI agent resume failed: ${spawnResult.message}`);
    }

    if (spawnResult.handle.onSessionResolved) {
      spawnResult.handle.onSessionResolved((sessionId: string) => {
        this.sessionMetadataStore
          .createChild(sessionId, workspaceRoot, spawnResult.agentName)
          .catch((err: unknown) =>
            this.logger.warn(
              '[AgentRpc] Failed to save child session metadata',
              { error: err instanceof Error ? err.message : String(err) },
            ),
          );
      });
    }

    const result = await this.agentProcessManager.spawnFromSdkHandle(
      spawnResult.handle,
      {
        task: params.task,
        cli: 'ptah-cli',
        workingDirectory: workspaceRoot,
        parentSessionId,
        ptahCliName: spawnResult.agentName,
        ptahCliId: params.ptahCliId,
        resumedFromAgentId: params.previousAgentId,
        resumeSessionId: prepared.resumeSessionId,
        ...(prepared.resumeDecision
          ? { resumeDecision: prepared.resumeDecision }
          : {}),
        ...(prepared.originalTask !== undefined
          ? { originalTask: prepared.originalTask }
          : {}),
        agentId,
        mcpPort: this.ptahCliRegistry.getMcpPort(),
        expectsMcp: true,
      },
    );
    spawnResult.setAgentId(result.agentId);

    return result;
  }

  private async resolveDefaultPtahCliId(): Promise<string | undefined> {
    try {
      const agents = await this.ptahCliRegistry.listAgents();
      const enabled = agents.find((a) => a.enabled && a.hasApiKey);
      if (enabled) {
        this.logger.info(
          'RPC: agent:resumeCliSession resolved default ptahCliId',
          { ptahCliId: enabled.id, name: enabled.name },
        );
      }
      return enabled?.id;
    } catch {
      return undefined;
    }
  }

  /**
   * Read an `agentOrchestration.<key>` setting via IWorkspaceProvider so
   * file-based keys route through PtahFileSettingsManager (~/.ptah/settings.json)
   * — matching the VS Code handler and the read in
   * agent-process-manager.service.ts so the orchestration gate sees writes
   * made from this handler.
   */
  private getAgentCfg<T>(name: string, defaultValue: T): T {
    return (
      this.workspace.getConfiguration<T>(
        'ptah',
        `agentOrchestration.${name}`,
        defaultValue,
      ) ?? defaultValue
    );
  }

  /**
   * Read a Codex lane token budget. A hand-edited invalid file value (not an
   * integer >= 0) is reported as the default, the same value the lane uses.
   */
  private getCodexBudgetTokens(field: CodexBudgetTokenField): number {
    const fallback = CODEX_BUDGET_DEFAULTS[field];
    const value = this.getAgentCfg<unknown>(field, fallback);
    return isNonNegativeInteger(value) ? value : fallback;
  }

  /**
   * Read a lane guard. A hand-edited value below the field's minimum or not an
   * integer is reported as the default.
   */
  private getLaneGuard(field: LaneGuardField): number {
    const fallback = LANE_GUARD_DEFAULTS[field];
    const value = this.getAgentCfg<unknown>(field, fallback);
    return isLaneGuardValue(field, value) ? value : fallback;
  }

  /** Read the Codex lane web-search switch; a non-boolean reads as the default. */
  private getCodexWebSearch(): boolean {
    const fallback = CODEX_BUDGET_DEFAULTS.codexWebSearch;
    const value = this.getAgentCfg<unknown>('codexWebSearch', fallback);
    return typeof value === 'boolean' ? value : fallback;
  }

  /**
   * Read the subagent prompt-cache TTL setting (a hand-edited invalid value
   * reads as `'auto'`, as the options builder treats it) and report the host
   * env override, `'invalid'` included, when the env var is set.
   */
  private getSubagentPromptCacheTtl(): Pick<
    AgentOrchestrationConfig,
    'subagentPromptCacheTtl' | 'subagentPromptCacheTtlEnvOverride'
  > {
    const value = this.getAgentCfg<unknown>('subagentPromptCacheTtl', 'auto');
    const subagentPromptCacheTtl = isSubagentPromptCacheTtlSetting(value)
      ? value
      : 'auto';
    const { envOverride } = resolveSubagentPromptCacheTtl({
      setting: subagentPromptCacheTtl,
      envValue: process.env[SUBAGENT_PROMPT_CACHE_TTL_ENV],
      canSpawnSubagents: true,
    });
    return envOverride === undefined
      ? { subagentPromptCacheTtl }
      : {
          subagentPromptCacheTtl,
          subagentPromptCacheTtlEnvOverride: envOverride,
        };
  }

  /**
   * Write an `agentOrchestration.<key>` setting via IWorkspaceProvider.
   * Companion to {@link getAgentCfg}.
   */
  private async setAgentCfg(name: string, value: unknown): Promise<void> {
    await this.workspace.setConfiguration(
      'ptah',
      `agentOrchestration.${name}`,
      value,
    );
  }

  /**
   * Cursor API key sources, reported separately (TASK_2026_551):
   * - `envSet`: CURSOR_API_KEY is non-blank (it wins at resolution time);
   * - `stored`: `ptah.auth.provider.cursor` exists in the secrets store;
   * - `configured`: either source, mirroring CursorCliAdapter's resolution order.
   * Only booleans leave this method; the raw key is never read or returned.
   */
  private async getCursorApiKeyStatus(): Promise<{
    configured: boolean;
    stored: boolean;
    envSet: boolean;
  }> {
    const envKey = process.env['CURSOR_API_KEY'];
    const envSet = !!envKey && envKey.trim().length > 0;
    const stored = await this.authSecrets.hasProviderKey('cursor');
    return { configured: envSet || stored, stored, envSet };
  }

  /**
   * One-shot migration: copy any pre-existing `agentOrchestration.*` values
   * from IStateStorage (legacy `global-state.json` location) into the
   * IWorkspaceProvider, where they can actually be observed by the gate in
   * `agent-process-manager.service.ts`. Idempotent — guarded by a flag in
   * stateStorage so subsequent launches are no-ops.
   *
   * Skips keys that already exist in the workspace provider so we never
   * clobber a value the user set after upgrading.
   */
  private async migrateAgentOrchestrationSettings(): Promise<void> {
    const FLAG_KEY = 'agentOrchestration.migratedToFileSettings';
    if (this.stateStorage.get<boolean>(FLAG_KEY, false) === true) {
      return;
    }
    const KEYS_TO_MIGRATE = [
      'preferredAgentOrder',
      'maxConcurrentAgents',
      'codexModel',
      'copilotModel',
      'codexAutoApprove',
      'copilotAutoApprove',
      'codexReasoningEffort',
      'copilotReasoningEffort',
      'disabledClis',
      'disabledMcpNamespaces',
    ] as const;

    try {
      let migratedCount = 0;
      for (const key of KEYS_TO_MIGRATE) {
        const stateKey = `agentOrchestration.${key}`;
        const stateValue = this.stateStorage.get<unknown>(stateKey, undefined);
        if (stateValue === undefined) {
          continue;
        }
        const existing = this.workspace.getConfiguration<unknown>(
          'ptah',
          stateKey,
          undefined,
        );
        if (existing !== undefined) {
          continue;
        }

        await this.workspace.setConfiguration('ptah', stateKey, stateValue);
        migratedCount++;
      }

      await this.stateStorage.update(FLAG_KEY, true);

      if (migratedCount > 0) {
        this.logger.info(
          'Migrated agentOrchestration settings from stateStorage to workspace provider',
          { migratedCount },
        );
      }
    } catch (error) {
      this.logger.warn(
        `[AgentRpc] agentOrchestration migration failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
