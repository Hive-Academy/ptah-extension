/**
 * DI tokens for `harness-sync`.
 *
 * Convention matches `TASK_SPECS_TOKENS` / `SKILL_SYNTHESIS_TOKENS`:
 * `Symbol.for(...)` so the identity survives bundle boundaries (VS Code's
 * `main.mjs`, Electron's main bundle and the CLI bundle each build the lib
 * separately), globally unique descriptions, frozen `as const`.
 */
export const HARNESS_SYNC_TOKENS = {
  /** `HarnessReconcilerService` — the one entry point. */
  RECONCILER: Symbol.for('HarnessSyncReconciler'),
  /** `HarnessManifestBuilder` — desired state from the sources. */
  MANIFEST_BUILDER: Symbol.for('HarnessSyncManifestBuilder'),
  /** `ManagedManifestStore` — `{ws}/.ptah/harness/<target>.manifest.json`. */
  MANIFEST_STORE: Symbol.for('HarnessSyncManifestStore'),
  /** `IHarnessSourceResolver` — where the user layer is, what is disabled. */
  SOURCE_RESOLVER: Symbol.for('HarnessSyncSourceResolver'),
  /** `IHarnessCliDetector` — which rival CLIs are installed on this machine. */
  CLI_DETECTOR: Symbol.for('HarnessSyncCliDetector'),
  /**
   * `IHarnessTarget` — MULTI-registration. Resolve with `resolveAll`, never
   * `resolve`: six implementations are registered under this token and a
   * single-resolve host would silently reconcile only the last one.
   */
  TARGET: Symbol.for('HarnessSyncTarget'),
  /**
   * `HarnessPropagationService` — refresh the user layer, then reconcile.
   * What every "something changed upstream" trigger calls (Batch 3).
   */
  PROPAGATION: Symbol.for('HarnessSyncPropagation'),
  /**
   * `HarnessPreflightService` — the bounded session-start check.
   *
   * Hosts ALSO alias `HARNESS_PREFLIGHT_TOKEN` (agent-sdk) to this, which is
   * how a session path gets a preflight without `agent-sdk` importing this lib.
   */
  PREFLIGHT: Symbol.for('HarnessSyncPreflight'),
  /**
   * `IUserLayerRefresher` — the host-supplied mirror + reconcileAll pass.
   * Defaults to `NO_USER_LAYER_REFRESH` when a host wires none.
   */
  USER_LAYER_REFRESHER: Symbol.for('HarnessSyncUserLayerRefresher'),
  /**
   * `HarnessGitignoreWriter` — the managed `.gitignore` block (E23). Registered
   * as well as handed to the reconciler so a host can inspect or exercise it
   * without a full pass.
   */
  GITIGNORE: Symbol.for('HarnessSyncGitignore'),
  /**
   * `AgentSyncGate` — the per-workspace consent gate for the `agents` facet.
   * Registered as well as handed to the reconciler because the setup wizard
   * GRANTS consent (`wizard:submit-selection`) from `rpc-handlers`, which has
   * no reconciler to reach through.
   */
  AGENT_SYNC_GATE: Symbol.for('HarnessSyncAgentSyncGate'),
} as const;

export type HarnessSyncDIToken = keyof typeof HARNESS_SYNC_TOKENS;
