/**
 * The seam through which a session start reaches the harness reconciler.
 *
 * `agent-sdk` must never import `@ptah-extension/harness-sync` — that lib is a
 * leaf deliberately kept out from under this 10-concern one, and the
 * relationship is documented as one-way in both directions' CLAUDE.md. So the
 * session path declares what it NEEDS instead of what provides it: a single
 * bounded method, structurally satisfied by `HarnessPreflightService` with no
 * import either way. Hosts alias `HARNESS_PREFLIGHT_TOKEN` onto
 * `HARNESS_SYNC_TOKENS.PREFLIGHT` in one line of registration.
 *
 * This is the same idiom `harness-sync` already uses for
 * `HarnessPluginConfigReader` / `PluginLoaderService`.
 *
 * `HarnessHealth` comes from `@ptah-extension/shared`, which both sides already
 * depend on, so the return type costs no new edge.
 *
 * The contract every implementation must keep — the session path relies on all
 * three and does not defend against them:
 *
 * - **Never throws.** A harness problem is reported, never raised into a
 *   session that was about to answer a user.
 * - **Bounded.** It returns within roughly `timeoutMs` whatever the disk does.
 * - **`null` means "carry on".** Throttled, timed out, no workspace, no
 *   reconciler — all of them are `null`, and none of them is a reason to stop.
 */

import type { HarnessHealth } from '@ptah-extension/shared';

export interface HarnessPreflightRequest {
  /** Overrides the host's configured budget for this one call. */
  timeoutMs?: number;
  /** Bypass the per-workspace throttle. Reserved for explicit user actions. */
  force?: boolean;
}

export interface IHarnessPreflight {
  /**
   * Verify (and if necessary repair) the harness for the workspace containing
   * `cwd`, within a bounded budget.
   *
   * @param cwd The session's working directory. It may be a sub-folder of the
   *   workspace — a rival CLI spawned for one package of a monorepo hands us
   *   exactly that — and the implementation is responsible for resolving it to
   *   the workspace root (E14).
   */
  ensure(
    cwd: string,
    options?: HarnessPreflightRequest,
  ): Promise<HarnessHealth | null>;
}

/** DI token. Bound by each host to the concrete reconciler-backed service. */
export const HARNESS_PREFLIGHT_TOKEN = Symbol.for('PtahHarnessPreflight');
