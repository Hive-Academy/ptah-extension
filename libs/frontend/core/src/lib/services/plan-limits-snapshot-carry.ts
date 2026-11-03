/**
 * Carry-forward of account-level plan-limit facts between two host snapshots,
 * used by `PlanLimitsStore` when a newer snapshot replaces the held one.
 *
 * Plan limits belong to the account, not to the session that asked. Two facts
 * a newer snapshot can drop although nothing about the account changed:
 *
 * - A window whose reset has passed. The host ledger forgets such a window at
 *   its reset (F17), so the 5-hour tile vanished after an idle spell while the
 *   weekly one stayed. Carried, the engine classifies it as
 *   `reset-usage-unknown` ("Reset · usage unknown"), never as 0 and never as
 *   live data. Only an owner still listed with a readable status keeps one,
 *   and only when the newer snapshot has no window of the same allowance.
 * - A session's resolved owner. The host lists only sessions its ledger has
 *   seen in this run (and evicts idle ones), so a snapshot can report a
 *   session the view already resolved as unresolved. A resolved owner is kept
 *   until the host reports a different resolved owner.
 */
import type {
  PlanLimitOwnerSnapshot,
  PlanLimitSessionOwner,
  PlanLimitsSnapshot,
  PlanLimitWindow,
  ProviderAccountUsageStatus,
} from '@ptah-extension/shared';

/** Statuses whose snapshot carries every ledger window (host rule). */
const READABLE_STATUSES: ReadonlySet<ProviderAccountUsageStatus> = new Set([
  'available',
  'stale',
  'service-unavailable',
]);

function allowance(window: PlanLimitWindow): string {
  return `${window.key}|${window.modelScope?.trim().toLowerCase() ?? ''}`;
}

function withExpiredWindows(
  next: PlanLimitOwnerSnapshot,
  prev: PlanLimitOwnerSnapshot | undefined,
  at: number,
): PlanLimitOwnerSnapshot {
  if (!prev || !READABLE_STATUSES.has(next.status)) return next;
  const present = new Set(next.windows.map(allowance));
  const expired = prev.windows.filter(
    (window) =>
      window.resetsAt !== undefined &&
      window.resetsAt <= at &&
      !present.has(allowance(window)),
  );
  return expired.length === 0
    ? next
    : { ...next, windows: [...next.windows, ...expired] };
}

function withResolvedSessions(
  next: PlanLimitsSnapshot['sessionOwners'],
  prev: PlanLimitsSnapshot['sessionOwners'],
): PlanLimitsSnapshot['sessionOwners'] {
  let merged: Record<string, PlanLimitSessionOwner> | undefined;
  for (const [sessionId, owner] of Object.entries(prev)) {
    if (owner.ownerKey === null) continue;
    const reported = Object.prototype.hasOwnProperty.call(next, sessionId)
      ? next[sessionId]
      : undefined;
    if (reported?.ownerKey) continue;
    merged ??= { ...next };
    merged[sessionId] = owner;
  }
  return merged ?? next;
}

/** `next` with the account-level facts of `prev` it dropped (see above). */
export function carryPlanLimitsSnapshot(
  prev: PlanLimitsSnapshot,
  next: PlanLimitsSnapshot,
): PlanLimitsSnapshot {
  const prevOwners = new Map(prev.owners.map((o) => [o.owner.key, o]));
  let ownersChanged = false;
  const owners = next.owners.map((owner) => {
    const carried = withExpiredWindows(
      owner,
      prevOwners.get(owner.owner.key),
      next.generatedAt,
    );
    if (carried !== owner) ownersChanged = true;
    return carried;
  });
  const sessionOwners = withResolvedSessions(
    next.sessionOwners,
    prev.sessionOwners,
  );
  if (!ownersChanged && sessionOwners === next.sessionOwners) return next;
  return { ...next, owners, sessionOwners };
}
