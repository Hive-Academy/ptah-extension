/**
 * Electron Agent Orchestration RPC Handlers
 *
 * Electron-specific implementations for agent orchestration methods:
 * - agent:getConfig - Get agent config from Electron storage + CLI detection
 * - agent:setConfig - Persist agent config to Electron storage
 * - agent:detectClis - Re-detect installed CLI agents
 * - agent:listCliModels - List available models per CLI
 * - agent:permissionResponse - Route permission decisions to Copilot bridge
 * - agent:stop - Stop a running CLI agent
 * - agent:resumeCliSession - Resume a CLI agent session
 *
 * Mirrors the VS Code AgentRpcHandlers but uses platform-agnostic services
 * (IStateStorage, IWorkspaceProvider) instead of VS Code APIs.
 */

import { injectable, inject, type DependencyContainer } from 'tsyringe';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IStateStorage,
} from '@ptah-extension/platform-core';
import {
  CliDetectionService,
  CopilotPermissionBridge,
  AgentProcessManager,
  AgentContinueError,
  CLI_AGENT_RUNTIME_TOKENS,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import { SDK_TOKENS, SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  AgentListCliModelsResult,
  CliModelOption,
  AgentPermissionDecision,
  AgentContinueErrorCode,
  CliDetectionResult,
  CliType,
  SpawnAgentResult,
  ISdkPermissionHandler,
  PermissionResponse,
} from '@ptah-extension/shared';

@injectable()
export class AgentRpcHandlers {
  /**
   * Method names registered against the global `RpcHandler`. Order matches
   * `register()` invocation order. Asserted in the CLI parity spec
   * (`apps/ptah-cli/src/services/rpc/handlers/cli-agent-rpc.handlers.spec.ts`)
   * to keep CLI and Electron in lockstep.
   */
  static readonly METHODS = [
    'agent:getConfig',
    'agent:setConfig',
    'agent:detectClis',
    'agent:listCliModels',
    'agent:permissionResponse',
    'agent:stop',
    'agent:continue',
    'agent:resumeCliSession',
  ] as const;

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
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly runtimeContainer: DependencyContainer,
  ) {}

  register(): void {
    void this.migrateAgentOrchestrationSettings();

    this.registerGetConfig();
    this.registerSetConfig();
    this.registerDetectClis();
    this.registerListCliModels();
    this.registerPermissionResponse();
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

    this.logger.debug('Electron Agent RPC handlers registered', {
      methods: [
        'agent:getConfig',
        'agent:setConfig',
        'agent:detectClis',
        'agent:listCliModels',
        'agent:permissionResponse',
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
            opencodeModel: this.getAgentCfg<string>('opencodeModel', ''),
            piModel: this.getAgentCfg<string>('piModel', ''),
            cursorApiKeyConfigured: this.isCursorApiKeyConfigured(),
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
            copilotReasoningEffort: this.getAgentCfg<string>(
              'copilotReasoningEffort',
              '',
            ),
            piReasoningEffort: this.getAgentCfg<string>(
              'piReasoningEffort',
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

  private registerSetConfig(): void {
    this.rpcHandler.registerMethod<
      AgentSetConfigParams,
      { success: boolean; error?: string }
    >('agent:setConfig', async (params) => {
      try {
        this.logger.debug('RPC: agent:setConfig called', { params });
        if (params.preferredAgentOrder !== undefined) {
          await this.setAgentCfg(
            'preferredAgentOrder',
            params.preferredAgentOrder,
          );
        }
        if (params.maxConcurrentAgents !== undefined) {
          await this.setAgentCfg(
            'maxConcurrentAgents',
            Math.max(1, Math.min(10, params.maxConcurrentAgents)),
          );
        }
        if (params.codexModel !== undefined) {
          await this.setAgentCfg('codexModel', params.codexModel);
        }
        if (params.copilotModel !== undefined) {
          await this.setAgentCfg('copilotModel', params.copilotModel);
        }
        if (params.cursorModel !== undefined) {
          await this.setAgentCfg('cursorModel', params.cursorModel);
        }
        if (params.antigravityModel !== undefined) {
          await this.setAgentCfg('antigravityModel', params.antigravityModel);
        }
        if (params.opencodeModel !== undefined) {
          await this.setAgentCfg('opencodeModel', params.opencodeModel);
        }
        if (params.piModel !== undefined) {
          await this.setAgentCfg('piModel', params.piModel);
        }
        if (params.cursorApiKey !== undefined) {
          await this.workspace.setConfiguration(
            'ptah',
            'provider.cursor.apiKey',
            params.cursorApiKey,
          );
          this.cliDetection.invalidateCache();
        }
        if (params.copilotAutoApprove !== undefined) {
          await this.setAgentCfg(
            'copilotAutoApprove',
            params.copilotAutoApprove,
          );
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
        if (params.copilotReasoningEffort !== undefined) {
          await this.setAgentCfg(
            'copilotReasoningEffort',
            params.copilotReasoningEffort,
          );
        }
        if (params.piReasoningEffort !== undefined) {
          await this.setAgentCfg('piReasoningEffort', params.piReasoningEffort);
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
        this.logger.debug('RPC: agent:setConfig success');
        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:setConfig failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
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

          const modelMap = await this.cliDetection.listModelsForAll();

          const codex = (modelMap['codex'] ?? []) as CliModelOption[];
          const copilot = (modelMap['copilot'] ?? []) as CliModelOption[];
          const cursor = (modelMap['cursor'] ?? []) as CliModelOption[];
          const antigravity = (modelMap['antigravity'] ??
            []) as CliModelOption[];
          const opencode = (modelMap['opencode'] ?? []) as CliModelOption[];
          const pi = (modelMap['pi'] ?? []) as CliModelOption[];

          const result: AgentListCliModelsResult = {
            codex,
            copilot,
            cursor,
            antigravity,
            opencode,
            pi,
          };

          this.logger.debug('RPC: agent:listCliModels success', {
            codexCount: result.codex.length,
            copilotCount: result.copilot.length,
            cursorCount: result.cursor.length,
            antigravityCount: result.antigravity.length,
            opencodeCount: result.opencode.length,
            piCount: result.pi.length,
          });

          return result;
        } catch (error) {
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
      { success: boolean; agentId?: string; error?: string }
    >('agent:resumeCliSession', async (params) => {
      try {
        this.logger.debug('RPC: agent:resumeCliSession called', {
          cliSessionId: params.cliSessionId,
          cli: params.cli,
          ptahCliId: params.ptahCliId,
        });

        let result: SpawnAgentResult;
        const workspaceRoot = this.workspace.getWorkspaceRoot() ?? '';

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
            'No Ptah CLI agents configured. Add one in Agent Orchestration settings.',
          );
        } else {
          const cliSessionExists = await this.sessionFileExists(
            params.cliSessionId,
            workspaceRoot,
          );
          if (!cliSessionExists) {
            this.logger.warn(
              `[AgentRpc] CLI session file not found for ${params.cliSessionId} — starting fresh`,
            );
          }
          result = await this.agentProcessManager.spawn({
            cli: params.cli,
            task: params.task,
            resumeSessionId: cliSessionExists ? params.cliSessionId : undefined,
            parentSessionId: params.parentSessionId,
            ptahCliId: params.ptahCliId,
            resumedFromAgentId: params.previousAgentId,
          });
        }

        this.logger.info('RPC: agent:resumeCliSession success', {
          agentId: result.agentId,
          cli: params.cli,
          resumedFrom: params.cliSessionId,
        });

        return { success: true, agentId: result.agentId };
      } catch (error) {
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
          supportsSteer: false,
          ptahCliId: a.id,
          ptahCliName: a.name,
          providerName: a.providerName,
          providerId: a.providerId,
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
    const sessionFileExists = await this.sessionFileExists(
      params.cliSessionId,
      workspaceRoot,
    );

    const spawnResult = await this.ptahCliRegistry.spawnAgent(
      params.ptahCliId,
      params.task,
      {
        workingDirectory: workspaceRoot,
        resumeSessionId: sessionFileExists ? params.cliSessionId : undefined,
      },
    );

    if (!sessionFileExists) {
      this.logger.warn(
        `[AgentRpc] Session file not found for ${params.cliSessionId} — starting fresh instead of resuming`,
      );
    }

    if ('status' in spawnResult) {
      throw new Error(`Ptah CLI agent resume failed: ${spawnResult.message}`);
    }

    if (spawnResult.handle.onSessionResolved) {
      spawnResult.handle.onSessionResolved((sessionId: string) => {
        const sessionName = `CLI Agent: ${spawnResult.agentName}`;
        this.sessionMetadataStore
          .createChild(sessionId, workspaceRoot, sessionName)
          .catch((err) =>
            this.logger.warn(
              `[AgentRpc] Failed to save child session metadata: ${err}`,
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
        parentSessionId: params.parentSessionId,
        ptahCliName: spawnResult.agentName,
        ptahCliId: params.ptahCliId,
        resumedFromAgentId: params.previousAgentId,
        resumeSessionId: sessionFileExists ? params.cliSessionId : undefined,
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
   * Whether a Cursor API key is resolvable — either CURSOR_API_KEY in the
   * environment or `provider.cursor.apiKey` in ~/.ptah/settings.json. Mirrors
   * the resolution order in CursorCliAdapter; the raw key is never returned.
   */
  private isCursorApiKeyConfigured(): boolean {
    const envKey = process.env['CURSOR_API_KEY'];
    if (envKey && envKey.trim()) {
      return true;
    }
    const fileKey = this.workspace.getConfiguration<string>(
      'ptah',
      'provider.cursor.apiKey',
      '',
    );
    return !!fileKey && fileKey.trim().length > 0;
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

  /**
   * Check if a Claude SDK JSONL session file exists on disk.
   * Returns true if the file is found, false otherwise.
   */
  private async sessionFileExists(
    sessionId: string,
    workspacePath: string,
  ): Promise<boolean> {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');
    const dirs = await fs.readdir(projectsDir);

    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
    const normalizedEscaped = normalize(escapedPath);
    const matchedDir = dirs.find(
      (d) =>
        d === escapedPath ||
        d.toLowerCase() === escapedPath.toLowerCase() ||
        normalize(d) === normalizedEscaped,
    );

    if (matchedDir) {
      const sessionFile = path.join(
        projectsDir,
        matchedDir,
        `${sessionId}.jsonl`,
      );

      await fs.access(sessionFile);
      return true;
    }

    return false;
  }
}
