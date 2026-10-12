/**
 * Pure read-side baselines for the memory arm (benchmark-design.md sections
 * 3.3-3.5). Each function documents the design line it implements and is
 * deterministic: no network, no model, no clock, no filesystem.
 *
 * A read-side baseline is the alternative context the suites hand to the
 * R-M4 fact matcher instead of the product's injected block, so a suite's
 * numbers are comparable against a named alternative (design rule R-M2).
 * They are deliberately naive: that is the point of a baseline.
 */

import type { MatchableMemoryRow } from '../matching/fact-matcher';
import { normalizeFactText } from '../matching/fact-matcher';
import type { TranscriptMessage } from './write-side-baselines';

/**
 * One message of a seeded session with its timestamp. The seed sessions are
 * JSONL transcripts (design :95), so every message record carries an ISO-8601
 * timestamp. Baseline ordering normalises it to milliseconds before comparison.
 */
export interface TimestampedTranscriptMessage extends TranscriptMessage {
  readonly timestamp: string;
}

/** last-N context window size (benchmark-design.md:164: "N = 50"). */
export const LAST_N_MESSAGES = 50;

/** grep baseline return size (benchmark-design.md:164: "top-5 lines"). */
export const GREP_TOP_K = 5;

/**
 * No-memory baseline (benchmark-design.md:156, :164, :96): inject nothing.
 * Perfect abstention and zero recall — the guard floor for `mem.abstention`.
 */
export function noMemoryBaseline(): readonly MatchableMemoryRow[] {
  return [];
}

/** One message the last-N baseline hands back; `content` is the raw message
 * text. A chat context window carries no timestamps, so the timestamp stays
 * metadata — that absence is exactly the date-visibility contrast of
 * `mem.temporal` (benchmark-design.md:157). */
export interface LastNMessage extends MatchableMemoryRow {
  readonly timestamp: string;
  readonly role: TranscriptMessage['role'];
  readonly content: string;
}

/**
 * Last-N baseline (benchmark-design.md:164): the seed sessions concatenated
 * newest-last, tail `n` messages kept. The caller passes the sessions
 * oldest-first, so the window tail is the newest context — the shape of a
 * raw chat history with no memory system in front of it.
 *
 * Deterministic: concatenation follows the given session order and, within a
 * session, the given message order; no ordering is invented here.
 */
export function lastNMessagesBaseline(
  sessions: readonly (readonly TimestampedTranscriptMessage[])[],
  n = LAST_N_MESSAGES,
): readonly LastNMessage[] {
  if (n <= 0) return [];
  const flattened: TimestampedTranscriptMessage[] = [];
  for (const session of sessions) flattened.push(...session);
  return flattened.slice(-n).map((message) => ({
    timestamp: message.timestamp,
    role: message.role,
    content: message.text,
  }));
}

/** One grep baseline hit. `content` is the whole rendered line
 * `"<timestamp> <text>"`, so the R-M4 matcher sees the timestamp too —
 * grep lines carry ISO timestamps (benchmark-design.md:95, :157), which is
 * what makes raw grep the date-visibility baseline for `mem.temporal`. */
export interface GrepHit extends MatchableMemoryRow {
  readonly timestamp: string;
  readonly text: string;
  /** How many distinct query keywords the line contains. */
  readonly keywordHits: number;
  readonly content: string;
}

/**
 * Number of distinct keywords the line contains, substring-matched after
 * the R-M4 normalisation (NFKC, case-folded, whitespace-collapsed) — the
 * same normalisation the frozen fact labels use, so grep hits and matcher
 * hits never disagree about what a token is. A blank keyword counts for no
 * line.
 */
function keywordHitCount(
  line: TimestampedTranscriptMessage,
  keywords: readonly string[],
): number {
  const haystack = normalizeFactText(line.text);
  let hits = 0;
  for (const keyword of keywords) {
    const needle = normalizeFactText(keyword);
    if (needle.length > 0 && haystack.includes(needle)) hits += 1;
  }
  return hits;
}

/**
 * Raw transcript grep, newest-line-wins (benchmark-design.md:156): every
 * seeded-session line containing at least one query keyword is a match; the
 * newest match is the answer. `null` when no line matches — a grep with no
 * keywords finds nothing, like a grep with no pattern.
 *
 * Deterministic tie-break: on equal timestamps the later line in the
 * concatenated input order wins, mirroring `latestChunkWins`.
 */
export function rawTranscriptGrepNewest(
  sessions: readonly (readonly TimestampedTranscriptMessage[])[],
  keywords: readonly string[],
): GrepHit | null {
  let winner: TimestampedTranscriptMessage | null = null;
  let winnerTimestampMs = Number.NEGATIVE_INFINITY;
  for (const session of sessions) {
    for (const line of session) {
      const timestampMs = parseIsoTimestamp(line.timestamp);
      if (keywordHitCount(line, keywords) > 0) {
        if (winner === null || timestampMs >= winnerTimestampMs) {
          winner = line;
          winnerTimestampMs = timestampMs;
        }
      }
    }
  }
  return winner === null ? null : toGrepHit(winner, keywords);
}

/**
 * Raw transcript grep, top-K (benchmark-design.md:164): the `k` lines with
 * the most keyword hits, the injection-recall alternative to the memory
 * block.
 *
 * Deterministic tie-break, in order: more keyword hits first; then the newer
 * timestamp; then the earlier line in the concatenated input order. Stable
 * for any fixture.
 */
export function rawTranscriptGrepTopK(
  sessions: readonly (readonly TimestampedTranscriptMessage[])[],
  keywords: readonly string[],
  k = GREP_TOP_K,
): readonly GrepHit[] {
  if (k <= 0) return [];
  const matches: {
    line: TimestampedTranscriptMessage;
    index: number;
    keywordHits: number;
    timestampMs: number;
  }[] = [];
  let index = 0;
  for (const session of sessions) {
    for (const line of session) {
      const timestampMs = parseIsoTimestamp(line.timestamp);
      const keywordHits = keywordHitCount(line, keywords);
      if (keywordHits > 0) {
        matches.push({ line, index, keywordHits, timestampMs });
      }
      index += 1;
    }
  }
  const sorted = matches.sort(
    (left, right) =>
      right.keywordHits - left.keywordHits ||
      right.timestampMs - left.timestampMs ||
      left.index - right.index,
  );
  return sorted.slice(0, k).map((match) => toGrepHit(match.line, keywords));
}

function parseIsoTimestamp(value: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  ) {
    throw new RangeError(`Expected an ISO-8601 timestamp, received ${value}.`);
  }
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) {
    throw new RangeError(`Expected an ISO-8601 timestamp, received ${value}.`);
  }
  return timestampMs;
}

function toGrepHit(
  line: TimestampedTranscriptMessage,
  keywords: readonly string[],
): GrepHit {
  return {
    timestamp: line.timestamp,
    text: line.text,
    keywordHits: keywordHitCount(line, keywords),
    content: `${line.timestamp} ${line.text}`,
  };
}
