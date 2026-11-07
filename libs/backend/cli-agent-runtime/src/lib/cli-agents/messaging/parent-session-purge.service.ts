/**
 * Durable, three-phase purge of a deleted parent session's undelivered
 * messages (Component 10, user decision 4).
 *
 * This service only orchestrates. Every tombstone write goes through the P1-B
 * parent store (`markIntent` / `markMetadataDeleted` / `markPurged` /
 * `clearTombstone`), and lane envelopes are cancelled by the envelope store's
 * `purgeByParent`. From `beginDelete` until `markPurged` or `clearTombstone`
 * the parent is frozen: drainer, enqueues, lane sends and the scheduler all
 * check `isParentFrozen`.
 *
 * Crash recovery decides from durable metadata existence, never from the
 * tombstone alone: a session whose metadata still exists is never purged.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { ParentEnvelopeStoreService } from '../parent-delivery/parent-envelope-store.service';
import type { AgentMessageEnvelopeStore } from './envelope/agent-message-envelope.store';

export interface ParentSessionPurge {
  /** Durable `intent`; throws when it cannot be persisted, and the delete must be refused. */
  beginDelete(sessionId: string): Promise<void>;
  /** Durable `metadata-deleted`; logs and never throws. */
  markMetadataDeleted(sessionId: string): Promise<void>;
  /** Cancels undelivered lane and parent envelopes, then `purged`; logs and never throws. */
  completeDelete(sessionId: string): Promise<void>;
  /** Removes the tombstone after a failed metadata delete; logs and never throws. */
  abortDelete(sessionId: string): Promise<void>;
  /** Startup recovery; runs before the scheduler and the drainer deliver anything. */
  resumePendingPurges(): Promise<void>;
}

/**
 * Whether a parent session's durable metadata still exists. Throws when the
 * answer is unknown (store absent or unreadable), which keeps the parent
 * frozen instead of purging it.
 */
export interface ParentSessionExistence {
  exists(sessionId: string): Promise<boolean>;
}

export type PurgeParentStore = Pick<
  ParentEnvelopeStoreService,
  | 'markIntent'
  | 'markMetadataDeleted'
  | 'markPurged'
  | 'clearTombstone'
  | 'listPendingPurges'
  | 'isParentFrozen'
  | 'purgeUndeliveredForParent'
>;

export type PurgeEnvelopeStore = Pick<AgentMessageEnvelopeStore, 'purgeByParent'>;

/** Recovery retry period while a purge stays pending. */
export const PARENT_PURGE_RETRY_MS = 5 * 60 * 1000;

export class ParentSessionPurgeService implements ParentSessionPurge {
  /** Sessions whose `metadata-deleted` phase is known durable in this host run. */
  private readonly metadataDeleted = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private recovery?: Promise<void>;
  private disposed = false;

  constructor(
    private readonly parentStore: PurgeParentStore,
    private readonly envelopes: PurgeEnvelopeStore,
    private readonly existence: ParentSessionExistence,
    private readonly logger: Logger,
  ) {}

  async beginDelete(sessionId: string): Promise<void> {
    try {
      await this.parentStore.markIntent(sessionId);
    } catch (error: unknown) {
      this.logger.error('[ParentSessionPurge] Delete intent could not be persisted', this.asError(error));
      throw error;
    }
  }

  async markMetadataDeleted(sessionId: string): Promise<void> {
    await this.writeMetadataDeleted(sessionId);
  }

  async completeDelete(sessionId: string): Promise<void> {
    if (!(await this.purge(sessionId))) this.armRetry();
  }

  async abortDelete(sessionId: string): Promise<void> {
    if (!(await this.abort(sessionId))) this.armRetry();
  }

  resumePendingPurges(): Promise<void> {
    this.recovery ??= this.recover().finally(() => {
      this.recovery = undefined;
    });
    return this.recovery;
  }

  dispose(): void {
    this.disposed = true;
    this.clearRetry();
  }

  private async recover(): Promise<void> {
    for (const record of this.parentStore.listPendingPurges()) {
      if (this.disposed) return;
      const sessionId = record.sessionId;
      if (record.phase === 'metadata-deleted') {
        this.metadataDeleted.add(sessionId);
        await this.purge(sessionId);
        continue;
      }
      let exists: boolean;
      try {
        exists = await this.existence.exists(sessionId);
      } catch (error: unknown) {
        // Degradation: unknown existence keeps the parent frozen; the retry timer asks again.
        this.logger.error('[ParentSessionPurge] Session existence check failed; parent stays frozen',
          this.asError(error));
        continue;
      }
      if (exists) {
        // Crash before the metadata delete: nothing is purged and delivery resumes.
        await this.abort(sessionId);
        continue;
      }
      if (await this.writeMetadataDeleted(sessionId)) await this.purge(sessionId);
    }
    if (this.parentStore.listPendingPurges().length > 0) this.armRetry();
    else this.clearRetry();
  }

  /** Every step is idempotent, so a rerun after a partial failure is safe. */
  private async purge(sessionId: string): Promise<boolean> {
    if (!this.parentStore.isParentFrozen(sessionId)) {
      this.logger.error('[ParentSessionPurge] Purge refused without a delete intent', { sessionId });
      return true;
    }
    // The parent store purges only from the durable `metadata-deleted` phase.
    if (!this.metadataDeleted.has(sessionId) && !(await this.writeMetadataDeleted(sessionId)))
      return false;
    try {
      const lane = await this.envelopes.purgeByParent(sessionId);
      const parent = await this.parentStore.purgeUndeliveredForParent(sessionId);
      await this.parentStore.markPurged(sessionId);
      this.metadataDeleted.delete(sessionId);
      this.logger.info('[ParentSessionPurge] Parent session messages purged', {
        sessionId, laneEnvelopes: lane, parentEnvelopes: parent,
      });
      return true;
    } catch (error: unknown) {
      // Degradation: the tombstone stays pending, delivery stays frozen and recovery finishes it.
      this.logger.error('[ParentSessionPurge] Purge failed; parent stays frozen', this.asError(error));
      return false;
    }
  }

  private async writeMetadataDeleted(sessionId: string): Promise<boolean> {
    try {
      await this.parentStore.markMetadataDeleted(sessionId);
      this.metadataDeleted.add(sessionId);
      return true;
    } catch (error: unknown) {
      // Degradation: recovery re-derives the phase from metadata existence.
      this.logger.error('[ParentSessionPurge] metadata-deleted could not be persisted',
        this.asError(error));
      return false;
    }
  }

  private async abort(sessionId: string): Promise<boolean> {
    try {
      await this.parentStore.clearTombstone(sessionId);
      this.metadataDeleted.delete(sessionId);
      return true;
    } catch (error: unknown) {
      // Degradation: the parent stays frozen at `intent`; recovery aborts it after the existence check.
      this.logger.error('[ParentSessionPurge] Delete abort failed; parent stays frozen',
        this.asError(error));
      return false;
    }
  }

  private armRetry(): void {
    if (this.disposed || this.timer) return;
    const timer = setTimeout(() => {
      this.timer = undefined;
      void this.resumePendingPurges().catch((error: unknown) => {
        this.logger.error('[ParentSessionPurge] Purge retry failed', this.asError(error));
        this.armRetry();
      });
    }, PARENT_PURGE_RETRY_MS);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    this.timer = timer;
  }

  private clearRetry(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
