/**
 * Codex rollout usage reader (TASK_2026_597, component 14).
 *
 * Codex writes one rollout per thread under
 * `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<local timestamp>-<thread id>.jsonl`.
 * A resumed thread appends to the file it started in, so the file stays under
 * the date directory of its FIRST turn. The resume gate needs one figure from
 * it: the input size of the thread's most recent request, which is
 * `event_msg` / `token_count` → `info.last_token_usage.input_tokens` on the last
 * such record. Field names match the M reader
 * (`scripts/agent-usage/codex-rollout.reader.ts`).
 *
 * Never the `turn.completed` usage the adapter streams: that is the SUM of
 * every request in a turn, so a ten-request turn reads as ten times the
 * context it actually holds.
 *
 * Read-only, and read from the file tail: the last `token_count` is near the
 * end, and a long thread's rollout runs to tens of megabytes.
 */

import { open, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { codexHomeDir } from '@ptah-extension/harness-sync';

/** What the gate reads from one rollout. */
export interface CodexRolloutUsage {
  /** Absolute path of the rollout file that was read. */
  readonly file: string;
  /** `info.last_token_usage.input_tokens` of the last `token_count` record. */
  readonly lastRequestInputTokens: number;
  /** The file's modification time: the thread's last write. */
  readonly modifiedAtMs: number;
}

export interface CodexRolloutUsageOptions {
  /** Overrides `<codexHomeDir()>/sessions`. Specs only. */
  readonly sessionsDir?: string;
}

/**
 * Tail windows tried in order. Most threads end with a `token_count` inside the
 * first window; a turn whose final record is a very large tool output needs a
 * wider one. The last window bounds the read on a pathological file.
 */
const TAIL_WINDOWS_BYTES = [64 * 1024, 1024 * 1024, 16 * 1024 * 1024] as const;

/** Codex thread ids are UUIDs; anything else cannot name a rollout. */
const THREAD_ID_RE = /^[A-Za-z0-9-]+$/;

/** A `YYYY`, `MM` or `DD` directory name. */
const DATE_DIR_RE = /^\d+$/;

/**
 * Read the last per-request input size of a Codex thread.
 *
 * @returns `null` when no rollout for the thread exists, or when the rollout
 *   holds no `token_count` with a per-request figure.
 * @throws when the rollout exists but cannot be read. The caller decides what
 *   an unreadable rollout means; this reader does not guess.
 */
export async function readCodexRolloutUsage(
  threadId: string,
  options: CodexRolloutUsageOptions = {},
): Promise<CodexRolloutUsage | null> {
  if (!THREAD_ID_RE.test(threadId)) return null;
  const sessionsDir = options.sessionsDir ?? join(codexHomeDir(), 'sessions');
  const file = await findRolloutFile(sessionsDir, threadId);
  if (file === null) return null;

  const { size, mtimeMs } = await stat(file);
  const tokens = await readLastRequestInputTokens(file, size);
  return tokens === null
    ? null
    : { file, lastRequestInputTokens: tokens, modifiedAtMs: mtimeMs };
}

/**
 * Find `rollout-*-<threadId>.jsonl`, newest date directories first. Stops at
 * the first match, so a recent thread costs a few directory listings.
 */
async function findRolloutFile(
  sessionsDir: string,
  threadId: string,
): Promise<string | null> {
  const suffix = `-${threadId}.jsonl`;
  for (const year of await dateDirsNewestFirst(sessionsDir)) {
    for (const month of await dateDirsNewestFirst(year)) {
      for (const day of await dateDirsNewestFirst(month)) {
        const names = await listDir(day);
        const match = names.find(
          (name) => name.startsWith('rollout-') && name.endsWith(suffix),
        );
        if (match !== undefined) return join(day, match);
      }
    }
  }
  return null;
}

async function dateDirsNewestFirst(dir: string): Promise<string[]> {
  const names = await listDir(dir);
  return names
    .filter((name) => DATE_DIR_RE.test(name))
    .sort((a, b) => Number(b) - Number(a))
    .map((name) => join(dir, name));
}

/** A missing directory lists as empty; any other failure propagates. */
async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function readLastRequestInputTokens(
  file: string,
  size: number,
): Promise<number | null> {
  const handle = await open(file, 'r');
  try {
    for (const window of TAIL_WINDOWS_BYTES) {
      const length = Math.min(window, size);
      const start = size - length;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      const lines = buffer.toString('utf8').split('\n');
      // A window that does not start at byte 0 begins mid-line.
      if (start > 0) lines.shift();
      const tokens = lastRequestInputTokensIn(lines);
      if (tokens !== null) return tokens;
      if (start === 0) return null;
    }
    return null;
  } finally {
    await handle.close();
  }
}

/** Scan lines from the end for the last usable `token_count`. */
export function lastRequestInputTokensIn(
  lines: readonly string[],
): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.includes('"token_count"')) continue;
    const tokens = parseTokenCountLine(line);
    if (tokens !== null) return tokens;
  }
  return null;
}

function parseTokenCountLine(line: string): number | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    // degradation-audit: optional-capability — a torn final line (Codex still
    // writing) is not a record; the caller scans on to the one before it.
    return null;
  }
  const payload = field(record, 'payload');
  if (field(record, 'type') !== 'event_msg') return null;
  if (field(payload, 'type') !== 'token_count') return null;
  const input = field(
    field(field(payload, 'info'), 'last_token_usage'),
    'input_tokens',
  );
  return typeof input === 'number' && Number.isFinite(input) && input >= 0
    ? input
    : null;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
