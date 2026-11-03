/** A semver-like token: 0.155.1, v2.0.12, 1.0.83 (a trailing sentence dot is not part of it), 1.2.3-beta.1. */
export const VERSION_TOKEN =
  /(?:^|[^\w.])v?(\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)(?!\w)/;

/**
 * A CLI probe sometimes returns its whole stdout (a banner, a usage line, or
 * several lines). That text is not a version or a model id. Callers show a
 * clean label instead; the probe logger already keeps the raw output.
 */
export function isCliProcessDump(value: string): boolean {
  if (value.includes('\n') || value.includes('\r') || value.length > 180)
    return true;
  return /^\s*(usage:|error:|warning:|stdout|stderr)\b/i.test(value);
}

/**
 * Batch 52.1: the detected version is the CLI's raw `--version` line (`probeCliVersion`), e.g. "codex-cli 0.155.1",
 * "opencode v2.0.12" or "GitHub Copilot CLI 1.0.83.". Shows the version token as "v0.155.1"; a line with no such token
 * is shown trimmed and without a "v" (the cell truncates it, with the raw line in its title). A multi-line probe
 * still yields the token when it has one, and otherwise nothing — the stdout is not the label.
 */
export function cliVersionLabel(raw: string): string {
  const token = VERSION_TOKEN.exec(raw)?.[1];
  if (token) return `v${token}`;
  if (isCliProcessDump(raw)) return '';
  return raw.trim();
}
