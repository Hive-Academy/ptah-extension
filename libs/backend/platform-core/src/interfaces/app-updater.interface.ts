/**
 * IAppUpdater — the read+trigger port behind the `update:*` RPC methods.
 * Gated by the `appUpdater` capability.
 *
 * Start/stop/interval management is deliberately absent: those are host
 * activation-lifecycle concerns with no library consumer.
 *
 * `AppUpdateState` mirrors `UpdateLifecycleState` in `@ptah-extension/shared`.
 * It is redeclared rather than imported to keep platform-core free of
 * inter-lib dependencies (see settings-auth-key.ts:9-10 for the same call).
 * Drift is a compile error in both directions — see the port's implementor
 * (`implements IAppUpdater`) and its consumer (UpdateRpcHandlers' typed
 * `registerMethod<_, UpdateGetStateResult>` return site).
 */
export type AppUpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | {
      state: 'available';
      currentVersion: string;
      newVersion: string;
      releaseDate?: string;
      releaseNotesMarkdown?: string | null;
      downloadUrl: string | null;
      releaseUrl: string;
    }
  | { state: 'dismissed' }
  | { state: 'error'; message: string };

export interface IAppUpdater {
  /** Latest known lifecycle state. Synchronous — no I/O. */
  getCurrentState(): AppUpdateState;
  /** Run an immediate check. Resolves once the state has been broadcast. */
  triggerCheck(): Promise<void>;
  /**
   * Record that the user downloaded `version`, so later checks stop prompting
   * for it. Persisted — a restart must not bring the prompt back. Only that
   * one version is suppressed: the next release prompts again.
   */
  markDownloaded(version: string): Promise<void>;
}
