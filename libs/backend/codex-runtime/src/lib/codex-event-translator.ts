import { z } from 'zod';
import {
  codexNotificationSchemas,
  isUnmodeledCodexNotification,
} from './codex-protocol-validator';
import type {
  CodexRuntimeEvent,
  CodexRuntimeError,
  CodexReportedUsage,
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
type Usage = z.infer<
  (typeof codexNotificationSchemas)['thread/tokenUsage/updated']
>['tokenUsage']['total'];
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

/** One instance per context/process generation. No I/O or routing side effects. */
export class CodexEventTranslator {
  private sequence = 0;
  private readonly terminals = new Set<string>();
  private readonly usage = new Map<string, CodexReportedUsage>();
  private readonly totals = new Map<string, Usage>();
  private readonly baselines = new Map<string, Usage>();
  private disposed = false;

  constructor(
    private readonly contextId: string,
    private readonly processGeneration: number,
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
        return this.emit(parsed.data, [
          {
            type: 'textDelta',
            itemId: parsed.data.itemId,
            delta: parsed.data.delta,
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
        return this.emit(
          parsed.data,
          this.item(parsed.data.item, method === 'item/completed'),
        );
      }
      case 'thread/tokenUsage/updated': {
        const parsed = codexNotificationSchemas[method].safeParse(params);
        if (!parsed.success) return this.invalid(params);
        const data = parsed.data;
        if (this.terminals.has(this.key(data))) return [];
        // last is one model request; total accumulates all requests in the thread.
        const key = this.key(data);
        const baseline =
          this.baselines.get(key) ??
          this.totals.get(data.threadId) ??
          difference(data.tokenUsage.total, data.tokenUsage.last);
        this.baselines.set(key, baseline);
        this.totals.set(data.threadId, data.tokenUsage.total);
        const usage: CodexReportedUsage = {
          ...difference(data.tokenUsage.total, baseline),
          lastRequestTotalTokens: data.tokenUsage.last.totalTokens,
        };
        this.usage.set(this.key(data), usage);
        return this.emit(data, [{ type: 'usage', usage }]);
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
        const events = this.emit(identity, [
          {
            type: 'terminal',
            status: turn.status,
            ...(usage === undefined ? {} : { usage }),
            ...(turn.error == null ? {} : { error: safeError('turnError') }),
          },
        ]);
        this.terminals.add(key);
        this.usage.delete(key);
        this.baselines.delete(key);
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
    this.totals.clear();
    this.baselines.clear();
  }

  private key(identity: Identity): string {
    return JSON.stringify([identity.threadId, identity.turnId]);
  }

  private emit(identity: Identity, payloads: Payload[]): CodexRuntimeEvent[] {
    if (this.terminals.has(this.key(identity))) return [];
    return payloads.map((payload) => ({
      ...payload,
      contextId: this.contextId,
      processGeneration: this.processGeneration,
      threadId: identity.threadId,
      turnId: identity.turnId,
      sequence: ++this.sequence,
    }));
  }

  private invalid(params: unknown): CodexRuntimeEvent[] {
    const parsed = correlation.safeParse(params);
    return parsed.success
      ? this.emit(parsed.data, [
          { type: 'error', error: safeError('unsupportedNotification') },
        ])
      : [];
  }

  private item(item: Item, completed: boolean): Payload[] {
    switch (item.type) {
      case 'userMessage':
        return [];
      case 'agentMessage':
        return completed
          ? [{ type: 'textFinal', itemId: item.id, text: item.text }]
          : [];
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
                output:
                  item.status === 'completed'
                    ? (item.aggregatedOutput ?? null)
                    : { error: safeError('commandFailed').message },
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
                output:
                  item.error || item.status !== 'completed'
                    ? { error: safeError('toolFailed').message }
                    : (item.result ?? null),
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
                output:
                  item.status === 'completed' && item.success !== false
                    ? (item.contentItems ?? null)
                    : { error: safeError('toolFailed').message },
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
