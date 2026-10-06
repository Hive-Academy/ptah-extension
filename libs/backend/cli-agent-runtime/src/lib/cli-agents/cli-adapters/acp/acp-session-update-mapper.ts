import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { CliOutputSegment } from '@ptah-extension/shared';

const MAX_TOOL_OUTPUT_CHARS = 64 * 1024;
const TRUNCATION_MARKER = '\n… [output truncated]';

interface ToolCallDetails {
  readonly kind?: string;
  readonly title?: string;
}

export interface AcpSessionUpdateMapper {
  map(update: SessionUpdate): { output: string; segments: CliOutputSegment[] };
}

export interface AcpSessionUpdateMapperOptions {
  readonly extractExitCode?: (rawOutput: unknown) => number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function capOutput(content: string): string {
  if (content.length <= MAX_TOOL_OUTPUT_CHARS) return content;
  return (
    content.slice(0, MAX_TOOL_OUTPUT_CHARS - TRUNCATION_MARKER.length) +
    TRUNCATION_MARKER
  );
}

function textFromContent(content: unknown): string | undefined {
  if (!isRecord(content)) return undefined;
  const block = content.type === 'content' ? content.content : content;
  if (
    !isRecord(block) ||
    block.type !== 'text' ||
    typeof block.text !== 'string'
  ) {
    return undefined;
  }
  return block.text;
}

function diffSegments(content: unknown): CliOutputSegment[] {
  if (!Array.isArray(content)) return [];

  return content.flatMap((item): CliOutputSegment[] => {
    if (
      !isRecord(item) ||
      item.type !== 'diff' ||
      typeof item.path !== 'string'
    ) {
      return [];
    }
    return [
      {
        type: 'file-change',
        content: item.path,
        changeKind:
          item.oldText === undefined || item.oldText === null
            ? 'added'
            : 'modified',
      },
    ];
  });
}

function outputFromToolUpdate(update: Record<string, unknown>): string {
  const content = Array.isArray(update.content)
    ? update.content
        .map(textFromContent)
        .filter((text): text is string => text !== undefined)
        .join('')
    : '';
  return capOutput(content || safeStringify(update.rawOutput));
}

function errorSegment(content: string): CliOutputSegment {
  return { type: 'error', content };
}

/**
 * Maps ACP session updates to Ptah's portable CLI output protocol.
 *
 * ACP agents are external processes, so this deliberately treats runtime
 * notifications as untrusted even though the public signature is typed.
 */
export function createAcpSessionUpdateMapper(
  options: AcpSessionUpdateMapperOptions = {},
): AcpSessionUpdateMapper {
  const tools = new Map<string, ToolCallDetails>();

  return {
    map(update: SessionUpdate): {
      output: string;
      segments: CliOutputSegment[];
    } {
      try {
        if (!isRecord(update) || typeof update.sessionUpdate !== 'string') {
          return { output: '', segments: [] };
        }

        switch (update.sessionUpdate) {
          case 'agent_message_chunk': {
            const content: unknown = update.content;
            if (!isRecord(content)) return { output: '', segments: [] };
            if (content.type === 'text' && typeof content.text === 'string') {
              return {
                output: content.text,
                segments: [{ type: 'text', content: content.text }],
              };
            }
            return {
              output: '',
              segments: [
                {
                  type: 'info',
                  content: `[${String(content.type ?? 'unknown')} content]`,
                },
              ],
            };
          }

          case 'agent_thought_chunk': {
            const content: unknown = update.content;
            return isRecord(content) && typeof content.text === 'string'
              ? {
                  output: '',
                  segments: [{ type: 'thinking', content: content.text }],
                }
              : { output: '', segments: [] };
          }

          case 'tool_call': {
            if (
              typeof update.toolCallId !== 'string' ||
              typeof update.title !== 'string'
            ) {
              return { output: '', segments: diffSegments(update.content) };
            }
            const kind =
              typeof update.kind === 'string' ? update.kind : undefined;
            tools.set(update.toolCallId, { kind, title: update.title });
            const toolInput = isPlainObject(update.rawInput)
              ? update.rawInput
              : undefined;
            return {
              output: '',
              segments: [
                {
                  type: 'tool-call',
                  content: '',
                  toolCallId: update.toolCallId,
                  toolName:
                    kind === 'edit' || kind === 'delete' ? kind : update.title,
                  toolArgs:
                    toolInput === undefined
                      ? undefined
                      : safeStringify(toolInput),
                  toolInput,
                },
                ...diffSegments(update.content),
              ],
            };
          }

          case 'tool_call_update': {
            const diffs = diffSegments(update.content);
            if (typeof update.toolCallId !== 'string') {
              return { output: '', segments: diffs };
            }
            const remembered = tools.get(update.toolCallId);
            const kind =
              typeof update.kind === 'string' ? update.kind : remembered?.kind;
            const title =
              typeof update.title === 'string'
                ? update.title
                : remembered?.title;
            if (update.status === 'completed' || update.status === 'failed') {
              const isCommand =
                update.status === 'completed' && kind === 'execute';
              const exitCode = isCommand
                ? options.extractExitCode?.(update.rawOutput)
                : undefined;
              return {
                output: '',
                segments: [
                  {
                    type: isCommand
                      ? 'command'
                      : update.status === 'failed'
                        ? 'tool-result-error'
                        : 'tool-result',
                    content: outputFromToolUpdate(update),
                    toolCallId: update.toolCallId,
                    toolName: isCommand ? (title ?? 'command') : title,
                    exitCode,
                  },
                  ...diffs,
                ],
              };
            }
            return { output: '', segments: diffs };
          }

          case 'plan':
            return Array.isArray(update.entries)
              ? {
                  output: '',
                  segments: [
                    {
                      type: 'info',
                      content: update.entries
                        .filter(isRecord)
                        .map((entry) => {
                          const status =
                            typeof entry.status === 'string'
                              ? entry.status
                              : 'pending';
                          const content =
                            typeof entry.content === 'string'
                              ? entry.content
                              : '';
                          return `[${status}] ${content}`;
                        })
                        .join('\n'),
                    },
                  ],
                }
              : { output: '', segments: [] };

          default:
            return { output: '', segments: [] };
        }
      } catch {
        return { output: '', segments: [] };
      }
    },
  };
}

/** Map a completed ACP prompt's reason to Ptah's lane exit convention. */
export function mapStopReason(input: {
  stopReason: string;
  aborted: boolean;
  refusedPermissionTitle?: string;
  displayName: string;
}): { exitCode: 0 | 1; segment?: CliOutputSegment } {
  try {
    const displayName =
      typeof input?.displayName === 'string' && input.displayName
        ? input.displayName
        : 'Agent';
    const stopReason =
      typeof input?.stopReason === 'string' ? input.stopReason : 'unknown';

    switch (stopReason) {
      case 'end_turn':
        return { exitCode: 0 };
      case 'max_tokens':
        return {
          exitCode: 0,
          segment: { type: 'info', content: 'Token limit reached.' },
        };
      case 'max_turn_requests':
        return {
          exitCode: 0,
          segment: { type: 'info', content: 'Turn request limit reached.' },
        };
      case 'refusal':
        return {
          exitCode: 1,
          segment: errorSegment(`${displayName} refused the turn.`),
        };
      case 'cancelled':
        if (input?.aborted) return { exitCode: 1 };
        if (
          typeof input?.refusedPermissionTitle === 'string' &&
          input.refusedPermissionTitle
        ) {
          return {
            exitCode: 1,
            segment: errorSegment(
              `${displayName} stopped the turn: permission refused for ${input.refusedPermissionTitle}`,
            ),
          };
        }
        return {
          exitCode: 1,
          segment: errorSegment('turn cancelled by the agent'),
        };
      default:
        return {
          exitCode: 1,
          segment: errorSegment(
            `${displayName} stopped for unknown reason: ${stopReason}`,
          ),
        };
    }
  } catch {
    return {
      exitCode: 1,
      segment: errorSegment('Agent stopped for unknown reason.'),
    };
  }
}
