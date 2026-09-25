/**
 * Token measurement for tool-result budgets.
 *
 * Counts with `gpt-tokenizer` (o200k_base) directly rather than the per-host
 * `ITokenCounter`, so a count is identical on VS Code, Electron and the CLI
 * and specs are deterministic.
 */
import { encode } from 'gpt-tokenizer';

/**
 * Special-token markers such as `<|endoftext|>` are ordinary text inside a
 * tool result. By default `encode` throws on them; an empty disallow set
 * encodes them as plain bytes instead.
 */
const ENCODE_OPTIONS = { disallowedSpecial: new Set<string>() };

/** A budget in both units; text fits only when it satisfies both. */
export interface TextBudget {
  /** Maximum gpt-tokenizer token count. */
  readonly tokens: number;
  /** Hard ceiling in UTF-16 code units (`string.length`). */
  readonly chars: number;
}

/** Exact gpt-tokenizer token count of `text`. */
export function countTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return encode(text, ENCODE_OPTIONS).length;
}

/**
 * Whether `text` is within both limits of `budget`.
 *
 * Two pre-checks avoid encoding in the common cases:
 * - over the char ceiling → does not fit, whatever its token count, so a
 *   multi-megabyte result is never tokenised here;
 * - UTF-8 byte length within the token budget → fits, because every
 *   byte-level BPE token covers at least one byte.
 * Only text between those bounds (at most `budget.chars` long) is encoded.
 */
export function fitsBudget(text: string, budget: TextBudget): boolean {
  assertLimit('tokens', budget.tokens);
  assertLimit('chars', budget.chars);
  if (text.length > budget.chars) {
    return false;
  }
  if (Buffer.byteLength(text, 'utf8') <= budget.tokens) {
    return true;
  }
  return countTokens(text) <= budget.tokens;
}

function assertLimit(name: keyof TextBudget, value: number): void {
  if (Number.isNaN(value) || value < 0) {
    throw new RangeError(
      `Budget ${name} must be a non-negative number, got ${value}`,
    );
  }
}
