import {
  classifyTestCommand,
  collectTurnTests,
  type ExecutionChatMessage,
  type ExecutionNode,
  type TurnTestRun,
} from '@ptah-extension/shared';

/**
 * One transcript turn: a user message plus every assistant message after it,
 * up to the next user message (TASK_2026_610 Batch A4, plan §4 PR A).
 *
 * There is no turn id anywhere in a transcript — `SessionHistoryReplayer`
 * rebuilds messages from raw stream events, so nothing in a replayed
 * transcript carries one (see `transcript-change-set-anchors.ts`). Turn
 * identity is therefore positional, the same rule the change-set anchor
 * fallback uses: the turn ends at its LAST assistant message.
 */
export interface TranscriptTurn {
  /**
   * The turn's last assistant message. The tests row renders right after it,
   * next to the change-set card that anchors the same way.
   */
  readonly endMessageId: string;
  /**
   * The turn's assistant messages in transcript order; the last one is the
   * turn-ending message ({@link endMessageId}).
   */
  readonly assistants: readonly ExecutionChatMessage[];
  /**
   * Root execution nodes of the turn's assistant messages, in transcript
   * order. A legacy assistant message with `streamingState: null` contributes
   * none — see the A-4 note on {@link groupTurns}.
   */
  readonly roots: readonly ExecutionNode[];
  /**
   * True once the turn's ending message is finalized (its index is below the
   * streaming boundary, `chat-transcript.component.ts` `vm().streamingBoundary`).
   * During history replay the boundary is the total count, so replayed turns
   * count as finalized and the row survives a reload (Req 1.8).
   */
  readonly finalized: boolean;
  /**
   * The turn ended without a clean completion (A-3): one of the turn's
   * assistant trees carries `interrupted`/`error` on its root, or a test
   * node never reached a terminal status. Only meaningful once
   * {@link finalized} is true; a still-streaming turn is simply not done.
   */
  readonly incomplete: boolean;
}

/** The tests row anchored after one turn-ending message. */
export interface TurnTestsAnchor {
  /** The turn's test runs, in execution order (see `collectTurnTests`). */
  readonly runs: readonly TurnTestRun[];
  /** The turn aborted or errored (see {@link TranscriptTurn.incomplete}). */
  readonly incomplete: boolean;
}

/** Message id → the test runs rendered right after that message. */
export type TurnTestsAnchors = ReadonlyMap<string, TurnTestsAnchor>;

export const NO_TURN_TESTS_ANCHORS: TurnTestsAnchors = new Map();

/**
 * Group transcript messages into turns: a user message starts a turn, and the
 * turn ends at the last assistant message before the next user message
 * (plan §4 PR A). Roles other than `user`/`assistant` are skipped: they
 * neither start nor end a turn. An assistant message that appears before the
 * first user message belongs to no turn — its turn's user message lives on an
 * unloaded older page, so it gets no row rather than a partial one, the same
 * conservatism as the change-set anchor fallback.
 *
 * `streamingBoundary` is the finalized message count in the same list
 * (`vm().streamingBoundary`): a message is still streaming when its index is
 * at or past it. A turn is finalized when its ENDING message is below the
 * boundary — a turn whose last assistant message is still streaming is open.
 *
 * A-4 (legacy `streamingState`): every finalized assistant message is minted
 * with its tree as `streamingState` (`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:221-241`),
 * so a `null` tree is the legacy empty-root shape that service stopped
 * minting (`:181-191`). Such a message still ends its turn but contributes no
 * root, hence no test runs.
 */
export function groupTurns(
  messages: readonly ExecutionChatMessage[],
  streamingBoundary: number,
): readonly TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let assistants: ExecutionChatMessage[] = [];
  let roots: ExecutionNode[] = [];
  let endMessageId: string | null = null;
  let endIndex = -1;
  let turnStarted = false;

  const closeTurn = (): void => {
    if (endMessageId === null) return;
    const finalized = endIndex < streamingBoundary;
    turns.push({
      endMessageId,
      assistants,
      roots,
      finalized,
      incomplete: finalized && turnEndedIncomplete(roots),
    });
    assistants = [];
    roots = [];
    endMessageId = null;
    endIndex = -1;
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'user') {
      closeTurn();
      turnStarted = true;
    } else if (message.role === 'assistant' && turnStarted) {
      assistants.push(message);
      if (message.streamingState !== null) roots.push(message.streamingState);
      endMessageId = message.id;
      endIndex = index;
    }
  }
  closeTurn();
  return turns;
}

/**
 * A-3 (abort): an aborted turn is visible on the trees themselves —
 * `MessageFinalizationService.finalizeStreamingSession` maps every streaming
 * node, root included, to `interrupted` before the tree is retained
 * (`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:140-144, 337-355`),
 * and a failed turn ends with an `error` root. Independent of the abort path,
 * a test node that never reached a terminal status (its run resolves to
 * `unknown` in `collectTurnTests`) means the turn closed before the tests
 * finished. Either way the row must say so (Req 1.7).
 */
function turnEndedIncomplete(roots: readonly ExecutionNode[]): boolean {
  for (const root of roots) {
    if (root.status === 'interrupted' || root.status === 'error') return true;
  }
  return hasUnsettledTestNode(roots);
}

/**
 * A test-command Bash node whose status is neither `complete` nor `error` —
 * the same node filter `collectTurnTests` uses, so "incomplete" and an
 * unresolved `unknown` run agree.
 */
function isUnsettledTestNode(node: ExecutionNode): boolean {
  if (node.type !== 'tool' || node.toolName !== 'Bash') return false;
  const command = node.toolInput?.['command'];
  if (typeof command !== 'string' || !classifyTestCommand(command)) {
    return false;
  }
  return node.status !== 'complete' && node.status !== 'error';
}

function hasUnsettledTestNode(roots: readonly ExecutionNode[]): boolean {
  const visited = new Set<ExecutionNode>();
  const visit = (node: ExecutionNode): boolean => {
    if (visited.has(node)) return false;
    visited.add(node);
    if (isUnsettledTestNode(node)) return true;
    for (const child of node.children) {
      if (visit(child)) return true;
    }
    return false;
  };
  for (const root of roots) {
    if (visit(root)) return true;
  }
  return false;
}

/**
 * Join each finalized turn's test runs to the transcript message they render
 * after — the `anchorChangeSets` rule, applied to test runs. A turn that is
 * still streaming, that ran no test commands, or whose every assistant
 * message is a legacy `null`-tree message gets no entry, so nothing renders
 * (Req 1.4) and the row stays lazy. The caller gates on
 * `VSCodeService.isElectron` (plan decision 2); this stays pure so the gate
 * lives in one place.
 */
export function anchorTurnTests(
  messages: readonly ExecutionChatMessage[],
  streamingBoundary: number,
): TurnTestsAnchors {
  const turns = groupTurns(messages, streamingBoundary);
  if (turns.length === 0) return NO_TURN_TESTS_ANCHORS;
  const anchors = new Map<string, TurnTestsAnchor>();
  for (const turn of turns) {
    if (!turn.finalized) continue;
    const runs = collectTurnTests(turn.roots, { finalized: true });
    if (runs.length === 0) continue;
    anchors.set(turn.endMessageId, { runs, incomplete: turn.incomplete });
  }
  return anchors.size === 0 ? NO_TURN_TESTS_ANCHORS : anchors;
}
