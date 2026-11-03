/**
 * Renders a provider carry-over transcript into the first-turn prompt of the
 * new session: known secret patterns redacted, newest turns kept whole within
 * a fixed character budget. Pure; it neither reads, logs nor throws.
 */
import type { SessionHistoryRouter } from '@ptah-extension/agent-sdk';

export type CarryOverTranscript = Awaited<
  ReturnType<SessionHistoryRouter['readCarryOverTranscript']>
>;
type CarryOverTurn = CarryOverTranscript['turns'][number];

/** Read at most the last 2 MiB of a Claude JSONL session. */
export const CARRY_OVER_READ_TAIL_BYTES = 2 * 1024 * 1024;

/** Most complete root turns a native Codex carry-over read returns. */
export const CARRY_OVER_NATIVE_MAX_TURNS = 200;

/** Most `thread/turns/list` requests of one native read (25 turns per page). */
export const CARRY_OVER_NATIVE_MAX_TURN_PAGES = 8;

/** Most `thread/items/list` requests of one native read, across all its turns. */
export const CARRY_OVER_NATIVE_MAX_ITEM_PAGES = 16;

/** Upper bound of the rendered transcript, omission line and marker included. */
export const CARRY_OVER_TEXT_BUDGET_CHARS = 48_000;

/** Bound of the whole transcript read; far inside the 120 s RPC timeout. */
export const CARRY_OVER_READ_TIMEOUT_MS = 20_000;

/** Never starts with `/`, so no provider reads it as a slash command. */
export const CARRY_OVER_INSTRUCTION =
  'This conversation continues an earlier session that ran with another provider. ' +
  'Summarize the earlier conversation below so the work can continue here: the goal, ' +
  'the decisions made, the current state, and the open next steps. ' +
  'Reply with the summary only.';

export interface CarryOverPrompt {
  readonly prompt: string;
  readonly keptTurns: number;
  readonly omittedTurns: number;
}

const REDACTED = '[REDACTED]';
const TRUNCATION_MARKER = '[start of this message omitted]';
const SEPARATOR = '\n\n';

/**
 * Best-effort, known-pattern redaction (no generic base64 rule, which would
 * eat hashes and paths). Order matters: whole blocks and header lines first,
 * then vendor token shapes, then `key=value` assignments.
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    REDACTED,
  ],
  [/\bAuthorization\s*:[^\r\n]*/gi, `Authorization: ${REDACTED}`],
  [/\bBearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]+/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  [
    /\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|token|secret|password))(\s*[:=]\s*)(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s,;&]+)/gi,
    `$1$2${REDACTED}`,
  ],
];

export function redactKnownSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    text,
  );
}

function label(turn: CarryOverTurn): string {
  if (turn.compactionSummary) return 'Summary of the earlier conversation:';
  return turn.role === 'user' ? 'User:' : 'Assistant:';
}

/**
 * Builds the first-turn prompt, or `null` when the transcript has no text.
 * Oldest turns are dropped first. The omission line carries an exact count
 * only when every dropped turn was inside the read window (the window held
 * the whole history, or it starts at a compaction summary); a window that
 * holds neither always gets the no-count line.
 */
export function renderCarryOverPrompt(
  transcript: CarryOverTranscript,
  budget: number = CARRY_OVER_TEXT_BUDGET_CHARS,
): CarryOverPrompt | null {
  const limit = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  // Redact before measuring, so a cut can never leave a secret's tail.
  const blocks = transcript.turns
    .map((turn) => ({ label: label(turn), text: redactKnownSecrets(turn.text).trim() }))
    .filter((block) => block.text.length > 0)
    .map((block) => `${block.label}\n${block.text}`);
  if (blocks.length === 0 || limit === 0) return null;

  const countable =
    transcript.windowCoversWholeHistory || transcript.startsAtCompactionSummary;
  const omissionLine = (omitted: number): string | null => {
    if (!countable) return 'Earlier conversation omitted.';
    if (omitted === 0) return null;
    return `Earlier conversation omitted (${omitted} ${omitted === 1 ? 'turn' : 'turns'}).`;
  };
  const header = (omitted: number): string => {
    const line = omissionLine(omitted);
    return line === null ? '' : line + SEPARATOR;
  };

  // Each added block costs more than any change in the count's digits, so
  // the first kept size that overflows ends the search.
  let kept = 0;
  let body = '';
  for (let index = blocks.length - 1; index >= 0; index--) {
    const candidate = kept === 0 ? blocks[index] : blocks[index] + SEPARATOR + body;
    if (header(blocks.length - kept - 1).length + candidate.length > limit) break;
    body = candidate;
    kept++;
  }

  let rendered: string;
  if (kept > 0) {
    rendered = header(blocks.length - kept) + body;
  } else {
    // The newest turn alone overflows: keep its end behind the marker.
    const newest = blocks[blocks.length - 1];
    const newline = newest.indexOf('\n');
    const prefix = `${header(blocks.length - 1)}${newest.slice(0, newline + 1)}${TRUNCATION_MARKER} `;
    const room = Math.max(0, limit - prefix.length);
    let tail = room > 0 ? newest.slice(newline + 1).slice(-room) : '';
    // Never start on the low half of a surrogate pair.
    if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
    rendered = prefix + tail;
    // Only a budget smaller than the fixed text gets here; the bound wins.
    if (rendered.length > limit) rendered = rendered.slice(0, limit);
    kept = 1;
  }

  return {
    prompt: `${CARRY_OVER_INSTRUCTION}\n\n<previous-conversation>\n${rendered}\n</previous-conversation>`,
    keptTurns: kept,
    omittedTurns: blocks.length - kept,
  };
}
