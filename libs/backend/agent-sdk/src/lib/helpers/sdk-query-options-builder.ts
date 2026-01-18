/**
 * SDK Query Options Builder - Constructs SDK query configuration
 *
 * Extracted from SdkAgentAdapter to separate concerns.
 * Handles the complex configuration building for SDK queries including:
 * - System prompt configuration
 * - MCP server setup
 * - Permission callbacks
 * - Subagent hooks
 * - Environment variables
 *
 * Single Responsibility: Build SDK query options from session config
 *
 * @see TASK_2025_102 - Extracted to reduce SdkAgentAdapter complexity
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { AISessionConfig } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { SdkPermissionHandler } from '../sdk-permission-handler';
import { SubagentHookHandler } from './subagent-hook-handler';
import {
  CanUseTool,
  HookEvent,
  HookCallbackMatcher,
  McpHttpServerConfig,
} from '../types/sdk-types/claude-sdk.types';
import type { SDKUserMessage } from './session-lifecycle-manager';

/**
 * Default port for Ptah HTTP MCP server
 * From vscode-lm-tools/CodeExecutionMCP
 */
const PTAH_MCP_PORT = 51820;

/**
 * Input parameters for building query options
 */
export interface QueryOptionsInput {
  /** Async iterable stream of user messages */
  userMessageStream: AsyncIterable<SDKUserMessage>;
  /** Controller to abort the query */
  abortController: AbortController;
  /** Session configuration (model, workspace, system prompt) */
  sessionConfig?: AISessionConfig;
  /** Session ID to resume (undefined for new sessions) */
  resumeSessionId?: string;
}

/**
 * SDK query options structure
 * Matches the options parameter expected by SDK's query() function
 */
export interface SdkQueryOptions {
  abortController: AbortController;
  cwd: string;
  model: string;
  resume?: string;
  maxTurns?: number;
  systemPrompt: {
    type: 'preset';
    preset: 'claude_code';
    append?: string;
  };
  tools: {
    type: 'preset';
    preset: 'claude_code';
  };
  mcpServers: Record<string, McpHttpServerConfig>;
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
  canUseTool?: CanUseTool;
  includePartialMessages: boolean;
  settingSources?: Array<'user' | 'project' | 'local'>;
  env?: Record<string, string | undefined>;
  stderr?: (data: string) => void;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
}

/**
 * Complete query configuration returned by builder
 */
export interface QueryConfig {
  /** User message stream for SDK consumption */
  prompt: AsyncIterable<SDKUserMessage>;
  /** SDK query options */
  options: SdkQueryOptions;
}

/**
 * Builds SDK query options from session configuration
 *
 * Responsibilities:
 * - System prompt construction (preset + optional append)
 * - MCP server configuration (Ptah HTTP server)
 * - Permission callback creation
 * - Subagent lifecycle hooks
 * - Environment variable passthrough
 * - stderr capture for debugging
 */
@injectable()
export class SdkQueryOptionsBuilder {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private readonly permissionHandler: SdkPermissionHandler,
    @inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
    private readonly subagentHookHandler: SubagentHookHandler
  ) {}

  /**
   * Build complete SDK query configuration
   *
   * @param input - Query input parameters
   * @returns Complete query configuration for SDK
   * @throws Error if model is not provided in session config
   *
   * @example
   * ```typescript
   * const config = await builder.build({
   *   userMessageStream,
   *   abortController,
   *   sessionConfig: { model: 'claude-sonnet-4', projectPath: '/workspace' }
   * });
   *
   * const sdkQuery = query({ prompt: config.prompt, options: config.options });
   * ```
   */
  async build(input: QueryOptionsInput): Promise<QueryConfig> {
    const {
      userMessageStream,
      abortController,
      sessionConfig,
      resumeSessionId,
    } = input;

    // Model is required - SDK sets default in config at startup
    if (!sessionConfig?.model) {
      throw new Error('Model not provided - ensure SDK is initialized');
    }

    const model = sessionConfig.model;
    const cwd = sessionConfig?.projectPath || process.cwd();

    // Build system prompt configuration
    const systemPrompt = this.buildSystemPrompt(sessionConfig);

    // Create permission callback
    const canUseToolCallback: CanUseTool =
      this.permissionHandler.createCallback();

    // Create subagent hooks
    const hooks = this.createHooks(cwd);

    // Log query options
    this.logger.info('[SdkQueryOptionsBuilder] Building SDK query options', {
      cwd,
      model,
      isResume: !!resumeSessionId,
      resumeSessionId: resumeSessionId
        ? `${resumeSessionId.slice(0, 8)}...`
        : undefined,
      permissionMode: 'default',
      hasCanUseToolCallback: !!canUseToolCallback,
    });

    return {
      prompt: userMessageStream,
      options: {
        abortController,
        cwd,
        model,
        resume: resumeSessionId,
        maxTurns: this.calculateMaxTurns(sessionConfig),
        systemPrompt,
        tools: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        mcpServers: this.buildMcpServers(),
        // CRITICAL: permissionMode must be 'default' for canUseTool to be invoked
        // If set to 'bypassPermissions', canUseTool is never called
        permissionMode: 'default',
        canUseTool: canUseToolCallback,
        includePartialMessages: true,
        // Load settings from user and project directories
        // Required for CLAUDE.md files and proper CLI initialization
        settingSources: ['user', 'project', 'local'],
        // Pass current environment variables (includes CLAUDE_CODE_OAUTH_TOKEN from AuthManager)
        env: process.env as Record<string, string | undefined>,
        // Capture stderr for debugging CLI failures
        stderr: (data: string) => {
          this.logger.error(`[SdkQueryOptionsBuilder] CLI stderr: ${data}`);
        },
        hooks,
      },
    };
  }

  /**
   * Build system prompt configuration
   */
  private buildSystemPrompt(
    sessionConfig?: AISessionConfig
  ): SdkQueryOptions['systemPrompt'] {
    if (sessionConfig?.systemPrompt) {
      return {
        type: 'preset' as const,
        preset: 'claude_code' as const,
        append: sessionConfig.systemPrompt,
      };
    }

    return {
      type: 'preset' as const,
      preset: 'claude_code' as const,
    };
  }

  /**
   * Build MCP servers configuration
   */
  private buildMcpServers(): Record<string, McpHttpServerConfig> {
    // Use HTTP MCP server from vscode-lm-tools/CodeExecutionMCP
    // Provides execute_code tool with 11 Ptah API namespaces
    return {
      ptah: {
        type: 'http',
        url: `http://localhost:${PTAH_MCP_PORT}`,
      },
    };
  }

  /**
   * Calculate max turns from session config
   */
  private calculateMaxTurns(
    sessionConfig?: AISessionConfig
  ): number | undefined {
    if (sessionConfig?.maxTokens) {
      return Math.floor(sessionConfig.maxTokens / 1000);
    }
    return undefined;
  }

  /**
   * Create subagent lifecycle hooks
   */
  private createHooks(
    cwd: string
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const hooks = this.subagentHookHandler.createHooks(cwd);

    // Log hook registration for debugging
    this.logger.info('[SdkQueryOptionsBuilder] SDK hooks created for session', {
      cwd,
      hookEvents: Object.keys(hooks),
      hasSubagentStart: !!hooks.SubagentStart,
      hasSubagentStop: !!hooks.SubagentStop,
      subagentStartHooksCount: hooks.SubagentStart?.length ?? 0,
      subagentStopHooksCount: hooks.SubagentStop?.length ?? 0,
    });

    return hooks;
  }
}
