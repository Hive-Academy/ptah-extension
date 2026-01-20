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
import { PTAH_SYSTEM_PROMPT } from '@ptah-extension/vscode-lm-tools';
import { SDK_TOKENS } from '../di/tokens';
import { SdkPermissionHandler } from '../sdk-permission-handler';
import { SubagentHookHandler } from './subagent-hook-handler';
import { CompactionConfigProvider } from './compaction-config-provider';
import {
  CompactionHookHandler,
  type CompactionStartCallback,
} from './compaction-hook-handler';
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
  /**
   * Session ID for hook tracking (TASK_2025_098)
   * Used by compaction hooks to identify which session triggered compaction
   */
  sessionId?: string;
  /**
   * Callback for compaction start events (TASK_2025_098)
   * Called when SDK begins compacting (summarizing) conversation history
   */
  onCompactionStart?: CompactionStartCallback;
  /**
   * Premium user flag - enables MCP server and Ptah system prompt
   * When true, enables Ptah MCP server and appends PTAH_SYSTEM_PROMPT
   * Defaults to false (free tier behavior)
   */
  isPremium?: boolean;
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
  /** SDK compaction control configuration (TASK_2025_098) */
  compactionControl?: {
    enabled: boolean;
    contextTokenThreshold: number;
  };
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
    private readonly subagentHookHandler: SubagentHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    private readonly compactionConfigProvider: CompactionConfigProvider,
    @inject(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER)
    private readonly compactionHookHandler: CompactionHookHandler
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
      sessionId,
      onCompactionStart,
      isPremium = false,
    } = input;

    // Model is required - SDK sets default in config at startup
    if (!sessionConfig?.model) {
      throw new Error('Model not provided - ensure SDK is initialized');
    }

    const model = sessionConfig.model;
    const cwd = sessionConfig?.projectPath || process.cwd();

    // Build system prompt configuration
    const systemPrompt = this.buildSystemPrompt(sessionConfig, isPremium);

    // Create permission callback
    const canUseToolCallback: CanUseTool =
      this.permissionHandler.createCallback();

    // Create merged hooks (subagent + compaction)
    // TASK_2025_098: Pass sessionId and callback for compaction hooks
    const hooks = this.createHooks(cwd, sessionId, onCompactionStart);

    // Get compaction configuration (TASK_2025_098)
    const compactionConfig = this.compactionConfigProvider.getConfig();

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
      compactionEnabled: compactionConfig.enabled,
      compactionThreshold: compactionConfig.contextTokenThreshold,
      // Premium feature status (TASK_2025_108)
      isPremium,
      mcpEnabled: isPremium,
      ptahSystemPromptAppended: isPremium,
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
        mcpServers: this.buildMcpServers(isPremium),
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
        // SDK compaction control (TASK_2025_098)
        // Only include when enabled to avoid sending unnecessary options
        compactionControl: compactionConfig.enabled
          ? {
              enabled: true,
              contextTokenThreshold: compactionConfig.contextTokenThreshold,
            }
          : undefined,
      },
    };
  }

  /**
   * Build system prompt configuration
   *
   * For premium users, appends PTAH_SYSTEM_PROMPT to make Claude aware of
   * Ptah MCP tools. User's custom system prompt (if provided) takes precedence.
   *
   * @param sessionConfig - Session configuration with optional custom system prompt
   * @param isPremium - Whether user has premium features enabled
   * @returns System prompt configuration for SDK
   */
  private buildSystemPrompt(
    sessionConfig?: AISessionConfig,
    isPremium: boolean = false
  ): SdkQueryOptions['systemPrompt'] {
    const appendParts: string[] = [];

    // Add user's custom system prompt if provided
    if (sessionConfig?.systemPrompt) {
      appendParts.push(sessionConfig.systemPrompt);
    }

    // Add Ptah MCP tools awareness for premium users (TASK_2025_108)
    if (isPremium) {
      this.logger.debug(
        '[SdkQueryOptionsBuilder] Premium tier - appending Ptah system prompt'
      );
      appendParts.push(PTAH_SYSTEM_PROMPT);
    }

    return {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
    };
  }

  /**
   * Build MCP servers configuration
   *
   * For premium users, enables the Ptah HTTP MCP server which provides
   * execute_code tool with 11 Ptah API namespaces.
   * For free tier, returns empty object (no MCP servers).
   *
   * @param isPremium - Whether user has premium features enabled
   * @returns MCP servers configuration for SDK
   */
  private buildMcpServers(
    isPremium: boolean
  ): Record<string, McpHttpServerConfig> {
    // Free tier - disable MCP servers (TASK_2025_108)
    if (!isPremium) {
      this.logger.debug(
        '[SdkQueryOptionsBuilder] Free tier - MCP servers disabled'
      );
      return {};
    }

    // Premium user - enable Ptah HTTP MCP server
    // Uses HTTP MCP server from vscode-lm-tools/CodeExecutionMCP
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
   * Create merged lifecycle hooks (subagent + compaction)
   *
   * TASK_2025_098: Now creates both subagent hooks and compaction hooks,
   * merging them into a single hooks object for SDK query options.
   *
   * @param cwd - Working directory for subagent hooks
   * @param sessionId - Session ID for compaction hooks (optional)
   * @param onCompactionStart - Callback for compaction start (optional)
   * @returns Merged hooks configuration for SDK query options
   */
  private createHooks(
    cwd: string,
    sessionId?: string,
    onCompactionStart?: CompactionStartCallback
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    // Create subagent hooks (existing functionality)
    const subagentHooks = this.subagentHookHandler.createHooks(cwd);

    // Create compaction hooks if sessionId is provided (TASK_2025_098)
    // Even without sessionId, we create hooks with empty string - SDK will provide session_id in hook input
    const compactionHooks = this.compactionHookHandler.createHooks(
      sessionId ?? '',
      onCompactionStart
    );

    // Merge hooks - subagent and compaction hooks handle different events
    // SubagentStart/SubagentStop vs PreCompact, so no conflict
    const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
      ...subagentHooks,
      ...compactionHooks,
    };

    // Log hook registration for debugging
    this.logger.info('[SdkQueryOptionsBuilder] SDK hooks created for session', {
      cwd,
      sessionId: sessionId ? `${sessionId.slice(0, 8)}...` : 'not-provided',
      hookEvents: Object.keys(mergedHooks),
      hasSubagentStart: !!mergedHooks.SubagentStart,
      hasSubagentStop: !!mergedHooks.SubagentStop,
      hasPreCompact: !!mergedHooks.PreCompact,
      subagentStartHooksCount: mergedHooks.SubagentStart?.length ?? 0,
      subagentStopHooksCount: mergedHooks.SubagentStop?.length ?? 0,
      preCompactHooksCount: mergedHooks.PreCompact?.length ?? 0,
      hasCompactionCallback: !!onCompactionStart,
    });

    return mergedHooks;
  }
}
