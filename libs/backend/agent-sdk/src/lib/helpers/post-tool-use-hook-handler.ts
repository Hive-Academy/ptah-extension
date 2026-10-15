import { injectable, inject } from 'tsyringe';
import type {
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
  HookInput,
  PostToolUseHookInput,
} from '../types/sdk-types/claude-sdk.types';
import { isPostToolUseHook } from '../types/sdk-types/claude-sdk.types';
import { SDK_TOKENS } from '../di/tokens';
import { resolveHookSessionId } from './hook-session-resolver';
import type { ToolOutputCapper } from './compaction/tool-output-capper';
import { PostToolUseCallbackRegistry } from './post-tool-use-callback-registry';
import { MainThreadNoticeQueue } from './main-thread-notice-queue';
import { SubagentNoticeQueue } from './subagent-notice-queue';
import { buildSubagentRunTag } from './subagent-run-tag';

/**
 * Upper bound for one output cap. The SDK's hook timeout defaults to 60 s; a
 * slow outline must give the tool result back long before that, so past this
 * bound the hook returns the original output (fail-open).
 */
export const POST_TOOL_USE_CAP_TIMEOUT_MS = 10_000;

/** Why the cap did not finish: the bound passed or the SDK aborted the hook. */
type CapInterruption = 'timeout' | 'aborted';

function extractExitCode(toolResponse: unknown): number | null {
  if (toolResponse === null || typeof toolResponse !== 'object') {
    return null;
  }
  const candidate = (toolResponse as Record<string, unknown>)['exit_code'];
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate;
  }
  const camel = (toolResponse as Record<string, unknown>)['exitCode'];
  if (typeof camel === 'number' && Number.isFinite(camel)) {
    return camel;
  }
  return null;
}

function deriveSuccess(
  toolResponse: unknown,
  exitCode: number | null,
): boolean {
  if (exitCode !== null) {
    return exitCode === 0;
  }
  if (toolResponse === null || typeof toolResponse !== 'object') {
    return true;
  }
  const isError = (toolResponse as Record<string, unknown>)['is_error'];
  if (typeof isError === 'boolean') {
    return !isError;
  }
  return true;
}

@injectable()
export class PostToolUseHookHandler {
  /** Parent sessions already warned for a missing or invalid run-tag agent id. */
  private readonly runTagMissSessions = new Set<string>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY)
    private readonly callbackRegistry: PostToolUseCallbackRegistry,
    @inject(SDK_TOKENS.SDK_TOOL_OUTPUT_CAPPER)
    private readonly capper?: ToolOutputCapper,
    /** Absent in callers that construct the handler without one: no notices. */
    @inject(MainThreadNoticeQueue)
    private readonly noticeQueue?: MainThreadNoticeQueue,
    /** Absent in callers that construct the handler without one: no subagent notices. */
    @inject(SubagentNoticeQueue)
    private readonly subagentNotices?: SubagentNoticeQueue,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry?: Pick<SubagentRegistryService, 'get'>,
  ) {}

  /**
   * The pending host notice for this tool result: a subagent's tool result
   * (`agent_id` set) drains only that subagent's notice, a main-thread one
   * drains the session's main-thread notices.
   */
  private takeNotice(
    input: PostToolUseHookInput,
    sessionId: string | undefined,
  ): string | undefined {
    return input.agent_id
      ? this.subagentNotices?.take(input.agent_id)
      : this.takeMainThreadNotice(input, sessionId);
  }

  private runTag(
    input: PostToolUseHookInput,
    sessionId: string | undefined,
  ): string | null {
    try {
      const result = buildSubagentRunTag(
        input,
        (toolUseId) => this.subagentRegistry?.get(toolUseId)?.agentId,
      );
      if (
        result.registryAgentId &&
        result.responseAgentId &&
        result.registryAgentId !== result.responseAgentId
      ) {
        this.logger.warn(
          '[PostToolUseHookHandler] subagent agent ids disagree',
          {
            registryAgentId: result.registryAgentId,
            responseAgentId: result.responseAgentId,
          },
        );
      }
      this.logRunTagSkip(input, sessionId, result.reason);
      return result.tag;
    } catch (error: unknown) {
      // degradation-audit: reported - a failed registry lookup loses only this
      // tool call's run tag; the hook must still return the tool result.
      this.logger.warn(
        '[PostToolUseHookHandler] subagent run tag lookup failed',
        {
          error: error instanceof Error ? error.message : String(error),
          toolName: input.tool_name,
        },
      );
      return null;
    }
  }

  /**
   * `missing-agent-id` and `invalid-agent-id` are a lost join key: warn once
   * per parent session. A tool that is not Agent or Task is not a join, so
   * that skip stays at debug.
   */
  private logRunTagSkip(
    input: PostToolUseHookInput,
    sessionId: string | undefined,
    reason: 'missing-agent-id' | 'invalid-agent-id' | undefined,
  ): void {
    if (reason === 'missing-agent-id' || reason === 'invalid-agent-id') {
      const parentSessionId = resolveHookSessionId(input.session_id, sessionId);
      if (parentSessionId !== null) {
        if (this.runTagMissSessions.has(parentSessionId)) {
          return;
        }
        this.runTagMissSessions.add(parentSessionId);
      }
      this.logger.warn('[PostToolUseHookHandler] subagent run tag skipped', {
        reason,
        toolName: input.tool_name,
      });
      return;
    }
    if (input.tool_name !== 'Agent' && input.tool_name !== 'Task') {
      this.logger.debug('[PostToolUseHookHandler] subagent run tag skipped', {
        reason: 'not-an-agent-tool',
        toolName: input.tool_name,
      });
    }
  }

  /**
   * Drains the session's pending host notices for a main-thread tool result.
   * A failure loses the notice for this tool call only and never breaks the
   * hook.
   */
  private takeMainThreadNotice(
    input: PostToolUseHookInput,
    sessionId: string | undefined,
  ): string | undefined {
    const queue = this.noticeQueue;
    if (!queue) {
      return undefined;
    }
    try {
      const resolvedSessionId = resolveHookSessionId(
        input.session_id,
        sessionId,
      );
      return resolvedSessionId ? queue.take(resolvedSessionId) : undefined;
    } catch (error: unknown) {
      // degradation-audit: reported - the failure is logged below; the hook
      // must never break a tool result, so only this notice is dropped.
      this.logger.debug(
        '[PostToolUseHookHandler] could not attach the pending notice, skipping it',
        {
          error: error instanceof Error ? error.message : String(error),
          toolName: input.tool_name,
        },
      );
      return undefined;
    }
  }

  createHooks(
    sessionId: string | undefined,
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      PostToolUse: [
        {
          hooks: [
            async (
              input: HookInput,
              _toolUseId: string | undefined,
              options?: { signal?: AbortSignal },
            ): Promise<HookJSONOutput> => {
              if (!isPostToolUseHook(input)) {
                return { continue: true };
              }
              const cappedOutput = await this.capToolOutput(
                input,
                cwd,
                options?.signal,
              );
              this.fanOut(input, sessionId, cwd);
              const rewritten = cappedOutput !== input.tool_response;
              const notice = this.takeNotice(input, sessionId);
              const tag = this.runTag(input, sessionId);
              const additionalContext = [notice, tag]
                .filter(
                  (part): part is string => part !== undefined && part !== null,
                )
                .join('\n');
              if (!rewritten && additionalContext.length === 0) {
                return { continue: true };
              }
              return {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: 'PostToolUse',
                  ...(rewritten ? { updatedToolOutput: cappedOutput } : {}),
                  ...(additionalContext.length > 0
                    ? { additionalContext }
                    : {}),
                },
              };
            },
          ],
        },
      ],
    };
  }

  /**
   * Runs the output capper. Returns the original `tool_response` object when
   * nothing changed; fail-open — a capper error, a cap that outlives
   * `POST_TOOL_USE_CAP_TIMEOUT_MS` or an aborted hook never breaks the hook
   * and never holds the tool result.
   */
  private async capToolOutput(
    input: PostToolUseHookInput,
    cwd: string,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const capper = this.capper;
    if (!capper) {
      return input.tool_response;
    }
    if (signal?.aborted) {
      this.logInterruption('aborted', input.tool_name);
      return input.tool_response;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const interruption = new Promise<CapInterruption>((resolve) => {
      timer = setTimeout(
        () => resolve('timeout'),
        POST_TOOL_USE_CAP_TIMEOUT_MS,
      );
      timer.unref?.();
      onAbort = () => resolve('aborted');
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      // The capper keeps running after a timeout or abort: it is not handed
      // the signal, so it may still finish, and may still write a spool file
      // that nothing references. Its late result (or rejection) is discarded
      // because the race has already settled. This is accepted (TASK_2026_614
      // G-E, FM-7): the original output was returned, and an orphan spool
      // file costs only disk.
      const outcome = await Promise.race([
        capper
          .cap(input.tool_name, input.tool_input, input.tool_response, cwd)
          .then((output) => ({ output })),
        interruption,
      ]);
      if (typeof outcome === 'string') {
        this.logInterruption(outcome, input.tool_name);
        return input.tool_response;
      }
      return outcome.output;
    } catch (error: unknown) {
      this.logger.warn(
        '[PostToolUseHookHandler] output capper threw, ignoring',
        {
          error: error instanceof Error ? error.message : String(error),
          toolName: input.tool_name,
        },
      );
      return input.tool_response;
    } finally {
      clearTimeout(timer);
      if (onAbort) {
        signal?.removeEventListener('abort', onAbort);
      }
    }
  }

  private logInterruption(reason: CapInterruption, toolName: string): void {
    if (reason === 'timeout') {
      this.logger.warn(
        '[PostToolUseHookHandler] output capper exceeded its time bound, keeping the original output',
        { toolName, timeoutMs: POST_TOOL_USE_CAP_TIMEOUT_MS },
      );
      return;
    }
    this.logger.debug(
      '[PostToolUseHookHandler] hook aborted before the output cap finished, keeping the original output',
      { toolName },
    );
  }

  private fanOut(
    input: PostToolUseHookInput,
    sessionId: string | undefined,
    cwd: string,
  ): void {
    try {
      if (this.callbackRegistry.size === 0) {
        return;
      }
      const exitCode = extractExitCode(input.tool_response);
      const success = deriveSuccess(input.tool_response, exitCode);
      const resolvedSessionId = resolveHookSessionId(
        input.session_id,
        sessionId,
      );
      if (!resolvedSessionId) {
        this.logger.warn(
          '[PostToolUseHookHandler] PostToolUse missing sessionId, skipping fan-out',
          { toolName: input.tool_name },
        );
        return;
      }
      this.callbackRegistry.notifyAll({
        toolName: input.tool_name,
        toolInput: input.tool_input,
        toolOutput: input.tool_response,
        exitCode,
        success,
        sessionId: resolvedSessionId,
        workspaceRoot: cwd,
        timestamp: Date.now(),
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[PostToolUseHookHandler] hook fan-out threw, swallowing',
        {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        },
      );
    }
  }
}
