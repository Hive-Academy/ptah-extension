/**
 * Whether Codex trusts a project, and therefore whether it will read that
 * project's `{ws}/.codex/config.toml` at all.
 *
 * Codex merges a project-scoped config into the home one — but only for a
 * TRUSTED project, and it says nothing when it declines. Measured on codex-cli
 * 0.150.1: an identical `{ws}/.codex/config.toml` made `codex doctor` report
 * `MCP servers 2` in a trusted workspace and `MCP servers 1` in a fresh
 * `git init` temp repo with no trust entry. No warning, no log line, no
 * difference in `codex mcp list` — the file was simply ignored.
 *
 * That silence is why this reader exists. A writer that cannot tell the two
 * cases apart has to pick one scope and hope; one that can picks the scope the
 * CLI will actually read.
 *
 * ## The record
 *
 * Trust lives in the HOME config as one table per project:
 *
 *     [projects.'d:\projects\ptah-extension']
 *     trust_level = "trusted"
 *
 * The key is the project path as a TOML quoted key. Separators and a trailing
 * separator are always normalized, since `{ws}` and `{ws}\` name the same
 * directory. Case is folded only where the filesystem is case-insensitive —
 * Codex writes the path LOWERCASED on Windows (`C:\Users\abdal` is stored as
 * `c:\users\abdal`), so Windows must fold or nothing ever matches, while ext4
 * must not or trust granted to a sibling directory would be read as this one's.
 * See `defaultCaseInsensitive`.
 *
 * The directory itself is `$CODEX_HOME` when set, `~/.codex` otherwise, and
 * `codex-home.ts` is the one place that decides.
 *
 * ## What this is NOT
 *
 * It never WRITES a trust entry. Trust grants Codex the right to run commands
 * in a directory; recording that on the user's behalf, to make Ptah's own
 * registration land, would be Ptah answering a security question that was
 * asked of the user. Codex prompts for it on first use, and this reader simply
 * observes the answer.
 *
 * ## Why a scanner rather than a TOML parser
 *
 * Same reason as `CodexTomlMcpFacet`: no TOML library in this repo's dependency
 * tree, and the question is narrow enough that a line scanner answers it
 * exactly. Anything it cannot interpret reads as "not trusted", which is the
 * safe direction — it costs a home-scoped entry that works, never a
 * workspace-scoped one that is silently ignored.
 */

import { existsSync, readFileSync } from 'fs';
import { codexHomeConfigFile, type CodexHomeOptions } from './codex-home';

export interface CodexTrustOptions extends CodexHomeOptions {
  /**
   * Whether the filesystem holding these paths treats case as insignificant.
   *
   * Defaults to `win32` and `darwin` — see {@link defaultCaseInsensitive}. It
   * is an option rather than a bare `process.platform` read so a spec can
   * exercise all three behaviours on one CI host.
   */
  caseInsensitive?: boolean;
}

/**
 * Whether to fold case when comparing paths, by platform.
 *
 * **This must not be unconditional, and an earlier version of this file had it
 * that way.** The two errors are not symmetrical:
 *
 * - A false `trusted` makes the caller write `{ws}/.codex/config.toml`, which
 *   Codex then ignores in silence. The user gets no Ptah tools.
 * - A false `untrusted` makes the caller write `~/.codex/config.toml`, which
 *   Codex reads unconditionally. The user gets working tools at a wider scope.
 *
 * So case may only be folded where folding CANNOT invent a match. On a
 * case-insensitive filesystem `/a/App` and `/a/app` are the same directory, so
 * folding is not a guess — it is the truth. On ext4 they are two directories,
 * and folding would claim trust that was granted to a sibling.
 *
 * Windows must fold, because Codex LOWERCASES what it records
 * (`C:\Users\abdal` is stored as `c:\users\abdal`), so an exact comparison
 * would report every Windows project untrusted. macOS folds because APFS and
 * HFS+ are case-insensitive by default; on a case-sensitive macOS volume — rare,
 * and rarer still with two sibling directories differing only in case — this
 * can over-match, and the option exists to turn it off. Linux and everything
 * else compare exactly.
 */
function defaultCaseInsensitive(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

/** The one `trust_level` value that makes Codex read a project's config. */
const TRUSTED = 'trusted';

/**
 * True when Codex's home config records `trust_level = "trusted"` for this
 * exact project path.
 *
 * Absent config, unreadable config, missing table or any other `trust_level`
 * all read as `false`.
 */
export function codexProjectTrusted(
  workspaceRoot: string,
  options: CodexTrustOptions = {},
): boolean {
  if (workspaceRoot === '') return false;

  const configPath = codexHomeConfigFile(options);
  if (!existsSync(configPath)) return false;

  let content = '';
  try {
    content = readFileSync(configPath, 'utf-8');
  } catch {
    // Unreadable reads as untrusted: the safe direction, since the caller then
    // writes the home config, which Codex reads unconditionally.
    return false;
  }

  return trustLevelFor(content, workspaceRoot, options) === TRUSTED;
}

/**
 * The `trust_level` recorded for `workspaceRoot`, or `null` when the project
 * has no table.
 *
 * Exported for the spec, which needs to tell "no entry" from "an entry saying
 * something other than trusted" — the caller only needs the boolean.
 */
export function trustLevelFor(
  content: string,
  workspaceRoot: string,
  options: CodexTrustOptions = {},
): string | null {
  const fold = options.caseInsensitive ?? defaultCaseInsensitive();
  const wanted = normalizePath(workspaceRoot, fold);
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const project = projectTableKey(lines[i]);
    if (project === null || normalizePath(project, fold) !== wanted) continue;

    // Scan this table's body only. The next table header ends it, which is
    // what stops a `trust_level` belonging to a LATER project being read as
    // this one's.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (line.startsWith('[')) break;
      const value = trustLevelValue(line);
      if (value !== null) return value;
    }
    return null;
  }
  return null;
}

/**
 * The project path out of `[projects.'<path>']`, or `null` for any other line.
 *
 * Both TOML quoted-key spellings are accepted. Codex writes the single-quoted
 * literal form (a Windows path is full of backslashes, which a basic string
 * would have to escape), but a hand-edited config may use either.
 */
function projectTableKey(line: string): string | null {
  const trimmed = line.trim();
  const match = /^\[projects\.(?:'([^']*)'|"([^"]*)")\]$/.exec(trimmed);
  if (match === null) return null;
  return match[1] ?? match[2] ?? null;
}

/** The value of a `trust_level = "..."` line, or `null`. */
function trustLevelValue(line: string): string | null {
  const match = /^trust_level\s*=\s*(?:'([^']*)'|"([^"]*)")/.exec(line);
  if (match === null) return null;
  return match[1] ?? match[2] ?? null;
}

/**
 * Compare paths the way the two sides spell them differently.
 *
 * Separators and a trailing separator are normalized ALWAYS: `{ws}` and `{ws}/`
 * name the same directory everywhere, and a Windows config may hold either
 * slash while a POSIX path can only hold one — so neither collapse can invent a
 * match. Case folding is conditional, and {@link defaultCaseInsensitive}
 * explains why that asymmetry matters.
 *
 * A POSIX path containing a literal backslash is a legal filename, and
 * collapsing it here would be wrong in principle. It is accepted in practice:
 * both sides of this comparison are directory paths a user opened in an editor
 * and in Codex, and the alternative — a per-platform separator rule — would
 * break the Windows config that genuinely mixes both spellings.
 */
function normalizePath(value: string, caseInsensitive: boolean): string {
  const normalized = value.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}
