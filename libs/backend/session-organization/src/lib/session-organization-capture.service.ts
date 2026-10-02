/**
 * Session organization capture service — host-wide lifecycle subscriptions.
 *
 * Three subscriptions, all host-wide (no per-session listener, no timer):
 *  - delete cascade (D7, AC6): `SessionMetadataStore.onMetadataChanged` with
 *    `kind: 'deleted'` removes the session's organization rows in the
 *    workspace the metadata named;
 *  - rekey (G1): `SessionIdResolvedCallbackRegistry` with a
 *    `previousSessionId` that differs from `realSessionId` moves the rows from
 *    the old id to the new one;
 *  - PR capture (AC3, lane L7): `PostToolUseCallbackRegistry` with a successful
 *    `gh pr create` Bash call links the PR it created, `source: 'agent'`.
 *
 * The PR capture passes the hook's session id through unchanged. When the hook
 * input lacked `session_id` that id is the tab id; the service finds no
 * metadata under it and drops the write with one log line, so the outcome is a
 * missed PR link, never a row keyed by a tab id (plan R5b).
 *
 * All handlers are synchronous (better-sqlite3 is synchronous), which honours
 * the registries' "treat the handler as synchronous" contract. The service
 * methods they call never throw; while the store is unavailable a rekey or PR
 * capture is dropped and logged there (lane L8), and a delete is deferred
 * until the store opens.
 *
 * `start()` and `dispose()` are synchronous and idempotent (CONVENTIONS.md §9).
 * A `start()` that fails part-way releases what it subscribed and stays
 * un-started, so a later `start()` can try again.
 */
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IDisposable,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type PostToolUseCallbackRegistry,
  type PostToolUsePayload,
  type SessionIdResolvedCallbackRegistry,
  type SessionIdResolvedPayload,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import type { SessionMetadataChangedNotification } from '@ptah-extension/shared';
import { SESSION_ORGANIZATION_TOKENS } from './di/tokens';
import type { SessionOrganizationService } from './session-organization.service';
import { extractGhPrCreateUrl } from './utils/pr-url';

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

/** The part of the PostToolUse registry the capture service uses. */
export type SessionOrganizationPostToolUseSource = Pick<
  PostToolUseCallbackRegistry,
  'register'
>;

/** The service methods the capture service drives. */
export type SessionOrganizationLifecycleSink = Pick<
  SessionOrganizationService,
  'removeSession' | 'rekeySession' | 'addPrLink'
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
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY)
    private readonly postToolUse: SessionOrganizationPostToolUseSource,
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
  ) {}

  /**
   * Subscribe host-wide. Idempotent. Each disposer is kept as soon as it is
   * obtained; if a later subscription throws, the earlier ones are released,
   * the service stays un-started and the error propagates to the caller
   * (`startSessionOrganization` reports it).
   */
  start(): void {
    if (this.started) return;
    const subscriptions: Array<() => () => void> = [
      () =>
        this.metadata.onMetadataChanged((payload) =>
          this.onMetadataChanged(payload),
        ),
      () =>
        this.sessionIdResolved.register((payload) =>
          this.onSessionIdResolved(payload),
        ),
      () => this.postToolUse.register((payload) => this.onPostToolUse(payload)),
    ];
    try {
      for (const subscribe of subscriptions) {
        this.disposers.push(subscribe());
      }
    } catch (error: unknown) {
      this.releaseAll();
      throw error;
    }
    this.started = true;
  }

  /** Release every subscription. Idempotent. */
  dispose(): void {
    if (!this.started) return;
    this.started = false;
    this.releaseAll();
  }

  /** Release every disposer; one that throws is logged and the rest still run. */
  private releaseAll(): void {
    const disposers = this.disposers;
    this.disposers = [];
    for (const release of disposers) {
      try {
        release();
      } catch (error: unknown) {
        this.output.appendLine(
          `${LOG_PREFIX} releasing a subscription failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private onMetadataChanged(payload: SessionMetadataChangedNotification): void {
    if (payload.kind !== 'deleted') return;
    if (!isNonBlank(payload.workspaceId)) {
      this.output.appendLine(
        `${LOG_PREFIX} delete cascade dropped for ${payload.sessionId}: metadata named no workspace`,
      );
      return;
    }
    this.service.removeSession(payload.workspaceId, payload.sessionId);
  }

  private onSessionIdResolved(payload: SessionIdResolvedPayload): void {
    const previous = payload.previousSessionId;
    if (!isNonBlank(previous) || previous === payload.realSessionId) return;
    this.service.rekeySession(previous, payload.realSessionId);
  }

  private onPostToolUse(payload: PostToolUsePayload): void {
    try {
      const pr = extractGhPrCreateUrl(payload);
      if (pr === null) return;
      this.service.addPrLink({
        sessionId: payload.sessionId,
        workspaceRootHint: payload.workspaceRoot,
        url: pr.url,
        state: pr.state,
        source: 'agent',
      });
    } catch (error: unknown) {
      this.output.appendLine(
        `${LOG_PREFIX} PR capture failed for ${payload.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function isNonBlank(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
