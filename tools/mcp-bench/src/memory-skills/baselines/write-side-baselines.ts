/**
 * Pure write-side baselines for the memory arm (benchmark-design.md sections
 * 3.1-3.3). Each function documents the design line it implements and is
 * deterministic: no network, no model, no clock, no filesystem.
 *
 * A baseline is a policy the suites run over the same drafts as the real
 * pipeline, so a suite's numbers are comparable against a named alternative
 * (design rule R-M2). They are deliberately naive: that is the point of a
 * baseline, not a defect to fix.
 */

/** One transcript message of a seeded session, as the suites carry it. */
export interface TranscriptMessage {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly text: string;
}

/**
 * A written memory row as the pure baselines see it. The fact matcher reads
 * `subject + content + chunk text` (design R-M4), so both fields are kept even
 * for policies that do not use the subject.
 */
export interface BaselineMemoryRow {
  readonly subject: string;
  readonly content: string;
}

/** One side of a merge decision: a draft or a stored row with a subject. */
export interface MergeSubjectSide {
  readonly subject: string;
}

/**
 * Extract-all baseline (benchmark-design.md:128): every user and assistant
 * message line becomes a row. Recall ceiling and precision floor.
 *
 * "Message line" is read as one transcript message, because a JSONL transcript
 * carries one message per line. System and tool messages are not user or
 * assistant lines, so they produce no row. A message whose text is blank
 * carries no line to write, so it produces no row. The subject is the
 * message's first non-empty line; the design pins only that every line becomes
 * a row, and a first-line subject keeps the rows distinguishable for the merge
 * baselines without inventing any selection policy.
 */
export function extractAllBaseline(
  messages: readonly TranscriptMessage[],
): BaselineMemoryRow[] {
  const rows: BaselineMemoryRow[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const lines = message.text.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    rows.push({ subject: lines[0], content: message.text });
  }
  return rows;
}

/**
 * Byte-equal subject merge baseline (benchmark-design.md:139), the pre-563
 * path: two sides merge only when their subjects are byte-equal
 * (case-sensitive, whitespace-significant).
 */
export function byteEqualSubjectMerge(
  left: MergeSubjectSide,
  right: MergeSubjectSide,
): boolean {
  return left.subject === right.subject;
}

/**
 * Never-merge baseline (benchmark-design.md:139): no pair ever merges, so
 * every written row stays a separate active row. Merge recall 0.
 */
export function neverMerge(
  _left: MergeSubjectSide,
  _right: MergeSubjectSide,
): boolean {
  return false;
}

/**
 * Tier-1-only merge baseline (benchmark-design.md:139), the case-folded
 * subject window: two sides merge when their case-folded subjects are equal.
 * The fold mirrors tier 1's `TRIM(LOWER(m.subject))` subject key
 * (`libs/backend/memory-curator/src/lib/memory.store.ts:413`), so this policy
 * is what the merge path does when it acts on tier-1 candidates only.
 */
export function tier1CaseFoldedMerge(
  left: MergeSubjectSide,
  right: MergeSubjectSide,
): boolean {
  return subjectKey(left.subject) === subjectKey(right.subject);
}

function subjectKey(subject: string): string {
  return subject.trim().toLowerCase();
}

/** A row already classified against one update slot. */
export interface SlottedRow<Row> {
  readonly row: Row;
  /** Whether the row matches the slot, per the R-M4 fact matcher. */
  readonly matchesSlot: boolean;
  /** ISO-8601 timestamp of the chunk. */
  readonly createdAt: string;
}

/**
 * Latest-chunk-wins baseline (benchmark-design.md:156): among the rows that
 * match the slot, keep the newest chunk. `null` when nothing matches.
 *
 * On equal timestamps the later row in the input order wins, so the policy is
 * total and deterministic for any fixture.
 */
export function latestChunkWins<Row>(
  rows: readonly SlottedRow<Row>[],
): Row | null {
  let winner: SlottedRow<Row> | null = null;
  let winnerTimestampMs = Number.NEGATIVE_INFINITY;
  for (const entry of rows) {
    const timestampMs = parseIsoTimestamp(entry.createdAt);
    if (!entry.matchesSlot) continue;
    if (winner === null || timestampMs >= winnerTimestampMs) {
      winner = entry;
      winnerTimestampMs = timestampMs;
    }
  }
  return winner === null ? null : winner.row;
}

function parseIsoTimestamp(value: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  ) {
    throw new RangeError(`Expected an ISO-8601 timestamp, received ${value}.`);
  }
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) {
    throw new RangeError(`Expected an ISO-8601 timestamp, received ${value}.`);
  }
  return timestampMs;
}

/**
 * Append-only seed policy baseline (benchmark-design.md:99): a reseed appends
 * its rows and never supersedes an existing row. The product's seed path is
 * keyed by subject (`memory-writer.adapter.ts:5`); this baseline keeps every
 * existing row untouched and appends every reseed row, even one whose subject
 * already exists — that is exactly the behaviour `mem.update.seed` measures
 * against the "only the new value is retrievable" invariant.
 */
export function appendOnlySeed(
  existing: readonly BaselineMemoryRow[],
  reseed: readonly BaselineMemoryRow[],
): readonly BaselineMemoryRow[] {
  return [...existing, ...reseed];
}
