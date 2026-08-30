/**
 * `sanitizeConsoleText` — make a log line safe for a plain console.
 *
 * Two distinct problems, both visible in `tmp/logs/log.log` and both fixed
 * here rather than at the 344 call sites that produce them (TASK_2026_354).
 *
 * **1. Double-encoded source strings.** Some log messages in this repo hold the
 * bytes `c3 a2 e2 82 ac e2 80 9d` where an em dash belongs — UTF-8 for the
 * three characters `â` `€` `”`, which is what you get when a UTF-8 em dash is
 * decoded as CP1252 and re-encoded as UTF-8. A past edit went through a pipe
 * with the wrong codepage and the result was committed, so the corruption is in
 * the SOURCE, not in the console:
 *
 * ```
 * [INFO] [SdkQueryRunner] SDK options built â€” launching query      <- corrupt source
 * [INFO] [memory-curator] boot-scan cold start — bounded to 7 days  <- clean source
 * ```
 *
 * Both lines came out of the same console in the same session. Repairing the
 * source files would be right, but there are 65 of them across libs that other
 * work is editing concurrently; repairing at the one place a line reaches the
 * console costs one pass over the string and covers every one of them.
 *
 * **2. Typographic punctuation on a legacy console.** Even a correctly encoded
 * em dash renders as mojibake on a Windows console still on codepage 850/437.
 * So after repair, a curated set of punctuation is folded to ASCII.
 *
 * **Deliberately narrow.** Only typographic punctuation is folded. Accented
 * letters, CJK, emoji and everything else non-ASCII pass through untouched — a
 * log line quoting a user's file path must not be mangled to make a dash
 * prettier. And this is applied to the CONSOLE mirror only; the file-backed
 * `IOutputChannel` is UTF-8 and gets the message as written.
 */

/**
 * Double-encoded sequences → the character that was meant.
 *
 * Ordered longest-first at build time so a longer sequence is never eaten by a
 * shorter one that is its prefix (`â€“` and `â€”` both start with `â€`).
 */
const MOJIBAKE_REPAIRS: ReadonlyArray<readonly [string, string]> = [
  ['â€”', '—'], // em dash
  ['â€“', '–'], // en dash
  ['â€™', '’'], // right single quote
  ['â€˜', '‘'], // left single quote
  ['â€œ', '“'], // left double quote
  ['â€', '”'], // right double quote
  ['â€¦', '…'], // ellipsis
  ['â€¢', '•'], // bullet
  ['â†’', '→'], // right arrow
  ['âˆ’', '−'], // minus sign
  ['Ã©', 'é'], // e-acute
  ['Â ', ' '], // non-breaking space
];

/** Typographic punctuation → an ASCII equivalent a legacy console can print. */
const ASCII_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ['—', '-'], // em dash
  ['–', '-'], // en dash
  ['−', '-'], // minus sign
  ['‘', "'"], // left single quote
  ['’', "'"], // right single quote
  ['“', '"'], // left double quote
  ['”', '"'], // right double quote
  ['…', '...'],
  ['•', '*'], // bullet
  ['★', '*'], // black star
  ['→', '->'],
  ['←', '<-'],
  ['≥', '>='],
  ['≤', '<='],
  ['×', 'x'], // multiplication sign
  [' ', ' '], // non-breaking space
];

/**
 * Ordered longest-first so a prefix rule cannot pre-empt a longer match.
 * Sorting here, rather than trusting the literal order above, keeps the tables
 * safe to extend without thinking about it.
 */
function byDescendingLength(
  pairs: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<readonly [string, string]> {
  return [...pairs].sort((a, b) => b[0].length - a[0].length);
}

const REPAIRS = byDescendingLength(MOJIBAKE_REPAIRS);
const FOLDS = byDescendingLength(ASCII_FOLDS);

function applyAll(
  text: string,
  rules: ReadonlyArray<readonly [string, string]>,
): string {
  let result = text;
  for (const [from, to] of rules) {
    if (result.includes(from)) {
      result = result.split(from).join(to);
    }
  }
  return result;
}

/** True when `text` contains nothing this function would change. */
function isPlainAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/**
 * Repair double-encoded punctuation, then fold typographic punctuation to
 * ASCII. Returns `text` unchanged when it is already pure ASCII, which is the
 * overwhelming majority of log lines and skips both passes entirely.
 */
export function sanitizeConsoleText(text: string): string {
  if (isPlainAscii(text)) return text;
  return applyAll(applyAll(text, REPAIRS), FOLDS);
}
