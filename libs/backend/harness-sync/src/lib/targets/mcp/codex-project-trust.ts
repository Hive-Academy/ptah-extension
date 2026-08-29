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
 * The key is the project path as a TOML quoted key. Codex writes it LOWERCASED
 * on Windows while a workspace root arrives as `D:\projects\...`, so the
 * comparison normalizes case and separators. Trailing separators are stripped
 * too, since `{ws}` and `{ws}\` name the same directory.
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
import { homedir } from 'os';
import { join } from 'path';

export interface CodexTrustOptions {
  /** Overridable so specs never read the developer's own `~/.codex`. */
  homeDir?: string;
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

  const configPath = join(
    options.homeDir ?? homedir(),
    '.codex',
    'config.toml',
  );
  if (!existsSync(configPath)) return false;

  let content = '';
  try {
    content = readFileSync(configPath, 'utf-8');
  } catch {
    // Unreadable reads as untrusted: the safe direction, since the caller then
    // writes the home config, which Codex reads unconditionally.
    return false;
  }

  return trustLevelFor(content, workspaceRoot) === TRUSTED;
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
): string | null {
  const wanted = normalizePath(workspaceRoot);
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const project = projectTableKey(lines[i]);
    if (project === null || normalizePath(project) !== wanted) continue;

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
 * Codex records a lowercased path with backslashes; a workspace root arrives
 * with its original case. Case folding is unconditional rather than win32-only
 * because the values being compared both came from Codex's own vocabulary — a
 * POSIX path that differs only in case is not a case this reader can create.
 */
function normalizePath(value: string): string {
  return value
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}
