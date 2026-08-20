import { inject, injectable } from 'tsyringe';
import { SDK_TOKENS, type JsonlReaderService } from '@ptah-extension/agent-sdk';
import { findModelPricing, calculateMessageCost } from '@ptah-extension/shared';
import type { SubagentRunMetrics } from './types';

/**
 * Element type of the JSONL reader's parsed output. Derived from the reader's
 * return type because `TranscriptMessage` is not re-exported from the
 * agent-sdk barrel (the trajectory extractor relies on the same inference).
 */
type TranscriptMessage = Awaited<
  ReturnType<JsonlReaderService['readJsonlMessages']>
>[number];

/**
 * Result of parsing a subagent transcript at SubagentStop.
 *
 * `metrics` mirrors the display-only `AgentCostBreakdown` semantics but is
 * persisted per invocation. Every metric field is independently nullable:
 * providers that report no `usage` (Copilot/Codex/ollama) yield null token
 * and cost fields, which the scorecard aggregates exclude from AVG/SUM rather
 * than counting as zero. `taskId` is the exact spec attribution derived from
 * the subagent's first user prompt, or null when no task context is present.
 */
export interface ExtractedSubagentRun {
  readonly metrics: SubagentRunMetrics;
  readonly taskId: string | null;
}

/** Immutable all-null metrics — the failure / no-usage baseline. */
const NULL_METRICS: SubagentRunMetrics = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  costUsd: null,
  durationMs: null,
  toolCount: null,
};

/**
 * Specs-path-anchored task id: matches `.ptah/specs/TASK_YYYY_NNN`,
 * `/ptah/specs/TASK_...`, or `ptah\specs\TASK_...` (Windows). Immune to
 * incidental task-id mentions elsewhere in the prompt (e.g. `depends_on`).
 */
const SPECS_PATH_TASK_ID = /[\\/.]?ptah[\\/]specs[\\/](TASK_\d{4}_\d{3})\b/i;
/** Bare task-id token, used only when the specs-path anchor is absent. */
const BARE_TASK_ID = /\bTASK_\d{4}_\d{3}\b/gi;

/**
 * Derive the exact task id a subagent was working on from its first user
 * prompt. Deterministic three-step rule (D3):
 *
 *  1. First specs-path-anchored `.../ptah/specs/TASK_X` match wins.
 *  2. Else, if exactly ONE distinct `TASK_YYYY_NNN` token appears, use it.
 *  3. Else null (ambiguous or absent → window fallback handles it later).
 *
 * Pure and side-effect free (exported for unit tests).
 */
export function extractTaskIdFromPrompt(text: string): string | null {
  if (!text) return null;

  const anchored = SPECS_PATH_TASK_ID.exec(text);
  if (anchored) {
    return anchored[1].toUpperCase();
  }

  const matches = text.match(BARE_TASK_ID);
  if (!matches || matches.length === 0) return null;
  const distinct = new Set(matches.map((m) => m.toUpperCase()));
  if (distinct.size === 1) {
    return distinct.values().next().value ?? null;
  }
  return null;
}

/**
 * Reads a subagent transcript JSONL and derives per-invocation metrics plus
 * exact task attribution. Delegates all file I/O to the shared
 * {@link JsonlReaderService} (owns the 50MB `SdkError` guard) so no new
 * `node:fs` call site is introduced here.
 *
 * `extract` throws only on unrecoverable I/O (missing file, oversized
 * transcript). The caller (SkillTriggerService.onSubagentStop) catches and
 * falls back to all-null metrics so invocation counting never breaks.
 */
@injectable()
export class SubagentMetricsExtractor {
  constructor(
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly jsonl: JsonlReaderService,
  ) {}

  async extract(transcriptPath: string): Promise<ExtractedSubagentRun> {
    const messages = await this.jsonl.readJsonlMessages(transcriptPath);
    return {
      metrics: this.computeMetrics(messages),
      taskId: this.deriveTaskId(messages),
    };
  }

  private computeMetrics(
    messages: readonly TranscriptMessage[],
  ): SubagentRunMetrics {
    let hasUsage = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    let hasCost = false;
    let costUsd = 0;

    let toolCount = 0;

    for (const msg of messages) {
      if (msg.message?.role !== 'assistant') continue;

      const usage = msg.message.usage;
      if (usage) {
        hasUsage = true;
        const input = usage.input_tokens ?? 0;
        const output = usage.output_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheCreation = usage.cache_creation_input_tokens ?? 0;
        inputTokens += input;
        outputTokens += output;
        cacheReadTokens += cacheRead;
        cacheCreationTokens += cacheCreation;

        const model = msg.message.model ?? msg.model ?? '';
        const pricing = model ? findModelPricing(model) : null;
        if (pricing) {
          const cost = calculateMessageCost(
            model,
            {
              input,
              output,
              cacheHit: cacheRead,
              cacheCreation,
            },
            pricing,
          );
          if (cost !== null) {
            hasCost = true;
            costUsd += cost;
          }
        }
      }

      toolCount += this.countToolUseBlocks(msg);
    }

    if (!hasUsage) {
      return NULL_METRICS;
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd: hasCost ? Math.round(costUsd * 1_000_000) / 1_000_000 : null,
      durationMs: this.computeDurationMs(messages),
      toolCount,
    };
  }

  private countToolUseBlocks(msg: TranscriptMessage): number {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return 0;
    let count = 0;
    for (const block of content) {
      if (block && typeof block === 'object' && block.type === 'tool_use') {
        count++;
      }
    }
    return count;
  }

  private computeDurationMs(
    messages: readonly TranscriptMessage[],
  ): number | null {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let count = 0;
    for (const msg of messages) {
      if (!msg.timestamp) continue;
      const ts = Date.parse(msg.timestamp);
      if (Number.isNaN(ts)) continue;
      count++;
      if (ts < min) min = ts;
      if (ts > max) max = ts;
    }
    if (count < 2) return null;
    return max - min;
  }

  private deriveTaskId(messages: readonly TranscriptMessage[]): string | null {
    const firstUser = messages.find((m) => m.message?.role === 'user');
    if (!firstUser) return null;
    return extractTaskIdFromPrompt(this.messageText(firstUser));
  }

  private messageText(msg: TranscriptMessage): string {
    const content = msg.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    const parts: string[] = [];
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        typeof block.text === 'string'
      ) {
        parts.push(block.text);
      }
    }
    return parts.join('\n');
  }
}
