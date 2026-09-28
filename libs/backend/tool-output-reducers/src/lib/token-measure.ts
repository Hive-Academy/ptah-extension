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

/**
 * Longest piece {@link countTokensPiecewise} encodes at once. gpt-tokenizer's
 * BPE is super-linear on one long pre-token (about 1.5 s for a 65,000-char
 * run of one letter in one `encode`); a piece of this size stays around a
 * millisecond.
 */
const MAX_PIECE_CHARS = 1024;

/**
 * o200k_base's pre-tokenizer split, verbatim from gpt-tokenizer 4
 * (`encodingParams/constants`, `O200K_TOKEN_SPLIT_PATTERN`; a spec pins the
 * copy to the installed one). `encode` runs byte-pair merging on each match
 * separately, so the token count of a text is the sum over its matches.
 */
const CONTRACTION = String.raw`(?:'(?:[sS]|[dD]|[mM]|[tT]|[lL][lL]|[vV][eE]|[rR][eE]))?`;
export const O200K_SPLIT_PATTERN = [
  String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+${CONTRACTION}`,
  String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*${CONTRACTION}`,
  String.raw`\p{N}{1,3}`,
  String.raw` ?[^\s\p{L}\p{N}]+[\r\n/]*`,
  String.raw`\s*[\r\n]+`,
  String.raw`\s+(?!\S)`,
  String.raw`\s+`,
].join('|');

/** Exact gpt-tokenizer token count of `text`. */
export function countTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return encode(text, ENCODE_OPTIONS).length;
}

/** A run of whole pre-tokens; `long` marks one pre-token over {@link MAX_PIECE_CHARS}. */
interface Piece {
  readonly start: number;
  readonly end: number;
  readonly long: boolean;
}

/**
 * Upper bound of the token count of `text`, at a cost linear in its length.
 *
 * The text is cut into pieces of at most {@link MAX_PIECE_CHARS} chars; every
 * cut falls between two o200k pre-tokens of the whole text, right after a
 * non-whitespace char. Encoding such a piece alone yields exactly the
 * pre-tokens it held in the whole text: the split pattern has no look-behind
 * and no anchor, its alternatives without a look-ahead match the same chars
 * whatever follows, and its one look-ahead (`\s+(?!\S)`) cannot reach the
 * piece end because the piece does not end in whitespace. So the sum over
 * pieces equals {@link countTokens}. A stretch that cannot be cut that way
 * (one pre-token longer than a piece, such as a long run of one letter, or a
 * piece-sized run with no safe cut) counts as its UTF-8 byte length instead,
 * never below its token count because every byte-level BPE token covers at
 * least one byte. The result is therefore exact for ordinary text and never
 * below the exact count for any text; the specs pin both against
 * {@link countTokens}.
 *
 * Counting stops once the running sum passes `limit`; the partial sum (then
 * already over `limit`) is returned.
 */
export function countTokensPiecewise(text: string, limit = Infinity): number {
  let total = 0;
  for (const piece of pieces(text)) {
    if (total > limit) {
      break;
    }
    total += pieceTokens(text.slice(piece.start, piece.end), piece.long);
  }
  return total;
}

/**
 * Length of a prefix of `text` that fits both limits of `budget` by the
 * upper bound of {@link countTokensPiecewise}, so its exact token count is
 * within the budget too. Whole pieces are taken while they fit, then a
 * binary search runs inside the first piece that does not; the candidate is
 * then counted as a text of its own (cutting can change the pre-tokens near
 * the cut) and shortened until that count fits. Token counts are not
 * monotonic in the length, so this is a long fitting prefix, not provably
 * the longest. The prefix never ends inside a surrogate pair. Cost: one pass
 * up to the char ceiling, about ten encodes of one piece, and usually one
 * verifying count of the candidate.
 */
export function fittingPrefixLength(text: string, budget: TextBudget): number {
  assertLimit('tokens', budget.tokens);
  assertLimit('chars', budget.chars);
  const window = safeEnd(text, Math.min(text.length, Math.floor(budget.chars)));
  const head = text.slice(0, window);
  let total = 0;
  let candidate = head.length;
  for (const piece of pieces(head)) {
    const slice = head.slice(piece.start, piece.end);
    const tokens = pieceTokens(slice, piece.long);
    if (total + tokens > budget.tokens) {
      candidate = piece.start + fittingPieceLength(slice, piece.long, budget.tokens - total);
      break;
    }
    total += tokens;
  }
  return verifiedPrefix(head, candidate, budget.tokens);
}

/** Proportional shrink passes before {@link verifiedPrefix} falls back to a binary search. */
const MAX_SHRINK_PASSES = 4;

/**
 * `candidate` or a shorter length whose prefix, counted on its own, is
 * within `tokens`. Every returned length was measured to fit (0 always does).
 */
function verifiedPrefix(text: string, candidate: number, tokens: number): number {
  const fits = (length: number): boolean =>
    countTokensPiecewise(text.slice(0, length), tokens) <= tokens;
  let length = candidate;
  for (let pass = 0; pass < MAX_SHRINK_PASSES && length > 0; pass++) {
    const count = countTokensPiecewise(text.slice(0, length), tokens);
    if (count <= tokens) {
      return length;
    }
    const shorter = Math.min(length - 1, Math.floor((length * tokens) / count));
    length = safeEnd(text, Math.max(0, shorter));
  }
  if (length === 0 || fits(length)) {
    return length;
  }
  let low = 0; // fits
  let high = length; // does not fit
  while (high - low > 1) {
    const mid = safeEnd(text, (low + high) >> 1);
    if (mid <= low) {
      break;
    }
    if (fits(mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Whether `text` is within both limits of `budget`, by the upper bound of
 * {@link countTokensPiecewise}: `true` is never wrong.
 *
 * Two pre-checks avoid encoding in the common cases:
 * - over the char ceiling → does not fit, whatever its token count, so a
 *   multi-megabyte result is never tokenised here;
 * - UTF-8 byte length within the token budget → fits, because every
 *   byte-level BPE token covers at least one byte.
 * Only text between those bounds (at most `budget.chars` long) is counted,
 * stopping once over the budget.
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
  return countTokensPiecewise(text, budget.tokens) <= budget.tokens;
}

/**
 * Pieces of `text` in order, covering it without gaps. Every cut falls
 * between two pre-tokens of the whole text. A piece is encoded (`long:
 * false`) only when it is at most {@link MAX_PIECE_CHARS} long and ends
 * after a non-whitespace char or at the end of the text: then encoding it
 * alone reproduces its pre-tokens (see {@link countTokensPiecewise}). A cut
 * right after whitespace would not: `\s+(?!\S)` can take one more
 * whitespace char when the input ends there. Any other stretch (one
 * pre-token over the piece size, or a piece-sized run with no safe cut) is
 * `long` and bounded by its bytes.
 */
function* pieces(text: string): Generator<Piece> {
  if (text.length === 0) {
    return;
  }
  if (text.length <= MAX_PIECE_CHARS) {
    yield { start: 0, end: text.length, long: false };
    return;
  }
  const split = new RegExp(O200K_SPLIT_PATTERN, 'gu');
  let start = 0;
  /** Latest pre-token end after `start` that ends after a non-whitespace char. */
  let safe = -1;
  let match: RegExpExecArray | null;
  while ((match = split.exec(text)) !== null) {
    const tokenEnd = match.index + match[0].length;
    if (tokenEnd - start > MAX_PIECE_CHARS) {
      if (safe > start) {
        yield { start, end: safe, long: false };
        start = safe;
      } else if (match.index > start) {
        yield { start, end: match.index, long: true };
        start = match.index;
      }
      safe = -1;
      if (tokenEnd - start > MAX_PIECE_CHARS) {
        yield { start, end: tokenEnd, long: true };
        start = tokenEnd;
        continue;
      }
    }
    if (!WHITESPACE.test(text[tokenEnd - 1])) {
      safe = tokenEnd;
    }
  }
  if (start < text.length) {
    yield { start, end: text.length, long: false };
  }
}

const WHITESPACE = /\s/u;

function pieceTokens(piece: string, long: boolean): number {
  return long ? Buffer.byteLength(piece, 'utf8') : countTokens(piece);
}

/**
 * Length of a prefix of one piece whose count is within `room`: the byte
 * length for a long pre-token, the exact count otherwise. A binary search,
 * and every length it keeps was measured to fit.
 */
function fittingPieceLength(piece: string, long: boolean, room: number): number {
  let low = 0; // fits
  let high = piece.length; // does not fit
  while (high - low > 1) {
    const mid = safeEnd(piece, (low + high) >> 1);
    if (mid <= low) {
      break;
    }
    if (pieceTokens(piece.slice(0, mid), long) <= room) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

/** `end`, moved back one unit when it would split a surrogate pair. */
function safeEnd(text: string, end: number): number {
  if (end > 0 && end < text.length) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      return end - 1;
    }
  }
  return end;
}

function assertLimit(name: keyof TextBudget, value: number): void {
  if (Number.isNaN(value) || value < 0) {
    throw new RangeError(
      `Budget ${name} must be a non-negative number, got ${value}`,
    );
  }
}
