import type {
  ExecutionChatMessage,
  MessageTokenUsage,
} from '@ptah-extension/shared';
import { isValidTokenCount, messageTokenTotal } from '@ptah-extension/shared';
import { formatAgentDuration } from '@ptah-extension/chat-ui';
import { extractMessageSummary } from './message-summary.utils';
import { rootHasActivity } from './turn-answer-split.utils';

/**
 * Opening words of the user message the Claude SDK injects after `/compact`
 * ("This session is being continued from a previous conversation …").
 */
export const COMPACTION_CONTINUATION_PREFIX =
  'This session is being continued from a previous conversation';

/** True for the SDK's compaction-continuation user message. */
export function isCompactionContinuationMessage(
  message: ExecutionChatMessage,
): boolean {
  if (message.role !== 'user') return false;
  return (message.rawContent ?? '')
    .trimStart()
    .startsWith(COMPACTION_CONTINUATION_PREFIX);
}

/** Per assistant message facts the turn rows and the activity panel read. */
export interface TurnMessageMetrics {
  readonly id: string;
  /** Message start (Unix epoch ms), `null` when not finite. */
  readonly timestamp: number | null;
  /** Message duration in ms; absent when not finite. */
  readonly duration?: number;
  readonly tokens?: MessageTokenUsage;
  /** USD; `null` when the provider has no pricing, absent when unknown. */
  readonly cost?: number | null;
  readonly toolCount: number;
  readonly filesChanged: number;
}

/**
 * One assistant message's place in its turn. A turn is the user message(s)
 * that open it plus every assistant message up to the next user message
 * (design-spec §3.9).
 */
export interface TurnContext {
  /**
   * Id of the turn's opening user message, or of its first assistant message
   * when the loaded transcript starts mid-turn.
   */
  readonly turnId: string;
  /** `S`: first finite, non-continuation user timestamp; else `null`. */
  readonly startTs: number | null;
  /** Assistant message ids of the turn, in transcript order. */
  readonly assistantIds: readonly string[];
  /** 0-based position of this message among the turn's assistant messages. */
  readonly index: number;
  /** Number of assistant messages in the turn. */
  readonly count: number;
  readonly isFirstAssistant: boolean;
  readonly isLastAssistant: boolean;
  /** Any assistant message of the turn has a non-text top-level child. */
  readonly hasActivity: boolean;
  /** Metrics of the turn's assistant messages, in transcript order. */
  readonly messages: readonly TurnMessageMetrics[];
  /**
   * `E`: `max(timestamp + duration)` over the turn's assistant messages that
   * have both finite; `null` when none do (decision D-A1-2).
   */
  readonly settledEndTs: number | null;
}

/** A turn's disclosure label (design-spec §3.2, §3.9). */
export interface TurnElapsedLabel {
  /** `Working · 1m 05s`, `Working`, `Worked for 4m 12s` or `Worked`. */
  readonly text: string;
  /** True while the turn is live (pulse dot, ticking timer). */
  readonly live: boolean;
}

/** Sum of one metric over the messages that know it. */
export interface TurnMetricTotal {
  readonly value: number;
  /** Messages that contributed a known value. */
  readonly knownCount: number;
}

export interface TurnTokenTotal {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  /** Messages that contributed known token usage. */
  readonly knownCount: number;
}

/** Turn aggregate for the activity panel summary (design-spec §3.11). */
export interface TurnMetricsSummary {
  /** `N`: assistant messages in the turn. */
  readonly messageCount: number;
  /** `null` when no message knows its token usage. */
  readonly tokens: TurnTokenTotal | null;
  /** `null` when no message has a finite cost. */
  readonly cost: TurnMetricTotal | null;
  readonly toolCount: TurnMetricTotal;
  readonly filesChanged: TurnMetricTotal;
}

interface TurnDraft {
  readonly turnId: string;
  startTs: number | null;
  readonly assistants: ExecutionChatMessage[];
}

/**
 * Metrics per message object. Messages are immutable, so an unchanged
 * message keeps its metrics (and its tree is not walked again) when the
 * transcript list is rebuilt.
 */
const metricsCache = new WeakMap<ExecutionChatMessage, TurnMessageMetrics>();

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricsOf(message: ExecutionChatMessage): TurnMessageMetrics {
  const cached = metricsCache.get(message);
  if (cached) return cached;

  const summary = extractMessageSummary(message.streamingState);
  const duration = finiteOrNull(message.duration);
  const metrics: TurnMessageMetrics = {
    id: message.id,
    timestamp: finiteOrNull(message.timestamp),
    ...(duration !== null ? { duration } : {}),
    ...(message.tokens ? { tokens: message.tokens } : {}),
    ...(message.cost !== undefined ? { cost: message.cost } : {}),
    toolCount: summary.toolCount,
    filesChanged: summary.filesChanged,
  };
  metricsCache.set(message, metrics);
  return metrics;
}

function settledEndOf(messages: readonly TurnMessageMetrics[]): number | null {
  let end: number | null = null;
  for (const m of messages) {
    if (m.timestamp === null || m.duration === undefined) continue;
    const candidate = m.timestamp + m.duration;
    if (end === null || candidate > end) end = candidate;
  }
  return end;
}

/** Group the transcript into turns, in one pass. */
function draftTurns(messages: readonly ExecutionChatMessage[]): TurnDraft[] {
  const turns: TurnDraft[] = [];
  let current: TurnDraft | null = null;

  for (const message of messages) {
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      // Consecutive user messages open one turn; a user message after an
      // assistant message opens the next one.
      if (!current || current.assistants.length > 0) {
        current = { turnId: message.id, startTs: null, assistants: [] };
        turns.push(current);
      }
      // A compaction continuation never sets `S` (B-18); an inbound peer
      // message does (it starts work).
      if (
        current.startTs === null &&
        !isCompactionContinuationMessage(message)
      ) {
        current.startTs = finiteOrNull(message.timestamp);
      }
      continue;
    }

    if (!current) {
      current = { turnId: message.id, startTs: null, assistants: [] };
      turns.push(current);
    }
    current.assistants.push(message);
  }

  return turns;
}

/**
 * Turn facts for every assistant message, keyed by assistant message id.
 * User and system messages have no entry. Pure.
 */
export function buildTurnContexts(
  messages: readonly ExecutionChatMessage[],
): ReadonlyMap<string, TurnContext> {
  const contexts = new Map<string, TurnContext>();

  for (const turn of draftTurns(messages)) {
    const count = turn.assistants.length;
    if (count === 0) continue;

    const metrics = turn.assistants.map(metricsOf);
    const assistantIds = turn.assistants.map((m) => m.id);
    const hasActivity = turn.assistants.some((m) =>
      rootHasActivity(m.streamingState),
    );
    const settledEndTs = settledEndOf(metrics);

    turn.assistants.forEach((message, index) => {
      contexts.set(message.id, {
        turnId: turn.turnId,
        startTs: turn.startTs,
        assistantIds,
        index,
        count,
        isFirstAssistant: index === 0,
        isLastAssistant: index === count - 1,
        hasActivity,
        messages: metrics,
        settledEndTs,
      });
    });
  }

  return contexts;
}

/**
 * The disclosure label (design-spec §3.9). Live: `Working · {now - S}`, or
 * `Working` without a finite `S`. Settled: `Worked for {E - S}` when both are
 * known and at least one second apart, else `Worked`. Never `0s`: the shared
 * `formatAgentDuration` returns `null` under one second.
 */
export function turnElapsedLabel(
  ctx: TurnContext,
  live: boolean,
  now: number,
): TurnElapsedLabel {
  const { startTs, settledEndTs } = ctx;

  if (live) {
    const elapsed =
      startTs === null ? null : formatAgentDuration(now - startTs);
    return { text: elapsed ? `Working · ${elapsed}` : 'Working', live: true };
  }

  const worked =
    startTs === null || settledEndTs === null
      ? null
      : formatAgentDuration(settledEndTs - startTs);
  return { text: worked ? `Worked for ${worked}` : 'Worked', live: false };
}

/**
 * Sums of the known values over the turn's assistant messages, each with the
 * number of messages it covers (for `Tokens · 2 of 3 messages`, §3.11).
 */
export function summarizeTurnMetrics(ctx: TurnContext): TurnMetricsSummary {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let tokenCount = 0;
  let cost = 0;
  let costCount = 0;
  let tools = 0;
  let files = 0;

  for (const m of ctx.messages) {
    if (messageTokenTotal(m.tokens) !== null && m.tokens) {
      input += m.tokens.input;
      output += m.tokens.output;
      cacheRead += m.tokens.cacheRead ?? 0;
      cacheCreation += m.tokens.cacheCreation ?? 0;
      tokenCount++;
    }
    if (typeof m.cost === 'number' && Number.isFinite(m.cost)) {
      cost += m.cost;
      costCount++;
    }
    tools += m.toolCount;
    files += m.filesChanged;
  }

  const messageCount = ctx.messages.length;
  return {
    messageCount,
    tokens:
      tokenCount > 0 &&
      isValidTokenCount(messageTokenTotal({ input, output, cacheRead, cacheCreation }))
        ? { input, output, cacheRead, cacheCreation, knownCount: tokenCount }
        : null,
    cost: costCount > 0 ? { value: cost, knownCount: costCount } : null,
    toolCount: { value: tools, knownCount: messageCount },
    filesChanged: { value: files, knownCount: messageCount },
  };
}
