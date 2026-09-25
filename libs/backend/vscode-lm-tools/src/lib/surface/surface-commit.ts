/**
 * The commit pipeline every surface write shares (plan Component 10, "every
 * commit"): apply the ops with the same pure function the renderer runs,
 * re-validate the WHOLE resulting document (Req 5.2), revalidate the
 * selection (Req 5.9), produce exactly `current + 1` (never `base + 1`) and
 * append the write to the bounded log.
 *
 * Pure: it reads the previous record and returns the next one plus the change
 * to push. It never touches the store and never pushes; the facade
 * (`SurfaceStateService`) swaps the record in and pushes from its single push
 * site. Conflict checks are the caller's job, because the rule differs per
 * mutation (plan Q4). Never throws.
 */
import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import type {
  SurfaceChange,
  SurfaceContent,
  SurfaceRejectReason,
  SurfaceStateOp,
} from '@ptah-extension/shared';
import { validateDashboardSpec } from '@ptah-extension/shared/mcp-apps-contracts';
import {
  appendWrite,
  applySurfaceOps,
  revalidateSelection,
  surfaceOpsFootprint,
  validateSurfaceDocument,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { toSurfaceStateView } from './surface-state-reader';
import { createSurfaceRecord, type SurfaceRecord } from './surface-state.store';

export type SurfaceCommitRejectReason = Extract<
  SurfaceRejectReason,
  'invalid-value' | 'budget'
>;

export type SurfacePreparedCommit =
  | {
      readonly ok: true;
      readonly record: SurfaceRecord;
      readonly change: SurfaceChange;
    }
  | {
      readonly ok: false;
      readonly reason: SurfaceCommitRejectReason;
      readonly detail: string;
    };

type ContentCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: SurfaceCommitRejectReason;
      readonly detail: string;
    };

/**
 * The validators name a byte budget in their reason text: `maxDataModelBytes`
 * and `maxSurfaceBytes` (v2, `surface.validator.ts`) and "byte limit" (v1,
 * `dashboard-spec.validator.ts`). Those rejections are `budget`; every other
 * document rejection is `invalid-value`. The detail always carries the
 * validator's own text, which names the path and the limit (Req 4.3).
 */
const BYTE_BUDGET_REASON = /\bmax(?:DataModel|Surface)Bytes\b|\bbyte limit\b/;

/** Full re-validation of stored content against its own contract. */
export function checkSurfaceContent(content: SurfaceContent): ContentCheck {
  const result =
    content.contract === 'dashboard-spec/2'
      ? validateSurfaceDocument(
          { ...content.surface, dataModel: content.dataModel },
          jsonUtf8Bytes,
        )
      : validateDashboardSpec(content.spec, jsonUtf8Bytes);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    reason: BYTE_BUDGET_REASON.test(result.reason) ? 'budget' : 'invalid-value',
    detail: result.reason,
  };
}

/**
 * Apply `ops` to `prev` as one commit. The pushed change is the committed ops,
 * so the renderer, applying them with `applySurfaceOps` from `fromRevision`,
 * reaches the same state by construction.
 */
export function prepareOpsCommit(
  prev: SurfaceRecord,
  ops: readonly SurfaceStateOp[],
): SurfacePreparedCommit {
  const prevState = {
    content: prev.content,
    selection: prev.selection,
    lastSubmit: prev.lastSubmit,
  };
  const applied = applySurfaceOps(prevState, ops);
  if (!applied.ok)
    return { ok: false, reason: 'invalid-value', detail: applied.reason };
  const check = checkSurfaceContent(applied.next.content);
  if (!check.ok) return check;
  const selection = revalidateSelection(prevState, applied.next, ops);
  const revision = prev.revision + 1;
  // `revalidateSelection` replays the same per-op rule, so it agrees with
  // `applySurfaceOps`. Should it ever clear a selection the ops kept, the push
  // says so explicitly, so the two copies still converge.
  const pushed: readonly SurfaceStateOp[] =
    selection === null && applied.next.selection !== null
      ? [...ops, { op: 'set-selection', selection: null }]
      : ops;
  return {
    ok: true,
    record: {
      ...prev,
      revision,
      content: applied.next.content,
      selection,
      lastSubmit: applied.next.lastSubmit,
      writeLog: appendWrite(prev.writeLog, {
        revision,
        footprint: surfaceOpsFootprint(ops),
      }),
    },
    change: { kind: 'ops', fromRevision: prev.revision, ops: pushed },
  };
}

/**
 * Replace the whole content of an existing surface (agent `replace`, or a
 * repeated v1 proposal). Same incarnation; the selection is cleared (a whole
 * replacement never keeps one, Req 5.9); the last submit stays as the record
 * of what was sent. Pushed as a snapshot.
 */
export function prepareReplaceCommit(
  prev: SurfaceRecord,
  content: SurfaceContent,
): SurfacePreparedCommit {
  const check = checkSurfaceContent(content);
  if (!check.ok) return check;
  const prevState = {
    content: prev.content,
    selection: prev.selection,
    lastSubmit: prev.lastSubmit,
  };
  const revision = prev.revision + 1;
  const record: SurfaceRecord = {
    ...prev,
    revision,
    content,
    selection: revalidateSelection(
      prevState,
      { ...prevState, content },
      'replace',
    ),
    writeLog: appendWrite(prev.writeLog, {
      revision,
      footprint: { kind: 'structure' },
    }),
  };
  return {
    ok: true,
    record,
    change: { kind: 'snapshot', state: toSurfaceStateView(record) },
  };
}

/**
 * A new incarnation at `revision`, which the caller takes from above every
 * revision the store has ever issued (Req 5.8). Pushed as a snapshot.
 */
export function prepareCreateCommit(
  surfaceId: string,
  content: SurfaceContent,
  revision: number,
): SurfacePreparedCommit {
  const check = checkSurfaceContent(content);
  if (!check.ok) return check;
  const record = createSurfaceRecord(surfaceId, content, revision);
  return {
    ok: true,
    record,
    change: { kind: 'snapshot', state: toSurfaceStateView(record) },
  };
}
