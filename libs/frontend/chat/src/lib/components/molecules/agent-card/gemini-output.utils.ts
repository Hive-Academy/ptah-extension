/**
 * Gemini Output Utilities
 *
 * Pure functions for extracting stats (tokens, duration, model) from
 * Gemini CLI agent info-type segments. Gemini emits usage information
 * in its info segments with patterns like:
 *   - "Model: gemini-2.0-flash" or "model: ..."
 *   - "Input tokens: 1234" or "input: 1234 tokens"
 *   - "Output tokens: 567" or "output: 567 tokens"
 *   - "Duration: 2.3s" or "duration_ms: 2300"
 *   - "Total tokens: 1801"
 *
 * Uses CliAgentStats as the unified stats type.
 */

import type { CliAgentStats, StatsSegment } from './stats-bar.utils';

/** @deprecated Use CliAgentStats from stats-bar.utils.ts instead */
export type GeminiStats = CliAgentStats;

/**
 * Extract statistics from Gemini info-type segments.
 *
 * Scans all provided segments (expected to be pre-filtered to info type)
 * and parses known patterns from their content.
 *
 * @param infoSegments - Array of info-type segments from Gemini output
 * @returns Parsed CliAgentStats or null if no recognizable stats found
 */
export function extractGeminiStats(
  infoSegments: readonly StatsSegment[],
): CliAgentStats | null {
  if (infoSegments.length === 0) return null;

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let durationMs: number | undefined;
  let model: string | undefined;

  for (const seg of infoSegments) {
    const content = seg.content;
    if (!content) continue;
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const modelMatch = trimmed.match(/^model\s*:\s*(.+)$/i);
      if (modelMatch && !model) {
        model = modelMatch[1].trim();
        continue;
      }
      const inputMatch =
        trimmed.match(/input\s*(?:tokens)?\s*:\s*(\d[\d,]*)/i) ??
        trimmed.match(/input\s*:\s*(\d[\d,]*)\s*tokens?/i);
      if (inputMatch && inputTokens === undefined) {
        inputTokens = parseTokenCount(inputMatch[1]);
        continue;
      }
      const outputMatch =
        trimmed.match(/output\s*(?:tokens)?\s*:\s*(\d[\d,]*)/i) ??
        trimmed.match(/output\s*:\s*(\d[\d,]*)\s*tokens?/i);
      if (outputMatch && outputTokens === undefined) {
        outputTokens = parseTokenCount(outputMatch[1]);
        continue;
      }
      const totalMatch = trimmed.match(/total\s*(?:tokens)?\s*:\s*(\d[\d,]*)/i);
      if (
        totalMatch &&
        inputTokens === undefined &&
        outputTokens === undefined
      ) {
        inputTokens = parseTokenCount(totalMatch[1]);
        continue;
      }
      const durationSecsMatch = trimmed.match(
        /duration\s*:\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?$/i,
      );
      if (durationSecsMatch && durationMs === undefined) {
        durationMs = Math.round(parseFloat(durationSecsMatch[1]) * 1000);
        continue;
      }

      const durationMsMatch = trimmed.match(
        /duration(?:_ms)?\s*:\s*(\d+)\s*ms/i,
      );
      if (durationMsMatch && durationMs === undefined) {
        durationMs = parseInt(durationMsMatch[1], 10);
        continue;
      }
    }
  }
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    durationMs === undefined &&
    model === undefined
  ) {
    return null;
  }

  return { inputTokens, outputTokens, durationMs, model };
}

/**
 * Parse a token count string (may contain commas) into a number.
 */
function parseTokenCount(raw: string): number {
  return parseInt(raw.replace(/,/g, ''), 10);
}
