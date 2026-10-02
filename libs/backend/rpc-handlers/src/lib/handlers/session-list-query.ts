/**
 * `session:list` organization query (TASK_2026_580). Pure: no I/O, the input
 * array is not mutated.
 *
 * A request is in QUERY MODE when it carries at least one query field
 * (`status`, `priority`, `taskId`, `pinned`, `hasPr`, `text`, `sort`,
 * `groupBy`). Without query mode the rows, their order and the total are
 * returned exactly as given (archived and pinned rows included, L3/L4).
 *
 * In query mode:
 *  1. organization filters, only when the organization map is present:
 *     `status` (no stored row reads as `active`; `archived` is excluded unless
 *     `status` lists it), `priority`, `pinned`, `hasPr`, `taskId`;
 *  2. `text`: case-insensitive substring of the session name;
 *  3. sort: pinned first and then the `groupBy` key (both only when the map is
 *     present, L4/L5), then the `sort` key, ties broken by `lastActiveAt`
 *     descending.
 */
import {
  SESSION_ORGANIZATION_DEFAULTS,
  SESSION_PRIORITIES,
  SESSION_WORKFLOW_STATUSES,
  type SessionListGroup,
  type SessionListSort,
  type SessionPriority,
  type SessionWorkflowStatus,
} from '@ptah-extension/shared';
import type { StoredOrganization } from '@ptah-extension/session-organization';
import type { SessionListQueryParams } from './session-organization-rpc.schema';

/** The row fields the query reads (a `SessionMetadata` satisfies it). */
export interface SessionListQueryRow {
  readonly sessionId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export type SessionListQuery = SessionListQueryParams;

export type SessionOrganizationMap = ReadonlyMap<string, StoredOrganization>;

export interface SessionListQueryResult<T> {
  rows: T[];
  total: number;
}

const QUERY_KEYS = [
  'status',
  'priority',
  'taskId',
  'pinned',
  'hasPr',
  'text',
  'sort',
  'groupBy',
] as const satisfies readonly (keyof SessionListQuery)[];

/** Whether the request carries at least one query field. */
export function isSessionListQueryMode(query: SessionListQuery): boolean {
  return QUERY_KEYS.some((key) => query[key] !== undefined);
}

/**
 * Filter and sort `rows` for `session:list`. `orgMap` is `undefined` when the
 * host serves no organization; then only `text` and `sort` apply.
 */
export function applySessionListQuery<T extends SessionListQueryRow>(
  rows: readonly T[],
  orgMap: SessionOrganizationMap | undefined,
  query: SessionListQuery,
): SessionListQueryResult<T> {
  if (!isSessionListQueryMode(query)) {
    return { rows: [...rows], total: rows.length };
  }

  const keep = buildPredicate(orgMap, query);
  const ranked = rows
    .map((row): Ranked<T> => ({ row, org: orgMap?.get(row.sessionId) }))
    .filter((r) => keep(r.row, r.org));

  const sort = query.sort ?? 'lastActive';
  const groupBy = orgMap ? (query.groupBy ?? 'none') : 'none';
  ranked.sort(
    (a, b) =>
      (orgMap ? Number(pinnedOf(b.org)) - Number(pinnedOf(a.org)) : 0) ||
      compareGroup(groupBy, a, b) ||
      compareSort(sort, a, b) ||
      b.row.lastActiveAt - a.row.lastActiveAt,
  );

  return { rows: ranked.map((r) => r.row), total: ranked.length };
}

type Predicate = (
  row: SessionListQueryRow,
  org: StoredOrganization | undefined,
) => boolean;

function buildPredicate(
  orgMap: SessionOrganizationMap | undefined,
  query: SessionListQuery,
): Predicate {
  const needle =
    query.text !== undefined && query.text.length > 0
      ? query.text.toLowerCase()
      : undefined;
  const matchesText = (row: SessionListQueryRow): boolean =>
    needle === undefined || row.name.toLowerCase().includes(needle);
  if (!orgMap) return matchesText;

  const statuses = nonEmptySet(query.status);
  const priorities = nonEmptySet(query.priority);
  const { pinned, hasPr, taskId } = query;
  return (row, org) => {
    const status = statusOf(org);
    if (statuses ? !statuses.has(status) : status === 'archived') return false;
    if (priorities && !priorities.has(priorityOf(org))) return false;
    if (pinned !== undefined && pinnedOf(org) !== pinned) return false;
    if (hasPr !== undefined) {
      const rowHasPr = (org?.prLinks.length ?? 0) > 0;
      if (rowHasPr !== hasPr) return false;
    }
    if (taskId !== undefined && !org?.tasks.some((t) => t.taskId === taskId)) {
      return false;
    }
    return matchesText(row);
  };
}

interface Ranked<T extends SessionListQueryRow = SessionListQueryRow> {
  row: T;
  org: StoredOrganization | undefined;
}

function compareGroup(group: SessionListGroup, a: Ranked, b: Ranked): number {
  switch (group) {
    case 'none':
      return 0;
    case 'status':
      return (
        SESSION_WORKFLOW_STATUSES.indexOf(statusOf(a.org)) -
        SESSION_WORKFLOW_STATUSES.indexOf(statusOf(b.org))
      );
    case 'task':
      return compareNullableText(taskKeyOf(a.org), taskKeyOf(b.org));
    case 'parent': {
      // A child's key is its parent id and a root's key is its own id, so a
      // parent and its children stay contiguous; the root leads its group.
      const byKey = compareNullableText(parentKeyOf(a), parentKeyOf(b));
      if (byKey !== 0) return byKey;
      return Number(isChild(a)) - Number(isChild(b));
    }
  }
}

function compareSort(sort: SessionListSort, a: Ranked, b: Ranked): number {
  switch (sort) {
    case 'lastActive':
      return b.row.lastActiveAt - a.row.lastActiveAt;
    case 'priority':
      // The tuple order IS the sort order (urgent first).
      return (
        SESSION_PRIORITIES.indexOf(priorityOf(a.org)) -
        SESSION_PRIORITIES.indexOf(priorityOf(b.org))
      );
    case 'created':
      return b.row.createdAt - a.row.createdAt;
    case 'name':
      return compareText(a.row.name, b.row.name);
  }
}

function statusOf(org: StoredOrganization | undefined): SessionWorkflowStatus {
  return org?.status ?? SESSION_ORGANIZATION_DEFAULTS.status;
}

function priorityOf(org: StoredOrganization | undefined): SessionPriority {
  return org?.priority ?? SESSION_ORGANIZATION_DEFAULTS.priority;
}

function pinnedOf(org: StoredOrganization | undefined): boolean {
  return org?.pinned ?? SESSION_ORGANIZATION_DEFAULTS.pinned;
}

/** The primary task id, else the first linked task id, else none. */
function taskKeyOf(org: StoredOrganization | undefined): string | null {
  const tasks = org?.tasks ?? [];
  return (tasks.find((t) => t.role === 'primary') ?? tasks[0])?.taskId ?? null;
}

function parentKeyOf(r: Ranked): string {
  return r.org?.parentSessionId ?? r.row.sessionId;
}

function isChild(r: Ranked): boolean {
  return (r.org?.parentSessionId ?? null) !== null;
}

function nonEmptySet<T>(values: readonly T[] | undefined): Set<T> | undefined {
  return values && values.length > 0 ? new Set(values) : undefined;
}

/** Case-insensitive, deterministic (no locale). */
function compareText(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 0;
  return al < bl ? -1 : 1;
}

/** Rows without a key sort after every keyed row. */
function compareNullableText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareText(a, b);
}
