/**
 * OpenCode reader for M (TASK_2026_597, component 10, R1.3).
 *
 * Sessions: OpenCode 2.x keeps them in `<XDG_DATA_HOME or ~/.local/share>/
 * opencode/opencode.db` (SQLite, WAL). The rows used here:
 *
 * - `session_v2` — one row per session (`id`, `time_created`);
 * - `session_message` — `type` `user` | `assistant` | `compaction` | ...,
 *   ordered by `seq`. An assistant row's `data.tokens` is the usage of that
 *   step: `input` is the UNCACHED input, `cache.read` / `cache.write` the
 *   cached parts, so a request's context is their sum. `data.model` carries
 *   `providerID`, `id` and the effort `variant`; `data.content[]` parts of
 *   type `tool` carry `name` and `state.content[].text` (the tool output).
 *
 * The database is never opened in place. Its file plus `-wal` / `-shm` are
 * copied to a temp directory and the COPY is opened read-only, so nothing M
 * does can write to, lock or checkpoint the user's store. A copy taken while
 * OpenCode is writing may miss the newest rows; for an offline report that is
 * acceptable and much safer than sharing the live WAL.
 *
 * Config: the user's global OpenCode config directory (`<XDG_CONFIG_HOME or
 * ~/.config>/opencode`) declares MCP servers (`mcp`) and plugins (`plugin`
 * plus files under `plugin/` or `plugins/`). Only names, types and the
 * `enabled` flag are reported: commands, URLs, headers and environment can
 * hold credentials and are never read into the result.
 */

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';

import { asNumber, asObject, asString } from './jsonl-files';
import {
  hasLaneContractMarker,
  isoInstant,
  largerToolOutput,
  localDate,
  requestStats,
  type LaneMetrics,
  type SkippedSource,
  type ToolOutputSize,
} from './lane-metrics';

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value : undefined;
};

/** `<XDG_DATA_HOME or ~/.local/share>/opencode`. */
export function opencodeDataDir(): string {
  return join(
    env('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'),
    'opencode',
  );
}

/** `<XDG_CONFIG_HOME or ~/.config>/opencode`. */
export function opencodeConfigDir(): string {
  return join(env('XDG_CONFIG_HOME') ?? join(homedir(), '.config'), 'opencode');
}

export interface OpencodeSessionSummary {
  readonly id: string;
  readonly startedAt: string | null;
  readonly model: string;
  readonly effort: string;
  readonly requestInputs: readonly number[];
  readonly cached: number;
  readonly output: number;
  readonly compactions: number;
  readonly largestToolOutput: ToolOutputSize | null;
  readonly toolCalls: Readonly<Record<string, number>>;
  readonly hasLaneMarker: boolean;
  /** Message rows whose `data` did not parse. */
  readonly badRows: number;
}

export interface OpencodeDbFilter {
  /** Keep sessions created at or after this epoch-ms. */
  readonly createdSinceMs?: number;
  /** Keep sessions created on this local date (`YYYY-MM-DD`). */
  readonly date?: string;
}

export interface OpencodeDbReport {
  readonly dbPath: string;
  readonly sessions: OpencodeSessionSummary[];
  readonly skipped: SkippedSource[];
}

/** Prefix of the temp directory each read creates (and removes). */
export const SNAPSHOT_DIR_PREFIX = 'ptah-usage-opencode-';

interface DatabaseSnapshot {
  readonly dir: string;
  readonly copy: string;
  /** Removes `dir`; throws if it cannot. */
  readonly cleanup: () => void;
}

/**
 * Copy `dbPath` and its WAL companions to a fresh temp directory. The caller
 * removes the directory with the returned `cleanup`.
 */
function snapshotDatabase(dbPath: string): DatabaseSnapshot {
  const dir = mkdtempSync(join(tmpdir(), SNAPSHOT_DIR_PREFIX));
  const copy = join(dir, 'opencode.db');
  try {
    copyFileSync(dbPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix))
        copyFileSync(dbPath + suffix, copy + suffix);
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    dir,
    copy,
    // Retries cover a Windows handle that is released a moment late.
    cleanup: () =>
      rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      }),
  };
}

function parseData(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Sum of the text parts of a tool part's output. */
function toolOutputChars(state: Record<string, unknown>): number {
  const content = state['content'];
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const part of content) {
    const text = asString(asObject(part)['text']);
    if (text !== null) chars += text.length;
  }
  return chars;
}

interface MessageRow {
  readonly type: unknown;
  readonly data: unknown;
}

/** Reduce one session's ordered message rows. Exported for the spec. */
export function summariseOpencodeSession(
  id: string,
  createdMs: number,
  rows: readonly MessageRow[],
): OpencodeSessionSummary {
  const requestInputs: number[] = [];
  const toolCalls: Record<string, number> = {};
  let firstUserText: string | null = null;
  let model = '';
  let effort = '';
  let cached = 0;
  let output = 0;
  let compactions = 0;
  let badRows = 0;
  let largestToolOutput: ToolOutputSize | null = null;

  for (const row of rows) {
    const data = parseData(row.data);
    if (data === null) {
      badRows++;
      continue;
    }
    if (row.type === 'compaction') {
      compactions++;
      continue;
    }
    if (row.type === 'user') {
      if (firstUserText === null) firstUserText = asString(data['text']) ?? '';
      continue;
    }
    if (row.type !== 'assistant') continue;

    const modelInfo = asObject(data['model']);
    const modelId = asString(modelInfo['id']);
    if (modelId) {
      const provider = asString(modelInfo['providerID']);
      model = provider ? `${provider}/${modelId}` : modelId;
      effort = asString(modelInfo['variant']) ?? effort;
    }
    const content = data['content'];
    if (Array.isArray(content)) {
      for (const block of content) {
        const part = asObject(block);
        if (part['type'] !== 'tool') continue;
        const name = asString(part['name']) ?? '?';
        toolCalls[name] = (toolCalls[name] ?? 0) + 1;
        largestToolOutput = largerToolOutput(largestToolOutput, {
          tool: name,
          chars: toolOutputChars(asObject(part['state'])),
        });
      }
    }
    const tokens = asObject(data['tokens']);
    if (Object.keys(tokens).length === 0) continue;
    const cache = asObject(tokens['cache']);
    const read = asNumber(cache['read']);
    requestInputs.push(
      asNumber(tokens['input']) + read + asNumber(cache['write']),
    );
    cached += read;
    output += asNumber(tokens['output']);
  }

  return {
    id,
    // An out-of-range `time_created` yields null, not a RangeError.
    startedAt: isoInstant(createdMs),
    model,
    effort,
    requestInputs,
    cached,
    output,
    compactions,
    largestToolOutput,
    toolCalls,
    hasLaneMarker: hasLaneContractMarker(
      firstUserText === null ? [] : [firstUserText],
    ),
    badRows,
  };
}

/** Read sessions from `dbPath` through a temp copy. Failures are skipped sources. */
export function readOpencodeDb(
  dbPath: string,
  filter: OpencodeDbFilter = {},
): OpencodeDbReport {
  const skipped: SkippedSource[] = [];
  if (!existsSync(dbPath)) {
    skipped.push({ vendor: 'opencode', location: dbPath, reason: 'absent' });
    return { dbPath, sessions: [], skipped };
  }

  let snapshot: DatabaseSnapshot;
  try {
    snapshot = snapshotDatabase(dbPath);
  } catch (error) {
    skipped.push({
      vendor: 'opencode',
      location: dbPath,
      reason: `copy failed (${error instanceof Error ? error.name : 'error'})`,
    });
    return { dbPath, sessions: [], skipped };
  }

  const sessions: OpencodeSessionSummary[] = [];
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(snapshot.copy, { readOnly: true });
    const sessionRows = db
      .prepare(
        'SELECT id, time_created FROM session_v2 WHERE time_created >= ? ORDER BY time_created',
      )
      .all(filter.date ? 0 : (filter.createdSinceMs ?? 0));
    const messages = db.prepare(
      'SELECT type, data FROM session_message WHERE session_id = ? ORDER BY seq',
    );
    for (const row of sessionRows) {
      const id = asString(row['id']);
      const created = asNumber(row['time_created']);
      if (id === null) continue;
      if (filter.date && localDate(created) !== filter.date) continue;
      const summary = summariseOpencodeSession(
        id,
        created,
        messages.all(id) as unknown as MessageRow[],
      );
      if (summary.badRows > 0) {
        skipped.push({
          vendor: 'opencode',
          location: `${dbPath}#${id}`,
          reason: `${summary.badRows} unparseable message row(s) skipped`,
        });
      }
      sessions.push(summary);
    }
  } catch (error) {
    skipped.push({
      vendor: 'opencode',
      location: dbPath,
      // The message names the missing table or column on a schema change;
      // it carries no row content.
      reason: `unreadable (${error instanceof Error ? error.message : 'error'})`,
    });
  } finally {
    // The temp copy holds the user's conversations: it is removed even when
    // `close()` throws, and neither failure aborts the report.
    try {
      db?.close();
    } catch (error) {
      skipped.push({
        vendor: 'opencode',
        location: dbPath,
        reason: `temp copy close failed (${error instanceof Error ? error.name : 'error'})`,
      });
    } finally {
      try {
        snapshot.cleanup();
      } catch (error) {
        skipped.push({
          vendor: 'opencode',
          location: snapshot.dir,
          reason: `temp copy NOT removed, delete it by hand (${error instanceof Error ? error.name : 'error'})`,
        });
      }
    }
  }
  return { dbPath, sessions, skipped };
}

/** The `--lanes` row for one OpenCode session. */
export function opencodeLaneMetrics(
  summary: OpencodeSessionSummary,
): LaneMetrics {
  const stats = requestStats(summary.requestInputs);
  return {
    vendor: 'opencode',
    id: summary.id,
    startedAt: summary.startedAt,
    isPtahLane: summary.hasLaneMarker,
    model: summary.model,
    effort: summary.effort,
    requests: stats.requests,
    firstInput: stats.firstInput,
    peakInput: stats.peakInput,
    totalInput: stats.totalInput,
    cached: summary.cached,
    output: summary.output,
    largestToolOutput: summary.largestToolOutput,
    compactions: summary.compactions,
  };
}

// ---------------------------------------------------------------------------
// Config (`--opencode-config`)
// ---------------------------------------------------------------------------

export interface OpencodeMcpServer {
  readonly name: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly file: string;
}

export interface OpencodePlugin {
  readonly name: string;
  /** The config file that lists it, or the plugin directory holding it. */
  readonly declaredIn: string;
}

export interface OpencodeConfigReport {
  readonly configDir: string;
  readonly files: string[];
  readonly servers: OpencodeMcpServer[];
  readonly plugins: OpencodePlugin[];
  readonly skipped: SkippedSource[];
}

/** Config file names OpenCode reads from its global directory. */
const CONFIG_FILE_NAMES = ['config.json', 'opencode.json', 'opencode.jsonc'];
const PLUGIN_DIR_NAMES = ['plugin', 'plugins'];

/**
 * JSON with comments and trailing commas → JSON. Strings are copied verbatim,
 * so a `//` inside a URL survives.
 */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** A plugin entry is a package spec string or a `[spec, options]` tuple. */
function pluginName(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0];
  return null;
}

/** MCP servers and plugins declared in `configDir`. Missing dir = skipped. */
export function readOpencodeConfig(configDir: string): OpencodeConfigReport {
  const skipped: SkippedSource[] = [];
  const files: string[] = [];
  const servers: OpencodeMcpServer[] = [];
  const plugins: OpencodePlugin[] = [];

  if (!existsSync(configDir)) {
    skipped.push({ vendor: 'opencode', location: configDir, reason: 'absent' });
    return { configDir, files, servers, plugins, skipped };
  }

  for (const name of CONFIG_FILE_NAMES) {
    const file = join(configDir, name);
    if (!existsSync(file)) continue;
    let config: Record<string, unknown>;
    try {
      config = asObject(JSON.parse(stripJsonc(readFileSync(file, 'utf8'))));
    } catch (error) {
      skipped.push({
        vendor: 'opencode',
        location: file,
        reason: `unparseable (${error instanceof Error ? error.name : 'error'})`,
      });
      continue;
    }
    files.push(name);
    for (const [server, raw] of Object.entries(asObject(config['mcp']))) {
      const entry = asObject(raw);
      servers.push({
        name: server,
        type: asString(entry['type']) ?? '?',
        enabled: entry['enabled'] !== false,
        file: name,
      });
    }
    const declared = config['plugin'];
    if (Array.isArray(declared)) {
      for (const entry of declared) {
        const plugin = pluginName(entry);
        if (plugin !== null) plugins.push({ name: plugin, declaredIn: name });
      }
    }
  }

  for (const dirName of PLUGIN_DIR_NAMES) {
    const dir = join(configDir, dirName);
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      skipped.push({ vendor: 'opencode', location: dir, reason: 'unreadable' });
      continue;
    }
    for (const entry of entries) {
      if (/\.(m?[jt]s)$/.test(entry)) {
        plugins.push({ name: entry, declaredIn: `${dirName}/` });
      }
    }
  }

  return { configDir, files, servers, plugins, skipped };
}

/**
 * OpenCode names an MCP tool `<server>_<tool>`, with characters outside
 * `[A-Za-z0-9_-]` replaced by `_`. Count each declared server's tool calls
 * across the given sessions. A server with calls was loaded; one without is
 * "declared, no call observed" — loading cannot be proven offline.
 */
export function serverToolCalls(
  servers: readonly OpencodeMcpServer[],
  sessions: readonly OpencodeSessionSummary[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const server of servers) {
    const prefix = server.name.replace(/[^A-Za-z0-9_-]/g, '_') + '_';
    let calls = 0;
    for (const session of sessions) {
      for (const [tool, n] of Object.entries(session.toolCalls)) {
        if (tool.startsWith(prefix)) calls += n;
      }
    }
    counts[server.name] = calls;
  }
  return counts;
}
