/**
 * `~/.claude.json` — the Claude Code CLI's own state file, read ONLY.
 *
 * This is not a harness facet and must never become one. Every file in
 * `mcp-facet.registry.ts` is one the reconciler WRITES, under a manifest that
 * proves Ptah owns each key; `~/.claude.json` is written by the `claude` CLI
 * and carries far more than MCP servers (history, project trust, onboarding
 * state). A reconciler with a facet on it would eventually rewrite a file whose
 * schema Ptah does not own. So this reader lives beside the install surface
 * that needs it, exposes no `write`, and every row it produces is
 * `removal: 'none'`.
 *
 * ## Two scopes, and why the project one is not optional
 *
 * `claude mcp add --scope user` writes a TOP-LEVEL `mcpServers` map; the
 * default scope writes `projects["<workspace>"].mcpServers`. Measured on this
 * machine: there is no top-level map at all, and `sentry` and `sonarqube` live
 * under the project entry. A reader that looked only at the top level would
 * report zero servers on a machine running two.
 *
 * ## The duplicate project key
 *
 * The same file holds TWO project entries for this repository that differ only
 * in drive-letter case (`D:/projects/ptah-extension` and
 * `d:/projects/ptah-extension`). They are distinct JSON keys, so both survive
 * the parse and either can hold servers. Case is therefore folded on `win32`
 * and `darwin` only, following `codexProjectTrusted`'s rule exactly and for its
 * reason: on a case-sensitive filesystem `/a/App` and `/a/app` are two
 * directories, and folding there would report another project's servers as this
 * one's.
 *
 * Every folded-matching entry is read, not just the first. On Windows they name
 * ONE directory, so a server the user added under one spelling is running for
 * this workspace whichever key it landed under; picking a spelling would hide
 * it and which one wins would depend on JSON property order.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { jsonToConfig } from '@ptah-extension/harness-sync';
import type { McpServerConfig } from '@ptah-extension/shared';

/** Which of the file's two maps an entry came from. */
export type ClaudeUserMcpScope = 'user' | 'project';

/** One MCP server declared in `~/.claude.json`. */
export interface ClaudeUserMcpEntry {
  serverKey: string;
  config: McpServerConfig;
  scope: ClaudeUserMcpScope;
  /** Absolute path of `~/.claude.json` — the same value for every entry. */
  configPath: string;
}

export interface ClaudeUserMcpReaderOptions {
  /** Overridable so a spec never reaches the developer's real home. */
  homeDir?: string;
  /**
   * Whether to fold case when matching the project key. Defaults to `win32`
   * and `darwin`; see the file header for why it is not unconditional.
   */
  caseInsensitive?: boolean;
}

/** Absolute path of the Claude CLI state file. */
export function claudeUserConfigPath(homeDir: string = homedir()): string {
  return join(homeDir, '.claude.json');
}

/**
 * Every MCP server `~/.claude.json` declares for this workspace, user scope and
 * project scope alike.
 *
 * Never throws. A missing, unreadable or unparseable file — and any shape that
 * is not the one documented above — yields an empty list, because this is a
 * read of somebody else's file on a display path and a malformed one must not
 * take the whole Installed tab down with it.
 */
export function readClaudeUserMcpServers(
  workspaceRoot: string | undefined,
  options: ClaudeUserMcpReaderOptions = {},
): ClaudeUserMcpEntry[] {
  const configPath = claudeUserConfigPath(options.homeDir);
  const parsed = readJsonObject(configPath);
  if (parsed === null) return [];

  // A project entry wins over a user entry for the same key, matching how the
  // CLI resolves the two scopes.
  const byKey = new Map<string, ClaudeUserMcpEntry>();

  for (const entry of readServerMap(parsed['mcpServers'], 'user', configPath)) {
    byKey.set(entry.serverKey, entry);
  }

  for (const map of projectServerMaps(
    parsed['projects'],
    workspaceRoot,
    options,
  )) {
    for (const entry of readServerMap(map, 'project', configPath)) {
      byKey.set(entry.serverKey, entry);
    }
  }

  return [...byKey.values()];
}

/** Every `mcpServers` map recorded for this workspace, in file order. */
function projectServerMaps(
  projects: unknown,
  workspaceRoot: string | undefined,
  options: ClaudeUserMcpReaderOptions,
): unknown[] {
  if (workspaceRoot === undefined || workspaceRoot === '') return [];
  if (!isPlainObject(projects)) return [];

  const fold = options.caseInsensitive ?? defaultCaseInsensitive();
  const wanted = normalizePath(workspaceRoot, fold);
  const maps: unknown[] = [];

  for (const [key, value] of Object.entries(projects)) {
    if (normalizePath(key, fold) !== wanted) continue;
    if (!isPlainObject(value)) continue;
    maps.push(value['mcpServers']);
  }
  return maps;
}

/** Parse one `mcpServers` map into entries, skipping anything unusable. */
function readServerMap(
  raw: unknown,
  scope: ClaudeUserMcpScope,
  configPath: string,
): ClaudeUserMcpEntry[] {
  if (!isPlainObject(raw)) return [];
  const entries: ClaudeUserMcpEntry[] = [];
  for (const [serverKey, value] of Object.entries(raw)) {
    if (serverKey === '' || !isPlainObject(value)) continue;
    entries.push({
      serverKey,
      // The same parser every facet uses, so a hand-written entry reads back
      // exactly as it would from `.mcp.json`.
      config: jsonToConfig(value),
      scope,
      configPath,
    });
  }
  return entries;
}

/** The parsed file as an object, or `null` for absent / unreadable / invalid. */
function readJsonObject(configPath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(configPath)) return null;
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf-8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    // Deliberately silent and unbound, exactly as the manifest stores' `load()`
    // is: the caller is a display list, the file belongs to another tool, and
    // "Claude's config is malformed" is not this surface's error to raise.
    return null;
  }
}

/**
 * Whether to fold case when comparing project paths, by platform. Same rule and
 * same reason as `codexProjectTrusted`'s: folding is the truth on a
 * case-insensitive filesystem and an invented match on ext4.
 */
function defaultCaseInsensitive(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

/** Separator + trailing-separator collapse always; case folding conditionally. */
function normalizePath(value: string, caseInsensitive: boolean): string {
  const normalized = value.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
