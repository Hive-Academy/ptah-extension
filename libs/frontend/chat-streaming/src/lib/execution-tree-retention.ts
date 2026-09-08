/**
 * Execution Tree Retention
 *
 * The bound a FINALIZED `ExecutionNode` tree puts on the tool payloads it
 * keeps in the renderer heap for the rest of the tab's life.
 *
 * ## The rule this obeys, verbatim from its sibling
 *
 * `agent-output-retention.ts:8-19` — **silent truncation of a user's own
 * content is a defect, not an optimization.** A cap the user cannot see is
 * indistinguishable from data corruption. So every cap here either FOLDS what
 * it drops back into what survives, or leaves a marker saying what went — and
 * the marker is emitted whether or not the fold succeeded.
 *
 * ## What is capped, and what deliberately is not
 *
 * - `toolOutput` — the dominant term. A `Read` of a large file, a `Grep`, a
 *   `Bash` with long stdout all land here verbatim.
 * - `toolInput` — second. A `Write` or `Edit` carries whole file contents in
 *   its arguments.
 * - **`content` is NOT capped.** For `text` and `thinking` nodes that is the
 *   assistant's prose — the thing the transcript exists to show, and the thing
 *   the user re-reads. Capping it would trade the product for the bytes.
 * - `agentPrompt` and `summaryContent` are not capped either. They are smaller,
 *   and their render path was not audited when this was written. Deferred on
 *   purpose rather than left as a silent gap.
 *
 * ## Why the slice geometry differs from `capBuffer`
 *
 * `capBuffer` front-truncates, because it bounds a LIVE, GROWING stdout buffer
 * where recency is everything. A finalized tool result is static: its identity
 * lives in its opening lines (which file, which command) and its conclusion in
 * its last. So this keeps a head AND a tail with the marker between them. The
 * precedent constrains the rule (fold or mark), not the geometry — `capSegments`
 * already uses a third geometry for the same reason.
 *
 * ## Why the marker is a typed field and not a re-parsed regex
 *
 * `agent-output-retention.ts` writes in-band markers and exports recognizers
 * because its subject is a flat `string` with nowhere else to put the fact. An
 * `ExecutionNode` is a typed object, so the fact goes in
 * `ExecutionNode.retention`. Re-applying this pass therefore accumulates counts
 * by reading a NUMBER, never by re-parsing its own prose. The in-band line is
 * written as well, so a user who copies the payload out takes the fact along.
 *
 * ## What recovery this promises
 *
 * Only what exists. The bytes are not destroyed — the SDK's own JSONL still
 * holds them — but there is no per-message re-read RPC: `chat:resume` is
 * whole-session and itself drops everything before the last compaction. So the
 * marker says "reopen the session", and says the reload is partial. It does NOT
 * promise a click-to-expand re-fetch, because none exists.
 */

import type {
  ExecutionNode,
  NodeRetentionField,
  NodeRetentionNotice,
} from '@ptah-extension/shared';

// ============================================================================
// Budgets — the only four numbers in this module
// ============================================================================

/**
 * Maximum characters retained for a single node's `toolOutput`.
 *
 * Calibrated against `MAX_FRONTEND_BUFFER` (50 KB, the live agent-card stdout
 * bound) and set BELOW it on purpose: that cap bounds one running agent's
 * buffer, this one is paid once per tool call and a long turn has hundreds.
 * 24 KB is far more text than a person reads out of a tool card, and the drop
 * is durable for the life of the stored tab, so it is deliberately generous.
 */
export const MAX_RETAINED_TOOL_OUTPUT_CHARS = 24 * 1024;

/**
 * Maximum characters retained for a single node's `toolInput`.
 *
 * Smaller than the output budget because an input is arguments, and the one
 * case that gets large — a `Write` whose `content` is a whole file — is the
 * case the user can also open in the editor. 16 KB still holds a ~400-line
 * source file verbatim.
 */
export const MAX_RETAINED_TOOL_INPUT_CHARS = 16 * 1024;

/**
 * Maximum characters of retained tool payload across an ENTIRE finalized
 * message tree, spent newest-node-first.
 *
 * Per-node capping alone does not bound a turn that ran two hundred small
 * tools, none of which individually exceeds its budget. This is the bound on
 * that shape. Newest-first because the tail of a turn is what the user just
 * watched happen and is the part they scroll back to.
 */
export const MAX_RETAINED_MESSAGE_CHARS = 256 * 1024;

/**
 * Characters kept from the END of a folded payload, ahead of the head slice.
 *
 * A tool result's conclusion — the error line, the last match, the summary —
 * is in its final characters, and a head-only truncation throws exactly that
 * away. Capped at half the field budget so a tiny budget still yields a head.
 */
export const RETAINED_PAYLOAD_TAIL_CHARS = 2 * 1024;

// ============================================================================
// The marker
// ============================================================================

/**
 * How the user gets the dropped bytes back. Deliberately modest: reopening the
 * session replays the SDK transcript, and that replay drops everything before
 * the last compaction. Promising more than this would be the same lie a silent
 * truncation tells, just with more words.
 */
const RECOVERY_SENTENCE =
  "The full text is in this session's transcript on disk — reopen the session " +
  'to reload it (a reload drops anything before the last compaction).';

/** The line written INTO a folded payload, between its head and its tail. */
function inBandFoldMarker(dropped: number): string {
  return `\n… ${dropped} characters dropped to bound this transcript. ${RECOVERY_SENTENCE}\n`;
}

/** The whole payload, for the case where nothing at all could be preserved. */
function inBandFailureMarker(reason: string): string {
  return `… this payload could not be preserved (${reason}). ${RECOVERY_SENTENCE}`;
}

/**
 * Key the failure marker is written under when the payload is a `toolInput`,
 * which is typed `Record<string, unknown>` and so cannot be replaced by a bare
 * string the way `toolOutput` can.
 */
const TRUNCATED_INPUT_KEY = 'truncated';

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Bound the tool payloads of one finalized message tree.
 *
 * Copy-on-write: returns `root` BY REFERENCE when nothing was over budget,
 * matching `markStreamingNodesAsInterrupted`'s shape, and never mutates any
 * input node — `ExecutionTreeBuilderService` holds those in its identity maps.
 *
 * Deliberately not built with `createExecutionNode`: that factory re-applies
 * defaults for `status`, `content`, `children` and `isCollapsed`, which would
 * silently reset a finalized node. Object spread of the existing node is the
 * only correct rewrite.
 *
 * Never throws. A defect in capping must not be able to lose a turn, so an
 * unexpected failure returns the original tree uncapped rather than propagating
 * out of the turn-commit path.
 */
export function capFinalizedTree(root: ExecutionNode): ExecutionNode {
  try {
    return capTree(root);
  } catch {
    return root;
  }
}

function capTree(root: ExecutionNode): ExecutionNode {
  const flat: ExecutionNode[] = [];
  collectDepthFirst(root, flat);

  const rewrites = new Map<ExecutionNode, ExecutionNode>();
  let remaining = MAX_RETAINED_MESSAGE_CHARS;

  // Newest first. `collectDepthFirst` emits document order, and a finalized
  // tree's document order is chronological, so walking it backwards spends the
  // whole-message budget on the end of the turn.
  for (let i = flat.length - 1; i >= 0; i--) {
    const node = flat[i];
    const result = capNodePayloads(node, Math.max(remaining, 0));
    remaining -= result.retainedChars;
    if (result.node !== node) rewrites.set(node, result.node);
  }

  if (rewrites.size === 0) return root;
  return rebuild(root, rewrites);
}

function collectDepthFirst(node: ExecutionNode, out: ExecutionNode[]): void {
  out.push(node);
  for (const child of node.children) collectDepthFirst(child, out);
}

/**
 * Rebuild the tree around the rewritten nodes, preserving object identity for
 * every subtree that contains none of them.
 */
function rebuild(
  node: ExecutionNode,
  rewrites: ReadonlyMap<ExecutionNode, ExecutionNode>,
): ExecutionNode {
  let childrenChanged = false;
  const children = node.children.map((child) => {
    const updated = rebuild(child, rewrites);
    if (updated !== child) childrenChanged = true;
    return updated;
  });

  const self = rewrites.get(node) ?? node;
  return childrenChanged ? { ...self, children } : self;
}

// ============================================================================
// Per-node capping
// ============================================================================

interface NodeCapResult {
  readonly node: ExecutionNode;
  /** Characters of payload this node still holds, charged to the tree budget. */
  readonly retainedChars: number;
}

/** Fixed emission order, so `NodeRetentionNotice.capped` is deterministic. */
const RETENTION_FIELD_ORDER: readonly NodeRetentionField[] = [
  'toolInput',
  'toolOutput',
];

function capNodePayloads(
  node: ExecutionNode,
  treeBudget: number,
): NodeCapResult {
  const prior = node.retention;
  const capped = new Set<NodeRetentionField>(prior?.capped ?? []);
  let droppedChars = prior?.droppedChars ?? 0;
  let foldFailed = prior?.foldFailed ?? false;
  let reason = prior?.reason;
  let changed = false;
  let retainedChars = 0;
  let remaining = treeBudget;

  let nextInput = node.toolInput;
  let nextOutput = node.toolOutput;

  // A field this pass already bounded is never bounded a second time. That is
  // the property `capBuffer` has to re-parse its own notice to get; here it is
  // a field read, so re-application is stable and its counts accumulate rather
  // than compounding a truncation of a truncation.
  if (node.toolInput !== undefined) {
    if (capped.has('toolInput')) {
      retainedChars += measuredLength(node.toolInput);
      remaining -= measuredLength(node.toolInput);
    } else {
      const outcome = capToolInput(
        node.toolInput,
        Math.min(MAX_RETAINED_TOOL_INPUT_CHARS, Math.max(remaining, 0)),
      );
      retainedChars += outcome.retainedChars;
      remaining -= outcome.retainedChars;
      if (outcome.dropped > 0 || outcome.reason !== undefined) {
        nextInput = outcome.value;
        droppedChars += outcome.dropped;
        capped.add('toolInput');
        changed = true;
        if (outcome.reason !== undefined) {
          foldFailed = true;
          reason ??= outcome.reason;
        }
      }
    }
  }

  if (node.toolOutput !== undefined) {
    if (capped.has('toolOutput')) {
      retainedChars += measuredLength(node.toolOutput);
    } else {
      const outcome = capToolOutput(
        node.toolOutput,
        Math.min(MAX_RETAINED_TOOL_OUTPUT_CHARS, Math.max(remaining, 0)),
      );
      retainedChars += outcome.retainedChars;
      if (outcome.dropped > 0 || outcome.reason !== undefined) {
        nextOutput = outcome.value;
        droppedChars += outcome.dropped;
        capped.add('toolOutput');
        changed = true;
        if (outcome.reason !== undefined) {
          foldFailed = true;
          reason ??= outcome.reason;
        }
      }
    }
  }

  if (!changed) return { node, retainedChars };

  const retention: NodeRetentionNotice = {
    droppedChars,
    capped: RETENTION_FIELD_ORDER.filter((field) => capped.has(field)),
    foldFailed,
    ...(reason !== undefined ? { reason } : {}),
  };

  return {
    node: { ...node, toolInput: nextInput, toolOutput: nextOutput, retention },
    retainedChars,
  };
}

// ============================================================================
// Payload folding
// ============================================================================

interface CapOutcome<T> {
  readonly value: T;
  /** Characters removed by THIS application. Zero when nothing was over. */
  readonly dropped: number;
  /** Characters the payload still occupies after this application. */
  readonly retainedChars: number;
  /** Present only when serialization failed and nothing was preserved. */
  readonly reason?: string;
}

/**
 * Bound a `toolOutput`.
 *
 * A non-string payload under budget is kept as the OBJECT it is, so the
 * specialized renderers (`isTodoWriteToolInput`, `isEditToolOutput`) still get
 * their shape. Over budget it becomes the folded STRING form and falls back to
 * `CodeOutputComponent` — a todo list or an edit diff past 24 KB is not a todo
 * list or a diff in any useful sense, so the fallback is the honest rendering.
 */
function capToolOutput(value: unknown, budget: number): CapOutcome<unknown> {
  const serialized = serialize(value);
  if (serialized.error !== undefined) {
    const marker = inBandFailureMarker(serialized.error);
    return {
      value: marker,
      dropped: 0,
      retainedChars: marker.length,
      reason: serialized.error,
    };
  }

  if (serialized.text.length <= budget) {
    return { value, dropped: 0, retainedChars: serialized.text.length };
  }

  const folded = foldText(serialized.text, budget);
  return {
    value: folded.kept,
    dropped: folded.dropped,
    retainedChars: folded.kept.length,
  };
}

/**
 * Bound a `toolInput`, entry by entry, SMALLEST FIRST.
 *
 * Smallest-first rather than declaration order because the small entries are
 * the identifying ones — `file_path`, `command`, `pattern` — and they must
 * survive whatever the big one does to the budget. A `Write` therefore keeps
 * its path and folds its `content`, which is the whole point.
 */
function capToolInput(
  input: Record<string, unknown>,
  budget: number,
): CapOutcome<Record<string, unknown>> {
  const entries = Object.entries(input);
  const measured = entries.map(([key, value]) => ({
    key,
    value,
    serialized: serialize(value),
  }));

  const totalChars = measured.reduce(
    (sum, entry) => sum + entry.serialized.text.length,
    0,
  );
  const anyFailure = measured.some(
    (entry) => entry.serialized.error !== undefined,
  );
  if (!anyFailure && totalChars <= budget) {
    return { value: input, dropped: 0, retainedChars: totalChars };
  }

  const order = [...measured].sort(
    (a, b) => a.serialized.text.length - b.serialized.text.length,
  );

  const replacements = new Map<string, unknown>();
  let dropped = 0;
  let retainedChars = 0;
  let reason: string | undefined;
  let remaining = budget;

  for (const entry of order) {
    if (entry.serialized.error !== undefined) {
      const marker = inBandFailureMarker(entry.serialized.error);
      replacements.set(entry.key, marker);
      retainedChars += marker.length;
      reason ??= entry.serialized.error;
      continue;
    }

    const text = entry.serialized.text;
    if (text.length <= remaining) {
      remaining -= text.length;
      retainedChars += text.length;
      continue;
    }

    const folded = foldText(text, Math.max(remaining, 0));
    remaining = 0;
    dropped += folded.dropped;
    retainedChars += folded.kept.length;
    replacements.set(entry.key, folded.kept);
  }

  if (replacements.size === 0) {
    return { value: input, dropped: 0, retainedChars };
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    next[key] = replacements.has(key) ? replacements.get(key) : value;
  }
  // A record whose every entry failed to serialize carries no key worth
  // showing; the marker is the content, under a key that reads as one.
  if (Object.keys(next).length === 0) {
    next[TRUNCATED_INPUT_KEY] = inBandFailureMarker(reason ?? 'empty input');
  }

  return {
    value: next,
    dropped,
    retainedChars,
    ...(reason !== undefined ? { reason } : {}),
  };
}

/**
 * Characters an already-bounded payload still occupies, so it is charged to the
 * whole-message budget even though it is not re-folded.
 */
function measuredLength(value: unknown): number {
  return serialize(value).text.length;
}

interface Serialized {
  /** The payload as text. Empty string is only meaningful when `error` is set. */
  readonly text: string;
  /** Why the payload could not be turned into text at all. */
  readonly error?: string;
}

/**
 * Turn a payload into text, or say why it cannot be.
 *
 * A payload that cannot be serialized here also cannot survive the
 * `localStorage` round trip the finalized tree is persisted through, so
 * refusing to keep it is not a loss the cap causes — it is a loss the cap makes
 * VISIBLE.
 */
function serialize(value: unknown): Serialized {
  if (typeof value === 'string') return { text: value };
  try {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') {
      return { text: '', error: `a ${typeof value} has no JSON form` };
    }
    return { text };
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : 'serialization failed';
    return { text: '', error: detail };
  }
}

interface FoldedText {
  readonly kept: string;
  readonly dropped: number;
}

/**
 * Keep a head and a tail of `text` within `budget`, with one marker line
 * between them naming the dropped character count.
 *
 * The marker itself is allowed to push the result slightly past `budget`. That
 * is the precedent's trade in `capBuffer`: the notice always survives, because
 * a bounded payload with no notice is the defect this module exists to prevent.
 * A budget of zero yields the marker alone.
 */
function foldText(text: string, budget: number): FoldedText {
  if (text.length <= budget) return { kept: text, dropped: 0 };

  const tail = Math.min(RETAINED_PAYLOAD_TAIL_CHARS, Math.floor(budget / 2));
  const head = Math.max(0, budget - tail);
  const dropped = text.length - head - tail;
  if (dropped <= 0) return { kept: text, dropped: 0 };

  const kept =
    text.slice(0, head) +
    inBandFoldMarker(dropped) +
    (tail > 0 ? text.slice(text.length - tail) : '');
  return { kept, dropped };
}
