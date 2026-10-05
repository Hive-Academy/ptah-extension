import {
  buildTurnSourceSnapshot,
  type ExecutionChatMessage,
  type TurnChangeSet,
  type TurnSourceSnapshot,
  type TurnUsageSnapshotSource,
} from '@ptah-extension/shared';
import {
  transcriptOrderKey,
  type ChangeSetAnchors,
} from './transcript-change-set-anchors';
import { groupTurns, type TranscriptTurn } from './transcript-turns';

/** Message id → the snapshot its `ptah-ui` blocks resolve `$diff`/`$tests`/`$usage` from. */
export type TurnSnapshots = ReadonlyMap<string, TurnSourceSnapshot>;

export const NO_TURN_SNAPSHOTS: TurnSnapshots = new Map();

/**
 * The still-open turn's snapshot: every source pending, exactly what
 * `buildTurnSourceSnapshot` returns for an unfinalized turn. One frozen object
 * so a growing turn's blocks keep one snapshot identity and do not re-run
 * their pipeline per streaming delta.
 */
const PENDING_TURN_SNAPSHOT: TurnSourceSnapshot = {
  state: 'pending',
  incomplete: false,
  diff: { kind: 'pending' },
  tests: { kind: 'pending' },
  usage: { kind: 'pending' },
};

/** What one recompute reads; all of it comes from the transcript's gated view. */
export interface TurnSnapshotSources {
  readonly messages: readonly ExecutionChatMessage[];
  /** `vm().streamingBoundary`: a message at or past it is still streaming. */
  readonly streamingBoundary: number;
  /** The session's change sets, oldest first (`ChangeSetStore.changeSetsFor`). */
  readonly changeSets: readonly TurnChangeSet[];
  /** The card placement the transcript renders (`anchorChangeSets`). */
  readonly anchors: ChangeSetAnchors;
  /** `ChangeSetStore.settledThrough`: sets are final up to this backend time. */
  readonly settledThrough: number;
}

type TurnChangeSetResolution = TurnChangeSet | null | 'pending';

/** One turn's inputs and its per-message snapshots, reused while unchanged. */
interface TurnSnapshotEntry {
  readonly changeSet: TurnChangeSetResolution;
  readonly assistants: readonly ExecutionChatMessage[];
  readonly snapshots: readonly TurnSourceSnapshot[];
}

/**
 * The change set covering one message — the `anchorInTurnWindow` window rule
 * (`transcript-change-set-anchors.ts`) generalised from "the last assistant
 * message in a change set's `(turnStartedAt, turnEndedAt]` window" to "the
 * change set whose window contains this message's order key" (plan §4,
 * decision 12). `changeSets` is oldest-first, so the newest covering window
 * wins.
 */
export function changeSetForMessage(
  message: ExecutionChatMessage,
  changeSets: readonly TurnChangeSet[],
): TurnChangeSet | null {
  const key = transcriptOrderKey(message);
  for (let index = changeSets.length - 1; index >= 0; index -= 1) {
    const changeSet = changeSets[index];
    if (changeSet.turnStartedAt < key && key <= changeSet.turnEndedAt) {
      return changeSet;
    }
  }
  return null;
}

/**
 * Fallback when no window covers the turn-ending message (a clock the two
 * sides do not share): the newest change set the anchor join places after
 * that same message, skew fallback included, so `$diff` and the card never
 * disagree about a turn the join already resolved.
 */
function anchoredChangeSetFor(
  anchors: ChangeSetAnchors,
  messageId: string,
): TurnChangeSet | null {
  const anchored = anchors.get(messageId);
  if (anchored === undefined || anchored.length === 0) return null;
  return anchored[anchored.length - 1];
}

/**
 * A finalized turn's change set. With none covering it, the newest turn
 * stays `pending` only while its end is past the store's settled-through
 * mark: the backend pushes nothing for a turn that changed no files, so once
 * the mark passes the turn, no set means none (Req 3.4, plan A-6). An older
 * turn with none is `unavailable` at once.
 */
function resolveChangeSet(
  turn: TranscriptTurn,
  isNewest: boolean,
  sources: TurnSnapshotSources,
): TurnChangeSetResolution {
  if (!turn.finalized) return 'pending';
  const end = turn.assistants[turn.assistants.length - 1];
  const covering =
    changeSetForMessage(end, sources.changeSets) ??
    anchoredChangeSetFor(sources.anchors, turn.endMessageId);
  if (covering !== null) return covering;
  return isNewest && transcriptOrderKey(end) > sources.settledThrough
    ? 'pending'
    : null;
}

/** `$usage` of one message, without walking the turn's trees again. */
function usageOf(message: ExecutionChatMessage): TurnUsageSnapshotSource {
  return buildTurnSourceSnapshot({
    turnMessages: [],
    blockMessage: message,
    changeSet: null,
    finalized: true,
  }).usage;
}

/**
 * One snapshot per assistant message of a finalized turn: `$diff` and
 * `$tests` are the turn's, `$usage` is the message's own (plan L-11). An
 * open turn shares {@link PENDING_TURN_SNAPSHOT}.
 */
function buildSnapshots(
  assistants: readonly ExecutionChatMessage[],
  changeSet: TurnChangeSetResolution,
  finalized: boolean,
): readonly TurnSourceSnapshot[] {
  if (!finalized) return assistants.map(() => PENDING_TURN_SNAPSHOT);
  const end = assistants[assistants.length - 1];
  const turnSnapshot = buildTurnSourceSnapshot({
    turnMessages: assistants,
    blockMessage: end,
    changeSet,
    finalized: true,
  });
  return assistants.map((message) =>
    message === end
      ? turnSnapshot
      : { ...turnSnapshot, usage: usageOf(message) },
  );
}

function sameMessages(
  left: readonly ExecutionChatMessage[],
  right: readonly ExecutionChatMessage[],
): boolean {
  return (
    left.length === right.length &&
    left.every((message, index) => message === right[index])
  );
}

/**
 * Turn-source snapshots per message (TASK_2026_610 PR C, component 4), with
 * an identity-stable cache: a turn whose change set and assistant messages
 * are unchanged keeps its snapshot objects, so a recompute re-runs no live
 * block's pipeline. Each recompute keeps only the turns still present, and a
 * session change starts the cache over. No reactivity of its own: the
 * transcript's gated `computed` calls {@link compute}.
 */
export class TranscriptTurnSnapshots {
  private entries = new Map<string, TurnSnapshotEntry>();
  private sessionId: string | null = null;

  compute(
    sessionId: string | null,
    sources: TurnSnapshotSources,
  ): TurnSnapshots {
    const previous =
      sessionId === this.sessionId
        ? this.entries
        : new Map<string, TurnSnapshotEntry>();
    this.sessionId = sessionId;
    const turns = groupTurns(sources.messages, sources.streamingBoundary);
    const entries = new Map<string, TurnSnapshotEntry>();
    const snapshots = new Map<string, TurnSourceSnapshot>();
    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      const changeSet = resolveChangeSet(
        turn,
        index === turns.length - 1,
        sources,
      );
      const cached = previous.get(turn.endMessageId);
      const entry =
        cached !== undefined &&
        cached.changeSet === changeSet &&
        sameMessages(cached.assistants, turn.assistants)
          ? cached
          : {
              changeSet,
              assistants: turn.assistants,
              snapshots: buildSnapshots(
                turn.assistants,
                changeSet,
                turn.finalized,
              ),
            };
      entries.set(turn.endMessageId, entry);
      turn.assistants.forEach((message, position) =>
        snapshots.set(message.id, entry.snapshots[position]),
      );
    }
    this.entries = entries;
    return snapshots.size === 0 ? NO_TURN_SNAPSHOTS : snapshots;
  }
}
