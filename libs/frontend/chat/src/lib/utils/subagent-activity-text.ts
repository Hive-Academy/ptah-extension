/**
 * An absolute path inside quotes or backticks; it can contain spaces
 * (`"C:\Users\Jane Doe\a.ts"`). Group 1 is the quote, group 2 the file name.
 */
const QUOTED_ABSOLUTE_PATH =
  /(["'`])(?:[A-Za-z]:[\\/]|\/)[^"'`\n]*[\\/]([^"'`\\/\n]+)\1/g;

/**
 * An unquoted absolute file path (Windows `D:\a\b`, `D:/a/b` or POSIX
 * `/a/b`). The lookbehind skips URLs (`https://host/a`) and relative paths
 * (`src/a`). Group 1 is the last path segment.
 */
const ABSOLUTE_PATH =
  /(?<![\w.:/\\])(?:[A-Za-z]:[\\/]|\/)(?:[^\s\\/'"`<>|]+[\\/])+([^\s\\/'"`<>|]+)/g;

/**
 * Bold delimiters around text. Each delimiter must sit next to a space,
 * a bracket, punctuation or the line edge on its outer side, so
 * `src/__init__.py` and `**\/*.ts` stay.
 */
const EMPHASIS =
  /(?<=^|[\s([{"'])(\*\*|__)(?=\S)(.+?)(?<=\S)\1(?=$|[\s)\]}"',;:!?]|\.(?:\s|$))/gm;

/**
 * One readable line for the activity row of a subagent card: markdown
 * marks removed, whitespace collapsed and absolute paths cut to the file
 * name. The card keeps the full text for the hover title.
 */
export function subagentActivityText(raw: string): string {
  return raw
    .replace(/^\s{0,3}(?:#{1,6}|[-*+>]|\d+\.)\s+/gm, '')
    .replace(QUOTED_ABSOLUTE_PATH, '$1$2$1')
    .replace(EMPHASIS, '$2')
    .replace(/`/g, '')
    .replace(ABSOLUTE_PATH, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
