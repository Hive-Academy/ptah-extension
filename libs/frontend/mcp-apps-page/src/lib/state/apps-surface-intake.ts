import type {
  SurfaceReadResult,
  SurfaceUpdatedPayload,
} from '@ptah-extension/shared';
import { validateDashboardSpec } from '@ptah-extension/shared/mcp-apps-contracts';
import {
  SURFACE_LIMITS,
  SurfaceSelectionSchema,
  checkSurfaceSelection,
  validateSurfaceDocument,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  SurfaceContent,
  SurfaceSelection,
  SurfaceStateView,
  SurfaceSubmitRecord,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

/**
 * Apps surface intake (implementation-plan.md:404-421, handoff-494.md (a) 2).
 *
 * Two pure steps between the wire and the reducer. Neither throws:
 *
 * - `guardSurfacePush` and `guardSurfaceReadResult` are
 *   STRUCTURAL and zod-free. They check only what the reducer branches on
 *   (ids, revisions, the change kind). Content is not trusted by them.
 * - `acceptSurfaceView` turns host content into what the renderer may draw:
 *   the whole document is validated, fail-closed, and an invalid selection is
 *   cleared without rejecting the surface.
 *
 * `console.warn` names only the failing field, never a payload value: pushes
 * carry agent- and user-authored text.
 */

/** What the renderer may draw for one surface revision. */
export type AppsRenderable =
  | {
      readonly status: 'accepted';
      readonly content: SurfaceContent;
      readonly selection: SurfaceSelection | null;
      readonly lastSubmit: SurfaceSubmitRecord | null;
    }
  | {
      /** Shown as the mono text fallback with `reason` (Req 3.5). */
      readonly status: 'rejected';
      readonly reason: string;
    };

const ORIGINS: readonly string[] = ['agent', 'ui', 'host'];
const DELETE_REASONS: readonly string[] = ['agent-deleted', 'evicted'];
const WARN_PREFIX = '[apps-surface-intake]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSurfaceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= SURFACE_LIMITS.maxSurfaceIdLength
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/** Logs the failing FIELD only; the payload itself is never printed. */
function drop(kind: string, field: string): null {
  console.warn(`${WARN_PREFIX} dropped ${kind}: invalid ${field}`);
  return null;
}

/**
 * Structural check of one `SurfaceStateView`, as carried by a snapshot or a
 * `surface:read` result. Content is checked later by `acceptSurfaceView`.
 */
function viewBreach(raw: unknown): string | null {
  if (!isRecord(raw)) return 'view';
  if (!isSurfaceId(raw['surfaceId'])) return 'view.surfaceId';
  if (!isRevision(raw['revision'])) return 'view.revision';
  if (!isRecord(raw['content'])) return 'view.content';
  return null;
}

function changeBreach(
  change: unknown,
  surfaceId: string,
  revision: number,
): string | null {
  if (!isRecord(change)) return 'change';
  switch (change['kind']) {
    case 'snapshot': {
      const state = change['state'];
      const breach = viewBreach(state);
      if (breach !== null) return `change.state (${breach})`;
      const view = state as Record<string, unknown>;
      if (view['surfaceId'] !== surfaceId) return 'change.state.surfaceId';
      if (view['revision'] !== revision) return 'change.state.revision';
      return null;
    }
    case 'ops': {
      if (!Number.isSafeInteger(change['fromRevision']))
        return 'change.fromRevision';
      const ops = change['ops'];
      if (!Array.isArray(ops) || ops.length > SURFACE_LIMITS.maxPatchOps)
        return 'change.ops';
      return ops.every(isRecord) ? null : 'change.ops';
    }
    case 'deleted':
      return DELETE_REASONS.includes(change['reason'] as string)
        ? null
        : 'change.reason';
    default:
      return 'change.kind';
  }
}

/**
 * Structural, zod-free guard for one raw `surface:updated` payload. Anything
 * the reducer cannot branch on safely returns `null` and is logged by field.
 */
export function guardSurfacePush(raw: unknown): SurfaceUpdatedPayload | null {
  if (!isRecord(raw)) return drop('surface push', 'payload');
  const routingId = raw['routingId'];
  if (typeof routingId !== 'string' || routingId.length === 0)
    return drop('surface push', 'routingId');
  const surfaceId = raw['surfaceId'];
  if (!isSurfaceId(surfaceId)) return drop('surface push', 'surfaceId');
  const revision = raw['revision'];
  if (!isRevision(revision)) return drop('surface push', 'revision');
  if (!ORIGINS.includes(raw['origin'] as string))
    return drop('surface push', 'origin');
  if (!isOptionalString(raw['toolCallId']))
    return drop('surface push', 'toolCallId');
  if (!isOptionalString(raw['operationId']))
    return drop('surface push', 'operationId');
  const breach = changeBreach(raw['change'], surfaceId, revision);
  if (breach !== null) return drop('surface push', breach);
  return raw as unknown as SurfaceUpdatedPayload;
}

/**
 * Structural guard for a `surface:read` result. One unusable view rejects the
 * whole result: the reducer removes surfaces ABSENT from a read, so silently
 * skipping a view would delete a surface the host still holds.
 */
export function guardSurfaceReadResult(raw: unknown): SurfaceReadResult | null {
  if (!isRecord(raw)) return drop('surface read', 'result');
  if (raw['status'] === 'not-found') return { status: 'not-found' };
  if (raw['status'] !== 'found') return drop('surface read', 'status');
  const routingId = raw['routingId'];
  if (typeof routingId !== 'string') return drop('surface read', 'routingId');
  const surfaces = raw['surfaces'];
  if (!Array.isArray(surfaces)) return drop('surface read', 'surfaces');
  for (const candidate of surfaces) {
    const breach = viewBreach(candidate);
    if (breach !== null) return drop('surface read', `surfaces (${breach})`);
  }
  return {
    status: 'found',
    routingId,
    surfaces: surfaces as SurfaceStateView[],
  };
}

/** UTF-8 bytes of the JSON encoding, the measure the host validators use. */
export function countJsonBytes(value: unknown): number {
  const encoded = JSON.stringify(value);
  return new TextEncoder().encode(encoded ?? 'null').length;
}

function validateContent(
  content: unknown,
): { ok: true; content: SurfaceContent } | { ok: false; reason: string } {
  if (!isRecord(content))
    return { ok: false, reason: 'surface content is not an object.' };
  if (content['contract'] === 'dashboard-spec/2') {
    const surface = content['surface'];
    if (!isRecord(surface))
      return { ok: false, reason: 'surface content has no surface object.' };
    const result = validateSurfaceDocument(
      { ...surface, dataModel: content['dataModel'] },
      countJsonBytes,
    );
    if (!result.ok) return { ok: false, reason: result.reason };
    const { dataModel, ...structure } = result.surface;
    return {
      ok: true,
      content: {
        contract: 'dashboard-spec/2',
        surface: structure,
        dataModel: dataModel ?? {},
      },
    };
  }
  if (content['contract'] === 'dashboard-spec/1') {
    const result = validateDashboardSpec(content['spec'], countJsonBytes);
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      content: { contract: 'dashboard-spec/1', spec: result.spec },
    };
  }
  return { ok: false, reason: 'surface content names an unknown contract.' };
}

/**
 * The selection is kept only if it is well formed AND points at real inline
 * data in the accepted content. Otherwise it is cleared, fail-closed; the
 * surface itself is not rejected.
 */
function acceptSelection(
  content: SurfaceContent,
  selection: unknown,
): SurfaceSelection | null {
  if (selection === null || selection === undefined) return null;
  const parsed = SurfaceSelectionSchema.safeParse(selection);
  if (!parsed.success) {
    console.warn(`${WARN_PREFIX} cleared selection: malformed`);
    return null;
  }
  const check = checkSurfaceSelection(content, parsed.data);
  if (!check.ok) {
    console.warn(`${WARN_PREFIX} cleared selection: no longer resolves`);
    return null;
  }
  return parsed.data;
}

function acceptLastSubmit(record: unknown): SurfaceSubmitRecord | null {
  return isRecord(record) ? (record as unknown as SurfaceSubmitRecord) : null;
}

/**
 * Turns one host view into what the renderer may draw. v2 content is
 * validated as a whole document (structure plus data model); v1 content with
 * `validateDashboardSpec`. Never throws: the validators fail closed and any
 * exotic value is caught here as a rejection.
 */
export function acceptSurfaceView(view: SurfaceStateView): AppsRenderable {
  try {
    const content = validateContent(
      (view as unknown as Record<string, unknown>)['content'],
    );
    if (!content.ok) {
      console.warn(`${WARN_PREFIX} rejected surface content`);
      return { status: 'rejected', reason: content.reason };
    }
    return {
      status: 'accepted',
      content: content.content,
      selection: acceptSelection(content.content, view.selection),
      lastSubmit: acceptLastSubmit(view.lastSubmit),
    };
  } catch (error: unknown) {
    // The contract helpers never throw on their own inputs; this catches an
    // exotic in-process value (a throwing getter) and fails closed.
    console.warn(
      `${WARN_PREFIX} rejected surface content: ${error instanceof Error ? error.name : 'unknown error'}`,
    );
    return {
      status: 'rejected',
      reason: 'surface content could not be validated.',
    };
  }
}
