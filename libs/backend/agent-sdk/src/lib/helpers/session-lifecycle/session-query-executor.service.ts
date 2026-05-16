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
      forkSession,
      resumeSessionAt,
      enableFileCheckpointing,
      includePartialMessages,
      mcpServersOverride,
      initialUserQuery,
      warmQuery,
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

    // Step 2: Register session and capture the record for direct use below
    const rec = this.registry.register(
      sessionId as string,
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

    // Steps 4-7 may throw (SDK module load failure, options build failure,
    // query construction failure). If any step fails after register()
    // in Step 2, the session would be left orphaned in byTabId. Wrap the
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
        forkSession,
        resumeSessionAt,
        // Default file checkpointing ON when not explicitly disabled, so
        // session:rewindFiles works on resumed sessions without callers
        // having to opt in. Pass through `false` verbatim when set.
        enableFileCheckpointing: enableFileCheckpointing ?? true,
        // Forward partial-message opt-in. Builder defaults to true when
        // unspecified, matching previous hardcoded behavior.
        includePartialMessages,
        // Forward caller-supplied MCP HTTP overrides.
        // Identity-preserved when undefined or empty — see
        // SdkQueryOptionsBuilder.mergeMcpOverride.
        mcpServersOverride,
        // Memory recall query for system prompt injection (TASK_2026_THOTH_MEMORY_READ).
        // Falls back gracefully when undefined or empty.
        initialUserQuery: initialUserQuery ?? initialPrompt?.content,
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

      // Step 7: Start SDK query.
      //
      // Warm-query fast path: when the caller
      // hands us a `warmQuery` AND the session is a brand-new chat (NOT a
      // resume, NOT a fork, NOT a slash command — slash commands need the
      // SDK to parse the leading `/` from a string prompt, which a warm
      // handle still supports, BUT the warm subprocess was started without
      // the session's slash-command argument-parsing context, so we keep
      // the safe path and only fast-path plain iterable prompts), we hand
      // the prompt to `warmQuery.query(prompt)`. This skips the spawn +
      // initialize handshake — the subprocess is already up and waiting.
      //
      // **Safety**: per `WarmQuery` contract, `warm.query(prompt)` accepts
      // ONLY a prompt — every other Option (cwd, model, permissionMode,
      // hooks, canUseTool, mcpServers, agents, systemPrompt, plugins,
      // file-checkpointing, partial-messages) is inherited from the
      // original `startup()` call. The caller (SdkAgentAdapter) is
      // responsible for fingerprint-matching via `consumeWarmQuery
      // (requirements)` BEFORE passing the handle here. We do not
      // re-validate; instead we narrowly gate which sessions are eligible
      // (no resume, no fork, no slash-command short-circuit) and fall back
      // to the standard `queryFn` path on any failure. If the warm handle
      // is supplied but unusable for this session, we close it so the
      // subprocess doesn't leak.
      let sdkQuery: Query;
      const canUseWarmQuery =
        !!warmQuery &&
        typeof (warmQuery as { query?: unknown }).query === 'function' &&
        !isResume &&
        !forkSession &&
        !isSlashCommand;
      if (warmQuery && !canUseWarmQuery) {
        // Caller passed a warm handle but this session can't use it
        // (resume/fork/slash-command). Close to avoid subprocess leak.
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

      if (canUseWarmQuery && warmQuery) {
        try {
          // Cast through unknown — the WarmQuery shape is dynamically loaded;
          // we narrowed `query` to `function` in `canUseWarmQuery`.
          const warmQueryFn = (
            warmQuery as unknown as {
              query: (prompt: string | AsyncIterable<SDKUserMessage>) => Query;
            }
          ).query;
          sdkQuery = warmQueryFn(effectivePrompt);
          this.logger.info(
            `[SessionLifecycle] Used warm subprocess for session ${sessionId} ` +
              `(skipped spawn+handshake)`,
          );
        } catch (warmErr) {
          // Warm query call failed — log and fall back to a fresh query.
          // Close the warm handle defensively (it may already be in a bad
          // state, but `close()` is idempotent enough that swallowing here
          // is safer than leaving a half-broken subprocess around).
          this.logger.warn(
            `[SessionLifecycle] warmQuery.query() threw for session ${sessionId} ` +
              `— falling back to fresh query`,
            warmErr instanceof Error ? warmErr : new Error(String(warmErr)),
          );
          try {
            warmQuery.close();
          } catch {
            // ignore — already failing, don't compound
          }
          sdkQuery = queryFn({
            prompt: effectivePrompt,
            options: queryOptions.options as Options,
          });
        }
      } else {
        sdkQuery = queryFn({
          prompt: effectivePrompt,
          options: queryOptions.options as Options,
        });
      }
      // options.model is optional in the SDK's Options type; fall back to empty
      // string to keep ExecuteQueryResult.initialModel typed as string.
      const initialModel = queryOptions.options.model ?? '';

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
      // Init failed after register() — remove the orphan session so retries
      // aren't blocked by a stale entry and callers see a clean error.
      if (rec) {
        this.registry.remove(rec);
      }
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
