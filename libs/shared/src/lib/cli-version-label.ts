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

/** A bare calendar date such as 2026.11.03 (no pre-release suffix) is not a version. */
const DATE_TOKEN = /^(?:19|20)\d{2}\.\d{1,2}\.\d{1,2}$/;

/**
 * The first version token of the probe line, or undefined when the first token is a bare date or
 * follows the word "build" ("build 2026.11.03"). Any vendor name may precede the token, so
 * "2.1.0 (Claude Code)" and "cursor 2025.11.06-8fe8a63" keep their versions.
 */
function versionToken(raw: string): string | undefined {
  const match = VERSION_TOKEN.exec(raw);
  const token = match?.[1];
  if (!match || !token) return undefined;
  const before = raw.slice(0, match.index + match[0].length - token.length);
  if (DATE_TOKEN.test(token) || /\bbuild\s*v?$/i.test(before)) return undefined;
  return token;
}

/**
 * Batch 52.1: the detected version is the CLI's raw `--version` line (`probeCliVersion`), e.g. "codex-cli 0.155.1",
 * "opencode v2.0.12" or "GitHub Copilot CLI 1.0.83.". Shows the version token as "v0.155.1"; a line with no such token
 * is shown trimmed and without a "v" (the cell truncates it, with the raw line in its title). A multi-line probe
 * still yields the token when it has one, and otherwise nothing — the stdout is not the label.
 */
export function cliVersionLabel(raw: string): string {
  const token = versionToken(raw);
  if (token) return `v${token}`;
  if (isCliProcessDump(raw)) return '';
  return raw.trim();
}
