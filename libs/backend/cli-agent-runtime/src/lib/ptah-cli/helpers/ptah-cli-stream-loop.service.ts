/**
 * Ptah CLI Stream Loop - Per-stream message processing
 *
 * **Not injectable** — instantiated per spawnAgent() call because it holds
 * mutable per-stream state (streaming flags, pending tool args, session ID).
 * Follows the same plain-class pattern as SdkStreamProcessor.
 *
 */

import type {
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { SessionId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SdkMessageTransformer,
  isStreamEvent,
  isAssistantMessage,
  isResultMessage,
  isSuccessResult,
  isErrorResult,
  isSystemInit,
  isCompactBoundary,
  isUserMessage,
  isReplayMessage,
  isToolProgress,
  isToolUseSummary,
  isContentBlockStart,
  isContentBlockDelta,
  isTextBlock,
  isToolUseBlock,
  isThinkingBlock,
  isTextDelta,
  isInputJsonDelta,
  isThinkingDelta,
  type SDKMessage,
} from '@ptah-extension/agent-sdk';
import {
  summarizeToolInput,
  sanitizeErrorMessage,
} from './ptah-cli-registry.utils';

/**
 * Label shown for a peer that sent no usable name of its own.
 *
 * `unverified peer` and not `another session`: the word carries the warning
 * into the tile, where the only reader who can act on it is.
 */
const UNNAMED_PEER_LABEL = 'unverified peer';

/** How much of a sender-authored name is shown. A tile is narrow. */
const MAX_PEER_NAME_LENGTH = 48;

/**
 * A turn another session injected into this lane, as the CLI echoes it back.
 *
 * It arrives as a user message carrying `isReplay` AND `isSynthetic`, so
 * `isUserMessage` (which excludes replays by design) does not match it and the
 * `isSynthetic` drop inside the transformer would take it. The provenance stamp
 * is therefore the discriminator — but ONLY after the message's own shape has
 * been checked. `origin` is permitted on a result message too, and a result
 * that took this branch would skip the usage, error and `onTurnComplete`
 * handling below, leaving the turn's pending promise unresolved and the lane
 * busy forever. The caller admits a user-turn shape first; this helper answers
 * the narrower question of whether that turn came from a peer.
 *
 * The label is the sender's SELF-REPORTED name, never its address. Both are
 * sender-authored and forgeable by any process running as the same user, so
 * the name is rendered as a QUOTED value behind the word `unverified peer`:
 * `origin.name = 'Ptah system'` must not be able to read as Ptah speaking.
 * The name itself is flattened — quotes, newlines and control characters
 * removed, length capped — so it cannot forge the surrounding structure
 * either.
 */
function inboundPeerLabel(msg: SDKMessage): string | undefined {
  const origin = (msg as { origin?: { kind?: string; name?: string } }).origin;
  if (origin?.kind !== 'peer') {
    return undefined;
  }
  const name = flattenPeerName(origin.name);
  return name ? `${UNNAMED_PEER_LABEL} "${name}"` : UNNAMED_PEER_LABEL;
}

/**
 * Reduce a sender-authored name to one short, quote-free, single-line token,
 * or `undefined` when nothing usable survives.
 */
function flattenPeerName(name: string | undefined): string | undefined {
  if (typeof name !== 'string') {
    return undefined;
  }
  const flattened = name
    // Cc covers the ASCII controls. Cf is the one that matters for spoofing:
    // it holds the bidirectional overrides and isolates (U+202A-U+202E,
    // U+2066-U+2069), and an unterminated RLO reorders the closing quote, the
    // colon and the body, so sender-authored text can render AHEAD of the
    // `unverified peer` warning. Zl and Zp are the two non-ASCII line breaks.
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    // Every quote character, not only the ASCII ones. The name is rendered
    // inside a quoted slot, and a curly or angle quote reads as a close.
    .replace(/[\p{Pi}\p{Pf}"'`]/gu, '')
    // The label also reaches `emitOutput`, and the raw-stdout fallback path
    // renders that through markdown. `[Ptah Security](https://evil.test)` in a
    // sender-authored name becomes a live link attributed to Ptah. These are
    // the structural characters; a name legitimately needs none of them.
    .replace(/[[\]()*_~<>|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flattened.length === 0) {
    return undefined;
  }
  // Count and cut by CODE POINT: a cut between the halves of a surrogate pair
  // leaves a lone surrogate in the tile.
  const codePoints = Array.from(flattened);
  return codePoints.length > MAX_PEER_NAME_LENGTH
    ? `${codePoints.slice(0, MAX_PEER_NAME_LENGTH).join('')}…`
    : flattened;
}

/** The CLI's own envelope around a cross-session message. */
const PEER_ENVELOPE_OPEN = /^<cross-session-message\b[^>]*>\n?/;
const PEER_ENVELOPE_CLOSE = /\n?<\/cross-session-message>$/;

/**
 * The peer's own words, with the CLI's `<cross-session-message>` envelope
 * stripped.
 *
 * The envelope repeats the sender address the label already carries, and it is
 * markup the tile would render as text. Stripping happens ONLY when a matching
 * opening AND closing wrapper are both present: the two halves are independent
 * patterns, so stripping them independently would eat a legitimate body that
 * merely ends in the literal closing tag, and would empty a body consisting of
 * nothing else. Anything that is not a whole envelope is returned untouched —
 * the wrapper is the vendor's shape, and losing a real message because that
 * shape moved is worse than showing one extra line.
 */
function peerMessageBody(msg: SDKMessage): string {
  const content = (msg as { message?: { content?: unknown } }).message?.content;
  let raw = '';
  if (typeof content === 'string') {
    raw = content;
  } else if (Array.isArray(content)) {
    raw = content
      .filter(
        (block): block is { type: 'text'; text: string } =>
          (block as { type?: string })?.type === 'text',
      )
      .map((block) => block.text)
      .join('\n');
  }
  const trimmed = raw.trim();
  const opening = PEER_ENVELOPE_OPEN.exec(trimmed);
  if (!opening) {
    return trimmed;
  }
  const withoutOpening = trimmed.slice(opening[0].length);
  if (!PEER_ENVELOPE_CLOSE.test(withoutOpening)) {
    return trimmed;
  }
  return withoutOpening.replace(PEER_ENVELOPE_CLOSE, '').trim();
}

/**
 * Configuration for PtahCliStreamLoop.
 * Provides all callbacks and dependencies the loop needs.
 */
export interface PtahCliStreamLoopConfig {
  readonly logger: Logger;
  readonly messageTransformer: SdkMessageTransformer;
  readonly emitOutput: (data: string) => void;
  readonly emitSegment: (segment: CliOutputSegment) => void;
  readonly emitStreamEvent: (event: FlatStreamEventUnion) => void;
  readonly agentName: string;
  /** Called when the real SDK session ID is resolved from the system init message. */
  readonly onSessionResolved?: (sessionId: string) => void;
  readonly onTurnComplete?: (exitCode: number) => void;
}

/**
 * PtahCliStreamLoop - Consumes the SDK async iterable and dispatches
 * structured segments, raw text, and FlatStreamEventUnion events.
 *
 * One instance per spawnAgent() call — holds mutable streaming state.
 */
export class PtahCliStreamLoop {
  private receivedTextDeltas = false;
  private receivedThinkingDeltas = false;
  private turnIndex = 0;
  private turnEventCount = 0;
  private effectiveSessionId: SessionId | null = null;
  private readonly streamTransformer: SdkMessageTransformer;
  private readonly pendingToolArgs = new Map<
    number,
    { name: string; id: string; jsonFragments: string[] }
  >();
  /** Track messageIds already emitted via stream_event to avoid duplicate message_start from assistant */
  private readonly emittedMessageIds = new Set<string>();
  /** Track toolCallIds already emitted via stream_event to avoid duplicate tool_start from assistant */
  private readonly emittedToolCallIds = new Set<string>();

  constructor(private readonly config: PtahCliStreamLoopConfig) {
    this.streamTransformer = config.messageTransformer.createIsolated();
  }

  /**
   * Run the stream processing loop.
   *
   * @param sdkQuery - The async iterable from SDK queryFn()
   * @returns Exit code: 0 for success, 1 for error
   */
  async run(sdkQuery: AsyncIterable<SDKMessage>): Promise<number> {
    const { logger, emitOutput, emitSegment, emitStreamEvent } = this.config;

    try {
      try {
        for await (const msg of sdkQuery) {
          // SHAPE FIRST, origin second. `origin` is permitted on a result
          // message as well as a user turn, and a result that fell into the
          // peer branch would skip the usage, error and `onTurnComplete`
          // handling below — leaving the turn's pending promise unresolved and
          // the lane busy forever. This is the same admission
          // `SdkMessageTransformer`'s peer branch uses: a user turn OR its
          // replay, nothing else.
          const peerLabel =
            isUserMessage(msg) || isReplayMessage(msg)
              ? inboundPeerLabel(msg)
              : undefined;
          if (peerLabel) {
            // Surfaced BEFORE the transform branches and then `continue`d: this
            // is not a turn the lane took, so none of the assistant/tool state
            // below applies to it. Emitting it is the whole point — the message
            // reaches the model either way, and without this the lane's tile is
            // the only place an operator could have seen that it arrived.
            const body = peerMessageBody(msg);
            logger.info('[PtahCliStreamLoop] Inbound peer turn', {
              agentName: this.config.agentName,
              from: peerLabel,
              length: body.length,
            });
            emitOutput(`\n**Message from \`${peerLabel}\`:** ${body}\n`);
            emitSegment({
              type: 'info',
              content: `Message from ${peerLabel}: ${body}`,
            });
            continue;
          }
          if (isStreamEvent(msg) || isUserMessage(msg)) {
            try {
              const flatEvents = this.streamTransformer.transform(
                msg,
                this.effectiveSessionId || undefined,
              );
              for (const event of flatEvents) {
                if (event.eventType === 'message_start') {
                  this.emittedMessageIds.add(
                    (event as { messageId?: string }).messageId ?? '',
                  );
                } else if (event.eventType === 'tool_start') {
                  this.emittedToolCallIds.add(
                    (event as { toolCallId?: string }).toolCallId ?? '',
                  );
                }
                this.turnEventCount++;
                emitStreamEvent(event);
              }
            } catch (transformError) {
              logger.warn(
                '[PtahCliStreamLoop] Failed to transform SDK message to stream events',
                {
                  error:
                    transformError instanceof Error
                      ? transformError.message
                      : String(transformError),
                },
              );
            }
          } else if (isAssistantMessage(msg)) {
            try {
              const flatEvents = this.streamTransformer.transform(
                msg,
                this.effectiveSessionId || undefined,
              );
              for (const event of flatEvents) {
                switch (event.eventType) {
                  case 'message_start': {
                    const msgId =
                      (event as { messageId?: string }).messageId ?? '';
                    if (!this.emittedMessageIds.has(msgId)) {
                      this.emittedMessageIds.add(msgId);
                      emitStreamEvent(event);
                    }
                    break;
                  }
                  case 'tool_start': {
                    const tcId =
                      (event as { toolCallId?: string }).toolCallId ?? '';
                    if (!this.emittedToolCallIds.has(tcId)) {
                      this.emittedToolCallIds.add(tcId);
                      emitStreamEvent(event);
                    }
                    break;
                  }
                  case 'message_complete':
                  case 'agent_start':
                  case 'background_agent_started':
                    emitStreamEvent(event);
                    break;
                  default:
                    break;
                }
              }
            } catch (transformError) {
              logger.warn(
                '[PtahCliStreamLoop] Failed to transform assistant message for agent events',
                {
                  error:
                    transformError instanceof Error
                      ? transformError.message
                      : String(transformError),
                },
              );
            }
          }
          if (isSystemInit(msg)) {
            if (msg.session_id) {
              this.effectiveSessionId = SessionId.from(msg.session_id);
            }
            const model = msg.model ?? 'unknown';
            emitOutput(`[PtahCli] Session started (model: ${model})\n`);
            emitSegment({
              type: 'info',
              content: `Session started: ${msg.session_id} (model: ${model})`,
            });
            if (this.effectiveSessionId && this.config.onSessionResolved) {
              this.config.onSessionResolved(this.effectiveSessionId);
            }
            continue;
          }
          if (isCompactBoundary(msg)) {
            const tokens = msg.compact_metadata?.pre_tokens;
            const content = tokens
              ? `Context compaction (${tokens} tokens before)`
              : 'Context compaction';
            emitOutput(`\n[${content}]\n`);
            emitSegment({ type: 'info', content });
            continue;
          }
          if (isStreamEvent(msg)) {
            const event = msg.event;
            if (isContentBlockStart(event)) {
              const block = event.content_block;
              if (isToolUseBlock(block)) {
                const argsStr = summarizeToolInput(block.input);
                this.pendingToolArgs.set(event.index, {
                  name: block.name,
                  id: block.id,
                  jsonFragments: [],
                });
                emitOutput(
                  `\n**Tool:** \`${block.name}\`${argsStr ? ` ${argsStr}` : ''}\n`,
                );
                emitSegment({
                  type: 'tool-call',
                  content: '',
                  toolName: block.name,
                  toolArgs: argsStr,
                });
              }
              continue;
            }
            if (isContentBlockDelta(event)) {
              const delta = event.delta;

              if (isTextDelta(delta)) {
                this.receivedTextDeltas = true;
                emitOutput(delta.text);
                emitSegment({ type: 'text', content: delta.text });
              } else if (isThinkingDelta(delta)) {
                this.receivedThinkingDeltas = true;
                emitSegment({ type: 'thinking', content: delta.thinking });
              } else if (isInputJsonDelta(delta)) {
                const pending = this.pendingToolArgs.get(event.index);
                if (pending) {
                  pending.jsonFragments.push(delta.partial_json);
                }
              }
              continue;
            }
            continue;
          }
          if (isAssistantMessage(msg)) {
            const blocks = msg.message?.content;
            if (Array.isArray(blocks)) {
              for (const block of blocks) {
                if (isTextBlock(block)) {
                  if (!this.receivedTextDeltas) {
                    emitOutput(block.text);
                    emitSegment({ type: 'text', content: block.text });
                  }
                } else if (isToolUseBlock(block)) {
                  if (!this.receivedTextDeltas) {
                    const argsStr = summarizeToolInput(block.input);
                    emitOutput(
                      `\n**Tool:** \`${block.name}\`${
                        argsStr ? ` ${argsStr}` : ''
                      }\n`,
                    );
                    emitSegment({
                      type: 'tool-call',
                      content: '',
                      toolName: block.name,
                      toolArgs: argsStr,
                    });
                  }
                } else if (isThinkingBlock(block)) {
                  if (!this.receivedThinkingDeltas) {
                    emitSegment({
                      type: 'thinking',
                      content: block.thinking,
                    });
                  }
                }
              }
            }
            this.receivedTextDeltas = false;
            this.receivedThinkingDeltas = false;
            this.pendingToolArgs.clear();
            continue;
          }
          if (isUserMessage(msg)) {
            const content = msg.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result') {
                  const resultText =
                    typeof block.content === 'string'
                      ? block.content
                      : Array.isArray(block.content)
                        ? block.content
                            .filter(
                              (b): b is { type: 'text'; text: string } =>
                                b.type === 'text',
                            )
                            .map((b) => b.text)
                            .join('\n')
                        : '';
                  const truncated =
                    resultText.length > 2000
                      ? resultText.substring(0, 2000) + '\n... [truncated]'
                      : resultText;

                  if (block.is_error) {
                    emitOutput(`\n**Tool Error:** ${truncated}\n`);
                    emitSegment({
                      type: 'tool-result-error',
                      content: truncated,
                    });
                  } else {
                    emitOutput(
                      `\n<details><summary>Tool result</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n</details>\n\n`,
                    );
                    emitSegment({
                      type: 'tool-result',
                      content: truncated,
                    });
                  }
                }
              }
            }
            continue;
          }
          if (isResultMessage(msg)) {
            let turnExitCode = 0;
            if (isSuccessResult(msg)) {
              const parts: string[] = [];
              if (msg.usage) {
                parts.push(`${msg.usage.input_tokens} input`);
                parts.push(`${msg.usage.output_tokens} output`);
              }
              if (msg.total_cost_usd !== undefined) {
                parts.push(`$${msg.total_cost_usd.toFixed(4)}`);
              }
              if (msg.duration_ms !== undefined) {
                parts.push(`${(msg.duration_ms / 1000).toFixed(1)}s`);
              }
              parts.push(`${msg.num_turns} turns`);
              const usageStr = `Completed: ${parts.join(', ')}`;
              emitOutput(`\n[${usageStr}]\n`);
              emitSegment({ type: 'info', content: usageStr });
            } else if (isErrorResult(msg)) {
              turnExitCode = 1;
              const errorMsg =
                msg.errors?.join('; ') ?? `Error: ${msg.subtype}`;
              emitOutput(`\n[Error: ${errorMsg}]\n`);
              emitSegment({ type: 'error', content: errorMsg });
            }
            logger.info(`[PtahCliStreamLoop] turn ${this.turnIndex} complete`, {
              exitCode: turnExitCode,
              streamEvents: this.turnEventCount,
            });
            this.turnIndex++;
            this.turnEventCount = 0;
            this.config.onTurnComplete?.(turnExitCode);
            continue;
          }
          if (isToolProgress(msg)) {
            emitSegment({
              type: 'info',
              content: `${
                msg.tool_name
              } running (${msg.elapsed_time_seconds.toFixed(0)}s)`,
            });
            continue;
          }
          if (isToolUseSummary(msg)) {
            emitOutput(`\n${msg.summary}\n`);
            emitSegment({ type: 'info', content: msg.summary });
            continue;
          }
        }
        return 0;
      } catch (error) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        const isAbort =
          rawMessage.includes('abort') || rawMessage.includes('cancel');
        if (!isAbort) {
          logger.error(
            `[PtahCliStreamLoop] spawnAgent query error: ${rawMessage}`,
          );
          const sanitized = sanitizeErrorMessage(rawMessage);
          emitOutput(`\n[Error: ${sanitized}]\n`);
          emitSegment({ type: 'error', content: sanitized });
        }
        return 1;
      }
    } finally {
      this.pendingToolArgs.clear();
      this.emittedMessageIds.clear();
      this.emittedToolCallIds.clear();
    }
  }
}
