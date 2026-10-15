import type { IStateStorage } from '@ptah-extension/platform-core';

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

export class KeyValueOutcomeJournal<T> {
  private value: JournalValue<T>;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: IStateStorage,
    nowMs = Date.now(),
  ) {
    const saved = storage.get<JournalValue<T>>(OUTCOME_JOURNAL_KEY);
    this.value = {
      nextSeq: saved?.nextSeq ?? 1,
      entries: saved?.entries ?? [],
      droppedAtCapacity: saved?.droppedAtCapacity ?? 0,
      heldRuns: KeyValueOutcomeJournal.prune(saved?.heldRuns ?? [], nowMs),
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
      if (value.entries.length >= OUTCOME_JOURNAL_LIMIT) {
        return { ...value, droppedAtCapacity: value.droppedAtCapacity + 1 };
      }
      accepted = true;
      return {
        ...value,
        nextSeq: value.nextSeq + 1,
        entries: [...value.entries, { seq: value.nextSeq, op }],
      };
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
