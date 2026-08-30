/**
 * `sanitizeConsoleText` — unit specs (TASK_2026_354).
 *
 * The mojibake inputs are written as explicit code points rather than pasted
 * literals, for two reasons: a pasted literal is exactly the kind of thing a
 * mis-encoded editor round-trip silently rewrites (which is how the corruption
 * this function repairs got into the repo in the first place), and spelling out
 * `\u00E2\u20AC\u201D` documents WHY those three characters mean "em dash":
 * they are the UTF-8 bytes of U+2014 (`e2 80 94`) read as CP1252.
 */

import { sanitizeConsoleText } from './console-text';

/** UTF-8 bytes of U+2014 EM DASH decoded as CP1252: `â` `€` `”`. */
const MOJIBAKE_EM_DASH = '\u00E2\u20AC\u201D';
/** UTF-8 bytes of U+2019 RIGHT SINGLE QUOTE decoded as CP1252: `â` `€` `™`. */
const MOJIBAKE_APOSTROPHE = '\u00E2\u20AC\u2122';
/** UTF-8 bytes of U+2026 HORIZONTAL ELLIPSIS decoded as CP1252: `â` `€` `¦`. */
const MOJIBAKE_ELLIPSIS = '\u00E2\u20AC\u00A6';

describe('sanitizeConsoleText', () => {
  it('returns pure-ASCII input unchanged and identical by reference', () => {
    const line = '[INFO] [SubsystemBringUp] MCP server started on port 51821';
    expect(sanitizeConsoleText(line)).toBe(line);
  });

  it('repairs a double-encoded em dash to ASCII', () => {
    // The exact line from tmp/logs/log.log:692, whose SOURCE string in
    // agent-sdk holds the corrupted bytes.
    const corrupted = `[SdkQueryRunner] SDK options built ${MOJIBAKE_EM_DASH} launching query`;
    expect(sanitizeConsoleText(corrupted)).toBe(
      '[SdkQueryRunner] SDK options built - launching query',
    );
  });

  it('folds a correctly encoded em dash to ASCII too', () => {
    // The other half of the same problem: a clean source string still prints as
    // mojibake on a Windows console left on codepage 850/437.
    expect(
      sanitizeConsoleText(
        '[memory-curator] boot-scan \u2014 bounded to 7 days',
      ),
    ).toBe('[memory-curator] boot-scan - bounded to 7 days');
  });

  it('repairs a double-encoded apostrophe and ellipsis', () => {
    expect(
      sanitizeConsoleText(
        `it${MOJIBAKE_APOSTROPHE}s waiting${MOJIBAKE_ELLIPSIS}`,
      ),
    ).toBe("it's waiting...");
  });

  it('folds the punctuation set used across Ptah log strings', () => {
    expect(
      sanitizeConsoleText('a \u2013 b \u2018c\u2019 \u201Cd\u201D \u2026'),
    ).toBe(`a - b 'c' "d" ...`);
    expect(sanitizeConsoleText('\u2022 \u2605 \u2192 \u2190')).toBe(
      '* * -> <-',
    );
    expect(sanitizeConsoleText('n \u2265 1, n \u2264 9, 3 \u00D7 4')).toBe(
      'n >= 1, n <= 9, 3 x 4',
    );
    expect(sanitizeConsoleText('a\u00A0b')).toBe('a b');
  });

  it('leaves non-punctuation non-ASCII alone', () => {
    // A log line quoting a user's path or content must survive intact. Folding
    // "anything non-ASCII" would mangle exactly the data a reader needs.
    expect(sanitizeConsoleText('C:\\Users\\José\\projets\\café')).toBe(
      'C:\\Users\\José\\projets\\café',
    );
    expect(sanitizeConsoleText('検索 결과 🎉')).toBe('検索 결과 🎉');
  });

  it('handles repeated occurrences in one line', () => {
    expect(
      sanitizeConsoleText(
        `a ${MOJIBAKE_EM_DASH} b ${MOJIBAKE_EM_DASH} c \u2014 d`,
      ),
    ).toBe('a - b - c - d');
  });

  it('is idempotent', () => {
    const once = sanitizeConsoleText(`x ${MOJIBAKE_EM_DASH} y \u2026`);
    expect(sanitizeConsoleText(once)).toBe(once);
  });

  it('produces pure ASCII for every punctuation form it knows', () => {
    const mixed = `${MOJIBAKE_EM_DASH}${MOJIBAKE_APOSTROPHE}${MOJIBAKE_ELLIPSIS}\u2014\u2013\u2018\u2019\u201C\u201D\u2026\u2022\u2605\u2192\u2190\u2265\u2264\u00D7\u00A0\u2212`;
    const cleaned = sanitizeConsoleText(mixed);
    // eslint-disable-next-line no-control-regex
    expect(cleaned).toMatch(/^[\x00-\x7F]*$/);
  });

  it('handles the empty string', () => {
    expect(sanitizeConsoleText('')).toBe('');
  });
});
