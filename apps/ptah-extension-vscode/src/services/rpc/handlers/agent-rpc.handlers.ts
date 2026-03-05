/**
 * Agent Orchestration RPC Handlers
 *
 * Handles agent orchestration RPC methods:
 * - agent:getConfig - Get agent orchestration configuration + CLI detection results
 * - agent:setConfig - Update agent orchestration VS Code settings
 * - agent:detectClis - Re-detect installed CLI agents (invalidates cache)
 *
 * TASK_2025_157: Agent Orchestration Settings UI
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import {
  CliDetectionService,
  CopilotPermissionBridge,
  AgentProcessManager,
} from '@ptah-extension/llm-abstraction';
import { SDK_TOKENS, PtahCliRegistry } from '@ptah-extension/agent-sdk';
import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  AgentListCliModelsResult,
  CliModelOption,
  AgentPermissionDecision,
} from '@ptah-extension/shared';
import type { CliDetectionResult, CliType } from '@ptah-extension/shared';
import * as vscode from 'vscode';

/**
 * RPC handlers for agent orchestration operations.
 *
 * TASK_2025_157: Agent Orchestration Settings UI
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
    @inject(SDK_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry,
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agentProcessManager: AgentProcessManager
  ) {}

  /**
   * Register all agent orchestration RPC methods
   */
  register(): void {
    this.registerGetConfig();
    this.registerSetConfig();
    this.registerDetectClis();
    this.registerListCliModels();
    this.registerPermissionResponse(); // TASK_2025_162
    this.registerAgentStop();
    this.registerResumeCliSession(); // TASK_2025_173

    // Initialize Copilot auto-approve from saved config (default: true)
    const copilotAutoApprove = vscode.workspace
      .getConfiguration('ptah.agentOrchestration')
      .get<boolean>('copilotAutoApprove', true);
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
   * Reads VS Code settings and combines with CLI detection results.
   * Uses cached detection results (fast after first call).
   */
  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<void, AgentOrchestrationConfig>(
      'agent:getConfig',
      async () => {
        try {
          this.logger.debug('RPC: agent:getConfig called');

          const config = vscode.workspace.getConfiguration(
            'ptah.agentOrchestration'
          );
          const cliResults = await this.cliDetection.detectAll();

          // Merge Ptah CLI agents as CLI entries alongside gemini/codex/copilot
          const detectedClis = await this.mergePtahCliAgents(cliResults);

          const result: AgentOrchestrationConfig = {
            detectedClis,
            defaultCli: config.get<CliType | null>('defaultCli', null),
            maxConcurrentAgents: config.get<number>('maxConcurrentAgents', 5),
            defaultTimeout: config.get<number>('defaultTimeout', 10),
            geminiModel: config.get<string>('geminiModel', ''),
            copilotModel: config.get<string>('copilotModel', ''),
            copilotAutoApprove: config.get<boolean>('copilotAutoApprove', true),
          };

          this.logger.debug('RPC: agent:getConfig success', {
            cliCount: detectedClis.length,
            installedCount: detectedClis.filter((c) => c.installed).length,
          });

          return result;
        } catch (error) {
          this.logger.error(
            'RPC: agent:getConfig failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
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
        this.logger.error(
          'RPC: agent:setConfig failed',
          error instanceof Error ? error : new Error(errorMessage)
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
    params: AgentSetConfigParams
  ): Promise<void> {
    try {
      await this.doApplyConfigUpdates(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Detect the specific "unsaved changes" error from VS Code config API
      const hasDirtySettings = vscode.workspace.textDocuments.some(
        (doc) =>
          doc.isDirty &&
          doc.uri.scheme === 'vscode-userdata' &&
          doc.uri.path.endsWith('settings.json')
      );
      if (message.includes('unsaved changes') || hasDirtySettings) {
        this.logger.info(
          'RPC: agent:setConfig retrying after saving dirty settings file'
        );
        // Save only the dirty settings document (not all open files)
        await this.saveDirtySettingsDocument();
        // Delay to let VS Code process the save
        await new Promise((resolve) => setTimeout(resolve, 200));
        // Retry once
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
    // Try to find the settings document among open text documents
    const settingsDoc = vscode.workspace.textDocuments.find(
      (doc) =>
        doc.isDirty &&
        doc.uri.path.endsWith('settings.json') &&
        (doc.uri.scheme === 'vscode-userdata' || doc.uri.scheme === 'file')
    );
    if (settingsDoc) {
      await settingsDoc.save();
      return;
    }
    // Fallback: save the active text editor if it's a settings file
    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor?.document.isDirty &&
      activeEditor.document.uri.path.endsWith('settings.json')
    ) {
      await activeEditor.document.save();
    }
  }

  /**
   * Perform the actual VS Code configuration updates for all provided params.
   */
  private async doApplyConfigUpdates(
    params: AgentSetConfigParams
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('ptah.agentOrchestration');

    if (params.defaultCli !== undefined) {
      await config.update(
        'defaultCli',
        params.defaultCli,
        vscode.ConfigurationTarget.Global
      );
    }

    if (params.maxConcurrentAgents !== undefined) {
      const clamped = Math.max(1, Math.min(10, params.maxConcurrentAgents));
      await config.update(
        'maxConcurrentAgents',
        clamped,
        vscode.ConfigurationTarget.Global
      );
    }

    if (params.defaultTimeout !== undefined) {
      const clampedTimeout = Math.max(1, Math.min(120, params.defaultTimeout));
      await config.update(
        'defaultTimeout',
        clampedTimeout,
        vscode.ConfigurationTarget.Global
      );
    }

    if (params.geminiModel !== undefined) {
      await config.update(
        'geminiModel',
        params.geminiModel || undefined,
        vscode.ConfigurationTarget.Global
      );
    }

    if (params.copilotModel !== undefined) {
      await config.update(
        'copilotModel',
        params.copilotModel || undefined,
        vscode.ConfigurationTarget.Global
      );
    }

    if (params.copilotAutoApprove !== undefined) {
      await config.update(
        'copilotAutoApprove',
        params.copilotAutoApprove,
        vscode.ConfigurationTarget.Global
      );

      // Sync to the live CopilotPermissionBridge
      const copilotAdapter = this.cliDetection.getAdapter('copilot');
      if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
        const bridge = (
          copilotAdapter as { permissionBridge: CopilotPermissionBridge }
        ).permissionBridge;
        bridge.setAutoApprove(params.copilotAutoApprove);
      }
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

          // Merge Ptah CLI agents alongside detected CLIs (same logic as getConfig)
          const detectedClis = await this.mergePtahCliAgents(cliResults);

          this.logger.debug('RPC: agent:detectClis success', {
            cliCount: detectedClis.length,
            installedCount: detectedClis.filter((c) => c.installed).length,
          });

          return { clis: detectedClis };
        } catch (error) {
          this.logger.error(
            'RPC: agent:detectClis failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
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

          // Gemini: use adapter's curated list
          const gemini = (modelMap['gemini'] ?? []) as CliModelOption[];

          // Copilot: try VS Code LM API first for dynamic models
          let copilot = await this.getCopilotModelsFromVsCodeLm();
          if (copilot.length === 0) {
            // Fallback to adapter's curated list
            copilot = (modelMap['copilot'] ?? []) as CliModelOption[];
          }

          const result: AgentListCliModelsResult = { gemini, copilot };

          this.logger.debug('RPC: agent:listCliModels success', {
            geminiCount: result.gemini.length,
            copilotCount: result.copilot.length,
          });

          return result;
        } catch (error) {
          this.logger.error(
            'RPC: agent:listCliModels failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * Merge Ptah CLI agents into CLI detection results.
   * Each enabled agent with an API key appears as a `ptah-cli` entry.
   */
  private async mergePtahCliAgents(
    cliResults: CliDetectionResult[]
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
   * Query VS Code LM API for Copilot models, strip `copilot/` prefix,
   * and generate human-readable display names.
   * Returns empty array on failure (caller falls back to curated list).
   */
  private async getCopilotModelsFromVsCodeLm(): Promise<CliModelOption[]> {
    try {
      const models = await vscode.lm.selectChatModels();

      // Filter to copilot vendor models only
      const copilotModels = models.filter((m) => m.vendor === 'copilot');
      if (copilotModels.length === 0) return [];

      return copilotModels.map((m) => ({
        // The CLI model ID is the family name without vendor prefix
        // e.g. "copilot/claude-opus-4.6" → "claude-opus-4.6"
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
        // Preserve version numbers as-is (e.g., "4.6", "5.3")
        if (/^\d/.test(part)) return part;
        // Uppercase known acronyms
        const upper = part.toUpperCase();
        if (['GPT', 'AI'].includes(upper)) return upper;
        // Title-case everything else
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
  }

  /**
   * agent:permissionResponse - Route user's permission decision to Copilot SDK bridge
   *
   * Called by the webview when the user clicks Allow/Deny on a permission dialog.
   * Resolves the pending permission Promise in the CopilotPermissionBridge, which
   * unblocks the SDK's onPreToolUse hook.
   *
   * TASK_2025_162: Copilot SDK Integration
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

        const copilotAdapter = this.cliDetection.getAdapter('copilot');
        if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
          const bridge = (
            copilotAdapter as { permissionBridge: CopilotPermissionBridge }
          ).permissionBridge;
          bridge.resolvePermission(params.requestId, params);
          return { success: true };
        }

        return { success: false, error: 'Copilot SDK adapter not active' };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:permissionResponse failed',
          error instanceof Error ? error : new Error(errorMessage)
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
        this.logger.error(
          'RPC: agent:stop failed',
          error instanceof Error ? error : new Error(errorMessage)
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
   *
   * TASK_2025_173: CLI agent session resume-on-click
   */
  private registerResumeCliSession(): void {
    this.rpcHandler.registerMethod<
      {
        cliSessionId: string;
        cli: CliType;
        task: string;
        parentSessionId?: string;
        ptahCliId?: string;
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

        // Resolve ptahCliId for backward compatibility: old sessions may not
        // have ptahCliId persisted. Fall back to the first enabled agent.
        let ptahCliId = params.ptahCliId;
        if (params.cli === 'ptah-cli' && !ptahCliId) {
          ptahCliId = await this.resolveDefaultPtahCliId();
        }

        if (params.cli === 'ptah-cli' && ptahCliId) {
          // Ptah CLI: route through PtahCliRegistry (SDK adapter, not a real CLI binary)
          result = await this.resumePtahCliSession({ ...params, ptahCliId });
        } else if (params.cli === 'ptah-cli') {
          // No ptah-cli agents available
          throw new Error(
            'No Ptah CLI agents configured. Add one in Agent Orchestration settings.'
          );
        } else {
          // Real CLIs: route through AgentProcessManager.spawn()
          result = await this.agentProcessManager.spawn({
            cli: params.cli,
            task: params.task,
            resumeSessionId: params.cliSessionId,
            parentSessionId: params.parentSessionId,
            ptahCliId: params.ptahCliId,
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
          error instanceof Error ? error : new Error(errorMessage)
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
  }): Promise<import('@ptah-extension/shared').SpawnAgentResult> {
    const workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    const spawnResult = await this.ptahCliRegistry.spawnAgent(
      params.ptahCliId,
      params.task,
      {
        workingDirectory: workspaceRoot,
        resumeSessionId: params.cliSessionId,
      }
    );

    if ('status' in spawnResult) {
      throw new Error(`Ptah CLI agent resume failed: ${spawnResult.message}`);
    }

    return this.agentProcessManager.spawnFromSdkHandle(spawnResult.handle, {
      task: params.task,
      cli: 'ptah-cli',
      workingDirectory: workspaceRoot,
      parentSessionId: params.parentSessionId,
      ptahCliName: spawnResult.agentName,
      ptahCliId: params.ptahCliId,
    });
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
          { ptahCliId: enabled.id, name: enabled.name }
        );
      }
      return enabled?.id;
    } catch {
      return undefined;
    }
  }
}
