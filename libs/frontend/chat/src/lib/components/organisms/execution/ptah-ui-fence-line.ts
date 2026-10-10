/**
 * The `ptah-ui` fence opener: three backticks and the info string, at column 0.
 */
const OPENER = '```ptah-ui';

/** What follows {@link OPENER} on a bare display opener line. */
const DISPLAY_TARGET = ' display';

/** Which `ptah-ui` opener lines a scan accepts. */
type OpenerKinds = 'any' | 'display';

/**
 * Whether `text` has a `ptah-ui` fence opener line (TASK_2026_610, component
 * 10; TASK_2026_623, component 7): ```` ```ptah-ui ````,
 * ```` ```ptah-ui display ```` or ```` ```ptah-ui display <id> ```` at column
 * 0, followed only by spaces and an optional `\r` before the line break or the
 * end of the text. These are the openers `segmentPtahUi` recognises, so the
 * check is true whenever the segmenter could find a block, inline or display.
 *
 * It is the cheap gate in front of the lazy `@ptah-extension/chat-ui/ptah-ui`
 * chunk, so it stays a plain scan over the raw text with zero imports: an
 * indented fence, a ```` ```ptah-ui-x ```` fence or any HTML that imitates a
 * block never passes it.
 */
export function hasPtahUiFenceLine(text: string): boolean {
  return hasOpenerLine(text, 'any');
}

/**
 * Whether `text` has a `ptah-ui display [id]` opener line (TASK_2026_623,
 * component 7): the transcript's gate for display candidates.
 *
 * Zero imports, like {@link hasPtahUiFenceLine}, so the id is not checked
 * against the catalog's id pattern: any one space-free word after
 * `display` passes. The check is therefore a superset of the segmenter's
 * display openers — true whenever `segmentPtahUi` could yield a segment with
 * `target === 'display'` — and the lazy sync, which segments the text, drops
 * an opener whose id the catalog rejects.
 */
export function hasPtahUiDisplayFenceLine(text: string): boolean {
  return hasOpenerLine(text, 'display');
}

function hasOpenerLine(text: string, kinds: OpenerKinds): boolean {
  let from = text.indexOf(OPENER);
  while (from !== -1) {
    if (from === 0 || text[from - 1] === '\n') {
      const rest = openerLineRest(text, from + OPENER.length);
      if (isDisplayTarget(rest) || (kinds === 'any' && rest === '')) {
        return true;
      }
    }
    from = text.indexOf(OPENER, from + 1);
  }
  return false;
}

/**
 * The rest of the opener line after {@link OPENER}, without the line break,
 * one `\r` before it and trailing spaces (the segmenter's line rule).
 */
function openerLineRest(text: string, start: number): string {
  const lineBreak = text.indexOf('\n', start);
  let end = lineBreak === -1 ? text.length : lineBreak;
  if (end > start && text[end - 1] === '\r') end -= 1;
  while (end > start && text[end - 1] === ' ') end -= 1;
  return text.slice(start, end);
}

/** ` display` alone, or ` display ` and one space-free word (the id). */
function isDisplayTarget(rest: string): boolean {
  if (!rest.startsWith(DISPLAY_TARGET)) return false;
  if (rest.length === DISPLAY_TARGET.length) return true;
  if (rest[DISPLAY_TARGET.length] !== ' ') return false;
  const id = rest.slice(DISPLAY_TARGET.length + 1);
  return id.length > 0 && !id.includes(' ');
}
