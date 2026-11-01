import { z } from 'zod';
import {
  codexNotificationSchemas,
  isUnmodeledCodexNotification,
} from './codex-protocol-validator';
import { tokenUsageNotification } from './codex-protocol-schemas';
import type {
  CodexJsonValue,
  CodexRuntimeEvent,
  CodexRuntimeError,
  CodexReportedUsage,
  CodexUsageCounters,
  CodexUsageEvidence,
  CodexUsageDiagnostic,
} from './codex-runtime.types';

type Item = z.infer<(typeof codexNotificationSchemas)['item/started']>['item'];
type Payload = CodexRuntimeEvent extends infer E
  ? E extends CodexRuntimeEvent
    ? Omit<
        E,
        'contextId' | 'processGeneration' | 'threadId' | 'turnId' | 'sequence'
      >
    : never
  : never;
const correlation = z.object({ threadId: z.string(), turnId: z.string() });
const itemEnvelope = correlation.extend({
  item: z.object({ id: z.string(), type: z.string() }),
});
const asyncQuestions = z.array(z.object({
  title: z.string(),
  options: z.array(z.string()).nullish(),
}));
type Usage = z.infer<typeof tokenUsageNotification>['tokenUsage']['total'];
function counters(value: Usage): CodexUsageCounters {
  const cacheCreationTokens = value.cacheWriteInputTokens ?? 0;
  return {
    uncachedInputTokens: Math.max(
      0, value.inputTokens - value.cachedInputTokens - cacheCreationTokens,
    ),
    outputTokens: value.outputTokens,
    cacheReadTokens: value.cachedInputTokens,
    cacheCreationTokens,
    reasoningOutputTokens: value.reasoningOutputTokens,
    totalTokens: value.totalTokens,
  };
}

const ZERO_USAGE: Usage = {
  inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0,
  outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0,
};

function addUsage(current: Usage, prior: CodexReportedUsage | undefined): Usage {
  return {
    inputTokens: current.inputTokens + (prior?.inputTokens ?? 0),
    cachedInputTokens: current.cachedInputTokens + (prior?.cachedInputTokens ?? 0),
    cacheWriteInputTokens: (current.cacheWriteInputTokens ?? 0) + (prior?.cacheWriteInputTokens ?? 0),
    outputTokens: current.outputTokens + (prior?.outputTokens ?? 0),
    reasoningOutputTokens: current.reasoningOutputTokens + (prior?.reasoningOutputTokens ?? 0),
    totalTokens: current.totalTokens + (prior?.totalTokens ?? 0),
  };
}

function decreased(current: Usage, prior: Usage): boolean {
  return current.inputTokens < prior.inputTokens ||
    current.cachedInputTokens < prior.cachedInputTokens ||
    (current.cacheWriteInputTokens ?? 0) < (prior.cacheWriteInputTokens ?? 0) ||
    current.outputTokens < prior.outputTokens ||
    current.reasoningOutputTokens < prior.reasoningOutputTokens ||
    current.totalTokens < prior.totalTokens;
}

function changed(current: Usage, prior: Usage): boolean {
  return current.inputTokens !== prior.inputTokens ||
    current.cachedInputTokens !== prior.cachedInputTokens ||
    (current.cacheWriteInputTokens ?? 0) !== (prior.cacheWriteInputTokens ?? 0) ||
    current.outputTokens !== prior.outputTokens ||
    current.reasoningOutputTokens !== prior.reasoningOutputTokens;
}
function difference(total: Usage, baseline: Usage): Usage {
  return {
    inputTokens: total.inputTokens - baseline.inputTokens,
    cachedInputTokens: total.cachedInputTokens - baseline.cachedInputTokens,
    cacheWriteInputTokens:
      (total.cacheWriteInputTokens ?? 0) -
      (baseline.cacheWriteInputTokens ?? 0),
    outputTokens: total.outputTokens - baseline.outputTokens,
    reasoningOutputTokens:
      total.reasoningOutputTokens - baseline.reasoningOutputTokens,
    totalTokens: total.totalTokens - baseline.totalTokens,
  };
}

type Identity = z.infer<typeof correlation>;

function safeError(code: string, retryable = false): CodexRuntimeError {
  return {
    code,
    message: 'Codex could not complete this operation.',
    retryable,
  };
}

function toolStatus(status: string): 'completed' | 'failed' | 'cancelled' {
  if (status === 'completed') return 'completed';
  if (status === 'declined' || status === 'interrupted') return 'cancelled';
  return 'failed';
}

/** Forwarded tool output is bounded per string; the exposure equals Claude's Bash output. */
export const MAX_TOOL_OUTPUT_CHARS = 10_000;
const TRUNCATED_MARKER = '\n[output truncated]';

function boundText(text: string): string {
  return text.length <= MAX_TOOL_OUTPUT_CHARS
    ? text
    : `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}${TRUNCATED_MARKER}`;
}

/** Bounds every string leaf of a validated value; structure and other leaves pass through. */
function boundJson(value: CodexJsonValue): CodexJsonValue {
  if (typeof value === 'string') return boundText(value);
  if (Array.isArray(value)) return value.map(boundJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(
      ([key, entry]): [string, CodexJsonValue] => [key, boundJson(entry)],
    ),
  );
}

/** One instance per context/process generation. No I/O or routing side effects. */
export class CodexEventTranslator {
  private sequence = 0;
  private readonly terminals = new Map<string, 'completed' | 'failed' | 'interrupted'>();
  private readonly usage = new Map<string, CodexReportedUsage>();
  private readonly totals = new Map<string, Usage>();
  private readonly baselines = new Map<string, Usage>();
  private readonly evidence = new Map<string, CodexUsageEvidence>();
  private readonly epochs = new Map<string, number>();
  private readonly epochTurnOffsets = new Map<string, CodexReportedUsage>();
  /** Turn key -> item ids whose reasoning summary deltas were streamed; textDelta stays silent for them. */
  private readonly summaryItems = new Map<string, Set<string>>();
  private readonly asyncMessageItems = new Set<string>();
  /** Deltas that were already visible before completion revealed async delivery. */
  private readonly streamedMessageItems = new Set<string>();
  private disposed = false;

  constructor(
    private readonly contextId: string,
    private readonly processGeneration: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Params are checked against Batch 2b even when the caller already validated them. */
  translate(notification: {
    readonly method: string;
    readonly params?: unknown;
  }): CodexRuntimeEvent[] {
    if (this.disposed) return [];
    const { method, params } = notification;
    switch (method) {
      case 'initialized':
        return [];
      case 'turn/started': {
        const parsed = codexNotificationSchemas[method].safeParse(params);
        if (!parsed.success) return this.invalid(params);
        const identity = {
          threadId: parsed.data.threadId,
          turnId: parsed.data.turn.id,
        };
        const total = this.totals.get(identity.threadId);
        const key = this.key(identity);
        if (total && !this.baselines.has(key) && !this.terminals.has(key))
          this.baselines.set(key, total);
        return [];
      }
      // Approval correlation and decisions belong to the approval bridge (2g).
      case 'serverRequest/resolved':
      case 'account/rateLimits/updated':
      case 'thread/status/changed':
      case 'thread/started':
      case 'turn/moderationMetadata':
      case 'mcpServer/startupStatus/updated':
      case 'remoteControl/status/changed':
        return [];
      case 'item/agentMessage/delta': {
        const parsed = codexNotificationSchemas[method].safeParse(params);
        if (!parsed.success) return this.invalid(params);
        const itemKey = this.key(parsed.data) + ':' + parsed.data.itemId;
        if (this.asyncMessageItems.has(itemKey)) return [];
        if (parsed.data.delta !== '') this.streamedMessageItems.add(itemKey);
        return this.emit(parsed.data, [
          {
            type: 'textDelta',
            itemId: parsed.data.itemId,
            delta: parsed.data.delta,
          },
        ]);
      }
      case 'item/reasoning/summaryTextDelta': {
        const parsed = codexNotificationSchemas[method].safeParse(params);
        if (!parsed.success) return this.invalid(params);
        if (parsed.data.delta === '') return [];
        const key = this.key(parsed.data);
        const items = this.summaryItems.get(key) ?? new Set<string>();
        items.add(parsed.data.itemId);
        this.summaryItems.set(key, items);
        return this.emit(parsed.data, [
          {
            type: 'reasoning',
            itemId: parsed.data.itemId,
            phase: 'delta',
            text: parsed.data.delta,
          },
        ]);
      }
      case 'item/reasoning/textDelta': {
        const parsed = codexNotificationSchemas[method].safeParse(params);
        if (!parsed.success) return this.invalid(params);
        // Raw reasoning text streams only for items with no summary deltas;
        // the completed item's summary stays authoritative.
        if (
          parsed.data.delta === '' ||
          this.summaryStreamed(parsed.data, parsed.data.itemId)
        )
          return [];
        return this.emit(parsed.data, [
          {
            type: 'reasoning',
            itemId: parsed.data.itemId,
            phase: 'delta',
            text: parsed.data.delta,
          },
        ]);
      }
      case 'item/started':
      case 'item/completed': {
        const parsed = codexNotificationSchemas[method].safeParse(params);
        if (!parsed.success) {
          const envelope = itemEnvelope.safeParse(params);
          // Never echo unknown type names or their arbitrary payloads.
          return envelope.success
            ? this.emit(envelope.data, [
                { type: 'error', error: safeError('unsupportedItem') },
              ])
            : this.invalid(params);
        }
        if (parsed.data.item.type === 'agentMessage') {
          const itemKey = this.key(parsed.data) + ':' + parsed.data.item.id;
          if (method === 'item/started' && parsed.data.item.delivery === 'async')
            this.asyncMessageItems.add(itemKey);
          if (method === 'item/completed') this.asyncMessageItems.delete(itemKey);
          const streamed = this.streamedMessageItems.has(itemKey);
          if (method === 'item/completed') this.streamedMessageItems.delete(itemKey);
          return this.emit(
            parsed.data,
            this.item(parsed.data.item, method === 'item/completed', streamed),
          );
        }
        return this.emit(
          parsed.data,
          this.item(parsed.data.item, method === 'item/completed'),
        );
      }
      case 'thread/tokenUsage/updated': {
        const parsed = tokenUsageNotification.safeParse(params);
        if (!parsed.success) return this.invalid(
          params, 'usageNotificationInvalid', true, 'invalid-payload',
        );
        const data = parsed.data;
        // last is one model request; total accumulates all requests in the thread.
        const key = this.key(data);
        const priorTotal = this.totals.get(data.threadId);
        const decrease = priorTotal !== undefined && decreased(data.tokenUsage.total, priorTotal);
        const reset = decrease && data.tokenUsage.counterReset === true;
        const resetOrStale = priorTotal !== undefined && (
          decrease ||
          (data.tokenUsage.total.totalTokens === priorTotal.totalTokens &&
            changed(data.tokenUsage.total, priorTotal))
        );
        const stale = resetOrStale && !reset;
        const lastExceedsTotal = decreased(data.tokenUsage.total, data.tokenUsage.last);
        const classesInconsistent = [data.tokenUsage.total, data.tokenUsage.last].some(
          (value) => value.cachedInputTokens + (value.cacheWriteInputTokens ?? 0) > value.inputTokens ||
            value.reasoningOutputTokens > value.outputTokens,
        );
        // Native cache-write inclusion is not established by the pinned schema.
        const cacheSemanticsAmbiguous = classesInconsistent ||
          (data.tokenUsage.total.cacheWriteInputTokens ?? 0) > 0 ||
          (data.tokenUsage.last.cacheWriteInputTokens ?? 0) > 0;
        const diagnostics: CodexUsageDiagnostic[] = [];
        if (cacheSemanticsAmbiguous) diagnostics.push('cache-semantics-ambiguous');
        if (classesInconsistent) diagnostics.push('classes-inconsistent');
        if (lastExceedsTotal) diagnostics.push('last-exceeds-total');
        if (stale) diagnostics.push('stale-cumulative');
        if (reset) diagnostics.push('counter-reset');
        const epoch = (this.epochs.get(data.threadId) ?? 0) + (reset ? 1 : 0);
        const terminalState = this.terminals.get(key) ?? 'none';
        const evidence: CodexUsageEvidence = {
          threadId: data.threadId,
          turnId: data.turnId,
          ...(data.parentThreadId == null
            ? {}
            : { parentThreadId: data.parentThreadId }),
          ...(data.model == null ? {} : { modelId: data.model }),
          total: counters(data.tokenUsage.total),
          last: counters(data.tokenUsage.last),
          timestamp: this.now(),
          terminalState,
          resetOrStale,
          accepted: !stale,
          epoch,
          cacheSemanticsAmbiguous,
          lastExceedsTotal,
          diagnostics,
        };
        if (stale) {
          const current = this.usage.get(key);
          return current === undefined
            ? this.emit(data, [{ type: 'usage', usage: {}, evidence }], true)
            : this.emit(data, [{ type: 'usage', usage: current, evidence }], true);
        }
        if (reset) {
          this.epochs.set(data.threadId, epoch);
          this.epochTurnOffsets.set(key, this.usage.get(key) ?? {});
          this.baselines.set(key, ZERO_USAGE);
        }
        const baseline =
          this.baselines.get(key) ??
          priorTotal ??
          (lastExceedsTotal ? ZERO_USAGE : difference(data.tokenUsage.total, data.tokenUsage.last));
        this.baselines.set(key, baseline);
        if (
          reset || priorTotal === undefined ||
          data.tokenUsage.total.totalTokens > priorTotal.totalTokens
        )
          this.totals.set(data.threadId, data.tokenUsage.total);
        const modelContextWindow = data.tokenUsage.modelContextWindow;
        const usage: CodexReportedUsage = {
          ...addUsage(
            difference(data.tokenUsage.total, baseline),
            this.epochTurnOffsets.get(key),
          ),
          lastRequestTotalTokens: data.tokenUsage.last.totalTokens,
          // Only a positive server-reported window is carried; null or absent
          // stays absent so no consumer can mistake a missing window for one.
          ...(typeof modelContextWindow === 'number' && modelContextWindow > 0
            ? { modelContextWindow }
            : {}),
        };
        this.usage.set(this.key(data), usage);
        this.evidence.set(key, evidence);
        return this.emit(data, [{ type: 'usage', usage, evidence }], true);
      }
      case 'error': {
        const parsed = codexNotificationSchemas[method].safeParse(params);
        if (!parsed.success) return this.invalid(params);
        return this.emit(parsed.data, [
          {
            type: 'error',
            error: safeError('turnError', parsed.data.willRetry),
          },
        ]);
      }
      case 'turn/completed': {
        const parsed = codexNotificationSchemas[method].safeParse(params);
        if (!parsed.success) return this.invalid(params);
        const { threadId, turn } = parsed.data;
        const identity = { threadId, turnId: turn.id };
        if (turn.status === 'inProgress') return this.invalid(identity);
        const key = this.key(identity);
        if (this.terminals.has(key)) return [];
        const usage = this.usage.get(key);
        // Terminal evidence is the last accepted snapshot, not the last observed stale one.
        const evidence = this.evidence.get(key);
        const events = this.emit(identity, [
          {
            type: 'terminal',
            status: turn.status,
            ...(usage === undefined ? {} : { usage }),
            ...(evidence === undefined ? {} : {
              evidence: { ...evidence, terminalState: turn.status },
            }),
            ...(turn.error == null ? {} : { error: safeError('turnError') }),
          },
        ]);
        this.terminals.set(key, turn.status);
        // Keep turn checkpoints for usage notifications that trail the terminal.
        this.summaryItems.delete(key);
        for (const itemKey of this.asyncMessageItems)
          if (itemKey.startsWith(key + ':')) this.asyncMessageItems.delete(itemKey);
        for (const itemKey of this.streamedMessageItems)
          if (itemKey.startsWith(key + ':')) this.streamedMessageItems.delete(itemKey);
        return events;
      }
      default:
        if (isUnmodeledCodexNotification(method)) return [];
        return this.invalid(params);
    }
  }

  /** Release turn tombstones when the owning context closes. */
  dispose(): void {
    this.disposed = true;
    this.terminals.clear();
    this.usage.clear();
    this.evidence.clear();
    this.totals.clear();
    this.baselines.clear();
    this.epochs.clear();
    this.epochTurnOffsets.clear();
    this.summaryItems.clear();
    this.asyncMessageItems.clear();
    this.streamedMessageItems.clear();
  }

  private key(identity: Identity): string {
    return JSON.stringify([identity.threadId, identity.turnId]);
  }

  private summaryStreamed(identity: Identity, itemId: string): boolean {
    return this.summaryItems.get(this.key(identity))?.has(itemId) ?? false;
  }

  private emit(identity: Identity, payloads: Payload[], allowAfterTerminal = false): CodexRuntimeEvent[] {
    if (!allowAfterTerminal && this.terminals.has(this.key(identity))) return [];
    return payloads.map((payload) => ({
      ...payload,
      contextId: this.contextId,
      processGeneration: this.processGeneration,
      threadId: identity.threadId,
      turnId: identity.turnId,
      sequence: ++this.sequence,
    }));
  }

  private invalid(
    params: unknown,
    code = 'unsupportedNotification',
    allowAfterTerminal = false,
    diagnostic?: CodexUsageDiagnostic,
  ): CodexRuntimeEvent[] {
    const parsed = correlation.safeParse(params);
    return parsed.success
      ? this.emit(parsed.data, [
          { type: 'error', error: safeError(code),
            ...(diagnostic === undefined ? {} : { diagnostic }) },
        ], allowAfterTerminal)
      : [];
  }

  private item(item: Item, completed: boolean, streamed = false): Payload[] {
    switch (item.type) {
      case 'userMessage':
        return [];
      case 'agentMessage': {
        if (!completed) return [];
        const parsedQuestions = asyncQuestions.safeParse(item.questions);
        if (item.delivery === 'async' && parsedQuestions.success && parsedQuestions.data.length)
          return [{
            type: 'userInputAsync',
            itemId: item.id,
            text: item.text,
            ...(streamed ? { presentation: 'text' as const } : {}),
            questions: parsedQuestions.data.map((question) => ({
              title: question.title,
              ...(question.options == null ? {} : { options: question.options }),
            })),
          }];
        return [{ type: 'textFinal', itemId: item.id, text: item.text }];
      }
      case 'sleep':
        return [];
      case 'reasoning':
        return completed
          ? [
              {
                type: 'reasoning',
                itemId: item.id,
                phase: 'final',
                text: (item.summary?.length
                  ? item.summary
                  : (item.content ?? [])
                ).join('\n'),
              },
            ]
          : [];
      case 'plan':
        return completed
          ? [
              {
                type: 'reasoning',
                itemId: item.id,
                phase: 'final',
                text: item.text,
              },
            ]
          : [];
      case 'contextCompaction':
        return [
          { type: 'compaction', phase: completed ? 'completed' : 'started' },
        ];
      case 'commandExecution':
        return completed
          ? [
              {
                type: 'toolCompleted',
                toolId: item.id,
                status: toolStatus(item.status),
                output: boundJson(item.aggregatedOutput ?? null),
                ...(item.exitCode == null ? {} : { exitCode: item.exitCode }),
              },
            ]
          : [
              {
                type: 'toolStarted',
                toolId: item.id,
                toolName: 'commandExecution',
                input: { command: item.command, cwd: item.cwd },
              },
            ];
      case 'mcpToolCall':
        return completed
          ? [
              {
                type: 'toolCompleted',
                toolId: item.id,
                status: item.error ? 'failed' : toolStatus(item.status),
                // _meta is protocol plumbing, not tool output; it is not forwarded.
                output: item.result
                  ? boundJson({
                      content: item.result.content,
                      ...(item.result.structuredContent === undefined
                        ? {}
                        : { structuredContent: item.result.structuredContent }),
                    })
                  : null,
                ...(item.error
                  ? { errorText: boundText(item.error.message) }
                  : {}),
              },
            ]
          : [
              {
                type: 'toolStarted',
                toolId: item.id,
                toolName: `${item.server}/${item.tool}`,
                input: item.arguments,
              },
            ];
      case 'fileChange': {
        if (!completed)
          return [
            {
              type: 'toolStarted',
              toolId: item.id,
              toolName: 'fileChange',
              input: { changes: item.changes },
            },
          ];
        const result: Payload[] = [
          {
            type: 'toolCompleted',
            toolId: item.id,
            status: toolStatus(item.status),
            output: null,
          },
        ];
        if (item.status === 'completed') {
          for (const change of item.changes)
            result.push({
              type: 'file',
              itemId: item.id,
              path: change.path,
              operation: change.kind.type,
              diff: change.diff,
            });
        }
        return result;
      }
      case 'dynamicToolCall':
        return completed
          ? [
              {
                type: 'toolCompleted',
                toolId: item.id,
                status:
                  item.success === false ? 'failed' : toolStatus(item.status),
                // A failure reports its own content items; no text is invented.
                output: boundJson(item.contentItems ?? null),
              },
            ]
          : [
              {
                type: 'toolStarted',
                toolId: item.id,
                toolName: item.tool,
                input: item.arguments,
              },
            ];
      case 'collabAgentToolCall':
        return completed
          ? [
              {
                type: 'toolCompleted',
                toolId: item.id,
                status: toolStatus(item.status),
                output: { receiverThreadIds: item.receiverThreadIds },
              },
            ]
          : [
              {
                type: 'toolStarted',
                toolId: item.id,
                toolName: item.tool,
                input: { receiverThreadIds: item.receiverThreadIds },
              },
            ];
      case 'webSearch':
        return completed
          ? [
              {
                type: 'toolCompleted',
                toolId: item.id,
                status: 'completed',
                output: item.results ?? null,
              },
            ]
          : [
              {
                type: 'toolStarted',
                toolId: item.id,
                toolName: 'webSearch',
                input: { query: item.query },
              },
            ];
      // imageView supplies a path, not bytes/mediaType; never invent an image.
      // Unproved subagent/image item shapes remain visible without exposing payloads.
      default:
        return [{ type: 'error', error: safeError('unsupportedItem') }];
    }
  }
}
