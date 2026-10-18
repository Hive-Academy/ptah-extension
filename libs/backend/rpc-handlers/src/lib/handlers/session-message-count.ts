/**
 * Message counts for the `session:list` page (TASK_2026_693, FU-13).
 *
 * `SessionMetadataStore` keeps no message count, so the count comes from the
 * row's JSONL transcript. The list response never waits for that I/O:
 * {@link SessionMessageCounter.peekAndWarm} answers synchronously from a
 * per-process cache and starts a background warm for the page's rows. A row
 * the cache has not seen yet reports 0 (the "N msgs" label stays hidden);
 * when a call's warms change a count, its `onChanged` listener runs once so
 * the handler can tell the open list to refresh.
 *
 * The warm stats each file and re-streams it only when its exact
 * `(size, mtimeMs)` moved, through `JsonlReaderService.projectJsonlLines`
 * (streamed, yields to the event loop, retains nothing between lines), at most
 * {@link WARM_CONCURRENCY} files at a time, one warm per path, each inside a
 * {@link WARM_DEADLINE_MS} deadline, with at most {@link MAX_QUEUED_WARMS}
 * waiting.
 *
 * "Messages" means what a loaded chat shows (`ChatStore.messageCount` is
 * `messages().length`): one per visible user prompt and one per assistant
 * reply, where a reply is the run of assistant records between two visible
 * user prompts — the grouping of `SessionReplayService.replayToStreamEvents`.
 * The user-record filters are the replay's own, from the agent-sdk barrel.
 */

import * as fs from 'fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  isHiddenTranscriptRecord,
  isInterruptSentinelText,
  isSkillOrMetaText,
  type JsonlReaderService,
} from '@ptah-extension/agent-sdk';

/** Transcripts warmed at the same time. A page `limit` is not capped. */
const WARM_CONCURRENCY = 4;

/** A warm (stat + stream) that has not settled by then gives up its slot. */
export const WARM_DEADLINE_MS = 5_000;

/** Queued, not yet started warms; the newest are released beyond this. */
export const MAX_QUEUED_WARMS = 64;

/** Remembered counts, evicted least-recently-used. Entries are tiny. */
const COUNT_CACHE_MAX_ENTRIES = 512;

/** One paginated row whose transcript file exists on disk. */
export interface SessionTranscriptRef {
  readonly sessionId: string;
  readonly filePath: string;
}

interface CachedCount {
  readonly size: number;
  readonly mtimeMs: number;
  readonly count: number;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

/** Text blocks joined by newlines, as `HistoryEventFactory.extractTextContent`. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(asRecord)
    .filter((block): block is JsonRecord => block?.['type'] === 'text')
    .map((block) => {
      const text = block['text'];
      return typeof text === 'string' ? text : '';
    })
    .join('\n');
}

/** A user record the replay drops instead of rendering as a prompt. */
function isHiddenUserRecord(record: JsonRecord, content: unknown): boolean {
  if (
    isHiddenTranscriptRecord({
      isMeta: record['isMeta'] === true,
      isSynthetic: record['isSynthetic'] === true,
    })
  ) {
    return true;
  }
  if (record['sourceToolUseID'] !== undefined) return true;
  const text = textOf(content);
  if (isSkillOrMetaText(text)) return true;
  const firstBlock: unknown = Array.isArray(content) ? content[0] : undefined;
  if (asRecord(firstBlock)?.['type'] === 'tool_result') return true;
  if (text.trimStart().startsWith('<task-notification>')) return true;
  return isInterruptSentinelText(text);
}

/** Counts visible messages one JSONL line at a time. */
class TranscriptMessageTally {
  private count = 0;
  private inAssistantReply = false;

  get total(): number {
    return this.count;
  }

  visit(line: string): void {
    let record: JsonRecord | null;
    try {
      record = asRecord(JSON.parse(line));
    } catch {
      // degradation-audit: optional-capability - a malformed line is skipped,
      // exactly as JsonlReaderService skips it for the replay.
      return;
    }
    if (!record) return;
    const message = asRecord(record['message']);
    const rawType = record['type'];
    const role = message?.['role'];
    // `JsonlReaderService` falls back to the message role when `type` is empty.
    const type =
      typeof rawType === 'string' && rawType
        ? rawType
        : typeof role === 'string'
          ? role
          : '';

    if (type === 'system' && record['subtype'] === 'compact_boundary') {
      // The replay shows only what follows the last compaction boundary.
      this.count = 0;
      this.inAssistantReply = false;
      return;
    }
    const content = message?.['content'];
    if (!content) return;
    if (type === 'user') {
      if (isHiddenUserRecord(record, content)) return;
      this.count++;
      this.inAssistantReply = false;
    } else if (type === 'assistant' && !this.inAssistantReply) {
      this.count++;
      this.inAssistantReply = true;
    }
  }
}

/** Called once when every warm a list call started has settled. */
export type MessageCountsChangedListener = (
  changedSessionIds: readonly string[],
) => void;

/** The warms one `peekAndWarm` call started. */
interface WarmBatch {
  pending: number;
  readonly changedSessionIds: string[];
  readonly onChanged?: MessageCountsChangedListener;
}

interface WarmJob {
  readonly transcript: SessionTranscriptRef;
  readonly batch: WarmBatch;
}

/**
 * Settle `work`, or reject once `signal` aborts — whichever comes first — so
 * a read that ignores the signal still frees its slot at the deadline.
 */
function settleBefore<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('message count deadline'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Per-process message counter for the `session:list` page. */
export class SessionMessageCounter {
  private readonly cache = new Map<string, CachedCount>();
  /** Paths queued or being warmed — one warm per path. */
  private readonly warming = new Set<string>();
  private readonly queue: WarmJob[] = [];
  private activeWarms = 0;

  constructor(
    private readonly jsonlReader: Pick<JsonlReaderService, 'projectJsonlLines'>,
    private readonly logger: Logger,
  ) {}

  /**
   * The last known count of each transcript, without any I/O. Every
   * transcript not already queued is queued for a background warm, which
   * recounts it only when its size or mtime moved. A transcript never counted
   * is absent. `onChanged` runs once, after this call's warms settle, when at
   * least one of them changed the count this call returned.
   */
  peekAndWarm(
    transcripts: readonly SessionTranscriptRef[],
    onChanged?: MessageCountsChangedListener,
  ): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    const batch: WarmBatch = { pending: 0, changedSessionIds: [], onChanged };
    for (const transcript of transcripts) {
      const cached = this.cache.get(transcript.filePath);
      if (cached) counts.set(transcript.sessionId, cached.count);
      if (!this.warming.has(transcript.filePath)) {
        this.warming.add(transcript.filePath);
        this.queue.push({ transcript, batch });
        batch.pending++;
      }
    }
    // Drop the overflow from the tail, so earlier queued jobs and the top
    // rows of this page keep their warm. A dropped path is released and is
    // queued again if a later list shows it.
    while (this.queue.length > MAX_QUEUED_WARMS) {
      const dropped = this.queue.pop();
      if (!dropped) break;
      this.warming.delete(dropped.transcript.filePath);
      this.settle(dropped, false);
    }
    this.pump();
    return counts;
  }

  private pump(): void {
    while (this.activeWarms < WARM_CONCURRENCY) {
      const job = this.queue.shift();
      if (!job) return;
      this.activeWarms++;
      void this.warm(job.transcript).then((changed) => {
        this.activeWarms--;
        this.warming.delete(job.transcript.filePath);
        this.settle(job, changed);
        this.pump();
      });
    }
  }

  private settle(job: WarmJob, changed: boolean): void {
    const { batch } = job;
    if (changed) batch.changedSessionIds.push(job.transcript.sessionId);
    batch.pending--;
    if (batch.pending === 0 && batch.changedSessionIds.length > 0) {
      batch.onChanged?.(batch.changedSessionIds);
    }
  }

  /**
   * Never rejects. Resolves `true` when the count moved from what a list
   * reported before (a transcript never counted reported 0). A warm past its
   * {@link WARM_DEADLINE_MS} deadline gives up and leaves the previous count.
   */
  private async warm(transcript: SessionTranscriptRef): Promise<boolean> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), WARM_DEADLINE_MS);
    // A background count is never a reason for the process to stay up.
    // `unref` exists on Node's Timeout only.
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    try {
      return await settleBefore(
        this.recount(transcript, deadline.signal),
        deadline.signal,
      );
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the count is a row label
      // filled by a background warm; a transcript that cannot be read in time
      // keeps its previous count, or messageCount 0, which hides the label.
      this.logger.debug('RPC: session:list could not count transcript messages', {
        sessionId: transcript.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      clearTimeout(timer);
      // Stops a stream still running past the deadline.
      deadline.abort();
    }
  }

  private async recount(
    transcript: SessionTranscriptRef,
    signal: AbortSignal,
  ): Promise<boolean> {
    const stats = await fs.stat(transcript.filePath);
    if (!stats.isFile()) return false;
    const cached = this.cache.get(transcript.filePath);
    if (
      cached &&
      cached.size === stats.size &&
      cached.mtimeMs === stats.mtimeMs
    ) {
      this.remember(transcript.filePath, cached);
      return false;
    }
    const tally = new TranscriptMessageTally();
    await this.jsonlReader.projectJsonlLines(
      transcript.filePath,
      (line) => tally.visit(line),
      { signal, byteLength: stats.size },
    );
    // A read that outlived its deadline must not write a late result.
    if (signal.aborted) return false;
    this.remember(transcript.filePath, {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      count: tally.total,
    });
    return tally.total !== (cached?.count ?? 0);
  }

  private remember(filePath: string, entry: CachedCount): void {
    this.cache.delete(filePath);
    this.cache.set(filePath, entry);
    if (this.cache.size > COUNT_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}
