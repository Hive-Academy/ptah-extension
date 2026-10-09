/**
 * Cassette storage for the record/replay doubles (benchmark-design.md 6.2,
 * R-M5).
 *
 * One cassette is one JSONL file: each line is one entry
 * `{key, method, model, promptSha, response, usage?}`. Record mode writes one
 * line per call and replaces any existing entry for the same key; replay mode
 * serves entries by key.
 *
 * A replay lookup with no matching entry throws {@link CassetteMissError}.
 * Replay never falls through to a live call: the doubles refuse to hold a real
 * adapter in replay mode, so a miss can only surface as the typed error, which
 * the suite maps to a case-level `na: cassette-miss` (R-M5: a suite with any
 * miss cannot pass).
 *
 * Keys are `sha256(method + canonical JSON of the inputs)` (design 6.2). The
 * canonical form sorts object keys recursively, so the key does not depend on
 * property order and is stable across win32 (record) and linux (CI replay).
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { compareCodeUnits } from '../../utils/compare-code-units';

/** Which side of the double the store serves. */
export type CassetteMode = 'record' | 'replay';

/** Token and cost accounting one call spent, when the port reports it. */
export interface CassetteUsage {
  readonly input?: number;
  readonly output?: number;
  readonly costUsd?: number;
}

/** One JSONL line of a cassette (design 6.2). */
export interface CassetteEntry {
  readonly key: string;
  readonly method: string;
  readonly model: string;
  readonly promptSha: string;
  readonly response: unknown;
  readonly usage?: CassetteUsage;
}

/** A replayed call whose key has no recorded entry. */
export class CassetteMissError extends Error {
  readonly key: string;
  readonly method: string;
  /** The cassette file the lookup ran against, for diagnostics. */
  readonly path: string;

  constructor(method: string, key: string, path: string) {
    super(`Cassette miss for ${method}: no entry with key ${key} in ${path}`);
    this.name = 'CassetteMissError';
    this.key = key;
    this.method = method;
    this.path = path;
  }
}

/** A cassette that holds two different responses for one key: unusable. */
export class CassetteDuplicateError extends Error {
  readonly key: string;
  /** The cassette file that failed to load, for diagnostics. */
  readonly path: string;

  constructor(key: string, path: string) {
    super(
      `Cassette duplicate for key ${key}: two entries with different ` +
        `responses in ${path}`,
    );
    this.name = 'CassetteDuplicateError';
    this.key = key;
    this.path = path;
  }
}

/**
 * A record-mode result the double refuses to persist: a stalled extraction or
 * a non-ok lane result would replay a transient provider failure forever.
 * Set `recordFailures: true` on the double to record one deliberately.
 */
export class CassetteRecordRefusalError extends Error {
  readonly method: string;
  readonly key: string;

  constructor(method: string, key: string, reason: string) {
    super(
      `Cassette record refused for ${method} (key ${key}): ${reason}. Set ` +
        `\`recordFailures: true\` to record it deliberately.`,
    );
    this.name = 'CassetteRecordRefusalError';
    this.method = method;
    this.key = key;
  }
}

/** sha256 of a UTF-8 string, as lowercase hex. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace. `signal`
 * and `options` are excluded by the caller before canonicalising — an
 * `AbortSignal` is not serialisable, and `options` carries host call context,
 * not model inputs.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? 'null';
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const name of Object.keys(value).sort(compareCodeUnits)) {
      const member = (value as Record<string, unknown>)[name];
      if (member !== undefined) {
        sorted[name] = canonicalize(member);
      }
    }
    return sorted;
  }
  return value;
}

/** The cassette key scheme of design 6.2: `sha256(method + canonical JSON)`. */
export function cassetteKey(method: string, inputs: unknown): string {
  return sha256Hex(method + canonicalJson(inputs));
}

/**
 * The JSONL-backed cassette. Construct one per cassette file; the doubles take
 * the mode off the store so record/replay can never disagree between the two.
 */
export class CassetteStore {
  private entries: ReadonlyMap<string, CassetteEntry> | null = null;

  constructor(
    private readonly options: {
      readonly path: string;
      readonly mode: CassetteMode;
    },
  ) {}

  get mode(): CassetteMode {
    return this.options.mode;
  }

  get path(): string {
    return this.options.path;
  }

  /**
   * Write one entry as a JSONL line, replacing any existing entry for the same
   * key: a re-record must never leave a stale entry that replay serves first.
   * The file is rewritten atomically (a temp file, then rename) so a crash
   * cannot leave a half-written cassette. Record mode only.
   */
  record(entry: CassetteEntry): void {
    if (this.options.mode !== 'record') {
      throw new Error(
        `CassetteStore.record requires mode 'record' (path: ${this.options.path})`,
      );
    }
    mkdirSync(dirname(this.options.path), { recursive: true });
    const lines = existsSync(this.options.path)
      ? readFileSync(this.options.path, 'utf8')
          .split('\n')
          .filter((line) => line.trim())
      : [];
    const kept = lines.filter(
      (line) => (JSON.parse(line) as CassetteEntry).key !== entry.key,
    );
    kept.push(JSON.stringify(entry));
    const temp = `${this.options.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${kept.join('\n')}\n`, 'utf8');
    renameSync(temp, this.options.path);
  }

  /**
   * Serve the entry recorded for `key`. Replay mode only. Duplicate keys are a
   * cassette corruption: `load` throws {@link CassetteDuplicateError} when one
   * key carries two different responses, so replay is deterministic.
   */
  lookup(method: string, key: string): CassetteEntry {
    if (this.options.mode !== 'replay') {
      throw new Error(
        `CassetteStore.lookup requires mode 'replay' (path: ${this.options.path})`,
      );
    }
    if (!this.entries) {
      this.entries = this.load();
    }
    const entry = this.entries.get(key);
    if (!entry) {
      throw new CassetteMissError(method, key, this.options.path);
    }
    return entry;
  }

  private load(): Map<string, CassetteEntry> {
    const byKey = new Map<string, CassetteEntry>();
    if (!existsSync(this.options.path)) {
      return byKey;
    }
    for (const line of readFileSync(this.options.path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const entry = JSON.parse(trimmed) as CassetteEntry;
      const existing = byKey.get(entry.key);
      if (existing) {
        if (
          canonicalJson(existing.response) !== canonicalJson(entry.response)
        ) {
          throw new CassetteDuplicateError(entry.key, this.options.path);
        }
        continue;
      }
      byKey.set(entry.key, entry);
    }
    return byKey;
  }
}
