/**
 * SessionQueryExecutor — owner of the SDK-query orchestration body.
 *
 * Extracted `executeQuery` (originally lines 725–961, ~300 LOC) out of
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
import type { SdkQueryRunner } from '../sdk-query-runner.service';

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
    private readonly queryRunner: SdkQueryRunner,
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
      forkSession,
      enableFileCheckpointing,
      includePartialMessages,
      mcpServersOverride,
      initialUserQuery,
      authEnvOverride,
      warmQuery,
    } = config;

    this.logger.info(
      `[SessionLifecycle] Executing query for session: ${sessionId}`,
      {
        isResume: !!resumeSessionId,
        hasInitialPrompt: !!initialPrompt,
      },
    );

    const abortController = new AbortController();

    const registerKey = sessionConfig?.tabId ?? (sessionId as string);
    const knownRealSessionId = resumeSessionId
      ? (sessionId as string)
      : undefined;
    const rec = this.registry.register(
      registerKey,
      sessionConfig || {},
      abortController,
      knownRealSessionId,
    );
    const initialContent = initialPrompt?.content.trim() || '';
    const hasAttachments =
      (initialPrompt?.files && initialPrompt.files.length > 0) ||
      (initialPrompt?.images && initialPrompt.images.length > 0);
    const isSlashCommand =
      SlashCommandInterceptor.isSlashCommand(initialContent) && !hasAttachments;
    if (initialContent && !isSlashCommand) {
      const sdkUserMessage = await this.messageFactory.createUserMessage({
        content: initialPrompt!.content, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        sessionId,
        files: initialPrompt!.files, // eslint-disable-line @typescript-eslint/no-non-null-assertion
        images: initialPrompt!.images, // eslint-disable-line @typescript-eslint/no-non-null-assertion
      });
      rec.messageQueue.push(sdkUserMessage);
      this.logger.info(
        `[SessionLifecycle] Queued initial prompt for session ${sessionId}`,
      );
    }
    try {
      const queryFn = await this.moduleLoader.getQueryFunction();
      const userMessageStream = this.streamPump.createUserMessageStream(
        sessionId,
        abortController,
      );
      const currentLevel = this.permissionHandler.getPermissionLevel();
      const initialPermissionMode =
        currentLevel === 'ask'
          ? 'default'
          : (PERMISSION_MODE_MAP[currentLevel] as
              | 'default'
              | 'acceptEdits'
              | 'bypassPermissions'
              | 'plan');
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
        forkSession,
        enableFileCheckpointing: enableFileCheckpointing ?? true,
        includePartialMessages,
        mcpServersOverride,
        initialUserQuery: initialUserQuery ?? initialPrompt?.content,
        authEnvOverride,
        onProviderError: (stderrChunk: string) => {
          if (providerErrorAborted || abortController.signal.aborted) return;
          providerErrorAborted = true;
          const effectiveAuthEnv: AuthEnv = authEnvOverride ?? this.authEnv;
          const baseUrl =
            effectiveAuthEnv.ANTHROPIC_BASE_URL?.trim() || 'default';
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
      const isResume = !!resumeSessionId;
      let effectivePrompt: string | AsyncIterable<SDKUserMessage>;
      let promptMode: string;

      if (isSlashCommand) {
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

      this.logger.info('[SessionLifecycle] Starting SDK query with options', {
        model: queryOptions.options.model,
        cwd: queryOptions.options.cwd,
        permissionMode: queryOptions.options.permissionMode,
        maxTurns: queryOptions.options.maxTurns,
        isResume,
        isSlashCommand,
        promptMode,
      });
      const canUseWarmQuery =
        !!warmQuery &&
        typeof (warmQuery as { query?: unknown }).query === 'function' &&
        !isResume &&
        !forkSession &&
        !isSlashCommand;
      if (warmQuery && !canUseWarmQuery) {
        try {
          warmQuery.close();
          this.logger.info(
            `[SessionLifecycle] Discarding warm handle for session ${sessionId} — ` +
              `session shape ineligible (isResume=${isResume}, ` +
              `forkSession=${!!forkSession}, isSlashCommand=${isSlashCommand})`,
          );
        } catch (closeErr) {
          this.logger.warn(
            '[SessionLifecycle] WarmQuery.close() threw during fall-through',
            closeErr instanceof Error ? closeErr : new Error(String(closeErr)),
          );
        }
      }

      const runResult = this.queryRunner.invokeWithLoadedQuery(
        queryFn,
        effectivePrompt,
        queryOptions.options as Options,
        canUseWarmQuery && warmQuery ? warmQuery : null,
      );
      const sdkQuery: Query = runResult.sdkQuery;
      if (runResult.usedWarmQuery) {
        this.logger.info(
          `[SessionLifecycle] Used warm subprocess for session ${sessionId} ` +
            `(skipped spawn+handshake)`,
        );
      }
      const initialModel = queryOptions.options.model ?? '';
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
      if (rec) {
        this.registry.remove(rec);
      }

      abortController.abort();
      this.logger.error(
        `[SessionLifecycle] Query init failed for session ${sessionId}; rolling back pre-registration`,
        err instanceof Error ? err : new Error(String(err)),
      );
      throw err;
    }
  }
}
