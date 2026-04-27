/**
 * SessionQueryExecutor — owner of the SDK-query orchestration body.
 *
 * Wave C7i extracts `executeQuery` (originally lines 725–961, ~300 LOC) out of
 * `SessionLifecycleManager` into this stateless coordinator. The executor:
 *   - creates the AbortController (the load-bearing identity preserved end-to-
 *     end through registration, queryFn options, and the returned result),
 *   - pre-registers the session via Registry,
 *   - detects slash commands (with the attachment-bypass invariant first),
 *   - seeds the message queue for non-slash-command initial prompts,
 *   - calls SdkModuleLoader → SdkQueryOptionsBuilder → SDK queryFn,
 *   - connects streamInput ONLY when `isResume && !isSlashCommand`,
 *   - records the resulting SDK Query on the Registry,
 *   - rolls back the orphan registration on init failure (Registry.removeSessionOnly).
 *
 * Plain class — NOT @injectable, NOT registered with tsyringe. Constructed
 * eagerly by the facade.
 *
 * Note: `executeSlashCommandQuery` lives on the facade (NOT here) to avoid a
 * `QueryExecutor → Control` forward dependency. The facade orchestrates the
 * end-then-execute sequence directly.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { ISdkPermissionHandler, AuthEnv } from '@ptah-extension/shared';

import {
  SDKUserMessage,
  Options,
} from '../../types/sdk-types/claude-sdk.types';
import type { SdkModuleLoader } from '../sdk-module-loader';
import type { SdkQueryOptionsBuilder } from '../sdk-query-options-builder';
import type { SdkMessageFactory } from '../sdk-message-factory';
import { SlashCommandInterceptor } from '../slash-command-interceptor';
import type {
  ExecuteQueryConfig,
  ExecuteQueryResult,
  Query,
} from '../session-lifecycle-manager';
import type { SessionRegistry } from './session-registry.service';
import type { SessionStreamPump } from './session-stream-pump.service';
import { PERMISSION_MODE_MAP } from './permission-mode-map';

export class SessionQueryExecutor {
  constructor(
    private readonly logger: Logger,
    private readonly registry: SessionRegistry,
    private readonly streamPump: SessionStreamPump,
    private readonly permissionHandler: ISdkPermissionHandler,
    private readonly moduleLoader: SdkModuleLoader,
    private readonly queryOptionsBuilder: SdkQueryOptionsBuilder,
    private readonly messageFactory: SdkMessageFactory,
    private readonly authEnv: AuthEnv,
  ) {}

  /**
   * Execute an SDK query with all the orchestration steps
   * Consolidates the common flow between startChatSession and resumeSession
   *
   * @param config - Query execution configuration
   * @returns Query instance, model, and abort controller
   *
   * @example
   * ```typescript
   * const result = await sessionLifecycle.executeQuery({
   *   sessionId: trackingId,
   *   sessionConfig: config,
   *   initialPrompt: { content: 'Hello', files: [] },
   * });
   * return streamTransformer.transform({ sdkQuery: result.sdkQuery, ... });
   * ```
   */
  async executeQuery(config: ExecuteQueryConfig): Promise<ExecuteQueryResult> {
    const {
      sessionId,
      sessionConfig,
      resumeSessionId,
      initialPrompt,
      onCompactionStart,
      onWorktreeCreated,
      onWorktreeRemoved,
      isPremium = false,
      mcpServerRunning = true,
      enhancedPromptsContent,
      pluginPaths,
      pathToClaudeCodeExecutable,
    } = config;

    this.logger.info(
      `[SessionLifecycle] Executing query for session: ${sessionId}`,
      {
        isResume: !!resumeSessionId,
        hasInitialPrompt: !!initialPrompt,
      },
    );

    // Step 1: Create abort controller
    const abortController = new AbortController();

    // Step 2: Pre-register session
    this.registry.preRegisterActiveSession(
      sessionId,
      sessionConfig || {},
      abortController,
    );

    // Step 3: Determine if initial prompt is a slash command
    // SDK only parses slash commands from raw string prompts, not from SDKUserMessage objects
    // in the async iterable. So slash commands must be passed as string to query().
    // NOTE: If the message has file/image attachments, treat it as a regular message
    // even if it starts with `/` — files can't be passed alongside a string prompt.
    const initialContent = initialPrompt?.content.trim() || '';
    const hasAttachments =
      (initialPrompt?.files && initialPrompt.files.length > 0) ||
      (initialPrompt?.images && initialPrompt.images.length > 0);
    const isSlashCommand =
      SlashCommandInterceptor.isSlashCommand(initialContent) && !hasAttachments;

    // For non-slash-command messages, queue them in the iterable as SDKUserMessage
    if (initialContent && !isSlashCommand) {
      const session = this.registry.getActiveSession(sessionId);
      if (session) {
        const sdkUserMessage = await this.messageFactory.createUserMessage({
          content: initialPrompt!.content, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          sessionId,
          files: initialPrompt!.files, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          images: initialPrompt!.images, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        });
        session.messageQueue.push(sdkUserMessage);
        this.logger.info(
          `[SessionLifecycle] Queued initial prompt for session ${sessionId}`,
        );
      }
    }

    // Steps 4-7 may throw (SDK module load failure, options build failure,
    // query construction failure). If any step fails after preRegisterActiveSession
    // in Step 2, the session would be left orphaned in activeSessions. Wrap the
    // init sequence in try/catch and clean up the pre-registered session on failure.
    try {
      // Step 4: Get SDK query function
      const queryFn = await this.moduleLoader.getQueryFunction();

      // Step 5: Create user message stream
      const userMessageStream = this.streamPump.createUserMessageStream(
        sessionId,
        abortController,
      );

      // Step 6: Build query options
      // TASK_2025_098: Pass sessionId and onCompactionStart for compaction hooks
      // TASK_2025_108: Pass isPremium and mcpServerRunning for premium feature gating (MCP + system prompt)
      // Resolve initial SDK permission mode from current autopilot config
      const currentLevel = this.permissionHandler.getPermissionLevel();
      const initialPermissionMode =
        currentLevel === 'ask'
          ? 'default'
          : (PERMISSION_MODE_MAP[currentLevel] as
              | 'default'
              | 'acceptEdits'
              | 'bypassPermissions'
              | 'plan');

      // Guard so we only abort once per session on the first provider error —
      // multiple stderr chunks can match, and repeated aborts would log noise.
      let providerErrorAborted = false;
      const queryOptions = await this.queryOptionsBuilder.build({
        userMessageStream,
        abortController,
        sessionConfig,
        resumeSessionId,
        sessionId: sessionId as string,
        onCompactionStart,
        onWorktreeCreated,
        onWorktreeRemoved,
        isPremium,
        mcpServerRunning,
        enhancedPromptsContent,
        pluginPaths,
        permissionMode: initialPermissionMode,
        pathToClaudeCodeExecutable,
        onProviderError: (stderrChunk: string) => {
          if (providerErrorAborted || abortController.signal.aborted) return;
          providerErrorAborted = true;
          const baseUrl = this.authEnv.ANTHROPIC_BASE_URL?.trim() || 'default';
          const model = sessionConfig?.model ?? 'unknown';
          const summary = stderrChunk.slice(0, 500);
          this.logger.error(
            `[SessionLifecycle] Provider error detected on stderr — aborting session ${sessionId} ` +
              `(baseUrl=${baseUrl}, model=${model}): ${summary}`,
          );
          try {
            abortController.abort(
              new Error(
                `Provider returned an error (baseUrl="${baseUrl}", model="${model}"). ` +
                  `Details: ${summary}`,
              ),
            );
          } catch (abortErr) {
            this.logger.warn(
              '[SessionLifecycle] Failed to abort on provider error',
              abortErr instanceof Error
                ? abortErr
                : new Error(String(abortErr)),
            );
          }
        },
      });

      // Determine the effective prompt for the SDK query:
      // - Resume sessions: idle prompt (messages via streamInput)
      // - Slash commands: raw string (SDK parses commands from string prompts only)
      // - Regular messages: iterable (messages queued as SDKUserMessage)
      const isResume = !!resumeSessionId;
      let effectivePrompt: string | AsyncIterable<SDKUserMessage>;
      let promptMode: string;

      if (isSlashCommand) {
        // TASK_2025_184: Slash commands MUST be passed as raw string prompt
        // even when resuming. The SDK only parses commands from string prompts.
        effectivePrompt = initialContent;
        promptMode = isResume
          ? 'string (slash command + resume)'
          : 'string (slash command)';
      } else if (isResume) {
        effectivePrompt =
          this.streamPump.createIdlePromptStream(abortController);
        promptMode = 'idle+streamInput';
      } else {
        effectivePrompt = queryOptions.prompt;
        promptMode = 'iterable';
      }

      // NOTE: Do NOT set maxTurns: 1 for slash commands.
      // Built-in commands (/compact, /cost, /context) bypass the turn loop entirely
      // (SDK TerminalReason is "unset" for local slash commands), so maxTurns is
      // irrelevant. Setting maxTurns: 1 actually BREAKS command recognition — the
      // SDK sends the raw string to Claude as a regular message instead of parsing
      // it as a built-in command.
      // The session terminates naturally because streamInput is not connected
      // (see Step 7b below), so no further input can arrive after the command.

      this.logger.info('[SessionLifecycle] Starting SDK query with options', {
        model: queryOptions.options.model,
        cwd: queryOptions.options.cwd,
        permissionMode: queryOptions.options.permissionMode,
        maxTurns: queryOptions.options.maxTurns,
        isResume,
        isSlashCommand,
        promptMode,
      });

      // Step 7: Start SDK query
      const sdkQuery: Query = queryFn({
        prompt: effectivePrompt,
        options: queryOptions.options as Options,
      });
      const initialModel = queryOptions.options.model;

      // Step 7b: Connect streamInput for follow-up message delivery
      // Resume sessions: ALL messages come via streamInput (idle prompt)
      // Regular sessions: follow-up messages come from the iterable
      // Slash commands: Do NOT connect streamInput. The SDK processes the
      // command from the string prompt and terminates naturally. Connecting
      // streamInput would keep the query alive waiting for input that never
      // comes, preventing the for-await-of loop from exiting.
      if (isResume && !isSlashCommand) {
        sdkQuery.streamInput(userMessageStream).catch((err) => {
          this.logger.warn('[SessionLifecycle] streamInput error', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        this.logger.info(
          `[SessionLifecycle] Connected streamInput for session: ${sessionId} (${promptMode})`,
        );
      }

      // Step 8: Set the query on the session
      this.registry.setSessionQuery(sessionId, sdkQuery);

      this.logger.info(
        `[SessionLifecycle] Query started for session: ${sessionId}`,
      );

      return {
        sdkQuery,
        initialModel,
        abortController,
      };
    } catch (err) {
      // Init failed after preRegisterActiveSession — remove the orphan session
      // so retries aren't blocked by a stale entry and callers see a clean error.
      this.registry.removeSessionOnly(sessionId as string);
      try {
        abortController.abort();
      } catch {
        // ignore
      }
      this.logger.error(
        `[SessionLifecycle] Query init failed for session ${sessionId}; rolling back pre-registration`,
        err instanceof Error ? err : new Error(String(err)),
      );
      throw err;
    }
  }
}
