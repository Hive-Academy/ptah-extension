/**
 * Absolute file paths (Windows `D:\a\b`, `D:/a/b` or POSIX `/a/b`). The
 * lookbehind skips URLs (`https://host/a`) and relative paths (`src/a`).
 * Group 1 is the last path segment.
 */
const ABSOLUTE_PATH =
  /(?<![\w.:/\\])(?:[A-Za-z]:[\\/]|\/)(?:[^\s\\/'"`<>|]+[\\/])+([^\s\\/'"`<>|]+)/g;

/**
 * One readable line for the activity row of a subagent card: markdown
 * marks removed, whitespace collapsed and absolute paths cut to the file
 * name. The card keeps the full text for the hover title.
 */
export function subagentActivityText(raw: string): string {
  return raw
    .replace(/^\s{0,3}(?:#{1,6}|[-*+>]|\d+\.)\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(ABSOLUTE_PATH, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
