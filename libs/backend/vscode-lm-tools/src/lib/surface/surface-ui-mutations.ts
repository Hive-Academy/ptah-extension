/**
 * UI-side surface writes (plan Component 10, "UI writes"): `change`,
 * `select` and the two halves of a submit, `beginSubmit` and `settleSubmit`.
 *
 * Every function here is a pure PLAN over the record the facade read. The
 * facade reserves the operation id in the ledger first, runs the plan, swaps
 * the record in, pushes from its single push site and settles the ledger.
 * Nothing here touches the store, the ledger or the push, and nothing throws.
 *
 * Host mediation (Req 6.7, 7.5): a change resolves the input from the STORED
 * copy and writes only its bound path; a selection must target a component
 * that declares `dashboard.select` and is validated against the host copy;
 * a submit resolves the action and its scope from the stored declaration.
 *
 * Submit tickets (lane finding 2): a ticket records the routing id, surface
 * id, incarnation and operation id, a frozen copy of the scoped values and the
 * formatted message only. It never holds or restores structure. At
 * settlement the last-submit record is written only when the surface still
 * exists with the same incarnation.
 */
import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import type {
  SurfaceAction,
  SurfaceContent,
  SurfaceDataValue,
  SurfaceRejectReason,
  SurfaceSelection,
  SurfaceSubmitRecord,
} from '@ptah-extension/shared';
import {
  SURFACE_LIMITS,
  checkDraftValue,
  checkSubmitValues,
  checkSurfaceConflict,
  collectSubmitScope,
  collectSurfaceInputs,
  findSurfaceAction,
  formatSurfaceSubmitMessage,
  type SurfaceSubmitIssue,
  type SurfaceSubmitValue,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { prepareOpsCommit, type SurfacePreparedCommit } from './surface-commit';
import {
  fingerprintSurfaceOperation,
  type SurfaceOperationRecord,
} from './surface-operation-ledger';
import type { SurfaceRecord } from './surface-state.store';

/** `surface:change`: write `value` to the bound path of input `componentId`. */
export interface SurfaceChangeRequest {
  readonly surfaceId: string;
  /** The revision the UI rendered. */
  readonly revision: number;
  readonly operationId: string;
  readonly componentId: string;
  readonly value: SurfaceDataValue;
}

/** `surface:select`: set or clear (null) the selection. */
export interface SurfaceSelectRequest {
  readonly surfaceId: string;
  readonly revision: number;
  readonly operationId: string;
  readonly selection: SurfaceSelection | null;
}

/** `surface:action` with a `surface.submit` action. */
export interface SurfaceSubmitRequest {
  readonly surfaceId: string;
  readonly revision: number;
  readonly operationId: string;
  readonly actionId: string;
}

/**
 * The outcome of a UI mutation, shaped like the RPC `SurfaceMutationResult`
 * (plan Component 8). `not-found` carries no revision (Req 6.3). `revision`
 * on a submit's `applied` or `indeterminate` is absent when the surface was
 * gone at settlement, so no last-submit was written anywhere.
 */
export type SurfaceMutationOutcome =
  | {
      readonly status: 'applied';
      readonly operationId: string;
      readonly revision?: number;
    }
  | {
      readonly status: 'rejected';
      readonly operationId: string;
      readonly reason: SurfaceRejectReason;
      readonly detail: string;
      readonly currentRevision?: number;
      readonly issues?: readonly SurfaceSubmitIssue[];
    }
  | { readonly status: 'not-found'; readonly operationId: string }
  | { readonly status: 'pending'; readonly operationId: string }
  | {
      readonly status: 'indeterminate';
      readonly operationId: string;
      readonly revision?: number;
      readonly detail: string;
    };

/** An accepted, reserved submit waiting for dispatch. Deeply frozen. */
export interface SurfaceSubmitTicket {
  readonly routingId: string;
  readonly surfaceId: string;
  /** Creation revision of the surface incarnation the values came from. */
  readonly incarnation: number;
  readonly operationId: string;
  readonly actionId: string;
  readonly scopeComponentId: string;
  readonly baseRevision: number;
  readonly values: readonly SurfaceSubmitValue[];
  /** Host-formatted, nonce-delimited turn content. */
  readonly message: string;
}

/** What the dispatcher reports back to `settleSubmit`. */
export type SurfaceSubmitDispatchOutcome =
  | { readonly status: 'applied' }
  | {
      readonly status: 'rejected';
      readonly reason: SurfaceRejectReason;
      readonly detail: string;
    }
  | { readonly status: 'indeterminate'; readonly detail: string };

export type SurfaceUiRejection = {
  readonly kind: 'rejected';
  readonly reason: SurfaceRejectReason;
  readonly detail: string;
  readonly currentRevision?: number;
  readonly issues?: readonly SurfaceSubmitIssue[];
};

export type SurfaceUiPlan =
  | {
      readonly kind: 'commit';
      readonly commit: Extract<SurfacePreparedCommit, { ok: true }>;
    }
  | SurfaceUiRejection;

export type SurfaceSubmitPlan =
  | {
      readonly kind: 'ticket';
      readonly ticket: SurfaceSubmitTicket;
      /** Accounted bytes: frozen values, message and settlement headroom. */
      readonly bytes: number;
    }
  | SurfaceUiRejection;

export type SurfaceSettlementPlan =
  | {
      readonly kind: 'commit';
      readonly commit: Extract<SurfacePreparedCommit, { ok: true }>;
    }
  /** The surface is gone (deleted or evicted) or is a new incarnation. */
  | { readonly kind: 'orphaned'; readonly detail: string }
  | {
      readonly kind: 'refused';
      readonly reason: SurfaceRejectReason;
      readonly detail: string;
    };

export function fingerprintChange(request: SurfaceChangeRequest): string {
  return fingerprintSurfaceOperation({
    kind: 'change',
    surfaceId: request.surfaceId,
    revision: request.revision,
    componentId: request.componentId,
    value: request.value,
  });
}

export function fingerprintSelect(request: SurfaceSelectRequest): string {
  return fingerprintSurfaceOperation({
    kind: 'select',
    surfaceId: request.surfaceId,
    revision: request.revision,
    selection: request.selection,
  });
}

export function fingerprintSubmit(request: SurfaceSubmitRequest): string {
  return fingerprintSurfaceOperation({
    kind: 'submit',
    surfaceId: request.surfaceId,
    revision: request.revision,
    actionId: request.actionId,
  });
}

/** The recorded outcome of an operation, for a replay (Req 6.4, 10.5). */
export function outcomeFromRecord(
  record: SurfaceOperationRecord,
): SurfaceMutationOutcome {
  const operationId = record.operationId;
  switch (record.status) {
    case 'pending':
      return { status: 'pending', operationId };
    case 'applied':
      return record.revision === undefined
        ? { status: 'applied', operationId }
        : { status: 'applied', operationId, revision: record.revision };
    case 'indeterminate':
      return {
        status: 'indeterminate',
        operationId,
        detail: record.detail ?? 'The outcome could not be determined.',
        ...(record.revision === undefined ? {} : { revision: record.revision }),
      };
    default:
      return {
        status: 'rejected',
        operationId,
        // The ledger always records a reason with a rejection; the fallback
        // only keeps the type total.
        reason: record.reason ?? 'invalid-value',
        detail: record.detail ?? 'The operation was rejected.',
        ...(record.revision === undefined
          ? {}
          : { currentRevision: record.revision }),
      };
  }
}

function quoted(id: string): string {
  return JSON.stringify(id.length <= 256 ? id : `${id.slice(0, 256)}...`);
}

function reject(
  reason: SurfaceRejectReason,
  detail: string,
  currentRevision?: number,
): SurfaceUiRejection {
  return currentRevision === undefined
    ? { kind: 'rejected', reason, detail }
    : { kind: 'rejected', reason, detail, currentRevision };
}

/**
 * A request naming something the current copy does not declare. When the UI
 * rendered an older revision, the declaration may have been removed since, so
 * the answer is `stale-revision` (re-read) rather than `undeclared`.
 */
function undeclaredOrStale(
  record: SurfaceRecord,
  base: number,
  detail: string,
): SurfaceUiRejection {
  return base === record.revision
    ? reject('undeclared', detail)
    : reject(
        'stale-revision',
        `${detail} Current revision is ${record.revision}; re-read the surface and retry.`,
        record.revision,
      );
}

function fromPrepared(prepared: SurfacePreparedCommit): SurfaceUiPlan {
  return prepared.ok
    ? { kind: 'commit', commit: prepared }
    : reject(prepared.reason, prepared.detail);
}

/** Plan a `surface:change` (Req 6.7, 9.4): never starts a turn. */
export function planChange(
  record: SurfaceRecord,
  request: SurfaceChangeRequest,
): SurfaceUiPlan {
  const content = record.content;
  const input =
    content.contract === 'dashboard-spec/2'
      ? collectSurfaceInputs(content.surface.components).find(
          (candidate) => candidate.id === request.componentId,
        )
      : undefined;
  if (input === undefined)
    return undeclaredOrStale(
      record,
      request.revision,
      `Component ${quoted(request.componentId)} is not an input on surface ${quoted(record.surfaceId)}.`,
    );
  const conflict = checkSurfaceConflict(
    record.writeLog,
    record.revision,
    request.revision,
    { kind: 'ui-change', path: input.path },
  );
  if (!conflict.ok)
    return reject('stale-revision', conflict.detail, conflict.currentRevision);
  const draft = checkDraftValue(input, request.value);
  if (!draft.ok) return reject('invalid-value', draft.reason);
  return fromPrepared(
    prepareOpsCommit(record, [
      { op: 'set-data', path: input.path, value: request.value },
    ]),
  );
}

interface ActionTreeNode {
  readonly id: string;
  readonly children?: readonly ActionTreeNode[];
  readonly actions?: readonly { readonly action: string }[];
}

/** Whether component `componentId` declares an action of kind `action`. Iterative. */
function declaresAction(
  content: SurfaceContent,
  componentId: string,
  action: string,
): boolean {
  const roots: readonly ActionTreeNode[] =
    content.contract === 'dashboard-spec/2'
      ? content.surface.components
      : content.spec.components;
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.id === componentId)
      return (node.actions ?? []).some((entry) => entry.action === action);
    if (node.children !== undefined) stack.push(...node.children);
  }
  return false;
}

/**
 * Plan a `surface:select` (Req 7.5). A non-null selection must target a
 * component that declares `dashboard.select`, and it must resolve against the
 * host copy (component exists, kind matches, indexes in range of inline data).
 * Clearing (null) is always allowed on a current revision.
 */
export function planSelect(
  record: SurfaceRecord,
  request: SurfaceSelectRequest,
): SurfaceUiPlan {
  if (
    request.selection !== null &&
    !declaresAction(
      record.content,
      request.selection.componentId,
      'dashboard.select',
    )
  )
    return undeclaredOrStale(
      record,
      request.revision,
      `Component ${quoted(request.selection.componentId)} does not declare dashboard.select on surface ${quoted(record.surfaceId)}.`,
    );
  const conflict = checkSurfaceConflict(
    record.writeLog,
    record.revision,
    request.revision,
    { kind: 'ui-select' },
  );
  if (!conflict.ok)
    return reject('stale-revision', conflict.detail, conflict.currentRevision);
  return fromPrepared(
    prepareOpsCommit(record, [
      { op: 'set-selection', selection: request.selection },
    ]),
  );
}

function freezeValues(
  values: readonly SurfaceSubmitValue[],
): readonly SurfaceSubmitValue[] {
  // Bound input values are strings, booleans or null (text, checkbox,
  // select, radio-group), so freezing each entry freezes the whole snapshot.
  return Object.freeze(
    values.map((entry) =>
      Object.freeze({
        componentId: entry.componentId,
        path: entry.path,
        value: entry.value,
      }),
    ),
  );
}

/**
 * Plan the first half of a submit, after the operation id is reserved:
 * resolve the action and its scope from the stored declaration (Req 10.6),
 * require the exact current revision, validate the scoped values for submit
 * (Req 10.2, naming every failing path), freeze them and format the message
 * with the host nonce. A rejection changes nothing; form values stay.
 */
export function planBeginSubmit(
  routingId: string,
  record: SurfaceRecord,
  request: SurfaceSubmitRequest,
  nonce: string,
): SurfaceSubmitPlan {
  const content = record.content;
  if (content.contract !== 'dashboard-spec/2')
    return undeclaredOrStale(
      record,
      request.revision,
      `Surface ${quoted(record.surfaceId)} is a dashboard-spec/1 surface and declares no surface.submit action.`,
    );
  const components = content.surface.components;
  const scope = collectSubmitScope(components, request.actionId);
  if (!scope.ok)
    return scope.code === 'invalid-scope'
      ? reject('submit-invalid', scope.reason)
      : undeclaredOrStale(record, request.revision, scope.reason);
  const conflict = checkSurfaceConflict(
    record.writeLog,
    record.revision,
    request.revision,
    { kind: 'submit' },
  );
  if (!conflict.ok)
    return reject('stale-revision', conflict.detail, conflict.currentRevision);
  const check = checkSubmitValues(scope.inputs, content.dataModel);
  if (!check.ok)
    return {
      kind: 'rejected',
      reason: 'submit-invalid',
      detail: check.reason,
      issues: check.issues,
    };
  const values = freezeValues(check.values);
  const actionLabel =
    findSurfaceAction(components, request.actionId)?.action.label.text ??
    request.actionId;
  const inputLabels = Object.fromEntries(
    scope.inputs.map((input) => [input.id, input.label]),
  );
  const formatted = formatSurfaceSubmitMessage(
    {
      surfaceId: record.surfaceId,
      actionId: request.actionId,
      baseRevision: request.revision,
      values,
    },
    { actionLabel, inputLabels },
    nonce,
  );
  if (!formatted.ok)
    return reject(
      'budget',
      `The submitted values do not fit the maxSubmitMessageBytes limit of ${SURFACE_LIMITS.maxSubmitMessageBytes}; nothing was sent.`,
    );
  const ticket: SurfaceSubmitTicket = Object.freeze({
    routingId,
    surfaceId: record.surfaceId,
    incarnation: record.incarnation,
    operationId: request.operationId,
    actionId: request.actionId,
    scopeComponentId: scope.scopeComponentId,
    baseRevision: request.revision,
    values,
    message: formatted.message,
  });
  return {
    kind: 'ticket',
    ticket,
    bytes:
      jsonUtf8Bytes(values) +
      Buffer.byteLength(formatted.message, 'utf8') +
      submitSettlementHeadroom(ticket),
  };
}

/**
 * An upper bound on how much the surface record can grow when this ticket
 * settles (review F2, batch 10): the last-submit record (status
 * `indeterminate`, the longer one, with a 16-digit `submittedAt`) replacing
 * whatever was there, plus one `submit-record` write-log entry and its comma.
 * Content and selection do not change, and a log entry dropped by the bound
 * only shrinks the record. Reserving it with the ticket guarantees the
 * same-incarnation settlement commit fits: the store keeps `record + fixed
 * charges <= maxStoreBytes` through every intervening write, and releasing
 * the ticket at settlement frees at least this much.
 */
export function submitSettlementHeadroom(ticket: SurfaceSubmitTicket): number {
  const record = submitRecordOf(
    ticket,
    'indeterminate',
    Number.MAX_SAFE_INTEGER,
  );
  const entry = {
    revision: Number.MAX_SAFE_INTEGER,
    footprint: { kind: 'submit-record' },
  };
  return jsonUtf8Bytes(record) + jsonUtf8Bytes(entry) + 1;
}

/**
 * The action a stored surface declares, resolved for `surface:action`. Every
 * found variant carries the surface's current revision, so the caller can
 * tell a stale request from a current one.
 */
export type SurfaceActionResolution =
  | { readonly status: 'not-found' }
  | {
      readonly status: 'undeclared';
      readonly detail: string;
      readonly revision: number;
    }
  | {
      readonly status: 'declared';
      readonly action: SurfaceAction['action'];
      readonly revision: number;
    };

/**
 * Resolve `actionId` from the STORED declaration (Req 6.7). v1 actions carry
 * no id, so a v1 surface declares none that the UI can name.
 */
export function resolveStoredAction(
  record: SurfaceRecord | undefined,
  actionId: string,
): SurfaceActionResolution {
  if (record === undefined) return { status: 'not-found' };
  const found =
    record.content.contract === 'dashboard-spec/2'
      ? findSurfaceAction(record.content.surface.components, actionId)
      : undefined;
  return found === undefined
    ? {
        status: 'undeclared',
        detail: `Action ${quoted(actionId)} is not declared on this surface.`,
        revision: record.revision,
      }
    : {
        status: 'declared',
        action: found.action.action,
        revision: record.revision,
      };
}

/** The last-submit record a settled ticket writes. */
export function submitRecordOf(
  ticket: SurfaceSubmitTicket,
  status: SurfaceSubmitRecord['status'],
  submittedAt: number,
): SurfaceSubmitRecord {
  return {
    operationId: ticket.operationId,
    actionId: ticket.actionId,
    scopeComponentId: ticket.scopeComponentId,
    baseRevision: ticket.baseRevision,
    status,
    submittedAt,
    values: ticket.values,
  };
}

/**
 * Plan the last-submit write of a settled submit (Req 10.3). It is a
 * host-written `submit-record` footprint that conflicts with nothing but a
 * later submit, so it never overwrites an accepted write, and it happens only
 * on the ticket's own incarnation. Deleted, evicted or recreated surfaces get
 * no last-submit anywhere.
 */
export function planSubmitSettlement(
  current: SurfaceRecord | undefined,
  ticket: SurfaceSubmitTicket,
  submitRecord: SurfaceSubmitRecord,
): SurfaceSettlementPlan {
  if (current === undefined)
    return {
      kind: 'orphaned',
      detail: `Surface ${quoted(ticket.surfaceId)} was deleted or evicted before submit ${ticket.operationId} settled; no last submit was recorded.`,
    };
  if (current.incarnation !== ticket.incarnation)
    return {
      kind: 'orphaned',
      detail: `Surface ${quoted(ticket.surfaceId)} was recreated (incarnation ${current.incarnation}, submit taken from ${ticket.incarnation}) before submit ${ticket.operationId} settled; no last submit was recorded.`,
    };
  const prepared = prepareOpsCommit(current, [
    { op: 'set-last-submit', record: submitRecord },
  ]);
  return prepared.ok
    ? { kind: 'commit', commit: prepared }
    : { kind: 'refused', reason: prepared.reason, detail: prepared.detail };
}
