/**
 * Unattended session policies, keyed by the routing id (tab id) of a session
 * nobody is watching (TASK_2026_584).
 *
 * The session spawner registers a policy before it starts a child session and
 * calls the returned disposer when the child ends. `SdkPermissionHandler`
 * reads the registry live on every tool call: a registered id gets the
 * unattended decision table; an unregistered id takes the normal path.
 */
import { injectable } from 'tsyringe';
import { SdkError } from '../errors';

/** Ceiling for the reviewer window of an unattended prompt: ten minutes. */
export const UNATTENDED_DENY_WINDOW_MAX_MS = 600_000;

export interface UnattendedSessionPolicy {
  /** Command prefixes Bash may run without a prompt (token-boundary match). */
  readonly bashAllowlist: readonly string[];
  /** Write/Edit/NotebookEdit targets inside this directory run without a prompt. */
  readonly writableRoot: string;
  /**
   * How long a prompt for an out-of-policy call waits for a human before it is
   * denied. Clamped to 0..600000 at registration; `0` denies without prompting.
   */
  readonly denyWindowMs: number;
  /** Who started the session, named in deny messages (e.g. the parent tab). */
  readonly ownerLabel: string;
}

interface RegistryEntry {
  readonly policy: UnattendedSessionPolicy;
}

function clampDenyWindow(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), UNATTENDED_DENY_WINDOW_MAX_MS);
}

@injectable()
export class UnattendedSessionPolicyRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  /**
   * Register (or replace) the policy for a routing id. The returned disposer
   * removes THIS registration only: once the id has been registered again,
   * a stale disposer is a no-op. Calling the disposer twice is harmless.
   */
  register(routingId: string, policy: UnattendedSessionPolicy): () => void {
    if (typeof routingId !== 'string' || routingId.trim().length === 0) {
      throw new SdkError(
        'Cannot register an unattended session policy without a routing id.',
      );
    }

    const entry: RegistryEntry = {
      policy: Object.freeze({
        bashAllowlist: Object.freeze([...policy.bashAllowlist]),
        writableRoot: policy.writableRoot,
        denyWindowMs: clampDenyWindow(policy.denyWindowMs),
        ownerLabel: policy.ownerLabel,
      }),
    };
    this.entries.set(routingId, entry);

    return () => {
      if (this.entries.get(routingId) === entry) {
        this.entries.delete(routingId);
      }
    };
  }

  get(routingId: string | undefined): UnattendedSessionPolicy | undefined {
    if (routingId === undefined) {
      return undefined;
    }
    return this.entries.get(routingId)?.policy;
  }
}
