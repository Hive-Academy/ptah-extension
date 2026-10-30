import 'reflect-metadata';
import {
  buildCodexExecutionProfile,
  CodexPreTurnConfigRejectedError,
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
import type { CliOutputSegment, ProviderAccountBinding } from '@ptah-extension/shared';
import { Logger } from '@ptah-extension/vscode-core';
import type { CliCommandOptions, CliModelInfo } from '../cli-adapter.interface';
import {
  CodexAppServerLaneAdapter,
  CodexLaneResumeIdentityError,
  type CodexLaneIdentityStore,
  type CodexLaneProfileResolver,
  type CodexLaneRuntimeProvider,
} from './codex-app-server-lane.adapter';
import type { CodexLaneBinaryProbe } from './codex-app-server-lane-binary';
import type { CodexLaneCredentialProbe, CodexLaneCredentialStatus } from './codex-app-server-lane-auth';
import type { CodexLaneProfileInput } from './codex-lane-profile';
import { essentialLaneSession } from './codex-app-server-lane-rejection';

const paths = {
  platform: 'posix' as const,
  baseDirectory: '/',
  entries: {
    '/home': { kind: 'missing' as const },
    '/work': { kind: 'directory' as const, realpath: '/work' },
  },
};

function options(overrides: Partial<CliCommandOptions> = {}): CliCommandOptions {
  return { task: 'write report', workingDirectory: '/work', agentId: 'lane-1', mcpPort: 51820, ...overrides };
}

function lane(): CodexLaneProfileInput {
  return {
    permissionLevel: 'ask',
    identity: {
      contextId: 'lane-context', normalizedHome: '/home',
      providerId: 'codex', workspaceId: 'work', model: 'gpt-test',
    },
    config: {
      variant: 'first-turn', workingDirectory: '/work',
      autoCompactTokens: 120000, toolOutputTokenLimit: 2500,
      webSearch: true, userMcpServerNames: ['user-server'],
    },
  };
}

class FakeContext implements CodexContext {
  readonly turnPermissionLevel = 'ask' as const;
  readonly identity: CodexThreadIdentity;
  readonly inputs: CodexTurnInput[] = [];
  readonly close = jest.fn(async () => undefined);
  models: CodexModelInfo[] = [];
  private readonly queue: CodexRuntimeEvent[] = [];
  private wake: () => void = () => undefined;
  private ended = false;
  private turnNumber = 0;

  constructor(profile: CodexExecutionProfile, resume?: CodexThreadIdentity) {
    this.identity = resume ?? {
      threadId: 'thread-1', contextId: profile.contextId,
      processGeneration: 1, normalizedHome: profile.normalizedHome,
      workspaceId: profile.workspaceId, providerId: profile.providerId,
      profileFingerprint: profile.profileFingerprint,
    };
  }

  async listModels() { return this.models; }
  async *events(signal: AbortSignal): AsyncIterable<CodexRuntimeEvent> {
    while (!signal.aborted && !this.ended) {
      if (this.queue.length === 0) {
        await new Promise<void>((resolve) => {
          const onAbort = () => resolve();
          this.wake = () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      if (signal.aborted || this.ended) return;
      const event = this.queue.shift();
      if (event) yield event;
    }
  }
  async startTurn(input: CodexTurnInput): Promise<CodexTurnReceipt> {
    this.inputs.push(input);
    this.turnNumber += 1;
    return { threadId: this.identity.threadId, turnId: `turn-${this.turnNumber}`, revision: this.turnNumber };
  }
  async steer(input: CodexTurnInput) { return this.startTurn(input); }
  async interrupt() { return false; }
  async updateNextTurn() { return { timing: 'nextTurn' as const, revision: 1 }; }
  async compact() { return undefined; }
  push(event: CodexRuntimeEvent): void { this.queue.push(event); this.wake(); }
  endEvents(): void { this.ended = true; this.wake(); }
  event(turnId: string, sequence: number, part: EventPart): void {
    this.push({ ...part, contextId: this.identity.contextId,
      processGeneration: this.identity.processGeneration,
      threadId: this.identity.threadId, turnId, sequence } as CodexRuntimeEvent);
  }
}

type EventPart = CodexRuntimeEvent extends infer Event
  ? Event extends CodexRuntimeEvent
    ? Omit<Event, 'contextId' | 'processGeneration' | 'threadId' | 'turnId' | 'sequence'>
    : never
  : never;

function harness(configure?: (context: FakeContext, attempt: number) => void) {
  let context: FakeContext | undefined;
  const contexts: FakeContext[] = [];
  let openedProfile: CodexExecutionProfile | undefined;
  let approvalSink: ApprovalSink | undefined;
  let resumeArg: CodexThreadIdentity | undefined;
  let stored: CodexThreadIdentity | undefined;
  const order: string[] = [];
  const profiles: CodexLaneProfileResolver = {
    resolve: jest.fn(async (_options, variant) => {
      const source = lane();
      return { lane: { ...source, config: { ...source.config, variant } }, paths };
    }),
  };
  const identities: CodexLaneIdentityStore = {
    readByThreadId: jest.fn(async () => stored),
    persist: jest.fn(async (identity) => { stored = identity; order.push('persist'); }),
  };
  const runtime: CodexLaneRuntimeProvider = {
    open: jest.fn(async (profile, resume, approvals) => {
      openedProfile = profile;
      resumeArg = resume;
      approvalSink = approvals;
      context = new FakeContext(profile, resume);
      contexts.push(context);
      configure?.(context, contexts.length);
      order.push('open');
      return context;
    }),
    openCatalog: jest.fn(async () => {
      if (!openedProfile) throw new Error('catalog profile unavailable');
      const catalog = new FakeContext(openedProfile);
      configure?.(catalog, 0);
      return catalog;
    }),
  };
  const logger = Object.create(Logger.prototype) as Logger;
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const binary: CodexLaneBinaryProbe = {
    resolve: jest.fn(async (explicitPath?: string) => ({
      path: explicitPath ?? '/bin/codex', version: '0.165.0',
    })),
  };
  const credentials: CodexLaneCredentialProbe = {
    check: jest.fn(async (): Promise<CodexLaneCredentialStatus> => 'fresh'),
  };
  const adapter = new CodexAppServerLaneAdapter(
    runtime, profiles, identities, logger, binary, credentials,
  );
  return {
    adapter, runtime, profiles, identities, order, contexts, binary, credentials, logger,
    get context() { if (!context) throw new Error('context not opened'); return context; },
    get profile() { if (!openedProfile) throw new Error('profile not opened'); return openedProfile; },
    get approvals() { if (!approvalSink) throw new Error('sink not opened'); return approvalSink; },
    get resumeArg() { return resumeArg; },
    set stored(value: CodexThreadIdentity | undefined) { stored = value; },
  };
}

async function terminal(context: FakeContext, turnId = 'turn-1', status: 'completed' | 'failed' = 'completed'): Promise<void> {
  context.event(turnId, 100, { type: 'terminal', status, usage: { inputTokens: 13, outputTokens: 5, cachedInputTokens: 3 } });
  await Promise.resolve();
}

describe('CodexAppServerLaneAdapter', () => {
  it('opens one lane context with exact settings, projects text, tool and usage once, and reports Ptah MCP URL', async () => {
    const h = harness();
    const handle = await h.adapter.runSdk(options());
    const segments: CliOutputSegment[] = [];
    handle.onSegment?.((segment) => segments.push(segment));
    expect(h.profile.consumer).toBe('lane');
    expect(h.profile.lane).toMatchObject({ agentsEnabled: false, pluginsEnabled: false,
      appsEnabled: false, includeSkillInstructions: false, disabledUserMcpServers: ['user-server'],
      autoCompactTokens: 120000, toolOutputTokenLimit: 2500, webSearch: 'live', explicitFullAccess: false });
    expect(h.profile.sandboxPolicy).toEqual({ mode: 'workspace-write', networkAccess: false, writableRoots: ['/work'] });
    expect(h.profile.mcpServers[0]).toMatchObject({ name: 'ptah', url: expect.stringContaining('/agent/lane-1') });
    expect(handle.getSessionId?.()).toBe('thread-1');
    h.context.event('turn-1', 1, { type: 'textDelta', itemId: 'text', delta: 'Hello' });
    h.context.event('turn-1', 2, { type: 'toolStarted', toolId: 'tool-1', toolName: 'read_file', input: {} });
    h.context.event('turn-1', 3, { type: 'toolCompleted', toolId: 'tool-1', output: 'ok', status: 'completed' });
    h.context.event('turn-1', 4, { type: 'usage', usage: { inputTokens: 9 } });
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    expect(segments.map((segment) => segment.type)).toEqual(['text', 'tool-call', 'tool-result', 'info']);
    expect(segments.filter((segment) => segment.usage)).toHaveLength(1);
    handle.abort.abort();
  });

  it('keeps file context in the prompt, strips ANSI, and replays early output', async () => {
    const h = harness();
    const handle = await h.adapter.runSdk(options({ files: ['src/a.ts'] }));
    expect(h.context.inputs[0].text).toContain('src/a.ts');
    h.context.event('turn-1', 1, { type: 'textDelta', itemId: 'text', delta: '\u001b[31mred\u001b[0m' });
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    const output: string[] = [];
    handle.onOutput((line) => output.push(line));
    expect(output.join('')).toContain('red');
    expect(output.join('')).not.toContain('\u001b');
    handle.abort.abort();
  });

  it('awaits account binding before the prompt and continues on the same context with role resend', async () => {
    const h = harness();
    const binding: ProviderAccountBinding = {
      version: 1, provider: 'codex', profileId: 'profile-1',
      routeRevision: 1, routeFingerprint: 'fingerprint', authEpoch: 1,
      runId: 'run-1', identity: { kind: 'unknown' },
    };
    const handle = await h.adapter.runSdk(options({
      role: { name: 'Reviewer', body: 'Review code', sourcePath: '/role.md', bytes: 11 },
      accountBinding: binding,
      accountBindingId: 'binding-1',
      onAccountBinding: async () => {
        expect(h.context.inputs).toHaveLength(0);
        h.order.push('binding');
      },
    }));
    expect(h.order).toEqual(['open', 'persist', 'binding']);
    expect(h.context.inputs[0].text).toContain('write report');
    expect(h.context.inputs[0].text).not.toContain('## Role: Reviewer');
    expect(h.profile.developerPrompt).toContain('## Role: Reviewer');
    expect(h.profile.developerPrompt).toContain('ptah-lane-policy-v1');
    expect(handle.getRoleDelivery?.()).toBe('developer-instructions');
    await expect(handle.continue?.('refused while active'))
      .rejects.toThrow('Codex lane turn is already active');
    expect(handle.getRoleDelivery?.()).toBe('developer-instructions');
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    const followUp = await handle.continue?.('second task');
    expect(h.context.inputs[1].text).toContain('## Role: Reviewer');
    expect(h.context.inputs[1].text).toContain('second task');
    await terminal(h.context, 'turn-2');
    expect(await followUp?.done).toBe(0);
    expect(handle.getRoleDelivery?.()).toBe('task-prompt');
    expect(h.runtime.open).toHaveBeenCalledTimes(1);
    handle.abort.abort();
  });

  it('refuses resume without a full matching identity and resumes with one', async () => {
    const h = harness();
    await expect(h.adapter.runSdk(options({ resumeSessionId: 'thread-1' })))
      .rejects.toBeInstanceOf(CodexLaneResumeIdentityError);
    expect(h.runtime.open).not.toHaveBeenCalled();
    const first = await h.adapter.runSdk(options());
    await terminal(h.context);
    await first.done;
    first.abort.abort();
    const saved = h.context.identity;
    h.stored = { ...saved, profileFingerprint: 'wrong-fingerprint' };
    await expect(h.adapter.runSdk(options({ resumeSessionId: 'thread-1' })))
      .rejects.toBeInstanceOf(CodexLaneResumeIdentityError);
    h.stored = saved;
    const resumed = await h.adapter.runSdk(options({ resumeSessionId: 'thread-1' }));
    expect(h.resumeArg?.threadId).toBe('thread-1');
    await terminal(h.context);
    expect(await resumed.done).toBe(0);
    resumed.abort.abort();
  });

  it.each(['command', 'fileChange', 'permissions', 'mcpElicitation'] as const)('declines %s once with one safe output line and continues', async (kind) => {
    const h = harness();
    const handle = await h.adapter.runSdk(options());
    const lines: string[] = [];
    handle.onOutput((line) => lines.push(line));
    const result = await h.approvals.request({
      kind, contextId: h.context.identity.contextId, processGeneration: 1,
      threadId: 'thread-1', turnId: 'turn-1', requestId: 'request-1',
      normalizedHome: '/home', workspaceId: 'work', providerId: 'codex',
      toolName: 'safe_tool', message: 'secret command',
      details: { command: 'secret command', cwd: '/secret/path' },
    }, handle.abort.signal);
    expect(result).toBe('decline');
    expect(lines).toEqual([`Codex approval declined: ${kind} safe_tool\n`]);
    expect(lines.join('')).not.toContain('secret');
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    handle.abort.abort();
  });

  it('advertises queue only and closes the context on abort', async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      expect(h.adapter.capabilities()).toEqual({ steer: false, interrupt: false, continuation: true });
      const handle = await h.adapter.runSdk(options());
      handle.abort.abort();
      expect(await handle.done).toBe(1);
      await Promise.resolve();
      expect(h.context.close).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes the opened context once when startup aborts in the open race', async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      let signalOpenScheduled: (context: FakeContext) => void = () => undefined;
      const openScheduled = new Promise<FakeContext>((resolve) => {
        signalOpenScheduled = resolve;
      });
      jest.spyOn(h.runtime, 'open').mockImplementationOnce((profile) => {
        const context = new FakeContext(profile);
        signalOpenScheduled(context);
        return new Promise<CodexContext>((resolve) => {
          setTimeout(() => resolve(context), 30_000);
        });
      });
      const running = h.adapter.runSdk(options());
      const opened = await openScheduled;
      jest.advanceTimersByTime(30_000);
      await expect(running).rejects.toThrow('Codex lane aborted during startup');
      expect(opened.close).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes an idle lane when its event stream ends after a completed turn', async () => {
    const h = harness();
    const handle = await h.adapter.runSdk(options());
    const segments: CliOutputSegment[] = [];
    handle.onSegment?.((segment) => segments.push(segment));
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    h.context.endEvents();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(segments).toContainEqual({ type: 'error', content: 'Codex lane event stream failed.' });
    expect(h.context.close).toHaveBeenCalledTimes(1);
    expect(handle.supportsContinuation?.()).toBe(false);
    await expect(handle.continue?.('later task')).rejects.toThrow('Codex lane is closed');
  });

  it.each(['low', 'high', 'xhigh'])('passes %s reasoning effort through the lane profile', async (effort) => {
    const h = harness();
    const handle = await h.adapter.runSdk(options({ reasoningEffort: effort }));
    expect(h.profile.effort).toBe(effort);
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    handle.abort.abort();
  });

  it('warns on invalid effort and sends no effort in the profile', async () => {
    const h = harness();
    const handle = await h.adapter.runSdk(options({ reasoningEffort: 'extreme' }));
    const segments: CliOutputSegment[] = [];
    handle.onSegment?.((segment) => segments.push(segment));
    expect(h.profile.effort).toBeUndefined();
    expect(segments).toContainEqual({ type: 'info', content: expect.stringContaining('invalid Codex reasoning effort') });
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    handle.abort.abort();
  });

  it('keeps reasoning effort on continuation turns', async () => {
    const h = harness();
    const handle = await h.adapter.runSdk(options({ reasoningEffort: 'high' }));
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    const continued = await handle.continue?.('follow up');
    expect(h.profile.effort).toBe('high');
    expect(h.runtime.open).toHaveBeenCalledTimes(1);
    await terminal(h.context, 'turn-2');
    expect(await continued?.done).toBe(0);
    handle.abort.abort();
  });

  it('retries a pre-turn config rejection once with essential settings and one notice', async () => {
    const h = harness();
    jest.spyOn(h.runtime, 'open').mockRejectedValueOnce(new CodexPreTurnConfigRejectedError('thread/start'));
    const handle = await h.adapter.runSdk(options());
    const notices: string[] = [];
    const segments: CliOutputSegment[] = [];
    handle.onLaneConfigRejected?.(() => notices.push('rejected'));
    handle.onSegment?.((segment) => segments.push(segment));
    expect(h.runtime.open).toHaveBeenCalledTimes(2);
    expect(h.profile.lane?.autoCompactTokens).toBeUndefined();
    expect(h.profile.lane?.toolOutputTokenLimit).toBeUndefined();
    expect(h.profile.lane?.agentsEnabled).toBeUndefined();
    expect(h.profile.lane?.pluginsEnabled).toBeUndefined();
    expect(h.profile.lane?.appsEnabled).toBeUndefined();
    expect(h.profile.lane?.includeSkillInstructions).toBeUndefined();
    expect(h.profile.lane?.disabledUserMcpServers).toEqual(['user-server']);
    expect(h.profile.mcpServers[0]?.name).toBe('ptah');
    expect(h.profile.sandboxPolicy.mode).toBe('workspace-write');
    expect(notices).toEqual(['rejected']);
    expect(segments).toContainEqual({ type: 'info', content: expect.stringContaining('Codex rejected the lane config') });
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    handle.abort.abort();
  });

  it('keeps the execution fingerprint when building an essential lane profile', () => {
    const session: CodexExecutionProfileInput['session'] = {
      contextId: 'lane-context', consumer: 'lane', normalizedHome: '/home',
      providerId: 'codex', workspaceId: 'work', cwd: '/work', model: 'gpt-test',
      permissionLevel: 'ask',
      lane: {
        suppressedTools: [], disabledUserMcpServers: ['user-server'],
        explicitFullAccess: false, autoCompactTokens: 120000,
        toolOutputTokenLimit: 2500, agentsEnabled: false,
      },
    };
    const full = buildCodexExecutionProfile({ session, paths });
    const essential = buildCodexExecutionProfile({
      session: essentialLaneSession(session, undefined), paths,
    });
    expect(essential.profileFingerprint).toBe(full.profileFingerprint);
  });

  it('retries a resumed pre-turn config rejection with the same identity and fingerprint', async () => {
    const h = harness();
    const first = await h.adapter.runSdk(options());
    await terminal(h.context);
    expect(await first.done).toBe(0);
    const firstContext = h.context;
    const saved = firstContext.identity;
    first.abort.abort();
    await Promise.resolve();
    expect(firstContext.close).toHaveBeenCalledTimes(1);
    await firstContext.close.mock.results[0].value;
    h.stored = saved;

    const open = jest.spyOn(h.runtime, 'open');
    open.mockRejectedValueOnce(new CodexPreTurnConfigRejectedError('thread/resume'));
    const resumed = await h.adapter.runSdk(options({ resumeSessionId: saved.threadId }));
    const notices: string[] = [];
    const segments: CliOutputSegment[] = [];
    resumed.onLaneConfigRejected?.(() => notices.push('rejected'));
    resumed.onSegment?.((segment) => segments.push(segment));

    expect(open).toHaveBeenCalledTimes(3);
    const firstResumeCall = open.mock.calls[1];
    const retryCall = open.mock.calls[2];
    expect(firstResumeCall[1]).toEqual(saved);
    expect(retryCall[1]).toEqual(saved);
    expect(retryCall[0].profileFingerprint).toBe(firstResumeCall[0].profileFingerprint);
    expect(h.resumeArg).toEqual(saved);
    expect(notices).toEqual(['rejected']);
    expect(segments.filter((segment) => segment.type === 'info' &&
      segment.content?.includes('Codex rejected the lane config'))).toHaveLength(1);
    await terminal(h.context);
    expect(await resumed.done).toBe(0);
    const resumedContext = h.context;
    resumed.abort.abort();
    await Promise.resolve();
    expect(resumedContext.close).toHaveBeenCalledTimes(1);
    await resumedContext.close.mock.results[0].value;
  });

  it('keeps reasoning effort on the essential retry profile', async () => {
    const h = harness();
    jest.spyOn(h.runtime, 'open').mockRejectedValueOnce(new CodexPreTurnConfigRejectedError('thread/start'));
    const handle = await h.adapter.runSdk(options({ reasoningEffort: 'high' }));
    expect(h.runtime.open).toHaveBeenCalledTimes(2);
    expect(h.profile.effort).toBe('high');
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    handle.abort.abort();
  });

  it('closes the old context once before opening the essential retry', async () => {
    const order: string[] = [];
    const h = harness((context, attempt) => {
      if (attempt === 2) order.push('open-second');
    });
    const originalOpen = jest.mocked(h.runtime.open).getMockImplementation();
    if (!originalOpen) throw new Error('Missing mock runtime implementation');
    jest.spyOn(h.runtime, 'open').mockImplementationOnce(async (...args) => {
      const first = await originalOpen(...args);
      await first.close();
      order.push('close-first');
      throw new CodexPreTurnConfigRejectedError('thread/start');
    });
    const handle = await h.adapter.runSdk(options());
    expect(order).toEqual(['close-first', 'open-second']);
    expect(h.contexts[0].close).toHaveBeenCalledTimes(1);
    await terminal(h.context);
    await handle.done;
    handle.abort.abort();
  });

  it('reports a second config rejection visibly without a third attempt', async () => {
    const h = harness();
    jest.spyOn(h.runtime, 'open')
      .mockRejectedValueOnce(new CodexPreTurnConfigRejectedError('thread/start'))
      .mockRejectedValueOnce(new CodexPreTurnConfigRejectedError('thread/start'));
    await expect(h.adapter.runSdk(options())).rejects.toThrow('Codex rejected the essential lane configuration.');
    expect(h.runtime.open).toHaveBeenCalledTimes(2);
    const later = await h.adapter.runSdk(options());
    expect(h.profile.lane?.autoCompactTokens).toBe(120000);
    await terminal(h.context);
    expect(await later.done).toBe(0);
    later.abort.abort();
  });

  it('does not retry a turn-start failure after an event', async () => {
    const h = harness((context) => {
      jest.spyOn(context, 'startTurn').mockImplementationOnce(async () => {
        context.event('turn-1', 1, { type: 'textDelta', itemId: 'text', delta: 'started' });
        await new Promise<void>((resolve) => setImmediate(resolve));
        throw new Error('Turn failed');
      });
    });
    const handle = await h.adapter.runSdk(options());
    const segments: CliOutputSegment[] = [];
    handle.onSegment?.((segment) => segments.push(segment));
    await expect(handle.done).rejects.toThrow('Turn failed');
    expect(h.runtime.open).toHaveBeenCalledTimes(1);
    expect(segments).toContainEqual({ type: 'error', content: 'Codex lane turn failed to start.' });
  });

  it('mentions re-enabled user MCP servers when rejection identifies one', async () => {
    const rejection = new CodexPreTurnConfigRejectedError('thread/start', 'mcp_servers.user-server');
    const h = harness();
    jest.spyOn(h.runtime, 'open').mockRejectedValueOnce(rejection);
    const handle = await h.adapter.runSdk(options());
    const segments: CliOutputSegment[] = [];
    handle.onSegment?.((segment) => segments.push(segment));
    expect(h.profile.lane?.disabledUserMcpServers).toEqual([]);
    expect(segments).toContainEqual({ type: 'info', content: expect.stringContaining('your own MCP servers are enabled') });
    await terminal(h.context);
    await handle.done;
    handle.abort.abort();
  });

  it('omits the user-server notice when the lane disabled no user servers', async () => {
    const h = harness();
    jest.mocked(h.profiles.resolve).mockImplementation(async (_options, variant) => {
      const source = lane();
      return { lane: { ...source, config: { ...source.config, variant, userMcpServerNames: [] } }, paths };
    });
    jest.spyOn(h.runtime, 'open').mockRejectedValueOnce(
      new CodexPreTurnConfigRejectedError('thread/start', 'mcp_servers.user-server'));
    const handle = await h.adapter.runSdk(options());
    const segments: CliOutputSegment[] = [];
    handle.onSegment?.((segment) => segments.push(segment));
    expect(h.profile.lane?.disabledUserMcpServers).toEqual([]);
    expect(segments).toContainEqual({ type: 'info', content: expect.stringContaining('Codex rejected the lane config') });
    expect(segments.some((segment) => segment.content?.includes('your own MCP servers are enabled'))).toBe(false);
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    handle.abort.abort();
  });

  it('keeps MCP tool suppressions when no user server was disabled', () => {
    const session = { lane: {
      suppressedTools: ['mcp:example'], disabledUserMcpServers: [], explicitFullAccess: false,
    } };
    const essential = essentialLaneSession(session, 'mcp_servers.example');
    expect(essential.lane?.suppressedTools).toEqual(['mcp:example']);
    expect(essential.lane?.disabledUserMcpServers).toEqual([]);
  });

  it.each([
    ['ptah-default', "Ptah's lane default"],
    ['setting', 'set in `agentOrchestration.codexModel`'],
    ['request', 'named by the spawn request'],
  ] as const)('gives source-aware model rejection advice for %s', async (source, expected) => {
    const h = harness();
    const handle = await h.adapter.runSdk(options({ model: 'bad-model', modelSource: source }));
    const segments: CliOutputSegment[] = [];
    handle.onSegment?.((segment) => segments.push(segment));
    h.context.event('turn-1', 1, { type: 'terminal', status: 'failed', error: {
      code: 'model_not_found', message: 'The model bad-model does not exist', retryable: false,
    } });
    await expect(handle.done).rejects.toThrow(expected);
    expect(segments.some((segment) => segment.type === 'error' && segment.content?.includes('Codex said:'))).toBe(true);
    expect(h.runtime.open).toHaveBeenCalledTimes(1);
  });

  it('does not give model advice for nonterminal wording', async () => {
    const h = harness();
    const handle = await h.adapter.runSdk(options({ model: 'bad-model' }));
    const segments: CliOutputSegment[] = [];
    handle.onSegment?.((segment) => segments.push(segment));
    h.context.event('turn-1', 1, { type: 'textDelta', itemId: 'text', delta: 'model_not_found' });
    await terminal(h.context);
    expect(await handle.done).toBe(0);
    expect(segments.some((segment) => segment.type === 'error')).toBe(false);
    handle.abort.abort();
  });

  it('redacts the Codex excerpt in terminal model advice', async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sensitive-test-key';
    try {
      const h = harness();
      const handle = await h.adapter.runSdk(options({ model: 'bad-model', modelSource: 'request' }));
      const segments: CliOutputSegment[] = [];
      handle.onSegment?.((segment) => segments.push(segment));
      h.context.event('turn-1', 1, { type: 'terminal', status: 'failed', error: {
        code: 'model_not_found', message: 'The model bad-model does not exist: sensitive-test-key', retryable: false,
      } });
      await expect(handle.done).rejects.toThrow('Codex said:');
      const message = segments.find((segment) => segment.type === 'error')?.content ?? '';
      expect(message).not.toContain('sensitive-test-key');
      expect(message).toContain('Codex said:');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it('reports absent binary without opening a process', async () => {
    const h = harness();
    jest.mocked(h.binary.resolve).mockResolvedValue(undefined);
    await expect(h.adapter.detect()).resolves.toMatchObject({ installed: false });
    expect(h.runtime.open).not.toHaveBeenCalled();
    expect(h.credentials.check).not.toHaveBeenCalled();
  });

  it('reports a pin mismatch as not installed and warns without opening a process', async () => {
    const h = harness();
    jest.mocked(h.binary.resolve).mockRejectedValue(new Error('Codex executable pin mismatch'));
    await expect(h.adapter.detect()).resolves.toMatchObject({ installed: false });
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('detection failed'), { errorClass: 'Error' },
    );
    expect(h.runtime.open).not.toHaveBeenCalled();
  });

  it('reports the binary actually selected and checks credentials read only', async () => {
    const h = harness();
    await expect(h.adapter.detect()).resolves.toMatchObject({
      installed: true, path: '/bin/codex', version: '0.165.0', messagingMode: 'queue',
    });
    expect(h.credentials.check).toHaveBeenCalledTimes(1);
    jest.mocked(h.credentials.check).mockResolvedValue('stale');
    await expect(h.adapter.ensureTokensFresh()).resolves.toBe(false);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.any(String), { status: 'stale' });
    jest.mocked(h.credentials.check).mockResolvedValue('unreadable');
    await expect(h.adapter.ensureTokensFresh()).resolves.toBe(false);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.any(String), { status: 'unreadable' });
  });

  it('rejects a binary pin mismatch before opening and forwards an accepted explicit path', async () => {
    const h = harness();
    jest.mocked(h.binary.resolve).mockRejectedValueOnce(new Error('Codex executable pin mismatch'));
    await expect(h.adapter.runSdk(options({ binaryPath: '/custom/codex' })))
      .rejects.toThrow('Codex executable pin mismatch');
    expect(h.runtime.open).not.toHaveBeenCalled();
    const handle = await h.adapter.runSdk(options({ binaryPath: '/custom/codex' }));
    expect(h.binary.resolve).toHaveBeenLastCalledWith('/custom/codex');
    expect(h.runtime.open).toHaveBeenCalledWith(
      expect.any(Object), undefined, expect.any(Object), '/custom/codex',
    );
    await terminal(h.context);
    await handle.done;
  });

  it('keeps the requested and Ptah default models in the thread and turn profile', async () => {
    const requested = harness();
    const chosen = await requested.adapter.runSdk(options({ model: 'gpt-6-astra', modelSource: 'request' }));
    expect(requested.profile.model).toBe('gpt-6-astra');
    await terminal(requested.context);
    await chosen.done;

    const defaulted = harness();
    jest.mocked(defaulted.profiles.resolve).mockImplementation(async () => {
      const source = lane();
      return { lane: { ...source, identity: { ...source.identity, model: 'gpt-6-sol' } }, paths };
    });
    const standard = await defaulted.adapter.runSdk(options());
    expect(defaulted.profile.model).toBe('gpt-6-sol');
    await terminal(defaulted.context);
    await standard.done;
  });

  it('uses the lane default for an empty requested model', async () => {
    const h = harness();
    jest.mocked(h.profiles.resolve).mockImplementation(async () => {
      const source = lane();
      return { lane: { ...source, identity: { ...source.identity, model: '' } }, paths };
    });
    const handle = await h.adapter.runSdk(options({ model: '' }));
    expect(h.profile.model).toBe('gpt-6-sol');
    expect(h.context.inputs[0].text).toContain('write report');
    await terminal(h.context);
    await handle.done;
    handle.abort.abort();
  });

  it('labels only an applied default as Ptah default in model advice', async () => {
    const explicit = harness();
    const explicitHandle = await explicit.adapter.runSdk(options({ model: 'gpt-6-sol' }));
    explicit.context.event('turn-1', 1, { type: 'terminal', status: 'failed', error: {
      code: 'model_not_found', message: 'The model does not exist', retryable: false,
    } });
    await expect(explicitHandle.done).rejects.toThrow('setting or the spawn request');

    const defaulted = harness();
    jest.mocked(defaulted.profiles.resolve).mockImplementation(async () => {
      const source = lane();
      return { lane: { ...source, identity: { ...source.identity, model: '' } }, paths };
    });
    const defaultHandle = await defaulted.adapter.runSdk(options());
    defaulted.context.event('turn-1', 1, { type: 'terminal', status: 'failed', error: {
      code: 'model_not_found', message: 'The model does not exist', retryable: false,
    } });
    await expect(defaultHandle.done).rejects.toThrow("Ptah's lane default");
  });

  it('falls back visibly when binary verification fails during listing', async () => {
    const h = harness();
    jest.mocked(h.binary.resolve).mockRejectedValue(new Error('Codex executable pin mismatch'));
    const models = await h.adapter.listModels();
    expect(models.some((model) => model.id === 'gpt-6-sol')).toBe(true);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('curated fallback'), { errorClass: 'Error' },
    );
    expect(h.runtime.openCatalog).not.toHaveBeenCalled();
  });

  it('times out a hung catalog open and closes a context that arrives late', async () => {
    const h = harness();
    const handle = await h.adapter.runSdk(options());
    await terminal(h.context);
    await handle.done;
    handle.abort.abort();
    let resolveLate: (context: CodexContext) => void = () => undefined;
    const opening = new Promise<CodexContext>((resolve) => { resolveLate = resolve; });
    jest.spyOn(h.runtime, 'openCatalog').mockReturnValueOnce(opening);
    jest.useFakeTimers();
    try {
      const listing = h.adapter.listModels();
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(8_000);
      await expect(listing).resolves.toEqual(expect.arrayContaining([
        { id: 'gpt-6-sol', name: 'GPT-6-Sol (Ptah lane default)' },
      ]));
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('curated fallback'), { errorClass: 'Error' },
      );
      const late = new FakeContext(h.profile);
      resolveLate(late);
      await Promise.resolve();
      await Promise.resolve();
      expect(late.close).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('times out a hung catalog list and closes its opened context', async () => {
    const h = harness();
    const handle = await h.adapter.runSdk(options());
    await terminal(h.context);
    await handle.done;
    handle.abort.abort();
    const catalog = new FakeContext(h.profile);
    jest.spyOn(catalog, 'listModels').mockImplementation(
      () => new Promise<CodexModelInfo[]>(() => undefined),
    );
    jest.spyOn(h.runtime, 'openCatalog').mockResolvedValueOnce(catalog);
    jest.useFakeTimers();
    try {
      const listing = h.adapter.listModels();
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(8_000);
      await expect(listing).resolves.toEqual(expect.arrayContaining([
        { id: 'gpt-6-sol', name: 'GPT-6-Sol (Ptah lane default)' },
      ]));
      expect(catalog.close).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('lists the runtime catalog, caches for 30 seconds, and warns on fallback', async () => {
    const h = harness((context, attempt) => {
      if (attempt === 0) context.models = [
        { id: 'catalog-1', model: 'gpt-6-sol', displayName: 'GPT-6-Sol', isDefault: false },
        { id: 'catalog-2', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', isDefault: true },
      ];
    });
    const handle = await h.adapter.runSdk(options());
    await terminal(h.context);
    await handle.done;
    const first = await h.adapter.listModels();
    expect(first).toEqual([
      { id: 'gpt-6-sol', name: 'GPT-6-Sol (Ptah lane default)' },
      { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
    ]);
    await h.adapter.listModels();
    expect(h.runtime.openCatalog).toHaveBeenCalledTimes(1);
    const later = Date.now() + 30_001;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await h.adapter.listModels();
    } finally {
      clock.mockRestore();
    }
    expect(h.runtime.openCatalog).toHaveBeenCalledTimes(2);
    jest.mocked(h.runtime.openCatalog).mockRejectedValueOnce(new Error('catalog failed'));
    const secondClock = jest.spyOn(Date, 'now').mockReturnValue(later + 30_001);
    let fallback: CliModelInfo[];
    try {
      fallback = await h.adapter.listModels();
    } finally {
      secondClock.mockRestore();
    }
    expect(fallback.find((model) => model.id === 'gpt-6-sol')?.name)
      .toBe('GPT-6-Sol (Ptah lane default)');
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('catalog failed'), expect.any(Object),
    );
    await h.adapter.listModels();
    expect(h.runtime.openCatalog).toHaveBeenCalledTimes(4);
    expect(h.binary.resolve).toHaveBeenCalledTimes(5);
  });
});
