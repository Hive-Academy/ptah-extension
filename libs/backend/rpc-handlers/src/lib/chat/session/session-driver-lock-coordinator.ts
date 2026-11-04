import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { inject, injectable } from 'tsyringe';
import { RpcUserError, TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  PlatformType,
  type DriverHolder,
  type IPlatformInfo,
  type ISessionDriverLock,
} from '@ptah-extension/platform-core';

/**
 * One drive attempt (continue, resume activation, rewind). `record` is set once the
 * attempt returned while the tab's record had not bound: the attempt then waits for
 * that record, by token, to bind or be removed.
 */
type DriveAttempt = { tabId: string; record?: string };

type Ownership = {
  nonce: string;
  records: Set<string>;
  natives: Set<string>;
  attempts: Map<string, DriveAttempt>;
};

function owned(owner: Ownership | undefined): boolean {
  return Boolean(
    owner && (owner.records.size || owner.natives.size || owner.attempts.size),
  );
}

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

  constructor(
    @inject(PLATFORM_TOKENS.SESSION_DRIVER_LOCK)
    private readonly lock: ISessionDriverLock,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly lifecycle: SessionLifecycleManager,
    @inject(TOKENS.LOGGER) private readonly logger: Pick<Logger, 'error'>,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: Pick<IPlatformInfo, 'type'>,
  ) {
    lock.setLiveRecordCheck((sessionId) => owned(this.owners.get(sessionId)));
    // Operator release runs in the session's queue, so no owner can be admitted
    // between the liveness decision and the kernel release.
    lock.setReleaseGate((sessionId, release) =>
      this.serial(sessionId, async () => {
        const owner = this.owners.get(sessionId);
        if (owned(owner)) return 'in-use';
        if (owner) this.owners.delete(sessionId);
        return release();
      }),
    );
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
      kind: this.platformInfo.type === PlatformType.CLI ? 'cli' : 'desktop',
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
      attempts: new Map(),
    };
    this.owners.set(sessionId, ownership);
    return ownership;
  }

  private async releaseEmpty(
    sessionId: string,
    owner: Ownership,
  ): Promise<void> {
    if (owned(owner)) return;
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

  /** Starts a drive attempt and returns its token for `settleDrive` / `abandonDrive`. */
  async beginDrive(sessionId: string, tabId: string): Promise<string> {
    const attempt = `attempt:${randomUUID()}`;
    await this.serial(sessionId, async () => {
      const owner = await this.ensure(sessionId);
      owner.attempts.set(attempt, { tabId });
    });
    return attempt;
  }

  /** Ends a failed attempt: drops only its own ownership and frees an unowned lock. */
  async abandonDrive(sessionId: string, attempt?: string): Promise<void> {
    await this.serial(sessionId, async () => {
      const owner = this.owners.get(sessionId);
      if (!owner || !attempt || !owner.attempts.delete(attempt)) return;
      await this.releaseEmpty(sessionId, owner);
    });
  }

  /**
   * Ends an attempt that returned. A Claude record binds its session only on the SDK
   * `init` message, which can arrive after the RPC returns. While the tab's record has
   * not bound, or is about to bind this session, the attempt keeps the lock and waits
   * for that record: it ends when the record binds or is removed.
   */
  async settleDrive(sessionId: string, attempt?: string): Promise<void> {
    await this.serial(sessionId, async () => {
      const owner = this.owners.get(sessionId);
      const state = attempt ? owner?.attempts.get(attempt) : undefined;
      if (!owner || !attempt || !state) return;
      const record = this.lifecycle.find(state.tabId);
      if (
        record?.tabId === state.tabId &&
        !owner.records.has(record.token) &&
        (record.realSessionId ?? sessionId) === sessionId
      ) {
        state.record = record.token;
        return;
      }
      owner.attempts.delete(attempt);
      await this.releaseEmpty(sessionId, owner);
    });
  }

  async assertDriveHeld(sessionId: string, tabId?: string): Promise<void> {
    await this.serial(sessionId, async () => {
      const owner = this.owners.get(sessionId);
      const attemptHeld =
        tabId !== undefined &&
        Array.from(owner?.attempts.values() ?? []).some(
          (attempt) => attempt.tabId === tabId,
        );
      if (
        !owner ||
        (!owner.records.size && !owner.natives.size && !attemptHeld)
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
    if (admitted) await this.endWaitingAttempts(token);
    return admitted;
  }

  /** The record with this token bound or was removed: attempts waiting on it end. */
  private async endWaitingAttempts(token: string): Promise<void> {
    const waiting = (owner: Ownership): string[] =>
      Array.from(owner.attempts)
        .filter(([, attempt]) => attempt.record === token)
        .map(([key]) => key);
    for (const [sessionId, owner] of Array.from(this.owners)) {
      if (!waiting(owner).length) continue;
      await this.serial(sessionId, async () => {
        const current = this.owners.get(sessionId);
        if (!current) return;
        for (const key of waiting(current)) current.attempts.delete(key);
        await this.releaseEmpty(sessionId, current);
      });
    }
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
    await this.endWaitingAttempts(token);
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
