import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import * as readline from 'node:readline';
import type { UsageContribution } from '../usage-source.types';

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 4000;
const MAX_CACHED_FACTS = 100_000;

export interface ParsedFile { facts: UsageContribution[]; malformed: number; partial: boolean }

/** Cache complete file projections; identity changes when a file is appended or replaced. */
export class FileFactsCache {
  private readonly entries = new Map<string, ParsedFile>();
  private factCount = 0;

  async read(file: string, parse: (lines: AsyncIterable<string>, mtimeMs: number) => Promise<ParsedFile>): Promise<ParsedFile> {
    const stat = await fs.stat(file);
    if (stat.size > MAX_FILE_BYTES) return { facts: [], malformed: 0, partial: true };
    const key = `${file}\0${stat.size}\0${stat.mtimeMs}`;
    const cached = this.entries.get(key);
    if (cached) return cached;
    const stream = createReadStream(file, { encoding: 'utf8' });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      const lines = boundedLines(reader);
      const parsed = await parse(lines, stat.mtimeMs);
      while (this.entries.size >= MAX_ENTRIES || this.factCount + parsed.facts.length > MAX_CACHED_FACTS) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.factCount -= this.entries.get(oldest)?.facts.length ?? 0;
        this.entries.delete(oldest);
      }
      if (parsed.facts.length <= MAX_CACHED_FACTS) {
        this.entries.set(key, parsed);
        this.factCount += parsed.facts.length;
      }
      return parsed;
    } finally { reader.close(); stream.destroy(); }
  }
}

async function* boundedLines(reader: readline.Interface): AsyncGenerator<string> {
  for await (const line of reader) {
    yield Buffer.byteLength(line) <= MAX_LINE_BYTES ? line : '';
  }
}

export function inRange(facts: readonly UsageContribution[], since: number, until: number): UsageContribution[] {
  return facts.filter((f) => f.timestampMs >= since && f.timestampMs < until);
}

export function workspaceMatches(actual: string | undefined, requested: string): boolean {
  if (!requested) return true;
  if (!actual) return false;
  const normalize = (v: string) => v.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  const root = normalize(requested);
  const value = normalize(actual);
  return value === root || value.startsWith(`${root}/`);
}
