/**
 * Agent-side surface writes (plan Component 10, "agent writes"): `create`,
 * `replace`, `patch` and `delete` from `ptah_surface_update`, and the v1
 * bridge upsert from `ptah_dashboard_propose_spec` (Req 8.7).
 *
 * Every function here is a pure PLAN over the record the facade read: the
 * conflict check (agent writes require `baseRevision === current`, Req 5.4),
 * the ops, and the full re-validation (through `surface-commit.ts`). The
 * facade executes the plan: it swaps the record in and pushes from its single
 * push site. Nothing here touches the store or pushes, and nothing throws.
 *
 * Agent writes are not reserved in the operation ledger: they are made
 * retry-safe by the exact-base rule and by create-exists rejection (plan Q4,
 * lane finding 8). The host stamps each one `operationId = 'mcp:' +
 * toolCallId`, on the push payload and on the result, for correlation.
 */
import type {
  DashboardSpecEnvelope,
  SurfaceContent,
  SurfaceEnvelope,
  SurfaceRejectReason,
  SurfaceStateView,
  SurfaceUpdateInput,
} from '@ptah-extension/shared';
import {
  SURFACE_V1_ID_PREFIX,
  checkSurfaceConflict,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { DashboardDeliveryOutcome } from '../code-execution/namespace-builders/dashboard-namespace.builder';
import {
  prepareCreateCommit,
  prepareOpsCommit,
  prepareReplaceCommit,
  type SurfacePreparedCommit,
} from './surface-commit';
import type { SurfaceRecord } from './surface-state.store';

/** The four MCP operations plus the v1 bridge upsert. */
export type SurfaceAgentOperation =
  SurfaceUpdateInput['operation'] | 'v1-proposal';

/**
 * Why an agent write was refused. `already-exists` is the create-on-existing
 * rejection (Req 5.7); it is not a UI reason, so it is not part of
 * `SurfaceRejectReason`.
 */
export type SurfaceAgentRejectReason =
  | Extract<SurfaceRejectReason, 'stale-revision' | 'invalid-value' | 'budget'>
  | 'already-exists';

/**
 * The result of one agent write. `applied` means committed to the store (the
 * revision is final); `delivery` is the separate transport outcome of the
 * push and never rolls the commit back (Req 8.6). The delivery promise never
 * rejects. `view` is the committed state, null for a delete.
 */
export type SurfaceAgentUpdateResult =
  | {
      readonly status: 'applied';
      readonly operation: SurfaceAgentOperation;
      readonly surfaceId: string;
      readonly revision: number;
      readonly operationId: string;
      readonly toolCallId: string;
      readonly view: SurfaceStateView | null;
      readonly delivery: Promise<DashboardDeliveryOutcome>;
    }
  | {
      readonly status: 'rejected';
      readonly operation: SurfaceAgentOperation;
      readonly surfaceId: string;
      readonly operationId: string;
      readonly reason: SurfaceAgentRejectReason;
      readonly detail: string;
      /** Present when the surface exists (stale base, create on an existing id). */
      readonly currentRevision?: number;
    }
  | {
      readonly status: 'not-found';
      readonly operation: SurfaceAgentOperation;
      readonly surfaceId: string;
      readonly operationId: string;
      readonly detail: string;
    };

/** What the facade must do for one agent write. */
export type SurfaceAgentPlan =
  | {
      readonly kind: 'commit';
      readonly operation: SurfaceAgentOperation;
      readonly commit: Extract<SurfacePreparedCommit, { ok: true }>;
    }
  | {
      readonly kind: 'delete';
      readonly surfaceId: string;
      /** The deletion revision: `current + 1`. */
      readonly revision: number;
    }
  | {
      readonly kind: 'rejected';
      readonly operation: SurfaceAgentOperation;
      readonly surfaceId: string;
      readonly reason: SurfaceAgentRejectReason;
      readonly detail: string;
      readonly currentRevision?: number;
    }
  | {
      readonly kind: 'not-found';
      readonly operation: SurfaceAgentOperation;
      readonly surfaceId: string;
      readonly detail: string;
    };

/** The host-stamped correlation id of an agent write. */
export function agentOperationId(toolCallId: string): string {
  return `mcp:${toolCallId}`;
}

/** The deterministic v1 surface id; a v2 id can never equal it (no `:`). */
export function v1SurfaceId(specId: string): string {
  return `${SURFACE_V1_ID_PREFIX}${specId}`;
}

/** The surface an update input names. */
export function surfaceIdOfUpdate(input: SurfaceUpdateInput): string {
  return input.operation === 'create' || input.operation === 'replace'
    ? input.surface.surfaceId
    : input.surfaceId;
}

/** A validated v2 envelope as stored content: structure and data model apart. */
export function v2SurfaceContent(surface: SurfaceEnvelope): SurfaceContent {
  const { dataModel, ...structure } = surface;
  return {
    contract: 'dashboard-spec/2',
    surface: structure,
    dataModel: dataModel ?? {},
  };
}

function quoted(id: string): string {
  return JSON.stringify(id.length <= 256 ? id : `${id.slice(0, 256)}...`);
}

function notFound(
  operation: SurfaceAgentOperation,
  surfaceId: string,
): SurfaceAgentPlan {
  return {
    kind: 'not-found',
    operation,
    surfaceId,
    detail: `Surface ${quoted(surfaceId)} does not exist for this conversation.`,
  };
}

function fromPrepared(
  operation: SurfaceAgentOperation,
  surfaceId: string,
  prepared: SurfacePreparedCommit,
): SurfaceAgentPlan {
  return prepared.ok
    ? { kind: 'commit', operation, commit: prepared }
    : {
        kind: 'rejected',
        operation,
        surfaceId,
        reason: prepared.reason,
        detail: prepared.detail,
      };
}

/** Agent writes on an existing surface require the exact current revision. */
function staleAgainst(
  operation: SurfaceAgentOperation,
  existing: SurfaceRecord,
  baseRevision: number,
): SurfaceAgentPlan | undefined {
  const conflict = checkSurfaceConflict(
    existing.writeLog,
    existing.revision,
    baseRevision,
    { kind: 'agent' },
  );
  return conflict.ok
    ? undefined
    : {
        kind: 'rejected',
        operation,
        surfaceId: existing.surfaceId,
        reason: 'stale-revision',
        detail: conflict.detail,
        currentRevision: conflict.currentRevision,
      };
}

/**
 * Plan one validated `ptah_surface_update`. `existing` is the stored record
 * for the named surface under the caller's routing id (undefined when absent,
 * including when it lives under another routing id). `createRevision` is the
 * revision a new incarnation starts at: above every revision ever issued.
 */
export function planAgentUpdate(
  existing: SurfaceRecord | undefined,
  input: SurfaceUpdateInput,
  createRevision: number,
): SurfaceAgentPlan {
  const surfaceId = surfaceIdOfUpdate(input);
  switch (input.operation) {
    case 'create':
      if (existing !== undefined)
        return {
          kind: 'rejected',
          operation: 'create',
          surfaceId,
          reason: 'already-exists',
          detail: `Surface ${quoted(surfaceId)} already exists at revision ${existing.revision}; use replace or patch with baseRevision ${existing.revision}.`,
          currentRevision: existing.revision,
        };
      return fromPrepared(
        'create',
        surfaceId,
        prepareCreateCommit(
          surfaceId,
          v2SurfaceContent(input.surface),
          createRevision,
        ),
      );
    case 'replace': {
      if (existing === undefined) return notFound('replace', surfaceId);
      const stale = staleAgainst('replace', existing, input.baseRevision);
      if (stale !== undefined) return stale;
      return fromPrepared(
        'replace',
        surfaceId,
        prepareReplaceCommit(existing, v2SurfaceContent(input.surface)),
      );
    }
    case 'patch': {
      if (existing === undefined) return notFound('patch', surfaceId);
      const stale = staleAgainst('patch', existing, input.baseRevision);
      if (stale !== undefined) return stale;
      return fromPrepared(
        'patch',
        surfaceId,
        prepareOpsCommit(existing, input.ops),
      );
    }
    case 'delete': {
      if (existing === undefined) return notFound('delete', surfaceId);
      const stale = staleAgainst('delete', existing, input.baseRevision);
      if (stale !== undefined) return stale;
      return { kind: 'delete', surfaceId, revision: existing.revision + 1 };
    }
    default:
      return {
        kind: 'rejected',
        operation: 'patch',
        surfaceId,
        reason: 'invalid-value',
        detail: 'Unknown surface operation.',
      };
  }
}

/**
 * Plan the v1 bridge upsert at `v1:<specId>`: a whole replacement with no
 * base revision (Q4 table), so it always passes the conflict check. The
 * envelope, including its agent-supplied `revision`, is kept verbatim in
 * `content.spec`; the host revision is separate and increases by one per
 * proposal (Req 8.7).
 */
export function planV1Proposal(
  existing: SurfaceRecord | undefined,
  spec: DashboardSpecEnvelope,
  createRevision: number,
): SurfaceAgentPlan {
  const surfaceId = v1SurfaceId(spec.specId);
  const content: SurfaceContent = { contract: 'dashboard-spec/1', spec };
  if (existing === undefined)
    return fromPrepared(
      'v1-proposal',
      surfaceId,
      prepareCreateCommit(surfaceId, content, createRevision),
    );
  const conflict = checkSurfaceConflict(
    existing.writeLog,
    existing.revision,
    null,
    { kind: 'v1-proposal' },
  );
  if (!conflict.ok)
    return {
      kind: 'rejected',
      operation: 'v1-proposal',
      surfaceId,
      reason: 'stale-revision',
      detail: conflict.detail,
      currentRevision: conflict.currentRevision,
    };
  return fromPrepared(
    'v1-proposal',
    surfaceId,
    prepareReplaceCommit(existing, content),
  );
}
