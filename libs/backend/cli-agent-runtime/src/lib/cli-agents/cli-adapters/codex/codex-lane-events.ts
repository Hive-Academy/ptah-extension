import type {
  CodexReportedUsage,
  CodexRuntimeEvent,
} from '@ptah-extension/codex-runtime';
import type { CliOutputSegment } from '@ptah-extension/shared';

export type CodexLaneTurnIdentity = Pick<
  CodexRuntimeEvent,
  'contextId' | 'processGeneration' | 'threadId' | 'turnId'
>;
export interface CodexLaneEventOutput {
  readonly segments: readonly CliOutputSegment[];
  /** Settle the lane immediately on this result; process exit is not required. */
  readonly terminal?: 'completed' | 'interrupted' | 'failed';
}

/** One mapper per turn. The owner discards it on terminal or abort. */
export class CodexLaneEvents {
  private terminal = false;
  private sequence = -1;
  private readonly text = new Map<string, string>();
  private readonly reasoning = new Map<string, string>();
  private readonly tools = new Map<string, string>();
  private usage?: CodexReportedUsage;
  private errorEmitted = false;

  constructor(private readonly identity: CodexLaneTurnIdentity) {}

  map(event: CodexRuntimeEvent): CodexLaneEventOutput {
    if (
      this.terminal ||
      event.sequence <= this.sequence ||
      event.contextId !== this.identity.contextId ||
      event.processGeneration !== this.identity.processGeneration ||
      event.threadId !== this.identity.threadId ||
      event.turnId !== this.identity.turnId
    ) {
      return { segments: [] };
    }
    this.sequence = event.sequence;
    switch (event.type) {
      case 'textDelta':
        return this.content(
          this.text,
          event.itemId,
          event.delta,
          false,
          'text',
        );
      case 'textFinal':
        return this.content(this.text, event.itemId, event.text, true, 'text');
      case 'reasoning':
        return this.content(
          this.reasoning,
          event.itemId,
          event.text,
          event.phase === 'final',
          'thinking',
        );
      case 'toolStarted':
        this.tools.set(event.toolId, event.toolName);
        return {
          segments: [
            {
              type: 'tool-call',
              content: event.toolName,
              toolName: event.toolName,
              toolCallId: event.toolId,
              toolArgs: JSON.stringify(event.input),
              ...(event.input !== null &&
              typeof event.input === 'object' &&
              !Array.isArray(event.input)
                ? { toolInput: { ...event.input } }
                : {}),
            },
          ],
        };
      case 'toolCompleted': {
        const toolName = this.tools.get(event.toolId);
        this.tools.delete(event.toolId);
        return {
          segments: [
            {
              type:
                event.status === 'completed'
                  ? 'tool-result'
                  : 'tool-result-error',
              content:
                typeof event.output === 'string'
                  ? event.output
                  : JSON.stringify(event.output),
              toolCallId: event.toolId,
              ...(toolName === undefined ? {} : { toolName }),
            },
          ],
        };
      }
      case 'file':
        return {
          segments: [
            {
              type: 'file-change',
              content: event.path,
              changeKind: {
                add: 'added',
                update: 'modified',
                delete: 'deleted',
              }[event.operation],
            },
          ],
        };
      case 'image':
        return {
          segments: [
            {
              type: 'info',
              content:
                'Codex produced an image (lane output does not render images).',
            },
          ],
        };
      case 'compaction':
        return {
          segments: [
            { type: 'info', content: `Codex compaction ${event.phase}.` },
          ],
        };
      case 'approvalRequested':
        return {
          segments: [
            { type: 'info', content: 'Codex is waiting for approval.' },
          ],
        };
      case 'approvalSettled':
        return {
          segments: [
            { type: 'info', content: `Codex approval: ${event.decision}.` },
          ],
        };
      case 'usage':
        // Core reports turn snapshots. CLI totals add segments, so emit only once,
        // on terminal, instead of counting every snapshot (and terminal) again.
        this.usage = event.usage;
        return { segments: [] };
      case 'error':
        return { segments: this.error() };
      case 'terminal': {
        this.terminal = true;
        const usage = event.usage ?? this.usage;
        const segments: CliOutputSegment[] =
          event.error || event.status === 'failed' ? this.error() : [];
        if (usage !== undefined)
          segments.push({
            type: 'info',
            content: 'Codex turn usage.',
            usage: laneUsage(usage),
          });
        this.text.clear();
        this.reasoning.clear();
        this.tools.clear();
        this.usage = undefined;
        return { segments, terminal: event.status };
      }
    }
  }

  private error(): CliOutputSegment[] {
    if (this.errorEmitted) return [];
    this.errorEmitted = true;
    // No vendor payload, error code, credentials or subprocess output crosses here.
    return [{ type: 'error', content: 'Codex reported a runtime error.' }];
  }

  private content(
    store: Map<string, string>,
    id: string,
    value: string,
    final: boolean,
    type: 'text' | 'thinking',
  ): CodexLaneEventOutput {
    const previous = store.get(id) ?? '';
    const content =
      final && value.startsWith(previous)
        ? value.slice(previous.length)
        : value;
    store.set(id, final ? value : previous + value);
    return { segments: content === '' ? [] : [{ type, content }] };
  }
}

function laneUsage(
  usage: CodexReportedUsage,
): NonNullable<CliOutputSegment['usage']> {
  return {
    ...(usage.inputTokens === undefined
      ? {}
      : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined
      ? {}
      : { outputTokens: usage.outputTokens }),
    ...(usage.cachedInputTokens === undefined
      ? {}
      : { cacheReadTokens: usage.cachedInputTokens }),
    ...(usage.totalTokens === undefined
      ? {}
      : { totalTokens: usage.totalTokens }),
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
  };
}
