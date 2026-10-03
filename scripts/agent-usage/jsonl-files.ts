/**
 * Line-delimited JSON logs, as Codex (rollouts) and Claude Code (transcripts)
 * write them. Shared by both readers so a missing directory and a torn line
 * are handled the same way for each vendor.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

export interface JsonlFileFilter {
  /** Keep files modified at or after this epoch-ms. */
  readonly modifiedSinceMs?: number;
  /** Keep files whose base name passes this test. */
  readonly nameFilter?: (baseName: string) => boolean;
}

/** Every `*.jsonl` under `root` that passes the filter. Missing root = none. */
export function collectJsonlFiles(
  root: string,
  filter: JsonlFileFilter = {},
): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // An unreadable directory is skipped, like a vanished one.
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue; // A session file can vanish mid-walk; it is not an error.
      }
      if (stats.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.endsWith('.jsonl')) continue;
      if (
        filter.modifiedSinceMs !== undefined &&
        stats.mtimeMs < filter.modifiedSinceMs
      ) {
        continue;
      }
      if (filter.nameFilter && !filter.nameFilter(entry)) continue;
      files.push(path);
    }
  };
  walk(root);
  return files.sort();
}

export interface JsonlContent {
  readonly records: unknown[];
  /** Non-empty lines that did not parse; a writer may be mid-line. */
  readonly badLines: number;
}

/** Parse every line of `file`; a torn or corrupt line is counted, not thrown. */
export function readJsonLines(file: string): JsonlContent {
  const records: unknown[] = [];
  let badLines = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      badLines++;
    }
  }
  return { records, badLines };
}

/** Narrow an unknown JSON value to a plain object. */
export function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

export const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Text characters of a tool output. A string counts as is. A content-item
 * array (`[{type:'input_text', text}, {type:'input_image', image_url}]` in
 * Codex, `[{type:'text', text}, {type:'image', ...}]` in Claude) counts only
 * its text parts: an inline base64 image is hundreds of thousands of chars but
 * is not priced as text, and counting it would make every screenshot the
 * "largest output". Any other shape counts as its JSON length.
 */
export function outputChars(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (value === undefined || value === null) return 0;
  if (Array.isArray(value)) {
    let chars = 0;
    for (const item of value) {
      const text = asObject(item)['text'];
      if (typeof text === 'string') chars += text.length;
    }
    return chars;
  }
  return JSON.stringify(value).length;
}
