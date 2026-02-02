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
 * Ptah behavioral system prompt - always appended (all tiers)
 *
 * Instructs the agent to use AskUserQuestion tool for presenting choices
 * instead of writing questions as plain markdown text. The AskUserQuestion
 * tool renders a structured UI with selectable options in the Ptah extension,
 * providing a much better user experience than plain text questions.
 *
 * Also instructs the agent to propagate this behavior to subagents via
 * the Task tool's prompt parameter.
 */
const PTAH_BEHAVIORAL_PROMPT = `# Ptah Extension - MANDATORY User Interaction Rules

## AskUserQuestion Tool — YOU MUST USE IT

The \`claude_code\` tool preset you are running under includes a tool called **AskUserQuestion**.
It is ALREADY available to you — do NOT claim otherwise. You MUST call it whenever you need the user to make a choice, answer a question, or pick between approaches.

### Tool Schema (exact parameters)

\`\`\`
AskUserQuestion({
  questions: [                          // 1-4 questions per call
    {
      question: string,                 // Full question ending with "?"
      header: string,                   // Short label, max 12 chars (e.g. "Approach")
      options: [                        // 2-4 options per question
        { label: string, description: string }
      ],
      multiSelect: boolean              // true = checkboxes, false = radio
    }
  ]
})
\`\`\`

### WRONG (NEVER do this)

Writing options as plain text in your response:
"Here are your options:
1. Option A — does X
2. Option B — does Y
3. Option C — does Z
Which do you prefer?"

### CORRECT (ALWAYS do this)

Call the AskUserQuestion tool:
\`\`\`json
{
  "questions": [{
    "question": "Which approach should we use?",
    "header": "Approach",
    "options": [
      { "label": "Option A", "description": "Does X" },
      { "label": "Option B", "description": "Does Y" },
      { "label": "Option C", "description": "Does Z" }
    ],
    "multiSelect": false
  }]
}
\`\`\`

### Rules

1. You MUST use AskUserQuestion for ANY situation where you present choices, ask preferences, or need a decision.
2. NEVER present numbered options, bullet-point choices, or "which do you prefer?" as plain text.
3. NEVER claim the tool is unavailable or that you cannot call it — it is part of your tool preset.
4. When spawning subagents via the Task tool, include in the prompt parameter: "If you need to ask the user a question or present choices, you MUST use the AskUserQuestion tool. It is available in your claude_code tool preset. NEVER present choices as plain text."

## Rich Formatting Guidelines

The Ptah extension renders your markdown with enhanced visual styling. To produce the best-looking output, consider these formatting tips (all are optional — standard markdown always works):

- **Use headings** (\`##\`, \`###\`) to give your responses clear structure and visual hierarchy.
- **Use horizontal rules** (\`---\`) to separate major sections — they render as decorative gold dividers.
- **Specify language in code blocks** (e.g. \`\`\`typescript, \`\`\`python) — the language appears as a badge header above the code.
- **Use numbered lists** for sequential steps or instructions — they render as visually distinct step cards with numbered indicators.
- **Use callout syntax** for important information:
  - \`> [!NOTE]\` for general notes
  - \`> [!TIP]\` for helpful tips
  - \`> [!WARNING]\` for warnings
  - \`> [!IMPORTANT]\` for critical information
  - \`> [!CAUTION]\` for dangerous operations
`;

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
  /**
   * Whether the MCP server is currently running (TASK_2025_108)
   * When false, MCP config will not be included even for premium users.
   * This prevents configuring Claude with a dead MCP endpoint.
   * Defaults to true for backward compatibility.
   */
  mcpServerRunning?: boolean;
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
      mcpServerRunning = true,
    } = input;

    // Model is required - SDK sets default in config at startup
    if (!sessionConfig?.model) {
      throw new Error('Model not provided - ensure SDK is initialized');
    }

    const model = sessionConfig.model;
    const cwd = sessionConfig?.projectPath || process.cwd();

    // Log resolved model and tier env vars for debugging (TASK_2025_132)
    this.logger.info(`[SdkQueryOptionsBuilder] SDK call with model: ${model}`, {
      model,
      envSonnet: process.env['ANTHROPIC_DEFAULT_SONNET_MODEL'] || 'default',
      envOpus: process.env['ANTHROPIC_DEFAULT_OPUS_MODEL'] || 'default',
      envHaiku: process.env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] || 'default',
      baseUrl: process.env['ANTHROPIC_BASE_URL'] || 'default',
    });

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
        mcpServers: this.buildMcpServers(isPremium, mcpServerRunning),
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
   * Always appends PTAH_BEHAVIORAL_PROMPT for AskUserQuestion guidance.
   * For premium users, also appends PTAH_SYSTEM_PROMPT for MCP tool awareness.
   * User's custom system prompt (if provided) takes precedence.
   *
   * @param sessionConfig - Session configuration with optional custom system prompt
   * @param isPremium - Whether user has premium features enabled
   * @returns System prompt configuration for SDK
   */
  private buildSystemPrompt(
    sessionConfig?: AISessionConfig,
    isPremium = false
  ): SdkQueryOptions['systemPrompt'] {
    const appendParts: string[] = [];

    // Add user's custom system prompt if provided
    if (sessionConfig?.systemPrompt) {
      appendParts.push(sessionConfig.systemPrompt);
    }

    // Always add Ptah behavioral guidelines (AskUserQuestion usage, subagent instructions)
    // This is not tier-gated since AskUserQuestion is part of the claude_code preset
    appendParts.push(PTAH_BEHAVIORAL_PROMPT);

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
   * TASK_2025_108: Added mcpServerRunning check to prevent configuring
   * Claude with a dead MCP endpoint when the server isn't running.
   *
   * @param isPremium - Whether user has premium features enabled
   * @param mcpServerRunning - Whether the MCP server is currently running
   * @returns MCP servers configuration for SDK
   */
  private buildMcpServers(
    isPremium: boolean,
    mcpServerRunning = true
  ): Record<string, McpHttpServerConfig> {
    // Free tier - disable MCP servers (TASK_2025_108)
    if (!isPremium) {
      this.logger.debug(
        '[SdkQueryOptionsBuilder] Free tier - MCP servers disabled'
      );
      return {};
    }

    // TASK_2025_108: Check if MCP server is running before configuring
    // This prevents configuring Claude with a dead endpoint
    if (!mcpServerRunning) {
      this.logger.warn(
        '[SdkQueryOptionsBuilder] Premium user but MCP server not running - skipping MCP config'
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
