/**
 * The consent-gated repair of a blocked path (TASK_2026_306, Batch 8).
 *
 * A blocked path is a DESIRED path an unowned file occupies. Reconcile refuses
 * to write it — correctly, because nothing proves Ptah wrote the occupant — and
 * reports it as `missing` alongside a perfect `writeFailed: 0`. Batch 6 made
 * that legible. This is the remedy, and it exists only because a user who got
 * those directories from the pre-TASK_2026_288 `npx skills add` path currently
 * has no route back to a managed state.
 *
 * WHY CONSENT IS THE WHOLE MECHANISM. `SkillJunctionService` LINKED skills and
 * only COPIED commands, so it never wrote one of these directories and could
 * not have (`git e107e6f89^:.../skill-junction.service.ts:304-356`, which also
 * skipped occupied paths at `:336-343`). The occupant may belong to the Claude
 * Code SDK, to `npx skills add`
 * (`rpc-handlers/.../harness-skill-install.service.ts:17-25`), or to the user.
 * **Content matching is not a valid ownership proof and must not be added as
 * one** — both non-Ptah install paths produce matching content by construction,
 * so the heuristic would be maximally confident exactly where it is least
 * entitled to be. Consent is the only proof available, which is why the API
 * below takes a set of paths and has no bulk entry point.
 *
 * THE ORDER, AND WHY EVERY STEP IS WHERE IT IS:
 *
 *   1. **Nothing consented ⇒ nothing runs.** Not even a reconcile — a pass
 *      writes files, and "declined consent leaves the filesystem byte-identical"
 *      has to mean byte-identical.
 *   2. **The repairable set is re-derived here**, from `reconciler.verify()`:
 *      the blocked paths, plus the kept local edits (D8) — and a kept local
 *      edit only when the request carries the digest the user approved
 *      (A21). A requested path outside that set is REFUSED. The caller's list
 *      is a UI's view of a report that may be minutes old; this is what keeps
 *      the RPC from being a general-purpose "move this directory" primitive.
 *   3. **Move every consented occupant to quarantine first**, under the
 *      workspace lock, verifying each move. A path carrying an approval digest
 *      is re-digested under that lock immediately before its move; any
 *      difference — edited again, deleted, recreated, now unreadable — leaves
 *      it exactly as it is (`changed-since-approval`). A path whose move
 *      failed is left exactly as it was.
 *   4. **Then one ordinary full pass.** The write is the reconciler's, not a
 *      second writer of its own — which is what makes "a failed move means no
 *      write at that path" STRUCTURAL rather than a branch somebody has to
 *      remember: an occupant still in place is still unowned, so `planEntry`
 *      returns `'foreign'` and `claude-target.ts:189-194` drops the path before
 *      `plan.writes` is built. The refusal that caused the defect is the same
 *      refusal that makes the repair safe.
 *   5. **A path the pass did not write gets its occupant back**, under the lock
 *      again. Nothing is deleted to make room: the realistic obstruction is
 *      this pass's own half-finished copy, and it is MOVED ASIDE into the
 *      quarantine exactly as the original was. There is no `rm` anywhere on the
 *      repair path except the second half of the cross-volume `EXDEV` fallback,
 *      which deletes only what it has already copied.
 *
 * ONE FAILING PATH NEVER ABORTS THE OTHERS. Every per-path step is in its own
 * `try`. On Windows an `EPERM`/`EBUSY` from an editor or an antivirus scanner
 * holding one directory open is the expected failure, not an exotic one, and a
 * repair of thirteen paths that dies on the third is worse than one that
 * repairs twelve and names the one it could not.
 *
 * NOT REACHABLE FROM ACTIVATION. This service is not wired into
 * `HarnessReconcilerService`, `HarnessPropagationService` or
 * `HarnessPreflightService`, and none of them can reach it — the dependency
 * runs the other way. The only caller is the `harness:repairBlocked` RPC.
 */

import { join } from 'path';
import {
  blockedTargetPaths,
  type HarnessHealth,
  type HarnessRepairBlockedPath,
  type HarnessRepairPathResult,
  type HarnessTargetId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { describeError } from '../fs/windows-retry';
import { probeDestination } from '../health/harness-destination-scanner';
import {
  acquireWorkspaceLock,
  serializePerWorkspace,
} from '../lock/workspace-lock';
import {
  moveToQuarantine,
  restoreFromQuarantine,
} from '../quarantine/quarantine';
import type { HarnessPropagationService } from '../propagation/harness-propagation.service';
import type { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import { isMcpFragmentKey } from '../targets/mcp/mcp-facet.port';
import { resolveHarnessWorkspaceRoot } from '../workspace/workspace-root';

/** The reason string the repair pass carries into logs and health reports. */
export const REPAIR_REASON = 'harness:repairBlocked';

/**
 * The `changed-since-approval` reason. Shared by the two places that decide it
 * (the refusal before any lock, the re-digest under it) so they cannot drift.
 */
const CHANGED_SINCE_APPROVAL_REASON =
  'this changed after you approved it, so it was kept exactly as it is and nothing was moved or written';

export interface HarnessBlockedRepairReport {
  /** One entry per requested path, in request order. */
  paths: HarnessRepairPathResult[];
  repaired: number;
  /** Health after the pass, or `null` when no pass ran. */
  health: HarnessHealth | null;
}

/** A path that passed the blocked-set check and whose occupant moved. */
interface MovedPath {
  index: number;
  target: HarnessTargetId;
  relPath: string;
  absolute: string;
  quarantinePath: string;
}

export class HarnessBlockedRepairService {
  constructor(
    private readonly logger: Logger,
    private readonly reconciler: HarnessReconcilerService,
    private readonly propagation: HarnessPropagationService,
    /** Injected so a spec can pin the quarantine name without faking a clock. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * @param cwd Any directory inside the workspace; normalized to the real root
   *   (E14), exactly as the reconciler does.
   * @param consented The paths the user ticked. Empty is the default and is a
   *   complete no-op.
   */
  async repair(
    cwd: string,
    consented: readonly HarnessRepairBlockedPath[],
  ): Promise<HarnessBlockedRepairReport> {
    if (consented.length === 0) {
      return { paths: [], repaired: 0, health: null };
    }

    const workspaceRoot = resolveHarnessWorkspaceRoot(cwd);
    const results = new Array<HarnessRepairPathResult>(consented.length);

    // Read-only, no lock, no write — the same probe the health badge uses. It
    // does NOT refresh the user layer first, and that asymmetry with the pass
    // below is deliberate: a refresh could only ever REMOVE a path from the
    // blocked set, and refusing a path that turns out not to be blocked is the
    // safe direction to be wrong in.
    const before = await this.reconciler.verify(workspaceRoot, REPAIR_REASON);
    const repairable = repairableByTarget(before);

    const accepted: HarnessRepairBlockedPath[] = [];
    const acceptedIndexes: number[] = [];
    consented.forEach((request, index) => {
      const refusal = refuse(request, repairable);
      if (refusal !== null) {
        results[index] = { ...pathOf(request), ...refusal };
        return;
      }
      accepted.push(request);
      acceptedIndexes.push(index);
    });

    if (accepted.length === 0) {
      return { paths: [...results], repaired: 0, health: null };
    }

    const moved = await this.moveOccupants(
      workspaceRoot,
      accepted,
      acceptedIndexes,
      results,
    );
    if (moved.length === 0) {
      // Every consented path failed to move, so nothing on disk changed and a
      // pass would only be noise over an unaltered tree.
      return { paths: [...results], repaired: 0, health: null };
    }

    // The ordinary write path, refreshing the user layer first like every other
    // caller. `propagate` never throws; a `null` means the pass could not run,
    // which reads below as "nothing was written" and restores every occupant.
    const health = await this.propagation.propagate(
      workspaceRoot,
      REPAIR_REASON,
      { mode: 'full' },
    );

    const repaired = await this.settle(workspaceRoot, moved, health, results);
    return {
      paths: [...results],
      repaired,
      // Restoring puts occupants back, which makes the pass's own report stale
      // for those paths. Re-observe rather than hand the caller numbers that no
      // longer describe the disk.
      health:
        repaired === moved.length
          ? health
          : await this.reobserve(workspaceRoot, health),
    };
  }

  /**
   * Phase one: every consented occupant into quarantine, under the lock.
   *
   * The lock is taken here and released before the pass, rather than held
   * across both. `HarnessReconcilerService.reconcile` takes the same lock and
   * the same in-process queue, so holding them here would deadlock the pass
   * this method exists to enable. Nothing is lost by the gap: a concurrent
   * reconcile that slips in between finds the paths vacant and writes exactly
   * what this repair was about to ask for.
   */
  private async moveOccupants(
    workspaceRoot: string,
    accepted: readonly HarnessRepairBlockedPath[],
    acceptedIndexes: readonly number[],
    results: HarnessRepairPathResult[],
  ): Promise<MovedPath[]> {
    return serializePerWorkspace(workspaceRoot, async () => {
      const lock = await acquireWorkspaceLock(workspaceRoot);
      const moved: MovedPath[] = [];
      try {
        for (let i = 0; i < accepted.length; i++) {
          const request = accepted[i];
          const path = pathOf(request);
          const index = acceptedIndexes[i];
          const absolute = toAbsolute(workspaceRoot, request.relPath);
          if (
            request.expectedDigest !== undefined &&
            (await probeDestination(absolute)).digest !== request.expectedDigest
          ) {
            // Re-digested under the lock, immediately before the move (A21).
            // The user approved replacing specific content; what is there now
            // is not it, so it stays exactly as it is and nothing is moved.
            results[index] = {
              ...path,
              outcome: 'changed-since-approval',
              reason: CHANGED_SINCE_APPROVAL_REASON,
            };
            this.logger.info(
              '[harness-sync] Kept a path that changed since its replace was approved',
              path,
            );
            continue;
          }
          try {
            const { quarantinePath } = await moveToQuarantine(
              absolute,
              this.now(),
            );
            moved.push({ index, ...path, absolute, quarantinePath });
            this.logger.info(
              '[harness-sync] Quarantined a consented path on explicit consent',
              { ...path, quarantinePath },
            );
          } catch (error: unknown) {
            // Untouched, and no write will be attempted here: a blocked
            // occupant is still unowned, so the pass below classifies it
            // foreign and drops it before `plan.writes` exists; a kept local
            // edit is still edited, so the pass keeps it (D8).
            results[index] = {
              ...path,
              outcome: 'move-failed',
              reason: `could not move the occupant aside, so nothing was written here: ${describeError(error)}`,
            };
            this.logger.warn(
              '[harness-sync] Could not quarantine a consented path; leaving it exactly as it was',
              {
                ...path,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
      } finally {
        lock.release();
      }
      return moved;
    });
  }

  /**
   * Phase two: decide each moved path from the pass's own report.
   *
   * `missing` after an apply is the failed writes PLUS the blocked set
   * (`health/harness-health.ts:112`), so "still missing" is exactly "the
   * managed copy did not land" and needs no second disk walk to establish.
   *
   * **Runs inside the workspace lock, like phase one.** The write pass has
   * completed and released by now, so re-taking it here nests nothing and
   * deadlocks nothing — and a restore puts a user's directory back onto a path
   * another writer could otherwise be touching. `restoreFromQuarantine` is
   * non-destructive regardless (it moves an obstruction aside rather than
   * deleting it), so the lock narrows the window rather than being the thing
   * that makes the operation safe.
   */
  private settle(
    workspaceRoot: string,
    moved: readonly MovedPath[],
    health: HarnessHealth | null,
    results: HarnessRepairPathResult[],
  ): Promise<number> {
    const stillMissing = missingByTarget(health);
    const written = (path: MovedPath): boolean =>
      health !== null && !stillMissing.get(path.target)?.has(path.relPath);

    const repairedNow = moved.filter(written);
    for (const path of repairedNow) {
      results[path.index] = {
        target: path.target,
        relPath: path.relPath,
        quarantinePath: path.quarantinePath,
        outcome: 'repaired',
      };
    }

    const toRestore = moved.filter((path) => !written(path));
    if (toRestore.length === 0) return Promise.resolve(repairedNow.length);

    return serializePerWorkspace(workspaceRoot, async () => {
      const lock = await acquireWorkspaceLock(workspaceRoot);
      try {
        for (const path of toRestore) {
          await this.restoreOne(path, results);
        }
      } finally {
        lock.release();
      }
      return repairedNow.length;
    });
  }

  /** One restore, reported whichever way it goes. Never throws. */
  private async restoreOne(
    path: MovedPath,
    results: HarnessRepairPathResult[],
  ): Promise<void> {
    const base = {
      target: path.target,
      relPath: path.relPath,
      quarantinePath: path.quarantinePath,
    };
    try {
      const { supersededPath } = await restoreFromQuarantine(
        path.quarantinePath,
        path.absolute,
        this.now(),
      );
      results[path.index] = {
        ...base,
        outcome: 'restored',
        reason:
          'the managed copy could not be written, so your original was put back and the path is blocked again',
      };
      this.logger.warn(
        '[harness-sync] Repair wrote nothing; the occupant was restored',
        // Logged when present, because something was on the path and it was
        // moved aside rather than deleted — the user is entitled to know a
        // second directory now exists in the quarantine.
        supersededPath === undefined ? base : { ...base, supersededPath },
      );
    } catch (error: unknown) {
      // The one outcome where the user MUST be told a path. Their directory
      // exists at the quarantine and nowhere else.
      results[path.index] = {
        ...base,
        outcome: 'restore-failed',
        reason: `the managed copy was not written and your original could not be put back — it is at ${path.quarantinePath} (${describeError(error)})`,
      };
      this.logger.error(
        '[harness-sync] Repair could not restore the occupant; it is in quarantine',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /** Re-observe after a restore so the returned health matches the disk. */
  private async reobserve(
    workspaceRoot: string,
    fallback: HarnessHealth | null,
  ): Promise<HarnessHealth | null> {
    try {
      return await this.reconciler.verify(workspaceRoot, REPAIR_REASON);
    } catch (error: unknown) {
      this.logger.warn(
        '[harness-sync] Could not re-observe health after a restore',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return fallback;
    }
  }
}

/** Workspace-relative POSIX path -> absolute path. */
function toAbsolute(workspaceRoot: string, relPath: string): string {
  return join(workspaceRoot, ...relPath.split('/'));
}

/** The paths a fresh verify allows a repair to move, per target. */
interface RepairablePaths {
  blocked: ReadonlySet<string>;
  /** Kept local edits (D8): repairable only with an approval digest (A21). */
  keptLocalEdit: ReadonlySet<string>;
}

function repairableByTarget(
  health: HarnessHealth,
): ReadonlyMap<HarnessTargetId, RepairablePaths> {
  return new Map(
    health.targets.map((target) => [
      target.target,
      {
        blocked: new Set(blockedTargetPaths(target)),
        keptLocalEdit: new Set(target.keptLocalEdit),
      },
    ]),
  );
}

/**
 * The request's identity alone. The approval digest is internal: it never
 * reaches a result the caller is handed, nor a log line.
 */
function pathOf(
  request: HarnessRepairBlockedPath,
): Pick<HarnessRepairPathResult, 'target' | 'relPath'> {
  return { target: request.target, relPath: request.relPath };
}

function missingByTarget(
  health: HarnessHealth | null,
): ReadonlyMap<HarnessTargetId, ReadonlySet<string>> {
  if (health === null) return new Map();
  return new Map(
    health.targets.map((target) => [target.target, new Set(target.missing)]),
  );
}

/**
 * Why a requested path is refused, or `null` when it is acceptable.
 *
 * Every refusal leaves the path untouched, and none is an error: a UI showing
 * a report from before the last reconcile can legitimately offer a path that is
 * no longer blocked. A kept local edit without an approval digest is refused
 * as `not-blocked`: it is not in the blocked set, and the user's own edit is
 * replaceable only against the content they approved (A21).
 */
function refuse(
  request: HarnessRepairBlockedPath,
  repairable: ReadonlyMap<HarnessTargetId, RepairablePaths>,
): Pick<HarnessRepairPathResult, 'outcome' | 'reason'> | null {
  if (isMcpFragmentKey(request.relPath)) {
    return {
      outcome: 'not-a-path',
      reason:
        'this is a server key inside a config file you also write, not a file — there is nothing to move aside',
    };
  }
  const paths = repairable.get(request.target);
  const isBlocked = paths?.blocked.has(request.relPath) === true;
  const isApprovedKeptEdit =
    request.expectedDigest !== undefined &&
    paths?.keptLocalEdit.has(request.relPath) === true;
  if (!isBlocked && !isApprovedKeptEdit) {
    // An approved path that is no longer blocked or kept changed state since
    // the approval (its occupant deleted, or now Ptah's own unmodified copy):
    // that IS a change since approval, and it is kept as it is.
    if (request.expectedDigest !== undefined) {
      return {
        outcome: 'changed-since-approval',
        reason: CHANGED_SINCE_APPROVAL_REASON,
      };
    }
    return {
      outcome: 'not-blocked',
      reason:
        'this path is not in the current blocked set, so it was left untouched',
    };
  }
  return null;
}
