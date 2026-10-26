/**
 * What one refresh did, so a caller that reports a Library outcome (the setup
 * wizard, the marketplace) can tell "the Library is current" from "the
 * Library may be stale".
 *
 * - `refreshed` — the mirror and reconcile pass ran to completion.
 * - `failed` — the pass ran and at least one step failed; the user layer may
 *   be stale.
 * - `skipped` — no pass ran: the host has no refresher, or its scheduler
 *   declined to admit the pass.
 */
export type UserLayerRefreshStatus = 'refreshed' | 'failed' | 'skipped';

/**
 * Refresh the user layer before a reconcile reads it.
 *
 * `~/.ptah/user/{skills,commands,agents}` IS the reconciler's desired state, so
 * every trigger that changed an UPSTREAM source — a promoted synth skill, a
 * harness-builder plugin, a hand-edited `{ws}/.claude/agents/x.md`, an
 * uninstalled marketplace plugin — has to get that change into the user layer
 * before `reconcile` can see it. A reconcile fired straight after such a change
 * is a no-op that looks like a success.
 *
 * This is a PORT rather than a direct call because the two halves of that
 * refresh live in `agent-generation` (`UserLayerMirrorService.mirrorAll` for
 * create-if-absent, `reconcileAll` for fast-forward + reap), and
 * `agent-generation` is on this lib's forbidden-import list. The hosts already
 * own the `MirrorSources` block — it needs the plugin loader, the content
 * download service and the workspace provider, none of which belong here — so
 * they implement this one method and `HarnessPropagationService` calls it.
 *
 * The port is deliberately narrow: it takes a workspace root and an optional
 * label, and returns a {@link UserLayerRefreshStatus}. A refresher that fails
 * must NOT throw — it returns `'failed'`. A stale user layer degrades a
 * propagation into "reconcile what we already had", which is still better
 * than failing the caller that changed a skill.
 */
export interface IUserLayerRefresher {
  /**
   * Mirror every upstream source into the user layer, then reconcile the
   * clones against those sources (fast-forward, flag divergence, reap).
   *
   * @param workspaceRoot The workspace whose `.claude/agents` is one of the
   *   sources, or `undefined` when no workspace is open — a headless host
   *   still has plugin and synth sources worth mirroring.
   * @param reason The host's label for this refresh, from
   *   {@link HarnessPropagateOptions.userLayerRefreshReason}. Absent means the
   *   host's default propagation label. A host may use it to schedule the pass
   *   (Electron holds background-only labels while a turn is generating,
   *   TASK_2026_437 FU-17b); a host with no such concept ignores it. An
   *   implementation MUST treat `undefined` exactly like an omitted argument:
   *   `HarnessPropagationService` always passes the option through.
   * @returns The pass status. Never rejects: a failure is `'failed'`.
   */
  refresh(
    workspaceRoot: string | undefined,
    reason?: string,
  ): Promise<UserLayerRefreshStatus>;
}

/**
 * The default for a host that has not wired a refresher.
 *
 * Chosen over "throw" and over "required constructor argument" because the
 * degraded behaviour is correct: propagation still reconciles, it just cannot
 * pick up an upstream change made since the last mirror. A CLI host booting
 * before its content download lands is exactly that situation.
 */
export const NO_USER_LAYER_REFRESH: IUserLayerRefresher = {
  async refresh(): Promise<UserLayerRefreshStatus> {
    return 'skipped';
  },
};
