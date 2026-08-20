/**
 * The ONE path-stripping pipeline for foreign diagnostic text (Req 7.6).
 *
 * Every string this lib quotes back to a caller that did not originate here —
 * a `YAMLException.reason`, a `JSON.parse` `SyntaxError` message, an `Error`
 * from a filesystem adapter — goes through this function first. A message that
 * reaches the UI names the problem, never the machine.
 *
 * This lived twice, as `sanitizeDiagnostic` in `output-style-frontmatter.ts`
 * and `sanitizeDetail` in `claude-settings.writer.ts`, with a byte-identical
 * regex pipeline and two different truncation caps. Two copies means a future
 * fix to one of the three patterns — closing a path shape they currently miss —
 * has to be remembered twice, and the caps had already drifted. The cap is the
 * only thing the two call sites ever legitimately disagreed about, so it is the
 * one thing that stayed a parameter.
 */

/** What a stripped path is replaced with. Deliberately not the empty string. */
const PATH_PLACEHOLDER = '<path>';

/**
 * Strip anything that looks like a host path out of `text`, collapse it to one
 * line, and cap it at `maxLength` characters (ellipsis included in the cap).
 *
 * @param text      Foreign diagnostic text. Never trusted, never a contract.
 * @param maxLength Longest result, ellipsis included. Call sites choose their
 *                  own: a message that stands alone can afford more than one
 *                  quoted inside a larger sentence.
 */
export function sanitizeDiagnostic(text: string, maxLength: number): string {
  const withoutPaths = text
    // Windows absolute paths, incl. UNC.
    .replace(/[A-Za-z]:[\\/][^\s"']*/g, PATH_PLACEHOLDER)
    .replace(/\\\\[^\s"']+/g, PATH_PLACEHOLDER)
    // POSIX absolute paths with at least one separator after the root.
    .replace(/\/(?:[\w.@-]+\/)+[\w.@-]*/g, PATH_PLACEHOLDER);
  const collapsed = withoutPaths.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength
    ? `${collapsed.slice(0, maxLength - 1)}…`
    : collapsed;
}
