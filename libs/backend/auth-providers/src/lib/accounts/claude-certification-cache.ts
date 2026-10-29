import type { ClaudeCertifiedLaunchContext, ClaudeCertifiedSettingSource } from '@ptah-extension/auth-providers-tokens';
import type { CanonicalProviderAccountRoute } from './provider-account-route';

/**
 * How long a passed run certification may be reused for the same profile and
 * run inputs. Reuse skips only the policy scan and the `auth status` child of
 * certification; every launch still runs the boundary scan and the post-init
 * identity check, so this bounds how long a change that only the `auth status`
 * child would see (and that the post-init check would not refuse) goes unseen.
 */
export const CLAUDE_CERTIFICATION_REUSE_MS = 5 * 60_000;

/**
 * The stored profile facts a certification was proved for. `revision` moves
 * on every recorded status change, sign-in, sign-out and rename; `authEpoch`
 * on every sign-in and sign-out; `routeRevision` on a route change. Any
 * difference is a miss, so those events invalidate without a callback.
 */
export interface ClaudeCertificationScope {
  readonly profileId: string;
  readonly revision: number;
  readonly authEpoch: number;
  readonly routeRevision: number;
}

/** The inputs of one certification; equal keys certify the same launch. */
export interface ClaudeCertificationKeyInput {
  readonly scope: ClaudeCertificationScope;
  readonly route: CanonicalProviderAccountRoute;
  readonly identityRef: string | null;
  readonly cwd: string;
  readonly settingSources: readonly ClaudeCertifiedSettingSource[];
}

interface CachedCertification {
  readonly key: string;
  readonly launch: ClaudeCertifiedLaunchContext;
  readonly expiresAt: number;
}

function frozenLaunch(launch: ClaudeCertifiedLaunchContext): ClaudeCertifiedLaunchContext {
  const { executable } = launch;
  return Object.freeze({
    ...launch,
    executable: Object.freeze({ ...executable, prefixArgs: Object.freeze([...executable.prefixArgs]),
      fingerprint: Object.freeze({ ...executable.fingerprint }) }),
    env: Object.freeze({ ...launch.env }),
    settingSources: Object.freeze([...launch.settingSources]),
    policy: Object.freeze({ ...launch.policy }),
  });
}

/** At most one entry per profile: the latest passed certification. In memory only. */
export class ClaudeCertificationCache {
  private readonly entries = new Map<string, CachedCertification>();

  constructor(private readonly now: () => number, private readonly ttlMs = CLAUDE_CERTIFICATION_REUSE_MS) {}

  static key(input: ClaudeCertificationKeyInput): string {
    const { scope, route } = input;
    return JSON.stringify([scope.revision, scope.authEpoch, scope.routeRevision, route.fingerprint, route.canonicalPath,
      route.filesystemIdentity, input.identityRef, input.cwd, [...input.settingSources]]);
  }

  /** The cached launch for an equal key that has not expired; a stale or other-key entry is dropped. */
  get(profileId: string, key: string): ClaudeCertifiedLaunchContext | undefined {
    const entry = this.entries.get(profileId);
    if (!entry) return undefined;
    if (entry.key !== key || this.now() >= entry.expiresAt) {
      this.entries.delete(profileId);
      return undefined;
    }
    return entry.launch;
  }

  /**
   * Stores a deeply frozen copy and returns it. Every admission that reuses
   * the entry shares that one object, so no caller can change the env, the
   * executable or the policy another admission launches with.
   */
  set(profileId: string, key: string, launch: ClaudeCertifiedLaunchContext): ClaudeCertifiedLaunchContext {
    const frozen = frozenLaunch(launch);
    this.entries.set(profileId, { key, launch: frozen, expiresAt: this.now() + this.ttlMs });
    return frozen;
  }

  forget(profileId: string): void {
    this.entries.delete(profileId);
  }

  /** Drops every entry that handed out `launch` (a refused launch boundary). */
  forgetLaunch(launch: ClaudeCertifiedLaunchContext): void {
    for (const [profileId, entry] of this.entries) {
      if (entry.launch === launch) this.entries.delete(profileId);
    }
  }
}
