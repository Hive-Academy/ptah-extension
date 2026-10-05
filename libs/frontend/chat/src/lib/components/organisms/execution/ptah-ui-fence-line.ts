/**
 * The `ptah-ui` fence opener: three backticks and the info string, at column 0.
 */
const OPENER = '```ptah-ui';

/**
 * Whether `text` has a line that is exactly the `ptah-ui` fence opener
 * (TASK_2026_610, component 10): ```` ```ptah-ui ```` at column 0, followed
 * only by spaces and an optional `\r` before the line break or the end of the
 * text. This is the opener `segmentPtahUi` recognises, so the check is true
 * whenever the segmenter could find a block.
 *
 * It is the cheap gate in front of the lazy `@ptah-extension/chat-ui/ptah-ui`
 * chunk, so it stays a plain scan over the raw text with zero imports: an
 * indented fence, a ```` ```ptah-ui-x ```` fence or any HTML that imitates a
 * block never passes it.
 */
export function hasPtahUiFenceLine(text: string): boolean {
  let from = text.indexOf(OPENER);
  while (from !== -1) {
    if (from === 0 || text[from - 1] === '\n') {
      let end = from + OPENER.length;
      while (text[end] === ' ') end += 1;
      if (text[end] === '\r') end += 1;
      if (end === text.length || text[end] === '\n') return true;
    }
    from = text.indexOf(OPENER, from + 1);
  }
  return false;
}
