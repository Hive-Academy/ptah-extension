import {
  presentCodexTool,
  presentCodexToolResult,
  type CodexReportedUsage,
  type CodexRuntimeEvent,
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
  /** toolId -> raw Codex tool name and the name its tool-call row showed. */
  private readonly tools = new Map<
    string,
    { readonly raw: string; readonly presented: string }
  >();
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
      case 'userInputAsync':
        return this.content(this.text, event.itemId, event.text, true, 'text');
      case 'reasoning':
        return this.content(
          this.reasoning,
          event.itemId,
          event.text,
          event.phase === 'final',
          'thinking',
        );
      case 'toolStarted': {
        const input =
          event.input !== null &&
          typeof event.input === 'object' &&
          !Array.isArray(event.input)
            ? { ...event.input }
            : undefined;
        const presented = presentCodexTool(event.toolName, input);
        // The result row must carry the presented name from the call row;
        // completions do not carry the original file-change input.
        this.tools.set(event.toolId, {
          raw: event.toolName,
          presented: presented.toolName,
        });
        return {
          segments: [
            {
              type: 'tool-call',
              content: presented.toolName,
              toolName: presented.toolName,
              toolCallId: event.toolId,
              // The raw native input (e.g. the wrapped command); the renderer
              // uses toolArgs only when toolInput is absent.
              toolArgs: JSON.stringify(event.input),
              ...(presented.toolInput === undefined
                ? {}
                : { toolInput: presented.toolInput }),
            },
          ],
        };
      }
      case 'toolCompleted': {
        const tool = this.tools.get(event.toolId);
        this.tools.delete(event.toolId);
        const result = presentCodexToolResult({
          toolName: tool?.raw,
          status: event.status,
          output: event.output,
          exitCode: event.exitCode,
          errorText: event.errorText,
        });
        const presentedName = tool?.presented;
        return {
          segments: [
            {
              type:
                event.status === 'cancelled'
                  ? 'tool-result'
                  : result.isError
                    ? 'tool-result-error'
                    : 'tool-result',
              content:
                result.output == null
                  ? event.status === 'failed'
                    ? 'Tool call failed'
                    : ''
                  : typeof result.output === 'string'
                    ? result.output
                    : JSON.stringify(result.output),
              toolCallId: event.toolId,
              ...(presentedName === undefined
                ? {}
                : { toolName: presentedName }),
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
              toolCallId: event.itemId,
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
    return {
      segments: content === '' ? [] : [{ type, content, messageId: id }],
    };
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
    ...(usage.cacheWriteInputTokens === undefined
      ? {}
      : { cacheWriteTokens: usage.cacheWriteInputTokens }),
    ...(usage.totalTokens === undefined
      ? {}
      : { totalTokens: usage.totalTokens }),
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
  };
}
