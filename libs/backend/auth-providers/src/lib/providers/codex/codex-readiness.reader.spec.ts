import 'reflect-metadata';
import { CodexExecutableUnavailableError, type CodexSelection } from '@ptah-extension/codex-runtime';
import type { CodexSignInOutcome } from '@ptah-extension/shared';
import { CODEX_READINESS_DEADLINE_MS, CodexReadinessReader } from './codex-readiness.reader';

const selected = (source: 'installed' | 'bundled' = 'installed'): CodexSelection => ({
  selected: { path: '/private/codex', version: '0.165.0', source, reason: 'test' },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('CodexReadinessReader', () => {
  afterEach(() => jest.useRealTimers());

  function setup(options: {
    selection?: () => Promise<CodexSelection>;
    signIn?: () => Promise<Exclude<CodexSignInOutcome, 'timeout'>>;
    env?: Record<string, string | undefined>;
  } = {}) {
    const selection = jest.fn(options.selection ?? (async () => selected()));
    const signIn = jest.fn(options.signIn ?? (async () => 'signed-out' as const));
    const logger = { info: jest.fn() };
    const host = { env: () => options.env ?? {}, now: () => Date.now() };
    const reader = new CodexReadinessReader(selection, { getSignInOutcome: signIn }, logger, host);
    return { reader, selection, signIn, logger };
  }

  it('selects lazily and reports a bundled binary independently from signed-out auth', async () => {
    const { reader, selection } = setup({ selection: async () => selected('bundled') });
    expect(selection).not.toHaveBeenCalled();
    const result = await reader.read({ trigger: 'mount' });
    expect(result.binary).toEqual({ state: 'found', path: '/private/codex', version: '0.165.0', source: 'bundled' });
    expect(result.signIn).toEqual({ outcome: 'signed-out' });
  });

  it('keeps a found binary when auth is stale or the home is explicitly empty', async () => {
    const stale = setup({ signIn: async () => 'stale' });
    expect((await stale.reader.read()).signIn).toEqual({ outcome: 'stale' });
    const empty = setup({ env: { CODEX_HOME: '' } });
    const result = await empty.reader.read();
    expect(result.binary.state).toBe('found');
    expect(result.signIn).toEqual({ outcome: 'unreadable', unreadable: 'home' });
    expect(empty.signIn).not.toHaveBeenCalled();
    const emptyHome = setup({ env: { HOME: '', USERPROFILE: undefined } });
    expect((await emptyHome.reader.read()).signIn).toEqual({ outcome: 'unreadable', unreadable: 'home' });
    const unreadableFile = setup({ signIn: async () => 'unreadable' });
    expect((await unreadableFile.reader.read()).signIn).toEqual({ outcome: 'unreadable', unreadable: 'auth-file' });
  });

  it('reports unavailable binaries as missing and other local failures as unknown', async () => {
    const missing = setup({ selection: async () => { throw new CodexExecutableUnavailableError('0.165.0'); } });
    expect((await missing.reader.read()).binary).toEqual({ state: 'missing' });
    const local = setup({ selection: async () => { throw new Error('/private/codex'); } });
    expect((await local.reader.read()).binary).toEqual({ state: 'unknown', reason: 'local' });
  });

  it('bounds a stalled sign-in, preserves the binary, and does not cache a timeout', async () => {
    jest.useFakeTimers();
    const stalled = deferred<Exclude<CodexSignInOutcome, 'timeout'>>();
    const { reader, selection, signIn } = setup({ signIn: jest.fn()
      .mockImplementationOnce(() => stalled.promise)
      .mockResolvedValue('signed-in') });
    const first = reader.read({ trigger: 'mount' });
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(CODEX_READINESS_DEADLINE_MS);
    const timed = await first;
    expect(timed.binary.state).toBe('found');
    expect(timed.signIn.outcome).toBe('timeout');
    const second = await reader.read({ trigger: 'follow-up' });
    expect(second.signIn.outcome).toBe('signed-in');
    expect(selection).toHaveBeenCalledTimes(2);
    expect(signIn).toHaveBeenCalledTimes(2);
    stalled.resolve('signed-out');
  });

  it('joins ordinary reads, queues one refresh and caches a completed result', async () => {
    const firstSelection = deferred<CodexSelection>();
    const { reader, selection } = setup({ selection: jest.fn()
      .mockImplementationOnce(() => firstSelection.promise)
      .mockResolvedValue(selected('bundled')) });
    const first = reader.read();
    const joined = reader.read();
    const refreshA = reader.read({ refresh: true });
    const refreshB = reader.read({ refresh: true });
    await Promise.resolve();
    expect(selection).toHaveBeenCalledTimes(1);
    firstSelection.resolve(selected());
    expect((await first).binary.state).toBe('found');
    expect((await joined).binary.state).toBe('found');
    expect((await refreshA).binary).toMatchObject({ state: 'found', source: 'bundled' });
    expect((await refreshB).binary).toMatchObject({ state: 'found', source: 'bundled' });
    expect(selection).toHaveBeenCalledTimes(2);
    await reader.read();
    expect(selection).toHaveBeenCalledTimes(2);
  });

  it('logs each answered read without a path or raw error', async () => {
    const { reader, logger } = setup();
    await reader.read({ trigger: 'recheck' });
    await reader.read({ trigger: 'mount' });
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info.mock.calls[0]).toEqual(['[readiness] codex', {
      binary: 'found', signIn: 'signed-out', unreadable: undefined, trigger: 'recheck',
    }]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('/private/codex');
  });
});
