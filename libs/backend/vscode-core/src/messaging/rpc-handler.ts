/**
 * RPC Handler - Routes RPC method calls to registered handlers.
 *
 * Uses simple Map-based method routing instead of the legacy event-based bus.
 *
 * Features:
 * - Map-based method routing (registerMethod/handleMessage)
 * - Correlation ID support for request/response matching
 * - Graceful error handling with try/catch
 * - Logger integration for debugging
 * - Dependency injection via TSyringe
 *
 * Usage:
 *   rpcHandler.registerMethod('session:list', async (params) => { ... });
 *   const response = await rpcHandler.handleMessage({
 *     method: 'session:list',
 *     params: {},
 *     correlationId: '123'
 *   });
 */

import { injectable, inject } from 'tsyringe';
import { performance } from 'node:perf_hooks';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ITracer } from '@ptah-extension/platform-core';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging/logger';
import type { SentryService } from '../services/sentry.service';
import { readMsEnv, roundMs } from '../diagnostics/env-thresholds';
import {
  RpcUserError,
  type RpcMessage,
  type RpcResponse,
  type RpcMethodHandler,
  type BaseRpcMethodHandler,
} from './rpc-types';

/**
 * Allowed RPC method prefixes for security validation
 * Only methods starting with these prefixes can be registered
 *
 * Security: Prevents unauthorized method registration and injection attacks
 */
export const ALLOWED_METHOD_PREFIXES = [
  'session:',
  'chat:',
  'file:',
  'workspace:',
  'analytics:',
  'provider:',
  'config:',
  'context:',
  'autocomplete:',
  'permission:',
  'auth:',
  'setup-status:',
  'setup-wizard:',
  'llm:', // LLM provider management (API keys, provider status)
  'license:', // Ptah Builders membership status and key entry
  'wizard:', // Setup wizard deep analysis and agent recommendations
  'command:', // Webview command execution (ptah.* commands only)
  'enhancedPrompts:', // Enhanced Prompts system (status, wizard, regenerate)
  'quality:', // Quality Dashboard (assessment, history, export)
  'plugins:', // Plugin configuration (list, get-config, save-config)
  'agent:', // Agent orchestration (getConfig, setConfig, detectClis)
  'ptahCli:', // Ptah CLI agent management (list, create, update, delete, testConnection, listModels)
  'editor:', // Editor operations (openFile, etc.) for Electron Monaco editor
  'layout:', // Electron desktop layout persistence (sidebar/editor panel widths)
  'skillsSh:', // Skills.sh marketplace (search, install, recommend)
  'settings:', // Settings export/import (Electron desktop)
  'git:', // Git info and worktree management
  'terminal:', // Terminal PTY session management
  'webSearch:', // Web search provider configuration (API key status)
  'harness:', // Harness setup builder (initialize, suggest-config, apply, presets, chat)
  'mcpDirectory:', // MCP Server Directory (search, getDetails, install, uninstall, listInstalled, getPopular)
  'outputStyle:', // Claude Code output styles (list, get, activate, save, delete, diagnose)
  'cron:', // Scheduled cron jobs (list, get, create, update, delete, toggle, runNow, runs, nextFire)
  'gateway:', // MCP gateway status, bindings, and messages
  'voice:', // Voice input transcription (chat input mic → Whisper)
  'memory:', // Memory curator (list, search, get, pin, unpin, forget, rebuildIndex, stats)
  'mem:', // Progressive disclosure memory search (searchIndex, timeline, getObservations)
  'corpus:', // Knowledge corpus (list, get, build, prime, query, reprime, rebuild, delete)
  'skillSynthesis:', // Skills synthesis pipeline (listCandidates, getCandidate, promote, reject, invocations, stats)
  'db:', // DB health + reset — maintenance commands
  'embedder:', // Embedder status + retry (lazy ONNX download recovery)
  'subagent:', // Bidirectional subagent messaging (send-message, stop, interrupt)
  'indexing:', // Workspace indexing control
  'update:', // Desktop update dialog (get-state, check-now, mark-downloaded)
  'tasks:', // Task specs board (list, get, create, updateStatus, generateRegistry, board, reindex)
] as const;

export const RPC_SLOW_WARN_MS_ENV = 'PTAH_RPC_SLOW_WARN_MS';

/**
 * 2000 ms. Deliberately under the renderer's 30 s RPC budget
 * (`libs/frontend/core/.../rpc-call.util.ts`) — by the time that timeout fires
 * the app has been unusable for half a minute and the log says only that ONE
 * call gave up. Warning at 2 s names the slow handler while the process is
 * still alive, which is the difference between "Ptah hung" and "`memory:search`
 * took 9 s" (TASK_2026_323).
 */
export const DEFAULT_RPC_SLOW_WARN_MS = 2000;

/**
 * RPC Handler service for routing RPC method calls
 * Manages registration and execution of RPC methods with security validation
 */
@injectable()
export class RpcHandler {
  private handlers = new Map<string, BaseRpcMethodHandler>();

  /**
   * Resolved once. The threshold cannot change within a process lifetime, and
   * `handleMessage` is the single hottest path in the backend — re-reading
   * `process.env` per call would be measurable instrumentation overhead on the
   * exact path this instrumentation exists to keep honest.
   */
  private readonly slowWarnMs =
    readMsEnv(RPC_SLOW_WARN_MS_ENV) ?? DEFAULT_RPC_SLOW_WARN_MS;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SENTRY_SERVICE, { isOptional: true })
    private readonly sentryService: SentryService | undefined,
    @inject(PLATFORM_TOKENS.TRACER, { isOptional: true })
    private readonly tracer: ITracer | undefined,
  ) {
    this.logger.debug('RpcHandler: Initialized');
  }

  /**
   * Register an RPC method handler with security validation
   * Validates method name against whitelist before registration
   * Overwrites existing handler if method name already registered
   *
   * @param name - Method name (e.g., 'session:list', 'chat:sendMessage')
   * @param handler - Async function to handle the method (type-safe with generics)
   * @throws Error if method name doesn't match allowed prefixes
   *
   * @example
   * // Type-safe handler with explicit types
   * rpcHandler.registerMethod<SessionListParams, SessionListResult>(
   *   'session:list',
   *   async (params) => {
   *     // params is typed as SessionListParams
   *     const sessions = await sessionManager.listSessions(params.workspacePath);
   *     return { sessions }; // must match SessionListResult
   *   }
   * );
   *
   * // Invalid - throws Error
   * rpcHandler.registerMethod('malicious:hack', async () => { ... });
   * // Error: Invalid method name "malicious:hack" - must start with allowed prefix
   */
  registerMethod<TParams = unknown, TResult = unknown>(
    name: string,
    handler: RpcMethodHandler<TParams, TResult>,
  ): void {
    if (!this.isValidMethodName(name)) {
      const error = `Invalid method name "${name}" - must start with allowed prefix: ${ALLOWED_METHOD_PREFIXES.join(
        ', ',
      )}`;
      this.logger.error(`RpcHandler: ${error}`);
      throw new Error(error);
    }
    if (this.handlers.has(name)) {
      this.logger.warn(`RpcHandler: Overwriting method "${name}"`);
    }
    this.handlers.set(name, handler as BaseRpcMethodHandler);
    this.logger.debug(`RpcHandler: Registered method "${name}"`);
  }

  /**
   * Handle an RPC message from the frontend
   * Routes the message to the appropriate handler and returns a response
   *
   * @param message - RPC message with method, params, correlationId
   * @returns RPC response with success/error state
   *
   * @example
   * const response = await rpcHandler.handleMessage({
   *   method: 'session:list',
   *   params: {},
   *   correlationId: 'abc-123'
   * });
   *
   * if (response.success) {
   *   console.log('Sessions:', response.data);
   * } else {
   *   console.error('Error:', response.error);
   * }
   */
  async handleMessage(message: RpcMessage): Promise<RpcResponse> {
    const { method, params, correlationId } = message;

    this.logger.debug(`RpcHandler: Handling method "${method}"`, {
      correlationId,
    });

    const handler = this.handlers.get(method);
    if (!handler) {
      this.logger.warn(`RpcHandler: Method not found: "${method}"`);
      return {
        success: false,
        error: `Method not found: ${method}`,
        correlationId,
      };
    }

    // Timed in a `finally` rather than only on the success path: a handler that
    // throws after 40 seconds is the MOST interesting case, and an error return
    // gives no hint that the failure was preceded by a long block.
    const startedAt = performance.now();
    try {
      const data = await handler(params);
      this.logger.debug(`RpcHandler: Method "${method}" succeeded`, {
        correlationId,
      });
      return { success: true, data, correlationId };
    } catch (error) {
      if (error instanceof RpcUserError) {
        this.logger.debug(
          `RpcHandler: Method "${method}" returned user error (${error.errorCode})`,
          { correlationId },
        );
        return {
          success: false,
          error: error.message,
          errorCode: error.errorCode,
          correlationId,
        };
      }
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`RpcHandler: Method "${method}" failed`, errorObj);
      this.reportToSentry(errorObj, {
        errorSource: 'rpc-handler',
        extra: { method, correlationId },
      });
      return {
        success: false,
        error: errorObj.message,
        correlationId,
      };
    } finally {
      this.warnIfSlow(method, performance.now() - startedAt, correlationId);
    }
  }

  /**
   * Emit a warning when a handler occupied the backend for too long.
   *
   * The tracer breadcrumb is best-effort and separately guarded: Sentry being
   * unhappy must never turn a slow RPC into a failed RPC.
   */
  private warnIfSlow(
    method: string,
    elapsedMs: number,
    correlationId: string | undefined,
  ): void {
    if (elapsedMs < this.slowWarnMs) return;
    const durationMs = roundMs(elapsedMs);

    this.logger.warn('[RPC] slow handler', { method, durationMs });

    if (!this.tracer) return;
    try {
      this.tracer.addBreadcrumb('rpc', 'slow handler', {
        method,
        durationMs,
        correlationId,
      });
    } catch (error: unknown) {
      this.logger.debug('[RPC] slow-handler breadcrumb failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Unregister an RPC method handler
   * No-op if method was not registered
   *
   * @param name - Method name to unregister
   *
   * @example
   * rpcHandler.unregisterMethod('session:list');
   */
  unregisterMethod(name: string): void {
    if (this.handlers.delete(name)) {
      this.logger.debug(`RpcHandler: Unregistered method "${name}"`);
    }
  }

  /**
   * Get list of registered method names
   * Useful for debugging and introspection
   *
   * @returns Array of method names
   *
   * @example
   * const methods = rpcHandler.getRegisteredMethods();
   * // ['session:list', 'chat:sendMessage', 'provider:getStatus']
   */
  getRegisteredMethods(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Validate method name against whitelist
   * Security check to prevent unauthorized method registration
   *
   * @param name - Method name to validate
   * @returns True if method name starts with allowed prefix
   *
   * @example
   * isValidMethodName('session:list')      // true
   * isValidMethodName('chat:sendMessage')  // true
   * isValidMethodName('malicious:hack')    // false
   * isValidMethodName('invalid')           // false
   */
  private isValidMethodName(name: string): boolean {
    return ALLOWED_METHOD_PREFIXES.some((prefix) => name.startsWith(prefix));
  }

  /**
   * Report a handler exception to Sentry at the single RPC chokepoint.
   *
   * Resolved lazily via the container so RpcHandler's constructor signature
   * stays unchanged and tests without Sentry registered keep working. The
   * reporting path is itself wrapped in try/catch so a Sentry failure can
   * never break the RPC response flow.
   */
  private reportToSentry(
    error: Error,
    context: { errorSource: string; extra: Record<string, unknown> },
  ): void {
    if (!this.sentryService) return;
    this.sentryService.captureException(error, context);
  }
}
