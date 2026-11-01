import {
  type AppliedSettings,
  type EffortLevel,
  type PermissionLevel,
  type SessionId,
  type SessionRuntimeControls,
  type SessionRuntimeControlOptions,
} from '@ptah-extension/shared';

import {
  resolveSessionRuntimeIdentity,
  type SessionRuntimeIdentityLookup,
} from './session-runtime-identity';

/** Native controls own persistence/rollback as well as turn lifecycle and failed-interrupt gating.
 * Composition must bind a persistent control adapter, not raw runtime setters. */
export interface NativeSessionControls extends SessionRuntimeControls {
  canSendFollowUp(sessionId: SessionId): boolean;
  releaseSession?(sessionId: SessionId): void;
}

/** Admission check for a native thread whose previous turn stream has ended. */
export interface StreamlessFollowUpAdmission {
  acceptsFollowUpWithoutStream(sessionId: SessionId): boolean;
}

export class SessionRuntimeRouter
  implements SessionRuntimeControls, StreamlessFollowUpAdmission
{
  constructor(
    private readonly identities: SessionRuntimeIdentityLookup,
    private readonly legacy: SessionRuntimeControls,
    private readonly native: NativeSessionControls,
  ) {}

  async setPermission(
    sessionId: SessionId,
    level: PermissionLevel,
    options?: SessionRuntimeControlOptions,
  ): Promise<AppliedSettings> {
    const controls = this.controls(sessionId);
    return options
      ? controls.setPermission(sessionId, level, options)
      : controls.setPermission(sessionId, level);
  }

  async setModel(
    sessionId: SessionId,
    model: string,
    options?: SessionRuntimeControlOptions,
  ): Promise<AppliedSettings> {
    const controls = this.controls(sessionId);
    return options
      ? controls.setModel(sessionId, model, options)
      : controls.setModel(sessionId, model);
  }

  async setEffort(
    sessionId: SessionId,
    effort: EffortLevel | undefined,
    options?: SessionRuntimeControlOptions,
  ): Promise<AppliedSettings> {
    const controls = this.controls(sessionId);
    return options
      ? controls.setEffort(sessionId, effort, options)
      : controls.setEffort(sessionId, effort);
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

  /**
   * Whether a registered session can take a follow-up with no turn stream
   * attached. A native Codex thread outlives each turn stream, and
   * `sendMessageToSession` publishes that turn's own stream, so an idle,
   * unblocked native thread is live. A legacy (Claude) session keeps one
   * long-lived stream; without it the record is dead, so legacy answers false.
   */
  acceptsFollowUpWithoutStream(sessionId: SessionId): boolean {
    return (
      this.controls(sessionId) === this.native &&
      this.native.canSendFollowUp(sessionId)
    );
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
