/**
 * `session_submit` MCP-tool dispatcher (CLI side).
 *
 * Implements the {@link ISessionSubmitHandler} port from
 * `@ptah-extension/vscode-lm-tools`. Lives in `apps/ptah-cli/` because the
 * implementation needs to call into the CLI's in-process transport
 * (`chat:start`, `chat:abort`) and listen on the CLI push adapter
 * (`CliWebviewManagerAdapter`) — both of which are CLI-only concerns. The
 * lib defines the contract; the CLI command constructs and registers this
 * handler after `withEngine` resolves.
 *
 * Behavior summary:
 *
 *   1. Validate `tools/call session_submit` arguments via Zod.
 *   2. Build a Team Leader prompt with {@link buildTeamLeaderPrompt}
 *      (re-used from `execute-spec.ts:46`) wrapped in an MCP-origin header
 *      and a conditional sub-agent directive.
 *   3. Mint a tabId (`ulid()`); call `transport.call('chat:start', ...)`
 *      with `prompt`, `workspacePath`, and optional preset.
 *   4. Attach per-tabId listeners on `pushAdapter` for `chat:chunk`,
 *      `chat:complete`, `chat:error`. Each `chat:chunk` is forwarded to
 *      the MCP host as `notifications/message` AND — when the inbound
 *      `tools/call` carried `_meta.progressToken` — as
 *      `notifications/progress`.
 *   5. Aggregate `text_delta` + `message_complete` chunks into a buffer
 *      (1 MiB cap; on overrun the truncation flag is set on the final
 *      structured result).
 *   6. Resolve the MCP result with `{ content: [{ type:'text',
 *      text:<aggregated> }], structuredContent: { tabId, sessionId, … } }`.
 *   7. On inbound `notifications/cancelled` whose `requestId` matches a
 *      tracked in-flight call: invoke `transport.call('chat:abort', ...)`
 *      and resolve the tool call with `isError: true, text: 'cancelled'`.
 *
 * The dispatcher does NOT touch JSON-RPC framing — it accepts an
 * {@link McpNotifier} that the CLI command binds to `JsonRpcServer.notify`.
 */

import { z } from 'zod';
import { ulid } from 'ulid';
import type {
  ISessionSubmitHandler,
  SessionSubmitCancellation,
} from '@ptah-extension/vscode-lm-tools';
import type { MCPRequest, MCPResponse } from '@ptah-extension/vscode-lm-tools';
import type { Logger } from '@ptah-extension/vscode-core';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../../transport/cli-webview-manager-adapter.js';
import { buildTeamLeaderPrompt } from '../../cli/commands/team-leader-prompt.js';

/**
 * Maximum task length accepted by `session_submit`. Mirrors `agent_spawn`
 * to keep the wire surface consistent.
 */
const MAX_TASK_LENGTH = 100 * 1024;

/**
 * Aggregate text buffer cap, in bytes. Sized to match the desktop MCP
 * `AGENT_OUTPUT_BUFFER` cap so external hosts see a predictable upper
 * bound on the aggregated message.
 */
const AGGREGATE_BUFFER_CAP = 1024 * 1024;

const SessionSubmitSchema = z
  .object({
    task: z.string().min(1).max(MAX_TASK_LENGTH),
    cwd: z.string().optional(),
    allowSubagents: z.boolean().optional(),
    profile: z.enum(['claude_code', 'enhanced']).optional(),
  })
  .strict();

type SessionSubmitArgs = z.infer<typeof SessionSubmitSchema>;

/**
 * MCP notification emitter. The CLI command supplies a tiny adapter
 * wrapping `JsonRpcServer.notify` so the lib does not need to import the
 * CLI's JSON-RPC server.
 */
export interface McpNotifier {
  notify<TParams = unknown>(method: string, params?: TParams): Promise<void>;
}

export interface SessionSubmitServiceDeps {
  readonly transport: CliMessageTransport;
  readonly pushAdapter: CliWebviewManagerAdapter;
  readonly notifier: McpNotifier;
  readonly logger: Logger;
  /** Workspace cwd injected by the CLI command (falls back when args.cwd absent). */
  readonly cwd: string;
  /** Override hook for tests. */
  readonly randomId?: () => string;
}

interface InFlightCall {
  readonly tabId: string;
  readonly abort: AbortController;
  /** Resolves when the in-flight chat session settles. */
  settle: (resp: MCPResponse) => void;
}

/**
 * Per-call cost aggregation forwarded in the final `mcp.session.summary`
 * notification. Token totals are running totals; the cost is in USD.
 */
interface CostAggregate {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
}

type ChatChunkEvent = {
  readonly eventType: string;
  readonly sessionId?: string;
  readonly id?: string;
  readonly messageId?: string;
  readonly delta?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolInput?: Record<string, unknown>;
  readonly output?: unknown;
  readonly isError?: boolean;
  readonly text?: string;
};

interface ChatChunkPayload {
  readonly tabId?: unknown;
  readonly sessionId?: unknown;
  readonly event?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeIssues(issues: ReturnType<z.ZodError['flatten']>): string {
  const fieldEntries = Object.entries(
    issues.fieldErrors as Record<string, string[] | undefined>,
  );
  const fields = fieldEntries
    .map(([field, errs]) => `${field}: ${(errs ?? []).join('; ')}`)
    .join(' | ');
  const top = (issues.formErrors as string[]).join('; ');
  if (fields.length > 0 && top.length > 0) return `${top} | ${fields}`;
  if (fields.length > 0) return fields;
  if (top.length > 0) return top;
  return 'invalid session_submit arguments';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildErrorResult(
  request: MCPRequest,
  text: string,
  ptahCode: string,
  extra: Record<string, unknown> = {},
): MCPResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      content: [{ type: 'text', text }],
      isError: true,
      structuredContent: {
        ptah_code: ptahCode,
        tool: 'session_submit',
        ...extra,
      },
    },
  };
}

/**
 * Build the Team Leader prompt for a session_submit call. Re-uses the
 * canonical {@link buildTeamLeaderPrompt} so the prompt shape stays in
 * lockstep with `ptah execute-spec`. The MCP-origin header and the
 * sub-agent directive are added as inline preamble/postamble — they do
 * not modify the canonical template.
 */
export function buildSessionSubmitPrompt(
  task: string,
  allowSubagents: boolean,
): string {
  const synthId = `MCP-SUBMIT-${new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '')}`;
  const taskDescription = [
    'This task was delegated to Ptah by an external MCP host via the `session_submit` tool.',
    '',
    'Inline task body:',
    task,
  ].join('\n');
  const subagentDirective = allowSubagents
    ? 'Use the Task tool to fan out work to sub-agents per the implementation plan you derive. Coordinate them in parallel where dependencies permit, and aggregate their results before reporting back.'
    : 'Do NOT spawn sub-agents. Complete the task in this single session.';
  const implementationPlan = [
    'There is no pre-built implementation plan for this MCP-originated task.',
    '',
    'Derive one from the inline task body above:',
    '  1. Read the task and surrounding workspace context as needed.',
    '  2. Identify the smallest set of concrete deliverables that satisfy the task.',
    '  3. Order the deliverables by dependency.',
    `  4. ${subagentDirective}`,
    '  5. After every deliverable: run the relevant validation gates (typecheck, test, lint, build).',
    '  6. Surface progress before each batch and verification results after each batch.',
    '  7. Halt and report blockers rather than improvising.',
  ].join('\n');
  return buildTeamLeaderPrompt(synthId, taskDescription, implementationPlan);
}

/**
 * `session_submit` dispatcher service. Constructed once per `mcp-serve`
 * process by the CLI command and registered with the lib via
 * `StdioMcpServerService.setSessionSubmitHandler(...)`.
 */
export class SessionSubmitService implements ISessionSubmitHandler {
  private readonly inFlight = new Map<string | number, InFlightCall>();

  constructor(private readonly deps: SessionSubmitServiceDeps) {}

  async dispatch(request: MCPRequest, args: unknown): Promise<MCPResponse> {
    const candidate = args !== null && typeof args === 'object' ? args : {};
    const parsed = SessionSubmitSchema.safeParse(candidate);
    if (!parsed.success) {
      return buildErrorResult(
        request,
        `Invalid arguments for session_submit: ${describeIssues(parsed.error.flatten())}`,
        'mcp_invalid_tool_args',
        { issues: parsed.error.flatten() },
      );
    }
    return this.execute(request, parsed.data);
  }

  async cancel(payload: SessionSubmitCancellation): Promise<void> {
    const tracked = this.inFlight.get(payload.requestId);
    if (tracked === undefined) {
      return;
    }
    this.deps.logger.info('[McpSessionSubmit] cancellation requested', {
      requestId: payload.requestId,
      tabId: tracked.tabId,
    });
    tracked.abort.abort();
    try {
      await this.deps.transport.call('chat:abort', {
        sessionId: tracked.tabId,
      });
    } catch (err) {
      this.deps.logger.warn('[McpSessionSubmit] chat:abort failed', {
        error: errorMessage(err),
        tabId: tracked.tabId,
      });
    }
  }

  private async execute(
    request: MCPRequest,
    args: SessionSubmitArgs,
  ): Promise<MCPResponse> {
    const randomId = this.deps.randomId ?? ulid;
    const tabId = randomId();
    const allowSubagents = args.allowSubagents ?? true;
    const prompt = buildSessionSubmitPrompt(args.task, allowSubagents);
    const workspacePath = args.cwd ?? this.deps.cwd;
    const progressToken = extractProgressToken(request);
    const abort = new AbortController();

    let aggregatedText = '';
    let aggregatedTruncated = false;
    let resolvedSessionId: string = tabId;
    let totalEvents = 0;
    const cost: CostAggregate = {
      totalUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCallCount: 0,
    };
    const mcpHostSessionId =
      typeof process !== 'undefined'
        ? (process.env?.['PTAH_MCP_HOST_SESSION_ID'] ?? null)
        : null;

    const settlePromise = new Promise<MCPResponse>((resolve) => {
      const inflight: InFlightCall = {
        tabId,
        abort,
        settle: (resp: MCPResponse): void => {
          resolve(resp);
        },
      };
      this.inFlight.set(request.id, inflight);
    });

    const forward = async (
      method: string,
      params: Record<string, unknown>,
    ): Promise<void> => {
      try {
        await this.deps.notifier.notify(method, params);
      } catch (err) {
        this.deps.logger.warn('[McpSessionSubmit] notify failed', {
          method,
          error: errorMessage(err),
        });
      }
    };

    const onChunk = (payload: unknown): void => {
      if (!isObject(payload)) return;
      const chunk = payload as ChatChunkPayload;
      if (typeof chunk.tabId !== 'string' || chunk.tabId !== tabId) return;
      const event = chunk.event as ChatChunkEvent | undefined;
      if (event === undefined || typeof event.eventType !== 'string') return;
      totalEvents += 1;
      if (
        event.eventType === 'message_start' &&
        typeof event.sessionId === 'string' &&
        event.sessionId.length > 0
      ) {
        resolvedSessionId = event.sessionId;
      }
      if (event.eventType === 'text_delta') {
        const text = event.delta ?? event.text ?? '';
        if (text.length > 0 && !aggregatedTruncated) {
          if (aggregatedText.length + text.length <= AGGREGATE_BUFFER_CAP) {
            aggregatedText += text;
          } else {
            aggregatedTruncated = true;
            const room = AGGREGATE_BUFFER_CAP - aggregatedText.length;
            if (room > 0) aggregatedText += text.slice(0, room);
          }
        }
      } else if (event.eventType === 'message_complete') {
        const text = event.text ?? '';
        if (text.length > 0 && !aggregatedTruncated) {
          if (aggregatedText.length + text.length <= AGGREGATE_BUFFER_CAP) {
            aggregatedText += text;
          } else {
            aggregatedTruncated = true;
          }
        }
      } else if (
        event.eventType === 'agent.tool_use' ||
        event.eventType === 'tool_use'
      ) {
        cost.toolCallCount += 1;
      }
      const messageParams: Record<string, unknown> = {
        level: 'info',
        data: {
          kind: event.eventType,
          tabId,
          sessionId: resolvedSessionId,
          payload: event,
        },
      };
      void forward('notifications/message', messageParams);
      if (progressToken !== undefined) {
        void forward('notifications/progress', {
          progressToken,
          progress: totalEvents,
        });
      }
    };

    const onCost = (payload: unknown): void => {
      if (!isObject(payload)) return;
      const sid = payload['session_id'];
      const isOurSession =
        (typeof sid === 'string' && sid === resolvedSessionId) ||
        (typeof sid === 'string' && sid === tabId) ||
        sid === undefined;
      if (!isOurSession) return;
      const deltaUsd =
        typeof payload['delta_usd'] === 'number'
          ? (payload['delta_usd'] as number)
          : null;
      const totalUsd =
        typeof payload['total_usd'] === 'number'
          ? (payload['total_usd'] as number)
          : null;
      if (totalUsd !== null) {
        cost.totalUsd = totalUsd;
      } else if (deltaUsd !== null) {
        cost.totalUsd += deltaUsd;
      }
      void forward('notifications/message', {
        level: 'info',
        data: {
          kind: 'session.cost',
          mcpHostSessionId,
          sessionId: resolvedSessionId,
          turnId:
            typeof payload['turn_id'] === 'string'
              ? (payload['turn_id'] as string)
              : null,
          deltaUsd,
          totalUsd: cost.totalUsd,
          inputTokens: cost.inputTokens,
          outputTokens: cost.outputTokens,
        },
      });
    };

    const onTokens = (payload: unknown): void => {
      if (!isObject(payload)) return;
      const sid = payload['session_id'];
      const isOurSession =
        (typeof sid === 'string' && sid === resolvedSessionId) ||
        (typeof sid === 'string' && sid === tabId) ||
        sid === undefined;
      if (!isOurSession) return;
      const inputTokens =
        typeof payload['input_tokens'] === 'number'
          ? (payload['input_tokens'] as number)
          : null;
      const outputTokens =
        typeof payload['output_tokens'] === 'number'
          ? (payload['output_tokens'] as number)
          : null;
      const totalIn =
        typeof payload['total_input_tokens'] === 'number'
          ? (payload['total_input_tokens'] as number)
          : null;
      const totalOut =
        typeof payload['total_output_tokens'] === 'number'
          ? (payload['total_output_tokens'] as number)
          : null;
      if (totalIn !== null) cost.inputTokens = totalIn;
      else if (inputTokens !== null) cost.inputTokens += inputTokens;
      if (totalOut !== null) cost.outputTokens = totalOut;
      else if (outputTokens !== null) cost.outputTokens += outputTokens;
    };

    const finalize = (resp: MCPResponse): void => {
      const tracked = this.inFlight.get(request.id);
      if (tracked === undefined) return;
      this.inFlight.delete(request.id);
      this.deps.pushAdapter.off('chat:chunk', onChunk);
      this.deps.pushAdapter.off('chat:complete', onComplete);
      this.deps.pushAdapter.off('chat:error', onError);
      this.deps.pushAdapter.off('session:cost', onCost);
      this.deps.pushAdapter.off('session:cost-delta', onCost);
      this.deps.pushAdapter.off('session:tokens', onTokens);
      this.deps.pushAdapter.off('session:token-delta', onTokens);
      if (abortListener !== undefined) {
        abort.signal.removeEventListener('abort', abortListener);
      }
      // Emit the per-tool summary AFTER detaching listeners (and BEFORE
      // settling) so external hosts observe the summary before the
      // tools/call result lands on the wire.
      void forward('notifications/message', {
        level: 'info',
        data: {
          kind: 'mcp.session.summary',
          mcpHostSessionId,
          sessionId: resolvedSessionId,
          tabId,
          totalUsd: cost.totalUsd,
          totalTokens: cost.inputTokens + cost.outputTokens,
          inputTokens: cost.inputTokens,
          outputTokens: cost.outputTokens,
          toolCallCount: cost.toolCallCount,
        },
      });
      tracked.settle(resp);
    };

    const onComplete = (payload: unknown): void => {
      if (!isObject(payload)) return;
      if (payload['tabId'] !== tabId) return;
      const sid =
        typeof payload['sessionId'] === 'string' &&
        (payload['sessionId'] as string).length > 0
          ? (payload['sessionId'] as string)
          : resolvedSessionId;
      const text =
        aggregatedText.length > 0
          ? aggregatedText
          : 'session_submit completed (no aggregated text).';
      finalize({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text }],
          structuredContent: {
            tabId,
            sessionId: sid,
            eventCount: totalEvents,
            truncated: aggregatedTruncated,
          },
        },
      });
    };

    const onError = (payload: unknown): void => {
      if (!isObject(payload)) return;
      if (payload['tabId'] !== tabId) return;
      const message =
        typeof payload['error'] === 'string' &&
        (payload['error'] as string).length > 0
          ? (payload['error'] as string)
          : 'unknown chat error';
      finalize(
        buildErrorResult(
          request,
          `session_submit failed: ${message}`,
          'mcp_tool_failed',
          {
            tabId,
            sessionId: resolvedSessionId,
          },
        ),
      );
    };

    const abortListener = (): void => {
      finalize(
        buildErrorResult(
          request,
          'session_submit cancelled by host',
          'mcp_tool_cancelled',
          { tabId, sessionId: resolvedSessionId, cancelled: true },
        ),
      );
    };
    abort.signal.addEventListener('abort', abortListener, { once: true });

    this.deps.pushAdapter.on('chat:chunk', onChunk);
    this.deps.pushAdapter.on('chat:complete', onComplete);
    this.deps.pushAdapter.on('chat:error', onError);
    this.deps.pushAdapter.on('session:cost', onCost);
    this.deps.pushAdapter.on('session:cost-delta', onCost);
    this.deps.pushAdapter.on('session:tokens', onTokens);
    this.deps.pushAdapter.on('session:token-delta', onTokens);

    const rpcParams: Record<string, unknown> = {
      tabId,
      prompt,
      workspacePath,
      ...(args.profile !== undefined
        ? { options: { preset: args.profile } }
        : {}),
    };

    try {
      const ack = await this.deps.transport.call<unknown, unknown>(
        'chat:start',
        rpcParams,
      );
      if (ack.success !== true) {
        const ackError =
          typeof (ack as { error?: unknown }).error === 'string'
            ? (ack as { error: string }).error
            : 'chat:start rejected the session_submit request';
        finalize(
          buildErrorResult(
            request,
            `session_submit failed: ${ackError}`,
            'mcp_tool_failed',
            { tabId },
          ),
        );
      }
    } catch (err) {
      finalize(
        buildErrorResult(
          request,
          `session_submit failed: ${errorMessage(err)}`,
          'mcp_tool_failed',
          { tabId },
        ),
      );
    }

    return settlePromise;
  }
}

function extractProgressToken(
  request: MCPRequest,
): string | number | undefined {
  const params = request.params;
  if (!isObject(params)) return undefined;
  const meta = params['_meta'];
  if (!isObject(meta)) return undefined;
  const token = meta['progressToken'];
  if (typeof token === 'string' || typeof token === 'number') return token;
  return undefined;
}
