/**
 * The one Codex `features` key an MCP registration is worthless without.
 *
 * Codex connects to a registered server and then HIDES its tools. Measured on
 * codex-cli 0.150.1: with only `[mcp_servers.ptah]` set, `rmcp` logs
 * `Service initialized as client … server_info: Implementation { name: "ptah" }`
 * — the handshake succeeds — and a session asked to list the `ptah` tools
 * answers NONE, then does the whole task with shell commands. The cause is the
 * `ToolSearchAlwaysDeferMcpTools` feature: MCP tools stay out of the model's
 * tool list until the model runs a tool search, which it has no reason to do.
 * `CodexCliAdapter` already sends `features.tool_search_always_defer_mcp_tools`
 * in-process for threads Ptah spawns; a session the USER starts reads the
 * config file instead, so the same key has to land there.
 *
 * **This is a `features` key, not an `mcp_servers` table, so it is deliberately
 * NOT part of `CodexTomlMcpFacet`.** That facet's contract is one server entry
 * per fenced block, and every consumer of `IHarnessMcpFacet` reads it that way.
 * Widening it to carry an unrelated top-level table would make `readAll` and
 * `foreignServerKeys` answer for something that is not a server.
 *
 * ## Why this cannot simply append `[features]`
 *
 * TOML permits a table header exactly once. A config that already declares
 * `[features]` — the common case, since Codex writes it itself — would be left
 * with two, and the whole file then fails to parse. That is not a degraded
 * harness; it is a broken Codex. So the write MERGES into an existing table and
 * only appends a fenced block when no `[features]` table exists at all.
 *
 * ## Ownership
 *
 * A line Ptah wrote carries a `# ptah:managed` trailing comment, which is what
 * makes removal precise. A `tool_search_always_defer_mcp_tools` line WITHOUT
 * that marker is the user's own setting and is never touched, never overwritten
 * and never removed — reported back as `user-owned` so a caller can say so
 * instead of silently disagreeing with the file.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { atomicWriteWithRetry } from '../../fs/atomic-write';
import { withMcpConfigLock } from './mcp-config-lock';

/** The Codex feature key that decides whether MCP tools reach the model. */
export const CODEX_TOOL_SEARCH_FLAG = 'tool_search_always_defer_mcp_tools';

/** Trailing comment marking the one line in `[features]` that Ptah owns. */
const MANAGED_MARKER = '# ptah:managed';

const FEATURES_HEADER = '[features]';
const FEATURES_BEGIN = '# ptah:begin features';
const FEATURES_END = '# ptah:end features';

export interface CodexToolSearchFlagOptions {
  /** Overridable so specs never touch the developer's own `~/.codex`. */
  homeDir?: string;
}

/**
 * What a write did.
 *
 * `user-owned` is a success, not a failure: the key is already declared by the
 * user, and honouring their value is the correct outcome. It is distinct from
 * `unchanged` because only one of the two means Ptah's registration will work.
 */
export type CodexToolSearchFlagOutcome = 'written' | 'unchanged' | 'user-owned';

/**
 * Absolute path of the HOME config.
 *
 * A convenience for callers that want that scope specifically. Codex has TWO
 * config files and the flag has to land in the same one as the server entry it
 * accompanies, so the functions below take a PATH rather than resolving one —
 * see `CodexTomlMcpFacetOptions.scope`.
 */
export function codexConfigPath(
  options: CodexToolSearchFlagOptions = {},
): string {
  return join(options.homeDir ?? homedir(), '.codex', 'config.toml');
}

/**
 * Declare `tool_search_always_defer_mcp_tools = false` so MCP tools reach the
 * model from turn one.
 *
 * Runs inside {@link withMcpConfigLock} on the path given, which must be the
 * one `CodexTomlMcpFacet` writes the server entry to — a server write and a
 * feature write on one file must not interleave into a lost update, and the
 * lock is keyed by the file.
 *
 * **Measured caveat (codex-cli 0.150.1).** `codex features list` reports this
 * flag with stage `removed` and effective state `true`, and neither
 * `-c features.tool_search_always_defer_mcp_tools=false`, nor
 * `--disable tool_search_always_defer_mcp_tools`, nor the key in a config file
 * moved it. The key is still what `CodexCliAdapter` sends in-process, and
 * writing it is fenced and reversible, so it stays — but do not assume it is
 * what makes `ptah_*` tools appear. Re-measure before relying on it.
 */
export function enableCodexMcpToolSearch(
  configPath: string,
): Promise<CodexToolSearchFlagOutcome> {
  return withMcpConfigLock(configPath, () => {
    const original = readConfig(configPath);
    const result = applyFlag(original);
    if (result.outcome === 'written') {
      atomicWriteWithRetry(configPath, result.content);
    }
    return Promise.resolve(result.outcome);
  });
}

/**
 * Give the key back.
 *
 * Removes ONLY what {@link enableCodexMcpToolSearch} wrote — the fenced block,
 * or the single line carrying {@link MANAGED_MARKER}. A user-authored line is
 * left exactly where it is, which is the same rule the MCP facets follow for a
 * server key they do not own.
 */
export function clearCodexMcpToolSearch(configPath: string): Promise<void> {
  return withMcpConfigLock(configPath, () => {
    if (!existsSync(configPath)) return Promise.resolve();
    const original = readConfig(configPath);
    const cleared = removeFlag(original);
    if (cleared !== null) {
      atomicWriteWithRetry(configPath, cleared);
    }
    return Promise.resolve();
  });
}

/** File contents plus the line ending it uses, so a rewrite preserves it. */
interface ConfigText {
  lines: string[];
  eol: string;
  existed: boolean;
}

function readConfig(path: string): ConfigText {
  if (!existsSync(path)) return { lines: [], eol: '\n', existed: false };
  let raw = '';
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    // Unreadable reads as absent. The caller's write then either succeeds or
    // fails loudly; guessing at contents we could not read would be worse.
    return { lines: [], eol: '\n', existed: false };
  }
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { lines: raw.split(/\r?\n/), eol, existed: true };
}

function join_(text: ConfigText, lines: string[]): string {
  return lines.join(text.eol);
}

/** True for a line that opens any TOML table, e.g. `[features]`. */
function isTableHeader(line: string): boolean {
  return line.trim().startsWith('[');
}

/** Index of the `[features]` header, or -1. */
function featuresHeaderIndex(lines: string[]): number {
  return lines.findIndex((line) => line.trim() === FEATURES_HEADER);
}

/**
 * True when the file declares `features` as a root-level dotted key before any
 * table opens.
 *
 * `features.js_repl = false` at the top of the file and a later `[features]`
 * table are the same TOML conflict as two `[features]` headers, so a file
 * shaped that way is one Ptah must not add a table to.
 */
function hasRootDottedFeatures(lines: string[]): boolean {
  for (const line of lines) {
    const trimmed = line.trim();
    if (isTableHeader(trimmed)) return false;
    if (/^features\s*\./.test(trimmed)) return true;
  }
  return false;
}

/** Index of the flag line inside the table starting at `headerIndex`, or -1. */
function flagLineIndex(lines: string[], headerIndex: number): number {
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (isTableHeader(lines[i])) return -1;
    if (new RegExp(`^${CODEX_TOOL_SEARCH_FLAG}\\s*=`).test(lines[i].trim())) {
      return i;
    }
  }
  return -1;
}

/** The assigned value, with any trailing comment stripped. */
function assignedValue(line: string): string {
  const rhs = line.slice(line.indexOf('=') + 1);
  const hash = rhs.indexOf('#');
  return (hash === -1 ? rhs : rhs.slice(0, hash)).trim();
}

function managedLine(): string {
  return `${CODEX_TOOL_SEARCH_FLAG} = false ${MANAGED_MARKER}`;
}

interface ApplyResult {
  outcome: CodexToolSearchFlagOutcome;
  content: string;
}

function applyFlag(text: ConfigText): ApplyResult {
  const lines = [...text.lines];
  const headerIndex = featuresHeaderIndex(lines);

  if (headerIndex === -1) {
    if (hasRootDottedFeatures(lines)) {
      // A root-level `features.*` key already defines the table. Adding a
      // `[features]` header beside it is the same TOML error as a duplicate
      // header, and rewriting the user's dotted keys is not this module's job.
      return { outcome: 'user-owned', content: join_(text, lines) };
    }
    return {
      outcome: 'written',
      content: join_(text, appendFencedBlock(lines, text.existed)),
    };
  }

  const existing = flagLineIndex(lines, headerIndex);
  if (existing === -1) {
    lines.splice(headerIndex + 1, 0, managedLine());
    return { outcome: 'written', content: join_(text, lines) };
  }
  if (!lines[existing].includes(MANAGED_MARKER)) {
    return { outcome: 'user-owned', content: join_(text, lines) };
  }
  if (assignedValue(lines[existing]) === 'false') {
    return { outcome: 'unchanged', content: join_(text, lines) };
  }
  lines[existing] = managedLine();
  return { outcome: 'written', content: join_(text, lines) };
}

/**
 * Append a fenced `[features]` block, keeping exactly one blank line between it
 * and whatever came before.
 *
 * The fence is the same `# ptah:begin` / `# ptah:end` convention
 * `CodexTomlMcpFacet` uses for a server table, so a user reading the file sees
 * one idiom rather than two.
 */
function appendFencedBlock(lines: string[], fileExisted: boolean): string[] {
  const body = [...lines];
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  if (fileExisted && body.length > 0) body.push('');
  body.push(
    FEATURES_BEGIN,
    FEATURES_HEADER,
    `${CODEX_TOOL_SEARCH_FLAG} = false`,
    FEATURES_END,
  );
  body.push('');
  return body;
}

/** The file with Ptah's flag removed, or `null` when there was nothing to remove. */
function removeFlag(text: ConfigText): string | null {
  const begin = text.lines.findIndex((line) => line.trim() === FEATURES_BEGIN);
  if (begin !== -1) {
    const end = text.lines.findIndex(
      (line, index) => index > begin && line.trim() === FEATURES_END,
    );
    if (end === -1) return null;
    const lines = [...text.lines];
    lines.splice(begin, end - begin + 1);
    // The blank line the block was separated by is ours too.
    if (
      begin > 0 &&
      lines[begin - 1]?.trim() === '' &&
      lines[begin]?.trim() === ''
    ) {
      lines.splice(begin - 1, 1);
    }
    return join_(text, lines);
  }

  const headerIndex = featuresHeaderIndex(text.lines);
  if (headerIndex === -1) return null;
  const existing = flagLineIndex(text.lines, headerIndex);
  if (existing === -1 || !text.lines[existing].includes(MANAGED_MARKER)) {
    return null;
  }
  const lines = [...text.lines];
  lines.splice(existing, 1);
  return join_(text, lines);
}
