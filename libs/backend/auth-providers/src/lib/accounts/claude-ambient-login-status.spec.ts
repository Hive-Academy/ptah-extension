import 'reflect-metadata';
import type { ClaudeCertifiedExecutable } from '@ptah-extension/auth-providers-tokens';
import type { ProviderAmbientClaudeStatus } from '@ptah-extension/shared';
import type {
  ClaudeAmbientStatusProbeOutcome, ClaudeAmbientStatusProbeRequest, ClaudeChildCloseReceipt,
} from './claude-account-command';
import type { ClaudeExecutableProbeResult } from './claude-route-certifier';
import {
  AMBIENT_READ_DEADLINE_MS, AMBIENT_STATUS_BUDGET_MS, AMBIENT_STATUS_FRESH_MS, ambientProbeEnv,
  ClaudeAmbientLoginStatusReader, type ClaudeAmbientStatusCommands, type ClaudeAmbientStatusHost,
} from './claude-ambient-login-status';

const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

const EXECUTABLE: ClaudeCertifiedExecutable = Object.freeze({
  command: '/usr/bin/claude', prefixArgs: Object.freeze([]), sdkExecutablePath: '/usr/bin/claude',
  version: '2.1.310', fingerprint: Object.freeze({ size: 1, mtimeMs: 1 }),
});
const SIGNED_IN: ClaudeAmbientStatusProbeOutcome = {
  status: { loggedIn: true, accountClass: 'P', identityReference: 'ref', configDirectoryMatches: true },
  terminated: true, timedOut: false,
};
const SIGNED_OUT: ClaudeAmbientStatusProbeOutcome = { status: { loggedIn: false }, terminated: true, timedOut: false };
const UNREADABLE: ClaudeAmbientStatusProbeOutcome = { status: null, terminated: true, timedOut: false };

class FakeReceipt implements ClaudeChildCloseReceipt {
  closed = false;
  disposed = false;
  private readonly listeners = new Set<() => void>();
  onClosed(listener: () => void): () => void {
    if (this.closed) { listener(); return () => undefined; }
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  dispose(): void { this.disposed = true; this.listeners.clear(); }
  close(): void {
    this.closed = true;
    const listeners = [...this.listeners];
    this.listeners.clear();
    listeners.forEach(listener => listener());
  }
}

interface PendingProbe {
  readonly request: ClaudeAmbientStatusProbeRequest;
  resolve(outcome: ClaudeAmbientStatusProbeOutcome): void;
  reject(error: Error): void;
}

/** Deferred command: every `ambientStatus` child stays live until the test resolves it (and its receipt closes). */
class FakeCommands implements ClaudeAmbientStatusCommands {
  certifyResult: ClaudeExecutableProbeResult = { ok: true, executable: EXECUTABLE, terminated: true };
  certifyCalls = 0;
  readonly probes: PendingProbe[] = [];
  live = 0;
  maxLive = 0;

  async certifyExecutable(): Promise<ClaudeExecutableProbeResult> {
    this.certifyCalls++;
    return this.certifyResult;
  }

  ambientStatus(request: ClaudeAmbientStatusProbeRequest): Promise<ClaudeAmbientStatusProbeOutcome> {
    this.live++;
    this.maxLive = Math.max(this.maxLive, this.live);
    return new Promise((resolve, reject) => {
      this.probes.push({
        request,
        resolve: outcome => {
          if (outcome.closeReceipt && !outcome.closeReceipt.closed) outcome.closeReceipt.onClosed(() => { this.live--; });
          else this.live--;
          resolve(outcome);
        },
        reject: error => { this.live--; reject(error); },
      });
    });
  }

  last(): PendingProbe { return this.probes[this.probes.length - 1]; }
}

describe('ClaudeAmbientLoginStatusReader', () => {
  let env: Record<string, string | undefined>;
  let commands: FakeCommands;
  let warn: jest.Mock;
  let reader: ClaudeAmbientLoginStatusReader;
  const iso = (): string => new Date(Date.now()).toISOString();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-26T10:00:00.000Z'));
    env = { PATH: '/usr/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-secret', CLAUDE_CONFIG_DIR: '/home/u/.claude' };
    commands = new FakeCommands();
    warn = jest.fn();
    const host: ClaudeAmbientStatusHost = { env: () => env, now: () => Date.now() };
    reader = new ClaudeAmbientLoginStatusReader(commands, host, { warn });
  });
  afterEach(() => {
    reader.dispose();
    jest.useRealTimers();
  });

  /** Starts a read and resolves its single probe with `outcome`. */
  const readWith = async (outcome: ClaudeAmbientStatusProbeOutcome, refresh = false): Promise<ProviderAmbientClaudeStatus> => {
    const pending = reader.read({ refresh });
    await flush();
    commands.last().resolve(outcome);
    await flush();
    return pending;
  };

  describe('mapping', () => {
    it.each([
      ['signed in', SIGNED_IN, { state: 'connected' }],
      ['signed out', SIGNED_OUT, { state: 'signed-out' }],
      ['unreadable output', UNREADABLE, { state: 'unknown', reason: 'unreadable' }],
      ['status limit', { status: null, terminated: true, timedOut: true }, { state: 'unknown', reason: 'timeout' }],
    ])('%s', async (_label, outcome, expected) => {
      jest.advanceTimersByTime(1_234);
      const at = iso();
      const result = await readWith(outcome);
      expect(result).toEqual({ ...expected, checkedAt: at });
      expect(Object.keys(result).sort()).toEqual(Object.keys({ ...expected, checkedAt: at }).sort());
      expect(JSON.stringify(result)).not.toMatch(/ref|claude|home/);
      expect(jest.getTimerCount()).toBe(0);
    });

    it.each([
      ['unsupported-store', { state: 'unknown', reason: 'cli-missing' }],
      ['timeout', { state: 'unknown', reason: 'timeout' }],
      ['cancelled', { state: 'unknown', reason: 'timeout' }],
      ['identity-unproved', { state: 'unknown', reason: 'unreadable' }],
      ['unsupported-source', { state: 'unknown', reason: 'unreadable' }],
    ] as const)('certification %s', async (code, expected) => {
      commands.certifyResult = { ok: false, code, terminated: true };
      const result = await reader.read();
      expect(result).toEqual({ ...expected, checkedAt: iso() });
      expect(commands.probes).toHaveLength(0);
    });

    it('answers an unexpected failure as unreadable with a fixed-text warning', async () => {
      const pending = reader.read();
      await flush();
      commands.last().reject(new Error('child said /home/u/.claude person@example.com'));
      await flush();
      expect(await pending).toEqual({ state: 'unknown', reason: 'unreadable', checkedAt: iso() });
      expect(warn).toHaveBeenCalledWith('[auth-providers] Ambient Claude status attempt failed unexpectedly.');
    });

    it('aborts the attempt at the 20 s budget and answers timeout', async () => {
      const pending = reader.read();
      await flush();
      const { signal } = commands.last().request;
      jest.advanceTimersByTime(AMBIENT_STATUS_BUDGET_MS - 1);
      expect(signal.aborted).toBe(false);
      jest.advanceTimersByTime(1);
      expect(signal.aborted).toBe(true);
      commands.last().resolve(UNREADABLE);
      await flush();
      expect(await pending).toEqual({ state: 'unknown', reason: 'timeout', checkedAt: iso() });
    });
  });

  describe('probe env', () => {
    it('passes the allowlist plus CLAUDE_CONFIG_DIR and never an API key', async () => {
      env['CLAUDE_SECURESTORAGE_CONFIG_DIR'] = '/secure';
      env['TERM'] = 'bad\nvalue';
      await readWith(SIGNED_IN);
      expect(commands.probes[0].request.env).toEqual({
        PATH: '/usr/bin', HOME: '/home/u', CLAUDE_CONFIG_DIR: '/home/u/.claude', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/secure',
      });
      expect(commands.probes[0].request.executable).toBe(EXECUTABLE);
    });

    it('ambientProbeEnv drops ANTHROPIC_* and empty directory keys', () => {
      expect(ambientProbeEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', CLAUDE_CONFIG_DIR: ' ', Path: 'p' }))
        .toEqual({ Path: 'p' });
    });
  });

  describe('cache', () => {
    it('serves a completed attempt for 60 s without a child, then probes again', async () => {
      const first = await readWith(SIGNED_IN);
      jest.advanceTimersByTime(AMBIENT_STATUS_FRESH_MS - 1);
      expect(await reader.read()).toBe(first);
      expect(commands.probes).toHaveLength(1);
      jest.advanceTimersByTime(1);
      const second = await readWith(SIGNED_OUT);
      expect(commands.probes).toHaveLength(2);
      expect(second).toEqual({ state: 'signed-out', checkedAt: iso() });
    });

    it('bypasses the cache on refresh', async () => {
      await readWith(SIGNED_IN);
      jest.advanceTimersByTime(5_000);
      expect(await readWith(SIGNED_OUT, true)).toEqual({ state: 'signed-out', checkedAt: iso() });
      expect(commands.probes).toHaveLength(2);
    });

    it('never returns a stored connected for a different environment', async () => {
      await readWith(SIGNED_IN);
      env['CLAUDE_CONFIG_DIR'] = '/other';
      const result = await readWith(SIGNED_OUT);
      expect(result.state).toBe('signed-out');
      expect(commands.probes).toHaveLength(2);
      env['CLAUDE_CONFIG_DIR'] = '/home/u/.claude';
      const back = reader.read();
      await flush();
      expect(commands.probes).toHaveLength(3);
      commands.last().resolve(SIGNED_OUT); await flush();
      expect((await back).state).toBe('signed-out');
    });
  });

  describe('serial slot', () => {
    it('joins a non-refresh read to the active probe', async () => {
      const a = reader.read();
      await flush();
      const b = reader.read();
      await flush();
      expect(commands.probes).toHaveLength(1);
      commands.last().resolve(SIGNED_IN); await flush();
      expect(await b).toBe(await a);
      expect(commands.maxLive).toBe(1);
    });

    it('queues one follow-up for refreshes during an active probe and starts it after the first resolves', async () => {
      const first = reader.read();
      await flush();
      const r1 = reader.read({ refresh: true });
      const r2 = reader.read({ refresh: true });
      await flush();
      expect(commands.probes).toHaveLength(1);
      commands.probes[0].resolve(SIGNED_OUT); await flush();
      expect((await first).state).toBe('signed-out');
      expect(commands.probes).toHaveLength(2);
      commands.probes[1].resolve(SIGNED_IN); await flush();
      expect((await r1).state).toBe('connected');
      expect(await r2).toBe(await r1);
      expect(commands.probes).toHaveLength(2);
      expect(commands.maxLive).toBe(1);
    });

    it('aborts and awaits the active probe when the environment changes', async () => {
      const old = reader.read();
      await flush();
      const oldSignal = commands.probes[0].request.signal;
      env['CLAUDE_CONFIG_DIR'] = '/other';
      const fresh = reader.read();
      await flush();
      expect(oldSignal.aborted).toBe(true);
      expect(commands.probes).toHaveLength(1);
      commands.probes[0].resolve(SIGNED_IN); await flush();
      expect(commands.probes).toHaveLength(2);
      expect(commands.probes[1].request.env['CLAUDE_CONFIG_DIR']).toBe('/other');
      commands.probes[1].resolve(SIGNED_OUT); await flush();
      expect((await fresh).state).toBe('signed-out');
      // The obsolete caller gets the current key's result, never the obsolete one.
      expect((await old).state).toBe('signed-out');
      expect(commands.maxLive).toBe(1);
      expect(await reader.read()).toBe(await fresh);
      expect(commands.probes).toHaveLength(2);
    });

    it('blocks spawning on an unclosed receipt and answers without a timestamp when no attempt completed', async () => {
      const old = reader.read();
      await flush();
      env['CLAUDE_CONFIG_DIR'] = '/other';
      const fresh = reader.read();
      await flush();
      const receipt = new FakeReceipt();
      commands.probes[0].resolve({ status: null, terminated: false, timedOut: false, closeReceipt: receipt });
      await flush();
      expect(commands.probes).toHaveLength(1);
      expect(await fresh).toEqual({ state: 'unknown', reason: 'timeout', checkedAt: null });
      expect(await old).toEqual({ state: 'unknown', reason: 'timeout', checkedAt: null });
      expect(commands.live).toBe(1);
      receipt.close();
      expect(commands.live).toBe(0);
      const released = reader.read();
      await flush();
      expect(commands.probes).toHaveLength(2);
      commands.last().resolve(SIGNED_IN); await flush();
      expect((await released).state).toBe('connected');
    });

    it('repeated blocked reads return the earlier attempt unchanged', async () => {
      await readWith(SIGNED_IN);
      jest.advanceTimersByTime(1_000);
      const receipt = new FakeReceipt();
      const timedOut = await readWith({ status: null, terminated: false, timedOut: true, closeReceipt: receipt }, true);
      expect(timedOut).toEqual({ state: 'unknown', reason: 'timeout', checkedAt: iso() });
      jest.advanceTimersByTime(7_000);
      const blocked1 = await reader.read({ refresh: true });
      jest.advanceTimersByTime(7_000);
      const blocked2 = await reader.read({ refresh: true });
      expect(blocked1).toBe(timedOut);
      expect(blocked2).toBe(timedOut);
      expect(commands.probes).toHaveLength(2);
      expect(commands.maxLive).toBe(1);
      receipt.close();
      expect((await readWith(SIGNED_IN, true)).state).toBe('connected');
      expect(commands.probes).toHaveLength(3);
    });

    it('answers a queued caller at the 25 s deadline without touching the slow attempt (P5-D16)', async () => {
      const slow = reader.read();
      await flush();
      jest.advanceTimersByTime(1_000);
      let settled = 0;
      const queued = reader.read({ refresh: true });
      void queued.then(() => { settled++; });
      await flush();
      jest.advanceTimersByTime(AMBIENT_READ_DEADLINE_MS - 1);
      await flush();
      expect(settled).toBe(0);
      jest.advanceTimersByTime(1);
      await flush();
      expect(settled).toBe(1);
      expect(await queued).toEqual({ state: 'unknown', reason: 'timeout', checkedAt: null });
      expect(await slow).toEqual({ state: 'unknown', reason: 'timeout', checkedAt: null });
      expect(commands.probes).toHaveLength(1);
      expect(commands.live).toBe(1);
      // The slow attempt resolves later: the follow-up starts, its result is cached and served.
      commands.probes[0].resolve(SIGNED_OUT); await flush();
      expect(commands.probes).toHaveLength(2);
      expect(commands.maxLive).toBe(1);
      commands.probes[1].resolve(SIGNED_IN); await flush();
      const at = iso();
      expect(await reader.read()).toEqual({ state: 'connected', checkedAt: at });
      expect(commands.probes).toHaveLength(2);
      expect(settled).toBe(1);
      expect(await queued).toEqual({ state: 'unknown', reason: 'timeout', checkedAt: null });
    });
  });

  it('dispose aborts the active probe and disposes retained receipts', async () => {
    const receipt = new FakeReceipt();
    await readWith({ status: null, terminated: false, timedOut: true, closeReceipt: receipt });
    reader.dispose();
    expect(receipt.disposed).toBe(true);
    expect(await reader.read({ refresh: true })).toEqual({ state: 'unknown', reason: 'timeout', checkedAt: expect.any(String) });
    expect(commands.probes).toHaveLength(1);
  });
});
