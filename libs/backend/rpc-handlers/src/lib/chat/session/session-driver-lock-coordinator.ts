import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { inject, injectable } from 'tsyringe';
import { RpcUserError, TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type DriverHolder,
  type ISessionDriverLock,
} from '@ptah-extension/platform-core';

type Ownership = {
  nonce: string;
  records: Set<string>;
  natives: Set<string>;
  provisional?: string;
};

/** Serializes ownership changes for each kernel lock name. */
@injectable()
export class SessionDriverLockCoordinator {
  private readonly owners = new Map<string, Ownership>();
  private readonly heldByRecord = new Map<string, string>();
  private readonly pendingHandoff = new Set<string>();
  private readonly handoffs = new Map<string, Promise<void>>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, RpcUserError>();
  private readonly admissionFailures = new Map<string, RpcUserError>();
  private readonly activeAdmissions = new Set<string>();
  /** Tab ID to the session a finished attempt left provisional, waiting for its record to bind. */
  private readonly parked = new Map<string, string>();

  constructor(
    @inject(PLATFORM_TOKENS.SESSION_DRIVER_LOCK)
    private readonly lock: ISessionDriverLock,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly lifecycle: SessionLifecycleManager,
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'error'>,
  ) {
    lock.setLiveRecordCheck((sessionId) => {
      const owner = this.owners.get(sessionId);
      return Boolean(
        owner &&
        (owner.records.size || owner.natives.size || owner.provisional),
      );
    });
    lifecycle.onRecordRemoved((record) => {
      void this.removed(record.token, record.tabId).catch((error: unknown) => {
        this.logger.error(
          'Session driver lock record removal failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    });
    lifecycle.onRealSessionIdBound((record) => {
      if (record.realSessionId)
        void this.bound(record.token, record.tabId, record.realSessionId).catch(
          (error: unknown) => {
            this.logger.error(
              'Session driver lock binding failed',
              error instanceof Error ? error : new Error(String(error)),
            );
          },
        );
    });
    lifecycle.onRealSessionIdRebound((event) => {
      this.pendingHandoff.add(event.ownerToken);
      const handoff = this.rebound(
        event.ownerToken,
        event.tabId,
        event.newSessionId,
      );
      this.handoffs.set(event.ownerToken, handoff);
      void handoff.then(
        () => this.handoffs.delete(event.ownerToken),
        (error: unknown) => {
          this.handoffs.delete(event.ownerToken);
          this.logger.error(
            'Session driver lock handoff failed',
            error instanceof Error ? error : new Error(String(error)),
          );
        },
      );
    });
  }

  private serial<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve();
    // degradation-audit: reported — earlier queued action rejects to its caller; this chain must still advance.
    const result = previous.catch(() => undefined).then(action);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(sessionId, tail);
    void tail.then(() => {
      if (this.chains.get(sessionId) === tail) this.chains.delete(sessionId);
    });
    return result;
  }

  private owner(): DriverHolder {
    return {
      kind: 'desktop',
      hostname: hostname(),
      pid: process.pid,
      label: `Ptah (${hostname()}, PID ${process.pid})`,
      acquiredAt: new Date().toISOString(),
      responding: true,
    };
  }

  private refusal(
    result: { holder: DriverHolder } | { unavailable: string },
  ): RpcUserError {
    if ('holder' in result)
      return new RpcUserError(
        `Session is being driven by ${result.holder.label}. Stop it there and retry.`,
        'SESSION_DRIVEN_ELSEWHERE',
      );
    return new RpcUserError(
      `Session driver lock unavailable: ${result.unavailable}. Check Ptah worker locks and retry.`,
      'SESSION_DRIVER_LOCK_UNAVAILABLE',
    );
  }

  private async ensure(sessionId: string): Promise<Ownership> {
    const existing = this.owners.get(sessionId);
    if (existing) return existing;
    let result;
    try {
      result = await this.lock.acquire(sessionId, this.owner());
    } catch {
      throw this.refusal({ unavailable: 'lock service failed' });
    }
    if (!result.ok) throw this.refusal(result);
    const ownership: Ownership = {
      nonce: result.nonce,
      records: new Set(),
      natives: new Set(),
    };
    this.owners.set(sessionId, ownership);
    return ownership;
  }

  private async releaseEmpty(
    sessionId: string,
    owner: Ownership,
  ): Promise<void> {
    if (owner.provisional || owner.records.size || owner.natives.size) return;
    if (this.owners.get(sessionId) !== owner) return;
    this.owners.delete(sessionId);
    await this.lock.release(sessionId, owner.nonce);
  }

  beginRecordAdmission(tabId: string): void {
    this.admissionFailures.delete(tabId);
    this.activeAdmissions.add(tabId);
  }

  endRecordAdmission(tabId: string): void {
    this.activeAdmissions.delete(tabId);
    this.admissionFailures.delete(tabId);
  }

  async beginDrive(sessionId: string, tabId: string): Promise<void> {
    await this.serial(sessionId, async () => {
      const owner = await this.ensure(sessionId);
      if (!owner.records.size && !owner.natives.size) owner.provisional = tabId;
      if (this.parked.get(tabId) === sessionId) this.parked.delete(tabId);
    });
  }

  /** Ends a failed attempt: drops its provisional owner and frees an unowned lock. */
  async abandonDrive(sessionId: string, tabId: string): Promise<void> {
    await this.serial(sessionId, async () => {
      if (this.parked.get(tabId) === sessionId) this.parked.delete(tabId);
      const owner = this.owners.get(sessionId);
      if (owner?.provisional === tabId) {
        owner.provisional = undefined;
        await this.releaseEmpty(sessionId, owner);
      }
    });
  }

  /**
   * Ends an attempt that returned. A Claude record binds its session only on the SDK
   * `init` message, which can arrive after the RPC returns, so the provisional owner
   * stays while the tab's record has not bound or is bound to this session. It then
   * ends when that record binds, when the record is removed, or on `abandonDrive`.
   */
  async settleDrive(sessionId: string, tabId: string): Promise<void> {
    await this.serial(sessionId, async () => {
      const owner = this.owners.get(sessionId);
      if (owner?.provisional !== tabId) return;
      const record = this.lifecycle.find(tabId);
      if (
        record?.tabId === tabId &&
        (record.realSessionId ?? sessionId) === sessionId
      ) {
        this.parked.set(tabId, sessionId);
        return;
      }
      owner.provisional = undefined;
      await this.releaseEmpty(sessionId, owner);
    });
  }

  async assertDriveHeld(sessionId: string, tabId?: string): Promise<void> {
    await this.serial(sessionId, async () => {
      const owner = this.owners.get(sessionId);
      if (
        !owner ||
        (!owner.records.size &&
          !owner.natives.size &&
          owner.provisional !== tabId)
      ) {
        throw this.refusal({
          unavailable: 'this process does not hold the session lock',
        });
      }
      for (const token of owner.records) {
        if (this.pendingHandoff.has(token))
          throw this.refusal({ unavailable: 'session lock handoff pending' });
      }
    });
  }

  async admitNative(
    sessionId: string,
    context: {
      tabId?: string;
      consumer: 'chat' | 'gateway';
      kind: 'start' | 'resume';
    },
  ): Promise<{ release(): void }> {
    const key = `native:${randomUUID()}`;
    await this.serial(sessionId, async () => {
      const owner = await this.ensure(sessionId);
      owner.natives.add(key);
      if (context.tabId && owner.provisional === context.tabId)
        owner.provisional = undefined;
    });
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        void this.serial(sessionId, async () => {
          const owner = this.owners.get(sessionId);
          if (owner) {
            owner.natives.delete(key);
            await this.releaseEmpty(sessionId, owner);
          }
        });
      },
    };
  }

  private async bound(
    token: string,
    tabId: string,
    sessionId: string,
  ): Promise<boolean> {
    let admitted: boolean;
    try {
      admitted = await this.serial(sessionId, async () => {
        const owner = await this.ensure(sessionId);
        if (this.lifecycle.find(tabId)?.token !== token) {
          await this.releaseEmpty(sessionId, owner);
          return false;
        }
        owner.records.add(token);
        if (owner.provisional === tabId) owner.provisional = undefined;
        this.heldByRecord.set(token, sessionId);
        return true;
      });
    } catch (error) {
      this.logger.error(
        'Session driver lock admission failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      await this.failRecord(token, tabId, error);
      return false;
    }
    if (admitted) await this.unpark(tabId, sessionId);
    return admitted;
  }

  /** The tab's record bound: a parked provisional owner on another session ends. */
  private async unpark(tabId: string, sessionId: string): Promise<void> {
    const parked = this.parked.get(tabId);
    if (parked === undefined) return;
    this.parked.delete(tabId);
    if (parked !== sessionId) await this.abandonDrive(parked, tabId);
  }

  private async rebound(
    token: string,
    tabId: string,
    sessionId: string,
  ): Promise<void> {
    const old = this.heldByRecord.get(token);
    try {
      await this.bound(token, tabId, sessionId);
    } finally {
      try {
        if (old && old !== sessionId) await this.dropRecord(token, old);
      } finally {
        this.pendingHandoff.delete(token);
      }
    }
  }

  private async dropRecord(token: string, sessionId: string): Promise<void> {
    await this.serial(sessionId, async () => {
      const owner = this.owners.get(sessionId);
      if (owner) {
        owner.records.delete(token);
        await this.releaseEmpty(sessionId, owner);
      }
      if (this.heldByRecord.get(token) === sessionId)
        this.heldByRecord.delete(token);
    });
  }

  private async removed(token: string, tabId: string): Promise<void> {
    const sessionId = this.heldByRecord.get(token);
    if (sessionId) await this.dropRecord(token, sessionId);
    for (const [id, owner] of this.owners) {
      if (owner.provisional === tabId) await this.abandonDrive(id, tabId);
    }
    this.parked.delete(tabId);
    this.failures.delete(token);
    if (!this.activeAdmissions.has(tabId)) this.admissionFailures.delete(tabId);
  }

  private async failRecord(
    token: string,
    tabId: string,
    error: unknown,
  ): Promise<void> {
    const refusal =
      error instanceof RpcUserError
        ? error
        : this.refusal({ unavailable: 'lock service failed' });
    this.failures.set(token, refusal);
    if (this.activeAdmissions.has(tabId))
      this.admissionFailures.set(tabId, refusal);
    const record = this.lifecycle.find(tabId);
    if (record?.token !== token) return;
    record.abortController.abort(refusal);
    await this.lifecycle.endSessionIfTokenMatches(tabId as never, token);
  }

  /** Called after a bound notification when the start path must await admission. */
  async assertRecordAdmission(tabId: string): Promise<void> {
    const pendingFailure = this.admissionFailures.get(tabId);
    if (pendingFailure) {
      this.admissionFailures.delete(tabId);
      throw pendingFailure;
    }
    const record = this.lifecycle.find(tabId);
    if (!record?.realSessionId) return;
    const sessionId = record.realSessionId;
    await (this.chains.get(sessionId) ?? Promise.resolve());
    await this.handoffs.get(record.token);
    const settledFailure = this.admissionFailures.get(tabId);
    if (settledFailure) {
      this.admissionFailures.delete(tabId);
      throw settledFailure;
    }
    const failure = this.failures.get(record.token);
    if (failure) throw failure;
    await this.assertDriveHeld(sessionId, tabId);
  }
}
