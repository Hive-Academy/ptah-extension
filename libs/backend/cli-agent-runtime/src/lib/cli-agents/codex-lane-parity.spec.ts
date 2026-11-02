import 'reflect-metadata';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildCodexExecutionProfile,
  normalizeCodexHomeKey,
  normalizeCodexWorkspaceKey,
  type ApprovalSink,
  type CodexContext,
  type CodexExecutionProfile,
  type CodexExecutionProfileInput,
  type CodexModelInfo,
  type CodexRuntimeEvent,
  type CodexThreadIdentity,
  type CodexTurnInput,
  type CodexTurnReceipt,
} from '@ptah-extension/codex-runtime';
import type { CliOutputSegment } from '@ptah-extension/shared';
import { Logger } from '@ptah-extension/vscode-core';
import type { CliCommandOptions } from './cli-adapters/cli-adapter.interface';
import { bestMessagingCapability } from './cli-adapters/cli-adapter.interface';
import {
  CodexAppServerLaneAdapter,
  type CodexLaneIdentityStore,
  type CodexLaneProfileResolver,
  type CodexLaneRuntimeProvider,
} from './cli-adapters/codex/codex-app-server-lane.adapter';
import type { CodexLaneBinaryProbe } from './cli-adapters/codex/codex-app-server-lane-binary';
import type {
  CodexLaneCredentialProbe,
  CodexLaneCredentialStatus,
} from './cli-adapters/codex/codex-app-server-lane-auth';
import type { CodexLaneProfileInput } from './cli-adapters/codex/codex-lane-profile';
import { renderLaneCompletionContract } from './lane-reporting-contract';

const platform = process.platform === 'win32' ? 'win32' : 'posix';
let fixtureRoot: string;
let home: string;
let cwd: string;
let normalizedHome: string;
let workspaceId: string;
let paths: CodexExecutionProfileInput['paths'];

function pathSnapshot(workDirectory: string): CodexExecutionProfileInput['paths'] {
  const realWorkDirectory = realpathSync(workDirectory);
  return {
    platform,
    baseDirectory: realWorkDirectory,
    entries: {
      [resolve(normalizedHome)]: { kind: 'directory', realpath: home },
      [resolve(realWorkDirectory)]: { kind: 'directory', realpath: realWorkDirectory },
    },
  };
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ptah-codex-parity-'));
  mkdirSync(join(fixtureRoot, 'home'));
  mkdirSync(join(fixtureRoot, 'work'));
  home = realpathSync(join(fixtureRoot, 'home'));
  cwd = realpathSync(join(fixtureRoot, 'work'));
  normalizedHome = normalizeCodexHomeKey(home, platform);
  workspaceId = normalizeCodexWorkspaceKey(cwd, platform);
  paths = pathSnapshot(cwd);
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function options(overrides: Partial<CliCommandOptions> = {}): CliCommandOptions {
  return {
    task: 'write the parity report', workingDirectory: cwd,
    agentId: 'lane-parity', mcpPort: 51820, ...overrides,
  };
}

interface LaneFixture {
  readonly contextId: string;
  readonly workingDirectory: string;
  readonly permissionLevel: CodexLaneProfileInput['permissionLevel'];
  readonly userMcpServerNames: readonly string[];
}

function lane(variant: 'first-turn' | 'resume', fixture?: LaneFixture): CodexLaneProfileInput {
  const workDirectory = fixture?.workingDirectory ?? cwd;
  return {
    permissionLevel: fixture?.permissionLevel ?? 'ask',
    identity: {
      contextId: fixture?.contextId ?? 'lane-context', normalizedHome,
      providerId: 'codex', workspaceId: normalizeCodexWorkspaceKey(workDirectory, platform),
      model: 'gpt-test',
    },
    config: {
      variant, workingDirectory: workDirectory, autoCompactTokens: 120000,
      toolOutputTokenLimit: 2500, webSearch: true,
      userMcpServerNames: [...(fixture?.userMcpServerNames ?? ['user-server'])],
    },
  };
}

// This local context stands in for the App Server event seam. No process or model is started.
class FakeContext implements CodexContext {
  readonly turnPermissionLevel = 'ask' as const;
  readonly identity: CodexThreadIdentity;
  readonly inputs: CodexTurnInput[] = [];
  readonly close = jest.fn(async () => undefined);
  private readonly queue: CodexRuntimeEvent[] = [];
  private wake: () => void = () => undefined;
  private turnNumber = 0;

  constructor(profile: CodexExecutionProfile, resume?: CodexThreadIdentity) {
    this.identity = resume ?? {
      threadId: profile.contextId === 'lane-context'
        ? 'thread-parity' : `thread-${profile.contextId}`,
      contextId: profile.contextId,
      processGeneration: 1, normalizedHome: profile.normalizedHome,
      workspaceId: profile.workspaceId, providerId: profile.providerId,
      profileFingerprint: profile.profileFingerprint,
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
  async startTurn(input: CodexTurnInput): Promise<CodexTurnReceipt> {
    this.inputs.push(input);
    this.turnNumber += 1;
    return {
      threadId: this.identity.threadId,
      turnId: `turn-${this.turnNumber}`,
      revision: this.turnNumber,
    };
  }
  async steer(input: CodexTurnInput): Promise<CodexTurnReceipt> { return this.startTurn(input); }
  async interrupt(): Promise<boolean> { return false; }
  async updateNextTurn() { return { timing: 'nextTurn' as const, revision: 1 }; }
  async compact(): Promise<void> { return undefined; }
  push(event: CodexRuntimeEvent): void { this.queue.push(event); this.wake(); }
  text(turnId: string, sequence: number, delta: string): void {
    this.push({ type: 'textDelta', contextId: this.identity.contextId,
      processGeneration: this.identity.processGeneration, threadId: this.identity.threadId,
      turnId, sequence, itemId: 'answer', delta });
  }
  terminal(turnId: string, status: 'completed' | 'failed'): void {
    this.push({ type: 'terminal', contextId: this.identity.contextId,
      processGeneration: this.identity.processGeneration, threadId: this.identity.threadId,
      turnId, sequence: 100, status,
      usage: { inputTokens: 13, outputTokens: 5, cachedInputTokens: 3 } });
  }
}

function harness(fixture?: LaneFixture, laneFixtures?: Readonly<Record<string, LaneFixture>>) {
  const stored = new Map<string, CodexThreadIdentity>();
  let context: FakeContext | undefined;
  let openedProfile: CodexExecutionProfile | undefined;
  let resumeArg: CodexThreadIdentity | undefined;
  let approvals: ApprovalSink | undefined;
  const contexts: FakeContext[] = [];
  const profiles: CodexLaneProfileResolver = {
    resolve: jest.fn(async (request, variant) => {
      const selected = laneFixtures?.[request.agentId ?? ''] ?? fixture;
      return {
        lane: lane(variant, selected),
        paths: selected ? pathSnapshot(selected.workingDirectory) : paths,
      };
    }),
  };
  const identities: CodexLaneIdentityStore = {
    readByThreadId: jest.fn(async (threadId) => stored.get(threadId)),
    persist: jest.fn(async (identity) => { stored.set(identity.threadId, identity); }),
  };
  const runtime: CodexLaneRuntimeProvider = {
    open: jest.fn(async (profile, resume, sink) => {
      openedProfile = profile;
      resumeArg = resume;
      approvals = sink;
      context = new FakeContext(profile, resume);
      contexts.push(context);
      return context;
    }),
    openCatalog: jest.fn(async () => {
      throw new Error('catalog is outside this proof');
    }),
  };
  const binary: CodexLaneBinaryProbe = {
    resolve: jest.fn(async () => ({ path: resolve(tmpdir(), 'codex-test-binary'), version: '0.165.0' })),
  };
  const credentials: CodexLaneCredentialProbe = {
    check: jest.fn(async (): Promise<CodexLaneCredentialStatus> => 'fresh'),
  };
  const logger = Object.create(Logger.prototype) as Logger;
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const adapter = new CodexAppServerLaneAdapter(
    runtime, profiles, identities, logger, binary, credentials, async () => home,
  );
  return {
    adapter, runtime, identities, contexts,
    get context() { if (!context) throw new Error('context not opened'); return context; },
    get profile() { if (!openedProfile) throw new Error('profile not opened'); return openedProfile; },
    get resumeArg() { return resumeArg; },
    get approvals() { if (!approvals) throw new Error('approvals not opened'); return approvals; },
  };
}

describe('native Codex lane parity at the CliAdapter boundary', () => {
  it('projects one spawn through terminal into legacy SdkHandle output, status and session fields', async () => {
    const h = harness();
    const handle = await h.adapter.runSdk(options({ model: 'gpt-test' }));
    const output: string[] = [];
    const segments: CliOutputSegment[] = [];
    handle.onOutput((line) => output.push(line));
    handle.onSegment?.((segment) => segments.push(segment));
    expect(handle.getSessionId?.()).toBe('thread-parity');
    expect(handle.getLanePolicyDelivery?.()).toBe('developer-instructions');
    expect(handle.getRoleDelivery?.()).toBe('developer-instructions');
    expect(handle.supportsContinuation?.()).toBe(true);
    expect(h.profile.model).toBe('gpt-test');
    expect(h.context.inputs[0]?.text).toContain('write the parity report');
    h.context.text('turn-1', 1, 'Hello');
    h.context.push({ type: 'toolStarted', contextId: h.context.identity.contextId,
      processGeneration: 1, threadId: 'thread-parity', turnId: 'turn-1', sequence: 2,
      toolId: 'tool-1', toolName: 'read_file', input: {} });
    h.context.push({ type: 'toolCompleted', contextId: h.context.identity.contextId,
      processGeneration: 1, threadId: 'thread-parity', turnId: 'turn-1', sequence: 3,
      toolId: 'tool-1', output: 'ok', status: 'completed' });
    h.context.terminal('turn-1', 'completed');
    expect(await handle.done).toBe(0);
    expect(output.join('')).toContain('Hello');
    expect(segments.map((segment) => segment.type)).toEqual([
      'text', 'tool-call', 'tool-result', 'info',
    ]);
    expect(segments.filter((segment) => segment.usage)).toEqual([
      expect.objectContaining({ usage: {
        inputTokens: 13, outputTokens: 5, cacheReadTokens: 3,
      } }),
    ]);
    handle.abort.abort();
  });

  it('resumes a stored lane identity, queues the next turn, and aborts with failure status', async () => {
    const h = harness();
    expect(h.adapter.capabilities()).toEqual({ steer: false, interrupt: false, continuation: true });
    expect(bestMessagingCapability(h.adapter.capabilities())).toBe('queue');
    const first = await h.adapter.runSdk(options());
    h.context.terminal('turn-1', 'completed');
    expect(await first.done).toBe(0);
    const queued = await first.continue?.('queued follow-up');
    expect(h.context.inputs[1]?.text).toContain('queued follow-up');
    h.context.terminal('turn-2', 'completed');
    expect(await queued?.done).toBe(0);
    first.abort.abort();
    const resumed = await h.adapter.runSdk(options({ resumeSessionId: 'thread-parity' }));
    expect(h.resumeArg?.threadId).toBe('thread-parity');
    expect(h.profile.consumer).toBe('lane');
    expect(resumed.getSessionId?.()).toBe('thread-parity');
    resumed.abort.abort();
    expect(await resumed.done).toBe(1);
    await Promise.resolve();
    expect(h.context.close).toHaveBeenCalledTimes(1);
  });

  it('keeps lane contexts and policy separate from a chat profile on the same home', async () => {
    const h = harness();
    const chatProfile = buildCodexExecutionProfile({
      session: {
        contextId: 'chat-context', consumer: 'chat', normalizedHome,
        providerId: 'codex', workspaceId, cwd, model: 'gpt-test', permissionLevel: 'plan',
      }, paths,
    });
    const chatContext = new FakeContext(chatProfile);
    const first = await h.adapter.runSdk(options());
    expect(h.context).not.toBe(chatContext);
    expect(h.profile.consumer).toBe('lane');
    expect(h.profile.sandboxPolicy).toEqual({
      mode: 'workspace-write', networkAccess: false, writableRoots: [cwd],
    });
    expect(h.profile.approvalPolicy).toBe('never');
    expect(chatProfile.consumer).toBe('chat');
    expect(chatProfile.sandboxPolicy.mode).toBe('read-only');
    expect(chatProfile.contextId).toBe('chat-context');
    h.context.terminal('turn-1', 'completed');
    expect(await first.done).toBe(0);
    first.abort.abort();
    const second = await h.adapter.runSdk(options());
    expect(h.context).not.toBe(h.contexts[0]);
    expect(h.context).not.toBe(chatContext);
    expect(chatProfile.sandboxPolicy.mode).toBe('read-only');
    second.abort.abort();
    expect(await second.done).toBe(1);
  });

  it('keeps two same-home lane configurations separate across follow-up turns and reopen', async () => {
    mkdirSync(join(fixtureRoot, 'other-work'));
    const otherWork = realpathSync(join(fixtureRoot, 'other-work'));
    const h = harness(undefined, {
      'agent-a': { contextId: 'lane-a', workingDirectory: cwd,
        permissionLevel: 'ask', userMcpServerNames: ['alpha-server'] },
      'agent-b': { contextId: 'lane-b', workingDirectory: otherWork,
        permissionLevel: 'plan', userMcpServerNames: ['beta-server'] },
    });
    const aOptions = options({ agentId: 'agent-a', role: {
      name: 'Alpha', body: 'Alpha instructions', sourcePath: '/alpha.md', bytes: 18,
    } });
    const bOptions = options({ agentId: 'agent-b', workingDirectory: otherWork, role: {
      name: 'Beta', body: 'Beta instructions', sourcePath: '/beta.md', bytes: 17,
    } });
    const firstA = await h.adapter.runSdk(aOptions);
    const contextA = h.context;
    const firstB = await h.adapter.runSdk(bOptions);
    const contextB = h.context;
    const open = h.runtime.open as jest.MockedFunction<CodexLaneRuntimeProvider['open']>;
    const profileA = open.mock.calls[0][0];
    const profileB = open.mock.calls[1][0];
    expect(contextA).not.toBe(contextB);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0][1]).toBeUndefined();
    expect(open.mock.calls[1][1]).toBeUndefined();
    expect(profileA.normalizedHome).toBe(profileB.normalizedHome);
    expect(profileA.cwd).toBe(cwd);
    expect(profileB.cwd).toBe(otherWork);
    expect(profileA.permissionLevel).toBe('ask');
    expect(profileB.permissionLevel).toBe('plan');
    expect(profileA.lane?.disabledUserMcpServers).toEqual(['alpha-server']);
    expect(profileB.lane?.disabledUserMcpServers).toEqual(['beta-server']);
    expect(profileA.developerPrompt).toContain('Alpha instructions');
    expect(profileB.developerPrompt).toContain('Beta instructions');
    expect(profileA.developerPrompt).not.toContain('Beta instructions');
    expect(profileB.developerPrompt).not.toContain('Alpha instructions');
    expect(profileA.sandboxPolicy).toEqual({
      mode: 'workspace-write', networkAccess: false, writableRoots: [cwd],
    });
    expect(profileB.sandboxPolicy).toEqual({
      mode: 'workspace-write', networkAccess: false, writableRoots: [otherWork],
    });
    expect(profileA.developerPrompt).not.toContain('beta-server');
    expect(profileB.developerPrompt).not.toContain('alpha-server');
    contextA.terminal('turn-1', 'completed');
    contextB.terminal('turn-1', 'completed');
    expect(await firstA.done).toBe(0);
    expect(await firstB.done).toBe(0);

    const nextA = await firstA.continue?.('alpha follow-up');
    expect(contextA.inputs[1]?.text).toContain('alpha follow-up');
    expect(contextA.inputs[1]?.text).not.toContain('Beta instructions');
    contextA.terminal('turn-2', 'completed');
    expect(await nextA?.done).toBe(0);

    firstA.abort.abort();
    firstB.abort.abort();
    const reopenB = await h.adapter.runSdk({
      ...bOptions, resumeSessionId: 'thread-lane-b',
    });
    const reopenedB = h.context;
    const resumedProfileB = open.mock.calls[2][0];
    expect(open).toHaveBeenCalledTimes(3);
    expect(open.mock.calls[2][1]).toMatchObject({ threadId: 'thread-lane-b', contextId: 'lane-b' });
    expect(reopenedB).not.toBe(contextB);
    expect(resumedProfileB.cwd).toBe(otherWork);
    expect(resumedProfileB.lane?.disabledUserMcpServers).toEqual(['beta-server']);
    expect(resumedProfileB.permissionLevel).toBe('plan');
    expect(resumedProfileB.developerPrompt).toContain('Beta instructions');
    expect(resumedProfileB.developerPrompt).not.toContain('Alpha instructions');
    expect(reopenedB.inputs[0]?.text).not.toContain('Alpha instructions');
    reopenedB.terminal('turn-1', 'completed');
    expect(await reopenB.done).toBe(0);
    reopenB.abort.abort();
  });

  it.each(['command', 'fileChange', 'permissions', 'mcpElicitation'] as const)(
    'declines one %s sink request and emits one kind-and-name line', async (kind) => {
      const h = harness();
      const handle = await h.adapter.runSdk(options());
      const lines: string[] = [];
      handle.onOutput((line) => lines.push(line));
      const decision = await h.approvals.request({
        kind, contextId: h.context.identity.contextId, processGeneration: 1,
        threadId: 'thread-parity', turnId: 'turn-1', requestId: 'request-1',
        normalizedHome, workspaceId, providerId: 'codex', toolName: 'safe_tool',
        message: 'secret command', details: { command: 'secret command', cwd },
      }, handle.abort.signal);
      expect(decision).toBe('decline');
      expect(lines).toEqual([`Codex approval declined: ${kind} safe_tool\n`]);
      expect(lines.join('')).not.toContain('secret command');
      expect(lines.join('')).not.toContain(cwd);
      h.context.terminal('turn-1', 'completed');
      expect(await handle.done).toBe(0);
      handle.abort.abort();
    },
  );

  it('keeps the report and deliverable contract in the task and Ptah MCP in the profile', async () => {
    const h = harness({
      contextId: 'lane-context', workingDirectory: cwd,
      permissionLevel: 'ask', userMcpServerNames: ['user-server', 'ptah'],
    });
    const deliverable = resolve(tmpdir(), 'ptah-codex-parity-proof.md');
    const request = options({ taskFolder: cwd, deliverables: [deliverable] });
    const handle = await h.adapter.runSdk(request);
    const contract = renderLaneCompletionContract(request);
    expect(h.context.inputs[0]?.text).toContain(contract);
    expect(h.context.inputs[0]?.text).toContain('ptah_agent_report');
    expect(h.context.inputs[0]?.text).toContain(deliverable);
    expect(h.profile.mcpServers).toEqual([
      expect.objectContaining({ name: 'ptah', url: expect.stringContaining('/agent/lane-parity') }),
    ]);
    expect(h.profile.lane?.disabledUserMcpServers).toContain('user-server');
    expect(h.profile.lane?.disabledUserMcpServers).not.toContain('ptah');
    h.context.terminal('turn-1', 'completed');
    expect(await handle.done).toBe(0);
    handle.abort.abort();
  });

  it('has no Codex SDK import in the native adapter or host lane compositions', () => {
    const root = resolve(__dirname, '../../../../../..');
    const files = [
      'libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts',
      'apps/ptah-electron/src/di/codex-lane-composition.ts',
      'libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts',
      'apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/(?:from\s*|import\s*\()\s*['"]@openai\/codex-sdk['"]/);
    }
  });
});
