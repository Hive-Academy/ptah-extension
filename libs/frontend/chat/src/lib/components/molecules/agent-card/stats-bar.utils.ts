/**
 * Stats Bar Utilities
 * TASK_2025_177: Shared stats formatting and extraction for CLI agent output components.
 *
 * Provides:
 * - CliAgentStats interface (unified stats type for all CLI agents)
 * - formatTokens / formatDuration display helpers
 * - extractCodexStats — parses "Usage: N input, M output tokens" (accumulates multi-turn)
 * - extractCopilotStats — parses "Usage: {model}, {in} input, {out} output, ${cost}, {dur}s"
 * - extractGeminiStats — re-exported from gemini-output.utils.ts for backward compat
 */

import type { CliOutputSegment } from '@ptah-extension/shared';

/** Minimal segment shape required by stats extraction (satisfied by CliOutputSegment) */
export type StatsSegment = Pick<CliOutputSegment, 'type' | 'content'>;

/** Extracted statistics from CLI agent info segments (unified type for all CLI agents) */
export interface CliAgentStats {
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs?: number;
  /** Formatted cost string (e.g., "$1.0000") — only Copilot provides this */
  readonly cost?: string;
}

/**
 * Format a token count for compact display.
 * Returns "1.2k" for counts >= 1000, raw number string otherwise.
 */
export function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

/**
 * Format a duration in milliseconds for display.
 * Returns "250ms", "2.3s", or "1m 5s" depending on magnitude.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Check if a segment is a usage/stats segment that should be shown
 * in the stats bar instead of the execution tree.
 */
export function isUsageSegment(segment: StatsSegment): boolean {
  return segment.type === 'info' && segment.content.startsWith('Usage:');
}

/**
 * Extract statistics from Codex info-type segments.
 *
 * Codex emits usage as: "Usage: N input, M output tokens" (one per turn.completed).
 * Accumulates token counts across all matching segments (multi-turn support).
 */
export function extractCodexStats(
  infoSegments: readonly StatsSegment[]
): CliAgentStats | null {
  if (infoSegments.length === 0) return null;

  let totalInput = 0;
  let totalOutput = 0;
  let found = false;

  for (const seg of infoSegments) {
    const content = seg.content;
    if (!content) continue;

    // Match "Usage: 1234 input, 567 output tokens" or "1234 input, 567 output"
    const match = content.match(/(\d[\d,]*)\s*input.*?(\d[\d,]*)\s*output/i);
    if (match) {
      totalInput += parseInt(match[1].replace(/,/g, ''), 10);
      totalOutput += parseInt(match[2].replace(/,/g, ''), 10);
      found = true;
    }
  }

  return found ? { inputTokens: totalInput, outputTokens: totalOutput } : null;
}

/**
 * Extract statistics from Copilot info-type segments.
 *
 * Copilot emits usage in two known formats:
 * 1. "Usage: claude-sonnet-4, 1234 input, 567 output, $0.012, 3.5s"
 * 2. "Usage: model: gpt-5.3-codex, 80903 input, 4645 output, $1.0000, 64.6s"
 *
 * Accumulates token counts across all matching segments (multi-turn support).
 * Model and duration use the latest match.
 */
export function extractCopilotStats(
  infoSegments: readonly StatsSegment[]
): CliAgentStats | null {
  if (infoSegments.length === 0) return null;

  let totalInput = 0;
  let totalOutput = 0;
  let model: string | undefined;
  let durationMs: number | undefined;
  let costStr: string | undefined;
  let found = false;

  for (const seg of infoSegments) {
    const content = seg.content;
    if (!content || !content.startsWith('Usage:')) continue;

    // Extract tokens: "N input" and "M output"
    const inputMatch = content.match(/(\d[\d,]*)\s*input/i);
    const outputMatch = content.match(/(\d[\d,]*)\s*output/i);
    if (inputMatch && outputMatch) {
      totalInput += parseInt(inputMatch[1].replace(/,/g, ''), 10);
      totalOutput += parseInt(outputMatch[1].replace(/,/g, ''), 10);
      found = true;
    }

    // Extract model: "Usage: model: gpt-5.3-codex, ..." or "Usage: claude-sonnet-4, ..."
    const modelPrefixMatch = content.match(/Usage:\s*model:\s*([^,]+)/i);
    if (modelPrefixMatch) {
      model = modelPrefixMatch[1].trim();
    } else {
      // First field after "Usage:" that isn't a number
      const firstFieldMatch = content.match(/Usage:\s*([^,]+)/i);
      if (firstFieldMatch) {
        const field = firstFieldMatch[1].trim();
        if (!/^\d/.test(field)) {
          model = field;
        }
      }
    }

    // Extract cost: "$1.0000"
    const costMatch = content.match(/\$(\d+\.\d+)/);
    if (costMatch) {
      costStr = `$${costMatch[1]}`;
    }

    // Extract duration: "64.6s"
    const durMatch = content.match(/(\d+(?:\.\d+)?)s\s*$/);
    if (durMatch) {
      durationMs = Math.round(parseFloat(durMatch[1]) * 1000);
    }
  }

  if (!found) return null;

  return {
    model,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    durationMs,
    cost: costStr,
  };
}
