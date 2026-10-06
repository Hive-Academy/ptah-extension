import { injectable, inject } from 'tsyringe';
import {
  HARNESS_PREFLIGHT_TOKEN,
  type IHarnessPreflight,
} from '@ptah-extension/agent-sdk';
import { promises as fsPromises } from 'fs';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  isPathWithinRoots,
} from '@ptah-extension/platform-core';
import type {
  ICallerWorkspaceResolver,
  IMcpServerStatus,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ReasoningSettings } from '@ptah-extension/settings-core';
import {
  CliType,
  SYSTEM_CLI_TYPES,
  normalizeWorkspaceRoot,
} from '@ptah-extension/shared';
import { CliDetectionService } from './cli-detection.service';
import type { CliLaneBudgets } from './cli-adapters/cli-adapter.interface';
import { CODEX_DEFAULT_LANE_BUDGETS } from './cli-adapters/codex/codex-lane-budgets';
import {
  resolveLaneEffort,
  resolveLaneModel,
  type LaneEffortResolution,
  type LaneModelResolution,
} from './lane-spawn-policy';
import {
  SDK_IDLE_RELEASE_MS,
  MIN_SDK_IDLE_RELEASE_MS,
} from './agent-process-manager-helpers';

import type { LaneBudgetThresholds } from './lane-budget-guard';

/** Mirrors the `FILE_BASED_SETTINGS_DEFAULTS` lane-guard values. */
const DEFAULT_LANE_GUARD_THRESHOLDS: LaneBudgetThresholds = {
  steerAt: 40,
  stopAt: 60,
  repeatAt: 20,
};

export const MIN_CONCURRENT_AGENTS = 1;
export const MAX_CONCURRENT_AGENTS = 20;
export const DEFAULT_CONCURRENT_AGENTS = 5;

@injectable()
export class AgentSpawnEnvironment {
  /** Invalid lane-guard values already warned about (key plus values). */
  private readonly warnedLaneGuard = new Set<string>();

  private static readonly MODEL_CONFIG_KEYS: Partial<Record<CliType, string>> =
    {
      codex: 'codexModel',
      copilot: 'copilotModel',
      cursor: 'cursorModel',
      antigravity: 'antigravityModel',
      opencode: 'opencodeModel',
      pi: 'piModel',
      grok: 'grokModel',
    };

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SETTINGS_TOKENS.REASONING_SETTINGS)
    private readonly reasoningSettings: ReasoningSettings,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    /**
     * A rival CLI reads the harness off DISK and has no other channel — no
     * system-prompt injection, no MCP fallback. If `{ws}/.agents/skills` is not
     * there when the process starts, the skills do not exist for that run.
     * Optional so a host without `harness-sync` spawns exactly as before.
     */
    @inject(HARNESS_PREFLIGHT_TOKEN, { isOptional: true })
    private readonly harnessPreflight: IHarnessPreflight | null = null,
    /**
     * Optional because CLI-only hosts do not start Ptah's in-process MCP server.
     * The port is the source of truth after deterministic fallback selection.
     */
    @inject(PLATFORM_TOKENS.MCP_SERVER_STATUS, { isOptional: true })
    private readonly mcpServerStatus: IMcpServerStatus | null = null,
    /**
     * The calling MCP request's workspace root (TASK_2026_364). Optional:
     * only hosts that run the in-process HTTP MCP server (VS Code, Electron)
     * register an implementation. Unregistered — the CLI host and unit
     * tests — every resolution falls to the platform provider exactly as
     * before the port existed. Never import `vscode-lm-tools` here instead:
     * the dependency runs `vscode-lm-tools` → this lib, and inverting it is a
     * module-boundary error.
     */
    @inject(PLATFORM_TOKENS.CALLER_WORKSPACE_RESOLVER, { isOptional: true })
    private readonly callerWorkspaceResolver: ICallerWorkspaceResolver | null = null,
  ) {}

  /**
   * Per-CLI effort setting keys. Antigravity and Grok have none (their
   * settings panes are model-only), so R2.3 step 2 never matches for them.
   */
  private static readonly EFFORT_CONFIG_KEYS: Partial<Record<CliType, string>> =
    {
      codex: 'codexReasoningEffort',
      copilot: 'copilotReasoningEffort',
      pi: 'piReasoningEffort',
    };

  /**
   * The lane's effort, in R2.3 order (see `resolveLaneEffort`). This reads
   * the per-CLI setting and the in-chat effort; the policy decides. A saved
   * `inherit` resolves to the in-chat effort and never reaches a CLI raw.
   */
  resolveReasoningEffort(
    cli: CliType,
    spawn: { readonly effort?: string; readonly roleName?: string } = {},
  ): LaneEffortResolution {
    const settingKey = AgentSpawnEnvironment.EFFORT_CONFIG_KEYS[cli];
    const setting = settingKey
      ? (this.workspace.getConfiguration<string>(
          'ptah',
          `agentOrchestration.${settingKey}`,
          '',
        ) ?? '')
      : undefined;
    return resolveLaneEffort({
      cli,
      spawnEffort: spawn.effort,
      setting,
      chatEffort: this.reasoningSettings.effort.get(),
      roleName: spawn.roleName,
    });
  }

  resolveAutoApprove(cli: CliType): boolean | undefined {
    if (cli === 'codex') return undefined;
    if (cli !== 'copilot') return undefined;
    return this.workspace.getConfiguration<boolean>(
      'ptah',
      'agentOrchestration.copilotAutoApprove',
      true,
    );
  }

  /** The lane's model and where it came from (see `resolveLaneModel`). */
  resolveModel(
    cli: CliType,
    requestModel: string | undefined,
  ): LaneModelResolution {
    const configKey = AgentSpawnEnvironment.MODEL_CONFIG_KEYS[cli];
    const configuredModel =
      !requestModel && configKey
        ? (this.workspace.getConfiguration<string>(
            'ptah',
            `agentOrchestration.${configKey}`,
            '',
          ) ?? '')
        : undefined;
    return resolveLaneModel(cli, requestModel, configuredModel);
  }

  /**
   * The Codex lane budgets, with the `FILE_BASED_SETTINGS_DEFAULTS` values
   * when a key is unset. The values are passed on as read: the adapter
   * validates them (`resolveCodexLaneBudgets`) and warns once per invalid key.
   */
  resolveLaneBudgets(): CliLaneBudgets {
    const defaults = CODEX_DEFAULT_LANE_BUDGETS;
    return {
      autoCompactTokens:
        this.workspace.getConfiguration<number>(
          'ptah',
          'agentOrchestration.codexAutoCompactTokens',
          defaults.autoCompactTokens,
        ) ?? defaults.autoCompactTokens,
      toolOutputTokenLimit:
        this.workspace.getConfiguration<number>(
          'ptah',
          'agentOrchestration.codexToolOutputTokenLimit',
          defaults.toolOutputTokenLimit,
        ) ?? defaults.toolOutputTokenLimit,
      webSearch:
        this.workspace.getConfiguration<boolean>(
          'ptah',
          'agentOrchestration.codexWebSearch',
          defaults.webSearch,
        ) ?? defaults.webSearch,
    };
  }

  /**
   * The lane tool-call guard thresholds. Each file value must be an integer
   * >= 1; `repeatAt` must be >= 2 and `stopAt` must exceed `steerAt`. A value
   * that breaks its rule falls back to the default (for the steer/stop pair,
   * both fall back, since the pair is only meaningful together).
   */
  resolveLaneGuardThresholds(): LaneBudgetThresholds {
    const d = DEFAULT_LANE_GUARD_THRESHOLDS;
    const read = (key: string, dflt: number): unknown =>
      this.workspace.getConfiguration<number>(
        'ptah',
        `agentOrchestration.${key}`,
        dflt,
      );
    const isInt = (v: unknown, min: number): v is number =>
      typeof v === 'number' && Number.isInteger(v) && v >= min;

    const steer = read('laneToolCallSteerAt', d.steerAt);
    const stop = read('laneToolCallStopAt', d.stopAt);
    const repeat = read('laneRepeatCallStopAt', d.repeatAt);
    const pairOk = isInt(steer, 1) && isInt(stop, 1) && stop > steer;
    const repeatOk = isInt(repeat, 2);
    // Numbers are logged as-is, anything else as its typeof (a hand-edited
    // value may be a string or object; never log it verbatim).
    const shown = (v: unknown): number | string =>
      typeof v === 'number' ? v : typeof v;
    if (!pairOk) {
      this.warnLaneGuardOnce(
        'agentOrchestration.laneToolCallSteerAt/laneToolCallStopAt',
        {
          provided: { steer: shown(steer), stop: shown(stop) },
          defaults: { steerAt: d.steerAt, stopAt: d.stopAt },
        },
      );
    }
    if (!repeatOk) {
      this.warnLaneGuardOnce('agentOrchestration.laneRepeatCallStopAt', {
        provided: { repeat: shown(repeat) },
        defaults: { repeatAt: d.repeatAt },
      });
    }
    return {
      steerAt: pairOk ? steer : d.steerAt,
      stopAt: pairOk ? stop : d.stopAt,
      repeatAt: repeatOk ? repeat : d.repeatAt,
    };
  }

  /** Warn once per distinct key and rejected values, not on every spawn. */
  private warnLaneGuardOnce(
    key: string,
    detail: Record<string, Record<string, number | string>>,
  ): void {
    const signature = `${key}\u0000${JSON.stringify(detail['provided'])}`;
    if (this.warnedLaneGuard.has(signature)) return;
    this.warnedLaneGuard.add(signature);
    this.logger.warn(
      '[AgentSpawnEnvironment] Invalid lane tool-call guard value, using the default',
      { key, ...detail },
    );
  }

  /**
   * The idle window before a completed agent's subprocess is released.
   *
   * Read through the same settings surface as `maxConcurrentAgents`, so a user
   * who lives on long follow-up threads can widen it (or set it very large to
   * get the old hold-forever behaviour back) without a rebuild.
   *
   * Two guards, and they answer different questions. A value that is not a
   * usable number at all — a string from a hand-edited settings file, `NaN`,
   * zero or negative — is not a preference, so the DEFAULT is used. A value
   * that is a real preference but below {@link MIN_SDK_IDLE_RELEASE_MS} is
   * raised to the floor rather than discarded: the user asked for "as short as
   * possible" and gets the shortest window the setting is declared to allow,
   * not five minutes.
   */
  sdkIdleReleaseMs(): number {
    const configured = this.workspace.getConfiguration<number>(
      'ptah',
      'agentOrchestration.sdkIdleReleaseMs',
      SDK_IDLE_RELEASE_MS,
    );
    if (
      typeof configured !== 'number' ||
      !Number.isFinite(configured) ||
      configured <= 0
    ) {
      return SDK_IDLE_RELEASE_MS;
    }
    return Math.max(configured, MIN_SDK_IDLE_RELEASE_MS);
  }

  /**
   * The concurrent-agent cap.
   *
   * The extension manifest schema protects only the VS Code settings UI.
   * Electron, CLI, and hand-edited settings reach this runtime unchecked, so
   * the 1..20 bounds are enforced here and non-finite values fall back to 5.
   *
   * `ptah.agentOrchestration.maxConcurrentAgents` — DEFAULT 5, MAXIMUM 20, both
   * declared in the extension's `package.json`. Prompt text and docs that say
   * "max 3 concurrent" are stale and describe a limit that has not existed for
   * some time; the number here is the one the runtime enforces.
   */
  maxConcurrentAgents(): number {
    const configured =
      this.workspace.getConfiguration<number>(
        'ptah',
        'agentOrchestration.maxConcurrentAgents',
        DEFAULT_CONCURRENT_AGENTS,
      ) ?? DEFAULT_CONCURRENT_AGENTS;

    if (!Number.isFinite(configured)) {
      return DEFAULT_CONCURRENT_AGENTS;
    }

    return Math.max(
      MIN_CONCURRENT_AGENTS,
      Math.min(MAX_CONCURRENT_AGENTS, configured),
    );
  }

  async preferredCli(): Promise<CliType | null> {
    const systemCliTypes = new Set<string>(SYSTEM_CLI_TYPES);
    const disabledClis = new Set(
      this.workspace.getConfiguration<string[]>(
        'ptah',
        'agentOrchestration.disabledClis',
        [],
      ) ?? [],
    );
    const preferredOrder =
      this.workspace.getConfiguration<string[]>(
        'ptah',
        'agentOrchestration.preferredAgentOrder',
        [],
      ) ?? [];
    this.logger.debug(
      '[AgentProcessManager] getPreferredCli: preferred order',
      {
        order:
          preferredOrder.length > 0
            ? preferredOrder.join(', ')
            : 'none (auto-detect)',
        disabled: disabledClis.size > 0 ? [...disabledClis].join(', ') : 'none',
      },
    );
    for (const entry of preferredOrder) {
      if (!systemCliTypes.has(entry)) {
        continue;
      }
      if (disabledClis.has(entry)) {
        continue;
      }

      const adapter = this.cliDetection.getAdapter(entry as CliType);
      if (adapter) {
        const detection = await this.cliDetection.getDetection(
          entry as CliType,
        );
        if (detection?.installed) {
          this.logger.info(
            '[AgentProcessManager] getPreferredCli: using preferred CLI',
            { cli: entry },
          );
          return entry as CliType;
        }
        this.logger.warn(
          '[AgentProcessManager] getPreferredCli: preferred CLI not installed, trying next',
          { preferred: entry, installed: detection?.installed },
        );
      }
    }
    const installed = await this.cliDetection.getInstalledClis();
    const enabled = installed.filter((c) => !disabledClis.has(c.cli));
    this.logger.debug(
      '[AgentProcessManager] getPreferredCli: auto-detect installed CLIs',
      {
        count: enabled.length,
        clis: enabled.map((c) => `${c.cli}${c.installed ? ' ✓' : ' ✗'}`),
      },
    );

    if (enabled.length === 0) return null;

    return enabled[0].cli;
  }

  /**
   * The workspace root this call is scoped to: the calling MCP request's
   * workspace (declared in its URL, or inferred from its session) first, then
   * the platform provider's active folder. `undefined` when neither resolves.
   *
   * A throw from the resolver — a caller that declared a workspace this host
   * does not have open — propagates deliberately. Refusing by name is the
   * point; degrading to the provider root would answer for an unrelated
   * workspace, the exact defect TASK_2026_364 exists to close.
   */
  scopedWorkspaceRoot(): string | undefined {
    return (
      this.callerWorkspaceResolver?.resolveCallerWorkspaceRoot() ??
      this.workspace.getWorkspaceRoot() ??
      undefined
    );
  }

  workspaceRoot(): string {
    return this.scopedWorkspaceRoot() ?? require('os').homedir();
  }

  /**
   * Whether an agent's working directory falls under the caller's workspace
   * scope, compared with the shared normalized key (`normalizeWorkspaceRoot`),
   * so separator and case spellings of one directory land on one answer.
   *
   * An `undefined` scope (no caller context and no open folder) keeps the
   * pre-scoping behaviour: everything is visible. A record with no working
   * directory is also visible — it cannot be attributed to any workspace, and
   * hiding it recreates the invisible-live-agent hazard this scoping fixes.
   */
  isWithinScope(
    workingDirectory: string | undefined,
    scopeKey: string | undefined,
  ): boolean {
    if (scopeKey === undefined) return true;
    if (!workingDirectory) return true;
    const dirKey = normalizeWorkspaceRoot(workingDirectory);
    return dirKey === scopeKey || dirKey.startsWith(`${scopeKey}/`);
  }

  async validateWorkingDirectory(dir: string): Promise<void> {
    const workspaceRoot = this.workspaceRoot();
    if (!workspaceRoot || workspaceRoot.trim() === '') {
      throw new Error('Cannot spawn agent process: no workspace root is open.');
    }
    if (!dir || dir.trim() === '') {
      throw new Error('Working directory is required but was empty.');
    }
    let realDirectory: string;
    let realWorkspaceRoot: string;
    try {
      [realDirectory, realWorkspaceRoot] = await Promise.all([
        fsPromises.realpath(dir),
        fsPromises.realpath(workspaceRoot),
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot resolve working directory scope: ${message}`);
    }

    if (!isPathWithinRoots(realDirectory, [realWorkspaceRoot])) {
      throw new Error(
        `Working directory must be within workspace root. ` +
          `Got: ${dir}, Expected root: ${workspaceRoot}`,
      );
    }
  }

  /**
   * Resolve the actual MCP listener port.
   *
   * The status port is updated only after the server binds, so it reflects a
   * deterministic fallback port rather than the configured port that collided.
   */
  mcpPort(): number | undefined {
    try {
      const port = this.mcpServerStatus?.getPort() ?? null;
      if (port === null) {
        this.logger.info(
          '[AgentProcessManager] MCP server is not running, disabling for CLI agent',
        );
        return undefined;
      }

      this.logger.info('[AgentProcessManager] MCP enabled for CLI agent', {
        port,
      });
      return port;
      // degradation-audit: optional-capability - the in-process MCP server is
      // an optional enhancement for CLI agent spawns; a status lookup failure
      // means "treat MCP as unavailable for this run", which is the documented
      // undefined return, and the exception is still reported to Sentry above.
    } catch (error: unknown) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'AgentProcessManager.resolveMcpPort' },
      );
      this.logger.info('[AgentProcessManager] MCP port resolution failed');
      return undefined;
    }
  }

  /**
   * Bounded harness check for a rival CLI spawn.
   *
   * Swallows everything. `spawn` is wrapped in a lock and its caller surfaces
   * failures to the user as "the agent could not start"; a harness directory
   * that could not be written is not that, and must not be reported as that.
   */
  async runHarnessPreflight(cwd: string): Promise<void> {
    if (this.harnessPreflight === null) return;
    try {
      await this.harnessPreflight.ensure(cwd);
    } catch (error: unknown) {
      this.logger.warn(
        `[AgentProcessManager] Harness preflight failed (ignored): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
