/**
 * Why the tree-sitter parser refused a source, readable by coverage producers.
 *
 * Kept apart from `tree-sitter-parser.service.ts` so a producer (graph,
 * code index, syntax diagnostics) can classify a failure without loading the
 * WASM runtime module and its bundle-dir resolver.
 */
import type { FailureReason } from '@ptah-extension/platform-core';

/**
 * Largest source the parser accepts, in UTF-8 bytes (1 MiB). Larger sources
 * are refused as `too-large` instead of blocking the host thread; parsing
 * them off-thread is TASK_2026_561 B4.
 */
export const MAX_PARSE_BYTES = 1024 * 1024;

/** Why the parser refused to analyse a source, as a coverage reason. */
export type ParserRefusalReason = Extract<
  FailureReason,
  'grammar-unavailable' | 'too-large'
>;

/**
 * The parser did not analyse the source for a reason other than the source
 * failing to parse: its language's grammar (or the runtime) could not load,
 * or the source is over {@link MAX_PARSE_BYTES}. Coverage producers read
 * `reason` through {@link parserFailureReason}.
 */
export class ParserRefusalError extends Error {
  constructor(
    readonly reason: ParserRefusalReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ParserRefusalError';
  }
}

/**
 * The coverage reason for a failed parser call: the refusal reason when a
 * {@link ParserRefusalError} is the error or anywhere in its `cause` chain
 * (callers that re-wrap keep it as `cause`), otherwise `parse`.
 */
export function parserFailureReason(error: unknown): FailureReason {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof ParserRefusalError) return current.reason;
    current = current.cause;
  }
  return 'parse';
}

/** Whether `content` is over {@link MAX_PARSE_BYTES} in UTF-8. */
export function exceedsParseLimit(content: string): boolean {
  // UTF-8 never takes fewer bytes than UTF-16 code units, nor more than 3 per unit.
  if (content.length > MAX_PARSE_BYTES) return true;
  if (content.length * 3 <= MAX_PARSE_BYTES) return false;
  return Buffer.byteLength(content, 'utf8') > MAX_PARSE_BYTES;
}
