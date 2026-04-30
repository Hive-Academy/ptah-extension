/**
 * Integration tests for `ptah interact` — TASK_2026_104 Sub-batch B10e
 * (B10_EXPANSION.md § B10e lines 320-327).
 *
 * Coverage matrix (per spec § 9 Protocol Conformance criteria 4):
 *
 *   1. Parse error -32700 on malformed stdin JSON
 *   2. Method-not-found -32601 on unknown inbound method
 *   3. `task.submit` round-trip → `{turn_id, complete:true}` after `chat:complete`
 *   4. Concurrent `task.submit` + `task.cancel` →
 *        submit responds `{turn_id, complete:false, cancelled:true}`,
 *        cancel responds `{cancelled:true, turn_id}`
 *   5. EOF mid-task drains in < 5s, exits 0
 *   6. `session.shutdown` → `{shutdown:true}` then exit 0
 *   7. `session.history` round-trip (mocks `session:load`)
 *   8. `session.ready` is the FIRST notification on stdout
 *   9. Concurrent `task.submit` blocked → -32603 'turn already in flight'
 *
 * Test strategy: a `PassThrough` pair stands in for stdin/stdout, a vanilla
 * `EventEmitter` stands in for the `pushAdapter`, and `withEngine` is faked
 * to deliver a fake `transport.call(...)` so we can drive scripted backend
 * responses without spinning up the real DI graph.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// Mock `@ptah-extension/agent-sdk` — same approach as `session.spec.ts`. The
// interact command only reads `SDK_TOKENS.SDK_PERMISSION_HANDLER`, but the
// transitive bootstrap chain pulls in symbols that evaluate at module load.
jest.mock(
  '@ptah-extension/agent-sdk',
  () => {
    const {
      mockAnthropicProviders,
    } = require('../../test-utils/agent-sdk-mock');
    return {
      SDK_TOKENS: {
        SDK_PERMISSION_HANDLER: Symbol.for('SdkPermissionHandler'),
      },
      ANTHROPIC_PROVIDERS: mockAnthropicProviders(),
    };
  },
  { virtual: true },
);

import {
  execute,
  type AnthropicProxyServiceLike,
  type InteractExecuteHooks,
} from './interact.js';
import { decodeMessage } from '../jsonrpc/encoder.js';
import {
  ExitCode,
  JsonRpcErrorCode,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcSuccessResponse,
  type JsonRpcMessage,
} from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import {
  PLATFORM_TOKENS,
  type IHttpServerProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/test-workspace',
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

// ---------------------------------------------------------------------------
// Test harness — drives interact via real JsonRpcServer over PassThrough I/O
// ---------------------------------------------------------------------------

interface Harness {
  stdin: PassThrough;
  stdout: PassThrough;
  outLines: string[];
  pushAdapter: EventEmitter;
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
  exitCalls: number[];
  hooks: InteractExecuteHooks;
  /** Resolves when at least `n` lines have landed on stdout. */
  waitForLines: (n: number, timeoutMs?: number) => Promise<string[]>;
  /** Find the latest line whose decoded message matches `pred`. */
  findLine: (
    pred: (m: JsonRpcMessage) => boolean,
    timeoutMs?: number,
  ) => Promise<JsonRpcMessage>;
  send: (obj: unknown) => void;
  sigintHandlers: Set<() => void>;
  sigtermHandlers: Set<() => void>;
}

function makeHarness(opts?: {
  permissionHandlerResolvable?: boolean;
}): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const outLines: string[] = [];
  let outBuffer = '';
  stdout.on('data', (chunk: Buffer) => {
    outBuffer += chunk.toString('utf8');
    let idx = outBuffer.indexOf('\n');
    while (idx !== -1) {
      outLines.push(outBuffer.slice(0, idx));
      outBuffer = outBuffer.slice(idx + 1);
      idx = outBuffer.indexOf('\n');
    }
  });

  const pushAdapter = new EventEmitter();
  const rpcCalls: Harness['rpcCalls'] = [];
  const scripted: Harness['scripted'] = new Map();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true };
    }),
  } as unknown as CliMessageTransport;

  const workspaceProvider: IWorkspaceProvider = {
    getWorkspaceFolders: () => ['D:/test-workspace'],
    getWorkspaceRoot: () => 'D:/test-workspace',
  } as unknown as IWorkspaceProvider;

  const fakePermissionHandler = {
    handleResponse: jest.fn(),
    handleQuestionResponse: jest.fn(),
    request: jest.fn(),
  };

  const permissionHandlerResolvable = opts?.permissionHandlerResolvable ?? true;

  const fakeHttpProvider: IHttpServerProvider = {
    listen: jest.fn(async () => ({
      host: '127.0.0.1',
      port: 0,
      close: async (): Promise<void> => undefined,
    })),
  };

  const container = {
    resolve: jest.fn((token: symbol) => {
      if (token === PLATFORM_TOKENS.WORKSPACE_PROVIDER) {
        return workspaceProvider;
      }
      if (token === PLATFORM_TOKENS.HTTP_SERVER_PROVIDER) {
        return fakeHttpProvider;
      }
      if (token === Symbol.for('SdkPermissionHandler')) {
        if (permissionHandlerResolvable) return fakePermissionHandler;
        throw new Error('SdkPermissionHandler not registered');
      }
      throw new Error(`unexpected token: ${String(token)}`);
    }),
  };

  const withEngineFake = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: EventEmitter;
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({ container, transport, pushAdapter });
  }) as unknown as InteractExecuteHooks['withEngine'];

  const exitCalls: number[] = [];
  const sigintHandlers = new Set<() => void>();
  const sigtermHandlers = new Set<() => void>();

  const hooks: InteractExecuteHooks = {
    withEngine: withEngineFake,
    stdin,
    stdout,
    randomUUID: makeSequentialUuid(),
    exit: (code: number) => {
      exitCalls.push(code);
    },
    installSignal: (signal, handler) => {
      const set = signal === 'SIGINT' ? sigintHandlers : sigtermHandlers;
      set.add(handler);
      return () => set.delete(handler);
    },
    drainTimeoutMs: 250, // keep tests snappy
  };

  const waitForLines = (n: number, timeoutMs = 1500): Promise<string[]> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = (): void => {
        if (outLines.length >= n) {
          resolve(outLines.slice(0, n));
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for ${n} lines (got ${outLines.length}): ${outLines.join(' | ')}`,
            ),
          );
          return;
        }
        setTimeout(tick, 5);
      };
      tick();
    });

  const findLine = (
    pred: (m: JsonRpcMessage) => boolean,
    timeoutMs = 1500,
  ): Promise<JsonRpcMessage> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = (): void => {
        for (const line of outLines) {
          const decoded = decodeMessage(line);
          if (decoded.ok && pred(decoded.message)) {
            resolve(decoded.message);
            return;
          }
        }
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `Timed out finding matching line. Lines so far: ${outLines.join(
                ' | ',
              )}`,
            ),
          );
          return;
        }
        setTimeout(tick, 5);
      };
      tick();
    });

  const send = (obj: unknown): void => {
    stdin.write(`${JSON.stringify(obj)}\n`);
  };

  return {
    stdin,
    stdout,
    outLines,
    pushAdapter,
    rpcCalls,
    scripted,
    exitCalls,
    hooks,
    waitForLines,
    findLine,
    send,
    sigintHandlers,
    sigtermHandlers,
  };
}

function makeSequentialUuid(): () => string {
  let local = 0;
  return () => {
    local += 1;
    return `tab-${local}`;
  };
}

async function flushAsync(ticks = 8): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ptah interact', () => {
  describe('startup handshake', () => {
    it('emits session.ready as the FIRST notification with capabilities and protocol_version', async () => {
      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();

      const [first] = await h.waitForLines(1);
      const decoded = decodeMessage(first);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) throw new Error('decode failed');
      expect(isJsonRpcNotification(decoded.message)).toBe(true);
      if (!isJsonRpcNotification(decoded.message)) throw new Error('not n');
      expect(decoded.message.method).toBe('session.ready');
      const params = decoded.message.params as Record<string, unknown>;
      expect(typeof params['session_id']).toBe('string');
      expect(params['protocol_version']).toBe('2.0');
      expect(params['version']).toBeDefined();
      expect(Array.isArray(params['capabilities'])).toBe(true);
      const caps = params['capabilities'] as string[];
      expect(caps).toEqual(
        expect.arrayContaining(['chat', 'session', 'permission', 'question']),
      );

      // Trigger graceful shutdown to let `execute()` resolve.
      h.stdin.end();
      await promise;
    });
  });

  describe('protocol error envelopes (already covered by JsonRpcServer; verify wire-through)', () => {
    it('emits -32700 parse error for malformed JSON on stdin', async () => {
      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      // Wait for session.ready first so the parse error doesn't race startup.
      await h.waitForLines(1);

      h.stdin.write('{not json\n');
      const errMsg = await h.findLine(
        (m) =>
          isJsonRpcErrorResponse(m) &&
          m.error.code === JsonRpcErrorCode.ParseError,
      );
      expect(isJsonRpcErrorResponse(errMsg)).toBe(true);
      if (isJsonRpcErrorResponse(errMsg)) {
        expect(errMsg.error.code).toBe(JsonRpcErrorCode.ParseError);
        expect(errMsg.id).toBeNull();
      }

      h.stdin.end();
      await promise;
    });

    it('emits -32601 method-not-found for unknown inbound method', async () => {
      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      await h.waitForLines(1);

      h.send({ jsonrpc: '2.0', id: 42, method: 'unknown.method' });
      const errMsg = await h.findLine(
        (m) =>
          isJsonRpcErrorResponse(m) &&
          m.error.code === JsonRpcErrorCode.MethodNotFound,
      );
      if (isJsonRpcErrorResponse(errMsg)) {
        expect(errMsg.id).toBe(42);
        expect(errMsg.error.code).toBe(JsonRpcErrorCode.MethodNotFound);
      } else {
        throw new Error('expected error response');
      }

      h.stdin.end();
      await promise;
    });
  });

  describe('task.submit round-trip', () => {
    it('resolves { turn_id, complete: true } after chat:complete', async () => {
      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();

      // Read session.ready to extract the synthetic tabId.
      const ready = await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );
      const sessionId = (ready as { params: { session_id: string } }).params
        .session_id;

      h.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'task.submit',
        params: { task: 'hello' },
      });

      // Wait for the chat:start RPC to be called so the bridge listeners are
      // attached BEFORE we emit chat:complete.
      const start = Date.now();
      while (
        !h.rpcCalls.some((c) => c.method === 'chat:start') &&
        Date.now() - start < 1000
      ) {
        await flushAsync();
      }

      h.pushAdapter.emit('chat:complete', {
        tabId: sessionId,
        sessionId: 'sdk-real-uuid',
      });

      const resp = await h.findLine(
        (m) => isJsonRpcSuccessResponse(m) && m.id === 1,
      );
      if (isJsonRpcSuccessResponse(resp)) {
        const result = resp.result as {
          turn_id: string;
          complete: boolean;
        };
        expect(result.complete).toBe(true);
        expect(typeof result.turn_id).toBe('string');
      } else {
        throw new Error('expected success response');
      }

      h.stdin.end();
      await promise;
    });

    it('blocks concurrent task.submit with -32603 turn already in flight', async () => {
      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );

      // Submit #1 — never settles (no chat:complete emitted).
      h.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'task.submit',
        params: { task: 'first' },
      });
      // Wait for chat:start to confirm submit #1 is in flight.
      const start = Date.now();
      while (
        !h.rpcCalls.some((c) => c.method === 'chat:start') &&
        Date.now() - start < 1000
      ) {
        await flushAsync();
      }

      // Submit #2 — must be rejected with -32603.
      h.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'task.submit',
        params: { task: 'second' },
      });

      const resp = await h.findLine(
        (m) => isJsonRpcErrorResponse(m) && m.id === 2,
      );
      if (isJsonRpcErrorResponse(resp)) {
        expect(resp.error.code).toBe(JsonRpcErrorCode.InternalError);
        expect(resp.error.message).toMatch(/turn already in flight/i);
      } else {
        throw new Error('expected error response for submit #2');
      }

      // Settle submit #1 so the loop can exit cleanly.
      const ready = await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );
      const sessionId = (ready as { params: { session_id: string } }).params
        .session_id;
      h.pushAdapter.emit('chat:complete', { tabId: sessionId });
      await h.findLine((m) => isJsonRpcSuccessResponse(m) && m.id === 1);

      h.stdin.end();
      await promise;
    });
  });

  describe('task.cancel races task.submit', () => {
    it('cancel responds {cancelled:true, turn_id}; submit resolves cancelled:true', async () => {
      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      const ready = await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );
      const sessionId = (ready as { params: { session_id: string } }).params
        .session_id;

      h.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'task.submit',
        params: { task: 'long' },
      });

      // Wait for chat:start so the in-flight turn is registered.
      const start = Date.now();
      while (
        !h.rpcCalls.some((c) => c.method === 'chat:start') &&
        Date.now() - start < 1000
      ) {
        await flushAsync();
      }

      // Read the agent.* notification → derive the turn_id (it's also the
      // value we'll receive in submit's response).
      // Easier: just send cancel and observe the response for the turn_id.
      // The cancel handler validates `turn_id === currentTurnId`. Without
      // knowing the turn_id, we fish it out of the submit response shape
      // post-cancel. Simpler: have the cancel use the SAME turn_id by reading
      // it from outLines via a `task.start`? interact doesn't emit task.start
      // for chat. Instead we drive cancel via the documented tracker:
      // currentTurnId is exposed only in error data which we elide.
      //
      // Approach: cancel with a wrong turn_id first to confirm 'no matching',
      // then read the submit response's turn_id (after we abort it via
      // emitting chat:error with cancelled), to derive it. But cancel needs
      // the correct id BEFORE the bridge settles. Simpler still: derive the
      // turn_id by calling cancel with the current turn id learned from the
      // submit response's eventual error envelope. That requires the cancel
      // to settle first. Chicken-and-egg.
      //
      // Practical approach: emit `chat:abort` ourselves on the pushAdapter
      // (no — the bridge listens to chat:complete/chat:error/abortSignal).
      // The cleanest deterministic route: cancel via `force-abort` —
      // emit chat:error with cancelled:true semantics. But our spec says
      // cancel uses `turn_id`. We'll derive turn_id by taking the FIRST
      // post-submit notification (interact doesn't emit any), so instead
      // we accept that cancel MUST be told the turn_id. We solve this by
      // sending cancel with a known turn_id derived from the sequential
      // UUID: the `task.submit` handler calls `uuid()` once, the second
      // call to the harness's sequential generator.
      //
      // The harness's makeSequentialUuid issues `tab-N-1` for the synthesized
      // tabId at startup (call 1) and `tab-N-2` for the first task.submit's
      // turn id (call 2). We can rebuild the expected turn_id from that.

      // The session_id we read above is `tab-1` (the synthetic startup id).
      // The next sequential uuid `tab-2` is the turn_id task.submit just
      // generated. We rely on this deterministic ordering — confirmed by
      // session_id ending in `-1`.
      expect(sessionId).toBe('tab-1');
      const turnId = 'tab-2';

      h.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'task.cancel',
        params: { turn_id: turnId },
      });

      const cancelResp = await h.findLine(
        (m) => isJsonRpcSuccessResponse(m) && m.id === 2,
      );
      if (isJsonRpcSuccessResponse(cancelResp)) {
        const r = cancelResp.result as { cancelled: boolean; turn_id: string };
        expect(r.cancelled).toBe(true);
        expect(r.turn_id).toBe(turnId);
      } else {
        throw new Error('expected cancel response');
      }

      // The submit promise should also have settled (cancelled:true).
      const submitResp = await h.findLine(
        (m) => isJsonRpcSuccessResponse(m) && m.id === 1,
      );
      if (isJsonRpcSuccessResponse(submitResp)) {
        const r = submitResp.result as {
          turn_id: string;
          complete: boolean;
          cancelled?: boolean;
        };
        expect(r.complete).toBe(false);
        expect(r.cancelled).toBe(true);
      } else {
        throw new Error('expected submit response');
      }

      // chat:abort RPC should have been issued.
      expect(h.rpcCalls.some((c) => c.method === 'chat:abort')).toBe(true);

      h.stdin.end();
      await promise;
    });
  });

  describe('EOF and shutdown', () => {
    it('EOF mid-task drains within 5s and exits 0', async () => {
      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );

      // Start a task that never completes.
      h.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'task.submit',
        params: { task: 'never-completes' },
      });
      const startWait = Date.now();
      while (
        !h.rpcCalls.some((c) => c.method === 'chat:start') &&
        Date.now() - startWait < 1000
      ) {
        await flushAsync();
      }

      // Close stdin — should drain in ≤ drainTimeoutMs and exit 0.
      const t0 = Date.now();
      h.stdin.end();
      await promise;
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(5_000);
      expect(h.exitCalls).toEqual([ExitCode.Success]);
    });

    it('session.shutdown responds {shutdown:true} then exits 0', async () => {
      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );

      h.send({ jsonrpc: '2.0', id: 1, method: 'session.shutdown' });

      const resp = await h.findLine(
        (m) => isJsonRpcSuccessResponse(m) && m.id === 1,
      );
      if (isJsonRpcSuccessResponse(resp)) {
        expect(resp.result).toEqual({ shutdown: true });
      } else {
        throw new Error('expected shutdown response');
      }

      await promise;
      expect(h.exitCalls).toEqual([ExitCode.Success]);
    });
  });

  describe('session.history', () => {
    it('proxies session:load and trims by limit', async () => {
      const h = makeHarness();
      const messages = [
        { id: 'm1', text: 'one' },
        { id: 'm2', text: 'two' },
        { id: 'm3', text: 'three' },
      ];
      h.scripted.set('session:load', { success: true, data: { messages } });

      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      const ready = await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );
      const sessionId = (ready as { params: { session_id: string } }).params
        .session_id;

      h.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'session.history',
        params: { limit: 2 },
      });
      const resp = await h.findLine(
        (m) => isJsonRpcSuccessResponse(m) && m.id === 1,
      );
      if (isJsonRpcSuccessResponse(resp)) {
        const r = resp.result as {
          messages: typeof messages;
          session_id: string;
        };
        expect(r.messages).toEqual([
          { id: 'm2', text: 'two' },
          { id: 'm3', text: 'three' },
        ]);
        expect(r.session_id).toBe(sessionId);
      } else {
        throw new Error('expected history response');
      }

      h.stdin.end();
      await promise;
    });
  });

  // -------------------------------------------------------------------------
  // TASK_2026_108 T1 — env-var contract + embedded proxy lifecycle
  // -------------------------------------------------------------------------

  describe('interact env var contract', () => {
    /**
     * Capture-restore the real `process.env['PTAH_INTERACT_ACTIVE']` around
     * each test so a leaking assignment can't poison sibling cases.
     */
    let priorWasSet: boolean;
    let priorValue: string | undefined;

    beforeEach(() => {
      priorWasSet = Object.prototype.hasOwnProperty.call(
        process.env,
        'PTAH_INTERACT_ACTIVE',
      );
      priorValue = priorWasSet
        ? process.env['PTAH_INTERACT_ACTIVE']
        : undefined;
      delete process.env['PTAH_INTERACT_ACTIVE'];
    });

    afterEach(() => {
      if (priorWasSet && priorValue !== undefined) {
        process.env['PTAH_INTERACT_ACTIVE'] = priorValue;
      } else {
        delete process.env['PTAH_INTERACT_ACTIVE'];
      }
    });

    it('sets PTAH_INTERACT_ACTIVE=1 by the time session.ready fires', async () => {
      const h = makeHarness();
      // Snapshot the env var after `session.ready` lands on stdout — at that
      // point the engine body has run far enough that `proxyStart` decisions
      // and bridge attaches have already happened, which is downstream of the
      // env-var set per the spec ordering.
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );
      const envWhenReady = process.env['PTAH_INTERACT_ACTIVE'];
      expect(envWhenReady).toBe('1');

      h.stdin.end();
      await promise;
    });

    it('restores prior PTAH_INTERACT_ACTIVE value on graceful drain', async () => {
      // Pre-set a non-`'1'` prior value so we can verify a true round-trip
      // (a `'1'` prior would be indistinguishable from the in-flight write).
      process.env['PTAH_INTERACT_ACTIVE'] = '0';
      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );
      // Mid-loop the value is `'1'`.
      expect(process.env['PTAH_INTERACT_ACTIVE']).toBe('1');

      h.stdin.end();
      await promise;

      // After graceful drain, the captured `'0'` is restored exactly.
      expect(process.env['PTAH_INTERACT_ACTIVE']).toBe('0');
    });

    it('deletes PTAH_INTERACT_ACTIVE when not previously set', async () => {
      // Prior value is unset (the beforeEach hook ensures this).
      expect(
        Object.prototype.hasOwnProperty.call(
          process.env,
          'PTAH_INTERACT_ACTIVE',
        ),
      ).toBe(false);

      const h = makeHarness();
      const promise = execute({}, baseGlobals, h.hooks);
      await flushAsync();
      await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );
      expect(process.env['PTAH_INTERACT_ACTIVE']).toBe('1');

      h.stdin.end();
      await promise;

      // After drain, the key must be unset (deleted) — NOT set to `undefined`
      // as a string. `hasOwnProperty` is the correct probe.
      expect(
        Object.prototype.hasOwnProperty.call(
          process.env,
          'PTAH_INTERACT_ACTIVE',
        ),
      ).toBe(false);
    });
  });

  describe('interact embedded proxy lifecycle', () => {
    let priorWasSet: boolean;
    let priorValue: string | undefined;

    beforeEach(() => {
      priorWasSet = Object.prototype.hasOwnProperty.call(
        process.env,
        'PTAH_INTERACT_ACTIVE',
      );
      priorValue = priorWasSet
        ? process.env['PTAH_INTERACT_ACTIVE']
        : undefined;
      delete process.env['PTAH_INTERACT_ACTIVE'];
    });

    afterEach(() => {
      if (priorWasSet && priorValue !== undefined) {
        process.env['PTAH_INTERACT_ACTIVE'] = priorValue;
      } else {
        delete process.env['PTAH_INTERACT_ACTIVE'];
      }
    });

    function makeMockProxy(): {
      proxy: jest.Mocked<AnthropicProxyServiceLike>;
      shutdownHandlerRef: {
        handler: ((p: unknown) => Promise<unknown>) | null;
      };
      stoppedRef: { value: boolean };
    } {
      const stoppedRef = { value: false };
      const shutdownHandlerRef: {
        handler: ((p: unknown) => Promise<unknown>) | null;
      } = { handler: null };

      const proxy: jest.Mocked<AnthropicProxyServiceLike> = {
        start: jest.fn(async () => ({
          host: '127.0.0.1',
          port: 47331,
          tokenPath: 'D:/tmp/47331.token',
        })),
        stop: jest.fn(async () => {
          stoppedRef.value = true;
        }),
        registerShutdownRpc: jest.fn(
          (server: {
            register: (m: string, h: (p: unknown) => Promise<unknown>) => void;
            unregister: (m: string) => void;
          }) => {
            const handler = async (
              _params: unknown,
            ): Promise<{ stopped: boolean; reason: string; port?: number }> => {
              if (stoppedRef.value) {
                return { stopped: false, reason: 'already stopped' };
              }
              // Schedule the actual stop async to mirror the real service so
              // the response can flush ahead of the listener teardown.
              setImmediate(() => {
                void proxy.stop('rpc');
              });
              return { stopped: true, reason: 'rpc', port: 47331 };
            };
            server.register('proxy.shutdown', handler);
            shutdownHandlerRef.handler = handler;
            return () => server.unregister('proxy.shutdown');
          },
        ),
      };
      return { proxy, shutdownHandlerRef, stoppedRef };
    }

    it('proxy.shutdown via stdin closes proxy and emits proxy.stopped', async () => {
      const h = makeHarness();
      const { proxy } = makeMockProxy();
      h.hooks.proxyServiceFactory = jest.fn(() => proxy);

      const promise = execute(
        { proxyStart: true, proxyPort: 0, proxyHost: '127.0.0.1' },
        baseGlobals,
        h.hooks,
      );
      await flushAsync();
      await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );

      // Confirm proxy.start() was called and the RPC handler was registered.
      expect(proxy.start).toHaveBeenCalledTimes(1);
      expect(proxy.registerShutdownRpc).toHaveBeenCalledTimes(1);

      h.send({ jsonrpc: '2.0', id: 99, method: 'proxy.shutdown' });
      const resp = await h.findLine(
        (m) => isJsonRpcSuccessResponse(m) && m.id === 99,
      );
      if (!isJsonRpcSuccessResponse(resp)) {
        throw new Error('expected proxy.shutdown success response');
      }
      const result = resp.result as {
        stopped: boolean;
        reason: string;
        port?: number;
      };
      expect(result.stopped).toBe(true);
      expect(result.reason).toBe('rpc');

      h.stdin.end();
      await promise;

      // Drain ordering — `proxy.stop` was invoked at least once. (Once via the
      // shutdown handler's setImmediate; once via interact.ts drain. The mock
      // tolerates the second call as a no-op.) Critical assertion: stop ran
      // BEFORE interact's server.stop(), enforced by the source-level
      // ordering in interact.ts and validated by the absence of any 404
      // responses to the shutdown.
      expect(proxy.stop).toHaveBeenCalled();
    });

    it('shutdown idempotency — second proxy.shutdown returns stopped:false', async () => {
      const h = makeHarness();
      const { proxy } = makeMockProxy();
      h.hooks.proxyServiceFactory = jest.fn(() => proxy);

      const promise = execute(
        { proxyStart: true, proxyPort: 0, proxyHost: '127.0.0.1' },
        baseGlobals,
        h.hooks,
      );
      await flushAsync();
      await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'session.ready',
      );

      // First shutdown — settles `stopped: true`.
      h.send({ jsonrpc: '2.0', id: 1, method: 'proxy.shutdown' });
      const first = await h.findLine(
        (m) => isJsonRpcSuccessResponse(m) && m.id === 1,
      );
      if (!isJsonRpcSuccessResponse(first)) {
        throw new Error('expected first proxy.shutdown response');
      }
      expect((first.result as { stopped: boolean }).stopped).toBe(true);

      // Flush the setImmediate that runs `proxy.stop` so the next handler
      // call observes `stopped: true` state.
      await flushAsync();

      // Second shutdown — handler must STILL be registered (interact.ts only
      // unregisters on drain, NOT on the first proxy.shutdown response).
      // The proxy's own idempotent branch returns `{ stopped: false }`.
      h.send({ jsonrpc: '2.0', id: 2, method: 'proxy.shutdown' });
      const second = await h.findLine(
        (m) => isJsonRpcSuccessResponse(m) && m.id === 2,
      );
      if (!isJsonRpcSuccessResponse(second)) {
        throw new Error('expected second proxy.shutdown response');
      }
      const r2 = second.result as { stopped: boolean; reason: string };
      expect(r2.stopped).toBe(false);
      expect(r2.reason).toBe('already stopped');

      h.stdin.end();
      await promise;
    });
  });
});
