/**
 * SessionQueryExecutor — owner of the SDK-query orchestration body.
 *
 * Extracted `executeQuery` (originally lines 725–961, ~300 LOC) out of
 * `SessionLifecycleManager` into this stateless coordinator. The executor:
 *   - creates the AbortController (the load-bearing identity preserved end-to-
 *     end through registration, queryFn options, and the returned result),
 *   - pre-registers the session via Registry,
 *   - seeds the message queue with the initial prompt,
 *   - calls SdkModuleLoader → SdkQueryOptionsBuilder → SDK queryFn,
 *   - connects streamInput when `isResume`,
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
  isDirectAnthropic,
  getAllAnthropicProviders,
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  CODEX_PROXY_TOKEN_PLACEHOLDER,
  OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
  type ContextCapacityRoute,
} from '@ptah-extension/shared';
import type { UsageCostSource } from '../../session-stats/session-stats-owner.service';

import {
  SDKUserMessage,
  Options,
} from '../../types/sdk-types/claude-sdk.types';
import type { SdkModuleLoader } from '../sdk-module-loader';
import type { SdkQueryOptionsBuilder } from '../sdk-query-options-builder';
import type { SdkMessageFactory } from '../sdk-message-factory';
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

/**
 * Classify who is authoritative for a query's dollars from its effective
 * auth route (TASK_2026_533).
 *
 * The SDK's `total_cost_usd` / `modelUsage[].costUSD` are priced by the CLI
 * for the endpoint it believes it is calling. On the native SDK-priced route
 * (no base URL, or the first-party API host) those figures are the provider's
 * own: `'reported'`. On a translated or custom endpoint the CLI prices a model
 * it does not bill, so its dollars are not authoritative: `'unreported'`, and
 * every model is priced from the rate card by its own id. This classifies
 * cost authority from the route; it never branches on a provider or model
 * name.
 */
export function classifyUsageCostSource(authEnv: AuthEnv): UsageCostSource {
  return isDirectAnthropic(authEnv) ? 'reported' : 'unreported';
}

/** Capacity identity only: never infer authority from a hostname substring. */
export function resolveCapacityRoute(authEnv: AuthEnv): ContextCapacityRoute {
  if (isDirectAnthropic(authEnv)) {
    return Object.freeze({ kind: 'native', providerId: 'anthropic' });
  }
  let providerId: string | null = null;
  try {
    const route = new URL(authEnv.ANTHROPIC_BASE_URL?.trim() ?? '');
    if (
      (route.protocol === 'http:' || route.protocol === 'https:') &&
      !route.username &&
      !route.password
    ) {
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(
        route.hostname,
      );
      if (local && !route.search && !route.hash && route.pathname === '/') {
        switch (authEnv.ANTHROPIC_AUTH_TOKEN) {
          case COPILOT_PROXY_TOKEN_PLACEHOLDER:
            providerId = 'github-copilot';
            break;
          case CODEX_PROXY_TOKEN_PLACEHOLDER:
            providerId = 'openai-codex';
            break;
          case OPENROUTER_PROXY_TOKEN_PLACEHOLDER:
            providerId = 'openrouter';
            break;
        }
      }
      if (!providerId) {
        const matches = getAllAnthropicProviders().filter((provider) => {
          if (!provider.baseUrl) return false;
          try {
            return new URL(provider.baseUrl).href === route.href;
          } catch (error: unknown) {
            // Invalid user-defined endpoints supply no capacity evidence.
            void error;
            return false;
          }
        });
        if (matches.length === 1) providerId = matches[0].id;
      }
    }
  } catch (error: unknown) {
    // Invalid/custom routes remain usable by the query; capacity is unknown.
    void error;
  }
  return Object.freeze({ kind: 'proxy', providerId });
}

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

    // The route this query will actually talk to, honouring a per-session
    // provider profile. Classified once, here, and frozen on the record.
    const effectiveAuthEnv: AuthEnv = authEnvOverride ?? this.authEnv;
    const registerKey = sessionConfig?.tabId ?? (sessionId as string);
    const knownRealSessionId = resumeSessionId
      ? (sessionId as string)
      : undefined;
    const rec = this.registry.register(
      registerKey,
      sessionConfig || {},
      abortController,
      knownRealSessionId,
      {
        usageCostSource: classifyUsageCostSource(effectiveAuthEnv),
        // A copy: the global env object is mutated in place on auth changes.
        authEnv: Object.freeze({ ...effectiveAuthEnv }),
      },
      resolveCapacityRoute(effectiveAuthEnv),
    );
    const initialContent = initialPrompt?.content.trim() || '';
    // Every prompt is queued the same way — a slash command is NOT special-
    // cased, and attachments ride this same queue. A raw string prompt is what
    // sets the SDK's `isSingleUserTurn` and closes the input on the first
    // `result`; see the `slash-command-interceptor.ts` header for why that was
    // believed to be required and why it is not (TASK_2026_472).
    if (initialContent) {
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
            `recovering unaccounted silence; liveness unknown (requestedModel=${providerModel}, resolvedModel=${rec.currentModel})`,
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
                `Unaccounted root inactivity; liveness is unknown. Stopping for recovery. The provider may be ` +
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
      (operations) =>
        this.logger.warn(
          '[SessionLifecycle] Operation overdue; liveness unknown, continuing',
          {
            sessionId,
            operations,
            requestedModel: providerModel,
            resolvedModel: rec.currentModel,
          },
        ),
    );
    abortController.signal.addEventListener(
      'abort',
      () => activityWatchdog.stop(),
      { once: true },
    );
    // The turn state owns one hold on this watchdog: taken while no turn is in
    // flight, released by `markTurnStarted`, re-taken by `markTurnEnded`. A
    // fresh record has `turnInFlight === false`, so the initial idle hold is
    // taken here and the pump's first yield releases it. Without it the
    // watchdog fired exactly 180 s after every `result` and marked every
    // running subagent interrupted (2026-08-31 log, session 314c9c90: result
    // 00:37:02Z → kill 00:40:02Z; TASK_2026_363).
    rec.activityHold = activityWatchdog;
    // A queued initial prompt is startup work, NOT between-turn idle. Bound
    // even a CLI that never pulls its input iterator. Empty resumes may idle.
    //
    // A slash-command prompt is queued content like any other since
    // TASK_2026_472, so it takes no idle hold here and the watchdog still arms
    // on `start()`. What moved is the OTHER end of the accounting: the pump now
    // yields the command, so `markTurnStarted` runs and `markTurnEnded` re-takes
    // the idle hold on the `result`. Before the change the slash string never
    // reached the pump, `turnInFlight` stayed false, and `markTurnEnded` skipped
    // the re-hold — harmless only because the query was already closing. A
    // persistent slash session without that re-hold would be aborted after 180 s
    // of healthy idle time.
    if (!initialContent) {
      activityWatchdog.endTurn();
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
              'default' | 'acceptEdits' | 'plan');
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
      // Never a raw string. A string prompt is what sets the SDK's
      // `isSingleUserTurn`, and that flag closes the transport input on the
      // first `result` — see the TASK_2026_472 note above.
      const effectivePrompt: AsyncIterable<SDKUserMessage> = isResume
        ? this.streamPump.createIdlePromptStream(abortController)
        : queryOptions.prompt;
      const promptMode = isResume ? 'idle+streamInput' : 'iterable';

      this.logger.info('[SessionLifecycle] Starting SDK query with options', {
        model: queryOptions.options.model,
        cwd: queryOptions.options.cwd,
        permissionMode: queryOptions.options.permissionMode,
        maxTurns: queryOptions.options.maxTurns,
        isResume,
        promptMode,
      });
      const runResult = this.queryRunner.invokeWithLoadedQuery(
        queryFn,
        effectivePrompt,
        queryOptions.options as Options,
      );
      const sdkQuery: Query = runResult.sdkQuery;
      const initialModel = queryOptions.options.model ?? '';
      rec.currentModel = initialModel;
      if (isResume) {
        sdkQuery.streamInput(userMessageStream).catch((err: unknown) => {
          this.onInputChannelFailed(
            err,
            sessionId as string,
            rec.tabId,
            abortController,
          );
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
        sessionToken: rec.token,
        usageCostSource: rec.usageCostSource,
        accountingAuthEnv: rec.accountingAuthEnv,
        capacityRoute: rec.capacityRoute,
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
   * End a session whose SDK input channel died.
   *
   * On the resumed path `streamInput(userMessageStream)` is the session's ONLY
   * delivery channel — the query itself was started with an idle iterable that
   * never yields. If that promise rejects, nothing the user types, and no slash
   * command, can ever reach the CLI again.
   *
   * This used to be a `logger.warn` and nothing else, so `executeQuery` still
   * returned a query and the RPC layer still reported the session as started.
   * The session then sat inert until the no-activity watchdog aborted it 180 s
   * later — a real failure reported as a timeout, three minutes late
   * (TASK_2026_472, codex logic review F1).
   *
   * A rejection here is always abnormal, never teardown. The SDK's own
   * `streamInput` catch rethrows only NON-abort errors (`catch(Q){if(!(Q
   * instanceof W6))throw Q}`, sdk.mjs 0.3.150, where `W6` is its abort error
   * class), so an aborted session resolves instead of rejecting. The two
   * reachable rejections are `ProcessTransport is not ready for writing` and
   * `Cannot write to terminated process` — the second fires when the CLI child
   * dies mid-session, which is exactly the case that must not be swallowed.
   *
   * Ordering and wording copy the watchdog's abort policy above, for the same
   * two reasons: resolve pending permissions BEFORE the abort tears the stream
   * down so an in-flight `can_use_tool` cannot wedge the UI, and keep the words
   * "abort" and "cancel" out of the message, because `StreamTransformer`
   * classifies those as benign user aborts and suppresses them. The underlying
   * error goes to the log, never into the abort reason, so a provider message
   * that happens to contain "abort" cannot silence a real failure.
   */
  private onInputChannelFailed(
    err: unknown,
    sessionId: string,
    tabId: string,
    abortController: AbortController,
  ): void {
    if (abortController.signal.aborted) {
      return;
    }
    this.logger.error(
      `[SessionLifecycle] Session ${sessionId} lost its SDK input channel; ` +
        `no further message can be delivered`,
      err instanceof Error ? err : new Error(String(err)),
    );
    try {
      this.permissionHandler.cleanupPendingPermissions(tabId);
    } catch (cleanupErr: unknown) {
      this.logger.warn(
        '[SessionLifecycle] Failed to clean up pending permissions on input-channel failure',
        cleanupErr instanceof Error
          ? cleanupErr
          : new Error(String(cleanupErr)),
      );
    }
    try {
      abortController.abort(
        new Error(
          'The session lost its connection to the provider and can no longer ' +
            'receive messages. Stopping for recovery — start a new message to retry.',
        ),
      );
    } catch (abortErr: unknown) {
      this.logger.warn(
        '[SessionLifecycle] Failed to stop session on input-channel failure',
        abortErr instanceof Error ? abortErr : new Error(String(abortErr)),
      );
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
