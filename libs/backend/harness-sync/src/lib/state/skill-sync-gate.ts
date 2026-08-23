/**
 * The per-workspace selection gate for the `skills` facet (TASK_2026_316).
 *
 * `~/.ptah/user/skills` is one directory per MACHINE and the mirror is
 * create-if-absent: enable `ptah-angular` once, in one workspace, and its
 * skills are cloned there permanently. Batch 1 taught the builder to apply THIS
 * workspace's plugin enablement to that base, which fixes the case where a
 * plugin toggle exists to speak for a clone. It cannot fix the rest: a
 * hand-authored skill, a promoted synth skill, a `skills.sh` install and an
 * opt-out harness plugin all have no plugin above them, so nothing in a
 * workspace can say "not in THIS project". Every project on the machine
 * inherited the union of every skill the user had ever acquired anywhere.
 *
 * The decision is per WORKSPACE, so it belongs in `state.json` next to the
 * `.gitignore` decisions and `agentSyncEnabled` — the reconciler's memory of
 * choices the USER made, as opposed to the manifests beside it, which record
 * what PTAH wrote. It is deliberately not a setting: a user-global "sync
 * skills" toggle would either propagate into every project on the machine or
 * silently mean nothing in most of them, which is the reported defect restated.
 *
 * ## The migration rule, which is the whole reason this class exists
 *
 * Skills are manifest-owned, so anything that drops out of the desired state is
 * REAPED by the removal sweep. A mode that defaulted to `'selected'` with an
 * empty allowlist would therefore not merely stop propagating: the first
 * routine reconcile after the upgrade would DELETE every `.claude/skills/*`,
 * `.agents/skills/*`, `.github/skills/*` and `.cursor/skills/*` Ptah had ever
 * written, in every existing workspace, silently, reported as an ordinary clean
 * pass. Skills are the largest artifact family by count, so this is the worst
 * available version of the failure `AgentSyncGate` exists to prevent.
 *
 * So an ABSENT mode is never a bare `'selected'`. It resolves from evidence:
 *
 *   absent + any per-target manifest already owns a `skill` entry -> `'all'`
 *   absent + no manifest owns one            -> `'selected'` with no slugs
 *
 * Prior propagation IS prior consent — those files exist because a previous
 * version of Ptah put them there, and the user has been living with them. A
 * workspace with no skill entries has nothing to lose and starts gated, which
 * is exactly the intended behaviour for a NEW workspace: it propagates nothing
 * until asked.
 *
 * The resolved value is then PERSISTED, so the evidence walk runs exactly once
 * per workspace and the answer cannot flip later just because a reap emptied
 * the manifests.
 *
 * Manifests are read for every id in {@link HARNESS_TARGET_IDS}, not just the
 * targets this host registered. The evidence is on disk; a CLI host that
 * registers fewer targets than the extension did must not read the same
 * workspace as un-propagated and gate it.
 *
 * This is `state/agent-sync-gate.ts`'s shape, deliberately, down to the
 * `derived` flag and the never-overwrite rule in {@link persist}. The lib's
 * guidelines call that file the worked example and say to copy it rather than
 * invent a second migration idiom.
 */

import { HARNESS_TARGET_IDS } from '@ptah-extension/shared';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import type { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { resolveHarnessWorkspaceRoot } from '../workspace/workspace-root';

/** Everything the user layer offers, or only the recorded allowlist. */
export type SkillSyncMode = 'all' | 'selected';

/** What the builder needs in order to gate `buildSkills`. */
export interface SkillSyncSelection {
  readonly mode: SkillSyncMode;
  /**
   * Skill directory names, keyed exactly as `disabledSkillIds` is. Empty and
   * meaningless under `'all'`; empty under `'selected'` means this workspace
   * propagates no skills at all, which is a legitimate state and not an error.
   */
  readonly slugs: readonly string[];
}

export interface SkillSyncDecision extends SkillSyncSelection {
  /**
   * The mode was absent and this answer came from the manifest evidence walk.
   * The reconciler persists it; `verify()` deliberately does not, because
   * asking what state the harness is in must not change it.
   */
  readonly derived: boolean;
}

export class SkillSyncGate {
  constructor(
    private readonly manifestStore: ManagedManifestStore,
    private readonly stateStore: HarnessStateStore = new HarnessStateStore(),
  ) {}

  /**
   * Read-only. `workspaceRoot` must already be normalized — the reconciler
   * resolves once at its entry point (E14) and every collaborator below it
   * assumes the real root.
   */
  resolve(workspaceRoot: string): SkillSyncDecision {
    const state = this.stateStore.load(workspaceRoot);
    if (state.skillSyncMode !== undefined) {
      return {
        mode: state.skillSyncMode,
        slugs: normalizeSlugs(
          state.skillSyncMode === 'selected' ? state.enabledSkillSlugs : [],
        ),
        derived: false,
      };
    }
    // The migration. `'all'` on evidence of prior propagation; gated only for a
    // workspace that has nothing to lose.
    return {
      mode: this.hasOwnedSkills(workspaceRoot) ? 'all' : 'selected',
      slugs: [],
      derived: true,
    };
  }

  /**
   * Write a derived decision down so the evidence walk runs once.
   *
   * A mode that is already recorded is never overwritten: this is the migration
   * step, not a way to revoke a selection the user made. Called from inside the
   * workspace lock, like every other write this lib makes to a workspace file.
   */
  persist(workspaceRoot: string, decision: SkillSyncSelection): boolean {
    const state = this.stateStore.load(workspaceRoot);
    if (state.skillSyncMode !== undefined) return true;
    return this.stateStore.save(workspaceRoot, {
      ...state,
      skillSyncMode: decision.mode,
      // Written explicitly (as `[]`) under `'selected'` so the recorded state
      // is a complete answer rather than a mode plus an absent list some later
      // reader has to guess at; cleared under `'all'`, where an allowlist has
      // no meaning.
      enabledSkillSlugs:
        decision.mode === 'selected'
          ? normalizeSlugs(decision.slugs)
          : undefined,
    });
  }

  /**
   * The user's explicit choice: propagate exactly these slugs here.
   *
   * Unlike {@link persist} this DOES overwrite a recorded mode — that is the
   * difference between the migration and the surface the user drives.
   *
   * Takes a raw path and normalizes it, because the caller is an RPC handler
   * holding `IWorkspaceProvider.getWorkspaceRoot()` rather than a value the
   * reconciler already resolved. `resolveHarnessWorkspaceRoot` is a fixed
   * point, so passing an already-resolved root through it is a no-op.
   *
   * `skillSelectionAt` is recorded for the reason `AgentSyncGate.enable`
   * records `wizardCompletedAt`: it is the difference between "the user asked
   * for this" and "the migration inferred it", and for an empty allowlist those
   * two are otherwise indistinguishable on disk.
   */
  select(
    cwd: string,
    slugs: readonly string[],
    selectedAt: string = new Date().toISOString(),
  ): boolean {
    const workspaceRoot = resolveHarnessWorkspaceRoot(cwd);
    const state = this.stateStore.load(workspaceRoot);
    return this.stateStore.save(workspaceRoot, {
      ...state,
      skillSyncMode: 'selected',
      enabledSkillSlugs: normalizeSlugs(slugs),
      skillSelectionAt: selectedAt,
    });
  }

  /**
   * The "just give me everything here" escape hatch.
   *
   * Clears the allowlist rather than keeping it: a stale list surviving a
   * switch to `'all'` would read as a selection nobody made the next time the
   * user narrowed the mode again.
   */
  enableAll(
    cwd: string,
    selectedAt: string = new Date().toISOString(),
  ): boolean {
    const workspaceRoot = resolveHarnessWorkspaceRoot(cwd);
    const state = this.stateStore.load(workspaceRoot);
    return this.stateStore.save(workspaceRoot, {
      ...state,
      skillSyncMode: 'all',
      enabledSkillSlugs: undefined,
      skillSelectionAt: selectedAt,
    });
  }

  /** Does any per-target manifest record a skill this workspace already owns? */
  private hasOwnedSkills(workspaceRoot: string): boolean {
    for (const target of HARNESS_TARGET_IDS) {
      const manifest = this.manifestStore.load(workspaceRoot, target);
      for (const entry of Object.values(manifest.entries)) {
        if (entry.kind === 'skill') return true;
      }
    }
    return false;
  }
}

/**
 * Trim, drop empties, deduplicate, sort.
 *
 * Deliberately NOT canonicalized (no case folding): the allowlist is keyed by
 * directory name with a raw membership test, exactly as `disabledSkillIds` is,
 * so one saved config keys both without a second canonicalisation rule to keep
 * in step. Sorting is what makes two identical selections produce an identical
 * `state.json`, so a re-select of the same set is not a spurious write.
 */
function normalizeSlugs(slugs: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const slug of slugs ?? []) {
    const trimmed = slug.trim();
    if (trimmed !== '') seen.add(trimmed);
  }
  return [...seen].sort();
}
