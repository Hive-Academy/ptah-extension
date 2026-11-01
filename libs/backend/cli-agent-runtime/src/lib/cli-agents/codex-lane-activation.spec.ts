import 'reflect-metadata';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  normalizeCodexHomeKey, normalizeCodexWorkspaceKey,
  type CodexContext, type CodexExecutionProfile, type CodexExecutionProfileInput,
  type CodexModelInfo, type CodexRuntimeEvent, type CodexThreadIdentity,
  type CodexTurnInput, type CodexTurnReceipt,
} from '@ptah-extension/codex-runtime';
import type { CliOutputSegment, QuotaOwnerRef } from '@ptah-extension/shared';
import type { IAgentAdapter } from '@ptah-extension/shared';
import { AgentMessageRouter } from './agent-message-router.service';
import { AgentOutputBuffer } from './agent-output-buffer.service';
import { AgentProcessManager } from './agent-process-manager.service';
import { AgentReportRouter } from './agent-report-router.service';
import { AgentSpawnEnvironment } from './agent-spawn-environment.service';
import type { CliAdapter, SdkHandle } from './cli-adapters/cli-adapter.interface';
import {
  CodexAppServerLaneAdapter, type CodexLaneIdentityStore,
  type CodexLaneProfileResolver, type CodexLaneRuntimeProvider,
} from './cli-adapters/codex/codex-app-server-lane.adapter';
import type { CodexLaneBinaryProbe } from './cli-adapters/codex/codex-app-server-lane-binary';
import type { CodexLaneCredentialProbe } from './cli-adapters/codex/codex-app-server-lane-auth';
import { LaneCompletionNotifier } from './lane-completion-notifier.service';
import { LaneResumeGate } from './lane-resume-gate';

const ROOT = resolve(tmpdir(), 'ptah-native-lane-activation');
const PARENT = '11111111-2222-4333-8444-555555555555';
const THREAD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const owner: QuotaOwnerRef = {
  key: 'openai-codex#account:0123456789abcdef',
  providerId: 'openai-codex', identityKind: 'account', label: 'Codex account',
};

interface FakeHandle {
  readonly handle: SdkHandle;
  finish(code: number): void;
  segment(segment: CliOutputSegment): void;
}

function fakeHandle(): FakeHandle {
  let finish: (code: number) => void = () => undefined;
  const done = new Promise<number>((resolveDone) => { finish = resolveDone; });
  const outputListeners: Array<(text: string) => void> = [];
  const segmentListeners: Array<(segment: CliOutputSegment) => void> = [];
  const abort = new AbortController();
  abort.signal.addEventListener('abort', () => finish(1), { once: true });
  return {
    handle: {
      abort, done, onOutput: (listener) => outputListeners.push(listener),
      onSegment: (listener) => segmentListeners.push(listener),
      getSessionId: () => THREAD,
      supportsContinuation: () => true,
      getLanePolicyDelivery: () => 'developer-instructions',
      getRoleDelivery: () => 'developer-instructions',
    },
    finish,
    segment: (segment) => segmentListeners.forEach((listener) => listener(segment)),
  };
}

interface ActivationHarness {
  readonly manager: AgentProcessManager;
  readonly gate: LaneResumeGate;
  readonly router: AgentReportRouter;
  readonly notifier: LaneCompletionNotifier;
  readonly adapter: CliAdapter;
  readonly handles: FakeHandle[];
  readonly rolloutRead: jest.Mock;
  readonly ledger: {
    readonly recordSuccess: jest.Mock;
    readonly recordOwnerEvidence: jest.Mock;
    readonly recordWindowEvidence: jest.Mock;
  };
  readonly chatSend: jest.Mock;
  readonly disk: Map<string, { size: number; mtime: number }>;
  readonly laneOwner: jest.Mock;
  readonly loggerInfo: jest.Mock;
}

function activationHarness(adapterOverride?: CliAdapter): ActivationHarness {
  type ManagerArgs = ConstructorParameters<typeof AgentProcessManager>;
  type EnvironmentArgs = ConstructorParameters<typeof AgentSpawnEnvironment>;
  type NotifierArgs = ConstructorParameters<typeof LaneCompletionNotifier>;
  type GateArgs = ConstructorParameters<typeof LaneResumeGate>;
  const logger = Object.assign(Object.create(null), {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  }) as ManagerArgs[0];
  const handles: FakeHandle[] = [];
  const adapter: CliAdapter = {
    name: 'codex', displayName: 'Codex', roleChannel: 'developer-instructions',
    supportsMcp: false,
    detect: async () => ({
      cli: 'codex', installed: true, path: resolve(ROOT, 'codex-stub'),
      version: '0.165.0', messagingMode: 'queue',
    }),
    capabilities: () => ({ steer: false, interrupt: false, continuation: true }),
    parseOutput: (raw) => raw,
    runSdk: jest.fn(async () => {
      const next = fakeHandle();
      handles.push(next);
      return next.handle;
    }),
  };
  const detection = Object.assign(Object.create(null), {
    getAdapter: jest.fn(() => adapterOverride ?? adapter),
    getDetection: jest.fn(() => (adapterOverride ?? adapter).detect()),
  }) as ManagerArgs[1];
  const workspace = Object.assign(Object.create(null), {
    getWorkspaceRoot: jest.fn(() => ROOT),
    getWorkspaceFolders: jest.fn(() => [ROOT]),
    getConfiguration: jest.fn((_section: string, _key: string, fallback?: unknown) => fallback),
  }) as EnvironmentArgs[2];
  const reasoning = Object.assign(Object.create(null), {
    effort: { get: jest.fn(() => '') },
  }) as EnvironmentArgs[3];
  const sentry = Object.assign(Object.create(null), {
    captureException: jest.fn(),
  }) as ManagerArgs[3];
  const registry = Object.assign(Object.create(null), {
    getRunningBySession: jest.fn(() => []), update: jest.fn(),
  }) as ManagerArgs[2];
  const environment = new AgentSpawnEnvironment(
    logger, detection, workspace, reasoning, sentry, null, null, null,
  );
  jest.spyOn(environment, 'validateWorkingDirectory').mockResolvedValue();
  const disk = new Map<string, { size: number; mtime: number }>();
  const fileSystem = Object.assign(Object.create(null), {
    exists: jest.fn(async (path: string) => disk.has(path)),
    stat: jest.fn(async (path: string) => {
      const entry = disk.get(path);
      if (!entry) throw new Error(`Missing fixture: ${path}`);
      return entry;
    }),
  }) as NotifierArgs[1];
  const chatSend = jest.fn(async () => undefined);
  const chat = Object.assign(Object.create(null), {
    isSessionActive: jest.fn(() => true), sendMessageToSession: chatSend,
  }) as IAgentAdapter;
  const notifier = new LaneCompletionNotifier(logger, fileSystem, chat);
  const rolloutRead = jest.fn(async () => ({
    file: resolve(ROOT, 'rollout.jsonl'),
    lastRequestInputTokens: 20_000,
    modifiedAtMs: Date.now(),
  }));
  const output = Object.assign(Object.create(null), { appendLine: jest.fn() }) as GateArgs[0];
  const gate = new LaneResumeGate(output, rolloutRead, Date.now);
  const laneOwner = jest.fn<QuotaOwnerRef | undefined, [string, string?]>(() => owner);
  const owners = Object.assign(Object.create(null), {
    ownerForLane: laneOwner, rememberLaneOwner: jest.fn(),
  }) as ManagerArgs[9];
  const ledger = {
    recordSuccess: jest.fn(), recordOwnerEvidence: jest.fn(),
    recordWindowEvidence: jest.fn(),
  };
  const manager = new AgentProcessManager(
    logger, detection, registry, sentry,
    new AgentMessageRouter(logger, detection), environment,
    new AgentOutputBuffer(logger), notifier, gate, owners,
    Object.assign(Object.create(null), ledger) as ManagerArgs[10],
  );
  return {
    manager, gate, router: new AgentReportRouter(logger, manager, chat),
    notifier, adapter: adapterOverride ?? adapter, handles, rolloutRead, ledger, chatSend, disk,
    laneOwner, loggerInfo: logger.info as jest.Mock,
  };
}

async function settled(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

class NativeContext implements CodexContext {
  readonly turnPermissionLevel = 'ask' as const;
  readonly identity: CodexThreadIdentity;
  readonly close = jest.fn(async () => undefined);
  private readonly queue: CodexRuntimeEvent[] = [];
  private wake: () => void = () => undefined;

  constructor(profile: CodexExecutionProfile, resume?: CodexThreadIdentity) {
    this.identity = resume ?? {
      threadId: THREAD, contextId: profile.contextId, processGeneration: 1,
      normalizedHome: profile.normalizedHome, workspaceId: profile.workspaceId,
      providerId: profile.providerId, profileFingerprint: profile.profileFingerprint,
    };
  }

  async listModels(): Promise<CodexModelInfo[]> { return []; }
  async *events(signal: AbortSignal): AsyncIterable<CodexRuntimeEvent> {
    while (!signal.aborted) {
      if (this.queue.length === 0) {
        await new Promise<void>((resolveWait) => {
          const onAbort = (): void => resolveWait();
          this.wake = (): void => {
            signal.removeEventListener('abort', onAbort);
            resolveWait();
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      if (signal.aborted) return;
      const event = this.queue.shift();
      if (event) yield event;
    }
  }
  async startTurn(_input: CodexTurnInput): Promise<CodexTurnReceipt> {
    return { threadId: this.identity.threadId, turnId: 'turn-1', revision: 1 };
  }
  async steer(input: CodexTurnInput): Promise<CodexTurnReceipt> { return this.startTurn(input); }
  async interrupt(): Promise<boolean> { return false; }
  async updateNextTurn() { return { timing: 'nextTurn' as const, revision: 1 }; }
  async compact(): Promise<void> { return undefined; }
  terminal(inputTokens: number): void {
    this.queue.push({
      type: 'terminal', contextId: this.identity.contextId,
      processGeneration: this.identity.processGeneration, threadId: this.identity.threadId,
      turnId: 'turn-1', sequence: 100, status: 'completed',
      usage: { inputTokens, outputTokens: 7, cachedInputTokens: 2 },
    });
    this.wake();
  }
}

function nativeAdapter(home: string, workDirectory: string) {
  const platform = process.platform === 'win32' ? 'win32' : 'posix';
  const normalizedHome = normalizeCodexHomeKey(home, platform);
  const contexts: NativeContext[] = [];
  const paths: CodexExecutionProfileInput['paths'] = {
    platform, baseDirectory: workDirectory,
    entries: {
      [resolve(normalizedHome)]: { kind: 'directory', realpath: home },
      [resolve(workDirectory)]: { kind: 'directory', realpath: workDirectory },
    },
  };
  const profiles: CodexLaneProfileResolver = {
    resolve: jest.fn(async (_request, variant) => ({
      paths,
      lane: {
        permissionLevel: 'ask' as const,
        identity: {
          contextId: 'native-context', normalizedHome, providerId: 'codex',
          workspaceId: normalizeCodexWorkspaceKey(workDirectory, platform), model: 'gpt-test',
        },
        config: {
          variant, workingDirectory: workDirectory,
          autoCompactTokens: 120000, toolOutputTokenLimit: 2500,
          webSearch: true, userMcpServerNames: ['user-server'],
        },
      },
    })),
  };
  const identities = new Map<string, CodexThreadIdentity>();
  const identityStore: CodexLaneIdentityStore = {
    readByThreadId: jest.fn(async (id) => identities.get(id)),
    persist: jest.fn(async (identity) => { identities.set(identity.threadId, identity); }),
  };
  const runtime: CodexLaneRuntimeProvider = {
    open: jest.fn(async (profile, resume) => {
      const context = new NativeContext(profile, resume);
      contexts.push(context);
      return context;
    }),
    openCatalog: jest.fn(async () => { throw new Error('No catalog in activation fixture'); }),
  };
  const binary: CodexLaneBinaryProbe = {
    resolve: jest.fn(async () => ({ path: resolve(home, 'codex-test'), version: '0.165.0' })),
  };
  const credentials: CodexLaneCredentialProbe = { check: jest.fn(async () => 'fresh' as const) };
  type ManagerArgs = ConstructorParameters<typeof AgentProcessManager>;
  const logger = Object.assign(Object.create(null), {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  }) as ManagerArgs[0];
  return {
    adapter: new CodexAppServerLaneAdapter(
      runtime, profiles, identityStore, logger, binary, credentials, async () => home,
    ),
    runtime, contexts,
  };
}

describe('native Codex lane activation at the manager boundary', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-31T12:00:00Z') }));
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('carries native terminal usage through the manager gate and ledger, then routes an attributed report', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ptah-native-activation-'));
    try {
      mkdirSync(join(fixtureRoot, 'home'));
      mkdirSync(join(fixtureRoot, 'work'));
      const home = realpathSync(join(fixtureRoot, 'home'));
      const workDirectory = realpathSync(join(fixtureRoot, 'work'));
      const native = nativeAdapter(home, workDirectory);
      const h = activationHarness(native.adapter);
      const first = await h.manager.spawn({
        task: 'native first turn', cli: 'codex', workingDirectory: workDirectory,
        parentSessionId: PARENT, model: 'gpt-test',
      });
      expect(native.runtime.open).toHaveBeenCalledTimes(1);
      const routed = await h.router.deliver({
        agentId: first.agentId, message: 'Native lane report',
      });
      expect(routed).toEqual({ delivered: true, parentSessionId: PARENT });
      expect(h.chatSend).toHaveBeenCalledWith(
        PARENT, expect.stringContaining('Native lane report'), expect.anything(),
      );
      native.contexts[0].terminal(200_000);
      await settled();
      expect(h.manager.findAgentInfo(first.agentId)?.status).toBe('completed');
      expect(h.manager.findAgentInfo(first.agentId)?.lastRequestContext?.tokens).toBe(200_000);
      expect(h.ledger.recordSuccess).toHaveBeenCalledWith(expect.objectContaining({
        ownerKey: owner.key, modelScopes: ['gpt-test'],
      }));

      const resumed = await h.manager.spawn({
        task: 'native resumed turn', cli: 'codex', workingDirectory: workDirectory,
        resumeSessionId: THREAD,
      });
      expect(h.rolloutRead).toHaveBeenCalledWith(THREAD);
      expect(h.loggerInfo).toHaveBeenCalledWith('[AgentProcessManager] Resume gate',
        expect.objectContaining({ contextTokens: 20_000, source: 'rollout', decision: 'resume' }));
      expect(resumed.resumeDecision?.decision).toBe('resumed');
      expect(native.runtime.open).toHaveBeenCalledTimes(2);
      expect(native.runtime.open).toHaveBeenLastCalledWith(
        expect.objectContaining({ consumer: 'lane' }),
        expect.objectContaining({ threadId: THREAD }),
        expect.anything(), expect.any(String),
      );
      native.contexts[1].terminal(10);
      await settled();
      expect(h.manager.findAgentInfo(resumed.agentId)?.status).toBe('completed');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('uses last-request rollout usage rather than a cumulative terminal segment for resume', async () => {
    const h = activationHarness();
    const gateSpy = jest.spyOn(h.gate, 'evaluate');
    const first = await h.manager.spawn({
      task: 'first turn', cli: 'codex', workingDirectory: ROOT,
    });
    h.handles[0].segment({ type: 'info', content: '', usage: {
      inputTokens: 200_000, outputTokens: 1, cacheReadTokens: 0,
    } });
    h.handles[0].finish(0);
    await settled();
    expect(h.manager.findAgentInfo(first.agentId)?.lastRequestContext?.tokens).toBe(200_000);

    const next = await h.manager.spawn({
      task: 'second turn', cli: 'codex', workingDirectory: ROOT, resumeSessionId: THREAD,
    });
    expect(h.rolloutRead).toHaveBeenCalledWith(THREAD);
    expect(next.resumeDecision?.decision).toBe('resumed');
    expect(await gateSpy.mock.results[0].value).toMatchObject({
      decision: 'resume', contextTokens: 20_000, source: 'rollout',
    });
    expect(h.loggerInfo).toHaveBeenCalledWith('[AgentProcessManager] Resume gate',
      expect.objectContaining({ contextTokens: 20_000, source: 'rollout', decision: 'resume' }));
    expect(h.adapter.runSdk).toHaveBeenLastCalledWith(expect.objectContaining({
      resumeSessionId: THREAD,
    }));
    h.handles[1].finish(0);
    await settled();
    h.rolloutRead.mockResolvedValue({
      file: resolve(ROOT, 'rollout.jsonl'), lastRequestInputTokens: 160_000,
      modifiedAtMs: Date.now(),
    });
    const fresh = await h.manager.spawn({
      task: 'third turn', cli: 'codex', workingDirectory: ROOT, resumeSessionId: THREAD,
    });
    expect(fresh.resumeDecision?.decision).toBe('fresh');
    expect(await gateSpy.mock.results[1].value).toMatchObject({
      decision: 'fresh', contextTokens: 160_000, source: 'rollout',
    });
    expect(h.loggerInfo).toHaveBeenCalledWith('[AgentProcessManager] Resume gate',
      expect.objectContaining({ contextTokens: 160_000, source: 'rollout', decision: 'fresh' }));
    expect(h.adapter.runSdk).toHaveBeenLastCalledWith(expect.objectContaining({
      resumeSessionId: undefined,
    }));
    h.handles[2].finish(0);
    await settled();
  });

  it('records completed usage, failed, stopped and usage-unknown outcomes in the shared manager contract', async () => {
    const h = activationHarness();
    const completed = await h.manager.spawn({
      task: 'complete', cli: 'codex', workingDirectory: ROOT, model: 'gpt-test',
    });
    h.handles[0].segment({ type: 'info', content: '', usage: {
      inputTokens: 35, outputTokens: 8, cacheReadTokens: 3,
    } });
    h.handles[0].finish(0);
    await settled();
    expect(h.manager.findAgentInfo(completed.agentId)?.status).toBe('completed');
    expect(h.manager.findAgentInfo(completed.agentId)?.lastRequestContext?.tokens).toBe(35);
    expect(h.ledger.recordSuccess).toHaveBeenCalledWith(expect.objectContaining({
      ownerKey: owner.key, billing: 'unknown', modelScopes: ['gpt-test'],
    }));

    const failed = await h.manager.spawn({
      task: 'fail', cli: 'codex', workingDirectory: ROOT,
    });
    h.handles[1].segment({ type: 'error', content: 'Codex usage limit reached.' });
    h.handles[1].finish(1);
    await settled();
    expect(h.manager.findAgentInfo(failed.agentId)?.status).toBe('failed');
    expect(h.ledger.recordOwnerEvidence).toHaveBeenCalledWith(owner, expect.anything());
    expect(h.ledger.recordWindowEvidence).not.toHaveBeenCalled();

    const stopped = await h.manager.spawn({
      task: 'stop', cli: 'codex', workingDirectory: ROOT,
    });
    await h.manager.stop(stopped.agentId);
    await settled();
    expect(h.manager.findAgentInfo(stopped.agentId)?.status).toBe('stopped');
    expect(h.ledger.recordSuccess).toHaveBeenCalledTimes(1);
    expect(h.ledger.recordOwnerEvidence).toHaveBeenCalledTimes(1);

    const unknownUsage = await h.manager.spawn({
      task: 'known owner without usage', cli: 'codex', workingDirectory: ROOT,
    });
    h.handles[3].finish(0);
    await settled();
    expect(h.manager.findAgentInfo(unknownUsage.agentId)?.lastRequestContext).toBeUndefined();
    expect(h.ledger.recordSuccess).toHaveBeenCalledTimes(2);

    h.laneOwner.mockReturnValue(undefined);
    const unknown = await h.manager.spawn({
      task: 'unknown owner', cli: 'codex', workingDirectory: ROOT,
    });
    h.handles[4].finish(0);
    await settled();
    expect(h.manager.findAgentInfo(unknown.agentId)?.status).toBe('completed');
    expect(h.ledger.recordSuccess).toHaveBeenCalledTimes(2);
    expect(h.ledger.recordWindowEvidence).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined, 'no-deliverable'],
    ['empty', 0, 'no-deliverable'],
    ['valid', 24, 'delivered'],
  ] as const)('attributes a native report and checks a %s deliverable after exit',
    async (_state, size, verdict) => {
      const h = activationHarness();
      const reportPath = resolve(ROOT, 'report.md');
      if (size !== undefined) h.disk.set(reportPath, { size, mtime: Date.now() });
      const spawned = await h.manager.spawn({
        task: 'write report', cli: 'codex', workingDirectory: ROOT,
        parentSessionId: PARENT, deliverables: ['report.md'],
      });
      expect(h.adapter.runSdk).toHaveBeenCalledWith(expect.objectContaining({
        agentId: spawned.agentId,
      }));
      const delivered = await h.router.deliver({
        agentId: spawned.agentId, message: 'The report is ready.',
      });
      expect(delivered).toEqual({ delivered: true, parentSessionId: PARENT });
      expect(h.chatSend).toHaveBeenCalledWith(
        PARENT, expect.stringContaining('The report is ready.'), expect.anything(),
      );
      const signalSpy = jest.spyOn(h.notifier, 'signal');
      h.handles[0].finish(0);
      await settled();
      expect(h.manager.findAgentInfo(spawned.agentId)?.status).toBe('completed');
      expect(signalSpy).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: spawned.agentId, status: 'completed' }),
        expect.objectContaining({ reportsDelivered: 1 }),
      );
      const completion = await signalSpy.mock.results[0].value;
      expect(completion.delivered).toBe(true);
      if (!completion.delivered) throw new Error('Missing native lane completion signal');
      expect(completion.signal.verdict).toBe(verdict);
      expect(completion.signal.reportsDelivered).toBe(1);
      expect(completion.signal.deliverables[0]).toMatchObject({
        path: reportPath, exists: size !== undefined,
      });
    });
});
