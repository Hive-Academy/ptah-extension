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

import { join } from 'path';
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

/**
 * The one question {@link resolveAgentMirrorSource} asks the gate.
 *
 * Structural rather than the `AgentSyncGate` class, for the same reason
 * `HarnessPluginConfigReader` is: the caller needs one read-only method, and a
 * class type would make every host and every spec construct a manifest store
 * and a state store to answer it. `AgentSyncGate` satisfies this as-is.
 */
export interface AgentConsentReader {
  resolve(workspaceRoot: string): { enabled: boolean };
}

/**
 * The agent fields of a host's user-layer mirror call.
 *
 * Declared here rather than imported from `agent-generation`: this lib must
 * never depend on that one. `MirrorSources` satisfies this shape structurally,
 * so a host spreads the result straight into its mirror sources.
 */
export interface AgentMirrorSource {
  /** `{ws}/.claude/agents` — absent when this workspace has not consented. */
  agentSourceDir?: string;
  /** The root the agent clone directory is keyed by. */
  workspaceRoot?: string;
}

/**
 * What a host should mirror for the `agents` facet, and for which workspace.
 *
 * ONE implementation because there are THREE hosts — VS Code, Electron and the
 * CLI — and both rules below fail silently when one of them drifts.
 *
 * **The root must be the one this lib reconciles.** Agent clones live under a
 * key derived from it (`userLayerAgentDirName`), and `PluginConfigSourceResolver`
 * derives the same key from `resolveHarnessWorkspaceRoot(ws)`. A host that
 * passed its raw folder — a sub-folder of the real root, or another spelling of
 * it — would mirror into a directory the reconciler never reads. The reconciler
 * would then find no agents, and agents are manifest-owned, so it would REAP
 * every copy it has.
 *
 * **Consent gates the mirror, not only the propagation.** `buildAgents()` has
 * been gated since TASK_2026_286, but every host passed `agentSourceDir`
 * unconditionally — so any repository that ships `.claude/agents` populated the
 * machine-wide user layer on its first activation, whoever wrote those files and
 * whether or not the setup wizard had ever run (TASK_2026_365).
 *
 * The gate is read through `resolve`, never `HarnessState.agentSyncEnabled`
 * directly: an absent flag is answered from manifest evidence, and the mirror
 * runs BEFORE the reconcile that persists that answer. Reading the raw flag
 * would skip the mirror on the first pass after an upgrade and hand the
 * reconciler an empty desired state, which is a reap.
 *
 * A `null` gate is a wiring gap, not a consent answer, and it reads as
 * consented: mirroring only ever CREATES clones, so the unknown answer falls to
 * the non-destructive side, and the reconciler resolves the gate itself before
 * it can delete anything.
 */
export function resolveAgentMirrorSource(
  workspaceRoot: string | undefined,
  gate: AgentConsentReader | null,
): AgentMirrorSource {
  if (workspaceRoot === undefined || workspaceRoot === '') return {};
  const harnessRoot = resolveHarnessWorkspaceRoot(workspaceRoot);
  if (gate !== null && !gate.resolve(harnessRoot).enabled) return {};
  return {
    agentSourceDir: join(harnessRoot, '.claude', 'agents'),
    workspaceRoot: harnessRoot,
  };
}
