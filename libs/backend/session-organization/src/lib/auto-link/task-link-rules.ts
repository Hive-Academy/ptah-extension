/**
 * Automatic session <-> task link rules (TASK_2026_854), pure.
 *
 * One precedence table (decisions.md RR1-1). Lower rank wins:
 *
 * | Rule | Source        | Rank | Evidence                                   |
 * | ---- | ------------- | ---- | ------------------------------------------ |
 * | R1   | `user`        | 0    | protected, never written here              |
 * | R2   | `agent`       | 1    | protected (also legacy `board-start`)      |
 * | R3   | `orchestrate` | 2    | `/orchestrate <TASK id>` prompt (kept)     |
 * | R4   | `worktree`    | 3    | the worktree folder or branch names it     |
 * | R5   | `worktree`    | 4    | worktree peers' explicit/R3 primary        |
 * | R7   | `inherited`   | 5    | every link of the fork source              |
 * | R6   | `inherited`   | 6    | the parent's primary, as `related`         |
 *
 * `planAutoLinks` is a full reconcile: from the current rows, the suppressed
 * tasks and the complete desired automatic set it returns exactly the writes
 * that make the stored automatic rows match. The result depends only on that
 * state, never on the order events arrived in, and a second run returns no
 * writes.
 */
import type {
  SessionTaskLinkRole,
  SessionTaskLinkSource,
} from '@ptah-extension/shared';
import {
  MAX_TASK_ID_LENGTH,
  TASK_ID_PATTERN,
  TASK_ID_TOKEN_SOURCE,
} from '@ptah-extension/shared/schemas';

/** Rules that write automatic links, in stored form (`auto_rule`). */
export const AUTO_RULES = ['R3', 'R4', 'R5', 'R6', 'R7'] as const;
export type AutoRule = (typeof AUTO_RULES)[number];

/** Sources only an explicit write produces; automatic rules never touch them. */
const PROTECTED_SOURCES: ReadonlySet<SessionTaskLinkSource> = new Set([
  'user',
  'agent',
  'board-start',
]);

const RULE_RANK: Readonly<Record<AutoRule, number>> = {
  R3: 2,
  R4: 3,
  R5: 4,
  R7: 5,
  R6: 6,
};

const RULE_SOURCE: Readonly<Record<AutoRule, SessionTaskLinkSource>> = {
  R3: 'orchestrate',
  R4: 'worktree',
  R5: 'worktree',
  R6: 'inherited',
  R7: 'inherited',
};

/** Longest prompt prefix the `/orchestrate` parser looks at. */
const MAX_PROMPT_SCAN = 64 * 1024;

const ORCHESTRATE_LINE = new RegExp(
  `^/orchestrate\\s+(${TASK_ID_TOKEN_SOURCE})(?=\\s|$)`,
);

/** A task id inside a name, bounded by non-alphanumerics on both sides. */
const BOUNDED_TASK_ID = new RegExp(
  `(?<![A-Za-z0-9])(${TASK_ID_TOKEN_SOURCE})(?![A-Za-z0-9])`,
  'g',
);

export function isAutoRule(value: string | null): value is AutoRule {
  return value !== null && (AUTO_RULES as readonly string[]).includes(value);
}

export function isProtectedSource(source: SessionTaskLinkSource): boolean {
  return PROTECTED_SOURCES.has(source);
}

export function sourceOfRule(rule: AutoRule): SessionTaskLinkSource {
  return RULE_SOURCE[rule];
}

export function rankOfRule(rule: AutoRule): number {
  return RULE_RANK[rule];
}

/** One stored link as the planner sees it. */
export interface CurrentTaskLink {
  taskId: string;
  role: SessionTaskLinkRole;
  source: SessionTaskLinkSource;
  /** The owning automatic rule; null for an explicit (protected) link. */
  autoRule: string | null;
  autoEvidence: string | null;
  createdAt: number;
}

/** One link an automatic rule asks for, from the current evidence. */
export interface AutoCandidate {
  taskId: string;
  rule: AutoRule;
  /** The role the rule asks for; `primary` may still end up `related`. */
  role: SessionTaskLinkRole;
  evidence: string | null;
}

/** One row write of a plan. */
export type TaskLinkWrite =
  | {
      kind: 'upsert';
      taskId: string;
      role: SessionTaskLinkRole;
      source: SessionTaskLinkSource;
      autoRule: AutoRule;
      autoEvidence: string | null;
    }
  | { kind: 'delete'; taskId: string };

interface RankedCandidate extends AutoCandidate {
  /** Stored `created_at` of an R3 row; 0 for every other rule. */
  order: number;
}

/**
 * A row is automatic exactly when it records a known rule. Anything else —
 * explicit sources, legacy rows, a rule this build does not know — is
 * protected and never written.
 */
function isAutomatic(link: CurrentTaskLink): boolean {
  return isAutoRule(link.autoRule);
}

function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  return (
    rankOfRule(a.rule) - rankOfRule(b.rule) ||
    a.order - b.order ||
    (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0)
  );
}

/**
 * The writes that make the automatic rows of one session match the evidence.
 *
 * 1. Protected rows are never written; a suppressed task is never output.
 * 2. Automatic R4-R7 rows whose (task, rule) is not desired any more are
 *    deleted (their evidence vanished). R3 rows are kept: their evidence is a
 *    prompt event that cannot vanish.
 * 3. Candidates are the kept R3 rows plus `desired`, minus protected and
 *    suppressed tasks. A task keeps its best-ranked candidate. They sort by
 *    rank, then R3 creation time (first `/orchestrate` wins), then task id.
 * 4. With a protected primary every candidate is `related`. Otherwise the
 *    first candidate that asks for `primary` gets it; the rest are `related`.
 * 5. Only rows that differ from `current` are written. Deletes come first and
 *    the primary write last, so the store's demote-then-write never collides.
 */
export function planAutoLinks(
  current: readonly CurrentTaskLink[],
  suppressed: ReadonlySet<string>,
  desired: readonly AutoCandidate[],
): TaskLinkWrite[] {
  const protectedRows = current.filter((link) => !isAutomatic(link));
  const protectedTasks = new Set(protectedRows.map((link) => link.taskId));
  const hasProtectedPrimary = protectedRows.some(
    (link) => link.role === 'primary',
  );

  const pool: RankedCandidate[] = [];
  for (const link of current) {
    if (link.autoRule === 'R3') {
      pool.push({
        taskId: link.taskId,
        rule: 'R3',
        role: 'primary',
        evidence: link.autoEvidence,
        order: link.createdAt,
      });
    }
  }
  for (const candidate of desired) {
    const stored = current.find(
      (link) => link.taskId === candidate.taskId && link.autoRule === 'R3',
    );
    pool.push({
      ...candidate,
      order: candidate.rule === 'R3' ? (stored?.createdAt ?? Infinity) : 0,
    });
  }

  const best = new Map<string, RankedCandidate>();
  for (const candidate of pool) {
    if (protectedTasks.has(candidate.taskId)) continue;
    if (suppressed.has(candidate.taskId)) continue;
    const kept = best.get(candidate.taskId);
    if (kept === undefined || compareCandidates(candidate, kept) < 0) {
      best.set(candidate.taskId, candidate);
    }
  }
  const ordered = [...best.values()].sort(compareCandidates);

  let primaryTaken = hasProtectedPrimary;
  const target = new Map<string, Extract<TaskLinkWrite, { kind: 'upsert' }>>();
  for (const candidate of ordered) {
    const role: SessionTaskLinkRole =
      !primaryTaken && candidate.role === 'primary' ? 'primary' : 'related';
    if (role === 'primary') primaryTaken = true;
    target.set(candidate.taskId, {
      kind: 'upsert',
      taskId: candidate.taskId,
      role,
      source: sourceOfRule(candidate.rule),
      autoRule: candidate.rule,
      autoEvidence: candidate.evidence,
    });
  }

  const deletes: TaskLinkWrite[] = [];
  const relatedWrites: TaskLinkWrite[] = [];
  const primaryWrites: TaskLinkWrite[] = [];
  for (const link of current) {
    if (isAutomatic(link) && !target.has(link.taskId)) {
      deletes.push({ kind: 'delete', taskId: link.taskId });
    }
  }
  for (const write of target.values()) {
    const existing = current.find((link) => link.taskId === write.taskId);
    if (
      existing !== undefined &&
      existing.role === write.role &&
      existing.source === write.source &&
      existing.autoRule === write.autoRule &&
      existing.autoEvidence === write.autoEvidence
    ) {
      continue;
    }
    (write.role === 'primary' ? primaryWrites : relatedWrites).push(write);
  }
  return [...deletes, ...relatedWrites, ...primaryWrites];
}

// ── Evidence parsers ────────────────────────────────────────────────────────

function isTaskId(value: string): boolean {
  return value.length <= MAX_TASK_ID_LENGTH && TASK_ID_PATTERN.test(value);
}

/**
 * R3 from a raw prompt: its first non-blank line is `/orchestrate <TASK id>`
 * followed by whitespace or the end of the line. Returns the id or null.
 */
export function parseOrchestrateTaskId(prompt: string): string | null {
  if (typeof prompt !== 'string') return null;
  const scanned = prompt.slice(0, MAX_PROMPT_SCAN);
  const firstLine = scanned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return null;
  const match = ORCHESTRATE_LINE.exec(firstLine);
  const id = match?.[1];
  return id !== undefined && isTaskId(id) ? id : null;
}

/**
 * R3 from a slash-command expansion: the `orchestrate` command whose first
 * argument is exactly a task id. Returns the id or null.
 */
export function parseOrchestrateExpansion(
  skillSlug: string,
  expansionType: string,
  commandArgs: string,
): string | null {
  if (skillSlug !== 'orchestrate' || expansionType !== 'slash_command') {
    return null;
  }
  if (typeof commandArgs !== 'string') return null;
  const first = commandArgs.slice(0, MAX_PROMPT_SCAN).trim().split(/\s+/)[0];
  return first !== undefined && isTaskId(first) ? first : null;
}

/** Last path segment of a path in either separator style. */
function baseName(path: string): string {
  const segments = path.split(/[\\/]/).filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? '';
}

/**
 * R4 evidence: the distinct task ids named by the worktree folder name and
 * the branch, each bounded by non-alphanumerics. A hit is only a candidate:
 * the caller still checks that the task folder exists.
 */
export function taskIdsInWorktreeName(
  worktreePath: string | null,
  branch: string | null,
): string[] {
  const ids = new Set<string>();
  for (const name of [
    worktreePath === null ? '' : baseName(worktreePath),
    branch ?? '',
  ]) {
    for (const match of name.matchAll(BOUNDED_TASK_ID)) {
      const id = match[1];
      if (id !== undefined && isTaskId(id)) ids.add(id);
    }
  }
  return [...ids].sort();
}

/** R4 evidence string: the worktree path and branch at decision time. */
export function worktreeEvidence(
  worktreePath: string,
  branch: string | null,
): string {
  return `${worktreePath}\u0000${branch ?? ''}`;
}
