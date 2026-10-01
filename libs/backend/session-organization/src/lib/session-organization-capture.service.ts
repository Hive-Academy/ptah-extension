/**
 * Session organization capture service — host-wide lifecycle subscriptions.
 *
 * Two subscriptions, both host-wide (no per-session listener, no timer):
 *  - delete cascade (D7, AC6): `SessionMetadataStore.onMetadataChanged` with
 *    `kind: 'deleted'` removes the session's organization rows in the
 *    workspace the metadata named;
 *  - rekey (G1): `SessionIdResolvedCallbackRegistry` with a
 *    `previousSessionId` that differs from `realSessionId` moves the rows from
 *    the old id to the new one.
 *
 * Both handlers are synchronous (better-sqlite3 is synchronous), which honours
 * the registry's "treat the handler as synchronous" contract. The service
 * methods they call never throw; an unavailable store is dropped and logged
 * there (lane L8). The PR capture subscription is added by B2.
 *
 * `start()` and `dispose()` are synchronous and idempotent (CONVENTIONS.md §9).
 */
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IDisposable,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type SessionIdResolvedCallbackRegistry,
  type SessionIdResolvedPayload,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import type { SessionMetadataChangedNotification } from '@ptah-extension/shared';
import { SESSION_ORGANIZATION_TOKENS } from './di/tokens';
import type { SessionOrganizationService } from './session-organization.service';

const LOG_PREFIX = '[SessionOrganization]';

/** The part of the metadata store the capture service subscribes to. */
export type SessionOrganizationMetadataEvents = Pick<
  SessionMetadataStore,
  'onMetadataChanged'
>;

/** The part of the session-id-resolved registry the capture service uses. */
export type SessionOrganizationSessionIdResolvedSource = Pick<
  SessionIdResolvedCallbackRegistry,
  'register'
>;

/** The service methods the capture service drives. */
export type SessionOrganizationLifecycleSink = Pick<
  SessionOrganizationService,
  'removeSession' | 'rekeySession'
>;

@injectable()
export class SessionOrganizationCaptureService implements IDisposable {
  private disposers: Array<() => void> = [];
  private started = false;

  constructor(
    @inject(SESSION_ORGANIZATION_TOKENS.SERVICE)
    private readonly service: SessionOrganizationLifecycleSink,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadata: SessionOrganizationMetadataEvents,
    @inject(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY)
    private readonly sessionIdResolved: SessionOrganizationSessionIdResolvedSource,
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
  ) {}

  /** Subscribe host-wide. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.disposers = [
      this.metadata.onMetadataChanged((payload) =>
        this.onMetadataChanged(payload),
      ),
      this.sessionIdResolved.register((payload) =>
        this.onSessionIdResolved(payload),
      ),
    ];
  }

  /** Release every subscription. Idempotent. */
  dispose(): void {
    if (!this.started) return;
    this.started = false;
    const disposers = this.disposers;
    this.disposers = [];
    for (const release of disposers) release();
  }

  private onMetadataChanged(payload: SessionMetadataChangedNotification): void {
    if (payload.kind !== 'deleted') return;
    if (!payload.workspaceId) {
      this.output.appendLine(
        `${LOG_PREFIX} delete cascade dropped for ${payload.sessionId}: metadata named no workspace`,
      );
      return;
    }
    this.service.removeSession(payload.workspaceId, payload.sessionId);
  }

  private onSessionIdResolved(payload: SessionIdResolvedPayload): void {
    const previous = payload.previousSessionId;
    if (!previous || previous === payload.realSessionId) return;
    this.service.rekeySession(previous, payload.realSessionId);
  }
}
