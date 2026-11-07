/**
 * Running-output journal (Component 16, P3-K).
 *
 * A running lane's output lives only in memory until it exits. A host crash
 * loses all of it. The journal keeps a bounded tail of each running lane's
 * output in state storage, so a restored lane shows output up to the last
 * checkpoint and a fresh handoff can carry it.
 *
 * Writes:
 * - one host-wide interval, running only while a lane runs; each tick writes
 *   only lanes whose output changed since their last checkpoint;
 * - one write on exit, before the completion persist;
 * - never a write per output delta.
 *
 * The checkpoint is output only. Lane activity time stays with the lane
 * reference (`laneLastActivityAt`); this journal adds no activity clock.
 */
import { z } from 'zod';
import {
  hasStateStorageReadiness,
  type IStateStorage,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { CliOutputSegment } from '@ptah-extension/shared';

export const AGENT_OUTPUT_CHECKPOINT_KEY_PREFIX =
  'ptah:agent-output-checkpoint:v1:';
export const AGENT_OUTPUT_CHECKPOINT_INTERVAL_MS = 15_000;
export const AGENT_OUTPUT_CHECKPOINT_MAX_STDOUT_CHARS = 64 * 1024;
export const AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENTS = 200;
export const AGENT_OUTPUT_CHECKPOINT_MAX_CHANGED_FILES = 200;
/** Total JSON budget of the kept segments, newest first. */
export const AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENT_BYTES = 256 * 1024;
/** One segment's text fields are cut to their tail at this size. */
const MAX_SEGMENT_FIELD_CHARS = 8 * 1024;
/** A checkpoint older than this is removed at startup (record expiry). */
export const AGENT_OUTPUT_CHECKPOINT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const segmentSchema = z.custom<CliOutputSegment>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { content?: unknown }).content === 'string',
);

export const AgentOutputCheckpointSchema = z
  .object({
    agentId: z.string().min(1),
    seq: z.number().int().positive(),
    at: z.iso.datetime({ offset: true }),
    stdoutTail: z.string().max(AGENT_OUTPUT_CHECKPOINT_MAX_STDOUT_CHARS),
    segmentsTail: z.array(segmentSchema).max(AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENTS),
    changedFiles: z
      .array(z.string())
      .max(AGENT_OUTPUT_CHECKPOINT_MAX_CHANGED_FILES),
  })
  .strict();

export type AgentOutputCheckpoint = z.infer<typeof AgentOutputCheckpointSchema>;

/** The live output the journal copies from (the process manager). */
export interface AgentOutputSource {
  readOutput(
    agentId: string,
  ): { readonly stdout: string; readonly segments: readonly CliOutputSegment[] } | undefined;
  /** True while at least one lane in this host runs. */
  hasRunningLanes(): boolean;
}

export interface AgentOutputJournalOptions {
  readonly intervalMs?: number;
  readonly now?: () => number;
}

const checkpointKey = (agentId: string): string =>
  `${AGENT_OUTPUT_CHECKPOINT_KEY_PREFIX}${agentId}`;

function tail(value: string, max: number): string {
  return value.length > max ? value.slice(-max) : value;
}

/** One segment cut to its bounded fields; a large raw tool input is dropped. */
function boundSegment(segment: CliOutputSegment): CliOutputSegment {
  const { toolInput, ...rest } = segment;
  const keepInput =
    toolInput !== undefined &&
    JSON.stringify(toolInput).length <= MAX_SEGMENT_FIELD_CHARS;
  return {
    ...rest,
    content: tail(segment.content, MAX_SEGMENT_FIELD_CHARS),
    ...(segment.toolArgs !== undefined
      ? { toolArgs: tail(segment.toolArgs, MAX_SEGMENT_FIELD_CHARS) }
      : {}),
    ...(keepInput ? { toolInput } : {}),
  };
}

/** Newest segments that fit the count and byte budgets, in original order. */
function segmentsTail(segments: readonly CliOutputSegment[]): CliOutputSegment[] {
  const kept: CliOutputSegment[] = [];
  // Brackets plus one separator per element: never under the array's JSON size.
  let bytes = 2;
  for (let index = segments.length - 1; index >= 0; index--) {
    if (kept.length >= AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENTS) break;
    const bounded = boundSegment(segments[index]);
    bytes += JSON.stringify(bounded).length + 1;
    if (bytes > AGENT_OUTPUT_CHECKPOINT_MAX_SEGMENT_BYTES) break;
    kept.push(bounded);
  }
  return kept.reverse();
}

/** Paths from `file-change` segments, no repeats, the most recent kept. */
function changedFiles(segments: readonly CliOutputSegment[]): string[] {
  const seen = new Set<string>();
  for (const segment of segments) {
    const path = segment.type === 'file-change' ? segment.content.trim() : '';
    if (path === '') continue;
    seen.delete(path);
    seen.add(path);
  }
  return [...seen]
    .slice(-AGENT_OUTPUT_CHECKPOINT_MAX_CHANGED_FILES)
    .map((path) => tail(path, MAX_SEGMENT_FIELD_CHARS));
}

export class AgentOutputJournal {
  private readonly dirty = new Set<string>();
  private readonly seqs = new Map<string, number>();
  /** Per-lane write chain: a delete never overtakes the write before it. */
  private readonly chains = new Map<string, Promise<unknown>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(
    private readonly storage: IStateStorage,
    private readonly logger: Logger,
    private readonly source: () => AgentOutputSource,
    options: AgentOutputJournalOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? AGENT_OUTPUT_CHECKPOINT_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  /** The lane's output changed. No write here; the next tick writes it. */
  markDirty(agentId: string): void {
    this.dirty.add(agentId);
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => {
        this.logger.error(
          '[AgentOutputJournal] Checkpoint tick failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  /** True while the shared interval runs. */
  isRunning(): boolean {
    return this.timer !== undefined;
  }

  /** Write every dirty lane once, then stop the interval when no lane runs. */
  async tick(): Promise<void> {
    const agentIds = [...this.dirty];
    this.dirty.clear();
    await Promise.all(agentIds.map((agentId) => this.write(agentId, true)));
    if (this.dirty.size === 0 && !this.source().hasRunningLanes()) this.stop();
  }

  /**
   * The exit write. Resolves to the written sequence, or undefined when
   * nothing was written; never rejects.
   */
  checkpointNow(agentId: string): Promise<number | undefined> {
    this.dirty.delete(agentId);
    const written = this.write(agentId, false);
    if (this.dirty.size === 0 && !this.source().hasRunningLanes()) this.stop();
    return written;
  }

  /**
   * Remove the checkpoint once the exit reference is durable. `uptoSeq` keeps a
   * newer turn's checkpoint written meanwhile.
   */
  remove(agentId: string, uptoSeq: number): Promise<void> {
    return this.enqueue(agentId, async () => {
      const current = this.read(agentId);
      if (!current || current.seq > uptoSeq) return;
      try {
        await this.storage.update(checkpointKey(agentId), undefined);
      } catch (error: unknown) {
        this.logger.error(
          '[AgentOutputJournal] Checkpoint delete failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  /** The latest complete checkpoint; a malformed or unreadable one is ignored. */
  read(agentId: string): AgentOutputCheckpoint | undefined {
    let raw: unknown;
    try {
      raw = this.storage.get<unknown>(checkpointKey(agentId));
    } catch (error: unknown) {
      // degradation-audit: reported - logged here; restore then uses the reference's own output.
      this.logger.warn('[AgentOutputJournal] Checkpoint read failed', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
    if (raw === undefined || raw === null) return undefined;
    const parsed = AgentOutputCheckpointSchema.safeParse(raw);
    if (!parsed.success || parsed.data.agentId !== agentId) {
      this.logger.warn('[AgentOutputJournal] Ignored a malformed checkpoint', {
        agentId,
      });
      return undefined;
    }
    return parsed.data;
  }

  /** Remove expired and malformed checkpoints (record expiry). Never rejects. */
  async pruneExpired(): Promise<number> {
    try {
      if (hasStateStorageReadiness(this.storage)) await this.storage.whenReady();
      const cutoff = this.now() - AGENT_OUTPUT_CHECKPOINT_RETENTION_MS;
      let removed = 0;
      for (const key of this.storage.keys()) {
        if (!key.startsWith(AGENT_OUTPUT_CHECKPOINT_KEY_PREFIX)) continue;
        const parsed = AgentOutputCheckpointSchema.safeParse(this.storage.get(key));
        if (parsed.success && Date.parse(parsed.data.at) >= cutoff) continue;
        await this.storage.update(key, undefined);
        removed++;
      }
      return removed;
    } catch (error: unknown) {
      this.logger.error(
        '[AgentOutputJournal] Checkpoint expiry sweep failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return 0;
    }
  }

  /** Stop the interval; pending dirty lanes are written by the next start. */
  dispose(): void {
    this.stop();
  }

  private stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private write(agentId: string, retryOnFailure: boolean): Promise<number | undefined> {
    return this.enqueue(agentId, async () => {
      try {
        const output = this.source().readOutput(agentId);
        if (!output) return undefined;
        const seq =
          Math.max(this.seqs.get(agentId) ?? 0, this.read(agentId)?.seq ?? 0) + 1;
        const checkpoint: AgentOutputCheckpoint = {
          agentId,
          seq,
          at: new Date(this.now()).toISOString(),
          stdoutTail: tail(output.stdout, AGENT_OUTPUT_CHECKPOINT_MAX_STDOUT_CHARS),
          segmentsTail: segmentsTail(output.segments),
          changedFiles: changedFiles(output.segments),
        };
        await this.storage.update(checkpointKey(agentId), checkpoint);
        this.seqs.set(agentId, seq);
        return seq;
      } catch (error: unknown) {
        // The previous checkpoint stays the latest complete one.
        this.logger.error(
          '[AgentOutputJournal] Checkpoint write failed; retrying next tick',
          error instanceof Error ? error : new Error(String(error)),
        );
        if (retryOnFailure) this.markDirty(agentId);
        return undefined;
      }
    });
  }

  private enqueue<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(agentId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.chains.set(agentId, next);
    // The caller owns `next` and its outcome; this branch only drops the chain.
    const release = (): void => {
      if (this.chains.get(agentId) === next) this.chains.delete(agentId);
    };
    void next.then(release, release);
    return next;
  }
}
