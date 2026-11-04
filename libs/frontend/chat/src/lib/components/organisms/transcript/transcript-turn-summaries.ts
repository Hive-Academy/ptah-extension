import {
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import type { TurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';
import type {
  ExecutionChatMessage,
  TurnChangeSet,
  TurnSourceSnapshot,
} from '@ptah-extension/shared';
import type { ChangeSetMarks } from '../../../services/change-set/change-set.store';
import {
  TRANSCRIPT_TURN_RECAP_LOADER,
  type TranscriptTurnRecap,
} from './transcript-turn-recap-loader';
import type { TurnSnapshots } from './transcript-turn-snapshots';

/** One built turn summary chip. */
export interface TranscriptTurnSummary {
  readonly model: TurnSummaryModel;
}

/** What the transcript hands its turn summaries. */
export interface TranscriptTurnSummariesInput {
  /** The transcript's slots (`vm().slots`); each record is read per slot. */
  readonly slots: Signal<readonly { readonly record: () => ExecutionChatMessage }[]>;
  /** The transcript's `ptahUiSnapshots` (Electron only, empty elsewhere). */
  readonly snapshots: Signal<TurnSnapshots>;
  /** `ChangeSetStore.marksFor`: the reconciled and conflicted files. */
  readonly marksFor: (changeSet: TurnChangeSet) => ChangeSetMarks;
}

/** What one finalized turn's summary is built from. */
interface TurnSummaryInput {
  readonly turnKey: string;
  /** The turn's last assistant message: the chip renders after it. */
  readonly endMessageId: string;
  /** The turn-end snapshot; terminal by construction. */
  readonly snapshot: TurnSourceSnapshot;
  /** The turn's recorded change set (the card's source), else `null`. */
  readonly changeSet: TurnChangeSet | null;
  readonly marks: ChangeSetMarks | null;
}

const NO_INPUTS: readonly TurnSummaryInput[] = [];
const NO_SUMMARIES: ReadonlyMap<string, TranscriptTurnSummary> = new Map();

/**
 * The host-built turn summaries of one transcript (TASK_2026_623, R6,
 * component 7; decisions #67, #101, #104): one chip per turn-ending message.
 *
 * - Inputs: each finalized turn's turn-end snapshot (data-flow step 7). A turn
 *   opens at a user message and ends at its last assistant message
 *   (`groupTurns`); one before the first user message has no turn key.
 * - `buildTurnSummaryModel` is a value of the lazy `turn-recap` entry, loaded
 *   through `TRANSCRIPT_TURN_RECAP_LOADER` once a turn may have a summary.
 *   Until it resolves no chip mounts; a failed load leaves the chips absent,
 *   and the next change of the inputs tries again (one attempt in flight, no
 *   retry inside a reactive tick).
 * - A completion after destroy is dropped. A resolved load stores only the
 *   module namespace, and the summaries are derived from the inputs current
 *   when they run, so a load that started for older turns or another tab id
 *   cannot supply them. Summary data lives only in these derived signals.
 *
 * Construct in an injection context (a component field initializer).
 */
export class TranscriptTurnSummaries {
  private readonly loadTurnRecap = inject(TRANSCRIPT_TURN_RECAP_LOADER);
  private readonly recap = signal<TranscriptTurnRecap | null>(null);
  private loading = false;
  private destroyed = false;

  private readonly inputs: Signal<readonly TurnSummaryInput[]>;
  private readonly built: Signal<ReadonlyMap<string, TranscriptTurnSummary>>;

  /** The summary chip of each turn-ending message id. */
  readonly chips: Signal<ReadonlyMap<string, TranscriptTurnSummary>>;

  constructor(private readonly source: TranscriptTurnSummariesInput) {
    this.inputs = computed(() => this.collectInputs(), {
      equal: sameInputs,
    });
    this.built = computed(() => this.build());
    this.chips = computed(() => this.built());

    effect(() => {
      if (this.recap() !== null || this.inputs().length === 0) return;
      untracked(() => this.requestRecap());
    });
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  private collectInputs(): readonly TurnSummaryInput[] {
    const snapshots = this.source.snapshots();
    if (snapshots.size === 0) return NO_INPUTS;
    const inputs: TurnSummaryInput[] = [];
    let turnKey: string | null = null;
    let endMessageId: string | null = null;
    const closeTurn = (): void => {
      if (turnKey === null || endMessageId === null) return;
      const snapshot = snapshots.get(endMessageId);
      if (snapshot === undefined || !mayHaveSummary(snapshot)) return;
      const changeSet =
        snapshot.diff.kind === 'available' ? snapshot.diff.changeSet : null;
      inputs.push({
        turnKey,
        endMessageId,
        snapshot,
        changeSet,
        marks: changeSet === null ? null : this.source.marksFor(changeSet),
      });
    };
    for (const slot of this.source.slots()) {
      const record = slot.record();
      if (record.role === 'user') {
        closeTurn();
        turnKey = record.id;
        endMessageId = null;
      } else if (record.role === 'assistant' && turnKey !== null) {
        endMessageId = record.id;
      }
    }
    closeTurn();
    return inputs.length === 0 ? NO_INPUTS : inputs;
  }

  /** One model per turn; `null` (no files, no tests: R6.4) has no entry. */
  private build(): ReadonlyMap<string, TranscriptTurnSummary> {
    const recap = this.recap();
    const inputs = this.inputs();
    if (recap === null || inputs.length === 0) return NO_SUMMARIES;
    const byEndMessage = new Map<string, TranscriptTurnSummary>();
    for (const input of inputs) {
      const model = recap.buildTurnSummaryModel(input.snapshot, input.marks);
      if (model !== null) byEndMessage.set(input.endMessageId, { model });
    }
    return byEndMessage.size === 0 ? NO_SUMMARIES : byEndMessage;
  }

  private requestRecap(): void {
    if (this.loading || this.destroyed) return;
    this.loading = true;
    this.loadTurnRecap().then(
      (recap) => {
        this.loading = false;
        if (!this.destroyed) this.recap.set(recap);
      },
      (error: unknown) => {
        this.loading = false;
        if (this.destroyed) return;
        // The chunk is optional: no chip, transcript intact.
        console.warn(
          '[ChatTranscript] The turn summary chunk failed to load; turn summaries are unavailable.',
          error,
        );
      },
    );
  }
}

/**
 * A finalized turn that changed files or ran a test command, the only kind
 * `buildTurnSummaryModel` builds a model for (R6.4). Checked before the lazy
 * entry loads, so a session of no-op turns never fetches it.
 */
function mayHaveSummary(snapshot: TurnSourceSnapshot): boolean {
  return (
    snapshot.state === 'terminal' &&
    (snapshot.diff.kind === 'available' ||
      (snapshot.tests.kind === 'available' && snapshot.tests.runs.length > 0))
  );
}

/** Equal inputs keep the previous array, so a streaming tick rebuilds no model. */
function sameInputs(
  left: readonly TurnSummaryInput[],
  right: readonly TurnSummaryInput[],
): boolean {
  return (
    left.length === right.length &&
    left.every((input, index) => {
      const other = right[index];
      return (
        input.turnKey === other.turnKey &&
        input.endMessageId === other.endMessageId &&
        input.snapshot === other.snapshot &&
        input.changeSet === other.changeSet &&
        input.marks === other.marks
      );
    })
  );
}
