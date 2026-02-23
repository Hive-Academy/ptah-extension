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
import { CliDetectionService } from '@ptah-extension/llm-abstraction';
import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
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
    private readonly cliDetection: CliDetectionService
  ) {}

  /**
   * Register all agent orchestration RPC methods
   */
  register(): void {
    this.registerGetConfig();
    this.registerSetConfig();
    this.registerDetectClis();

    this.logger.debug('Agent orchestration RPC handlers registered', {
      methods: ['agent:getConfig', 'agent:setConfig', 'agent:detectClis'],
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
          const detectedClis = await this.cliDetection.detectAll();

          const result: AgentOrchestrationConfig = {
            detectedClis,
            defaultCli: config.get<CliType | null>('defaultCli', null),
            maxConcurrentAgents: config.get<number>('maxConcurrentAgents', 3),
            defaultTimeout: config.get<number>('defaultTimeout', 10),
            geminiModel: config.get<string>('geminiModel', ''),
            copilotModel: config.get<string>('copilotModel', ''),
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
   */
  private registerSetConfig(): void {
    this.rpcHandler.registerMethod<
      AgentSetConfigParams,
      { success: boolean; error?: string }
    >('agent:setConfig', async (params) => {
      try {
        this.logger.debug('RPC: agent:setConfig called', { params });

        const config = vscode.workspace.getConfiguration(
          'ptah.agentOrchestration'
        );

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
          await config.update(
            'defaultTimeout',
            params.defaultTimeout,
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
          const clis = await this.cliDetection.detectAll();

          this.logger.debug('RPC: agent:detectClis success', {
            cliCount: clis.length,
            installedCount: clis.filter((c) => c.installed).length,
          });

          return { clis };
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
}
