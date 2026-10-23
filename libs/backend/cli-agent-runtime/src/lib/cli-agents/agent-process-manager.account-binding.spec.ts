import 'reflect-metadata';
import {
  AgentId,
  type CliType,
  type CliSessionReference,
  type ProviderAccountBinding,
} from '@ptah-extension/shared';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import type { DependencyContainer } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { persistCliSessionReference } from '../wiring/agent-events';
import { AgentProcessManager } from './agent-process-manager.service';
import {
  LaneResumeGate,
  laneAccountFields,
  snapshotLaneAccountReference,
} from './lane-resume-gate';
import type {
  CliAdapter,
  LaneAccountBindingPort,
  LaneAccountReference,
  SdkHandle,
} from './cli-adapters/cli-adapter.interface';

const CLAUDE = 'claude' as CliType; // Public roster belongs to the certification batch.
const ROOT = 'D:/lane-account-fixture';
const ID = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000001');
const binding: ProviderAccountBinding = {
  version: 1, provider: 'claude', profileId: 'account123', runId: 'run12345',
  routeRevision: 0, authEpoch: 0, routeFingerprint: 'a'.repeat(64),
  identity: { kind: 'known', ownerKey: 'b'.repeat(64) },
};
const reference: LaneAccountReference = { accountBinding: binding, accountBindingId: binding.runId };

function port() {
  return {
    lookupBySdkSession: jest.fn<ReturnType<LaneAccountBindingPort['lookupBySdkSession']>, Parameters<LaneAccountBindingPort['lookupBySdkSession']>>()
      .mockResolvedValue({ status: 'bound', binding }),
    validateResume: jest.fn().mockResolvedValue({ code: 'ok' }),
    persistReference: jest.fn().mockResolvedValue(undefined),
  } satisfies LaneAccountBindingPort;
}

function gate() {
  const output: IOutputChannel = {
    name: 'test', appendLine: jest.fn(), append: jest.fn(), clear: jest.fn(),
    show: jest.fn(), dispose: jest.fn(),
  };
  const reader = jest.fn();
  return { gate: new LaneResumeGate(output, reader, () => 2_000_000), output, reader };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Constructor collaborators are structural mocks; no runtime services or I/O. */
function stub<T extends object>(members: Partial<T>): T {
  return Object.assign(Object.create(null) as T, members);
}

function lane(fields: Partial<LaneAccountReference> = {}) {
  const done = deferred<number>();
  const next = deferred<number>();
  const outputs: Array<(data: string) => void> = [];
  const sessions: Array<(sessionId: string) => void> = [];
  const handle: SdkHandle = {
    ...fields, abort: new AbortController(), done: done.promise,
    onOutput: callback => { outputs.push(callback); },
    onSessionResolved: callback => { sessions.push(callback); },
    getSessionId: () => 'sdk-session', supportsContinuation: () => true,
    continue: jest.fn().mockResolvedValue({ done: next.promise }),
  };
  return { handle, done, next, outputs, sessions };
}

function harness(accountBindings: LaneAccountBindingPort | undefined = port(), cap = 3) {
  type Args = ConstructorParameters<typeof AgentProcessManager>;
  const logger = stub<Args[0]>({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
  const adapter: CliAdapter = {
    name: CLAUDE, displayName: 'Claude', roleChannel: 'system-prompt',
    detect: jest.fn(), capabilities: () => ({ steer: false, interrupt: false, continuation: true }),
    parseOutput: raw => raw, runSdk: jest.fn(), accountBindings, supportsMcp: false,
  };
  const environment = stub<Args[5]>({
    validateWorkingDirectory: jest.fn().mockResolvedValue(undefined),
    runHarnessPreflight: jest.fn().mockResolvedValue(undefined),
    workspaceRoot: jest.fn().mockReturnValue(ROOT),
    resolveModel: jest.fn().mockReturnValue({ source: 'cli-default' }),
    resolveReasoningEffort: jest.fn().mockReturnValue({ step: 'default', ignored: [] }),
    resolveAutoApprove: jest.fn().mockReturnValue(false),
    maxConcurrentAgents: () => cap, sdkIdleReleaseMs: () => 100,
    scopedWorkspaceRoot: () => undefined, isWithinScope: () => true,
  });
  const output = stub<Args[6]>({
    discard: jest.fn(), appendOutput: jest.fn(), markTurnBoundary: jest.fn(),
    takeDelta: jest.fn(),
  });
  const resume = gate();
  const manager = new AgentProcessManager(
    logger,
    stub<Args[1]>({ getAdapter: jest.fn().mockReturnValue(adapter), getDetection: jest.fn().mockResolvedValue({ installed: true }) }),
    stub<Args[2]>({ getRunningBySession: jest.fn().mockReturnValue([]) }),
    stub<Args[3]>({ captureException: jest.fn() }),
    stub<Args[4]>({ flushPending: jest.fn().mockResolvedValue(undefined), discardPending: jest.fn() }),
    environment, output,
    stub<Args[7]>({ signal: jest.fn() }), resume.gate,
    stub<Args[9]>({ ownerForLane: jest.fn(), rememberLaneOwner: jest.fn() }),
    stub<Args[10]>({ recordWindowEvidence: jest.fn(), recordOwnerEvidence: jest.fn(), recordSuccess: jest.fn() }),
  );
  const spawnHandle = (handle: SdkHandle, extra: { cli?: CliType; agentId?: AgentId } = {}) =>
    manager.spawnFromSdkHandle(handle, { task: 'task', cli: CLAUDE, workingDirectory: ROOT,
      agentId: ID, expectsMcp: false, timeout: 0, ...extra });
  return { manager, adapter, environment, output, spawnHandle };
}

function ref(extra: Partial<CliSessionReference> = {}): CliSessionReference {
  return { ...reference, cliSessionId: 'sdk-session', cli: CLAUDE, agentId: ID,
    task: 'original task', startedAt: '2026-01-01T00:00:00Z', status: 'completed', ...extra };
}

async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

describe('Claude lane authoritative account gate', () => {
  it('classifies only authoritative absence as ambient legacy', async () => {
    const registry = port();
    registry.lookupBySdkSession.mockResolvedValue({ status: 'absent' });
    const { gate: resume } = gate();
    const result = await resume.evaluate({ cli: 'claude', cliSessionId: 'legacy', accountBindings: registry });
    expect(result.accountReference).toBeUndefined();
    expect(registry.validateResume).not.toHaveBeenCalled();
    expect(registry.lookupBySdkSession).toHaveBeenCalledWith({ provider: 'claude', sdkSessionId: 'legacy' });
  });

  it.each([null, {}, { ...binding, authEpoch: -1 }, { ...binding, canonicalConfigDir: 'forbidden' }])(
    'refuses corrupt references before cost evaluation: %p', async accountBinding => {
      const { gate: resume, output } = gate();
      await expect(resume.evaluate({ cli: 'claude', cliSessionId: 's', accountBindings: port(),
        accountReference: { accountBinding, accountBindingId: binding.runId } })).rejects.toMatchObject({ code: 'invalid-bound' });
      expect(output.appendLine).not.toHaveBeenCalled();
    });

  it.each([{ accountBindingId: binding.runId }, { accountBinding: binding }, { ...reference, accountBindingId: 'different' }])(
    'refuses incomplete or conflicting linkage: %p', async accountReference => {
      await expect(gate().gate.evaluate({ cli: 'claude', cliSessionId: 's', accountReference, accountBindings: port() }))
        .rejects.toMatchObject({ code: 'invalid-bound' });
    });

  it.each(['missing-profile', 'release-held', 'identity-mismatch', 'unavailable-storage'])('propagates %s without ambient retry', async code => {
    const registry = port();
    registry.validateResume.mockResolvedValue({ code });
    const { gate: resume, output } = gate();
    await expect(resume.evaluate({ cli: 'claude', cliSessionId: 's', accountBindings: registry, lastRequestContext: { tokens: 100000, source: 'estimate' } }))
      .rejects.toMatchObject({ code });
    expect(output.appendLine).not.toHaveBeenCalled();
    expect(registry.lookupBySdkSession).toHaveBeenCalledTimes(1);
  });

  it('refuses missing, unavailable and throwing registries without exposing dependency errors', async () => {
    const { gate: resume } = gate();
    await expect(resume.evaluate({ cli: 'claude', cliSessionId: 's' })).rejects.toMatchObject({ code: 'unavailable-storage' });
    const registry = port();
    registry.lookupBySdkSession.mockResolvedValue({ status: 'unavailable-storage' });
    await expect(resume.evaluate({ cli: 'claude', cliSessionId: 's', accountBindings: registry })).rejects.toMatchObject({ code: 'unavailable-storage' });
    registry.lookupBySdkSession.mockRejectedValue(new Error('private physical directory'));
    await expect(resume.evaluate({ cli: 'claude', cliSessionId: 's', accountBindings: registry })).rejects.toThrow('Claude lane account resume refused (unavailable-storage).');
  });

  it('refuses a corrupt authoritative record, a missing named link and a changed binding', async () => {
    const registry = port();
    for (const result of [{ status: 'invalid-bound' } as const, { status: 'absent' } as const,
      { status: 'bound', binding: { ...binding, authEpoch: 1 } } as const]) {
      registry.lookupBySdkSession.mockResolvedValue(result);
      await expect(gate().gate.evaluate({ cli: 'claude', cliSessionId: 's', accountReference: reference, accountBindings: registry }))
        .rejects.toMatchObject({ code: 'invalid-bound' });
    }
  });

  it('refuses an unknown identity baseline', async () => {
    const registry = port();
    registry.lookupBySdkSession.mockResolvedValue({ status: 'bound', binding: { ...binding, identity: { kind: 'unknown' } } });
    await expect(gate().gate.evaluate({ cli: 'claude', cliSessionId: 's', accountBindings: registry })).rejects.toMatchObject({ code: 'identity-unproved' });
  });

  it('retains the original immutable route through a fresh handoff and label/default changes', async () => {
    const registry = port();
    const result = await gate().gate.evaluate({ cli: 'claude', cliSessionId: 's', accountBindings: registry,
      accountReference: reference, lastRequestContext: { tokens: 100000, source: 'estimate' } });
    expect(result.decision).toBe('fresh');
    expect(result.accountReference).toEqual(reference);
    expect(Object.isFrozen(result.accountReference?.accountBinding.identity)).toBe(true);
    expect(registry.validateResume).toHaveBeenCalledWith(reference);
    expect(JSON.stringify(result.accountReference)).not.toMatch(/directory|label|default/i);
  });

  it.each(['codex', 'copilot', 'cursor', 'antigravity', 'opencode', 'pi', 'grok', 'ptah-cli'] as const)(
    'keeps %s legacy behavior independent of account registry availability', async cli => {
      const registry = port();
      registry.lookupBySdkSession.mockRejectedValue(new Error('offline'));
      const { gate: resume, reader } = gate();
      reader.mockResolvedValue(null);
      await expect(resume.evaluate({ cli, cliSessionId: 's', accountBindings: registry })).resolves.toMatchObject({ decision: 'resume' });
      expect(registry.lookupBySdkSession).not.toHaveBeenCalled();
    });
});

describe('AgentProcessManager account reference lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('restores bindings without a parent and resolves explicit resume from the registry', async () => {
    const registry = port();
    const { manager } = harness(registry);
    manager.restoreAgents([ref()], ROOT);
    expect(laneAccountFields(manager.findAgentInfo(ID)!)).toEqual(reference);
    const prepared = await manager.prepareSdkHandleSpawn({ cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session' });
    expect('accountReference' in prepared && prepared.accountReference).toEqual(reference);
    expect(registry.lookupBySdkSession).toHaveBeenCalledWith({ provider: 'claude', sdkSessionId: 'sdk-session' });
  });

  it('looks up parentless explicit resume even without a local lane record', async () => {
    const registry = port();
    const { manager } = harness(registry);
    const result = await manager.prepareSdkHandleSpawn({ cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session' });
    expect('accountReference' in result && result.accountReference).toEqual(reference);
  });

  it('roundtrips the immutable receipt through parent reference persistence and restore', async () => {
    const { manager, spawnHandle } = harness();
    await spawnHandle(lane(reference).handle);
    const info = { ...manager.findAgentInfo(ID)!, parentSessionId: 'parent-session' };
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const container = stub<DependencyContainer>({
      isRegistered: jest.fn(token => token === SDK_TOKENS.SDK_SESSION_METADATA_STORE),
      resolve: jest.fn().mockReturnValue({ addCliSession }),
    });
    type Logger = Parameters<typeof persistCliSessionReference>[1];
    const logger = stub<Logger>({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
    persistCliSessionReference(container, logger, 'test', info, undefined);
    await settle();
    expect(addCliSession).toHaveBeenCalledWith('parent-session', expect.objectContaining({
      ...reference, cliSessionId: 'sdk-session', sdkSessionId: 'sdk-session',
    }));
    const stored: CliSessionReference = JSON.parse(JSON.stringify(addCliSession.mock.calls[0][1]));
    const restored = harness().manager;
    restored.restoreAgents([stored], ROOT);
    expect(laneAccountFields(restored.findAgentInfo(ID)!)).toEqual(reference);
  });

  it('retains corrupt restore evidence and refuses instead of returning a retryable released code', async () => {
    const { manager } = harness();
    const corrupt: CliSessionReference = JSON.parse(JSON.stringify({ ...ref(), accountBinding: null }));
    manager.restoreAgents([corrupt], ROOT);
    await expect(manager.continueConversation(ID, 'next')).rejects.toMatchObject({ code: 'invalid-bound' });
  });

  it('carries bindings into SDK run options and awaits parentless durable SDK linkage', async () => {
    const registry = port();
    const checkpoint = deferred<void>();
    registry.persistReference.mockReturnValue(checkpoint.promise);
    const { manager, adapter } = harness(registry);
    const running = lane(reference);
    const runSdk = jest.fn<ReturnType<CliAdapter['runSdk']>, Parameters<CliAdapter['runSdk']>>(async options => {
      expect(options.accountBinding).toEqual(binding);
      await options.onAccountBinding?.(reference, 'sdk-session');
      return running.handle;
    });
    adapter.runSdk = runSdk;
    const spawned = manager.spawn({ cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session', timeout: 0 });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(registry.persistReference).toHaveBeenCalledWith(reference, 'sdk-session');
    expect(manager.listTrackedAgents()).toHaveLength(0);
    checkpoint.resolve();
    await spawned;
    expect(laneAccountFields(manager.findAgentInfo(manager.listTrackedAgents()[0].agentId)!)).toEqual(reference);
  });

  it('does not retry a failed named persistence checkpoint as ambient', async () => {
    const registry = port();
    registry.persistReference.mockRejectedValue(new Error('storage unavailable'));
    const { manager, adapter } = harness(registry);
    const runSdk = jest.fn(async (options: Parameters<CliAdapter['runSdk']>[0]) => {
      await options.onAccountBinding?.(reference, 'sdk-session');
      return lane(reference).handle;
    });
    adapter.runSdk = runSdk;
    await expect(manager.spawn({ cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session' })).rejects.toThrow('storage unavailable');
    expect(runSdk).toHaveBeenCalledTimes(1);
    expect(manager.listTrackedAgents()).toHaveLength(0);
  });

  it('refuses rebinding at the awaited checkpoint before persistence or prompt release', async () => {
    const registry = port();
    const { manager, adapter } = harness(registry);
    adapter.runSdk = jest.fn(async options => {
      await options.onAccountBinding?.({ ...reference, accountBinding: { ...binding, profileId: 'another-account' } }, 'sdk-session');
      return lane(reference).handle;
    });
    await expect(manager.spawn({ cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session' })).rejects.toMatchObject({ code: 'invalid-bound' });
    expect(registry.persistReference).not.toHaveBeenCalled();
    expect(adapter.runSdk).toHaveBeenCalledTimes(1);
  });

  it('revalidates live turns and idle-release resume without a parent', async () => {
    const registry = port();
    const { manager, spawnHandle } = harness(registry);
    const running = lane(reference);
    await spawnHandle(running.handle);
    running.done.resolve(0);
    await settle();
    registry.validateResume.mockResolvedValue({ code: 'missing-profile' });
    await expect(manager.continueConversation(ID, 'next')).rejects.toMatchObject({ code: 'missing-profile' });
    expect(running.handle.continue).not.toHaveBeenCalled();
    jest.advanceTimersByTime(101);
    registry.validateResume.mockResolvedValue({ code: 'ok' });
    await expect(manager.continueConversation(ID, 'next')).rejects.toMatchObject({ code: 'released' });
    await manager.prepareSdkHandleSpawn({ cli: CLAUDE, task: 'resume', resumeSessionId: 'sdk-session' });
    expect(registry.lookupBySdkSession.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('ignores late completion, output, session resolution and cleanup from a replaced lane', async () => {
    const { manager, spawnHandle, output } = harness();
    const old = lane(reference);
    await spawnHandle(old.handle);
    const replacement = lane(reference);
    await spawnHandle(replacement.handle);
    const exits = jest.fn();
    manager.events.on('agent:exited', exits);
    old.outputs[0]('stale output');
    old.sessions[0]('stale-session');
    old.done.resolve(1);
    await settle();
    jest.advanceTimersByTime(1000);
    expect(manager.findAgentInfo(ID)?.status).toBe('running');
    expect(manager.findAgentInfo(ID)?.cliSessionId).toBe('sdk-session');
    expect(replacement.handle.abort.signal.aborted).toBe(false);
    expect(output.appendOutput).not.toHaveBeenCalled();
    expect(exits).not.toHaveBeenCalled();
  });

  it('keeps the original concurrency cap', async () => {
    const { spawnHandle } = harness(port(), 1);
    await spawnHandle(lane().handle, { cli: 'codex' });
    await expect(spawnHandle(lane().handle, { cli: 'codex', agentId: AgentId.create() })).rejects.toThrow('Maximum concurrent agent limit reached (1)');
  });

  it('ignores delayed exit and TTL cleanup after a completed record is replaced', async () => {
    const { manager, spawnHandle } = harness();
    const old = lane(reference);
    await spawnHandle(old.handle);
    old.done.resolve(0);
    await settle();
    const replacement = lane(reference);
    await spawnHandle(replacement.handle);
    const exits = jest.fn();
    manager.events.on('agent:exited', exits);
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(manager.findAgentInfo(ID)?.status).toBe('running');
    expect(replacement.handle.abort.signal.aborted).toBe(false);
    expect(exits).not.toHaveBeenCalled();
  });

  it('freezes copies instead of retaining mutable binding objects from a handle', () => {
    const mutable = { ...binding, identity: { kind: 'known' as const, ownerKey: 'b'.repeat(64) } };
    const snapshot = snapshotLaneAccountReference({ accountBinding: mutable, accountBindingId: mutable.runId });
    mutable.identity.ownerKey = 'c'.repeat(64);
    expect(snapshot?.accountBinding.identity).toEqual(binding.identity);
  });
});


// A2 mocked evidence: registry outcomes are supplied by the existing port double.
describe('A2 mocked-evidence restored lane binding matrix', () => {
  it('rejects an old unknown identity even when the current authority would validate it', async () => {
    const registry = port();
    registry.lookupBySdkSession.mockResolvedValue({ status: 'bound', binding: {
      ...binding, identity: { kind: 'unknown' },
    } });
    await expect(gate().gate.evaluate({ cli: 'claude', cliSessionId: 'sdk-session', accountBindings: registry }))
      .rejects.toMatchObject({ code: 'identity-unproved' });
    expect(registry.validateResume).not.toHaveBeenCalled();
    expect(registry.persistReference).not.toHaveBeenCalled();
  });

  it.each([
    ['remove', 'missing-profile'], ['retarget', 'route-changed'],
    ['sign-out', 'identity-unproved'], ['different re-auth identity', 'identity-mismatch'],
    ['unknown re-auth identity', 'identity-unproved'],
  ])('refuses %s on a parentless restored lane before context evaluation', async (_event, code) => {
    const registry = port();
    registry.validateResume.mockResolvedValue({ code });
    const f = gate();
    await expect(f.gate.evaluate({ cli: 'claude', cliSessionId: 'sdk-session',
      accountBindings: registry, accountReference: reference }))
      .rejects.toMatchObject({ code });
    expect(f.reader).not.toHaveBeenCalled();
    expect(f.output.appendLine).not.toHaveBeenCalled();
    expect(registry.persistReference).not.toHaveBeenCalled();
    expect(registry.validateResume).toHaveBeenCalledWith(reference);
  });

  it('keeps two parentless resumed bindings independent while validation overlaps', async () => {
    const other: ProviderAccountBinding = { ...binding, profileId: 'account456',
      runId: 'run67890', routeFingerprint: 'c'.repeat(64),
      identity: { kind: 'known', ownerKey: 'd'.repeat(64) } };
    const registry = port();
    registry.lookupBySdkSession.mockImplementation(async ({ sdkSessionId }) => ({
      status: 'bound', binding: sdkSessionId === 'first' ? binding : other,
    }));
    const checkpoint = deferred<void>();
    registry.validateResume.mockImplementation(async () => { await checkpoint.promise; return { code: 'ok' }; });
    const resume = gate().gate;
    const first = resume.evaluate({ cli: 'claude', cliSessionId: 'first', accountBindings: registry });
    const second = resume.evaluate({ cli: 'claude', cliSessionId: 'second', accountBindings: registry });
    await settle();
    checkpoint.resolve();
    const results = await Promise.all([first, second]);
    expect(results[0].accountReference).toEqual(reference);
    expect(results[1].accountReference).toEqual({ accountBinding: other, accountBindingId: other.runId });
    expect(registry.validateResume).toHaveBeenCalledWith(reference);
    expect(registry.validateResume).toHaveBeenCalledWith({ accountBinding: other, accountBindingId: other.runId });
  });
});
