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
import type {
  ClaudeAccountSelectionReader,
  ProviderAccountAdmissionPort,
} from '@ptah-extension/auth-providers-tokens';
import type { ClaudeLaneAccountPersistence } from '../claude/claude-sdk-lane-runner';
import { AgentProcessManager } from './agent-process-manager.service';
import {
  LaneAccountResumeError,
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
import { SYSTEM_CLI_TYPES, type CliDetectionResult } from '@ptah-extension/shared';
import type {
  IProcessSpawner,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  IAuthSecretsService,
  Logger,
  SentryService,
} from '@ptah-extension/vscode-core';
import type { ReasoningSettings } from '@ptah-extension/settings-core';
import { CliDetectionService } from './cli-detection.service';
import { AgentSpawnEnvironment } from './agent-spawn-environment.service';
import {
  ClaudeCliAdapter,
  type ClaudeCliAdapterDependencies,
} from './cli-adapters/claude-cli.adapter';

/** The roster before the native Claude lane joined, in auto-detect order. */
const PREVIOUS_SEVEN = ['codex', 'copilot', 'cursor', 'antigravity', 'opencode', 'pi', 'grok'] as const;

// The seven binary adapters are replaced by doubles so detection never runs a
// real `which`/version probe. The Claude adapter under test is the real class.
function mockRosterAdapter(name: string) {
  return {
    name, displayName: name, roleChannel: 'task-prompt',
    detect: jest.fn().mockResolvedValue({ cli: name, installed: true, messagingMode: 'queue' }),
    capabilities: () => ({ steer: false, interrupt: false, continuation: true }),
    parseOutput: (raw: string) => raw,
  };
}
jest.mock('./cli-adapters/codex-cli.adapter', () => ({ CodexCliAdapter: jest.fn(() => mockRosterAdapter('codex')) }));
jest.mock('./cli-adapters/copilot-sdk.adapter', () => ({ CopilotSdkAdapter: jest.fn(() => mockRosterAdapter('copilot')) }));
jest.mock('./cli-adapters/copilot-permission-bridge', () => ({ CopilotPermissionBridge: jest.fn(() => ({})) }));
jest.mock('./cli-adapters/cursor-cli.adapter', () => ({ CursorCliAdapter: jest.fn(() => mockRosterAdapter('cursor')) }));
jest.mock('./cli-adapters/antigravity-cli.adapter', () => ({ AntigravityCliAdapter: jest.fn(() => mockRosterAdapter('antigravity')) }));
jest.mock('./cli-adapters/opencode-cli.adapter', () => ({ OpencodeCliAdapter: jest.fn(() => mockRosterAdapter('opencode')) }));
jest.mock('./cli-adapters/pi-cli.adapter', () => ({ PiCliAdapter: jest.fn(() => mockRosterAdapter('pi')) }));
jest.mock('./cli-adapters/grok-cli.adapter', () => ({ GrokCliAdapter: jest.fn(() => mockRosterAdapter('grok')) }));

const CLAUDE: CliType = 'claude';
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

function harness(
  accountBindings: LaneAccountBindingPort | undefined = port(),
  cap = 3,
  accountSelections?: ClaudeAccountSelectionReader,
) {
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
    undefined, undefined, undefined, accountSelections,
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

/** A real Claude adapter over structural doubles; detection must never query. */
function claudeAdapter(loader: Partial<ClaudeCliAdapterDependencies['loader']>) {
  const queryFn = jest.fn();
  const admission = jest.fn().mockReturnValue(null);
  const models = { getNativeClaudeModels: jest.fn().mockResolvedValue([]) };
  const logger = stub<Logger>({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
  const deps = stub<ClaudeCliAdapterDependencies>({
    loader: {
      getCliJsPath: jest.fn().mockResolvedValue('D:/sdk/cli.js'),
      getQueryFunction: jest.fn().mockResolvedValue(queryFn),
      ...loader,
    } as ClaudeCliAdapterDependencies['loader'],
    admission, models,
  });
  return { adapter: new ClaudeCliAdapter(logger, deps), queryFn, admission, models };
}

function detection(claude: ClaudeCliAdapter | null) {
  const logger = stub<Logger>({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
  const sentry = { captureException: jest.fn() };
  const service = new CliDetectionService(
    logger,
    stub<SentryService>(sentry),
    stub<IProcessSpawner>({}),
    stub<IAuthSecretsService>({ getProviderKey: jest.fn().mockResolvedValue(undefined) }),
    claude,
  );
  return { service, sentry };
}

describe('Batch 26 system Claude roster activation', () => {
  it('appends claude to the tuple after the unchanged previous seven', () => {
    expect(SYSTEM_CLI_TYPES.slice(0, PREVIOUS_SEVEN.length)).toEqual(PREVIOUS_SEVEN);
    expect(SYSTEM_CLI_TYPES).toHaveLength(PREVIOUS_SEVEN.length + 1);
    expect(SYSTEM_CLI_TYPES[PREVIOUS_SEVEN.length]).toBe('claude');
    expect(SYSTEM_CLI_TYPES).not.toContain('ptah-cli');
  });

  it('detects the real Claude adapter beside the seven without starting a query', async () => {
    const claude = claudeAdapter({});
    const { service } = detection(claude.adapter);
    const results = await service.detectAll();
    expect(results.map((r) => r.cli)).toEqual([...SYSTEM_CLI_TYPES]);
    expect(results.every((r) => r.installed)).toBe(true);
    expect(results.find((r) => r.cli === CLAUDE)).toMatchObject({ roleChannel: 'system-prompt', messagingMode: 'queue' });
    expect(service.getAdapter(CLAUDE)).toBe(claude.adapter);
    expect(claude.queryFn).not.toHaveBeenCalled();
    expect(claude.models.getNativeClaudeModels).not.toHaveBeenCalled();
  });

  it('isolates a missing Claude SDK: claude is uninstalled, the seven are untouched', async () => {
    const claude = claudeAdapter({ getQueryFunction: jest.fn().mockRejectedValue(new Error('module not found')) });
    const { service, sentry } = detection(claude.adapter);
    const results = await service.detectAll();
    expect(results.find((r) => r.cli === CLAUDE)?.installed).toBe(false);
    expect(results.filter((r) => r.cli !== CLAUDE).map((r) => [r.cli, r.installed]))
      .toEqual(PREVIOUS_SEVEN.map((cli) => [cli, true]));
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports an absent bundled executable as not installed', async () => {
    const claude = claudeAdapter({ getCliJsPath: jest.fn().mockResolvedValue(undefined) });
    const { service } = detection(claude.adapter);
    expect((await service.getDetection(CLAUDE))?.installed).toBe(false);
    expect(claude.queryFn).not.toHaveBeenCalled();
  });

  it('does not treat a signed-out or unadmitted account as uninstalled', async () => {
    const claude = claudeAdapter({});
    const { service } = detection(claude.adapter);
    expect((await service.getDetection(CLAUDE))?.installed).toBe(true);
    expect(claude.admission).not.toHaveBeenCalled();
  });

  it('keeps the previous seven-adapter roster when no Claude adapter is supplied', async () => {
    const { service } = detection(null);
    expect((await service.detectAll()).map((r) => r.cli)).toEqual([...PREVIOUS_SEVEN]);
    expect(service.getAdapter(CLAUDE)).toBeUndefined();
  });
});

describe('Batch 26 typed Claude runtime policy', () => {
  type Detection = Pick<CliDetectionService, 'getAdapter' | 'getDetection' | 'getInstalledClis'>;

  function environment(config: Record<string, unknown>, installed: readonly CliType[] = SYSTEM_CLI_TYPES, chatEffort?: string) {
    const results = SYSTEM_CLI_TYPES.map(
      (cli) => ({ cli, installed: installed.includes(cli), messagingMode: 'queue' }) as CliDetectionResult,
    );
    const cliDetection = stub<Detection>({
      getAdapter: jest.fn((cli: CliType) => (SYSTEM_CLI_TYPES as readonly CliType[]).includes(cli) ? stub<CliAdapter>({ name: cli }) : undefined),
      getDetection: jest.fn(async (cli: CliType) => results.find((r) => r.cli === cli)),
      getInstalledClis: jest.fn(async () => results.filter((r) => r.installed)),
    });
    const workspace = stub<IWorkspaceProvider>({
      getConfiguration: jest.fn((_section: string, key: string, fallback?: unknown) =>
        key in config ? config[key] : fallback) as IWorkspaceProvider['getConfiguration'],
    });
    return new AgentSpawnEnvironment(
      stub<Logger>({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
      cliDetection as CliDetectionService,
      workspace,
      stub<ReasoningSettings>({ effort: { get: () => chatEffort } } as Partial<ReasoningSettings>),
      stub<SentryService>({ captureException: jest.fn() }),
    );
  }

  it('maps claudeModel, keeps request precedence and adds no hard-coded default', () => {
    const configured = environment({ 'agentOrchestration.claudeModel': ' claude-model-from-settings ' });
    expect(configured.resolveModel(CLAUDE, undefined)).toEqual({ model: 'claude-model-from-settings', source: 'setting' });
    expect(configured.resolveModel(CLAUDE, 'request-model')).toEqual({ model: 'request-model', source: 'request' });
    expect(environment({}).resolveModel(CLAUDE, undefined)).toEqual({ model: undefined, source: 'cli-default' });
    expect(environment({}).resolveModel('codex', undefined).source).toBe('ptah-default');
  });

  it('maps claudeReasoningEffort on the SDK scale without Codex coercion', () => {
    expect(environment({ 'agentOrchestration.claudeReasoningEffort': 'max' }).resolveReasoningEffort(CLAUDE))
      .toMatchObject({ effort: 'max', step: 2, ignored: [] });
    expect(environment({ 'agentOrchestration.codexReasoningEffort': 'max' }).resolveReasoningEffort('codex'))
      .toMatchObject({ effort: 'xhigh', step: 2 });
    expect(environment({ 'agentOrchestration.claudeReasoningEffort': 'minimal' }).resolveReasoningEffort(CLAUDE))
      .toEqual({ effort: undefined, step: 6, ignored: [{ step: 2, value: 'minimal' }] });
    expect(environment({ 'agentOrchestration.claudeReasoningEffort': 'inherit' }, SYSTEM_CLI_TYPES, 'high').resolveReasoningEffort(CLAUDE))
      .toMatchObject({ effort: 'high', step: 3 });
    expect(environment({}).resolveReasoningEffort(CLAUDE, { effort: 'xhigh' })).toMatchObject({ effort: 'xhigh', step: 1 });
    expect(environment({}).resolveReasoningEffort(CLAUDE, { roleName: 'code-logic-reviewer' })).toMatchObject({ effort: 'medium', step: 4 });
  });

  it('honours preferred order, skips unknown IDs and ptah-cli, and respects the disabled set', async () => {
    const order = { 'agentOrchestration.preferredAgentOrder': ['not-a-cli', 'ptah-cli', 'claude', 'codex'] };
    expect(await environment(order).preferredCli()).toBe(CLAUDE);
    expect(await environment({ ...order, 'agentOrchestration.disabledClis': ['claude'] }).preferredCli()).toBe('codex');
    expect(await environment(order, ['grok']).preferredCli()).toBe('grok');
    expect(await environment({ 'agentOrchestration.disabledClis': [...PREVIOUS_SEVEN] }, SYSTEM_CLI_TYPES).preferredCli()).toBe(CLAUDE);
    expect(await environment({}, []).preferredCli()).toBeNull();
  });

  it('keeps auto-detect on the previous first CLI when every lane is installed', async () => {
    expect(await environment({}).preferredCli()).toBe('codex');
  });

  it('clamps the concurrency cap to 1..100 with a default of 5', () => {
    const cap = (value: unknown) => environment({ 'agentOrchestration.maxConcurrentAgents': value }).maxConcurrentAgents();
    expect(cap(0)).toBe(1);
    expect(cap(-3)).toBe(1);
    expect(cap(500)).toBe(100);
    expect(cap(Number.NaN)).toBe(5);
    expect(cap(42)).toBe(42);
    expect(environment({}).maxConcurrentAgents()).toBe(5);
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

// B14 regression row: lane precedence (explicit, omitted to stored, no reader, reader error).
describe('Claude lane account selection precedence', () => {
  type RunOptions = Parameters<CliAdapter['runSdk']>[0] & { accountAdmission?: unknown };

  function reader(result: Promise<{ readonly profileId: string | null }>) {
    return { readStoredSelection: jest.fn().mockReturnValue(result) } satisfies ClaudeAccountSelectionReader;
  }

  function precedence(accountSelections?: ClaudeAccountSelectionReader) {
    const h = harness(port(), 3, accountSelections);
    const runSdk = jest.fn(async (_options: RunOptions) => lane().handle);
    h.adapter.runSdk = runSdk;
    const admission = () => runSdk.mock.calls[0]?.[0].accountAdmission;
    return { ...h, runSdk, admission };
  }

  const admitted = (selection: unknown) => ({
    provider: 'claude', scope: 'lane', selection, workingDirectory: ROOT,
    operationId: expect.any(String), runId: expect.any(String),
  });

  it('admits an explicit named selection with the run working directory', async () => {
    const stored = reader(Promise.resolve({ profileId: 'stored-profile' }));
    const { manager, admission } = precedence(stored);
    const selection = { kind: 'named', profileId: 'explicit-profile' } as const;
    await manager.spawn({ cli: CLAUDE, task: 'task', workingDirectory: ROOT, timeout: 0, accountSelection: selection });
    expect(admission()).toEqual(admitted(selection));
    expect(stored.readStoredSelection).not.toHaveBeenCalled();
  });

  it('keeps an explicit ambient selection on today\'s route', async () => {
    const stored = reader(Promise.resolve({ profileId: 'stored-profile' }));
    const { manager, runSdk, admission } = precedence(stored);
    await manager.spawn({ cli: CLAUDE, task: 'task', timeout: 0, accountSelection: { kind: 'ambient' } });
    expect(runSdk).toHaveBeenCalledTimes(1);
    expect(admission()).toBeUndefined();
    expect(stored.readStoredSelection).not.toHaveBeenCalled();
  });

  it.each([undefined, { kind: 'omitted' } as const])('reads the stored lane selection when omitted (%p)', async accountSelection => {
    const stored = reader(Promise.resolve({ profileId: 'stored-profile' }));
    const { manager, admission } = precedence(stored);
    await manager.spawn({ cli: CLAUDE, task: 'task', timeout: 0, ...(accountSelection ? { accountSelection } : {}) });
    expect(stored.readStoredSelection).toHaveBeenCalledWith(ROOT, 'lane');
    expect(admission()).toEqual(admitted({ kind: 'named', profileId: 'stored-profile' }));
  });

  it('stays ambient when the stored lane selection is the default route', async () => {
    const stored = reader(Promise.resolve({ profileId: null }));
    const { manager, runSdk, admission } = precedence(stored);
    await manager.spawn({ cli: CLAUDE, task: 'task', timeout: 0 });
    expect(stored.readStoredSelection).toHaveBeenCalledTimes(1);
    expect(runSdk).toHaveBeenCalledTimes(1);
    expect(admission()).toBeUndefined();
  });

  it('stays ambient when the host has no selection reader', async () => {
    const { manager, runSdk, admission } = precedence(undefined);
    await manager.spawn({ cli: CLAUDE, task: 'task', timeout: 0 });
    expect(runSdk).toHaveBeenCalledTimes(1);
    expect(admission()).toBeUndefined();
  });

  it('refuses unavailable-storage on a reader error, before preflight and without ambient retry', async () => {
    const stored = { readStoredSelection: jest.fn().mockRejectedValue(new Error('D:/secret/path unreadable')) };
    const { manager, runSdk, environment } = precedence(stored);
    const spawned = manager.spawn({ cli: CLAUDE, task: 'task', timeout: 0 });
    await expect(spawned).rejects.toBeInstanceOf(LaneAccountResumeError);
    await expect(spawned).rejects.toMatchObject({ code: 'unavailable-storage' });
    await expect(spawned).rejects.not.toThrow(/secret/);
    expect(runSdk).not.toHaveBeenCalled();
    expect(environment.runHarnessPreflight).not.toHaveBeenCalled();
    expect(manager.listTrackedAgents()).toHaveLength(0);
  });

  it('keeps the session\'s stored account on an omitted resume', async () => {
    const stored = reader(Promise.resolve({ profileId: 'stored-profile' }));
    const { manager, admission } = precedence(stored);
    await manager.spawn({ cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session', timeout: 0 });
    expect(stored.readStoredSelection).not.toHaveBeenCalled();
    // Derived from the stored binding's run, never the workspace default.
    expect(admission()).toEqual({
      provider: 'claude', scope: 'lane', selection: { kind: 'omitted' }, workingDirectory: ROOT,
      operationId: expect.any(String), runId: binding.runId,
    });
  });

  it('leaves non-Claude CLIs unchanged', async () => {
    const stored = reader(Promise.resolve({ profileId: 'stored-profile' }));
    const { manager, runSdk, admission } = precedence(stored);
    // Copilot: the harness environment has no Codex lane budgets.
    await manager.spawn({ cli: 'copilot', task: 'task', timeout: 0, accountSelection: { kind: 'named', profileId: 'p' } });
    expect(runSdk).toHaveBeenCalledTimes(1);
    expect(admission()).toBeUndefined();
    expect(runSdk.mock.calls[0][0]).not.toHaveProperty('accountAdmission');
    expect(stored.readStoredSelection).not.toHaveBeenCalled();
  });
});

describe('P3 bound lane resume through the real Claude adapter', () => {
  // The manager's request reaches the real adapter. Admission ends at a typed
  // port refusal (`busy`): what matters is which request reaches the port.
  function realResume(accountSelections?: ClaudeAccountSelectionReader) {
    const h = harness(port(), 3, accountSelections);
    const persistence = stub<ClaudeLaneAccountPersistence>({
      available: true,
      lookupBySdkSession: jest.fn().mockResolvedValue({ status: 'bound', binding }),
      validateResume: jest.fn().mockResolvedValue({ code: 'ok' }),
      persistReference: jest.fn().mockResolvedValue(undefined),
      commitRunBinding: jest.fn(),
    });
    const admitClaudeRoute = jest.fn().mockResolvedValue({ code: 'busy' });
    const admission = stub<ProviderAccountAdmissionPort>({
      admitClaudeRoute, releaseReservation: jest.fn(), retainUnresolvedReservation: jest.fn(),
    });
    const loader = { getCliJsPath: jest.fn(), getQueryFunction: jest.fn() };
    const real = new ClaudeCliAdapter(
      stub<Logger>({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
      stub<ClaudeCliAdapterDependencies>({
        loader: loader as unknown as ClaudeCliAdapterDependencies['loader'],
        admission: () => admission,
        accountPersistence: () => persistence,
      }),
    );
    h.adapter.runSdk = real.runSdk.bind(real);
    return { ...h, persistence, admitClaudeRoute, loader };
  }

  it.each([
    ['omitted', undefined],
    ['the same named account', { kind: 'named', profileId: binding.profileId } as const],
  ])('admits the stored account and run on a %s resume, without the workspace default', async (_label, accountSelection) => {
    const stored = { readStoredSelection: jest.fn().mockResolvedValue({ profileId: 'workspace-default' }) };
    const f = realResume(stored);
    const spawned = f.manager.spawn({
      cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session', workingDirectory: ROOT, timeout: 0,
      ...(accountSelection ? { accountSelection } : {}),
    });
    await expect(spawned).rejects.toMatchObject({ code: 'busy' });
    expect(stored.readStoredSelection).not.toHaveBeenCalled();
    expect(f.admitClaudeRoute).toHaveBeenCalledTimes(1);
    expect(f.admitClaudeRoute).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'claude', scope: 'lane', runId: binding.runId, workingDirectory: ROOT,
      selection: { kind: 'named', profileId: binding.profileId },
    }));
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
  });

  it.each([
    ['another named account', { kind: 'named', profileId: 'other-profile' } as const],
    ['explicit ambient', { kind: 'ambient' } as const],
  ])('refuses %s against the stored binding with conflict before admission', async (_label, accountSelection) => {
    const f = realResume();
    const spawned = f.manager.spawn({
      cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session', workingDirectory: ROOT, timeout: 0,
      accountSelection,
    });
    await expect(spawned).rejects.toMatchObject({ code: 'conflict' });
    expect(f.admitClaudeRoute).not.toHaveBeenCalled();
    expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
    expect(f.loader.getQueryFunction).not.toHaveBeenCalled();
  });

  // PR #827 review: the gate starts a bound named lane fresh (idle limit).
  // The gate clock reads 2_000_000 ms, so a 1970 record is idle for 2000 s.
  describe('fresh handoff of a bound named lane', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

    const idle = () => ref({ startedAt: '1970-01-01T00:00:00.000Z' });

    it('admits a new run on the bound profile through the real adapter, without the workspace default', async () => {
      const stored = { readStoredSelection: jest.fn().mockResolvedValue({ profileId: 'workspace-default' }) };
      const f = realResume(stored);
      f.manager.restoreAgents([idle()], ROOT);
      const spawned = f.manager.spawn({
        cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session', workingDirectory: ROOT, timeout: 0,
      });
      // `busy` is the admission port's refusal: the request reached the port.
      await expect(spawned).rejects.toMatchObject({ code: 'busy' });
      expect(stored.readStoredSelection).not.toHaveBeenCalled();
      expect(f.admitClaudeRoute).toHaveBeenCalledTimes(1);
      const admitted = f.admitClaudeRoute.mock.calls[0][0];
      expect(admitted).toMatchObject({
        provider: 'claude', scope: 'lane', workingDirectory: ROOT,
        selection: { kind: 'named', profileId: binding.profileId },
      });
      expect(admitted.runId).toEqual(expect.any(String));
      expect(admitted.runId).not.toBe(binding.runId);
      // No session is resumed, so the stored session is not looked up again.
      expect(f.persistence.lookupBySdkSession).not.toHaveBeenCalled();
    });

    it('starts the lane without the old reference and persists the new run binding', async () => {
      const registry = port();
      const h = harness(registry);
      h.manager.restoreAgents([idle()], ROOT);
      const newBinding: ProviderAccountBinding = { ...binding, runId: 'run67890' };
      const newReference: LaneAccountReference = { accountBinding: newBinding, accountBindingId: newBinding.runId };
      type RunOptions = Parameters<CliAdapter['runSdk']>[0] & { accountAdmission?: { runId: string; selection: unknown } };
      const runSdk = jest.fn(async (options: RunOptions) => {
        await options.onAccountBinding?.(newReference, 'new-session');
        return lane(newReference).handle;
      });
      h.adapter.runSdk = runSdk;
      await h.manager.spawn({ cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session', workingDirectory: ROOT, timeout: 0 });
      const options = runSdk.mock.calls[0][0];
      expect(options).not.toHaveProperty('accountBinding');
      expect(options).not.toHaveProperty('accountBindingId');
      expect(options.resumeSessionId).toBeUndefined();
      expect(options.accountAdmission?.selection).toEqual({ kind: 'named', profileId: binding.profileId });
      expect(options.accountAdmission?.runId).not.toBe(binding.runId);
      expect(registry.persistReference).toHaveBeenCalledWith(newReference, 'new-session');
    });

    it.each([
      ['another named account', { kind: 'named', profileId: 'other-profile' } as const],
      ['explicit ambient', { kind: 'ambient' } as const],
    ])('refuses %s with conflict before admission', async (_label, accountSelection) => {
      const f = realResume();
      f.manager.restoreAgents([idle()], ROOT);
      const spawned = f.manager.spawn({
        cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session', workingDirectory: ROOT, timeout: 0,
        accountSelection,
      });
      await expect(spawned).rejects.toBeInstanceOf(LaneAccountResumeError);
      await expect(spawned).rejects.toMatchObject({ code: 'conflict' });
      expect(f.admitClaudeRoute).not.toHaveBeenCalled();
      expect(f.persistence.commitRunBinding).not.toHaveBeenCalled();
      expect(f.loader.getQueryFunction).not.toHaveBeenCalled();
    });

    it('admits an explicit selection of the same bound account as a new run', async () => {
      const f = realResume();
      f.manager.restoreAgents([idle()], ROOT);
      const spawned = f.manager.spawn({
        cli: CLAUDE, task: 'next', resumeSessionId: 'sdk-session', workingDirectory: ROOT, timeout: 0,
        accountSelection: { kind: 'named', profileId: binding.profileId },
      });
      await expect(spawned).rejects.toMatchObject({ code: 'busy' });
      expect(f.admitClaudeRoute).toHaveBeenCalledWith(expect.objectContaining({
        selection: { kind: 'named', profileId: binding.profileId },
      }));
      expect(f.admitClaudeRoute.mock.calls[0][0].runId).not.toBe(binding.runId);
    });
  });
});
