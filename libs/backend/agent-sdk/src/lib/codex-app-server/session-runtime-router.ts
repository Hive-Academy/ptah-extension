import {
  type AppliedSettings,
  type EffortLevel,
  type PermissionLevel,
  type SessionId,
  type SessionRuntimeControls,
} from '@ptah-extension/shared';

import {
  resolveSessionRuntimeIdentity,
  type SessionRuntimeIdentityLookup,
} from './session-runtime-identity';

/** Native controls own turn lifecycle and failed-interrupt gating. */
export interface NativeSessionControls extends SessionRuntimeControls {
  canSendFollowUp(sessionId: SessionId): boolean;
  releaseSession?(sessionId: SessionId): void;
}

export class SessionRuntimeRouter implements SessionRuntimeControls {
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
    return this.controls(sessionId).interrupt(sessionId);
  }

  canSendFollowUp(sessionId: SessionId): boolean {
    return this.controls(sessionId) === this.native
      ? this.native.canSendFollowUp(sessionId)
      : true;
  }

  /** The router retains no session state; release native lifecycle state if present. */
  releaseSession(sessionId: SessionId): void {
    if (this.controls(sessionId) === this.native)
      this.native.releaseSession?.(sessionId);
  }

  private controls(sessionId: SessionId): SessionRuntimeControls {
    return resolveSessionRuntimeIdentity(this.identities, sessionId)
      ?.runtime === 'codex-app-server'
      ? this.native
      : this.legacy;
  }
}
