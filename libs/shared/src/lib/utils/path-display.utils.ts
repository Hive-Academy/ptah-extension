/**
 * Path helpers for DISPLAY, not for filesystem work.
 *
 * Nothing here touches `node:path`, and that is deliberate — this module is
 * consumed by Angular libs that run in a webview with no Node APIs, and the
 * paths it formats were written by whichever host captured them. A POSIX root
 * can appear in a database opened on Windows and the reverse, so both
 * separators are always handled regardless of the platform doing the
 * rendering. For anything that has to RESOLVE or VALIDATE a path, use
 * `WorkspacePathEncoder` or the platform's own `IFileSystemProvider`.
 */

/**
 * The trailing segment of a path — the folder name a user recognises.
 *
 * Empty segments are dropped rather than returned, so a path with a trailing
 * separator (`D:\projects\alpha\`) yields `alpha` rather than falling back to
 * the whole string. A naive `.split(sep).pop()` returns `''` there, and the
 * usual `|| path` guard then renders the entire path in a slot sized for a
 * folder name — the failure is silent and only shows up on the one input
 * nobody tests with.
 *
 * Returns the input unchanged when it holds no segment at all (`''`, `'/'`,
 * `'\\'`), because a caller rendering a name has to render something and the
 * original string is the only honest answer left.
 */
export function lastPathSegment(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}
