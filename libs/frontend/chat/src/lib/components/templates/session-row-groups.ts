/**
 * Sidebar row grouping (TASK_2026_580, plan component 11).
 *
 * Pure: turns the loaded `session:list` rows into the groups the sidebar
 * renders. The server already orders rows by group key (after pinned rows);
 * this only adds the headers and, for `parent`, the nesting. Groups appear in
 * the order their first row arrives, so a pinned row's group leads.
 */
import type {
  ChatSessionSummary,
  SessionListGroup,
} from '@ptah-extension/shared';
import { SESSION_STATUS_LABELS } from '../atoms/session-organization-chips/session-organization-labels';

/** One sidebar row; `depth` is its nesting under a parent row (0 = top). */
export interface SessionRow {
  readonly session: ChatSessionSummary;
  readonly depth: number;
}

/** A run of rows under one header; `label` is null when there is no header. */
export interface SessionRowGroup {
  readonly key: string;
  readonly label: string | null;
  readonly rows: readonly SessionRow[];
}

/** Deeper nesting is drawn at this depth; the order is still parent first. */
export const MAX_SESSION_ROW_DEPTH = 3;

/**
 * Group `sessions` by `groupBy`. `none` (and `parent`) yield one headerless
 * group; `parent` nests each loaded child under its loaded parent. A child
 * whose parent is not loaded stays a top-level row.
 */
export function groupSessionRows(
  sessions: readonly ChatSessionSummary[] | null | undefined,
  groupBy: SessionListGroup,
): SessionRowGroup[] {
  // No rows, no groups: the sidebar's empty state needs an empty list. A
  // missing list is read as empty: this runs in change detection, and a throw
  // here would abort the whole shell render.
  if (!sessions || sessions.length === 0) return [];
  switch (groupBy) {
    case 'none':
      return [{ key: 'all', label: null, rows: flat(sessions) }];
    case 'parent':
      return [{ key: 'all', label: null, rows: nestByParent(sessions) }];
    case 'status':
      return byKey(sessions, (session) => {
        const status = session.organization?.status ?? 'active';
        return { key: status, label: SESSION_STATUS_LABELS[status] };
      });
    case 'task':
      return byKey(sessions, (session) => {
        const tasks = session.organization?.tasks ?? [];
        const task = tasks.find((t) => t.role === 'primary') ?? tasks[0];
        return task
          ? { key: `task:${task.taskId}`, label: task.taskId }
          : { key: 'no-task', label: 'No task' };
      });
  }
}

function flat(sessions: readonly ChatSessionSummary[]): SessionRow[] {
  return sessions.map((session) => ({ session, depth: 0 }));
}

function byKey(
  sessions: readonly ChatSessionSummary[],
  keyOf: (session: ChatSessionSummary) => { key: string; label: string },
): SessionRowGroup[] {
  const groups = new Map<string, { label: string; rows: SessionRow[] }>();
  for (const session of sessions) {
    const { key, label } = keyOf(session);
    let group = groups.get(key);
    if (!group) {
      group = { label, rows: [] };
      groups.set(key, group);
    }
    group.rows.push({ session, depth: 0 });
  }
  return [...groups].map(([key, group]) => ({
    key,
    label: group.label,
    rows: group.rows,
  }));
}

function nestByParent(sessions: readonly ChatSessionSummary[]): SessionRow[] {
  const loaded = new Set<string>(sessions.map((s) => s.id));
  const parentOf = (session: ChatSessionSummary): string | null => {
    const parent = session.organization?.parentSessionId ?? null;
    // A self-reference or an unloaded parent leaves the row at the top.
    return parent !== null && parent !== session.id && loaded.has(parent)
      ? parent
      : null;
  };

  const children = new Map<string, ChatSessionSummary[]>();
  const roots: ChatSessionSummary[] = [];
  for (const session of sessions) {
    const parent = parentOf(session);
    if (parent === null) {
      roots.push(session);
      continue;
    }
    const list = children.get(parent);
    if (list) list.push(session);
    else children.set(parent, [session]);
  }

  const rows: SessionRow[] = [];
  const placed = new Set<string>();
  const visit = (session: ChatSessionSummary, depth: number): void => {
    if (placed.has(session.id)) return;
    placed.add(session.id);
    rows.push({ session, depth: Math.min(depth, MAX_SESSION_ROW_DEPTH) });
    for (const child of children.get(session.id) ?? []) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots) visit(root, 0);
  // A parent cycle has no root; keep every row visible, in list order.
  for (const session of sessions) visit(session, 0);
  return rows;
}
