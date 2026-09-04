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
import {
  NoActivityWatchdog,
  NO_ACTIVITY_TIMEOUT_MS,
} from '../no-activity-watchdog';
import type { IHarnessPreflight } from '../../harness/harness-preflight.port';

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
    /**
     * Optional by design: a host with no reconciler (a test container, an
     * embedded consumer) starts sessions exactly as before. See
     * `harness/harness-preflight.port.ts` for why this is a structural port and
     * not an import of `harness-sync`.
     */
    private readonly harnessPreflight: IHarnessPreflight | null = null,
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
      mcpServerRunning = true,
      enhancedPromptsContent,
      permissionLevel,
      pathToClaudeCodeExecutable,
      forkSession,
      enableFileCheckpointing,
      includePartialMessages,
      mcpServersOverride,
      initialUserQuery,
      authEnvOverride,
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
    // No-stream-activity watchdog. Replaces the old stderr-pattern
    // `onProviderError` abort: rather than guessing "stuck" from stderr text
    // (brittle in both directions), we surface a stuck session when the SDK
    // query produces no stream activity for the window. The watchdog is
    // started/kicked/stopped by the StreamTransformer as it consumes the
    // stream (kick on every event → reset), so a long-but-alive turn (long
    // tool call, extended thinking, slow stream) never trips it. Declared
    // before the try so the init-failure rollback can stop() it.
    const effectiveAuthEnv: AuthEnv = authEnvOverride ?? this.authEnv;
    const providerBaseUrl =
      effectiveAuthEnv.ANTHROPIC_BASE_URL?.trim() || 'default';
    const providerModel = sessionConfig?.model ?? 'unknown';
    const activityWatchdog = new NoActivityWatchdog(
      NO_ACTIVITY_TIMEOUT_MS,
      () => {
        if (abortController.signal.aborted) {
          return;
        }
        const seconds = Math.round(NO_ACTIVITY_TIMEOUT_MS / 1000);
        this.logger.error(
          `[SessionLifecycle] Session ${sessionId} produced no stream activity for ${seconds}s — ` +
            `stopping the stuck session (baseUrl=${providerBaseUrl}, model=${providerModel})`,
        );
        // Invariant (session-lifecycle-abort / stream-closed-abort): resolve
        // pending permissions BEFORE the abort tears down the CLI stream, so
        // an in-flight can_use_tool cannot wedge the UI, and the CLI-internal
        // "Stream closed" rejection stays benign teardown rather than a real
        // error. Mirrors endSession()'s cleanup-first ordering.
        try {
          this.permissionHandler.cleanupPendingPermissions(rec.tabId);
        } catch (cleanupErr) {
          this.logger.warn(
            '[SessionLifecycle] Failed to clean up pending permissions on no-activity timeout',
            cleanupErr instanceof Error
              ? cleanupErr
              : new Error(String(cleanupErr)),
          );
        }
        // Descriptive, non-"abort" wording on purpose: the StreamTransformer
        // catch classifies messages containing "abort"/"cancel" as benign
        // user aborts (debug-level, suppressed). A stuck-session timeout must
        // surface to the UI as a real error instead.
        try {
          abortController.abort(
            new Error(
              `No stream activity for ${seconds}s — no response from provider ` +
                `(baseUrl="${providerBaseUrl}", model="${providerModel}"). ` +
                `The session appears stuck; stopping it. The provider may be ` +
                `unreachable or overloaded — check configuration or retry.`,
            ),
          );
        } catch (abortErr) {
          this.logger.warn(
            '[SessionLifecycle] Failed to abort on no-activity timeout',
            abortErr instanceof Error ? abortErr : new Error(String(abortErr)),
          );
        }
      },
    );
    // The turn state owns one hold on this watchdog: taken while no turn is in
    // flight, released by `markTurnStarted`, re-taken by `markTurnEnded`. A
    // fresh record has `turnInFlight === false`, so the initial idle hold is
    // taken here and the pump's first yield releases it. Without it the
    // watchdog fired exactly 180 s after every `result` and marked every
    // running subagent interrupted (2026-08-31 log, session 314c9c90: result
    // 00:37:02Z → kill 00:40:02Z; TASK_2026_363). A slash-command string
    // prompt never goes through the pump, so no idle hold is taken and the
    // watchdog arms on `start()` as before.
    rec.activityHold = activityWatchdog;
    if (!isSlashCommand) {
      activityWatchdog.hold();
    }
    try {
      // Before the SDK is even loaded: this is the one funnel every
      // interactive, gateway and resumed session passes through, and it is the
      // last moment at which a missing `.claude/skills` can still be repaired
      // without the model having already been told it has none. Bounded and
      // non-throwing by the port's contract, so nothing here can delay or fail
      // a session for long (TASK_2026_278 Batch 3).
      await this.runHarnessPreflight(sessionConfig?.projectPath);
      const queryFn = await this.moduleLoader.getQueryFunction();
      const userMessageStream = this.streamPump.createUserMessageStream(
        sessionId,
        abortController,
      );
      const currentLevel =
        permissionLevel ?? this.permissionHandler.getPermissionLevel();
      // Seed this session's level on its record and bind the canUseTool
      // resolver to it. A caller-supplied `permissionLevel` (e.g. the gateway
      // bridge passing `'yolo'`) wins over the global default so the first tool
      // call already runs at the right level. Reading `rec.permissionLevel`
      // live keeps mid-session toggles working while scoping the level per
      // session — a tool call here never sees the level of a session running in
      // another workspace.
      rec.permissionLevel = currentLevel;
      const permissionLevelResolver = () => rec.permissionLevel;
      // YOLO maps to 'default' (not 'bypassPermissions') so the canUseTool
      // callback always runs — it auto-approves every tool for yolo while still
      // routing AskUserQuestion/ExitPlanMode to the UI. The only SDK modes the
      // interactive path can produce are 'default' | 'acceptEdits' | 'plan'.
      const initialPermissionMode =
        currentLevel === 'ask'
          ? 'default'
          : (PERMISSION_MODE_MAP[currentLevel] as
              | 'default'
              | 'acceptEdits'
              | 'plan');
      const queryOptions = await this.queryOptionsBuilder.build({
        userMessageStream,
        abortController,
        sessionConfig,
        resumeSessionId,
        sessionId: sessionId as string,
        onCompactionStart,
        onWorktreeCreated,
        onWorktreeRemoved,
        mcpServerRunning,
        enhancedPromptsContent,
        permissionMode: initialPermissionMode,
        permissionLevelResolver,
        pathToClaudeCodeExecutable,
        forkSession,
        enableFileCheckpointing: enableFileCheckpointing ?? true,
        includePartialMessages,
        mcpServersOverride,
        initialUserQuery: initialUserQuery ?? initialPrompt?.content,
        authEnvOverride,
        // A turn parked on a permission prompt or an AskUserQuestion card emits
        // no stream events by construction. Without this the watchdog below
        // reads the user's own deliberation as a wedged provider and aborts the
        // session — which is what killed New Project runs mid-question, three
        // minutes into a prompt the UI advertises as untimed (TASK_2026_317).
        activityHold: activityWatchdog,
        // The routing ids the builder computes are pinned at build time, when a
        // new session has no SDK UUID yet — so they fall back to the caller's
        // tabId, which for a surface workflow is a correlation id no frontend
        // registry knows. Reading the record live means a prompt raised after
        // the SDK `init` message carries the id the UI actually routes on.
        sessionIdResolver: () => rec.realSessionId ?? undefined,
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
      const runResult = this.queryRunner.invokeWithLoadedQuery(
        queryFn,
        effectivePrompt,
        queryOptions.options as Options,
      );
      const sdkQuery: Query = runResult.sdkQuery;
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
        activityWatchdog,
      };
    } catch (err) {
      if (rec) {
        this.registry.remove(rec);
      }

      // The watchdog is only armed once StreamTransformer calls start(); it is
      // never started on this init-failure path, but stop() defensively
      // guarantees the timer can never fire after rollback.
      activityWatchdog.stop();
      abortController.abort();
      this.logger.error(
        `[SessionLifecycle] Query init failed for session ${sessionId}; rolling back pre-registration`,
        err instanceof Error ? err : new Error(String(err)),
      );
      throw err;
    }
  }

  /**
   * Verify the harness for this session's workspace, bounded, before the query
   * starts.
   *
   * The catch is belt-and-braces. `IHarnessPreflight` promises never to throw,
   * but this call sits INSIDE `executeQuery`'s try block, whose catch tears the
   * session registration down and rethrows — so a port implementation that
   * broke its contract would turn a harness hiccup into a failed chat message.
   * Swallowing here is what makes "the harness is best-effort" true at the one
   * place it has to be.
   */
  private async runHarnessPreflight(
    projectPath: string | undefined,
  ): Promise<void> {
    if (this.harnessPreflight === null) return;
    if (typeof projectPath !== 'string' || projectPath.trim() === '') return;
    try {
      await this.harnessPreflight.ensure(projectPath);
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionLifecycle] Harness preflight threw (ignored; session continues)',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
