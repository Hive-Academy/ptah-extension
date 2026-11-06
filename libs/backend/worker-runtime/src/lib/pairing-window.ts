import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  encodePairingCode,
  formatPairingCode,
  normalizePairingCode,
  PAIRING_TTL_DEFAULT_SEC,
  PAIRING_TTL_MIN_SEC,
  PAIRING_TTL_MAX_SEC,
  WORKER_ERROR_MESSAGES,
} from '@ptah-extension/worker-protocol';
import type {
  WorkerGrant,
  WorkerErrorCode,
} from '@ptah-extension/worker-protocol';
import type { WorkspaceRegistry } from './workspace-registry';

export interface PairingClock {
  now(): number;
  delay(ms: number): Promise<void>;
  setTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

const systemClock: PairingClock = {
  now: Date.now,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: clearTimeout,
};

export const PAIRING_REJECTION = {
  ok: false,
  error: {
    code: 'PAIRING_REJECTED' as WorkerErrorCode,
    message: WORKER_ERROR_MESSAGES.PAIRING_REJECTED,
  },
} as const;

interface WindowState {
  salt: Buffer;
  hash: Buffer;
  expiresAt: number;
  attemptsLeft: number;
  grant: WorkerGrant;
  timer: ReturnType<typeof setTimeout>;
}

export class PairingWindow {
  private current: WindowState | null = null;
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly machineId: string,
    private readonly clock: PairingClock = systemClock,
    private readonly log?: (record: {
      connectionId: string;
      windowOpen: boolean;
      attemptsLeft: number;
    }) => void,
  ) {}

  open(
    ttlSeconds = PAIRING_TTL_DEFAULT_SEC,
    subset?: readonly string[],
  ): { code: string; expiresAt: number; workspaces: string[] } {
    if (
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < PAIRING_TTL_MIN_SEC ||
      ttlSeconds > PAIRING_TTL_MAX_SEC
    )
      throw new RangeError('Pairing TTL must be 60–900 seconds');
    if (this.current) this.close();
    const available = this.registry
      .list()
      .map((workspace) => workspace.workspaceId);
    if (subset?.some((id) => !available.includes(id)))
      throw new RangeError('Unknown workspace in pairing grant');
    const workspaces = subset ? [...new Set(subset)] : available;
    const code = encodePairingCode(randomBytes(5));
    const salt = randomBytes(32);
    const expiresAt = this.clock.now() + ttlSeconds * 1000;
    const timer = this.clock.setTimer(() => this.close(), ttlSeconds * 1000);
    this.current = {
      salt,
      hash: digest(salt, code),
      expiresAt,
      attemptsLeft: 5,
      grant: { machineId: this.machineId, workspaceIds: workspaces },
      timer,
    };
    return {
      code: formatPairingCode(code),
      expiresAt,
      workspaces: [...workspaces],
    };
  }

  close(): void {
    if (this.current) this.clock.clearTimer(this.current.timer);
    this.current = null;
  }

  async exchange(
    code: string,
    connectionId: string,
  ): Promise<{ ok: true; grant: WorkerGrant } | typeof PAIRING_REJECTION> {
    const receivedAt = this.clock.now();
    const state = this.current;
    const normalized = normalizePairingCode(code);
    const salt = state?.salt ?? randomBytes(32);
    const expected = state?.hash ?? randomBytes(32);
    const matches = timingSafeEqual(expected, digest(salt, normalized ?? ''));
    const accepted = Boolean(
      state && normalized && matches && this.clock.now() < state.expiresAt,
    );
    if (accepted && state) {
      const grant = {
        ...state.grant,
        workspaceIds: [...state.grant.workspaceIds],
      };
      this.close();
      this.log?.({ connectionId, windowOpen: false, attemptsLeft: 0 });
      return { ok: true, grant };
    }
    if (state && this.current === state) {
      state.attemptsLeft -= 1;
      if (state.attemptsLeft <= 0 || this.clock.now() >= state.expiresAt)
        this.close();
    }
    this.log?.({
      connectionId,
      windowOpen: this.current !== null,
      attemptsLeft: this.current?.attemptsLeft ?? 0,
    });
    await this.clock.delay(Math.max(0, 250 - (this.clock.now() - receivedAt)));
    return PAIRING_REJECTION;
  }
}

function digest(salt: Buffer, code: string): Buffer {
  return createHash('sha256').update(salt).update(code).digest();
}
