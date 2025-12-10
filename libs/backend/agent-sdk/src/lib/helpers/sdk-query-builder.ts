/**
 * SDK Query Builder
 *
 * Encapsulates the logic for building SDK query options.
 * Used by both startChatSession and resumeSession to avoid duplication.
 */

import { injectable, inject } from 'tsyringe';
import { AISessionConfig } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SdkPermissionHandler } from '../sdk-permission-handler';
import { SDK_TOKENS } from '../di/tokens';
import type { SDKUserMessage } from './session-lifecycle-manager';

/**
 * Permission mode type for SDK
 */
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/**
 * SDK query options structure
 */
export interface SdkQueryOptions {
  prompt: AsyncIterable<SDKUserMessage>;
  options: {
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
    /** MCP server configurations */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpServers: Record<string, any>;
    permissionMode: PermissionMode;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    canUseTool: any;
    includePartialMessages: boolean;
    /** Control which filesystem settings to load: 'user', 'project', 'local' */
    settingSources?: Array<'user' | 'project' | 'local'>;
    /** Environment variables to pass to the Claude Code process */
    env?: Record<string, string | undefined>;
    /** Callback for stderr output from the Claude Code process - useful for debugging */
    stderr?: (data: string) => void;
  };
}

/**
 * Configuration for building SDK query
 */
export interface QueryBuildConfig {
  userMessageStream: AsyncIterable<SDKUserMessage>;
  abortController: AbortController;
  sessionConfig?: AISessionConfig;
  cliExecutablePath?: string;
  resumeSessionId?: string;
}

/**
 * Default port for Ptah HTTP MCP server (from vscode-lm-tools/CodeExecutionMCP)
 */
const PTAH_MCP_PORT = 51820;

/**
 * SdkQueryBuilder - Builds SDK query options
 *
 * Centralizes the construction of query options to ensure consistency
 * between new sessions and resumed sessions.
 */
@injectable()
export class SdkQueryBuilder {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private readonly permissionHandler: SdkPermissionHandler
  ) {}

  /**
   * Build SDK query options for new or resumed session
   */
  async build(config: QueryBuildConfig): Promise<SdkQueryOptions> {
    const {
      userMessageStream,
      abortController,
      sessionConfig,
      resumeSessionId,
    } = config;

    const model = sessionConfig?.model || 'claude-sonnet-4.5-20250929';
    const cwd = sessionConfig?.projectPath || process.cwd();

    // Build system prompt configuration
    const systemPrompt = sessionConfig?.systemPrompt
      ? {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: sessionConfig.systemPrompt,
        }
      : {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        };

    // Log query options
    this.logger.debug('[SdkQueryBuilder] Building SDK query options', {
      cwd,
      model,
      isResume: !!resumeSessionId,
      resumeSessionId: resumeSessionId
        ? `${resumeSessionId.slice(0, 8)}...`
        : undefined,
    });

    return {
      prompt: userMessageStream,
      options: {
        abortController,
        cwd,
        model,
        resume: resumeSessionId,
        maxTurns: sessionConfig?.maxTokens
          ? Math.floor(sessionConfig.maxTokens / 1000)
          : undefined,
        systemPrompt,
        tools: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        // Use HTTP MCP server from vscode-lm-tools/CodeExecutionMCP
        // Provides execute_code tool with 11 Ptah API namespaces
        mcpServers: {
          ptah: {
            type: 'http',
            url: `http://localhost:${PTAH_MCP_PORT}`,
          },
        },
        permissionMode: 'default',
        canUseTool: this.permissionHandler.createCallback(),
        includePartialMessages: true,
        // Load settings from user and project directories
        // Required for CLAUDE.md files and proper CLI initialization
        settingSources: ['user', 'project', 'local'],
        // Pass current environment variables (includes CLAUDE_CODE_OAUTH_TOKEN from AuthManager)
        env: process.env as Record<string, string | undefined>,
        // Capture stderr for debugging CLI failures
        stderr: (data: string) => {
          this.logger.error(`[SdkQueryBuilder] CLI stderr: ${data}`);
        },
      },
    };
  }
}
