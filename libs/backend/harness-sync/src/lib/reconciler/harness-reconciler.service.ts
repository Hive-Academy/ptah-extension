/**
 * The single declarative reconciler.
 *
 * `reconcile(ws)` is the ONE entry point every host, RPC handler and trigger
 * calls. It is idempotent, cheap when nothing changed, and it never removes an
 * artifact because a host is shutting down — removal happens only when a source
 * disappears or the user disables it.
 *
 * Ordering inside one pass, and why:
 *
 *   1. Serialize per workspace in-process, then take the cross-process file
 *      lock. Both are needed: the file lock alone would make two calls in one
 *      host busy-wait, and the in-process queue alone would not see `ptah tui`.
 *   2. Resolve sources and build the desired state ONCE, then hand the same
 *      snapshot to every target. Two targets must never disagree about what
 *      exists.
 *   3. Per target: load manifest → plan → persist the post-migration ownership
 *      map → apply → persist the final map. The extra persist before apply is
 *      what makes the legacy-manifest adoption crash-safe.
 *
 * `preflight` mode exists for the session-start path Batch 3 adds: it compares
 * desired hashes against the manifest and stats each owned path, and only falls
 * through to a full apply when that comparison shows drift. No hashing of
 * target directories, no copies, no lock contention on the common case.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import EventEmitter from 'eventemitter3';
import {
  blockedTargetPaths,
  type HarnessHealth,
  type HarnessTargetHealth,
  type HarnessTargetId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import type { HarnessDesiredState } from '../manifest/desired-state.types';
import {
  entrySourceHash,
  ManagedManifestStore,
  type ManagedEntries,
  type ManagedManifest,
} from '../manifest-store/managed-manifest';
import { isMcpFragmentKey } from '../targets/mcp/mcp-facet.port';
import { resolveHarnessWorkspaceRoot } from '../workspace/workspace-root';
import {
  acquireWorkspaceLock,
  serializePerWorkspace,
} from '../lock/workspace-lock';
import type { IHarnessSourceResolver } from '../sources/harness-source.port';
import type {
  HarnessPlan,
  IHarnessTarget,
} from '../targets/harness-target.port';
import {
  appliedTargetHealth,
  undetectedTargetHealth,
} from '../health/harness-health';
import type { HarnessGitignoreWriter } from '../gitignore/gitignore-writer';
import { AgentSyncGate } from '../state/agent-sync-gate';

export interface HarnessReconcileOptions {
  mode: 'full' | 'preflight';
  /** Restrict the pass to these targets. Defaults to every registered target. */
  targets?: HarnessTargetId[];
  /** Free-text trigger label carried into the health report and the logs. */
  reason: string;
  /**
   * Tells the builder that an empty user layer means "download in flight"
   * rather than "nothing installed". Reporting only (E2 vs E3).
   */
  downloadPending?: boolean;
}

/** Emitted after every completed pass, including no-op preflights. */
export interface HarnessReconcilerEvents {
  health: (health: HarnessHealth) => void;
}

export class HarnessReconcilerService {
  private readonly emitter = new EventEmitter<HarnessReconcilerEvents>();
  private lastHealth: HarnessHealth | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly builder: HarnessManifestBuilder,
    private readonly manifestStore: ManagedManifestStore,
    private readonly sourceResolver: IHarnessSourceResolver,
    private readonly targets: IHarnessTarget[],
    /**
     * Optional and last so every existing positional construction keeps
     * compiling. Absent means the `.gitignore` block is simply not maintained,
     * which is exactly the behaviour before Batch 4 — a workspace is not less
     * correct for having it, only noisier in `git status`.
     */
    private readonly gitignore: HarnessGitignoreWriter | null = null,
    /**
     * DEFAULTED, not nullable, unlike `gitignore` above. An absent
     * `.gitignore` writer means one less file is maintained; an absent agent
     * gate would mean the `agents` facet silently propagates ungated in any
     * host that forgot to wire it, which is the defect this gate exists to
     * close. Every construction gets one.
     */
    private readonly agentSync: AgentSyncGate = new AgentSyncGate(
      manifestStore,
    ),
  ) {}

  /** Most recent health report, or `null` before the first pass. */
  getLastHealth(): HarnessHealth | null {
    return this.lastHealth;
  }

  onHealth(listener: (health: HarnessHealth) => void): () => void {
    this.emitter.on('health', listener);
    return () => this.emitter.off('health', listener);
  }

  /**
   * `workspaceRoot` may be any directory INSIDE the workspace — a rival CLI
   * spawned for a sub-package hands us its own cwd. It is normalized to the
   * real root once, here, before the lock is keyed on it (E14). Doing it per
   * target would let two targets reconcile two different roots under one
   * manifest.
   */
  async reconcile(
    cwd: string,
    options: HarnessReconcileOptions,
  ): Promise<HarnessHealth> {
    const workspaceRoot = resolveHarnessWorkspaceRoot(cwd);
    return serializePerWorkspace(workspaceRoot, () =>
      this.runReconcile(workspaceRoot, options),
    );
  }

  /**
   * Read-only observation. Writes nothing, takes no lock, repairs nothing.
   *
   * This is what `harness:health` and `ptah harness doctor` (without `--fix`)
   * call. Keeping it distinct from `reconcile({ mode: 'preflight' })` matters
   * because preflight is not read-only: it is a cheap DRIFT TEST that falls
   * through to a full apply the moment it finds drift. A user asking "what is
   * the state of my harness" must not have the answer changed by the asking,
   * and a badge that polls must not be able to take the workspace lock out from
   * under a session that is mid-copy.
   *
   * Each target loads its own manifest inside `verify()` for exactly this
   * reason — the lock-free path cannot hand one down.
   */
  async verify(cwd: string, reason = 'harness:health'): Promise<HarnessHealth> {
    const workspaceRoot = resolveHarnessWorkspaceRoot(cwd);
    // Resolved but NOT persisted. A derived decision is a write, and `verify()`
    // writes nothing — a badge that polls must not be able to record a consent
    // decision on the user's behalf.
    const desired = this.builder.build(this.sourceResolver.resolve(), {
      downloadPending: false,
      agentSyncEnabled: this.agentSync.resolve(workspaceRoot).enabled,
    });

    const targetHealth: HarnessTargetHealth[] = [];
    for (const target of this.targets) {
      const startedAt = Date.now();
      try {
        targetHealth.push(
          (await target.detect(workspaceRoot))
            ? await target.verify(desired, workspaceRoot)
            : undetectedTargetHealth(
                target.id,
                target.facets,
                Date.now() - startedAt,
              ),
        );
      } catch (error: unknown) {
        // Same rule as a reconcile pass: one target's failure must not deny
        // the caller a report about the other five.
        this.logger.warn('[harness-sync] Target verify failed (non-fatal)', {
          target: target.id,
          error: error instanceof Error ? error.message : String(error),
        });
        targetHealth.push(
          undetectedTargetHealth(
            target.id,
            target.facets,
            Date.now() - startedAt,
          ),
        );
      }
    }

    const health: HarnessHealth = {
      workspaceRoot,
      generatedAt: new Date().toISOString(),
      // `preflight` is the honest label: no apply happened. A verify is the
      // read-only end of the same spectrum, not a third mode nobody handles.
      mode: 'preflight',
      reason,
      sources: desired.sources,
      targets: targetHealth,
      collisions: desired.collisions,
    };

    this.lastHealth = health;
    this.emitter.emit('health', health);
    return health;
  }

  /**
   * Remove everything Ptah owns in this workspace, across every target.
   *
   * The uninstall path (E22): `ptah harness remove`, and an extension being
   * uninstalled. It is the ONLY removal entry point in this lib that is not
   * driven by a source disappearing — and it is still bounded by the manifest,
   * so a directory Ptah did not write, a server the user added by hand, and the
   * entire user layer under `~/.ptah/user` all survive untouched.
   *
   * Deliberately NOT wired to host deactivation. That was the original defect:
   * tearing artifacts down when one host shut down left every other
   * host — `ptah tui`, the CLI, the gateway, a plain `claude` — with nothing.
   * Batch 4 exposes this behind an explicit user action.
   */
  async remove(cwd: string): Promise<HarnessHealth> {
    const workspaceRoot = resolveHarnessWorkspaceRoot(cwd);
    return serializePerWorkspace(workspaceRoot, () =>
      this.runRemove(workspaceRoot),
    );
  }

  private async runRemove(workspaceRoot: string): Promise<HarnessHealth> {
    const lock = await acquireWorkspaceLock(workspaceRoot);
    const targetHealth: HarnessTargetHealth[] = [];

    try {
      for (const target of this.targets) {
        const startedAt = Date.now();
        const manifest = this.manifestStore.load(workspaceRoot, target.id);
        const removals = Object.entries(manifest.entries).map(
          ([relPath, entry]) => ({
            relPath,
            kind: entry.kind,
            isDirectory: entry.kind === 'skill',
            ...(entry.kind === 'mcp'
              ? { mcpServerKey: relPath.slice(relPath.indexOf('#') + 1) }
              : {}),
          }),
        );

        try {
          const result = await target.apply(
            {
              target: target.id,
              writes: [],
              removals,
              foreign: [],
              blocked: [],
              collisions: [],
              migrations: [],
              adopted: [],
              baseEntries: manifest.entries,
              unchanged: 0,
              expected: 0,
            },
            workspaceRoot,
          );
          // Only entries that actually went away leave the manifest; one that
          // resisted deletion stays owned so a later pass retries it rather
          // than reclassifying a Ptah file as the user's.
          const remaining = { ...manifest.entries };
          for (const relPath of result.removed) delete remaining[relPath];
          this.manifestStore.save(workspaceRoot, target.id, remaining);

          targetHealth.push({
            target: target.id,
            detected: true,
            facets: target.facets,
            expected: 0,
            found: 0,
            missing: [],
            foreign: [],
            writeFailed: result.writeFailed,
            overwrittenLocalEdit: [],
            removed: result.removed,
            durationMs: Date.now() - startedAt,
          });
        } catch (error: unknown) {
          this.logger.warn('[harness-sync] Target removal failed (non-fatal)', {
            target: target.id,
            error: error instanceof Error ? error.message : String(error),
          });
          targetHealth.push(
            undetectedTargetHealth(
              target.id,
              target.facets,
              Date.now() - startedAt,
            ),
          );
        }
      }
    } finally {
      lock.release();
    }

    const health: HarnessHealth = {
      workspaceRoot,
      generatedAt: new Date().toISOString(),
      mode: 'full',
      reason: 'harness:remove',
      sources: 'ok',
      targets: targetHealth,
      collisions: [],
    };
    this.lastHealth = health;
    this.emitter.emit('health', health);
    return health;
  }

  private async runReconcile(
    workspaceRoot: string,
    options: HarnessReconcileOptions,
  ): Promise<HarnessHealth> {
    const agentSync = this.agentSync.resolve(workspaceRoot);
    const desired = this.builder.build(this.sourceResolver.resolve(), {
      downloadPending: options.downloadPending === true,
      agentSyncEnabled: agentSync.enabled,
    });

    const selected = this.selectTargets(options.targets);
    const lock = await acquireWorkspaceLock(workspaceRoot);
    if (!lock.acquired) {
      this.logger.warn(
        '[harness-sync] Proceeding without the workspace lock (contended or unwritable)',
        { workspaceRoot, reason: options.reason },
      );
    }

    const targetHealth: HarnessTargetHealth[] = [];
    try {
      // Inside the lock, like every other workspace file this lib writes, and
      // BEFORE the targets run so a pass that dies mid-copy still leaves the
      // migration decided. Only a DERIVED decision is written; a recorded flag
      // is never overwritten by a reconcile.
      if (agentSync.derived) {
        this.persistAgentSyncDecision(workspaceRoot, agentSync.enabled);
      }
      for (const target of selected) {
        targetHealth.push(
          await this.reconcileTarget(target, workspaceRoot, desired, options),
        );
      }
      this.maintainGitignore(workspaceRoot, selected, targetHealth, options);
    } finally {
      lock.release();
    }

    const health: HarnessHealth = {
      workspaceRoot,
      generatedAt: new Date().toISOString(),
      mode: options.mode,
      reason: options.reason,
      sources: desired.sources,
      targets: targetHealth,
      collisions: desired.collisions,
    };

    this.lastHealth = health;
    this.emitter.emit('health', health);
    this.log(health);
    return health;
  }

  /**
   * Record the migration's answer so the manifest evidence walk runs once.
   *
   * Non-fatal: a state file that could not be written means the next pass
   * re-derives the same answer from the same manifests, which is a repeated
   * read and never a different decision.
   */
  private persistAgentSyncDecision(
    workspaceRoot: string,
    enabled: boolean,
  ): void {
    try {
      if (this.agentSync.persist(workspaceRoot, enabled)) return;
      this.logger.warn(
        '[harness-sync] Could not record the agent-sync decision; it will be re-derived next pass',
        { workspaceRoot, agentSyncEnabled: enabled },
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[harness-sync] Recording the agent-sync decision threw',
        {
          workspaceRoot,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Keep `{ws}/.gitignore`'s managed block in step with what was written (E23).
   *
   * Runs at the END of a `full` pass and never during a `preflight`. Two
   * reasons, and both matter: preflight's whole contract is that it is cheap
   * enough to run on every session start, and a preflight is deliberately
   * blind to whether a target is detected — it compares hashes, not
   * installations, so it could not name the right directories anyway.
   *
   * Only DETECTED targets contribute. Ignoring `.cursor/skills/` in a
   * workspace with no Cursor would be a rule about a directory that will never
   * exist, in a file the user reads.
   *
   * Inside the lock, because it writes a workspace file; non-fatal, because a
   * `.gitignore` that could not be updated has not broken anybody's harness.
   */
  private maintainGitignore(
    workspaceRoot: string,
    selected: readonly IHarnessTarget[],
    targetHealth: readonly HarnessTargetHealth[],
    options: HarnessReconcileOptions,
  ): void {
    if (this.gitignore === null || options.mode !== 'full') return;

    const detected = new Set(
      targetHealth.filter((health) => health.detected).map((h) => h.target),
    );
    const dirs = selected
      .filter((target) => detected.has(target.id))
      .flatMap((target) => target.managedDirs?.() ?? []);
    if (dirs.length === 0) return;

    try {
      const result = this.gitignore.apply(workspaceRoot, dirs);
      if (result.outcome === 'failed') {
        this.logger.warn('[harness-sync] Could not update .gitignore', {
          workspaceRoot,
          reason: result.reason,
        });
      }
    } catch (error: unknown) {
      this.logger.warn('[harness-sync] .gitignore maintenance threw', {
        workspaceRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private selectTargets(ids: HarnessTargetId[] | undefined): IHarnessTarget[] {
    if (ids === undefined || ids.length === 0) return this.targets;
    const wanted = new Set(ids);
    return this.targets.filter((target) => wanted.has(target.id));
  }

  private async reconcileTarget(
    target: IHarnessTarget,
    workspaceRoot: string,
    desired: HarnessDesiredState,
    options: HarnessReconcileOptions,
  ): Promise<HarnessTargetHealth> {
    const startedAt = Date.now();
    try {
      if (!(await target.detect(workspaceRoot))) {
        return undetectedTargetHealth(
          target.id,
          target.facets,
          Date.now() - startedAt,
        );
      }

      const manifest = this.manifestStore.load(workspaceRoot, target.id);

      if (
        options.mode === 'preflight' &&
        !this.hasDrift(workspaceRoot, target.preflightKeys(desired), manifest)
      ) {
        return await target.verify(desired, workspaceRoot);
      }

      const plan = target.plan(desired, workspaceRoot, manifest);
      if (this.isNoOp(plan, manifest)) {
        return appliedTargetHealth(
          plan,
          target.facets,
          {
            written: {},
            removed: [],
            writeFailed: [],
            overwrittenLocalEdit: [],
          },
          Date.now() - startedAt,
        );
      }

      // Persisted BEFORE apply so an adopted legacy entry survives a crash
      // between deleting `.ptah-managed.json` and writing the new manifest.
      const adoptionSaved = this.manifestStore.save(
        workspaceRoot,
        target.id,
        plan.baseEntries,
      );

      const result = await target.apply(plan, workspaceRoot);
      const ownershipSaved = this.manifestStore.save(
        workspaceRoot,
        target.id,
        this.mergeEntries(plan.baseEntries, result.written, result.removed),
      );

      const health = appliedTargetHealth(
        plan,
        target.facets,
        result,
        Date.now() - startedAt,
      );
      if (adoptionSaved && ownershipSaved) return health;

      // A pass whose copies landed but whose OWNERSHIP RECORD did not is not a
      // clean pass, and it used to report as one. The manifest is the only proof
      // Ptah owns those files: without it the next pass reads an empty record
      // and classifies its own copies as foreign, which freezes the target until
      // someone repairs it by hand. Reported as a write failure against the
      // manifest path so `summarizeHarnessHealth` reads `error`, the badge goes
      // red and `ptah harness doctor` exits non-zero.
      return {
        ...health,
        writeFailed: [
          ...health.writeFailed,
          {
            relPath: this.manifestStore.manifestRelPath(target.id),
            reason:
              'the managed manifest could not be persisted; this pass wrote its artifacts but recorded no ownership for them',
          },
        ],
      };
    } catch (error: unknown) {
      // A target that throws must not take the pass down with it — the other
      // targets, and the health report itself, are still worth producing.
      this.logger.warn('[harness-sync] Target reconcile failed (non-fatal)', {
        target: target.id,
        workspaceRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      const health = undetectedTargetHealth(
        target.id,
        target.facets,
        Date.now() - startedAt,
      );
      return {
        ...health,
        detected: true,
        writeFailed: [
          {
            relPath: '(target)',
            reason: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }

  /**
   * Nothing to do: no writes, no removals, no migrations, and the ownership map
   * already matches. Checked so a steady-state reconcile does not rewrite the
   * manifest file on every activation.
   */
  private isNoOp(plan: HarnessPlan, manifest: ManagedManifest): boolean {
    if (
      plan.writes.length > 0 ||
      plan.removals.length > 0 ||
      plan.migrations.length > 0
    ) {
      return false;
    }
    return (
      JSON.stringify(sortKeys(plan.baseEntries)) ===
      JSON.stringify(sortKeys(manifest.entries))
    );
  }

  /**
   * Preflight drift test: hash comparison against the manifest plus an
   * existence check per owned path.
   *
   * The existence check is what makes this trustworthy rather than merely fast.
   * Without it, a workspace whose `.claude/skills` was deleted by hand would
   * pass preflight forever, because the manifest and the sources still agree.
   */
  private hasDrift(
    workspaceRoot: string,
    expected: ReadonlyMap<string, string>,
    manifest: ManagedManifest,
  ): boolean {
    if (Object.keys(manifest.entries).length !== expected.size) return true;

    for (const [relPath, sourceHash] of expected) {
      const owned = manifest.entries[relPath];
      // Compared against the SOURCE hash, not the recorded output hash: a
      // target that rewrites content on the way out (every rival CLI) records
      // an output hash that can never equal the desired source hash.
      if (owned === undefined || entrySourceHash(owned) !== sourceHash) {
        return true;
      }
      // An MCP key addresses an entry inside a shared config file; there is no
      // path to stat. Its hash comparison above is the whole check.
      if (isMcpFragmentKey(relPath)) continue;
      if (!existsSync(join(workspaceRoot, ...relPath.split('/')))) return true;
    }
    return false;
  }

  private mergeEntries(
    base: ManagedEntries,
    written: ManagedEntries,
    removed: string[],
  ): ManagedEntries {
    const merged: ManagedEntries = { ...base, ...written };
    for (const relPath of removed) {
      delete merged[relPath];
    }
    return merged;
  }

  private log(health: HarnessHealth): void {
    const totals = health.targets.reduce(
      (acc, target) => ({
        expected: acc.expected + target.expected,
        found: acc.found + target.found,
        missing: acc.missing + target.missing.length,
        foreign: acc.foreign + target.foreign.length,
        removed: acc.removed + target.removed.length,
        writeFailed: acc.writeFailed + target.writeFailed.length,
      }),
      {
        expected: 0,
        found: 0,
        missing: 0,
        foreign: 0,
        removed: 0,
        writeFailed: 0,
      },
    );

    const detail = {
      reason: health.reason,
      mode: health.mode,
      sources: health.sources,
      collisions: health.collisions.length,
      // `scope` and `targetCount` exist so the six counters below cannot be
      // read as a single target's numbers. They are SUMS over every target in
      // this pass, and a host that prints one target's slice with the same
      // field names produces a second line that can never agree with this one
      // (`apps/ptah-electron/.../plugin-activation.ts` printed `found=14/27`
      // beside this line's `found=106/119` for exactly that reason).
      scope: 'all-targets',
      targetCount: health.targets.length,
      ...totals,
      // The breakdown the aggregate hides. A pass whose every gap sits on ONE
      // target reads identically, in the summed counters, to a pass with the
      // same number of gaps spread evenly — and which target owns the gaps is
      // the first question anybody asks of this line.
      perTarget: health.targets.map((target) => ({
        target: target.target,
        detected: target.detected,
        expected: target.expected,
        found: target.found,
        missing: target.missing.length,
        foreign: target.foreign.length,
        removed: target.removed.length,
        writeFailed: target.writeFailed.length,
      })),
    };

    if (totals.writeFailed > 0 || totals.missing > 0) {
      this.logger.warn('[harness-sync] Reconcile finished with gaps', detail);
    } else {
      this.logger.debug('[harness-sync] Reconcile complete', detail);
    }

    // A SECOND line, deliberately. The summary above is unchanged so nothing
    // that parses it regresses; the shortfall it reports is explained here.
    this.logBlocked(health);
  }

  /**
   * The blocked set, as its own line, because `missing` alone cannot say why.
   *
   * `missing=13` beside `writeFailed=0` on a real cold start
   * (`tmp/logs/coldstart-306.log:844`) is the state this exists to explain, and
   * it is not the contradiction it reads as. A blocked path is filtered out
   * BEFORE `plan.writes` is built (`targets/claude-target.ts:189-194` does
   * `scanned.push(relPath); continue;` on a foreign outcome), so the failure
   * counter is STRUCTURALLY incapable of ever counting one. `writeFailed: 0`
   * was never evidence that the writes succeeded — those writes were never
   * attempted, on purpose, because an unowned file occupies the path and Ptah
   * does not overwrite what it cannot prove it wrote (E9).
   *
   * What this line does NOT do: it does not close the gap. The harness really
   * is incomplete, so `summarizeHarnessHealth` still reads `degraded` and the
   * badge stays amber. It stops spelling a refusal as a gap of unknown cause.
   *
   * Emitted only when the set is non-empty — silence stays silent when correct
   * — and labelled with the same `scope` the summary carries, so the two lines
   * cannot be read as one target's numbers beside another's.
   *
   * **`full` passes only, and `verify()` never.** Three surfaces could emit
   * this and only one should:
   *
   *   - `full` — activation, workspace change, content download, a plugin
   *     toggle, `harness:reconcile`, `ptah harness doctor --fix`. Bounded, and
   *     each one is either once per boot or something the user just asked for.
   *     This is the surface that logs.
   *   - `preflight` — every session start, throttled to 60 s per workspace
   *     root. The blocked set is a permanent steady state, so a session-start
   *     pass would repeat the identical multi-path object for every one of the
   *     skill-synthesis drain's nightly one-shot sessions and bury the
   *     activation line this one exists to accompany. Same rule, and the same
   *     reasoning, as `maintainGitignore` being `full`-only.
   *   - `verify()` — never reaches `log()` at all. It is what the health badge
   *     polls and what `ptah harness doctor` (without `--fix`) calls, and the
   *     doctor already prints these paths grouped by kind.
   *
   * Nothing is lost by the restriction: every host's boot line comes from an
   * activation `full` pass, and the manual repair path defaults to `full`.
   */
  private logBlocked(health: HarnessHealth): void {
    if (health.mode !== 'full') return;

    const paths = health.targets.flatMap((target) =>
      blockedTargetPaths(target).map((relPath) => ({
        target: target.target,
        relPath,
        reason: blockedReason(relPath),
      })),
    );
    if (paths.length === 0) return;

    this.logger.warn(
      '[harness-sync] Blocked: desired paths an unowned file occupies — refused, not failed',
      {
        reason: health.reason,
        mode: health.mode,
        scope: 'all-targets',
        targetCount: health.targets.length,
        blocked: paths.length,
        note: 'Counted in `missing` because the artifact is not installed, and in `foreign` because Ptah will not touch a file it cannot prove it wrote. A blocked path never enters the write plan, so `writeFailed` can never report one.',
        // Leads with MOVE, on purpose. Nothing about these paths proves Ptah
        // wrote them — see the blocked-path condition in this lib's CLAUDE.md —
        // so telling a user to delete them is telling them to destroy work that
        // may be their own, and `--fix` then writes Ptah's version over the
        // gap. Move is reversible; delete is not.
        action:
          'Move the occupant aside — the file or directory at each path, or the conflicting key in each config file — then re-run `ptah harness doctor --fix`. Nothing here proves Ptah wrote these, so they may be your own work: keep what you move, and read it before you discard anything.',
        paths,
      },
    );
  }
}

/**
 * Why one blocked path could not be written, in words a user can act on.
 *
 * Two shapes, because a blocked MCP entry is not a file at all: it is a server
 * key inside a config file the user also writes, so telling them to move or
 * delete a path would name something that does not exist.
 */
function blockedReason(relPath: string): string {
  return isMcpFragmentKey(relPath)
    ? 'the config file already defines this server key, and Ptah did not write it'
    : 'occupied by a file or directory Ptah does not own';
}

function sortKeys(entries: ManagedEntries): ManagedEntries {
  const sorted: ManagedEntries = {};
  for (const key of Object.keys(entries).sort()) {
    sorted[key] = entries[key];
  }
  return sorted;
}
