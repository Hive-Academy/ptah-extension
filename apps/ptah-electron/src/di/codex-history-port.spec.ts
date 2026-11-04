import 'reflect-metadata';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DependencyContainer } from 'tsyringe';
import type { SessionMetadata } from '@ptah-extension/agent-sdk';
import {
  CodexSessionHistoryError,
  normalizeCodexHomeKey,
  normalizeCodexWorkspaceKey,
  type CodexHistoryReader,
  type CodexSessionHistory,
} from '@ptah-extension/codex-runtime';
import { SessionId } from '@ptah-extension/shared';
import {
  createElectronCodexHistoryPort,
  ElectronCodexHistoryError,
  type ElectronCodexHistoryDeps,
} from './codex-runtime-composition';

type HistoryTail = Awaited<ReturnType<CodexHistoryReader['readHistoryTail']>>;
type Runtime = ReturnType<ElectronCodexHistoryDeps['resolveRuntime']>;

const sessionId = SessionId.from('11111111-1111-4111-8111-111111111111');
const bound = { maxTurns: 200, maxTurnPages: 8, maxItemPages: 16 };

// Created at load: describe.each tables build sessions before any hook runs.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'codex-history-port-')));
const home = join(root, 'codex-home');
const workspace = join(root, 'repo');
mkdirSync(home);
mkdirSync(workspace);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

type Execution = NonNullable<SessionMetadata['codexExecution']>;
const execution: Execution = {
  version: 1,
  runtime: 'codex-app-server',
  sessionId,
  providerId: 'openai-codex',
  workspaceId: normalizeCodexWorkspaceKey(workspace, process.platform),
  codex: { normalizedHome: normalizeCodexHomeKey(home, process.platform) },
};

function session(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    sessionId,
    name: 'Codex chat',
    workspaceId: workspace,
    createdAt: 100,
    lastActiveAt: 200,
    totalCost: 0,
    totalTokens: { input: 0, output: 0 },
    codexExecution: execution,
    ...overrides,
  };
}

const snapshot: CodexSessionHistory = { rootThreadId: sessionId, threads: [] };
const tail = { coversWholeHistory: false, thread: { id: sessionId, turns: [] } } as unknown as HistoryTail;

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(runtime: Runtime, overrides: Partial<ElectronCodexHistoryDeps> = {}) {
  const dispose = jest.fn(async () => undefined);
  const createScope = jest.fn(() => ({ container: {} as DependencyContainer, dispose }));
  const resolveRuntime = jest.fn(() => runtime);
  const deps: ElectronCodexHistoryDeps = {
    currentHome: () => home,
    verifyBinary: jest.fn(async () => undefined),
    createScope,
    resolveRuntime,
    liveProfiles: new Map(),
    logger: { error: jest.fn() },
    ...overrides,
  };
  return { port: createElectronCodexHistoryPort(deps), dispose, createScope, resolveRuntime };
}

function fullRuntime() {
  return {
    open: jest.fn(),
    readHistory: jest.fn<
      ReturnType<CodexHistoryReader['readHistory']>,
      Parameters<CodexHistoryReader['readHistory']>
    >(async () => snapshot),
    readHistoryTail: jest.fn<
      ReturnType<CodexHistoryReader['readHistoryTail']>,
      Parameters<CodexHistoryReader['readHistoryTail']>
    >(async () => tail),
  };
}

type Read = 'readHistory' | 'readHistoryTail';
const reads: readonly Read[] = ['readHistory', 'readHistoryTail'];

function call(
  port: ReturnType<typeof createElectronCodexHistoryPort>,
  read: Read,
  target: SessionMetadata,
  signal?: AbortSignal,
): Promise<unknown> {
  return read === 'readHistory'
    ? port.readHistory(target, signal)
    : port.readHistoryTail(target, bound, signal);
}

describe('createElectronCodexHistoryPort', () => {
  describe.each(reads)('%s identity validation', (read) => {
    it.each<[string, SessionMetadata, string]>([
      ['no native execution', session({ codexExecution: undefined }), 'invalidIdentity'],
      ['another runtime', session({
        codexExecution: { ...execution, runtime: 'other' as 'codex-app-server' },
      }), 'invalidIdentity'],
      ['another execution session', session({
        codexExecution: { ...execution, sessionId: SessionId.from('22222222-2222-4222-8222-222222222222') },
      }), 'invalidIdentity'],
      ['another provider', session({
        codexExecution: { ...execution, providerId: 'codex' },
      }), 'invalidIdentity'],
      ['another Codex home', session({
        codexExecution: { ...execution, codex: { normalizedHome: normalizeCodexHomeKey(join(root, 'other-home'), process.platform) } },
      }), 'homeMismatch'],
      ['another workspace key', session({
        codexExecution: { ...execution, workspaceId: normalizeCodexWorkspaceKey(join(root, 'other'), process.platform) },
      }), 'invalidIdentity'],
    ])('rejects %s before any runtime read', async (_case, target, code) => {
      const runtime = fullRuntime();
      const { port, createScope, resolveRuntime } = harness(runtime);
      await expect(call(port, read, target)).rejects.toMatchObject({
        name: 'ElectronCodexHistoryError',
        code,
      });
      expect(createScope).not.toHaveBeenCalled();
      expect(resolveRuntime).not.toHaveBeenCalled();
      expect(runtime.readHistory).not.toHaveBeenCalled();
      expect(runtime.readHistoryTail).not.toHaveBeenCalled();
    });

    it('rejects a workspace path that no longer exists as pathUnavailable', async () => {
      const missing = join(root, 'missing');
      const target = session({
        workspaceId: missing,
        codexExecution: { ...execution, workspaceId: normalizeCodexWorkspaceKey(missing, process.platform) },
      });
      const runtime = fullRuntime();
      const { port } = harness(runtime);
      await expect(call(port, read, target)).rejects.toMatchObject({ code: 'pathUnavailable' });
      expect(runtime[read]).not.toHaveBeenCalled();
    });
  });

  it('passes the bound unchanged to the runtime tail read and never reads the full history', async () => {
    const runtime = fullRuntime();
    const { port, dispose } = harness(runtime);
    await expect(port.readHistoryTail(session(), bound)).resolves.toBe(tail);
    expect(runtime.readHistoryTail).toHaveBeenCalledTimes(1);
    const [profile, resume, passedBound, signal] = runtime.readHistoryTail.mock.calls[0] ?? [];
    expect(passedBound).toBe(bound);
    expect(profile?.cwd).toBe(workspace);
    expect(resume).toMatchObject({ threadId: sessionId, providerId: 'openai-codex' });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(runtime.readHistory).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps readHistory unchanged: same runtime call, result and scope disposal', async () => {
    const runtime = fullRuntime();
    const { port, dispose } = harness(runtime);
    await expect(port.readHistory(session())).resolves.toBe(snapshot);
    expect(runtime.readHistory).toHaveBeenCalledTimes(1);
    const [, resume, signal] = runtime.readHistory.mock.calls[0] ?? [];
    expect(resume?.threadId).toBe(sessionId);
    expect(signal).toBeInstanceOf(AbortSignal);
    // The port aborts its own controller once the read settles.
    expect(signal?.aborted).toBe(true);
    expect(runtime.readHistoryTail).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the readHistory error mapping', async () => {
    const runtime = fullRuntime();
    const { port } = harness(runtime);
    runtime.readHistory.mockRejectedValueOnce(new CodexSessionHistoryError('malformedPage'));
    await expect(port.readHistory(session())).rejects.toMatchObject({ code: 'malformedPage' });
    runtime.readHistory.mockRejectedValueOnce(new CodexSessionHistoryError('threadNotFound'));
    await expect(port.readHistory(session())).rejects.toMatchObject({ code: 'threadNotFound' });
    runtime.readHistory.mockRejectedValueOnce(new Error('/secret/path stderr'));
    await expect(port.readHistory(session())).rejects.toMatchObject({
      code: 'runtimeFailed',
      message: 'Codex history could not be read.',
    });
  });

  it.each([
    ['pageLimitExceeded', 'runtimeFailed'],
    ['requestRejected', 'runtimeFailed'],
    ['malformedPage', 'malformedPage'],
  ] as const)('maps a tail %s to %s', async (source, code) => {
    const runtime = fullRuntime();
    runtime.readHistoryTail.mockRejectedValueOnce(new CodexSessionHistoryError(source));
    const { port } = harness(runtime);
    const error = await port.readHistoryTail(session(), bound).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElectronCodexHistoryError);
    expect(error).toMatchObject({ code });
  });

  it('gives runtimeFailed for a runtime without readHistoryTail, which still serves readHistory', async () => {
    const runtime = { open: jest.fn(), readHistory: jest.fn(async () => snapshot) };
    const { port, dispose } = harness(runtime);
    await expect(port.readHistoryTail(session(), bound)).rejects.toMatchObject({
      name: 'ElectronCodexHistoryError',
      code: 'runtimeFailed',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(port.readHistory(session())).resolves.toBe(snapshot);
  });

  it('gives runtimeFailed for a runtime without readHistory', async () => {
    const runtime = { open: jest.fn(), readHistoryTail: jest.fn(async () => tail) };
    const { port } = harness(runtime);
    await expect(port.readHistory(session())).rejects.toMatchObject({ code: 'runtimeFailed' });
    await expect(port.readHistoryTail(session(), bound)).resolves.toBe(tail);
  });

  it('shares the two-read cap between full and tail reads: the third is busy', async () => {
    const full = deferred<CodexSessionHistory>();
    const partial = deferred<HistoryTail>();
    const runtime = fullRuntime();
    runtime.readHistory.mockImplementationOnce(() => full.promise);
    runtime.readHistoryTail.mockImplementationOnce(() => partial.promise);
    const { port } = harness(runtime);
    const first = port.readHistory(session());
    const second = port.readHistoryTail(session(), bound);
    await new Promise((done) => setImmediate(done));
    expect(runtime.readHistory).toHaveBeenCalledTimes(1);
    expect(runtime.readHistoryTail).toHaveBeenCalledTimes(1);
    for (const read of reads) {
      await expect(call(port, read, session())).rejects.toMatchObject({ code: 'busy' });
    }
    expect(runtime.readHistory).toHaveBeenCalledTimes(1);
    expect(runtime.readHistoryTail).toHaveBeenCalledTimes(1);
    full.resolve(snapshot);
    partial.resolve(tail);
    await expect(first).resolves.toBe(snapshot);
    await expect(second).resolves.toBe(tail);
    await expect(port.readHistoryTail(session(), bound)).resolves.toBe(tail);
  });

  it.each(reads)('%s times out, aborts the runtime read and frees its slot', async (read) => {
    const runtime = fullRuntime();
    const signals: AbortSignal[] = [];
    const never = (signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<never>(() => undefined);
    };
    runtime.readHistory.mockImplementationOnce((_p, _r, signal) => never(signal ?? new AbortController().signal));
    runtime.readHistoryTail.mockImplementationOnce((_p, _r, _b, signal) => never(signal ?? new AbortController().signal));
    const { port, dispose } = harness(runtime, { timeoutMs: 20 });
    await expect(call(port, read, session())).rejects.toMatchObject({
      name: 'ElectronCodexHistoryError',
      code: 'timeout',
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(call(port, read, session())).resolves.toBeDefined();
  });

  it.each(reads)('%s is cancelled by an already aborted caller signal', async (read) => {
    const runtime = fullRuntime();
    const { port } = harness(runtime);
    const controller = new AbortController();
    controller.abort();
    await expect(call(port, read, session(), controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(runtime[read]).not.toHaveBeenCalled();
  });
});
