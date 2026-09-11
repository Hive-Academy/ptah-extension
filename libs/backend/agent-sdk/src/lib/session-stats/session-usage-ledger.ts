/**
 * Session usage ledger — the stats-only projection of one transcript file.
 *
 * `SessionStatsReaderService` never materialises a transcript. It streams the
 * JSONL through `JsonlReaderService.projectJsonlLines` and feeds each line to a
 * {@link SessionUsageLedgerBuilder}, which keeps ONLY what accounting needs:
 * record kind, timestamp, model id, the four usage counters, the parent
 * session id on the first record, the first `init` model, and where the last
 * `compact_boundary` fell. Content blocks, tool payloads and replay events are
 * garbage as soon as the line is visited (TASK_2026_411 B4).
 *
 * The ledger is scope-free on purpose: `current-context` and any
 * `[since, until)` range are both answered from the same ledger by
 * `aggregateSessionUsage`, so the cache that holds ledgers is valid across
 * range changes and needs no range in its key.
 */

import { z } from 'zod';

/** One deduplicated API message (or usage-bearing line) from a transcript. */
export interface UsageRecord {
  /** Epoch ms of the first line carrying a parseable timestamp, else `null`. */
  readonly timestampMs: number | null;
  /** Transcript `message.model` for assistant records, else `null`. */
  readonly model: string | null;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  /** True for `type: 'assistant'` records — the unit of `messageCount`. */
  readonly assistant: boolean;
  /** True when at least one usage counter was present. */
  readonly hasUsage: boolean;
}

/** Stats-only projection of one transcript file. Immutable once built. */
export interface SessionUsageLedger {
  /** Records in first-seen order. */
  readonly records: readonly UsageRecord[];
  /**
   * Index of the first record after the LAST `compact_boundary`; `0` when the
   * file has none. `current-context` counts parent records from here.
   */
  readonly currentContextStart: number;
  /** Model named by the first `system`/`init` record, if any. */
  readonly initModel: string | null;
  /** `sessionId` of the first parsed record — legacy subagent ownership. */
  readonly firstSessionId: string | null;
  /** Rough retained size, for the cache's byte bound. */
  readonly estimatedBytes: number;
}

/**
 * `schema`, read as `undefined` when the field is absent OR malformed.
 *
 * Transcripts are written by an external CLI whose line shape drifts between
 * versions; one bad counter must drop that counter, never the whole record.
 */
function absentWhenMalformed<T extends z.ZodType>(schema: T) {
  // degradation-audit: optional-capability - a malformed transcript field reads
  // as absent by design; the record's other fields are still counted.
  return schema.optional().catch(undefined);
}

const UsageCounter = absentWhenMalformed(z.number().finite().nonnegative());

const OptionalString = absentWhenMalformed(z.string());

/**
 * Boundary schema for the fields a stats projection reads from a JSONL line.
 * Unknown keys (content, tool input, …) are stripped, and each field degrades
 * to absent independently so one malformed counter cannot drop a record.
 */
const ProjectedLineSchema = z.object({
  type: OptionalString,
  subtype: OptionalString,
  sessionId: OptionalString,
  timestamp: OptionalString,
  model: OptionalString,
  message: absentWhenMalformed(
    z.object({
      role: OptionalString,
      id: OptionalString,
      model: OptionalString,
      usage: absentWhenMalformed(
        z.object({
          input_tokens: UsageCounter,
          output_tokens: UsageCounter,
          cache_read_input_tokens: UsageCounter,
          cache_creation_input_tokens: UsageCounter,
        }),
      ),
    }),
  ),
});

/**
 * Cheap substring gate. A line that mentions none of these cannot contribute a
 * record, a boundary or an init model, so it is never `JSON.parse`d — which is
 * what keeps a transcript dominated by large tool results cheap to project.
 * False positives only cost a parse; they never change the answer.
 */
const RELEVANT_MARKERS = ['"usage"', '"assistant"', 'compact_boundary', '"init"'];

/** Per-record retained size estimate (object header + 6 numbers + 2 flags). */
const RECORD_BYTES = 96;

interface MutableRecord {
  timestampMs: number | null;
  model: string | null;
  input: number | undefined;
  output: number | undefined;
  cacheRead: number | undefined;
  cacheCreation: number | undefined;
  assistant: boolean;
}

/**
 * Builds a {@link SessionUsageLedger} one line at a time.
 *
 * ## Duplicate lines for one API message
 *
 * The CLI writes one transcript line per content block of an assistant
 * message, every one carrying the same `message.id` and a copy of the usage
 * frame — often a partial `output_tokens` on the early lines and the final
 * count on the last. Summing lines counts a message several times. A record is
 * therefore keyed by `message.id`, and a later line REPLACES only the counters
 * it carries; an absent counter keeps the last known value. That is the same
 * per-component rule `StreamTransformer` applies to `message_start` /
 * `message_delta` frames (PR #490). Lines without an id are records of their
 * own.
 */
export class SessionUsageLedgerBuilder {
  private readonly records: MutableRecord[] = [];
  private readonly byMessageId = new Map<string, MutableRecord>();
  private currentContextStart = 0;
  private initModel: string | null = null;
  private firstSessionId: string | null = null;
  private sawFirstRecord = false;
  private modelBytes = 0;

  /** Visit one non-blank JSONL line. Never throws. */
  visit(line: string): void {
    if (this.sawFirstRecord && !RELEVANT_MARKERS.some((m) => line.includes(m))) {
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      // degradation-audit: optional-capability - a malformed line (commonly a
      // half-flushed final line) is skipped, as every transcript reader does.
      return;
    }
    const parsed = ProjectedLineSchema.safeParse(raw);
    if (!parsed.success) return;
    const projected = parsed.data;

    if (!this.sawFirstRecord) {
      this.sawFirstRecord = true;
      this.firstSessionId = projected.sessionId ?? null;
    }

    const type = projected.type ?? projected.message?.role;
    if (type === 'system') {
      if (projected.subtype === 'compact_boundary') {
        this.currentContextStart = this.records.length;
      } else if (
        projected.subtype === 'init' &&
        projected.model &&
        this.initModel === null
      ) {
        this.initModel = projected.model;
      }
      return;
    }

    const usage = projected.message?.usage;
    const hasUsage =
      usage !== undefined &&
      (usage.input_tokens !== undefined ||
        usage.output_tokens !== undefined ||
        usage.cache_read_input_tokens !== undefined ||
        usage.cache_creation_input_tokens !== undefined);
    const assistant = type === 'assistant';
    if (!assistant && !hasUsage) return;

    const timestampMs = parseTimestamp(projected.timestamp);
    const model = assistant ? projected.message?.model || null : null;
    const messageId = projected.message?.id;
    const existing = messageId ? this.byMessageId.get(messageId) : undefined;

    if (existing) {
      existing.timestampMs ??= timestampMs;
      if (existing.model === null && model !== null) {
        existing.model = model;
        this.modelBytes += model.length * 2;
      }
      existing.assistant ||= assistant;
      if (usage) {
        existing.input = usage.input_tokens ?? existing.input;
        existing.output = usage.output_tokens ?? existing.output;
        existing.cacheRead = usage.cache_read_input_tokens ?? existing.cacheRead;
        existing.cacheCreation =
          usage.cache_creation_input_tokens ?? existing.cacheCreation;
      }
      return;
    }

    const record: MutableRecord = {
      timestampMs,
      model,
      input: usage?.input_tokens,
      output: usage?.output_tokens,
      cacheRead: usage?.cache_read_input_tokens,
      cacheCreation: usage?.cache_creation_input_tokens,
      assistant,
    };
    this.records.push(record);
    if (model !== null) this.modelBytes += model.length * 2;
    if (messageId) this.byMessageId.set(messageId, record);
  }

  /** Freeze the projection. The builder must not be used afterwards. */
  build(): SessionUsageLedger {
    const records: UsageRecord[] = this.records.map((r) => {
      const hasUsage =
        r.input !== undefined ||
        r.output !== undefined ||
        r.cacheRead !== undefined ||
        r.cacheCreation !== undefined;
      return {
        timestampMs: r.timestampMs,
        model: r.model,
        input: r.input ?? 0,
        output: r.output ?? 0,
        cacheRead: r.cacheRead ?? 0,
        cacheCreation: r.cacheCreation ?? 0,
        assistant: r.assistant,
        hasUsage,
      };
    });
    this.byMessageId.clear();
    return {
      records,
      currentContextStart: this.currentContextStart,
      initModel: this.initModel,
      firstSessionId: this.firstSessionId,
      estimatedBytes:
        256 +
        records.length * RECORD_BYTES +
        this.modelBytes +
        ((this.initModel?.length ?? 0) + (this.firstSessionId?.length ?? 0)) * 2,
    };
  }
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
