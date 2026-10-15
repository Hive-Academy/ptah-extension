import type { IStateStorage } from '@ptah-extension/platform-core';
import { z } from 'zod';

export const OUTCOME_JOURNAL_KEY = 'ptah.laneOutcomes.journal.v1';
export const OUTCOME_REJECTED_KEY = 'ptah.laneOutcomes.journal.rejected.v1';
export const OUTCOME_JOURNAL_LIMIT = 5000;

export interface HeldRunIndex {
  readonly runId: string;
  readonly expiresAt: number;
  readonly holdExpiries: readonly number[];
}

export interface JournalEntry<T> {
  readonly seq: number;
  readonly op: T;
}

export interface JournalValue<T> {
  readonly nextSeq: number;
  readonly entries: readonly JournalEntry<T>[];
  readonly droppedAtCapacity: number;
  readonly heldRuns: readonly HeldRunIndex[];
}

const HeldRunSchema = z.object({
  runId: z.string(),
  expiresAt: z.number().finite(),
  holdExpiries: z.array(z.number().finite()),
});
const EntrySchema = z.object({
  seq: z.number().int().positive(),
  op: z.unknown(),
});

function validItems<T>(items: readonly unknown[], schema: z.ZodType<T>): T[] {
  return items.flatMap((item) => {
    try {
      return [schema.parse(item)];
    } catch {
      // degradation-audit: reported - malformed journal entries are dropped and counted
      return [];
    }
  });
}

export function appendEntries<T>(
  value: JournalValue<T>,
  ops: readonly T[],
): { value: JournalValue<T>; accepted: readonly boolean[] } {
  let next = value;
  const accepted: boolean[] = [];
  for (const op of ops) {
    const fits = next.entries.length < OUTCOME_JOURNAL_LIMIT;
    accepted.push(fits);
    next = fits
      ? {
          ...next,
          nextSeq: next.nextSeq + 1,
          entries: [...next.entries, { seq: next.nextSeq, op }],
        }
      : { ...next, droppedAtCapacity: next.droppedAtCapacity + 1 };
  }
  return { value: next, accepted };
}

function emptyValue<T>(): JournalValue<T> {
  return { nextSeq: 1, entries: [], droppedAtCapacity: 0, heldRuns: [] };
}

export class KeyValueOutcomeJournal<T> {
  private value: JournalValue<T>;
  private tail: Promise<void> = Promise.resolve();
  readonly droppedOnRead: number;

  constructor(
    private readonly storage: IStateStorage,
    nowMs = Date.now(),
  ) {
    const saved = storage.get<unknown>(OUTCOME_JOURNAL_KEY);
    if (saved === undefined) {
      this.value = emptyValue();
      this.droppedOnRead = 0;
      return;
    }
    let envelope: {
      nextSeq: number;
      entries: unknown[];
      droppedAtCapacity: number;
      heldRuns: unknown[];
    };
    try {
      envelope = z
        .object({
          nextSeq: z.number().int().positive(),
          entries: z.array(z.unknown()),
          droppedAtCapacity: z.number().int().nonnegative(),
          heldRuns: z.array(z.unknown()),
        })
        .parse(saved);
    } catch {
      // degradation-audit: reported - unreadable journal envelopes start empty and are warned
      this.value = emptyValue();
      this.droppedOnRead = 1;
      return;
    }
    const entries = validItems(envelope.entries, EntrySchema).map((entry) => ({
      seq: entry.seq,
      op: entry.op as T,
    }));
    const heldRuns = validItems(envelope.heldRuns, HeldRunSchema);
    this.droppedOnRead =
      envelope.entries.length -
      entries.length +
      envelope.heldRuns.length -
      heldRuns.length;
    this.value = {
      nextSeq: Math.max(
        envelope.nextSeq,
        ...entries.map((entry) => entry.seq + 1),
      ),
      entries,
      droppedAtCapacity: envelope.droppedAtCapacity,
      heldRuns: KeyValueOutcomeJournal.prune(heldRuns, nowMs),
    };
  }

  snapshot(): JournalValue<T> {
    return structuredClone(this.value);
  }

  async update(
    edit: (value: JournalValue<T>) => JournalValue<T>,
    nowMs = Date.now(),
  ): Promise<JournalValue<T>> {
    const write = this.tail.then(async () => {
      const draft = edit(this.snapshot());
      const next: JournalValue<T> = {
        ...draft,
        heldRuns: KeyValueOutcomeJournal.prune(draft.heldRuns, nowMs),
      };
      await this.storage.update(OUTCOME_JOURNAL_KEY, next);
      this.value = next;
      return this.snapshot();
    });
    this.tail = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  async append(op: T): Promise<boolean> {
    let accepted = false;
    await this.update((value) => {
      const result = appendEntries(value, [op]);
      accepted = result.accepted[0];
      return result.value;
    });
    return accepted;
  }

  static prune(runs: readonly HeldRunIndex[], nowMs: number): HeldRunIndex[] {
    return runs.flatMap((run) => {
      const holdExpiries = run.holdExpiries.filter((expiry) => expiry > nowMs);
      return holdExpiries.length
        ? [
            {
              ...run,
              expiresAt: run.expiresAt > nowMs ? run.expiresAt : 0,
              holdExpiries,
            },
          ]
        : [];
    });
  }
}
