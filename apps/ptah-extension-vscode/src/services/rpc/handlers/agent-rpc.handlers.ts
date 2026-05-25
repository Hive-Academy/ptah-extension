/**
 * Agent Orchestration RPC Handlers
 *
 * Handles agent orchestration RPC methods:
 * - agent:getConfig - Get agent orchestration configuration + CLI detection results
 * - agent:setConfig - Update agent orchestration VS Code settings
 * - agent:detectClis - Re-detect installed CLI agents (invalidates cache)
 */

import { injectable, inject, type DependencyContainer } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  CliDetectionService,
  CopilotPermissionBridge,
  AgentProcessManager,
  CLI_AGENT_RUNTIME_TOKENS,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import { SDK_TOKENS, SessionMetadataStore } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  AgentListCliModelsResult,
  CliModelOption,
  AgentPermissionDecision,
  ISdkPermissionHandler,
  PermissionResponse,
} from '@ptah-extension/shared';
import type { CliDetectionResult, CliType } from '@ptah-extension/shared';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * RPC handlers for agent orchestration operations.
 *
 * Exposes agent orchestration config to the frontend for:
 * - Displaying detected CLI agents (Gemini, Codex)
 * - Configuring default CLI, max concurrent agents, timeout
 * - Triggering re-detection of CLI agents
 */
@injectable()
export class AgentRpcHandlers {
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
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly runtimeContainer: DependencyContainer,
  ) {}

  /**
   * Register all agent orchestration RPC methods
   */
  register(): void {
    this.registerGetConfig();
    this.registerSetConfig();
    this.registerDetectClis();
    this.registerListCliModels();
    this.registerPermissionResponse();
    this.registerAgentStop();
    this.registerResumeCliSession();
    const copilotAutoApprove =
      this.workspaceProvider.getConfiguration<boolean>(
        'ptah',
        'agentOrchestration.copilotAutoApprove',
        true,
      ) ?? true;
    const copilotAdapter = this.cliDetection.getAdapter('copilot');
    if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
      const bridge = (
        copilotAdapter as { permissionBridge: CopilotPermissionBridge }
      ).permissionBridge;
      bridge.setAutoApprove(copilotAutoApprove);
    }

    this.logger.debug('Agent orchestration RPC handlers registered', {
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

  /**
   * agent:getConfig - Get agent orchestration configuration
   *
   * Reads settings via IWorkspaceProvider and combines with CLI detection
   * results. Uses cached detection results (fast after first call). Uses
   * IWorkspaceProvider so file-based keys route to ~/.ptah/settings.json.
   */
  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<void, AgentOrchestrationConfig>(
      'agent:getConfig',
      async () => {
        try {
          this.logger.debug('RPC: agent:getConfig called');

          const cliResults = await this.cliDetection.detectAll();
          const detectedClis = await this.mergePtahCliAgents(cliResults);
          const getCfg = <T>(key: string, defaultValue: T): T =>
            this.workspaceProvider.getConfiguration<T>(
              'ptah',
              `agentOrchestration.${key}`,
              defaultValue,
            ) ?? defaultValue;

          const result: AgentOrchestrationConfig = {
            detectedClis,
            preferredAgentOrder: getCfg<string[]>('preferredAgentOrder', []),
            maxConcurrentAgents: getCfg<number>('maxConcurrentAgents', 5),
            geminiModel: getCfg<string>('geminiModel', ''),
            codexModel: getCfg<string>('codexModel', ''),
            copilotModel: getCfg<string>('copilotModel', ''),
            cursorModel: getCfg<string>('cursorModel', ''),
            cursorApiKeyConfigured: this.isCursorApiKeyConfigured(),
            codexAutoApprove: getCfg<boolean>('codexAutoApprove', true),
            copilotAutoApprove: getCfg<boolean>('copilotAutoApprove', true),
            codexReasoningEffort: getCfg<string>('codexReasoningEffort', ''),
            copilotReasoningEffort: getCfg<string>(
              'copilotReasoningEffort',
              '',
            ),
            disabledClis: getCfg<string[]>('disabledClis', []),
            disabledMcpNamespaces: getCfg<string[]>(
              'disabledMcpNamespaces',
              [],
            ),
            mcpPort:
              this.workspaceProvider.getConfiguration<number>(
                'ptah',
                'mcpPort',
                51820,
              ) ?? 51820,
            browserAllowLocalhost:
              this.workspaceProvider.getConfiguration<boolean>(
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
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AgentRpcHandlers.registerGetConfig' },
          );
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
   * agent:setConfig - Update agent orchestration settings
   *
   * Writes to VS Code workspace configuration.
   * Only updates fields that are provided in params.
   * Retries once if settings.json has unsaved changes (dirty file).
   */
  private registerSetConfig(): void {
    this.rpcHandler.registerMethod<
      AgentSetConfigParams,
      { success: boolean; error?: string }
    >('agent:setConfig', async (params) => {
      try {
        this.logger.debug('RPC: agent:setConfig called', { params });

        await this.applyConfigUpdates(params);

        this.logger.debug('RPC: agent:setConfig success');
        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(errorMessage),
          { errorSource: 'AgentRpcHandlers.registerSetConfig' },
        );
        this.logger.error(
          'RPC: agent:setConfig failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * Apply all config updates, retrying once if settings.json has unsaved changes.
   *
   * VS Code rejects config.update() when the user settings file is dirty
   * (has unsaved changes in the editor). This method catches that specific
   * error, saves only the dirty settings document, and retries once.
   */
  private async applyConfigUpdates(
    params: AgentSetConfigParams,
  ): Promise<void> {
    try {
      await this.doApplyConfigUpdates(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hasDirtySettings = vscode.workspace.textDocuments.some(
        (doc) =>
          doc.isDirty &&
          doc.uri.scheme === 'vscode-userdata' &&
          doc.uri.path.endsWith('settings.json'),
      );
      if (message.includes('unsaved changes') || hasDirtySettings) {
        this.logger.info(
          'RPC: agent:setConfig retrying after saving dirty settings file',
        );
        await this.saveDirtySettingsDocument();
        await new Promise((resolve) => setTimeout(resolve, 200));
        await this.doApplyConfigUpdates(params);
      } else {
        throw error;
      }
    }
  }

  /**
   * Save only the user settings document if it's dirty.
   * Falls back to saving the active editor if the settings document isn't found directly.
   */
  private async saveDirtySettingsDocument(): Promise<void> {
    const settingsDoc = vscode.workspace.textDocuments.find(
      (doc) =>
        doc.isDirty &&
        doc.uri.path.endsWith('settings.json') &&
        (doc.uri.scheme === 'vscode-userdata' || doc.uri.scheme === 'file'),
    );
    if (settingsDoc) {
      await settingsDoc.save();
      return;
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor?.document.isDirty &&
      activeEditor.document.uri.path.endsWith('settings.json')
    ) {
      await activeEditor.document.save();
    }
  }

  /**
   * Perform configuration updates for all provided params.
   *
   * Uses IWorkspaceProvider.setConfiguration() so file-based keys (codexModel,
   * copilotModel, etc.) route to ~/.ptah/settings.json via PtahFileSettingsManager.
   * Non-file-based keys (preferredAgentOrder, maxConcurrentAgents, etc.) write
   * to VS Code settings via the same IWorkspaceProvider (which delegates to
   * vscode.workspace.getConfiguration for non-file-based keys).
   */
  private async doApplyConfigUpdates(
    params: AgentSetConfigParams,
  ): Promise<void> {
    const setCfg = async (key: string, value: unknown): Promise<void> => {
      await this.workspaceProvider.setConfiguration(
        'ptah',
        `agentOrchestration.${key}`,
        value,
      );
    };
    if (params.preferredAgentOrder !== undefined) {
      await setCfg(
        'preferredAgentOrder',
        params.preferredAgentOrder.length > 0
          ? params.preferredAgentOrder
          : undefined,
      );
    }

    if (params.maxConcurrentAgents !== undefined) {
      const clamped = Math.max(1, Math.min(10, params.maxConcurrentAgents));
      await setCfg('maxConcurrentAgents', clamped);
    }

    if (params.geminiModel !== undefined) {
      await setCfg('geminiModel', params.geminiModel || undefined);
    }
    if (params.codexModel !== undefined) {
      await setCfg('codexModel', params.codexModel || undefined);
    }

    if (params.copilotModel !== undefined) {
      await setCfg('copilotModel', params.copilotModel || undefined);
    }

    if (params.cursorModel !== undefined) {
      await setCfg('cursorModel', params.cursorModel || undefined);
    }

    if (params.cursorApiKey !== undefined) {
      await this.workspaceProvider.setConfiguration(
        'ptah',
        'provider.cursor.apiKey',
        params.cursorApiKey,
      );
      this.cliDetection.invalidateCache();
    }

    if (params.copilotAutoApprove !== undefined) {
      await setCfg('copilotAutoApprove', params.copilotAutoApprove);
      const copilotAdapter = this.cliDetection.getAdapter('copilot');
      if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
        const bridge = (
          copilotAdapter as { permissionBridge: CopilotPermissionBridge }
        ).permissionBridge;
        bridge.setAutoApprove(params.copilotAutoApprove);
      }
    }

    if (params.codexReasoningEffort !== undefined) {
      await setCfg(
        'codexReasoningEffort',
        params.codexReasoningEffort || undefined,
      );
    }

    if (params.copilotReasoningEffort !== undefined) {
      await setCfg(
        'copilotReasoningEffort',
        params.copilotReasoningEffort || undefined,
      );
    }

    if (params.disabledClis !== undefined) {
      await setCfg(
        'disabledClis',
        params.disabledClis.length > 0 ? params.disabledClis : undefined,
      );
    }

    if (params.disabledMcpNamespaces !== undefined) {
      await setCfg(
        'disabledMcpNamespaces',
        params.disabledMcpNamespaces.length > 0
          ? params.disabledMcpNamespaces
          : undefined,
      );
    }
    if (params.browserAllowLocalhost !== undefined) {
      await this.workspaceProvider.setConfiguration(
        'ptah',
        'browser.allowLocalhost',
        params.browserAllowLocalhost,
      );
    }
    if (params.mcpPort !== undefined) {
      const clampedPort = Math.max(1024, Math.min(65535, params.mcpPort));
      await this.workspaceProvider.setConfiguration(
        'ptah',
        'mcpPort',
        clampedPort,
      );
    }
  }

  /**
   * agent:detectClis - Re-detect installed CLI agents
   *
   * Invalidates the detection cache and performs fresh detection.
   * Used by the "Re-detect" button in settings UI.
   */
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
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AgentRpcHandlers.registerDetectClis' },
          );
          this.logger.error(
            'RPC: agent:detectClis failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  /**
   * agent:listCliModels - List available models for each installed CLI
   *
   * For Copilot: dynamically queries VS Code LM API for `copilot/*` models
   * (same models shown in the VS Code Language Model dropdown), strips the
   * `copilot/` prefix, and generates clean display names. Falls back to the
   * adapter's curated list if the LM API call fails.
   *
   * For Gemini: uses the adapter's curated list (no VS Code LM integration).
   */
  private registerListCliModels(): void {
    this.rpcHandler.registerMethod<void, AgentListCliModelsResult>(
      'agent:listCliModels',
      async () => {
        try {
          this.logger.debug('RPC: agent:listCliModels called');

          const modelMap = await this.cliDetection.listModelsForAll();
          const gemini = (modelMap['gemini'] ?? []) as CliModelOption[];
          const codex = (modelMap['codex'] ?? []) as CliModelOption[];
          const cursor = (modelMap['cursor'] ?? []) as CliModelOption[];
          let copilot = await this.getCopilotModelsFromVsCodeLm();
          if (copilot.length === 0) {
            copilot = (modelMap['copilot'] ?? []) as CliModelOption[];
          }

          const result: AgentListCliModelsResult = {
            gemini,
            codex,
            copilot,
            cursor,
          };

          this.logger.debug('RPC: agent:listCliModels success', {
            geminiCount: result.gemini.length,
            codexCount: result.codex.length,
            copilotCount: result.copilot.length,
            cursorCount: result.cursor.length,
          });

          return result;
        } catch (error) {
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AgentRpcHandlers.registerListCliModels' },
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
   * Merge Ptah CLI agents into CLI detection results.
   * Each enabled agent with an API key appears as a `ptah-cli` entry.
   */
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
    const fileKey = this.workspaceProvider.getConfiguration<string>(
      'ptah',
      'provider.cursor.apiKey',
      '',
    );
    return !!fileKey && fileKey.trim().length > 0;
  }

  /**
   * Query VS Code LM API for Copilot models, strip `copilot/` prefix,
   * and generate human-readable display names.
   * Returns empty array on failure (caller falls back to curated list).
   */
  private async getCopilotModelsFromVsCodeLm(): Promise<CliModelOption[]> {
    try {
      const models = await vscode.lm.selectChatModels();
      const copilotModels = models.filter((m) => m.vendor === 'copilot');
      if (copilotModels.length === 0) return [];

      return copilotModels.map((m) => ({
        id: m.family,
        name: this.formatModelDisplayName(m.family),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Convert a model family slug to a human-readable name.
   * e.g. "claude-opus-4.6" → "Claude Opus 4.6"
   *      "gpt-5.3-codex"   → "GPT 5.3 Codex"
   *      "gemini-3-pro-preview" → "Gemini 3 Pro Preview"
   */
  private formatModelDisplayName(family: string): string {
    return family
      .split('-')
      .map((part) => {
        if (/^\d/.test(part)) return part;
        const upper = part.toUpperCase();
        if (['GPT', 'AI'].includes(upper)) return upper;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
  }

  /**
   * agent:permissionResponse - Route user's permission decision to handlers
   *
   * Called by the webview when the user clicks Allow/Deny on a permission dialog
   * in the agent monitor panel. Tries both:
   * 1. SdkPermissionHandler (Ptah CLI agent permissions) - via lazy container resolution
   * 2. CopilotPermissionBridge (Copilot SDK permissions) - via CLI adapter
   *
   * Both handlers silently ignore unknown requestIds, so trying both is safe.
   * Routes to SdkPermissionHandler for Ptah CLI agents and to
   * CopilotPermissionBridge for Copilot SDK permissions.
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
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(errorMessage),
          { errorSource: 'AgentRpcHandlers.registerPermissionResponse' },
        );
        this.logger.error(
          'RPC: agent:permissionResponse failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * agent:stop - Stop a running CLI agent by agentId.
   *
   * Called from the agent monitor panel's stop button.
   * Delegates to AgentProcessManager.stop() which handles both
   * CLI processes (SIGTERM/taskkill) and SDK agents (AbortController).
   */
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
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(errorMessage),
          { errorSource: 'AgentRpcHandlers.registerAgentStop' },
        );
        this.logger.error(
          'RPC: agent:stop failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * agent:resumeCliSession - Resume a CLI agent session.
   *
   * For real CLIs (Gemini, Copilot, Codex): spawns a new CLI process with
   * resumeSessionId set (--resume flag, client.resumeSession(), etc.).
   *
   * For Ptah CLI: routes through PtahCliRegistry.spawnAgent() with
   * resumeSessionId, since ptah-cli is an in-process SDK adapter, not a
   * real CLI binary.
   */
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

        let result;
        let ptahCliId = params.ptahCliId;
        if (params.cli === 'ptah-cli' && !ptahCliId) {
          ptahCliId = await this.resolveDefaultPtahCliId();
        }

        if (params.cli === 'ptah-cli' && ptahCliId) {
          result = await this.resumePtahCliSession({ ...params, ptahCliId });
        } else if (params.cli === 'ptah-cli') {
          throw new Error(
            'No Ptah CLI agents configured. Add one in Agent Orchestration settings.',
          );
        } else {
          const workspaceRoot = this.workspaceProvider.getWorkspaceRoot() ?? '';
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
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(errorMessage),
          { errorSource: 'AgentRpcHandlers.registerResumeCliSession' },
        );
        this.logger.error(
          'RPC: agent:resumeCliSession failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * Resume a Ptah CLI agent session via PtahCliRegistry.
   * Ptah CLI is an in-process SDK adapter — it cannot be spawned as a CLI binary.
   * Instead, we call PtahCliRegistry.spawnAgent() with resumeSessionId which
   * sets the SDK's native `resume` field in query options.
   */
  private async resumePtahCliSession(params: {
    cliSessionId: string;
    cli: CliType;
    task: string;
    parentSessionId?: string;
    ptahCliId: string;
    previousAgentId?: string;
  }): Promise<import('@ptah-extension/shared').SpawnAgentResult> {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot() ?? '';
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

  /**
   * Resolve a default ptahCliId when the session doesn't have one stored
   * (backward compatibility for sessions created before ptahCliId tracking).
   * Returns the first enabled agent with an API key, or undefined if none available.
   */
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
