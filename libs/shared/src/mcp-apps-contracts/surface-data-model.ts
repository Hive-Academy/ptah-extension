/** Pure, platform-neutral data operations. No schema or platform dependency. */
import {
  SURFACE_INPUT_EMPTY_VALUES,
  SURFACE_LIMITS,
  SURFACE_PATH_DENYLIST,
  SURFACE_PATH_SEGMENT_PATTERN,
  SURFACE_PATH_SEPARATOR,
} from './surface-catalog';
import type { SurfaceInputKind } from './surface-catalog';
import type {
  SurfaceDataModel,
  SurfaceDataValue,
  SurfacePatchOp,
} from './surface.types';

export type SurfacePathResult =
  | { readonly ok: true; readonly segments: readonly string[] }
  | { readonly ok: false; readonly reason: string };
export type SurfaceDataModelOp = Extract<
  SurfacePatchOp,
  { op: 'set-data' | 'remove-data' }
>;
export type SurfaceDataModelResult =
  | { readonly ok: true; readonly next: SurfaceDataModel }
  | { readonly ok: false; readonly reason: string };
export type SurfacePathReadResult =
  | { readonly ok: true; readonly value: SurfaceDataValue | undefined }
  | { readonly ok: false; readonly reason: string };

/** Parse before reading or writing, including before creating parent objects. */
export function parseSurfacePath(path: string): SurfacePathResult {
  if (typeof path !== 'string')
    return { ok: false, reason: 'Surface path must be a string.' };
  const maxLength =
    SURFACE_LIMITS.maxPathSegments * (SURFACE_LIMITS.maxPathSegmentLength + 1) -
    1;
  if (path.length > maxLength)
    return {
      ok: false,
      reason: `Path "${path}" exceeds the path length budget ${maxLength}.`,
    };
  const segments = path.split(SURFACE_PATH_SEPARATOR);
  if (segments.length > SURFACE_LIMITS.maxPathSegments) {
    return {
      ok: false,
      reason: `Path "${path}" exceeds maxPathSegments ${SURFACE_LIMITS.maxPathSegments}.`,
    };
  }
  for (const segment of segments) {
    if (!isSafeSegment(segment)) {
      return {
        ok: false,
        reason: `Path "${path}" has invalid or denied segment "${segment}" (maxPathSegmentLength ${SURFACE_LIMITS.maxPathSegmentLength}).`,
      };
    }
  }
  return { ok: true, segments };
}

function isSafeSegment(segment: string): boolean {
  return (
    segment.length <= SURFACE_LIMITS.maxPathSegmentLength &&
    SURFACE_PATH_SEGMENT_PATTERN.test(segment) &&
    !SURFACE_PATH_DENYLIST.some((denied) => denied === segment)
  );
}

function isDataObject(
  value: SurfaceDataValue | undefined,
): value is SurfaceDataModel {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Missing paths return the input kind's empty value when kind is supplied.
 * Without kind, undefined distinguishes absence from an explicitly stored null.
 * Array indices are not paths, and inherited properties are never bindings.
 */
export function readSurfacePath(
  model: SurfaceDataModel,
  path: string,
  kind?: SurfaceInputKind,
): SurfacePathReadResult {
  const parsed = parseSurfacePath(path);
  if (!parsed.ok) return parsed;
  try {
    let value: SurfaceDataValue | undefined = model;
    for (const segment of parsed.segments) {
      if (
        !isDataObject(value) ||
        !Object.prototype.hasOwnProperty.call(value, segment)
      ) {
        return {
          ok: true,
          value:
            kind === undefined ? undefined : SURFACE_INPUT_EMPTY_VALUES[kind],
        };
      }
      value = value[segment];
    }
    return { ok: true, value };
  } catch (error: unknown) {
    // Exotic in-process objects can throw on property access; do not leak their diagnostics.
    return { ok: false, reason: `Cannot read surface path "${path}".` };
  }
}

/** Invalid paths do not overlap. Prefix comparison is segment-aware: a != ab. */
export function pathsOverlap(a: string, b: string): boolean {
  const left = parseSurfacePath(a);
  const right = parseSurfacePath(b);
  return (
    left.ok &&
    right.ok &&
    left.segments
      .slice(0, Math.min(left.segments.length, right.segments.length))
      .every((segment, index) => segment === right.segments[index])
  );
}

/**
 * Defence in depth for typed callers. Bounds recursion, rejects denied object
 * keys even inside a set value, and checks before any spread or assignment.
 * A root container is depth 1; scalars add no container level.
 */
function checkDataValue(
  value: SurfaceDataValue,
  depth = 0,
): string | undefined {
  if (value === null || typeof value === 'boolean') return undefined;
  if (typeof value === 'number')
    return Number.isFinite(value) ? undefined : 'Data numbers must be finite.';
  if (typeof value === 'string')
    return value.length <= SURFACE_LIMITS.maxStringLength
      ? undefined
      : `Data string exceeds maxStringLength ${SURFACE_LIMITS.maxStringLength}.`;
  if (typeof value !== 'object')
    return 'Data values must be JSON scalars, arrays or objects.';
  if (depth >= SURFACE_LIMITS.maxDataModelDepth)
    return `Data exceeds maxDataModelDepth ${SURFACE_LIMITS.maxDataModelDepth}.`;
  if (Array.isArray(value)) {
    if (value.length > SURFACE_LIMITS.maxDataModelArrayLength)
      return `Data exceeds maxDataModelArrayLength ${SURFACE_LIMITS.maxDataModelArrayLength}.`;
    for (const item of value) {
      const reason = checkDataValue(item, depth + 1);
      if (reason) return reason;
    }
  } else if (isDataObject(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      return 'Data objects must be plain JSON objects.';
    const keys = Object.keys(value);
    if (keys.length > SURFACE_LIMITS.maxDataModelObjectKeys)
      return `Data exceeds maxDataModelObjectKeys ${SURFACE_LIMITS.maxDataModelObjectKeys}.`;
    for (const key of keys) {
      if (!isSafeSegment(key))
        return `Data has invalid or denied key "${key}".`;
      const reason = checkDataValue(value[key], depth + 1);
      if (reason) return reason;
    }
  }
  return undefined;
}

function applyAtPath(
  model: SurfaceDataModel,
  segments: readonly string[],
  index: number,
  op: SurfaceDataModelOp,
): SurfaceDataModelResult {
  const key = segments[index];
  const ownsKey = Object.prototype.hasOwnProperty.call(model, key);
  if (index === segments.length - 1) {
    if (op.op === 'set-data')
      return { ok: true, next: { ...model, [key]: op.value } };
    if (!ownsKey) return { ok: true, next: model };
    const next = { ...model };
    delete next[key];
    return { ok: true, next };
  }
  const current = ownsKey ? model[key] : undefined;
  if (!isDataObject(current)) {
    // Nothing below a missing or scalar parent exists, so remove is a no-op.
    if (op.op === 'remove-data') return { ok: true, next: model };
    if (ownsKey)
      return {
        ok: false,
        reason: `Cannot set path "${op.path}" through non-object parent "${segments.slice(0, index + 1).join('.')}".`,
      };
  }
  const parent = isDataObject(current) ? current : {};
  const result = applyAtPath(parent, segments, index + 1, op);
  if (!result.ok) return result;
  return {
    ok: true,
    next: result.next === current ? model : { ...model, [key]: result.next },
  };
}

/**
 * Apply in order, atomically. Changed ancestors are copied; untouched branches
 * retain identity. Remove-missing succeeds without creating parents. Byte
 * budgets are measured by the boundary validator using its supplied counter.
 */
export function applyDataModelOps(
  model: SurfaceDataModel,
  ops: readonly SurfaceDataModelOp[],
): SurfaceDataModelResult {
  try {
    if (ops.length > SURFACE_LIMITS.maxPatchOps)
      return {
        ok: false,
        reason: `Operations exceed maxPatchOps ${SURFACE_LIMITS.maxPatchOps}.`,
      };
    const initialReason = checkDataValue(model);
    if (initialReason) return { ok: false, reason: initialReason };
    const paths: (readonly string[])[] = [];
    for (const op of ops) {
      const parsed = parseSurfacePath(op.path);
      if (!parsed.ok) return parsed;
      if (op.op === 'set-data') {
        const reason = checkDataValue(op.value);
        if (reason)
          return { ok: false, reason: `Path "${op.path}": ${reason}` };
      } else if (op.op !== 'remove-data') {
        return {
          ok: false,
          reason: 'Expected a set-data or remove-data operation.',
        };
      }
      paths.push(parsed.segments);
    }
    let next = model;
    for (let index = 0; index < ops.length; index++) {
      const applied = applyAtPath(next, paths[index], 0, ops[index]);
      if (!applied.ok) return applied;
      next = applied.next;
    }
    const reason = checkDataValue(next);
    return reason ? { ok: false, reason } : { ok: true, next };
  } catch (error: unknown) {
    // Fail closed for exotic in-process objects; caller-owned state is untouched.
    return { ok: false, reason: 'Cannot apply surface data operations.' };
  }
}
