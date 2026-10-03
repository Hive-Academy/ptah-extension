/**
 * The names of the MCP servers a Codex lane would load from the user's own
 * config, so the lane config can switch each one off (TASK_2026_597, R3.1).
 *
 * Read-only. The files are the ones Codex itself merges:
 *
 * - the home `config.toml` (`$CODEX_HOME`, else `~/.codex`), always;
 * - a project `.codex/config.toml` in each "layer" directory, only when Codex
 *   trusts that layer. Codex ignores an untrusted layer in silence, and so must
 *   this reader.
 *
 * The home path, the per-directory config path and the exact-path trust lookup
 * come from `harness-sync`, which owns them. The only name this file adds is
 * `.git`, Codex's default project-root marker (see the custom-marker rule
 * below).
 *
 * ## Which project layers Codex reads (probe, codex-cli 0.155.1)
 *
 * Measured offline with the bundled binary: `codex mcp list --json` from Git
 * Bash, a scratch `CODEX_HOME`, no model call. Trust keys were written the way
 * Codex writes them (lowercased Windows paths).
 *
 * | Trust entry | cwd | `.codex/config.toml` files loaded |
 * | --- | --- | --- |
 * | repo root R | R | R |
 * | repo root R | R/sub, R/sub/deeper | R, R/sub (every layer from R down to cwd) |
 * | repo root R | git worktree W of R | W |
 * | worktree W only (R untrusted) | W | W |
 * | R/sub only (R untrusted) | R/sub | R/sub (not R) |
 * | R/sub only | R/sub/deeper | R/sub (not R, not deeper) |
 * | none | R/sub, worktree of R | none |
 * | non-git dir P | P | P |
 * | non-git dir P | P/sub, P/c | none (no walk-up without `.git`) |
 *
 * The rule that fits every row, and the one implemented here:
 *
 * - Layers are the directories from the git root down to the working
 *   directory. The git root is the nearest ancestor holding a `.git` entry,
 *   either a directory or a worktree's file. With no `.git` the only layer is
 *   the working directory itself.
 * - A layer is read when Codex trusts the layer path exactly, OR the git root,
 *   OR, for a worktree, the main repository root reached through the `.git` file
 *   and the git directory's `commondir`. No git process is run.
 *
 * Anything this reader cannot resolve with certainty counts as untrusted.
 * Examples: a `.git` file it cannot follow, or a submodule (no `commondir`).
 * That is the safe direction. Over-reporting trust would disable a server
 * Codex never loaded, and that fails the whole config (next section).
 *
 * The rule holds only for Codex's default `project_root_markers = [".git"]`.
 * A custom marker list is NOT a safe case. With `[".codex"]`, Codex stops
 * trusting layers through the git root. The `.git` rule above would then claim
 * trust Codex does not grant, and the resulting disables fail the config
 * (reproduced in review round 2). So when the home config sets a top-level
 * `project_root_markers` that is anything other than exactly `[".git"]`, the
 * reader reads NO workspace layer and returns a warning that names the
 * setting. Workspace servers then stay enabled in the lane, visibly.
 *
 * ## Symlinks and junctions (probe, codex-cli 0.155.1)
 *
 * Same probe setup, with a Windows junction J pointing at repo R:
 *
 * | Trust entry | cwd | Loaded |
 * | --- | --- | --- |
 * | real R | J/sub | R, R/sub |
 * | real R | J | R |
 * | real R/sub | J/sub | R/sub |
 * | link J | J, J/sub, real R/sub | none |
 * | link J/sub | J/sub | none |
 *
 * So Codex canonicalises the working directory and compares the REAL path
 * with the trust keys as written. A key that names a link never matches. The
 * reader therefore resolves the working directory, and a worktree's main
 * root, with `realpathSync.native` before the walk and before every trust
 * comparison. Every ancestor of a real path is itself real, so the layers and
 * the git root need no second resolution. A path that cannot be resolved
 * counts as untrusted and gets a warning.
 *
 * ## Why a name is left out rather than guessed
 *
 * Measured on the bundled codex-cli 0.155.1: an override that disables a server
 * Codex did NOT load (`mcp_servers={"zzz"={enabled=false}}`) fails the whole
 * config with `invalid transport in mcp_servers.zzz`, and the lane never
 * starts. A name read wrongly is therefore worse than a name not read at all.
 * So the reader returns only names it is sure of:
 *
 * - a bare table name (`[mcp_servers.foo]`);
 * - a quoted one whose quotes `parseMcpServerTables` left intact
 *   (`[mcp_servers."x y"]`), unquoted here.
 *
 * Anything else is skipped with a warning. Notably, the scanner splits a quoted
 * name that contains a dot at the dot. The reader also warns on every
 * `mcp_servers` declaration line the scanner did not report: a header with a
 * trailing comment, odd spacing, an array of tables, a bare `[mcp_servers]`
 * table, or a top-level `mcp_servers` key. Each of those servers keeps loading
 * in the lane, and the warning makes it visible instead of silent. The lane
 * still starts with `features.plugins=false`, so plugin-provided servers are
 * gone either way.
 *
 * An unreadable file gives no names from that file and one warning. It never
 * throws: a lane must not fail to start because a user config is odd.
 */

import { readFileSync, realpathSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import {
  CodexTomlMcpFacet,
  codexProjectTrusted,
  parseMcpServerTables,
  type CodexTrustOptions,
} from '@ptah-extension/harness-sync';

/** Ptah's own server key. The lane config sets it; it is never disabled. */
const PTAH_SERVER_NAME = 'ptah';

/**
 * The project-root marker Codex walks up to by default. A custom
 * `project_root_markers` disables layer reading entirely (file header).
 */
const GIT_ENTRY = '.git';

/** A TOML bare key: the only unquoted table name the reader accepts. */
const BARE_NAME_RE = /^[A-Za-z0-9_-]+$/;

/** What the scanner recognises: `[mcp_servers.<something>]`, nothing else. */
const SCANNED_HEADER_RE = /^\[mcp_servers\.[^\]]+\]$/;

/** Any table header line (`[x]` or `[[x]]`) that mentions `mcp_servers`. */
const MCP_HEADER_LIKE_RE = /^\[\[?\s*["']?mcp_servers\b/;

/** A top-level `mcp_servers = {...}` or `mcp_servers.<x>... = ...` line. */
const MCP_KEY_LIKE_RE = /^["']?mcp_servers["']?\s*[.=]/;

/** A top-level `project_root_markers = <value>` line (bare or quoted key). */
const ROOT_MARKERS_KEY_RE = /^["']?project_root_markers["']?\s*=\s*(.*)$/;

/** Exactly Codex's default `[".git"]`, optionally followed by a comment. */
const DEFAULT_ROOT_MARKERS_RE =
  /^\[\s*(?:"\.git"|'\.git')\s*,?\s*\]\s*(?:#.*)?$/;

/** Longest excerpt of a config line quoted in a warning. */
const LINE_EXCERPT_MAX = 120;

export interface CodexUserMcpServerNames {
  /** Distinct server names, sorted, `ptah` excluded. */
  names: string[];
  /** One line per file, name or declaration that could not be read. */
  warnings: string[];
}

/**
 * Read the user MCP server names Codex would load for a lane spawned in
 * `workspaceRoot`. `options` exists for specs (`homeDir`, `codexHome`,
 * `caseInsensitive`); hosts pass nothing.
 */
export async function readCodexUserMcpServerNames(
  workspaceRoot: string,
  options: CodexTrustOptions = {},
): Promise<CodexUserMcpServerNames> {
  const names = new Set<string>();
  const warnings: string[] = [];

  const homePath = new CodexTomlMcpFacet({
    ...options,
    scope: 'home',
  }).configPath('');
  const homeText =
    homePath === null
      ? null
      : await collectFrom(homePath, 'home Codex config', names, warnings);

  const customMarkers =
    homeText === null ? null : customRootMarkersLine(homeText);
  if (customMarkers !== null && workspaceRoot !== '') {
    warnings.push(
      `The home Codex config at ${homePath ?? ''} sets project_root_markers ("${excerpt(customMarkers)}"), so the reader cannot tell which project layers Codex trusts; workspace MCP servers stay enabled in the lane.`,
    );
  } else if (workspaceRoot !== '') {
    const workspaceFacet = new CodexTomlMcpFacet({
      ...options,
      scope: 'workspace',
    });
    for (const layer of trustedProjectLayers(
      workspaceRoot,
      options,
      warnings,
    )) {
      const path = workspaceFacet.configPath(layer);
      if (path !== null) {
        await collectFrom(path, 'workspace Codex config', names, warnings);
      }
    }
  }

  return { names: [...names].sort(compareCodeUnits), warnings };
}

/**
 * The project layer directories Codex reads for `workspaceRoot`, in order from
 * the git root down, keeping only the trusted ones (rule in the file header).
 */
function trustedProjectLayers(
  workspaceRoot: string,
  options: CodexTrustOptions,
  warnings: string[],
): string[] {
  // Codex compares the CANONICAL working directory with the trust keys
  // (header probe), so the walk and every comparison run on the real path.
  // Every ancestor of a real path is itself real, so the layers and the git
  // root need no second resolution.
  const start = realPathOrWarn(
    resolve(workspaceRoot),
    'the lane working directory',
    warnings,
  );
  if (start === null) return [];
  const gitRoot = findGitRoot(start);
  if (gitRoot === null) {
    return codexProjectTrusted(start, options) ? [start] : [];
  }

  const layers: string[] = [];
  for (let dir = start; ; dir = dirname(dir)) {
    layers.unshift(dir);
    if (dir === gitRoot) break;
  }

  const roots = [gitRoot];
  const pointedMainRoot = worktreeMainRoot(gitRoot);
  const mainRoot =
    pointedMainRoot === null
      ? null
      : realPathOrWarn(
          pointedMainRoot,
          'the main repository root of this worktree',
          warnings,
        );
  if (mainRoot !== null) roots.push(mainRoot);
  const rootTrusted = roots.some((root) => codexProjectTrusted(root, options));

  return layers.filter(
    (layer) => rootTrusted || codexProjectTrusted(layer, options),
  );
}

/**
 * `path` with every symlink and junction resolved, or `null` plus a warning
 * when it cannot be resolved. An unresolvable path counts as untrusted, because
 * the reader cannot know which path Codex would compare.
 */
function realPathOrWarn(
  path: string,
  what: string,
  warnings: string[],
): string | null {
  try {
    return realpathSync.native(path);
  } catch (error) {
    // degradation-audit: optional-capability - an unresolvable path is read as
    // untrusted (no workspace disables); the warning makes the gap visible.
    warnings.push(
      `Could not resolve ${what} (${path}: ${describe(error)}); its workspace MCP servers stay enabled in the lane.`,
    );
    return null;
  }
}

/** The nearest directory at or above `start` holding a `.git` entry. */
function findGitRoot(start: string): string | null {
  for (let dir = start; ;) {
    if (entryExists(join(dir, GIT_ENTRY))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * For a git worktree, the main repository's root; otherwise `null`.
 *
 * A worktree's `.git` is a file, `gitdir: <main>/.git/worktrees/<name>`, and
 * that directory's `commondir` names the shared `<main>/.git`. A `.git` file
 * with no `commondir` (a submodule) or anything unreadable gives `null`: the
 * reader then trusts less, never more.
 */
function worktreeMainRoot(gitRoot: string): string | null {
  const marker = join(gitRoot, GIT_ENTRY);
  try {
    if (!statSync(marker).isFile()) return null;
    const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(marker, 'utf-8'));
    if (pointer === null) return null;
    const gitDir = resolve(gitRoot, pointer[1].trim());
    const common = resolve(
      gitDir,
      readFileSync(join(gitDir, 'commondir'), 'utf-8').trim(),
    );
    return basename(common) === GIT_ENTRY ? dirname(common) : null;
  } catch {
    // degradation-audit: optional-capability - a worktree pointer that cannot
    // be followed only loses the main-root trust path; untrusted is the safe
    // direction (see the file header).
    return null;
  }
}

function entryExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    // degradation-audit: optional-capability - a missing or unstattable `.git`
    // entry means "not a project root here"; the walk continues upward.
    return false;
  }
}

/**
 * The top-level `project_root_markers = ...` line when it is anything other
 * than exactly `[".git"]` (Codex's default), else `null`.
 *
 * With custom markers Codex stops trusting layers through the git root
 * (reproduced in review round 2: `[".codex"]` plus a lane in a subdirectory of
 * a trusted repo). The reader's layer rule would then claim trust Codex does
 * not grant, and disabling those servers fails the config. Any form this
 * cannot read as exactly `[".git"]` (a multi-line array, extra markers, an
 * empty list) counts as custom, which is the direction that reads fewer layers.
 */
function customRootMarkersLine(text: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Only top-level keys count; the first table header ends the top level.
    if (line.startsWith('[')) return null;
    const match = ROOT_MARKERS_KEY_RE.exec(line);
    if (match === null) continue;
    return DEFAULT_ROOT_MARKERS_RE.test(match[1].trim()) ? null : line;
  }
  return null;
}

/**
 * Read one config file and add its server names. Returns the file text, or
 * `null` when the file is missing or unreadable.
 */
async function collectFrom(
  path: string,
  label: string,
  names: Set<string>,
  warnings: string[],
): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch (error) {
    // degradation-audit: optional-capability - a missing user config declares
    // no servers, and an unreadable one yields no disables from this file plus
    // a warning that makes the gap visible; neither may stop the lane.
    if (errorCode(error) === 'ENOENT') return null;
    warnings.push(
      `Could not read the ${label} at ${path} (${describe(error)}); its MCP servers stay enabled in the lane.`,
    );
    return null;
  }

  for (const raw of parseMcpServerTables(text).keys()) {
    const name = serverName(raw);
    if (name === null) {
      warnings.push(
        `Skipped MCP server table "${raw}" in the ${label} at ${path}: its name could not be read exactly, so the lane does not disable it.`,
      );
      continue;
    }
    if (name !== PTAH_SERVER_NAME) names.add(name);
  }

  for (const line of unscannedDeclarations(text)) {
    warnings.push(
      `The ${label} at ${path} declares MCP servers on a line the reader cannot parse ("${excerpt(line)}"); those servers stay enabled in the lane.`,
    );
  }
  return text;
}

/**
 * Lines that declare MCP servers in a form `parseMcpServerTables` does not
 * report: header-looking lines it does not match, plus `mcp_servers` keys that
 * sit before any table header (top level). Lines inside a multi-line string
 * are not tracked, so the reader may warn too often but never too rarely for
 * a header line.
 */
function unscannedDeclarations(text: string): string[] {
  const found: string[] = [];
  let topLevel = true;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      topLevel = false;
      if (MCP_HEADER_LIKE_RE.test(line) && !SCANNED_HEADER_RE.test(line)) {
        found.push(line);
      }
      continue;
    }
    if (topLevel && MCP_KEY_LIKE_RE.test(line)) found.push(line);
  }
  return found;
}

/**
 * The exact server name for a table key as `parseMcpServerTables` reports it,
 * or `null` when the key cannot be trusted to be the name Codex uses.
 */
function serverName(raw: string): string | null {
  if (BARE_NAME_RE.test(raw)) return raw;
  const quote = raw.charAt(0);
  if (quote !== '"' && quote !== "'") return null;
  if (raw.length < 3 || raw.charAt(raw.length - 1) !== quote) return null;
  const inner = raw.slice(1, -1);
  // A quote or backslash inside means escapes or a split key; neither can be
  // reproduced with certainty from the scanner's output.
  if (/["'\\]/.test(inner)) return null;
  return inner;
}

function excerpt(line: string): string {
  return line.length <= LINE_EXCERPT_MAX
    ? line
    : `${line.slice(0, LINE_EXCERPT_MAX)}...`;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
