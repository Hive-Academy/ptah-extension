/**
 * CLI parity copy of Electron AgentRpcHandlers.
 *
 * Handles the seven `agent:*` RPC methods locally inside the CLI app. The
 * Electron implementation lives at
 * `apps/ptah-electron/src/services/rpc/handlers/agent-rpc.handlers.ts` —
 * each method body in this file is a near-byte-for-byte copy of the
 * Electron counterpart. The differences are intentionally cosmetic:
 *
 *   1. Class name (`CliAgentRpcHandlers` vs `AgentRpcHandlers`).
 *   2. File header comment marking the parity copy.
 *   3. Logger label (`'CliAgentRpcHandlers'` debug context).
 *
 * Injected tokens are IDENTICAL. `PLATFORM_TOKENS.STATE_STORAGE` resolves to
 * the existing `CliStateStorage` instance registered at Phase 0 by
 * `registerPlatformCliServices()`. NO new `CliStateStorage` class is created.
 *
 * Method registration order is fixed by `static readonly METHODS` and
 * MUST stay in lockstep with the Electron tuple. Drift is asserted by the
 * parity spec (`cli-agent-rpc.handlers.spec.ts`).
 */

import { injectable, inject, container } from 'tsyringe';
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
} from '@ptah-extension/agent-sdk';
import {
  SDK_TOKENS,
  PtahCliRegistry,
  SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  AgentListCliModelsResult,
  CliModelOption,
  AgentPermissionDecision,
  CliDetectionResult,
  CliType,
  SpawnAgentResult,
  ISdkPermissionHandler,
  PermissionResponse,
} from '@ptah-extension/shared';

@injectable()
export class CliAgentRpcHandlers {
  /**
   * Method names registered against the global `RpcHandler`. Order matches
   * `register()` invocation order. Asserted deep-equal to the Electron
   * `AgentRpcHandlers.METHODS` tuple in the parity spec.
   */
  static readonly METHODS = [
    'agent:getConfig',
    'agent:setConfig',
    'agent:detectClis',
    'agent:listCliModels',
    'agent:permissionResponse',
    'agent:stop',
    'agent:resumeCliSession',
  ] as const;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(SDK_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry,
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agentProcessManager: AgentProcessManager,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.STATE_STORAGE)
    private readonly stateStorage: IStateStorage,
  ) {}

  register(): void {
    void this.migrateAgentOrchestrationSettings();

    this.registerGetConfig();
    this.registerSetConfig();
    this.registerDetectClis();
    this.registerListCliModels();
    this.registerPermissionResponse();
    this.registerAgentStop();
    this.registerResumeCliSession();

    // Initialize Copilot auto-approve from saved config (default: true).
    // Read via workspace provider so file-based key routes to ~/.ptah/settings.json
    // — parity with Electron AgentRpcHandlers and the gate in
    // agent-process-manager.service.ts.
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

    this.logger.debug('CliAgentRpcHandlers registered', {
      methods: [
        'agent:getConfig',
        'agent:setConfig',
        'agent:detectClis',
        'agent:listCliModels',
        'agent:permissionResponse',
        'agent:stop',
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
            // agentOrchestration.* settings are read via IWorkspaceProvider so
            // file-based keys route to ~/.ptah/settings.json — parity with the
            // Electron handler and the gate in agent-process-manager.service.ts.
            preferredAgentOrder: this.getAgentCfg<string[]>(
              'preferredAgentOrder',
              [],
            ),
            maxConcurrentAgents: this.getAgentCfg<number>(
              'maxConcurrentAgents',
              5,
            ),
            geminiModel: this.getAgentCfg<string>('geminiModel', ''),
            codexModel: this.getAgentCfg<string>('codexModel', ''),
            copilotModel: this.getAgentCfg<string>('copilotModel', ''),
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
            // mcpPort lives under the `ptah` namespace (non-file-based);
            // intentionally kept on stateStorage for parity with Electron.
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
        if (params.geminiModel !== undefined) {
          await this.setAgentCfg('geminiModel', params.geminiModel);
        }
        if (params.codexModel !== undefined) {
          await this.setAgentCfg('codexModel', params.codexModel);
        }
        if (params.copilotModel !== undefined) {
          await this.setAgentCfg('copilotModel', params.copilotModel);
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
        if (params.mcpPort !== undefined) {
          // mcpPort lives under `ptah` (not agentOrchestration) — kept on
          // stateStorage to match Electron.
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
        // Browser settings — write via workspace provider (FILE_BASED_SETTINGS_KEYS routes
        // through PtahFileSettingsManager → ~/.ptah/settings.json).
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

          const gemini = (modelMap['gemini'] ?? []) as CliModelOption[];
          const codex = (modelMap['codex'] ?? []) as CliModelOption[];
          const copilot = (modelMap['copilot'] ?? []) as CliModelOption[];

          const result: AgentListCliModelsResult = { gemini, codex, copilot };

          this.logger.debug('RPC: agent:listCliModels success', {
            geminiCount: result.gemini.length,
            codexCount: result.codex.length,
            copilotCount: result.copilot.length,
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
   * agent:permissionResponse - Route user's permission decision to handlers.
   *
   * Tries both:
   * 1. SdkPermissionHandler (Ptah CLI agent permissions) — lazy container resolve.
   * 2. CopilotPermissionBridge (Copilot SDK permissions) — via CLI adapter.
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

        if (container.isRegistered(SDK_TOKENS.SDK_PERMISSION_HANDLER)) {
          const permissionHandler = container.resolve<ISdkPermissionHandler>(
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
              `[CliAgentRpc] CLI session file not found for ${params.cliSessionId} — starting fresh`,
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
        `[CliAgentRpc] Session file not found for ${params.cliSessionId} — starting fresh instead of resuming`,
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
              `[CliAgentRpc] Failed to save child session metadata: ${err}`,
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
   * Check if a Claude SDK JSONL session file exists on disk.
   * Returns true if the file is found, false otherwise.
   */
  private async sessionFileExists(
    sessionId: string,
    workspacePath: string,
  ): Promise<boolean> {
    try {
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
        try {
          await fs.access(sessionFile);
          return true;
        } catch {
          // JSONL file not found
        }
      }
    } catch {
      // Projects dir doesn't exist
    }

    return false;
  }

  /**
   * Read an `agentOrchestration.<key>` setting via IWorkspaceProvider so
   * file-based keys route through PtahFileSettingsManager — parity with
   * Electron AgentRpcHandlers.getAgentCfg.
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

  /** Companion writer to {@link getAgentCfg}. */
  private async setAgentCfg(name: string, value: unknown): Promise<void> {
    await this.workspace.setConfiguration(
      'ptah',
      `agentOrchestration.${name}`,
      value,
    );
  }

  /**
   * One-shot migration mirror of Electron AgentRpcHandlers: copy any legacy
   * `agentOrchestration.*` values out of IStateStorage into the workspace
   * provider. Idempotent — gated by a flag in stateStorage.
   */
  private async migrateAgentOrchestrationSettings(): Promise<void> {
    const FLAG_KEY = 'agentOrchestration.migratedToFileSettings';
    if (this.stateStorage.get<boolean>(FLAG_KEY, false) === true) {
      return;
    }

    const KEYS_TO_MIGRATE = [
      'preferredAgentOrder',
      'maxConcurrentAgents',
      'geminiModel',
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
        if (stateValue === undefined) continue;

        const existing = this.workspace.getConfiguration<unknown>(
          'ptah',
          stateKey,
          undefined,
        );
        if (existing !== undefined) continue;

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
        `[CliAgentRpc] agentOrchestration migration failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
