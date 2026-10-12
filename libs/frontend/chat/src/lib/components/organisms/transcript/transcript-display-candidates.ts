import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
// Type only: the display-panel entry is lazy (D14), so eager code never takes
// a value import from it. The import is erased at compile time.
import type { DisplayCandidate } from '@ptah-extension/chat-ui/display-panel';
import { hasPtahUiDisplayFenceLine } from '../execution/ptah-ui-fence-line';
import { transcriptOrderKey } from './transcript-change-set-anchors';

const NO_CANDIDATES: readonly DisplayCandidate[] = [];

/**
 * The transcript's display candidates (TASK_2026_623, D3, component 7): every
 * top-level assistant text node with a `ptah-ui display [id]` opener line, in
 * transcript order and text-node order (R2.8).
 *
 * - Scope (R2.11): text nodes reachable from an assistant message's tree
 *   through `message` nodes only — the rule that forwards the ptah-ui context
 *   (`execution-node.component.ts`, `@case ('message')`). User messages,
 *   thinking, tool output and `agent` subtrees never qualify.
 * - Gate: {@link hasPtahUiDisplayFenceLine}, a zero-import superset of the
 *   segmenter's display openers. The lazy sync segments each candidate and
 *   keeps the segments with `target === 'display'` (decision #26), so an
 *   unclosed (streaming) fence is a candidate that yields no fence yet (R2.7).
 * - `turnKey`: the id of the user message that opened the turn. An assistant
 *   message before the first user message belongs to no turn (its user
 *   message is on an unloaded older page; same rule as `groupTurns`) and
 *   yields no candidate.
 * - `live`: the message's index is at or past `streamingBoundary`, the rule
 *   the transcript uses for each bubble's `isStreaming`.
 * - `orderKey`: {@link transcriptOrderKey}, the clock the transcript merges
 *   finalized and streaming messages on, so it is stable across finalization.
 *
 * A4: the open turn's streaming assistant messages carry their live tree as
 * `streamingState`, so a candidate appears while its message streams. Pass
 * each message's CURRENT record (see batch-22-report.md, A4).
 *
 * Identity cache: pass the previous result as `previous`. A candidate whose
 * ids, text (length first, then content), order key, turn and live flag are
 * unchanged is the previous object, and when every candidate is unchanged the
 * previous array itself is returned, so a streaming tick that touches no
 * display text does not re-run the consumer. The cache lives in the caller's
 * previous result: there is no module-level state, so each transcript keeps
 * its own.
 *
 * `blockKey` is `messageId:nodeId`. Ids may contain `:`, so the key cannot be
 * split back into its parts: `messageId` and `nodeId` ride on the candidate
 * (decision #71). Downstream keys (`displayFenceKey`) are built the same way,
 * so of two nodes with the same `blockKey` only the first is a candidate.
 */
export function collectDisplayCandidates(
  messages: readonly ExecutionChatMessage[],
  streamingBoundary: number,
  previous: readonly DisplayCandidate[] = NO_CANDIDATES,
): readonly DisplayCandidate[] {
  const cache = new Map<string, DisplayCandidate>();
  for (const candidate of previous) cache.set(candidate.blockKey, candidate);

  const candidates: DisplayCandidate[] = [];
  const seen = new Set<string>();
  let turnKey: string | null = null;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'user') {
      turnKey = message.id;
      continue;
    }
    if (
      message.role !== 'assistant' ||
      turnKey === null ||
      message.streamingState === null
    ) {
      continue;
    }
    const orderKey = transcriptOrderKey(message);
    const live = index >= streamingBoundary;
    for (const node of topLevelTextNodes(message.streamingState)) {
      const text = node.content ?? '';
      if (!hasPtahUiDisplayFenceLine(text)) continue;
      const blockKey = `${message.id}:${node.id}`;
      if (seen.has(blockKey)) continue;
      seen.add(blockKey);
      const next: DisplayCandidate = {
        blockKey,
        messageId: message.id,
        nodeId: node.id,
        orderKey,
        text,
        turnKey,
        live,
      };
      const cached = cache.get(blockKey);
      candidates.push(
        cached !== undefined && sameCandidate(cached, next) ? cached : next,
      );
    }
  }

  return sameItems(previous, candidates) ? previous : candidates;
}

/** Text nodes reachable from `root` through `message` nodes, in tree order. */
function topLevelTextNodes(root: ExecutionNode): readonly ExecutionNode[] {
  const texts: ExecutionNode[] = [];
  const visit = (node: ExecutionNode): void => {
    if (node.type === 'text') {
      texts.push(node);
    } else if (node.type === 'message') {
      for (const child of node.children) visit(child);
    }
  };
  visit(root);
  return texts;
}

/** Same ids, order key, turn and live flag; text compared length first. */
function sameCandidate(a: DisplayCandidate, b: DisplayCandidate): boolean {
  return (
    a.messageId === b.messageId &&
    a.nodeId === b.nodeId &&
    a.orderKey === b.orderKey &&
    a.turnKey === b.turnKey &&
    a.live === b.live &&
    a.text.length === b.text.length &&
    a.text === b.text
  );
}

function sameItems(
  a: readonly DisplayCandidate[],
  b: readonly DisplayCandidate[],
): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
