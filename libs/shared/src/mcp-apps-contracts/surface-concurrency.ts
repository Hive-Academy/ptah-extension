/**
 * Path-level optimistic concurrency over a bounded write log (plan Q4).
 *
 * Every committed write appends `{ revision, footprint }`. A mutation carrying
 * base revision `b` commits only if `b` is not newer than the stored revision,
 * `b` is not older than the log floor, and no logged write with
 * `revision > b` conflicts with the mutation:
 *
 * | Mutation            | Commits against base `b` only if                         |
 * | ------------------- | -------------------------------------------------------- |
 * | agent (any op mix)  | `b === current` (Req 5.4)                                |
 * | v1 proposal         | always (whole replacement, no base)                      |
 * | UI change at path P | no later write is structure, `data:*`, or a data path    |
 * |                     | equal to, an ancestor of, or a descendant of P           |
 * | UI select           | no later write is structure or selection                 |
 * | submit              | `b === current`                                          |
 *
 * The asymmetry is intended: a disjoint-path agent patch with an old base is
 * rejected, a disjoint-path UI change with an old base is accepted. A
 * conflicting write is rejected `stale-revision` with the current revision;
 * nothing is ever silently overwritten. Pure; never throws.
 */
import { SURFACE_LIMITS } from './surface-catalog';
import { parseSurfacePath, pathsOverlap } from './surface-data-model';
import { isSurfaceStructureOp } from './surface-patch';
import type { SurfaceStateOp } from './surface.types';

export type SurfaceWriteFootprint =
  | { readonly kind: 'structure' }
  | { readonly kind: 'data'; readonly paths: readonly string[] }
  /** `data:*`: a data write whose paths were too many to keep. */
  | { readonly kind: 'data-wildcard' }
  | { readonly kind: 'selection' }
  /** Host-written at submit settlement; conflicts only with a later submit. */
  | { readonly kind: 'submit-record' };

export interface SurfaceWriteLogEntry {
  readonly revision: number;
  readonly footprint: SurfaceWriteFootprint;
}

/**
 * Invariant: `entries` hold every write with `floor < revision <= current`,
 * oldest first. The floor starts at the creation revision (the incarnation) and
 * rises as old entries are dropped, so a base below it cannot be proven
 * conflict-free and is stale (fail closed). Callers append EVERY commit.
 */
export interface SurfaceWriteLog {
  readonly floor: number;
  readonly entries: readonly SurfaceWriteLogEntry[];
}

export type SurfaceConflictMutation =
  | { readonly kind: 'agent' }
  | { readonly kind: 'v1-proposal' }
  | { readonly kind: 'ui-change'; readonly path: string }
  | { readonly kind: 'ui-select' }
  | { readonly kind: 'submit' };

export type SurfaceConflictResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'stale-revision';
      readonly currentRevision: number;
      readonly detail: string;
    };

export function createSurfaceWriteLog(
  creationRevision: number,
): SurfaceWriteLog {
  return { floor: creationRevision, entries: [] };
}

/**
 * The footprint a committed op list writes. Any structure op makes the whole
 * write `structure`. A list mixing categories that the Q4 table keeps apart
 * (data with selection, for example) is recorded as `structure`, the footprint
 * that conflicts with every pending UI mutation: fail closed rather than
 * under-report. Data paths are de-duplicated; collapsing to `data:*` happens
 * in `appendWrite`.
 */
export function surfaceOpsFootprint(
  ops: readonly SurfaceStateOp[],
): SurfaceWriteFootprint {
  const paths = new Set<string>();
  const categories = new Set<'data' | 'selection' | 'submit-record'>();
  for (const op of ops) {
    if (isSurfaceStructureOp(op)) return { kind: 'structure' };
    if (op.op === 'set-data' || op.op === 'remove-data') {
      categories.add('data');
      paths.add(op.path);
    } else if (op.op === 'set-selection') categories.add('selection');
    else if (op.op === 'set-last-submit') categories.add('submit-record');
    else return { kind: 'structure' };
  }
  if (categories.size !== 1) return { kind: 'structure' };
  if (categories.has('data')) return { kind: 'data', paths: [...paths] };
  return categories.has('selection')
    ? { kind: 'selection' }
    : { kind: 'submit-record' };
}

/**
 * Append one committed write. Keeps the last `maxWriteLogEntries` entries and
 * stores an entry naming more than `maxWriteLogPathsPerEntry` paths as
 * `data:*`. Dropping an entry raises the floor to its revision. Returns a new
 * log; the input is not mutated.
 */
export function appendWrite(
  log: SurfaceWriteLog,
  entry: SurfaceWriteLogEntry,
): SurfaceWriteLog {
  const footprint: SurfaceWriteFootprint =
    entry.footprint.kind === 'data' &&
    entry.footprint.paths.length > SURFACE_LIMITS.maxWriteLogPathsPerEntry
      ? { kind: 'data-wildcard' }
      : entry.footprint;
  const entries = [...log.entries, { revision: entry.revision, footprint }];
  let floor = log.floor;
  while (entries.length > SURFACE_LIMITS.maxWriteLogEntries) {
    const dropped = entries.shift();
    if (dropped !== undefined) floor = Math.max(floor, dropped.revision);
  }
  return { floor, entries };
}

function conflicts(
  footprint: SurfaceWriteFootprint,
  mutation: SurfaceConflictMutation,
): boolean {
  if (mutation.kind === 'ui-change') {
    switch (footprint.kind) {
      case 'structure':
      case 'data-wildcard':
        return true;
      case 'data':
        return footprint.paths.some((path) =>
          pathsOverlap(path, mutation.path),
        );
      default:
        return false;
    }
  }
  if (mutation.kind === 'ui-select')
    return footprint.kind === 'structure' || footprint.kind === 'selection';
  return true;
}

function stale(current: number, detail: string): SurfaceConflictResult {
  return {
    ok: false,
    reason: 'stale-revision',
    currentRevision: current,
    detail: `${detail} Current revision is ${current}; re-read the surface and retry.`,
  };
}

/**
 * Decide whether a mutation based on revision `base` may commit on a surface
 * whose stored revision is `current`. An accepted commit always produces
 * `current + 1`, never `base + 1`; that is the caller's job.
 */
export function checkSurfaceConflict(
  log: SurfaceWriteLog,
  current: number,
  base: number | null,
  mutation: SurfaceConflictMutation,
): SurfaceConflictResult {
  if (mutation.kind === 'v1-proposal') return { ok: true };
  if (base === null || !Number.isSafeInteger(base))
    return stale(current, 'A base revision is required.');
  if (base > current)
    return stale(current, `Base revision ${base} is newer than the surface.`);
  if (mutation.kind === 'agent' || mutation.kind === 'submit')
    return base === current
      ? { ok: true }
      : stale(current, `Base revision ${base} is not the current revision.`);
  if (base < log.floor)
    return stale(
      current,
      `Base revision ${base} is older than the kept write history (floor ${log.floor}).`,
    );
  if (mutation.kind === 'ui-change' && !parseSurfacePath(mutation.path).ok)
    return stale(current, `Path "${mutation.path}" cannot be checked.`);
  for (const entry of log.entries) {
    if (entry.revision <= base) continue;
    if (conflicts(entry.footprint, mutation))
      return stale(
        current,
        `Revision ${entry.revision} wrote ${describe(entry.footprint)} after base revision ${base}.`,
      );
  }
  return { ok: true };
}

function describe(footprint: SurfaceWriteFootprint): string {
  switch (footprint.kind) {
    case 'data':
      return `data at ${footprint.paths.map((path) => `"${path}"`).join(', ')}`;
    case 'data-wildcard':
      return 'data:*';
    case 'submit-record':
      return 'the last submit';
    default:
      return footprint.kind;
  }
}
