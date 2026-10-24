import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { CodexAppServerProcess } from './codex-app-server-process';
import { CodexRuntime, type CodexRuntimeOptions } from './codex-runtime';
import type {
  CodexExecutionProfile,
  CodexThreadIdentity,
} from './codex-runtime.types';
import {
  codexRequestSchemas,
  validateCodexResult,
} from './codex-protocol-validator';

const profile: CodexExecutionProfile = {
  contextId: 'chat',
  consumer: 'chat',
  normalizedHome: '/home/codex',
  providerId: 'codex',
  workspaceId: 'workspace',
  cwd: '/work',
  model: 'model',
  permissionLevel: 'ask',
  approvalPolicy: {
    granular: {
      sandbox_approval: true,
      rules: true,
      skill_approval: true,
      request_permissions: true,
      mcp_elicitations: true,
    },
  },
  sandboxPolicy: { mode: 'read-only', networkAccess: false, writableRoots: [] },
  instructionSources: [],
  mcpServers: [],
  attachments: [],
  profileFingerprint: 'fingerprint',
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const turn = (id: string, status = 'inProgress') => ({ id, status, items: [] });

class FakeChild extends EventEmitter implements SpawnedProcessHandle {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly frames: Record<string, unknown>[] = [];
  readonly pid = 42;
  readonly whenSpawned = Promise.resolve(42);
  killed = false;
  exitCode: number | null = null;
  failMethod?: string;
  holdMethod?: string;
  completeBeforeReply = false;
  turnNumber = 0;
  readonly fixtureErrors: string[] = [];
  readonly stdin = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      const frame: Record<string, unknown> = JSON.parse(chunk.toString());
      this.frames.push(frame);
      done();
      queueMicrotask(() => this.respond(frame));
    },
    final: (done) => {
      done();
      queueMicrotask(() => {
        this.exitCode = 0;
        this.emit('close', 0, null);
      });
    },
  });
  constructor(readonly threadId: string) {
    super();
  }
  kill(): boolean {
    this.killed = true;
    this.emit('close', 1, null);
    return true;
  }
  send(value: unknown): void {
    this.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  }
  notify(method: string, params: unknown): void {
    this.send({ method, params });
  }
  complete(status = 'completed', id = `turn-${this.turnNumber}`): void {
    this.notify('turn/completed', {
      threadId: this.threadId,
      turn: turn(id, status),
    });
  }
  approval(id = 'approval'): void {
    this.send({
      id,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: this.threadId,
        turnId: `turn-${this.turnNumber}`,
        itemId: 'command',
        startedAtMs: 1,
        command: 'echo hello',
        cwd: '/work',
      },
    });
  }
  private respond(frame: Record<string, unknown>): void {
    const method = frame['method'];
    if (
      typeof method !== 'string' ||
      frame['id'] === undefined ||
      method === this.holdMethod
    )
      return;
    if (method === this.failMethod) {
      this.send({
        id: frame['id'],
        error: { code: -1, message: 'secret raw error' },
      });
      return;
    }
    let result: unknown;
    switch (method) {
      case 'initialize':
        result = {
          codexHome: '/home/codex',
          platformFamily: 'unix',
          platformOs: 'linux',
          userAgent: 'test',
        };
        break;
      case 'thread/start':
      case 'thread/resume':
        result = {
          thread: {
            id: this.threadId,
            cliVersion: '0.155.1',
            createdAt: 1,
            updatedAt: 1,
            cwd: '/work',
            ephemeral: false,
            modelProvider: 'openai',
            preview: '',
            projectId: null,
            sessionId: 'session',
            source: 'appServer',
            status: { type: 'idle' },
            turns: [],
          },
          approvalPolicy: profile.approvalPolicy,
          approvalsReviewer: 'user',
          cwd: '/work',
          model: 'model',
          modelProvider: 'openai',
          sandbox: { type: 'readOnly' },
        };
        break;
      case 'turn/start': {
        const value = turn(`turn-${++this.turnNumber}`);
        this.notify('turn/started', { threadId: this.threadId, turn: value });
        if (this.completeBeforeReply) this.complete();
        result = { turn: value };
        break;
      }
      case 'turn/steer':
        result = { turnId: `turn-${this.turnNumber}` };
        break;
      default:
        result = {};
    }
    try {
      validateCodexResult(method as keyof typeof codexRequestSchemas, result);
    } catch (error) {
      this.fixtureErrors.push(String(error));
    }
    this.send({ id: frame['id'], result });
  }
}

describe('CodexRuntime', () => {
  let runtime: CodexRuntime;
  let options: CodexRuntimeOptions;
  let children: FakeChild[];
  let persist: jest.Mock<Promise<void>, [CodexThreadIdentity]>;
  let inactive: jest.Mock<Promise<void>, [CodexThreadIdentity]>;
  beforeEach(() => {
    children = [];
    persist = jest.fn<Promise<void>, [CodexThreadIdentity]>(
      async () => undefined,
    );
    inactive = jest.fn<Promise<void>, [CodexThreadIdentity]>(
      async () => undefined,
    );
    options = {
      spawner: {
        spawnProcess: jest.fn(() => {
          const child = new FakeChild(`thread-${children.length + 1}`);
          children.push(child);
          return child;
        }),
      },
      executable: {
        resolvedPath: '/bin/codex',
        expectedManifestRow: {
          platform: 'test',
          arch: 'test',
          pinnedVersion: '0.155.1',
          version: 'codex-cli 0.155.1',
          binarySha256: 'a'.repeat(64),
          schemaSha256: 'b'.repeat(64),
        },
      },
      binary: {
        executablePath: '/bin/codex',
        platform: 'test',
        arch: 'test',
        versionOutput: 'codex-cli 0.155.1',
        sha256: 'a'.repeat(64),
      },
      store: { persist, markInactive: inactive, read: async () => undefined },
      sink: { request: jest.fn(async () => 'decline' as const) },
      clock: {
        now: Date.now,
        setTimeout: (callback, delay) => {
          const timer = setTimeout(callback, delay);
          return { dispose: () => clearTimeout(timer) };
        },
      },
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };
    runtime = new CodexRuntime(options);
  });
  afterEach(async () => {
    await runtime.close();
    for (const child of children) {
      expect(child.listenerCount('exit')).toBe(0);
      expect(child.listenerCount('error')).toBe(0);
      expect(child.listenerCount('close')).toBe(0);
      expect(child.stdout.listenerCount('data')).toBe(0);
      expect(child.stdin.listenerCount('finish')).toBe(0);
    }
  });

  it.each([undefined, '/wrong/home'])(
    'fails closed with a typed home mismatch for %s',
    async (verified) => {
      const getter = jest
        .spyOn(CodexAppServerProcess.prototype, 'verifiedCodexHome', 'get')
        .mockReturnValue(verified);
      try {
        await expect(runtime.open(profile)).rejects.toMatchObject({
          code: 'codexHomeMismatch',
        });
        expect(persist).not.toHaveBeenCalled();
        expect(children[0].stdin.writableEnded).toBe(true);
      } finally {
        getter.mockRestore();
      }
    },
  );

  it.each(['chat', 'lane'] as const)(
    'isolates same-home chat/%s processes, settings and turns',
    async (consumer) => {
      const first = await runtime.open(profile);
      const second = await runtime.open({
        ...profile,
        contextId: 'other',
        consumer,
      });
      await first.updateNextTurn({ model: 'other-model' });
      const [one, two] = await Promise.all([
        first.startTurn({ text: 'one' }),
        second.startTurn({ text: 'two' }),
      ]);
      expect(children).toHaveLength(2);
      expect(one.threadId).not.toBe(two.threadId);
      expect(
        children[0].frames.find((frame) => frame['method'] === 'turn/start')?.[
          'params'
        ],
      ).toMatchObject({
        model: 'other-model',
        input: [{ type: 'text', text: 'one' }],
      });
      expect(
        children[1].frames.find((frame) => frame['method'] === 'turn/start')?.[
          'params'
        ],
      ).toMatchObject({
        model: 'model',
        input: [{ type: 'text', text: 'two' }],
      });
    },
  );

  it('waits for identity commit before exposing a usable context', async () => {
    let commit: () => void = () => undefined;
    persist.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          commit = resolve;
        }),
    );
    const opening = runtime.open(profile);
    await flush();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(
      children[0].frames.some((frame) => frame['method'] === 'turn/start'),
    ).toBe(false);
    await expect(runtime.open(profile)).rejects.toThrow('already open');
    commit();
    const context = await opening;
    await context.startTurn({ text: 'go' });
    expect(context.identity).toEqual(persist.mock.calls[0][0]);
  });

  it('closes a persistence orphan and starts a fresh thread on a later open', async () => {
    persist.mockRejectedValueOnce(new Error('secret storage path'));
    await expect(runtime.open(profile)).rejects.toThrow('could not be opened');
    expect(children[0].stdin.writableEnded).toBe(true);
    expect(inactive).not.toHaveBeenCalled();
    const context = await runtime.open(profile);
    expect(context.identity.threadId).toBe('thread-2');
    expect(context.identity.processGeneration).toBe(2);
  });

  it('retains committed identity on crash and resumes only the exact identity', async () => {
    const context = await runtime.open(profile);
    const identity = context.identity;
    await context.close();
    expect(inactive).toHaveBeenCalledWith(identity);
    await expect(
      runtime.open({ ...profile, providerId: 'other' }, identity),
    ).rejects.toThrow('identity mismatch');
    const resumedRuntime = new CodexRuntime({
      ...options,
      spawner: {
        spawnProcess: () => {
          const child = new FakeChild(identity.threadId);
          children.push(child);
          return child;
        },
      },
    });
    const resumed = await resumedRuntime.open(profile, identity);
    expect(resumed.identity.processGeneration).toBe(2);
    expect(
      children[1].frames.find((frame) => frame['method'] === 'thread/resume')?.[
        'params'
      ],
    ).toMatchObject({ threadId: identity.threadId });
    await resumedRuntime.close();
  });

  it('serializes admission, steers the expected in-flight turn, and starts a new turn when idle', async () => {
    const context = await runtime.open(profile);
    const [started, steered] = await Promise.all([
      context.startTurn({ text: 'first' }),
      context.steer({ text: 'follow-up' }),
    ]);
    expect(steered).toEqual(started);
    expect(
      children[0].frames.find((frame) => frame['method'] === 'turn/steer')?.[
        'params'
      ],
    ).toEqual({
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: 'follow-up' }],
    });
    await expect(context.startTurn({ text: 'overlap' })).rejects.toThrow(
      'already active',
    );
    children[0].complete();
    expect((await context.steer({ text: 'next' })).turnId).toBe('turn-2');
  });

  it('writes edit decline before the follow-up steer and never writes a modified command', async () => {
    const edited = {
      decision: 'decline' as const,
      editNotSupported: true as const,
      followUpMessage: 'Use a different approach',
    };
    runtime = new CodexRuntime({
      ...options,
      sink: { request: async () => edited },
    });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    children[0].approval();
    await flush();
    await flush();
    const frames = children[0].frames;
    const declined = frames.findIndex((frame) => frame['id'] === 'approval');
    const steered = frames.findIndex(
      (frame) => frame['method'] === 'turn/steer',
    );
    expect(declined).toBeGreaterThan(-1);
    expect(frames[declined]).toEqual({
      id: 'approval',
      result: { decision: 'decline' },
    });
    expect(steered).toBeGreaterThan(declined);
    expect(frames[steered]['params']).toMatchObject({
      expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: edited.followUpMessage }],
    });
  });

  it('blocks new turns until an interrupted turn is terminal, then approvals still work', async () => {
    const context = await runtime.open(profile);
    const receipt = await context.startTurn({ text: 'go' });
    expect(await context.interrupt('wrong')).toBe(false);
    expect(await context.interrupt(receipt.turnId)).toBe(true);
    await expect(context.startTurn({ text: 'too soon' })).rejects.toThrow(
      'already active',
    );
    await expect(context.steer({ text: 'too soon' })).rejects.toThrow(
      'cannot be steered',
    );
    children[0].complete('interrupted');
    await context.startTurn({ text: 'again' });
    children[0].approval();
    await flush();
    expect(options.sink.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    'turn/start',
    'turn/steer',
    'turn/interrupt',
    'thread/compact/start',
  ])('keeps the context usable after rejection of %s', async (method) => {
    const context = await runtime.open(profile);
    if (method === 'turn/steer' || method === 'turn/interrupt')
      await context.startTurn({ text: 'go' });
    children[0].failMethod = method;
    const rejected =
      method === 'turn/start'
        ? context.startTurn({ text: 'go' })
        : method === 'turn/steer'
          ? context.steer({ text: 'edit' })
          : method === 'turn/interrupt'
            ? context.interrupt('turn-1')
            : context.compact();
    await expect(rejected).rejects.toMatchObject({
      code: 'codexRequestRejected',
      retryable: true,
    });
    expect(children[0].stdin.writableEnded).toBe(false);
    children[0].failMethod = undefined;
    if (method === 'turn/steer' || method === 'turn/interrupt')
      children[0].complete();
    await expect(context.startTurn({ text: 'again' })).resolves.toBeDefined();
  });
  it('cancels approvals arriving while interrupting', async () => {
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    await context.interrupt('turn-1');
    children[0].approval();
    await flush();
    expect(children[0].frames.at(-1)).toEqual({
      id: 'approval',
      result: { decision: 'cancel' },
    });
    expect(options.sink.request).not.toHaveBeenCalled();
    expect(children[0].stdin.writableEnded).toBe(false);
  });
  it('buffers events and terminal before the first next call', async () => {
    const context = await runtime.open(profile);
    const events = context.events(new AbortController().signal);
    await context.startTurn({ text: 'go' });
    children[0].complete();
    await context.close();
    const received = [];
    for await (const event of events) received.push(event);
    expect(received.filter((event) => event.type === 'terminal')).toHaveLength(
      1,
    );
  });
  it('closes only the overflowing subscriber', async () => {
    const context = await runtime.open(profile);
    const events = context.events(new AbortController().signal);
    const iterator = events[Symbol.asyncIterator]();
    await context.startTurn({ text: 'go' });
    for (let i = 0; i < 1030; i++)
      children[0].notify('item/agentMessage/delta', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'message',
        delta: 'x',
      });
    expect((await iterator.next()).value).toMatchObject({
      type: 'error',
      error: { code: 'codexSubscriberOverflow' },
    });
    expect((await iterator.next()).done).toBe(true);
    expect(children[0].stdin.writableEnded).toBe(false);
    children[0].complete();
    await expect(context.startTurn({ text: 'again' })).resolves.toBeDefined();
  });
  it.each(['interrupt', 'compact'] as const)(
    'bounds the %s completion wait',
    async (operation) => {
      const context = await runtime.open(profile);
      jest.useFakeTimers({
        doNotFake: ['queueMicrotask', 'setImmediate', 'nextTick'],
      });
      try {
        if (operation === 'interrupt') {
          await context.startTurn({ text: 'go' });
          await context.interrupt('turn-1');
        }
        const compacting =
          operation === 'compact'
            ? expect(context.compact()).rejects.toThrow('compaction failed')
            : Promise.resolve();
        await flush();
        await jest.advanceTimersByTimeAsync(30_000);
        await compacting;
        await expect(context.startTurn({ text: 'later' })).rejects.toThrow(
          'not ready',
        );
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('emits one sanitized terminal failure on crash and ignores late approvals', async () => {
    let answer: (decision: 'accept') => void = () => undefined;
    runtime = new CodexRuntime({
      ...options,
      sink: {
        request: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
    });
    const context = await runtime.open(profile);
    const events = context.events(new AbortController().signal);
    const iterator = events[Symbol.asyncIterator]();
    const event = iterator.next();
    await context.startTurn({ text: 'go' });
    children[0].approval();
    await flush();
    children[0].emit('exit', 1, null);
    answer('accept');
    expect((await event).value).toMatchObject({
      type: 'terminal',
      status: 'failed',
      turnId: 'turn-1',
      error: { retryable: false },
    });
    expect((await iterator.next()).done).toBe(true);
    await context.close();
    expect(children[0].frames.some((frame) => frame['id'] === 'approval')).toBe(
      false,
    );
    expect(inactive).toHaveBeenCalledWith(context.identity);
  });

  it('does not resurrect a terminal-before-reply turn or emit a second terminal on exit', async () => {
    const context = await runtime.open(profile);
    const events = context.events(new AbortController().signal);
    const iterator = events[Symbol.asyncIterator]();
    const terminal = iterator.next();
    children[0].completeBeforeReply = true;
    await context.startTurn({ text: 'fast' });
    expect((await terminal).value).toMatchObject({
      type: 'terminal',
      status: 'completed',
    });
    await context.close();
    expect((await iterator.next()).done).toBe(true);
  });

  it('stages revisioned model/effort settings, clears effort, and rejects unsupported permissions', async () => {
    const context = await runtime.open({ ...profile, effort: 'high' });
    await context.startTurn({ text: 'go' });
    expect(
      await context.updateNextTurn({ model: 'next', effort: undefined }),
    ).toEqual({ timing: 'nextTurn', revision: 1 });
    expect((await context.steer({ text: 'current' })).revision).toBe(0);
    await expect(
      context.updateNextTurn({ permissionLevel: 'yolo' }),
    ).rejects.toThrow('verified reconfiguration');
    await expect(context.updateNextTurn({ model: '' })).rejects.toThrow(
      'Invalid',
    );
    children[0].complete();
    expect((await context.startTurn({ text: 'next' })).revision).toBe(1);
    expect(
      children[0].frames.filter((frame) => frame['method'] === 'turn/start')[1][
        'params'
      ],
    ).toMatchObject({ model: 'next', effort: null });
  });

  it('coalesces compaction and reserves admission until its completion event', async () => {
    const context = await runtime.open(profile);
    const compacting = context.compact();
    expect(context.compact()).toBe(compacting);
    const next = context.startTurn({ text: 'after compaction' });
    await flush();
    expect(
      children[0].frames.filter(
        (frame) => frame['method'] === 'thread/compact/start',
      ),
    ).toHaveLength(1);
    expect(
      children[0].frames.some((frame) => frame['method'] === 'turn/start'),
    ).toBe(false);
    children[0].notify('item/completed', {
      threadId: 'thread-1',
      turnId: 'compact',
      item: { id: 'compact-item', type: 'contextCompaction' },
      completedAtMs: 1,
    });
    await compacting;
    await next;
  });

  it('releases a compaction reservation on close', async () => {
    const context = await runtime.open(profile);
    const compacting = expect(context.compact()).rejects.toThrow(
      'compaction failed',
    );
    await flush();
    await context.close();
    await compacting;
  });

  it('aborts event waiting and translates input cancellation into interrupt', async () => {
    const context = await runtime.open(profile);
    const controller = new AbortController();
    const iterator = context.events(controller.signal)[Symbol.asyncIterator]();
    const waiting = iterator.next();
    controller.abort();
    expect((await waiting).done).toBe(true);
    const input = new AbortController();
    await context.startTurn({ text: 'go', signal: input.signal });
    input.abort();
    await flush();
    expect(
      children[0].frames.some((frame) => frame['method'] === 'turn/interrupt'),
    ).toBe(true);
  });

  it('fails malformed process traffic even while no request is pending', async () => {
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    children[0].send({ method: 'not-a-pinned-method', params: {} });
    await flush();
    await expect(context.steer({ text: 'again' })).rejects.toThrow('not ready');
  });

  it('marks an identity inactive if the process exits during its persistence', async () => {
    let commit: () => void = () => undefined;
    persist.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          commit = resolve;
        }),
    );
    const opening = expect(runtime.open(profile)).rejects.toThrow(
      'could not be opened',
    );
    await flush();
    children[0].emit('exit', 1, null);
    commit();
    await opening;
    expect(inactive).toHaveBeenCalledWith(persist.mock.calls[0][0]);
  });

  it('rejects missing approval UI and unsupported configuration before spawn', async () => {
    await expect(
      runtime.open({
        ...profile,
        lane: { suppressedTools: ['shell'], explicitFullAccess: false },
      }),
    ).rejects.toThrow('unsupported');
    expect(children).toHaveLength(0);
  });

  it('uses valid pinned handshake fixtures', async () => {
    await runtime.open(profile).catch(() => undefined);
    expect(children[0].fixtureErrors).toEqual([]);
    expect(children[0].frames.map((frame) => frame['method'])).toContain(
      'thread/start',
    );
  });

  it('keeps an undefined model patch unchanged and applies initial profile input only once', async () => {
    const context = await runtime.open({
      ...profile,
      enhancedPrompt: 'Context',
      attachments: [{ type: 'file', path: '/work/file' }],
    });
    await context.updateNextTurn({ model: undefined });
    await context.startTurn({ text: 'go' });
    await context.steer({ text: 'follow-up' });
    const started = children[0].frames.find(
      (frame) => frame['method'] === 'turn/start',
    );
    expect(started?.['params']).toMatchObject({
      model: 'model',
      input: [
        { type: 'text', text: 'Context\n\ngo' },
        { type: 'mention', name: '/work/file', path: '/work/file' },
      ],
    });
    expect(
      children[0].frames.find((frame) => frame['method'] === 'turn/steer')?.[
        'params'
      ],
    ).toMatchObject({ input: [{ type: 'text', text: 'follow-up' }] });
  });
});
