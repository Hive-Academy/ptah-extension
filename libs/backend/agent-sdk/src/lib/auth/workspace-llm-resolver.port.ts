import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';

/**
 * Provider AND model for LLM work done on behalf of one workspace, resolved
 * together from that workspace's settings.
 *
 * A one-shot that omits `auth` rides the process-wide `AuthEnv`, which holds
 * whichever provider was configured last (the active workspace's, or another
 * one after a workspace-scoped save), while its model is read separately. The
 * two then disagree: one workspace's model is sent to another's provider.
 * Every caller that runs LLM work for a workspace hands both fields of one
 * snapshot to `InternalQueryService.execute({ model, auth })`.
 */
export interface WorkspaceLlmSnapshot {
  /** Provider registry id the snapshot targets (`'anthropic'` for direct). */
  readonly providerId: string;
  /** Concrete model id for that provider (tier aliases already resolved). */
  readonly model: string;
  /**
   * Isolated credentials for the provider. `undefined` only when no isolated
   * snapshot could be built (unknown provider, missing credentials, a proxy
   * that failed to start); the query then rides the process-wide auth, and the
   * resolver has logged why.
   */
  readonly auth?: OneShotAuthOverride;
  /**
   * Milliseconds the provider is still cooling down from an upstream 429;
   * absent when it is usable. Callers that must not spend into an exhausted
   * quota (commit message, background work) stop instead of dialling it.
   */
  readonly cooldownMs?: number;
}

export interface WorkspaceLlmResolveOptions {
  /**
   * A model the caller wants instead of the workspace's saved one (e.g. a
   * frontend selection). Kept only when the snapshot's provider offers it;
   * otherwise the workspace's model is used.
   */
  readonly requestedModel?: string;
}

/**
 * Resolves a {@link WorkspaceLlmSnapshot} for an explicit workspace path.
 *
 * Declared in `agent-sdk`, implemented in `auth-providers` (which depends on
 * `agent-sdk`, never the reverse) — same split as `IProviderAuthResolver`.
 *
 * Policy:
 * - a workspace with a provider override resolves that provider and the model
 *   saved for it in that workspace;
 * - a workspace without one, and a rootless caller (`undefined` / `''`),
 *   resolve the app-, then global-scoped provider and model explicitly — never
 *   the active workspace's.
 */
export interface IWorkspaceLlmResolver {
  resolveForPath(
    workspaceRoot: string | undefined,
    options?: WorkspaceLlmResolveOptions,
  ): Promise<WorkspaceLlmSnapshot>;
}
