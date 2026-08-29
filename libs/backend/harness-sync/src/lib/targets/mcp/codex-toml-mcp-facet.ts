/**
 * The Codex MCP facet: `[mcp_servers.<name>]` tables in `~/.codex/config.toml`.
 *
 * Codex was the one CLI Ptah could spawn but never configure. It does not read
 * `.mcp.json`, so every server the marketplace "installed for codex" landed in
 * a file Codex ignores (defect 12).
 *
 * **Why marker blocks instead of a TOML round-trip.** `~/.codex/config.toml` is
 * a file the user owns and hand-edits: model preferences, sandbox policy,
 * profiles, comments explaining why. No TOML library in this repo's dependency
 * tree preserves comments, key order and formatting across a parse/serialize
 * cycle, so a round-trip would silently reformat the user's whole config the
 * first time Ptah installed one server. Instead every Ptah table is fenced:
 *
 *     # ptah:begin github
 *     [mcp_servers.github]
 *     command = "npx"
 *     # ptah:end github
 *
 * Writing replaces the bytes between one pair of markers and touches nothing
 * else; removing deletes them. Everything outside a fence is preserved
 * byte-for-byte, which is exactly what E18 asks for.
 *
 * Reading is a deliberately small scanner rather than a full TOML parser: it
 * needs to answer "which server names are declared, and what transport does
 * each use" for `listInstalled` and for foreign-entry detection. Values it
 * cannot interpret degrade to empty strings rather than throwing, because a
 * config it cannot fully parse must not make the whole reconcile fail.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type {
  HarnessTargetId,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';
import { atomicWriteWithRetry } from '../../fs/atomic-write';
import { withWindowsRetrySync } from '../../fs/windows-retry';
import { withMcpConfigLock } from './mcp-config-lock';
import type { IHarnessMcpFacet } from './mcp-facet.port';

const TABLE_PREFIX = 'mcp_servers.';

export function beginMarker(serverKey: string): string {
  return `# ptah:begin ${serverKey}`;
}

export function endMarker(serverKey: string): string {
  return `# ptah:end ${serverKey}`;
}

export interface CodexTomlMcpFacetOptions {
  /** Overridable so specs can point at a temp directory. */
  homeDir?: string;
  /**
   * Which of Codex's TWO config files this facet addresses. Defaults to
   * `'home'`, so every existing caller is unchanged.
   *
   * **Codex reads both, and MERGES them** — verified on codex-cli 0.150.1:
   * `codex mcp list` in a workspace holding `.codex/config.toml` printed that
   * file's server ALONGSIDE the home file's, and `codex doctor` went from
   * `MCP servers 1` to `2`. Its own documentation names both ("edit
   * `~/.codex/config.toml` or a project-scoped `.codex/config.toml`"); `codex
   * --help` and `codex doctor` mention only the home one, which is misleading.
   *
   * **A project-scoped file is honoured only for a TRUSTED project.** The same
   * probe in a fresh `git init` temp repo with no `[projects.'<path>']
   * trust_level = "trusted"` entry in the home config reported `MCP servers 1`
   * — the file was ignored, silently. Codex prompts for trust on first use, so
   * a workspace the user actually runs Codex in has it; a workspace they do not
   * is one where the entry costs nothing either way.
   *
   * Which scope to pick is a question about the SERVER, not about Codex: a
   * server the user INSTALLED is a machine-wide choice and belongs in `home`
   * (that is what the reconciler writes), while Ptah's own server is bound to
   * one workspace's Ptah process and belongs in `workspace` — which is also the
   * only scope that can be right when two Ptah windows are open on two folders,
   * since one home file holds one port.
   */
  scope?: 'home' | 'workspace';
}

export class CodexTomlMcpFacet implements IHarnessMcpFacet {
  readonly target: HarnessTargetId = 'codex';
  readonly mcpTarget: McpInstallTarget = 'codex';

  constructor(private readonly options: CodexTomlMcpFacetOptions = {}) {}

  private get scope(): 'home' | 'workspace' {
    return this.options.scope ?? 'home';
  }

  configRelPath(): string {
    return this.scope === 'home'
      ? '~/.codex/config.toml'
      : '.codex/config.toml';
  }

  configPath(workspaceRoot = ''): string | null {
    if (this.scope === 'home') {
      return join(this.options.homeDir ?? homedir(), '.codex', 'config.toml');
    }
    if (workspaceRoot === '') return null;
    return join(workspaceRoot, '.codex', 'config.toml');
  }

  readAll(workspaceRoot = ''): Map<string, McpServerConfig> {
    return parseMcpServerTables(this.readFile(workspaceRoot));
  }

  /** Server names declared OUTSIDE any Ptah marker block. */
  foreignServerKeys(workspaceRoot = ''): Set<string> {
    const content = this.readFile(workspaceRoot);
    const owned = new Set(ownedServerKeys(content));
    const foreign = new Set<string>();
    for (const key of parseMcpServerTables(
      stripAllOwnedBlocks(content),
    ).keys()) {
      if (!owned.has(key)) foreign.add(key);
    }
    return foreign;
  }

  /**
   * Read-modify-write under the config-file lock, like every other facet.
   *
   * `~/.codex/config.toml` has only one writer today, so the lock buys nothing
   * against a rival module — it buys the case two OPEN WORKSPACES already had:
   * this file is user-global while the workspace lock that guards a reconcile
   * is not, so two hosts could splice two different blocks over one snapshot.
   * One rule for all six MCP config files is also cheaper to keep true than an
   * exemption nobody can see from here (see `mcp-config-lock.ts`).
   */
  write(
    workspaceRoot: string,
    serverKey: string,
    config: McpServerConfig,
  ): Promise<void> {
    const path = this.configPath(workspaceRoot);
    if (path === null) {
      return Promise.reject(
        new Error('Workspace-scoped ~/.codex config needs an open workspace'),
      );
    }
    return withMcpConfigLock(path, () => {
      const content = this.readFile(workspaceRoot);
      if (this.foreignServerKeys(workspaceRoot).has(serverKey)) {
        // Two tables with the same name is a TOML parse error, which would take
        // Codex down entirely. Refusing is the only safe answer; the target has
        // already classified this key as foreign and will report it.
        return Promise.reject(
          new Error(
            `${this.configRelPath()} already declares [mcp_servers.${serverKey}] outside Ptah's block`,
          ),
        );
      }
      this.writeFile(
        workspaceRoot,
        spliceOwnedBlock(content, serverKey, renderBlock(serverKey, config)),
      );
      return Promise.resolve();
    });
  }

  remove(workspaceRoot: string, serverKey: string): Promise<void> {
    const path = this.configPath(workspaceRoot);
    if (path === null) return Promise.resolve();
    return withMcpConfigLock(path, () => {
      const content = this.readFile(workspaceRoot);
      const next = spliceOwnedBlock(content, serverKey, null);
      if (next !== content) this.writeFile(workspaceRoot, next);
      return Promise.resolve();
    });
  }

  private readFile(workspaceRoot = ''): string {
    const path = this.configPath(workspaceRoot);
    if (path === null) return '';
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * Back up, then write atomically with the Windows retry (`fs/atomic-write.ts`).
   *
   * The backup is best-effort and the write is not: a `.bak` we could not take
   * is no reason to refuse to configure Codex, but a config that silently failed
   * to land because a scanner held the file open is exactly the E21 failure this
   * lib exists to survive.
   */
  private writeFile(workspaceRoot: string, content: string): void {
    const path = this.configPath(workspaceRoot);
    if (path === null) return;
    try {
      if (existsSync(path)) {
        const previous = withWindowsRetrySync(() => readFileSync(path));
        atomicWriteWithRetry(`${path}.bak`, previous);
      }
    } catch {
      /* best effort — temp+rename below is what protects the real file */
    }
    atomicWriteWithRetry(path, content);
  }
}

// ------------------------------------------------------------------ rendering

/** Escape a value for a single-line TOML basic string. */
function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

/**
 * Render one fenced `[mcp_servers.<name>]` table.
 *
 * `env` and `headers` become sub-tables, which must come AFTER every scalar of
 * their parent table — in TOML a `[a.b]` header ends `[a]`, so a scalar written
 * below it would silently land in the sub-table.
 */
function renderBlock(serverKey: string, config: McpServerConfig): string {
  const lines = [beginMarker(serverKey), `[${TABLE_PREFIX}${serverKey}]`];

  if (config.type === 'stdio') {
    lines.push(`command = ${tomlString(config.command)}`);
    if (config.args !== undefined && config.args.length > 0) {
      lines.push(`args = ${tomlStringArray(config.args)}`);
    }
  } else {
    lines.push(`url = ${tomlString(config.url)}`);
  }

  if (config.type !== 'stdio') {
    const headers = config.headers;
    if (headers !== undefined && Object.keys(headers).length > 0) {
      lines.push('', `[${TABLE_PREFIX}${serverKey}.headers]`);
      for (const key of Object.keys(headers).sort()) {
        lines.push(`${key} = ${tomlString(headers[key])}`);
      }
    }
  }

  const env = config.env;
  if (env !== undefined && Object.keys(env).length > 0) {
    lines.push('', `[${TABLE_PREFIX}${serverKey}.env]`);
    for (const key of Object.keys(env).sort()) {
      lines.push(`${key} = ${tomlString(env[key])}`);
    }
  }

  lines.push(endMarker(serverKey));
  return lines.join('\n');
}

// -------------------------------------------------------------------- splicing

/** Server names that currently sit inside a Ptah marker block. */
export function ownedServerKeys(content: string): string[] {
  const keys: string[] = [];
  const pattern = /^# ptah:begin (\S+)\s*$/gm;
  let match: RegExpExecArray | null = pattern.exec(content);
  while (match !== null) {
    keys.push(match[1]);
    match = pattern.exec(content);
  }
  return keys;
}

/**
 * Replace the marker block for `serverKey` with `replacement`, or delete it
 * when `replacement` is `null`. Appends when no block exists yet.
 *
 * Line-based rather than regex-based over the whole file so a stray `#
 * ptah:begin` inside a user's multi-line string cannot make the splice swallow
 * unrelated content: an unterminated block is left exactly as found.
 */
export function spliceOwnedBlock(
  content: string,
  serverKey: string,
  replacement: string | null,
): string {
  const usesCrlf = content.includes('\r\n');
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const begin = lines.indexOf(beginMarker(serverKey));

  if (begin === -1) {
    if (replacement === null) return content;
    const body = trimTrailingBlank(lines);
    const next =
      body.length === 0 ? [replacement, ''] : [...body, '', replacement, ''];
    return restore(next.join('\n'), usesCrlf);
  }

  const end = lines.indexOf(endMarker(serverKey), begin);
  if (end === -1) return content; // Unterminated — refuse to guess where it ends.

  const before = lines.slice(0, begin);
  const after = lines.slice(end + 1);
  const merged =
    replacement === null
      ? [...before, ...after]
      : [...before, replacement, ...after];
  return restore(collapseBlankRun(merged).join('\n'), usesCrlf);
}

/** Every Ptah block removed, used to find the user's own tables. */
function stripAllOwnedBlocks(content: string): string {
  let result = content;
  for (const key of ownedServerKeys(content)) {
    result = spliceOwnedBlock(result, key, null);
  }
  return result;
}

function trimTrailingBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

/** Two blank lines where a block used to be read as sloppy; one does not. */
function collapseBlankRun(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (
      line.trim() === '' &&
      out.length > 0 &&
      out[out.length - 1].trim() === ''
    ) {
      continue;
    }
    out.push(line);
  }
  return out;
}

function restore(content: string, usesCrlf: boolean): string {
  return usesCrlf ? content.replace(/\n/g, '\r\n') : content;
}

// --------------------------------------------------------------------- parsing

/**
 * Extract every `[mcp_servers.<name>]` table from a TOML document.
 *
 * Recognises the subset Codex configs use in practice: basic strings, arrays of
 * basic strings, and `env`/`headers` sub-tables. Anything else is skipped, so
 * an exotic entry still reports its NAME (which is what ownership and
 * `listInstalled` need) with a degraded config.
 */
export function parseMcpServerTables(
  content: string,
): Map<string, McpServerConfig> {
  const raw = new Map<
    string,
    { fields: Map<string, unknown>; sub: Map<string, Map<string, string>> }
  >();
  let current: { server: string; sub: string | null } | null = null;

  for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header !== null) {
      current = parseTableHeader(header[1]);
      if (current !== null && !raw.has(current.server)) {
        raw.set(current.server, { fields: new Map(), sub: new Map() });
      }
      continue;
    }
    if (current === null) continue;

    const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (pair === null) continue;
    const entry = raw.get(current.server);
    if (entry === undefined) continue;

    if (current.sub === null) {
      entry.fields.set(pair[1], parseValue(pair[2]));
      continue;
    }
    const value = parseValue(pair[2]);
    if (typeof value !== 'string') continue;
    const bucket = entry.sub.get(current.sub) ?? new Map<string, string>();
    bucket.set(pair[1], value);
    entry.sub.set(current.sub, bucket);
  }

  const servers = new Map<string, McpServerConfig>();
  for (const [name, entry] of raw) {
    servers.set(name, toConfig(entry));
  }
  return servers;
}

function parseTableHeader(
  header: string,
): { server: string; sub: string | null } | null {
  if (!header.startsWith(TABLE_PREFIX)) return null;
  const rest = header.slice(TABLE_PREFIX.length);
  if (rest === '') return null;
  const dot = rest.indexOf('.');
  if (dot === -1) return { server: rest, sub: null };
  return { server: rest.slice(0, dot), sub: rest.slice(dot + 1) };
}

function toConfig(entry: {
  fields: Map<string, unknown>;
  sub: Map<string, Map<string, string>>;
}): McpServerConfig {
  const env = recordFrom(entry.sub.get('env'));
  const command = entry.fields.get('command');

  if (typeof command === 'string') {
    const args = entry.fields.get('args');
    return {
      type: 'stdio',
      command,
      ...(Array.isArray(args)
        ? { args: args.filter((a): a is string => typeof a === 'string') }
        : {}),
      ...(env === undefined ? {} : { env }),
    };
  }

  const url = entry.fields.get('url');
  const headers = recordFrom(entry.sub.get('headers'));
  const urlValue = typeof url === 'string' ? url : '';
  return {
    type: urlValue.includes('/sse') ? 'sse' : 'http',
    url: urlValue,
    ...(headers === undefined ? {} : { headers }),
    ...(env === undefined ? {} : { env }),
  };
}

function recordFrom(
  source: Map<string, string> | undefined,
): Record<string, string> | undefined {
  if (source === undefined || source.size === 0) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of source) out[key] = value;
  return out;
}

/** Basic string, array of basic strings, or `undefined` for anything else. */
function parseValue(raw: string): unknown {
  const value = stripInlineComment(raw).trim();
  if (value.startsWith('"')) return parseBasicString(value);
  if (value.startsWith("'")) {
    const close = value.indexOf("'", 1);
    return close === -1 ? undefined : value.slice(1, close);
  }
  if (value.startsWith('[')) {
    const close = value.lastIndexOf(']');
    if (close === -1) return undefined;
    return splitTopLevel(value.slice(1, close))
      .map((item) => parseValue(item))
      .filter((item): item is string => typeof item === 'string');
  }
  return undefined;
}

/** Strip a trailing `# comment`, ignoring `#` inside a quoted string. */
function stripInlineComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return raw.slice(0, i);
  }
  return raw;
}

function parseBasicString(value: string): string | undefined {
  let out = '';
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\') {
      const next = value[i + 1];
      i++;
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else out += next ?? '';
      continue;
    }
    if (ch === '"') return out;
    out += ch;
  }
  return undefined;
}

/** Split an array body on commas that are not inside a quoted string. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail !== '') parts.push(tail);
  return parts.filter((part) => part.trim() !== '');
}
