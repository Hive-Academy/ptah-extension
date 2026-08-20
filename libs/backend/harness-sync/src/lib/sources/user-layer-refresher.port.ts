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
 * The port is deliberately narrow: it takes a workspace root and returns
 * nothing. A refresher that fails must NOT throw — a stale user layer degrades
 * a propagation into "reconcile what we already had", which is still better
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
   */
  refresh(workspaceRoot: string | undefined): Promise<void>;
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
  async refresh(): Promise<void> {
    return;
  },
};
