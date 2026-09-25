import type { SurfaceViewState } from '@ptah-extension/declarative-dashboard';
import type { SurfaceUpdatedPayload } from '@ptah-extension/shared';
import {
  SURFACE_STORE_LIMITS,
  applySurfaceOps,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceStateView } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { AppsOperationOverlays } from './apps-operation-overlays';
import {
  acceptSurfaceView,
  guardSurfacePush,
  guardSurfaceReadResult,
} from './apps-surface-intake';
import type { AppsRenderable } from './apps-surface-intake';

/**
 * Per-routing-id surface reducer (implementation-plan.md:422-453, Rules 1-4
 * at :571-582, handoff-494.md (a) 2 and (c)).
 *
 * Pure: every transition returns a NEW state and never throws. No timers and
 * no DI; `AppsSurfaceSync` (Batch 12) issues the reads this module asks for.
 *
 * Revision rules:
 * - Rule 2: only an applied push or an applied `surface:read` result moves an
 *   entry's `materializedRevision`, atomically with its renderable.
 * - Rule 1: an RPC acknowledgement never reaches `materializedRevision`; it
 *   only settles an overlay (`updateSurfaceOverlays`).
 * - A materialized revision never moves backwards.
 */

/** One surface the page holds. */
export interface AppsSurfaceEntry {
  readonly surfaceId: string;
  /** The revision of the state the renderer actually holds (Rule 2). */
  readonly materializedRevision: number;
  readonly renderable: AppsRenderable;
  /** The slice `seq` at which a push or read last changed this entry. */
  readonly lastAppliedSeq: number;
  /** Rule 4 display overlays of this surface. */
  readonly overlays: AppsOperationOverlays;
  /** Local presentation state; reset whenever the agent replaces the surface. */
  readonly viewState: SurfaceViewState;
}

export interface AppsSurfaceNotice {
  readonly kind: 'evicted';
  readonly surfaceId: string;
  readonly text: string;
}

export interface AppsSurfaceState {
  readonly entries: ReadonlyMap<string, AppsSurfaceEntry>;
  /** Deleted surface id → the highest revision it may no longer be revived at. */
  readonly tombstones: ReadonlyMap<string, number>;
  readonly activeSurfaceId: string | null;
  /**
   * The surface the user picked in the switcher, or null when the user has
   * made no pick (or the picked surface is gone). While set, it stays the
   * active surface: agent writes never move the selection away from it.
   */
  readonly pickedSurfaceId: string | null;
  /** Slice-local counter; increments on every applied push or read. */
  readonly seq: number;
  readonly notice: AppsSurfaceNotice | null;
}

export type AppsReduceOutcome =
  /** The change was applied (the state moved). */
  | 'applied'
  /** The payload failed the structural guard; nothing changed. */
  | 'malformed'
  /** Already applied, or older than what the page holds; nothing changed. */
  | 'stale'
  /** The surface was deleted at or above this revision; nothing changed. */
  | 'tombstoned'
  /** `fromRevision` does not match the materialized revision (Rule 3). */
  | 'gap'
  /** Ops for a surface the page does not hold. */
  | 'unknown-surface'
  /** Ops for a surface whose content was rejected: only a read can recover. */
  | 'rejected-surface'
  /** `applySurfaceOps` refused the ops; nothing changed. */
  | 'ops-failed';

export interface AppsReduceResult {
  readonly state: AppsSurfaceState;
  readonly outcome: AppsReduceOutcome;
  /** Ask `AppsSurfaceSync` for a `surface:read`. */
  readonly needsRead: boolean;
}

export const APPS_EVICTED_NOTICE =
  'This app was removed to free memory. Ask the agent to rebuild it.';

/**
 * Tombstones only need to outlive pushes still in flight for a deleted id; a
 * bound keeps a long session from growing the map without limit.
 */
export const APPS_TOMBSTONE_LIMIT = 64;

const EMPTY_VIEW_STATE: SurfaceViewState = { components: {}, drafts: {} };

export function createAppsSurfaceState(): AppsSurfaceState {
  return {
    entries: new Map(),
    tombstones: new Map(),
    activeSurfaceId: null,
    pickedSurfaceId: null,
    seq: 0,
    notice: null,
  };
}

/**
 * The value to pass as `readSeq` to `applySurfaceRead`, captured when the
 * `surface:read` is SENT. An entry changed after that point is newer than
 * the read and survives its absence from the result.
 */
export function surfaceReadSeq(state: AppsSurfaceState): number {
  return state.seq;
}

function result(
  state: AppsSurfaceState,
  outcome: AppsReduceOutcome,
  needsRead = false,
): AppsReduceResult {
  return { state, outcome, needsRead };
}

function withTombstone(
  tombstones: ReadonlyMap<string, number>,
  surfaceId: string,
  revision: number,
): Map<string, number> {
  const next = new Map(tombstones);
  const previous = next.get(surfaceId);
  next.delete(surfaceId);
  next.set(surfaceId, Math.max(revision, previous ?? revision));
  while (next.size > APPS_TOMBSTONE_LIMIT) {
    const oldest = next.keys().next();
    if (oldest.done === true) break;
    next.delete(oldest.value);
  }
  return next;
}

/** The most recently changed entry, or null when none remains. */
function mostRecentSurfaceId(
  entries: ReadonlyMap<string, AppsSurfaceEntry>,
): string | null {
  let best: AppsSurfaceEntry | null = null;
  for (const entry of entries.values()) {
    if (
      best === null ||
      entry.lastAppliedSeq > best.lastAppliedSeq ||
      (entry.lastAppliedSeq === best.lastAppliedSeq &&
        entry.materializedRevision > best.materializedRevision)
    ) {
      best = entry;
    }
  }
  return best === null ? null : best.surfaceId;
}

function keepActive(
  active: string | null,
  entries: ReadonlyMap<string, AppsSurfaceEntry>,
): string | null {
  return active !== null && entries.has(active)
    ? active
    : mostRecentSurfaceId(entries);
}

/** The user's pick while its surface is still held; otherwise null. */
function keepPicked(
  picked: string | null,
  entries: ReadonlyMap<string, AppsSurfaceEntry>,
): string | null {
  return picked !== null && entries.has(picked) ? picked : null;
}

function clearNoticeFor(
  notice: AppsSurfaceNotice | null,
  surfaceId: string,
): AppsSurfaceNotice | null {
  return notice !== null && notice.surfaceId === surfaceId ? null : notice;
}

function applySnapshot(
  state: AppsSurfaceState,
  payload: SurfaceUpdatedPayload,
  view: SurfaceStateView,
): AppsReduceResult {
  const { surfaceId, revision } = payload;
  const existing = state.entries.get(surfaceId);
  if (existing !== undefined && revision <= existing.materializedRevision)
    return result(state, 'stale');
  const tombstone = state.tombstones.get(surfaceId);
  if (
    existing === undefined &&
    tombstone !== undefined &&
    revision <= tombstone
  )
    return result(state, 'tombstoned');

  const seq = state.seq + 1;
  const entries = new Map(state.entries);
  // Atomic replace: the renderable, revision and view state change together.
  // A rejected document still advances the revision (it shows the text
  // fallback); re-reading would return the same document.
  entries.set(surfaceId, {
    surfaceId,
    materializedRevision: revision,
    renderable: acceptSurfaceView(view),
    lastAppliedSeq: seq,
    overlays:
      existing === undefined
        ? AppsOperationOverlays.empty()
        : existing.overlays.retireSettledUpTo(revision),
    viewState: EMPTY_VIEW_STATE,
  });
  const tombstones = new Map(state.tombstones);
  tombstones.delete(surfaceId);
  // Only a surface the agent newly creates may take the selection, and only
  // while the user has picked none; an agent update to a held surface never
  // moves it (coordinator ruling, TASK_2026_494 B15).
  const activeSurfaceId =
    payload.origin === 'agent' &&
    existing === undefined &&
    state.pickedSurfaceId === null
      ? surfaceId
      : keepActive(state.activeSurfaceId, entries);
  const next: AppsSurfaceState = {
    entries,
    tombstones,
    activeSurfaceId,
    pickedSurfaceId: state.pickedSurfaceId,
    seq,
    notice: clearNoticeFor(state.notice, surfaceId),
  };
  // Over the bound: the host pushes the eviction delete after this commit,
  // so the overflow is transient; a read settles it either way.
  const overflow = entries.size > SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId;
  return result(next, 'applied', overflow);
}

function applyOps(
  state: AppsSurfaceState,
  payload: SurfaceUpdatedPayload,
  fromRevision: number,
  ops: Extract<SurfaceUpdatedPayload['change'], { kind: 'ops' }>['ops'],
): AppsReduceResult {
  const { surfaceId, revision } = payload;
  const existing = state.entries.get(surfaceId);
  if (existing === undefined) {
    const tombstone = state.tombstones.get(surfaceId);
    return tombstone !== undefined && revision <= tombstone
      ? result(state, 'tombstoned')
      : result(state, 'unknown-surface', true);
  }
  if (revision <= existing.materializedRevision) return result(state, 'stale');
  if (fromRevision !== existing.materializedRevision)
    return result(state, 'gap', true);
  const current = existing.renderable;
  // The host applied these ops to a document this page could not accept;
  // the post-ops document may be valid, so recover from a read.
  if (current.status !== 'accepted')
    return result(state, 'rejected-surface', true);

  const applied = applySurfaceOps(
    {
      content: current.content,
      selection: current.selection,
      lastSubmit: current.lastSubmit,
    },
    ops,
  );
  if (!applied.ok) {
    console.warn('[apps-surface-reducer] surface ops could not be applied');
    return result(state, 'ops-failed', true);
  }
  // Whole-document re-validation, fail-closed: a rejection shows the text
  // fallback for this revision.
  const renderable = acceptSurfaceView({
    surfaceId,
    revision,
    content: applied.next.content,
    selection: applied.next.selection,
    lastSubmit: applied.next.lastSubmit,
  });
  const seq = state.seq + 1;
  const entries = new Map(state.entries);
  entries.set(surfaceId, {
    ...existing,
    materializedRevision: revision,
    renderable,
    lastAppliedSeq: seq,
    overlays: existing.overlays.retireSettledUpTo(revision),
  });
  return result({ ...state, entries, seq }, 'applied');
}

function applyDelete(
  state: AppsSurfaceState,
  payload: SurfaceUpdatedPayload,
  reason: 'agent-deleted' | 'evicted',
): AppsReduceResult {
  const { surfaceId, revision } = payload;
  const existing = state.entries.get(surfaceId);
  // Terminal whatever its revision: an eviction carries the store's
  // high-water revision, which can EQUAL the one held.
  const entries = new Map(state.entries);
  entries.delete(surfaceId);
  const tombstones = withTombstone(
    state.tombstones,
    surfaceId,
    Math.max(revision, existing?.materializedRevision ?? revision),
  );
  const notice: AppsSurfaceNotice | null =
    reason === 'evicted'
      ? { kind: 'evicted', surfaceId, text: APPS_EVICTED_NOTICE }
      : clearNoticeFor(state.notice, surfaceId);
  return result(
    {
      entries,
      tombstones,
      activeSurfaceId: keepActive(state.activeSurfaceId, entries),
      pickedSurfaceId: keepPicked(state.pickedSurfaceId, entries),
      seq: state.seq + 1,
      notice,
    },
    'applied',
  );
}

/**
 * Applies one raw `surface:updated` payload. The structural guard runs
 * first; a malformed payload changes nothing.
 */
export function applySurfacePush(
  state: AppsSurfaceState,
  raw: unknown,
): AppsReduceResult {
  const payload = guardSurfacePush(raw);
  if (payload === null) return result(state, 'malformed');
  const change = payload.change;
  switch (change.kind) {
    case 'snapshot':
      return applySnapshot(state, payload, change.state);
    case 'ops':
      return applyOps(state, payload, change.fromRevision, change.ops);
    case 'deleted':
      return applyDelete(state, payload, change.reason);
  }
}

function newEntry(
  view: SurfaceStateView,
  seq: number,
  previous: AppsSurfaceEntry | undefined,
): AppsSurfaceEntry {
  const overlays =
    previous === undefined
      ? AppsOperationOverlays.empty()
      : previous.overlays.retireSettledUpTo(view.revision);
  return {
    surfaceId: view.surfaceId,
    materializedRevision: view.revision,
    renderable: acceptSurfaceView(view),
    lastAppliedSeq: seq,
    overlays,
    // A read that updates a held surface keeps its presentation state; a
    // surface first seen through a read starts empty.
    viewState: previous === undefined ? EMPTY_VIEW_STATE : previous.viewState,
  };
}

/** Keeps the `maxSurfacesPerRoutingId` entries with the highest revisions. */
function trimToBound(
  entries: Map<string, AppsSurfaceEntry>,
  tombstones: Map<string, number>,
): Map<string, number> {
  const bound = SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId;
  if (entries.size <= bound) return tombstones;
  const ranked = [...entries.values()].sort(
    (a, b) => b.materializedRevision - a.materializedRevision,
  );
  let next = tombstones;
  for (const entry of ranked.slice(bound)) {
    entries.delete(entry.surfaceId);
    next = withTombstone(next, entry.surfaceId, entry.materializedRevision);
  }
  return next;
}

/**
 * Applies a raw `surface:read` result sent when the slice was at `readSeq`
 * (see `surfaceReadSeq`).
 *
 * - A view above the materialized revision (or for an id not held and above
 *   any tombstone) replaces or creates its entry; a view at or below is
 *   ignored, so a revision never moves backwards.
 * - An entry absent from the result is removed only if nothing was applied
 *   to it after the read was sent (`lastAppliedSeq <= readSeq`).
 * - Settled overlays at or below the resulting materialized revision retire.
 */
export function applySurfaceRead(
  state: AppsSurfaceState,
  raw: unknown,
  readSeq: number,
): AppsReduceResult {
  const read = guardSurfaceReadResult(raw);
  if (read === null) return result(state, 'malformed');
  const seq = state.seq + 1;
  const entries = new Map(state.entries);
  let tombstones = new Map(state.tombstones);
  const seen = new Set<string>();

  const views = read.status === 'found' ? read.surfaces : [];
  for (const view of views) {
    seen.add(view.surfaceId);
    const existing = entries.get(view.surfaceId);
    if (existing !== undefined) {
      if (view.revision > existing.materializedRevision) {
        entries.set(view.surfaceId, newEntry(view, seq, existing));
      } else {
        entries.set(view.surfaceId, {
          ...existing,
          overlays: existing.overlays.retireSettledUpTo(
            existing.materializedRevision,
          ),
        });
      }
      continue;
    }
    const tombstone = tombstones.get(view.surfaceId);
    if (tombstone !== undefined && view.revision <= tombstone) continue;
    tombstones.delete(view.surfaceId);
    entries.set(view.surfaceId, newEntry(view, seq, undefined));
  }

  state.entries.forEach((entry, surfaceId) => {
    if (!seen.has(surfaceId) && entry.lastAppliedSeq <= readSeq) {
      entries.delete(surfaceId);
      tombstones = withTombstone(
        tombstones,
        surfaceId,
        entry.materializedRevision,
      );
    }
  });
  tombstones = trimToBound(entries, tombstones);

  const notice =
    state.notice !== null && entries.has(state.notice.surfaceId)
      ? null
      : state.notice;
  return result(
    {
      entries,
      tombstones,
      activeSurfaceId: keepActive(state.activeSurfaceId, entries),
      pickedSurfaceId: keepPicked(state.pickedSurfaceId, entries),
      seq,
      notice,
    },
    'applied',
  );
}

/**
 * Stores the renderer's emitted view state of one held surface VERBATIM (the
 * same object), so the next `viewState` the renderer receives is the one it
 * emitted and never an older one (B8 carry-over). Presentation state only:
 * no seq, revision or overlay moves. An unknown surface id changes nothing.
 */
export function setSurfaceViewState(
  state: AppsSurfaceState,
  surfaceId: string,
  viewState: SurfaceViewState,
): AppsSurfaceState {
  const existing = state.entries.get(surfaceId);
  if (existing === undefined || existing.viewState === viewState) return state;
  const entries = new Map(state.entries);
  entries.set(surfaceId, { ...existing, viewState });
  return { ...state, entries };
}

/**
 * The user picked `surfaceId` in the switcher. The pick sticks until that
 * surface is removed or evicted: agent updates to other surfaces and newly
 * created agent surfaces leave it active. An id the page does not hold
 * changes nothing.
 */
export function activateSurface(
  state: AppsSurfaceState,
  surfaceId: string,
): AppsSurfaceState {
  if (
    !state.entries.has(surfaceId) ||
    (state.activeSurfaceId === surfaceId && state.pickedSurfaceId === surfaceId)
  )
    return state;
  return { ...state, activeSurfaceId: surfaceId, pickedSurfaceId: surfaceId };
}

/**
 * Updates the overlays of one held surface (add, settle, retire; Rule 4).
 * Never touches `materializedRevision` (Rule 1). A settled overlay already
 * covered by the materialized revision (echo before result) retires at once.
 * An unknown surface id changes nothing.
 */
export function updateSurfaceOverlays(
  state: AppsSurfaceState,
  surfaceId: string,
  update: (overlays: AppsOperationOverlays) => AppsOperationOverlays,
): AppsSurfaceState {
  const existing = state.entries.get(surfaceId);
  if (existing === undefined) return state;
  const overlays = update(existing.overlays).retireSettledUpTo(
    existing.materializedRevision,
  );
  if (overlays === existing.overlays) return state;
  const entries = new Map(state.entries);
  entries.set(surfaceId, { ...existing, overlays });
  return { ...state, entries };
}
