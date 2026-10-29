import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import {
  CodexAppServerProcess,
  CodexHomeMismatchError,
  CodexProcessFailureError,
  CodexRequestRejectedError,
} from './codex-app-server-process';
import { CodexProtocolError } from './codex-protocol-validator';
import { CodexMcpConfigError } from './codex-mcp-config';
import { CodexRuntime } from './codex-runtime';
import {
  codexProfileFingerprint,
  resolveCodexLevelPolicy,
} from './codex-execution-profile';
import type { CodexRuntimeOptions } from './codex-context';
import {
  CodexResumeProfileChangedError,
  CODEX_RESUME_PROFILE_CHANGED_CODE,
  CODEX_RESUME_PROFILE_CHANGED_MESSAGE,
  isCodexResumeProfileChangedError,
} from './codex-resume-profile-error';
import type {
  CodexExecutionProfile,
  CodexMcpServer,
  CodexPermissionLevel,
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
  approvalPolicy: 'untrusted',
  sandboxPolicy: {
    mode: 'workspace-write',
    networkAccess: false,
    writableRoots: ['/work'],
  },
  instructionSources: [],
  mcpServers: [],
  attachments: [],
  profileFingerprint: 'fingerprint',
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function blankDenial() {
  return {
    decision: 'decline' as const,
    denialReason: ' \n\t ',
  };
}
const turn = (id: string, status = 'inProgress') => ({ id, status, items: [] });
const catalogModel = {
  id: 'catalog-id',
  model: 'wire-model',
  displayName: 'Catalog model',
  description: 'Model description',
  hidden: false,
  isDefault: true,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [
    { reasoningEffort: 'medium', description: 'Balanced' },
    { reasoningEffort: 'high', description: 'Thorough' },
  ],
};
const ptahUrl = 'http://localhost:4823/session/tab-1/workspace/D%3A%5Cws';
const ptahServer: CodexMcpServer = {
  name: 'ptah',
  transport: 'http',
  url: ptahUrl,
  headerReferences: {},
  toolTimeoutSec: 960,
};

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
  steerResultTurnId?: string;
  modelPages: unknown[] = [{ data: [catalogModel] }];
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
  approval(id = 'approval', command = 'echo hello'): void {
    this.send({
      id,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: this.threadId,
        turnId: `turn-${this.turnNumber}`,
        itemId: 'command',
        startedAtMs: 1,
        command,
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
      case 'model/list':
        result = this.modelPages.shift();
        break;
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
            cliVersion: '0.165.0',
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
          sandbox: {
            type: 'workspaceWrite',
            networkAccess: false,
            writableRoots: ['/work'],
          },
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
        result = { turnId: this.steerResultTurnId ?? `turn-${this.turnNumber}` };
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
          pinnedVersion: '0.165.0',
          version: 'codex-cli 0.165.0',
          binarySha256: 'a'.repeat(64),
          schemaSha256: 'b'.repeat(64),
        },
      },
      binary: {
        executablePath: '/bin/codex',
        platform: 'test',
        arch: 'test',
        versionOutput: 'codex-cli 0.165.0',
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
      expect(child.listenerCount('error')).toBe(1);
      expect(() => child.emit('error', new Error('late secret'))).not.toThrow();
      expect(child.listenerCount('close')).toBe(0);
      expect(child.stdout.listenerCount('data')).toBe(0);
      expect(child.stdin.listenerCount('finish')).toBe(0);
    }
  });

  it('preserves the exact open failure and reports its root cause once', async () => {
    const root = new CodexProtocolError('invalidResult', 'thread/start');
    const original = new CodexProcessFailureError(
      'Codex invalid protocol frame',
      'thread/start',
      { cause: root },
    );
    const request = jest
      .spyOn(CodexAppServerProcess.prototype, 'request')
      .mockRejectedValueOnce(original);
    try {
      await expect(runtime.open(profile)).rejects.toMatchObject({
        message: 'Codex context could not be opened',
        cause: original,
      });
      expect(options.logger.error).toHaveBeenCalledTimes(1);
      expect(options.logger.error).toHaveBeenCalledWith(
        'Codex context could not be opened',
        expect.objectContaining({
          errorClass: 'CodexProcessFailureError',
          errorMessage: 'Codex invalid protocol frame',
          failedMethod: 'thread/start',
          rootCauseClass: 'CodexProtocolError',
          rootCauseMessage: root.message,
        }),
      );
    } finally {
      request.mockRestore();
    }
  });

  it('does not log JSON parser excerpts from a protocol failure', async () => {
    const original = new CodexProcessFailureError(
      'Codex invalid protocol frame',
      'thread/start',
      {
        cause: new SyntaxError('Unexpected PRIVATE_FRAME_SENTINEL'),
      },
    );
    const request = jest
      .spyOn(CodexAppServerProcess.prototype, 'request')
      .mockRejectedValueOnce(original);
    try {
      await expect(runtime.open(profile)).rejects.toMatchObject({
        cause: original,
      });
      expect(options.logger.error).toHaveBeenCalledWith(
        'Codex context could not be opened',
        expect.objectContaining({
          rootCauseClass: 'SyntaxError',
          rootCauseMessage: 'Invalid JSON',
        }),
      );
      expect(
        JSON.stringify(jest.mocked(options.logger.error).mock.calls),
      ).not.toContain('PRIVATE_FRAME_SENTINEL');
    } finally {
      request.mockRestore();
    }
  });

  it('keeps the original persistence error instance as cause', async () => {
    const original = new Error('Storage unavailable');
    persist.mockRejectedValueOnce(original);
    const failure: unknown = await runtime
      .open(profile)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error('Expected open failure');
    expect(failure.cause).toBe(original);
    expect(failure.message).toBe('Codex context could not be opened');
    expect(options.logger.error).toHaveBeenCalledTimes(1);
  });

  it('rethrows the same home mismatch without wrapping', async () => {
    const original = new CodexHomeMismatchError();
    const start = jest
      .spyOn(CodexAppServerProcess.prototype, 'start')
      .mockRejectedValueOnce(original);
    try {
      await expect(runtime.open(profile)).rejects.toBe(original);
      expect(options.logger.error).toHaveBeenCalledTimes(1);
    } finally {
      start.mockRestore();
    }
  });

  it('logs a rejected thread/start with its code and no remote payload', async () => {
    const opening = runtime.open({
      ...profile,
      model: 'PRIVATE_REQUEST_SENTINEL',
    });
    children[0].failMethod = 'thread/start';
    children[0].stderr.write(
      'Authorization: Bearer secret-key\nstartup failed\n',
    );
    const failure: unknown = await opening.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error('Expected open failure');
    expect(failure.cause).toBeInstanceOf(CodexRequestRejectedError);
    expect(options.logger.error).toHaveBeenCalledTimes(1);
    expect(options.logger.error).toHaveBeenCalledWith(
      'Codex context could not be opened',
      expect.objectContaining({
        errorClass: 'CodexRequestRejectedError',
        failedMethod: 'thread/start',
        rpcCode: -1,
        stderrTail: expect.stringContaining('startup failed'),
      }),
    );
    for (const log of Object.values(options.logger)) {
      const calls = jest.mocked(log).mock.calls;
      expect(JSON.stringify(calls)).not.toMatch(
        /PRIVATE_REQUEST_SENTINEL|secret raw error|secret-key/,
      );
    }
  });

  it('lists models from its own process and maps the catalog fields', async () => {
    const context = await runtime.open(profile);
    await expect(context.listModels()).resolves.toEqual([
      {
        id: 'catalog-id',
        model: 'wire-model',
        displayName: 'Catalog model',
        description: 'Model description',
        isDefault: true,
        supportedEfforts: ['medium', 'high'],
      },
    ]);
    expect(children[0].frames).toContainEqual(
      expect.objectContaining({
        method: 'model/list',
        params: { limit: 100 },
      }),
    );
    expect(children[0].fixtureErrors).toEqual([]);
  });

  it('sends the model slug rather than the catalog key on thread and turn start', async () => {
    const catalog = await runtime.open(profile);
    const [selected] = await catalog.listModels();
    expect(selected.id).not.toBe(selected.model);
    const context = await runtime.open({
      ...profile,
      contextId: 'selected-model',
      model: selected.model,
    });
    await context.startTurn({ text: 'hi' });
    for (const method of ['thread/start', 'turn/start']) {
      expect(children[1].frames).toContainEqual(
        expect.objectContaining({
          method,
          params: expect.objectContaining({ model: 'wire-model' }),
        }),
      );
    }
  });

  it('fetches all model pages using opaque cursors including an empty cursor', async () => {
    const context = await runtime.open(profile);
    children[0].modelPages = [
      { data: [catalogModel], nextCursor: '' },
      {
        data: [{ ...catalogModel, id: 'second', isDefault: false }],
        nextCursor: null,
      },
    ];
    expect((await context.listModels()).map((model) => model.id)).toEqual([
      'catalog-id',
      'second',
    ]);
    expect(
      children[0].frames
        .filter((frame) => frame['method'] === 'model/list')
        .map((frame) => frame['params']),
    ).toEqual([{ limit: 100 }, { limit: 100, cursor: '' }]);
  });

  // TASK_2026_714 8j: codex-cli 0.155.1 additive protocol strips unknown keys;
  // invalid fixtures must violate required fields, types, or value constraints.
  it.each([
    { data: [{ ...catalogModel, isDefault: 'yes' }] },
    {
      data: [
        {
          ...catalogModel,
          supportedReasoningEfforts: [{ reasoningEffort: '', description: '' }],
        },
      ],
    },
    { unexpected: 'secret' },
    { data: [{ ...catalogModel, model: 123, unexpected: 'secret' }] },
  ])(
    'rejects invalid model responses without exposing payloads',
    async (response) => {
      const context = await runtime.open(profile);
      children[0].modelPages = [response];
      await expect(context.listModels()).rejects.toThrow(
        new Error('Codex model listing failed'),
      );
      expect(children[0].stdin.writableEnded).toBe(false);
      children[0].modelPages = [{ data: [catalogModel] }];
      await expect(context.listModels()).resolves.toMatchObject([
        { id: 'catalog-id', model: 'wire-model' },
      ]);
      await expect(
        context.startTurn({ text: 'still usable' }),
      ).resolves.toMatchObject({ turnId: 'turn-1' });
    },
  );

  it('bounds model pagination and rejects repeated cursors without partial results', async () => {
    const context = await runtime.open(profile);
    children[0].modelPages = [
      { data: [catalogModel], nextCursor: 'repeat' },
      { data: [catalogModel], nextCursor: 'repeat' },
    ];
    await expect(context.listModels()).rejects.toThrow(
      'Codex model listing failed',
    );
    expect(
      children[0].frames.filter((frame) => frame['method'] === 'model/list'),
    ).toHaveLength(2);
    await expect(
      context.startTurn({ text: 'still usable' }),
    ).resolves.toMatchObject({ turnId: 'turn-1' });
  });

  it('stops after 100 model pages even when every cursor is distinct', async () => {
    const context = await runtime.open(profile);
    children[0].modelPages = Array.from({ length: 101 }, (_, page) => ({
      data: [],
      nextCursor: String(page),
    }));
    await expect(context.listModels()).rejects.toThrow(
      'Codex model listing failed',
    );
    expect(
      children[0].frames.filter((frame) => frame['method'] === 'model/list'),
    ).toHaveLength(100);
    await expect(
      context.startTurn({ text: 'still usable' }),
    ).resolves.toMatchObject({ turnId: 'turn-1' });
  });

  it('sanitizes model request rejections', async () => {
    const context = await runtime.open(profile);
    children[0].failMethod = 'model/list';
    await expect(context.listModels()).rejects.toThrow(
      'Codex model listing failed',
    );
    await expect(
      context.startTurn({ text: 'still usable' }),
    ).resolves.toMatchObject({ turnId: 'turn-1' });
  });

  it('rejects model listing on a closed context without sending a request', async () => {
    const context = await runtime.open(profile);
    await context.close();
    await expect(context.listModels()).rejects.toThrow(
      'Codex context is not ready',
    );
    expect(
      children[0].frames.some((frame) => frame['method'] === 'model/list'),
    ).toBe(false);
  });

  it('strictly validates model list request parameters', () => {
    const schema = codexRequestSchemas['model/list'].params;
    expect(
      schema.safeParse({ cursor: null, includeHidden: false, limit: 0 })
        .success,
    ).toBe(true);
    for (const params of [
      { limit: -1 },
      { limit: 1.5 },
      { limit: 4_294_967_296 },
      { cursor: 1 },
      { unknown: true },
    ]) {
      expect(schema.safeParse(params).success).toBe(false);
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

  it.each(['ask', 'auto-edit'] as const)(
    'refuses an older %s profile before spawning with a logged stable code',
    async (permissionLevel) => {
      const identity: CodexThreadIdentity = {
        contextId: profile.contextId,
        threadId: 'stored-thread',
        processGeneration: 3,
        normalizedHome: profile.normalizedHome,
        providerId: profile.providerId,
        workspaceId: profile.workspaceId,
        profileFingerprint: 'pre-D14-fingerprint',
      };
      const failure = await runtime
        .open({ ...profile, permissionLevel }, identity)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CodexResumeProfileChangedError);
      expect(isCodexResumeProfileChangedError(failure)).toBe(true);
      expect(isCodexResumeProfileChangedError(new Error('wrapper', { cause: failure }))).toBe(false);
      expect(failure).toMatchObject({
        name: 'CodexResumeProfileChangedError',
        code: CODEX_RESUME_PROFILE_CHANGED_CODE,
        message: CODEX_RESUME_PROFILE_CHANGED_MESSAGE,
      });
      expect(options.logger.error).toHaveBeenCalledTimes(1);
      expect(options.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Start a new chat'),
        { code: 'resume-profile-changed' },
      );
      expect(children).toHaveLength(0);
      expect(persist).not.toHaveBeenCalled();
      expect(inactive).not.toHaveBeenCalled();
    },
  );

  it('sends the exact Manual thread and turn policy frames', async () => {
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'hi' });
    const frames = children[0].frames;
    expect(frames.find((frame) => frame['method'] === 'thread/start')).toEqual({
      id: expect.any(Number),
      method: 'thread/start',
      params: {
        cwd: '/work',
        model: 'model',
        approvalPolicy: 'untrusted',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
      },
    });
    expect(frames.find((frame) => frame['method'] === 'turn/start')).toEqual({
      id: expect.any(Number),
      method: 'turn/start',
      params: {
        threadId: context.identity.threadId,
        input: [{ type: 'text', text: 'hi' }],
        model: 'model',
        effort: null,
        approvalPolicy: 'untrusted',
        approvalsReviewer: 'user',
        cwd: '/work',
        sandboxPolicy: {
          type: 'workspaceWrite',
          networkAccess: false,
          writableRoots: ['/work'],
        },
      },
    });
    expect(children[0].fixtureErrors).toEqual([]);
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

  it('reports a rejected follow-up after exactly one decline and keeps the turn alive', async () => {
    runtime = new CodexRuntime({
      ...options,
      sink: {
        request: async () => ({
          decision: 'decline',
          editNotSupported: true,
          followUpMessage: 'Try again',
        }),
      },
    });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    const events = context.events(new AbortController().signal);
    const iterator = events[Symbol.asyncIterator]();
    children[0].failMethod = 'turn/steer';
    children[0].approval();
    await flush();
    await flush();
    expect((await iterator.next()).value).toMatchObject({
      type: 'error',
      turnId: 'turn-1',
      error: {
        code: 'codexFollowUpRejected',
        message: 'Codex rejected the follow-up instruction.',
        retryable: true,
      },
    });
    const frames = children[0].frames;
    expect(frames.filter((frame) => frame['id'] === 'approval')).toEqual([
      { id: 'approval', result: { decision: 'decline' } },
    ]);
    expect(
      frames.findIndex((frame) => frame['id'] === 'approval'),
    ).toBeLessThan(
      frames.findIndex((frame) => frame['method'] === 'turn/steer'),
    );
    expect(children[0].stdin.writableEnded).toBe(false);
    children[0].failMethod = undefined;
    await expect(context.steer({ text: 'retry' })).resolves.toMatchObject({
      turnId: 'turn-1',
    });
    children[0].complete();
    expect((await iterator.next()).value).toMatchObject({
      type: 'terminal',
      status: 'completed',
    });
    await context.close();
    expect((await iterator.next()).done).toBe(true);
  });

  it('steers a typed deny reason after the unchanged decline', async () => {
    const reason = 'say "no"';
    const feedback =
      'The user denied this command request with the message: "say \\"no\\"". Respect this decision, do not retry the same call, and adjust your approach.';
    const reply = {
      decision: 'decline' as const,
      denialReason: reason,
    };
    runtime = new CodexRuntime({
      ...options,
      sink: { request: async () => reply },
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
    expect(frames[declined]).toEqual({
      id: 'approval',
      result: { decision: 'decline' },
    });
    expect(steered).toBeGreaterThan(declined);
    expect(frames[steered]).toEqual({
      id: expect.any(Number),
      method: 'turn/steer',
      params: {
        threadId: 'thread-1',
        expectedTurnId: 'turn-1',
        input: [{ type: 'text', text: feedback }],
      },
    });
    expect(JSON.stringify(jest.mocked(options.logger.warn).mock.calls)).not.toContain(
      reason,
    );
  });

  it('asks async chat questions through the shared port and steers one answer on the live turn', async () => {
    const ask = jest.fn(async () => ({ 'question:0': { answers: ['A'] } }));
    runtime = new CodexRuntime({ ...options, requestUserInput: ask });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    children[0].notify('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Choose one',
        delivery: 'async', questions: [{ title: 'Which?', options: ['A', 'B'] }] },
    });
    await flush();
    await flush();
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'userInput', requestId: 'question',
      details: { questions: [{ id: 'question:0', header: '', question: 'Which?',
        options: [{ label: 'A', description: '' }, { label: 'B', description: '' }] }] },
    }), expect.any(AbortSignal));
    expect(children[0].frames.filter((frame) => frame['method'] === 'turn/steer'))
      .toHaveLength(1);
    expect(children[0].frames.find((frame) => frame['method'] === 'turn/steer')?.['params'])
      .toMatchObject({ expectedTurnId: 'turn-1', input: [{ type: 'text',
        text: 'User has answered your questions: "Which?"="A". You can now continue with the user\'s answers in mind.' }] });
  });

  it('presents a question as text when no card port is registered', async () => {
    runtime = new CodexRuntime(options);
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    const iterator = context.events(new AbortController().signal)[Symbol.asyncIterator]();
    children[0].notify('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Choose one',
        delivery: 'async', questions: [{ title: 'Which?' }] },
    });
    expect((await iterator.next()).value).toMatchObject({
      type: 'userInputAsync', presentation: 'text', text: 'Choose one',
    });
    expect(options.logger.warn).toHaveBeenCalledWith(
      'Codex async question used text presentation or was already presented.',
      { code: 'codex-user-input-text-fallback', cause: 'card-unavailable' },
    );
  });

  it('opens one card and steers once for a repeated async completion', async () => {
    const ask = jest.fn(async () => ({ 'question:0': { answers: ['A'] } }));
    runtime = new CodexRuntime({ ...options, requestUserInput: ask });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    const completion = {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Choose one',
        delivery: 'async', questions: [{ title: 'Which?' }] },
    };
    children[0].notify('item/completed', completion);
    children[0].notify('item/completed', completion);
    await flush();
    await flush();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(children[0].frames.filter((frame) => frame['method'] === 'turn/steer'))
      .toHaveLength(1);
  });

  it('keeps visible deltas as text when completion first reveals async delivery', async () => {
    const ask = jest.fn(async () => ({}));
    runtime = new CodexRuntime({ ...options, requestUserInput: ask });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    const iterator = context.events(new AbortController().signal)[Symbol.asyncIterator]();
    children[0].notify('item/started', { threadId: 'thread-1', turnId: 'turn-1', startedAtMs: 1,
      item: { type: 'agentMessage', id: 'question', text: '' } });
    children[0].notify('item/agentMessage/delta', {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'question', delta: 'Choose',
    });
    children[0].notify('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Choose one',
        delivery: 'async', questions: [{ title: 'Which?' }] },
    });
    expect((await iterator.next()).value).toMatchObject({ type: 'textDelta', delta: 'Choose' });
    expect((await iterator.next()).value).toMatchObject({
      type: 'userInputAsync', presentation: 'text', text: 'Choose one',
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it('quotes each answered question in a single same-turn steer', async () => {
    const ask = jest.fn(async () => ({
      'question:0': { answers: ['Line 1\nLine 2'] },
      'question:1': { answers: ['Yes'] },
    }));
    runtime = new CodexRuntime({ ...options, requestUserInput: ask });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    children[0].notify('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Two questions',
        delivery: 'async', questions: [{ title: 'Say "yes"?' }, { title: 'Continue?' }] },
    });
    await flush();
    await flush();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(children[0].frames.filter((frame) => frame['method'] === 'turn/steer'))
      .toHaveLength(1);
    expect(children[0].frames.find((frame) => frame['method'] === 'turn/steer')?.['params'])
      .toMatchObject({ input: [{ type: 'text', text:
        'User has answered your questions: "Say \\"yes\\"?"="Line 1\\nLine 2", "Continue?"="Yes". You can now continue with the user\'s answers in mind.' }] });
  });

  it('logs a dismissed or empty async answer without steering', async () => {
    const ask = jest.fn(async () => ({}));
    runtime = new CodexRuntime({ ...options, requestUserInput: ask });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    children[0].notify('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Choose one',
        delivery: 'async', questions: [{ title: 'Which?' }] },
    });
    await flush();
    expect(options.logger.warn).toHaveBeenCalledWith(
      'Codex user answer was not delivered.',
      { code: 'codex-user-input-undelivered', cause: 'dismissed' },
    );
    expect(children[0].frames.filter((frame) => frame['method'] === 'turn/steer'))
      .toHaveLength(0);
  });

  it.each(['refused', 'different-turn'] as const)(
    'emits one error when an answered async question steer is %s on a live turn',
    async (outcome) => {
      const ask = jest.fn(async () => ({ 'question:0': { answers: ['Yes'] } }));
      runtime = new CodexRuntime({ ...options, requestUserInput: ask });
      const context = await runtime.open(profile);
      await context.startTurn({ text: 'go' });
      const events = context.events(new AbortController().signal);
      if (outcome === 'refused') children[0].failMethod = 'turn/steer';
      else children[0].steerResultTurnId = 'turn-other';
      children[0].notify('item/completed', {
        threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
        item: { type: 'agentMessage', id: 'question', text: 'Choose one',
          delivery: 'async', questions: [{ title: 'Which?' }] },
      });
      await flush();
      await flush();
      expect(options.logger.warn).toHaveBeenCalledWith(
        'Codex user answer was not delivered.',
        { code: 'codex-user-input-undelivered', cause: outcome === 'refused' ? 'refused' : 'failed' },
      );
      children[0].complete();
      await context.close();
      const received = [];
      for await (const event of events) received.push(event);
      expect(received.filter((event) => event.type === 'error')).toEqual([
        expect.objectContaining({
          contextId: profile.contextId,
          threadId: 'thread-1',
          turnId: 'turn-1',
          sequence: expect.any(Number),
          error: {
            code: 'codexFollowUpRejected',
            message: 'Codex rejected the follow-up instruction.',
            retryable: true,
          },
        }),
      ]);
    },
  );

  it('does not emit a follow-up error when the answer steer is refused after terminal', async () => {
    const ask = jest.fn(async () => ({ 'question:0': { answers: ['Yes'] } }));
    runtime = new CodexRuntime({ ...options, requestUserInput: ask });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    const events = context.events(new AbortController().signal);
    children[0].holdMethod = 'turn/steer';
    children[0].notify('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Choose one',
        delivery: 'async', questions: [{ title: 'Which?' }] },
    });
    await flush();
    await flush();
    const steer = children[0].frames.find((frame) => frame['method'] === 'turn/steer');
    expect(steer).toBeDefined();
    children[0].complete();
    await flush();
    children[0].send({ id: steer?.['id'], error: { code: -1, message: 'refused' } });
    await flush();
    expect(options.logger.warn).toHaveBeenCalledWith(
      'Codex user answer was not delivered.',
      { code: 'codex-user-input-undelivered', cause: 'refused' },
    );
    await context.close();
    const received = [];
    for await (const event of events) received.push(event);
    expect(received.filter((event) => event.type === 'error')).toHaveLength(0);
  });

  it('cancels an async card on terminal and never steers a late answer or starts a turn', async () => {
    let answer: (value: { 'question:0': { answers: string[] } }) => void = () => undefined;
    const ask = jest.fn((_request: unknown, signal: AbortSignal) => new Promise<{ 'question:0': { answers: string[] } }>((resolve) => {
      answer = resolve;
      expect(signal.aborted).toBe(false);
    }));
    runtime = new CodexRuntime({ ...options, requestUserInput: ask });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    children[0].notify('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Choose one',
        delivery: 'async', questions: [{ title: 'Which?' }] },
    });
    await flush();
    const signal = ask.mock.calls[0][1];
    children[0].complete();
    await flush();
    expect(signal.aborted).toBe(true);
    answer({ 'question:0': { answers: ['private answer'] } });
    await flush();
    expect(children[0].frames.filter((frame) => frame['method'] === 'turn/steer' || frame['method'] === 'turn/start'))
      .toHaveLength(1);
    expect(options.logger.warn).toHaveBeenCalledWith('Codex user answer was not delivered.',
      { code: 'codex-user-input-undelivered', cause: 'turn-ended' });
    expect(JSON.stringify(jest.mocked(options.logger.warn).mock.calls)).not.toContain('private answer');
  });

  it('aborts a pending async card on interrupt', async () => {
    let questionSignal: AbortSignal | undefined;
    const ask = jest.fn((_request: unknown, signal: AbortSignal) => {
      questionSignal = signal;
      return new Promise<Record<string, { answers: string[] }>>(() => undefined);
    });
    runtime = new CodexRuntime({ ...options, requestUserInput: ask });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    children[0].notify('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Choose one',
        delivery: 'async', questions: [{ title: 'Which?' }] },
    });
    await flush();
    expect(questionSignal?.aborted).toBe(false);
    await context.interrupt('turn-1');
    expect(questionSignal?.aborted).toBe(true);
  });

  it.each(['gateway', 'lane'] as const)('does not show async cards to %s consumers', async (consumer) => {
    const ask = jest.fn(async () => ({}));
    runtime = new CodexRuntime({ ...options, requestUserInput: ask });
    const context = await runtime.open({ ...profile, consumer });
    await context.startTurn({ text: 'go' });
    children[0].notify('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
      item: { type: 'agentMessage', id: 'question', text: 'Choose one',
        delivery: 'async', questions: [{ title: 'Which?' }] },
    });
    await flush();
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    ['accept', 'accept'],
    ['cancel', 'cancel'],
    ['a blank deny reason', 'decline'],
  ] as const)(
    'sends no steer frame for %s',
    async (_label, decision) => {
      const reply = decision === 'decline' ? blankDenial() : decision;
      runtime = new CodexRuntime({
        ...options,
        sink: { request: async () => reply },
      });
      const context = await runtime.open(profile);
      await context.startTurn({ text: 'go' });
      children[0].approval();
      await flush();
      await flush();
      expect(children[0].frames.filter((frame) => frame['id'] === 'approval')).toEqual(
        [{ id: 'approval', result: { decision } }],
      );
      expect(
        children[0].frames.filter((frame) => frame['method'] === 'turn/steer'),
      ).toEqual([]);
    },
  );

  it('keeps the decline when the denial steer is refused and logs a coded warning', async () => {
    const reason = 'too risky';
    const reply = {
      decision: 'decline' as const,
      denialReason: reason,
    };
    runtime = new CodexRuntime({
      ...options,
      sink: { request: async () => reply },
    });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    const events = context.events(new AbortController().signal);
    children[0].failMethod = 'turn/steer';
    children[0].approval();
    await flush();
    await flush();
    expect(children[0].frames.filter((frame) => frame['id'] === 'approval')).toEqual(
      [{ id: 'approval', result: { decision: 'decline' } }],
    );
    expect(
      children[0].frames.findIndex((frame) => frame['id'] === 'approval'),
    ).toBeLessThan(
      children[0].frames.findIndex((frame) => frame['method'] === 'turn/steer'),
    );
    expect(options.logger.warn).toHaveBeenCalledWith(
      'Codex denial feedback was not delivered.',
      { code: 'codex-denial-feedback-undelivered', cause: 'refused' },
    );
    expect(JSON.stringify(jest.mocked(options.logger.warn).mock.calls)).not.toContain(
      reason,
    );
    expect(children[0].stdin.writableEnded).toBe(false);
    children[0].failMethod = undefined;
    await expect(context.steer({ text: 'retry' })).resolves.toMatchObject({
      turnId: 'turn-1',
    });
    children[0].complete();
    await context.close();
    const received = [];
    for await (const event of events) received.push(event);
    expect(received.filter((event) => event.type === 'error')).toHaveLength(0);
  });

  it('logs a coded warning and does not steer when the turn already ended', async () => {
    const reason = 'too late';
    const reply = {
      decision: 'decline' as const,
      denialReason: reason,
    };
    runtime = new CodexRuntime({
      ...options,
      sink: { request: async () => reply },
    });
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'go' });
    children[0].approval();
    await flush();
    children[0].complete();
    await flush();
    expect(children[0].frames.filter((frame) => frame['id'] === 'approval')).toEqual(
      [{ id: 'approval', result: { decision: 'decline' } }],
    );
    expect(
      children[0].frames.filter((frame) => frame['method'] === 'turn/steer'),
    ).toEqual([]);
    expect(options.logger.warn).toHaveBeenCalledWith(
      'Codex denial feedback was not delivered.',
      { code: 'codex-denial-feedback-undelivered', cause: 'turn-ended' },
    );
    expect(JSON.stringify(jest.mocked(options.logger.warn).mock.calls)).not.toContain(
      reason,
    );
    await context.close();
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
        await jest.advanceTimersByTimeAsync(120_000);
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

  it('stages revisioned model/effort settings and validates permission levels', async () => {
    const context = await runtime.open({ ...profile, effort: 'high' });
    await context.startTurn({ text: 'go' });
    expect(
      await context.updateNextTurn({ model: 'next', effort: undefined }),
    ).toEqual({ timing: 'nextTurn', revision: 1 });
    expect((await context.steer({ text: 'current' })).revision).toBe(0);
    await expect(
      context.updateNextTurn({
        permissionLevel: 'invalid' as CodexPermissionLevel,
      }),
    ).rejects.toThrow('Invalid Codex turn settings');
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

  it.each(['ask', 'plan', 'auto-edit', 'yolo'] as const)(
    'sends the %s policy after changing the next turn level',
    async (level) => {
      const initialLevel: CodexPermissionLevel =
        level === 'ask' ? 'plan' : 'ask';
      const initialPolicy = resolveCodexLevelPolicy(
        'chat',
        initialLevel,
        '/work',
      );
      const initialProfile: CodexExecutionProfile = {
        ...profile,
        permissionLevel: initialLevel,
        ...initialPolicy,
        profileFingerprint: codexProfileFingerprint({
          permissionLevel: initialLevel,
          ...initialPolicy,
        }),
      };
      const context = await runtime.open(initialProfile);
      const original = context.identity;
      const nextPolicy = resolveCodexLevelPolicy('chat', level, '/work');
      await expect(
        context.updateNextTurn({ permissionLevel: level }),
      ).resolves.toEqual({ timing: 'nextTurn', revision: 1 });
      expect(context.turnPermissionLevel).toBe(level);
      expect(context.identity).toEqual({
        ...original,
        profileFingerprint: codexProfileFingerprint({
          permissionLevel: level,
          ...nextPolicy,
        }),
      });
      expect(persist).toHaveBeenLastCalledWith(context.identity);
      expect(persist).toHaveBeenCalledTimes(2);
      await context.startTurn({ text: 'next' });
      expect(
        children[0].frames.find((frame) => frame['method'] === 'turn/start')?.[
          'params'
        ],
      ).toMatchObject({
          approvalPolicy: nextPolicy.approvalPolicy,
          sandboxPolicy:
            level === 'plan'
              ? { type: 'readOnly', networkAccess: false }
              : {
                  type: 'workspaceWrite',
                  networkAccess: false,
                  writableRoots: ['/work'],
                },
      });
    },
  );

  it('holds the active turn level for the bridge and restores the original policy on rollback', async () => {
    runtime = new CodexRuntime({
      ...options,
      sink: { request: jest.fn(async () => 'accept' as const) },
    });
    const initialFingerprint = codexProfileFingerprint({
      permissionLevel: 'ask',
      approvalPolicy: profile.approvalPolicy,
      sandboxPolicy: profile.sandboxPolicy,
    });
    const context = await runtime.open({
      ...profile,
      profileFingerprint: initialFingerprint,
    });
    const original = context.identity;
    await context.startTurn({ text: 'first' });
    await context.updateNextTurn({ permissionLevel: 'plan' });
    expect(context.turnPermissionLevel).toBe('ask');
    children[0].approval('before-next-turn');
    await flush();
    expect(
      children[0].frames.find((frame) => frame['id'] === 'before-next-turn'),
    ).toMatchObject({ result: { decision: 'accept' } });
    children[0].complete();
    expect(context.turnPermissionLevel).toBe('plan');
    await context.startTurn({ text: 'second' });
    expect(
      children[0].frames.filter((frame) => frame['method'] === 'turn/start')[1][
        'params'
      ],
    ).toMatchObject({
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'readOnly' },
    });
    children[0].approval('after-next-turn');
    await flush();
    expect(
      children[0].frames.find((frame) => frame['id'] === 'after-next-turn'),
    ).toMatchObject({ result: { decision: 'decline' } });
    await context.updateNextTurn({ permissionLevel: 'ask' });
    expect(context.turnPermissionLevel).toBe('plan');
    expect(context.identity).toEqual(original);
    children[0].complete();
    await context.startTurn({ text: 'third' });
    expect(
      children[0].frames.filter((frame) => frame['method'] === 'turn/start')[2][
        'params'
      ],
    ).toMatchObject({
      approvalPolicy: 'untrusted',
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/work'] },
    });
  });

  it('keeps level, fingerprint, model and next frame unchanged when re-persist fails', async () => {
    const context = await runtime.open(profile);
    const original = context.identity;
    persist.mockRejectedValueOnce(new Error('store unavailable'));
    await expect(
      context.updateNextTurn({ permissionLevel: 'plan', model: 'changed' }),
    ).rejects.toThrow('store unavailable');
    expect(context.turnPermissionLevel).toBe('ask');
    expect(context.identity).toBe(original);
    await context.startTurn({ text: 'still ask' });
    expect(
      children[0].frames.find((frame) => frame['method'] === 'turn/start')?.[
        'params'
      ],
    ).toMatchObject({
      model: 'model',
      approvalPolicy: 'untrusted',
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/work'] },
    });
  });

  it('rejects a pending level update on close and deactivates the last committed identity', async () => {
    const context = await runtime.open(profile);
    const original = context.identity;
    let finishPersist: () => void = () => undefined;
    persist.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPersist = resolve;
        }),
    );
    const update = context.updateNextTurn({
      permissionLevel: 'plan',
      model: 'changed',
    });
    await flush();
    expect(persist).toHaveBeenCalledTimes(2);
    const pendingIdentity = persist.mock.calls[1][0];
    expect(pendingIdentity).not.toEqual(original);
    const closing = context.close();
    expect(inactive).not.toHaveBeenCalled();
    finishPersist();
    await expect(update).rejects.toThrow('Codex context closed');
    await closing;
    expect(context.turnPermissionLevel).toBe('ask');
    expect(context.identity).toBe(original);
    expect(context).toMatchObject({
      levelPolicy: {
        approvalPolicy: profile.approvalPolicy,
        sandboxPolicy: profile.sandboxPolicy,
      },
      settings: { model: profile.model, permissionLevel: 'ask' },
    });
    expect(inactive).toHaveBeenNthCalledWith(1, pendingIdentity);
    expect(inactive).toHaveBeenLastCalledWith(original);
  });

  it('uses the opening plan policy for an idle notification before the next ask turn', async () => {
    runtime = new CodexRuntime({
      ...options,
      sink: { request: jest.fn(async () => 'accept' as const) },
    });
    const planPolicy = resolveCodexLevelPolicy('chat', 'plan', '/work');
    const context = await runtime.open({
      ...profile,
      permissionLevel: 'plan',
      ...planPolicy,
      profileFingerprint: codexProfileFingerprint({
        permissionLevel: 'plan',
        ...planPolicy,
      }),
    });
    await context.updateNextTurn({ permissionLevel: 'ask' });
    expect(context.turnPermissionLevel).toBe('ask');
    children[0].turnNumber = 1;
    children[0].notify('turn/started', {
      threadId: 'thread-1',
      turn: turn('turn-1'),
    });
    expect(context.turnPermissionLevel).toBe('plan');
    children[0].approval('plan-read', 'Get-Content /work/file');
    await flush();
    expect(children[0].frames.find((frame) => frame['id'] === 'plan-read'))
      .toMatchObject({ result: { decision: 'decline' } });
    children[0].complete();
    expect(context.turnPermissionLevel).toBe('ask');
    await context.startTurn({ text: 'next' });
    expect(children[0].frames.find((frame) => frame['method'] === 'turn/start')?.['params'])
      .toMatchObject({
        approvalPolicy: 'untrusted',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/work'] },
      });
    expect(context.turnPermissionLevel).toBe('ask');
  });

  it('uses the last sent ask policy for an idle notification after staging plan', async () => {
    const context = await runtime.open(profile);
    await context.startTurn({ text: 'first' });
    children[0].complete();
    await context.updateNextTurn({ permissionLevel: 'plan' });
    expect(context.turnPermissionLevel).toBe('plan');
    children[0].turnNumber = 2;
    children[0].notify('turn/started', {
      threadId: 'thread-1',
      turn: turn('turn-2'),
    });
    expect(context.turnPermissionLevel).toBe('ask');
  });

  it('keeps the last sent level after a rejected turn/start', async () => {
    const context = await runtime.open(profile);
    await context.updateNextTurn({ permissionLevel: 'plan' });
    children[0].failMethod = 'turn/start';
    await expect(context.startTurn({ text: 'rejected' })).rejects.toMatchObject({
      code: 'codexRequestRejected',
    });
    expect(context.turnPermissionLevel).toBe('plan');
    children[0].turnNumber = 1;
    children[0].notify('turn/started', {
      threadId: 'thread-1',
      turn: turn('turn-1'),
    });
    expect(context.turnPermissionLevel).toBe('ask');
  });

  it('holds the level of a notification-started turn until it completes', async () => {
    runtime = new CodexRuntime({
      ...options,
      sink: { request: jest.fn(async () => 'accept' as const) },
    });
    const context = await runtime.open(profile);
    children[0].turnNumber = 1;
    children[0].notify('turn/started', {
      threadId: 'thread-1',
      turn: turn('turn-1'),
    });
    expect(context.turnPermissionLevel).toBe('ask');
    await context.updateNextTurn({ permissionLevel: 'plan' });
    expect(context.turnPermissionLevel).toBe('ask');
    children[0].approval('notification-turn');
    await flush();
    expect(
      children[0].frames.find((frame) => frame['id'] === 'notification-turn'),
    ).toMatchObject({ result: { decision: 'accept' } });
    children[0].complete();
    expect(context.turnPermissionLevel).toBe('plan');
    await context.startTurn({ text: 'next' });
    expect(context.turnPermissionLevel).toBe('plan');
    children[0].approval('next-turn');
    await flush();
    expect(
      children[0].frames.find((frame) => frame['id'] === 'next-turn'),
    ).toMatchObject({ result: { decision: 'decline' } });
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

  it('keeps long active compaction alive and clears the watchdog on completion', async () => {
    const context = await runtime.open(profile);
    jest.useFakeTimers({
      doNotFake: ['queueMicrotask', 'setImmediate', 'nextTick'],
    });
    try {
      const compacting = context.compact();
      await flush();
      for (let step = 0; step < 4; step++) {
        await jest.advanceTimersByTimeAsync(25_000);
        children[0].notify('item/started', {
          threadId: 'thread-1',
          turnId: 'compact',
          item: { id: 'compact-item', type: 'contextCompaction' },
          startedAtMs: 1,
        });
      }
      expect(children[0].stdin.writableEnded).toBe(false);
      children[0].notify('item/completed', {
        threadId: 'thread-1',
        turnId: 'compact',
        item: { id: 'compact-item', type: 'contextCompaction' },
        completedAtMs: 1,
      });
      await compacting;
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(context.startTurn({ text: 'after' })).resolves.toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails compaction after activity stops and ignores another thread activity', async () => {
    const context = await runtime.open(profile);
    jest.useFakeTimers({
      doNotFake: ['queueMicrotask', 'setImmediate', 'nextTick'],
    });
    try {
      const compacting = expect(context.compact()).rejects.toThrow(
        'compaction failed',
      );
      await flush();
      await jest.advanceTimersByTimeAsync(100_000);
      children[0].notify('item/started', {
        threadId: 'thread-1',
        turnId: 'compact',
        item: { id: 'compact-item', type: 'contextCompaction' },
        startedAtMs: 1,
      });
      await jest.advanceTimersByTimeAsync(100_000);
      expect(children[0].stdin.writableEnded).toBe(false);
      children[0].notify('item/started', {
        threadId: 'other-thread',
        turnId: 'compact',
        item: { id: 'compact-item', type: 'contextCompaction' },
        startedAtMs: 1,
      });
      await jest.advanceTimersByTimeAsync(20_000);
      await compacting;
      await expect(context.startTurn({ text: 'later' })).rejects.toThrow(
        'not ready',
      );
    } finally {
      jest.useRealTimers();
    }
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
    // Unknown methods are ignored, but method/result routing conflicts stay fatal.
    children[0].send({ method: 'not-a-pinned-method', params: {}, result: {} });
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

  it('sends profile MCP servers as native config overrides on thread/start', async () => {
    await runtime.open({ ...profile, mcpServers: [ptahServer] });
    const params = children[0].frames.find(
      (frame) => frame['method'] === 'thread/start',
    )?.['params'];
    expect(params).toEqual(
      expect.objectContaining({
        config: {
          'mcp_servers.ptah': { url: ptahUrl, tool_timeout_sec: 960 },
        },
      }),
    );
    expect(params).not.toHaveProperty('mcp_servers');
  });

  it('sends the same config overrides on thread/resume', async () => {
    const context = await runtime.open({
      ...profile,
      mcpServers: [ptahServer],
      systemPrompt: 'Base instructions',
      developerPrompt: 'Developer instructions',
    });
    const identity = context.identity;
    await context.close();
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
    await resumedRuntime.open(
      {
        ...profile,
        mcpServers: [ptahServer],
        systemPrompt: 'Base instructions',
        developerPrompt: 'Developer instructions',
      },
      identity,
    );
    const resumedParams = children[1].frames.find(
      (frame) => frame['method'] === 'thread/resume',
    )?.['params'];
    expect(resumedParams).toEqual(
      expect.objectContaining({
        threadId: identity.threadId,
        baseInstructions: 'Base instructions',
        developerInstructions: 'Developer instructions',
        config: {
          'mcp_servers.ptah': { url: ptahUrl, tool_timeout_sec: 960 },
        },
      }),
    );
    await resumedRuntime.close();
  });

  it('resumes with changed prompts and sends the current instructions', async () => {
    const context = await runtime.open({
      ...profile,
      systemPrompt: 'Original base',
      developerPrompt: 'Original developer',
      outputStyle: 'Original style',
    });
    const identity = context.identity;
    await context.close();
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
    const resumed = await resumedRuntime.open(
      {
        ...profile,
        systemPrompt: 'Current base',
        developerPrompt: 'Current developer',
        outputStyle: 'Current style',
      },
      identity,
    );
    expect(resumed.identity.threadId).toBe(identity.threadId);
    const resumedParams = children[1].frames.find(
      (frame) => frame['method'] === 'thread/resume',
    )?.['params'];
    expect(resumedParams).toEqual(
      expect.objectContaining({
        threadId: identity.threadId,
        baseInstructions: 'Current base',
        developerInstructions: 'Current developer\n\nCurrent style',
      }),
    );
    await resumedRuntime.close();
  });

  it('resolves MCP header secrets into the frame only', async () => {
    const headerProfile: CodexExecutionProfile = {
      ...profile,
      mcpServers: [
        {
          name: 'ptah',
          transport: 'http',
          url: ptahUrl,
          headerReferences: { Authorization: 'ref:auth' },
          toolTimeoutSec: 960,
        },
      ],
    };
    await runtime.open(
      headerProfile,
      undefined,
      new Map([['ref:auth', 'Bearer sk-SECRET-123']]),
    );
    const params = children[0].frames.find(
      (frame) => frame['method'] === 'thread/start',
    )?.['params'];
    expect(params).toEqual(
      expect.objectContaining({
        config: {
          'mcp_servers.ptah': {
            url: ptahUrl,
            http_headers: { Authorization: 'Bearer sk-SECRET-123' },
            tool_timeout_sec: 960,
          },
        },
      }),
    );
    for (const log of Object.values(options.logger))
      expect(JSON.stringify(jest.mocked(log).mock.calls)).not.toContain(
        'sk-SECRET-123',
      );
    expect(persist).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(persist.mock.calls)).not.toContain('sk-SECRET-123');
    expect(JSON.stringify(headerProfile)).not.toContain('sk-SECRET-123');
    expect(headerProfile.profileFingerprint).not.toContain('sk-SECRET-123');
  });

  it('refuses an unresolved MCP secret reference before spawning a child', async () => {
    const failure: unknown = await runtime
      .open(
        {
          ...profile,
          mcpServers: [
            {
              name: 'ptah',
              transport: 'http',
              url: ptahUrl,
              headerReferences: { Authorization: 'ref:auth' },
            },
          ],
        },
        undefined,
        new Map(),
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CodexMcpConfigError);
    if (!(failure instanceof CodexMcpConfigError))
      throw new Error('Expected a CodexMcpConfigError');
    expect(failure.code).toBe('unresolved-reference');
    expect(failure.serverName).toBe('ptah');
    expect(failure.message).not.toContain('ref:auth');
    expect(options.spawner.spawnProcess).not.toHaveBeenCalled();
    expect(children).toHaveLength(0);
    expect(persist).not.toHaveBeenCalled();
    expect(options.logger.error).not.toHaveBeenCalled();
  });

  it('omits the config key when the profile has no MCP servers', async () => {
    await runtime.open(profile);
    const params = children[0].frames.find(
      (frame) => frame['method'] === 'thread/start',
    )?.['params'];
    expect(params).toMatchObject({ cwd: '/work', model: 'model' });
    expect(params).not.toHaveProperty('config');
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
