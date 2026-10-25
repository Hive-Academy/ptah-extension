import {
  sessionRuntimeIdentityMismatch,
  type AppliedSettings,
  type EffortLevel,
  type PermissionLevel,
  type SessionId,
  type SessionRuntimeControls,
  type SessionRuntimeIdentity,
} from '@ptah-extension/shared';

export interface SessionRuntimeIdentityLookup {
  /** undefined means unknown session; an empty binding means missing identity. */
  lookup(sessionId: SessionId):
    | {
        readonly live?: SessionRuntimeIdentity;
        readonly persisted?: SessionRuntimeIdentity;
      }
    | undefined;
}

/** Native implementation is supplied by the host, never constructed as fallback. */
export type NativeSessionControls = SessionRuntimeControls;

export class SessionRuntimeRoutingError extends Error {
  constructor(
    readonly code: 'unknown-session' | 'missing-identity' | 'identity-mismatch',
    readonly sessionId: SessionId,
    readonly field?: string,
  ) {
    super(`Session runtime routing failed: ${code}`);
    this.name = 'SessionRuntimeRoutingError';
  }
}

export class SessionRuntimeRouter implements SessionRuntimeControls {
  private readonly blockedFollowUps = new Map<SessionId, symbol>();

  constructor(
    private readonly identities: SessionRuntimeIdentityLookup,
    private readonly legacy: SessionRuntimeControls,
    private readonly native: NativeSessionControls,
  ) {}

  async setPermission(
    sessionId: SessionId,
    level: PermissionLevel,
  ): Promise<AppliedSettings> {
    return this.controls(sessionId).setPermission(sessionId, level);
  }

  async setModel(
    sessionId: SessionId,
    model: string,
  ): Promise<AppliedSettings> {
    return this.controls(sessionId).setModel(sessionId, model);
  }

  async setEffort(
    sessionId: SessionId,
    effort: EffortLevel | undefined,
  ): Promise<AppliedSettings> {
    return this.controls(sessionId).setEffort(sessionId, effort);
  }

  async compact(sessionId: SessionId): Promise<void> {
    await this.controls(sessionId).compact(sessionId);
  }

  async interrupt(sessionId: SessionId): Promise<boolean> {
    // Block during the acknowledgement too. Throws and false both leave it blocked.
    const controls = this.controls(sessionId);
    const attempt = Symbol();
    this.blockedFollowUps.set(sessionId, attempt);
    const interrupted = await controls.interrupt(sessionId);
    if (interrupted && this.blockedFollowUps.get(sessionId) === attempt) {
      this.blockedFollowUps.delete(sessionId);
    }
    return interrupted;
  }

  canSendFollowUp(sessionId: SessionId): boolean {
    this.controls(sessionId);
    return !this.blockedFollowUps.has(sessionId);
  }

  /** Call on final session disposal. Only a successful interrupt clears a live block. */
  releaseSession(sessionId: SessionId): void {
    this.blockedFollowUps.delete(sessionId);
  }

  private controls(sessionId: SessionId): SessionRuntimeControls {
    const binding = this.identities.lookup(sessionId);
    if (!binding)
      throw new SessionRuntimeRoutingError('unknown-session', sessionId);
    const identity = binding.live ?? binding.persisted;
    if (!identity)
      throw new SessionRuntimeRoutingError('missing-identity', sessionId);
    for (const candidate of [binding.live, binding.persisted]) {
      if (candidate && candidate.sessionId !== sessionId) {
        throw new SessionRuntimeRoutingError(
          'identity-mismatch',
          sessionId,
          'sessionId',
        );
      }
    }
    if (binding.live && binding.persisted) {
      const field = sessionRuntimeIdentityMismatch(
        binding.live,
        binding.persisted,
      );
      if (field)
        throw new SessionRuntimeRoutingError(
          'identity-mismatch',
          sessionId,
          field,
        );
    }
    return identity.runtime === 'claude-sdk' ? this.legacy : this.native;
  }
}
