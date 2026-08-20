/**
 * The per-workspace consent gate for the `agents` facet.
 *
 * Skills and commands are content the user installed or authored on purpose:
 * a plugin toggle, a `SKILL.md` they wrote, a harness-builder run. Agents were
 * the one artifact kind that propagated with no gate at all — every `.md` under
 * `~/.ptah/user/agents` was fanned out to `.codex/agents`, `.github/agents` and
 * `.cursor/agents` on the first pass, in every workspace, whether or not the
 * user had ever asked Ptah to manage subagents for that project.
 *
 * The decision is per WORKSPACE, so it belongs in `state.json` next to the
 * `.gitignore` decisions — the reconciler's memory of choices the USER made, as
 * opposed to the manifests beside it, which record what PTAH wrote.
 *
 * ## The migration rule, which is the whole reason this class exists
 *
 * Agents are manifest-owned, so anything that drops out of the desired state is
 * REAPED by the removal sweep. A flag that defaulted to `false` would therefore
 * not merely stop propagating: the first pass after the upgrade would delete
 * every existing user's `.codex/agents/*.toml`, `.github/agents/*.agent.md` and
 * `.cursor/agents/*.md`, silently, as a routine reconcile.
 *
 * So an ABSENT flag is never a bare `false`. It resolves from evidence:
 *
 *   absent + any per-target manifest already owns an `agent` entry -> `true`
 *   absent + no manifest owns one                                  -> `false`
 *
 * Prior propagation IS prior consent — those files exist because a previous
 * version of Ptah put them there, and the user has been living with them. A
 * workspace with no agent entries has nothing to lose and starts gated.
 *
 * The resolved value is then PERSISTED, so the evidence walk runs exactly once
 * per workspace and the answer cannot flip later just because a reap emptied
 * the manifests.
 *
 * Manifests are read for every id in {@link HARNESS_TARGET_IDS}, not just the
 * targets this host registered. The evidence is on disk; a CLI host that
 * registers fewer targets than the extension did must not read the same
 * workspace as un-propagated and gate it.
 */

import { HARNESS_TARGET_IDS } from '@ptah-extension/shared';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import type { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { resolveHarnessWorkspaceRoot } from '../workspace/workspace-root';

export interface AgentSyncDecision {
  /** Whether `buildAgents()` may produce a desired state at all. */
  enabled: boolean;
  /**
   * The flag was absent and this answer came from the manifest evidence walk.
   * The reconciler persists it; `verify()` deliberately does not, because
   * asking what state the harness is in must not change it.
   */
  derived: boolean;
}

export class AgentSyncGate {
  constructor(
    private readonly manifestStore: ManagedManifestStore,
    private readonly stateStore: HarnessStateStore = new HarnessStateStore(),
  ) {}

  /**
   * Read-only. `workspaceRoot` must already be normalized — the reconciler
   * resolves once at its entry point (E14) and every collaborator below it
   * assumes the real root.
   */
  resolve(workspaceRoot: string): AgentSyncDecision {
    const state = this.stateStore.load(workspaceRoot);
    if (state.agentSyncEnabled !== undefined) {
      return { enabled: state.agentSyncEnabled, derived: false };
    }
    return { enabled: this.hasOwnedAgents(workspaceRoot), derived: true };
  }

  /**
   * Write a derived decision down so the evidence walk runs once.
   *
   * A flag that is already recorded is never overwritten: this is the migration
   * step, not a way to revoke consent. Called from inside the workspace lock,
   * like every other write this lib makes to a workspace file.
   */
  persist(workspaceRoot: string, enabled: boolean): boolean {
    const state = this.stateStore.load(workspaceRoot);
    if (state.agentSyncEnabled !== undefined) return true;
    return this.stateStore.save(workspaceRoot, {
      ...state,
      agentSyncEnabled: enabled,
    });
  }

  /**
   * The wizard's grant: completing the setup wizard IS the user asking Ptah to
   * manage subagents for this workspace.
   *
   * Takes a raw path and normalizes it, because the caller is an RPC handler
   * holding `IWorkspaceProvider.getWorkspaceRoot()` rather than a value the
   * reconciler already resolved. `resolveHarnessWorkspaceRoot` is a fixed point,
   * so passing an already-resolved root through it is a no-op.
   */
  enable(cwd: string, completedAt: string = new Date().toISOString()): boolean {
    const workspaceRoot = resolveHarnessWorkspaceRoot(cwd);
    const state = this.stateStore.load(workspaceRoot);
    return this.stateStore.save(workspaceRoot, {
      ...state,
      agentSyncEnabled: true,
      wizardCompletedAt: completedAt,
    });
  }

  /** Does any per-target manifest record an agent this workspace already owns? */
  private hasOwnedAgents(workspaceRoot: string): boolean {
    for (const target of HARNESS_TARGET_IDS) {
      const manifest = this.manifestStore.load(workspaceRoot, target);
      for (const entry of Object.values(manifest.entries)) {
        if (entry.kind === 'agent') return true;
      }
    }
    return false;
  }
}
