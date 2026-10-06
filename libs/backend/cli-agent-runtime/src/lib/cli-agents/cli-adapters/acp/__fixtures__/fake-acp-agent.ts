/**
 * A scripted ACP agent for specs: a raw JSON-RPC peer over in-memory
 * `TransformStream`s, plus an in-memory `AcpProcessTransport` around it.
 *
 * It speaks the wire protocol directly, so a spec drives the real SDK through
 * `connectAcp(...)` against it. `tsconfig.lib.json` excludes `__fixtures__`,
 * so this compiles only through the specs that import it. It uses no jest
 * globals and no SDK runtime value (the SDK boundary check in
 * `acp-sdk-loader.spec.ts` walks it).
 */
import type {
  AcpProcessExit,
  AcpProcessTransport,
} from '../acp-process-transport';
import type { AcpByteStream } from '../acp-sdk-loader';

/** One JSON-RPC message as the fake agent saw it from the client. */
export interface FakeAcpMessage {
  readonly jsonrpc: '2.0';
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: FakeAcpError;
}

export interface FakeAcpError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * How the fake answers one client request:
 * - `result` / `error`: answer at once;
 * - `hold`: never answer. A held `session/prompt` is answered
 *   `{stopReason: 'cancelled'}` when the client sends `session/cancel`; any
 *   other held request stays pending until the stream closes.
 */
export type FakeAcpReply =
  | { readonly result: unknown }
  | { readonly error: FakeAcpError }
  | { readonly hold: true };

export type FakeAcpHandler = (
  params: Record<string, unknown>,
  agent: FakeAcpAgent,
) => FakeAcpReply | Promise<FakeAcpReply>;

export interface FakeAcpAgentOptions {
  /** Returned by `initialize`. Default 1. */
  readonly protocolVersion?: number;
  /** Returned by `initialize`. Default: `loadSession` plus `sessionCapabilities.resume`. */
  readonly agentCapabilities?: Record<string, unknown>;
  /** Returned by `session/new`. Default `fake-session-1`. */
  readonly sessionId?: string;
  /** Advertised by `session/new`, `session/resume` and `session/load`. Default none. */
  readonly configOptions?: readonly unknown[];
  /** Replayed on `session/load`, each flagged `_meta.isReplay: true`. */
  readonly replay?: readonly unknown[];
}

export interface FakeAcpAgent {
  /** The agent's streams seen from the client: hand to `connectAcp`. */
  readonly stream: AcpByteStream;
  /** Every message the client sent, in order. */
  readonly received: readonly FakeAcpMessage[];
  /** Replace the default answer for one method. */
  handle(method: string, handler: FakeAcpHandler): void;
  /** Send a notification (any method, vendor extensions included). */
  notify(method: string, params: unknown): Promise<void>;
  /** Send a `session/update` notification, with an optional notification `_meta`. */
  sessionUpdate(
    sessionId: string,
    update: unknown,
    meta?: Record<string, unknown>,
  ): Promise<void>;
  /** Send an agent-to-client request and wait for the client's answer. */
  request(method: string, params: unknown): Promise<FakeAcpMessage>;
  /** Resolve with the first received message matching `match` (past or future). */
  next(match: (message: FakeAcpMessage) => boolean): Promise<FakeAcpMessage>;
  /** End the agent-to-client stream, as a dying process does. Idempotent. */
  close(): Promise<void>;
  /** Whether {@link close} ran. */
  readonly closed: boolean;
}

const DEFAULT_SESSION_ID = 'fake-session-1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createFakeAcpAgent(
  options: FakeAcpAgentOptions = {},
): FakeAcpAgent {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const writer = agentToClient.writable.getWriter();
  const encoder = new TextEncoder();
  const received: FakeAcpMessage[] = [];
  const waiters: Array<{
    match: (message: FakeAcpMessage) => boolean;
    resolve: (message: FakeAcpMessage) => void;
  }> = [];
  const handlers = new Map<string, FakeAcpHandler>();
  const pendingOutbound = new Map<number, (message: FakeAcpMessage) => void>();
  const heldPrompts: Array<number | string> = [];
  let nextOutboundId = 1000;
  let isClosed = false;
  /** The client tore its side of the streams down; nothing more can reach it. */
  let clientGone = false;

  const configOptions = options.configOptions ?? [];
  const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;

  const send = async (message: object): Promise<void> => {
    if (isClosed || clientGone) return;
    // The client may already have cancelled its reader (connection closed):
    // the write fails, and every later message is dropped instead of written.
    await writer
      .write(encoder.encode(JSON.stringify(message) + '\n'))
      .catch(() => {
        clientGone = true;
      });
  };

  const answer = async (
    id: number | string,
    reply: FakeAcpReply,
  ): Promise<void> => {
    if ('hold' in reply) return;
    if ('error' in reply) {
      await send({ jsonrpc: '2.0', id, error: reply.error });
      return;
    }
    await send({ jsonrpc: '2.0', id, result: reply.result });
  };

  const defaultHandlers: Record<string, FakeAcpHandler> = {
    initialize: () => ({
      result: {
        protocolVersion: options.protocolVersion ?? 1,
        agentCapabilities: options.agentCapabilities ?? {
          loadSession: true,
          sessionCapabilities: { resume: {} },
        },
        authMethods: [],
      },
    }),
    'session/new': () => ({ result: { sessionId, configOptions } }),
    'session/resume': () => ({ result: { configOptions } }),
    'session/load': async (params, agent) => {
      const target =
        typeof params['sessionId'] === 'string'
          ? params['sessionId']
          : sessionId;
      for (const update of options.replay ?? []) {
        await agent.sessionUpdate(target, update, { isReplay: true });
      }
      return { result: { configOptions } };
    },
    'session/set_config_option': () => ({ result: { configOptions } }),
    'session/prompt': () => ({ result: { stopReason: 'end_turn' } }),
  };

  const agent: FakeAcpAgent = {
    stream: {
      readable: agentToClient.readable,
      writable: clientToAgent.writable,
    },
    received,
    handle: (method, handler) => {
      handlers.set(method, handler);
    },
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
    sessionUpdate: (target, update, meta) =>
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: target,
          update,
          ...(meta ? { _meta: meta } : {}),
        },
      }),
    request: (method, params) => {
      const id = nextOutboundId++;
      const reply = new Promise<FakeAcpMessage>((resolve) => {
        pendingOutbound.set(id, resolve);
      });
      void send({ jsonrpc: '2.0', id, method, params });
      return reply;
    },
    next: (match) =>
      new Promise((resolve) => {
        const hit = received.find(match);
        if (hit) {
          resolve(hit);
        } else {
          waiters.push({ match, resolve });
        }
      }),
    close: async () => {
      if (isClosed) return;
      isClosed = true;
      if (clientGone) return;
      // Closing fails when the client already cancelled its reader.
      await writer.close().catch(() => {
        clientGone = true;
      });
    },
    get closed() {
      return isClosed;
    },
  };

  const onRequest = async (
    id: number | string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    const handler = handlers.get(method) ?? defaultHandlers[method];
    if (!handler) {
      await answer(id, {
        error: { code: -32601, message: `Method not found: ${method}` },
      });
      return;
    }
    const reply = await handler(params, agent);
    if ('hold' in reply && method === 'session/prompt') {
      heldPrompts.push(id);
    }
    await answer(id, reply);
  };

  const onMessage = (message: FakeAcpMessage): void => {
    received.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.match(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }

    if (message.method === undefined) {
      // A response to one of the agent's own requests.
      if (typeof message.id === 'number') {
        const resolve = pendingOutbound.get(message.id);
        pendingOutbound.delete(message.id);
        resolve?.(message);
      }
      return;
    }

    const params = isRecord(message.params) ? message.params : {};
    if (message.id !== undefined) {
      // A throwing scripted handler fails that request only, as a JSON-RPC error.
      const id = message.id;
      void onRequest(id, message.method, params).catch((error: unknown) =>
        answer(id, {
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
      return;
    }
    if (message.method === 'session/cancel') {
      for (const id of heldPrompts.splice(0)) {
        void answer(id, { result: { stopReason: 'cancelled' } });
      }
    }
  };

  void (async () => {
    const reader = clientToAgent.readable.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) {
          onMessage(JSON.parse(line) as FakeAcpMessage);
        }
        newline = buffered.indexOf('\n');
      }
    }
  })().catch(() => {
    // The client aborting its writable (connection torn down) fails the read.
    clientGone = true;
  });

  return agent;
}

/** An in-memory `AcpProcessTransport` around a fake agent, with a scripted exit. */
export interface FakeAcpTransport extends AcpProcessTransport {
  /** Simulate the process ending on its own: close the agent stream, settle `exited`. */
  exit(code: number | null, signal?: string | null): Promise<void>;
  /** How many times `kill()` was called. */
  readonly killCount: number;
}

/**
 * Wrap `agent` as a transport. `kill()` closes the agent stream and settles
 * `exited` with `{code: null, signal: 'SIGTERM'}`; `getPid()` returns `pid`
 * until the transport exits.
 */
export function createFakeAcpTransport(
  agent: FakeAcpAgent,
  pid = 4242,
): FakeAcpTransport {
  let settle!: (exit: AcpProcessExit) => void;
  const exited = new Promise<AcpProcessExit>((resolve) => {
    settle = resolve;
  });
  let gone = false;
  let kills = 0;

  const finish = async (exit: AcpProcessExit): Promise<void> => {
    if (gone) return;
    gone = true;
    // A real child reports 'exit' before its stdout closes; keep that order.
    settle(exit);
    await agent.close();
  };

  return {
    stream: agent.stream,
    getPid: () => (gone ? undefined : pid),
    exited,
    kill: () => {
      kills++;
      void finish({ code: null, signal: 'SIGTERM' });
    },
    exit: (code, signal = null) => finish({ code, signal }),
    get killCount() {
      return kills;
    },
  };
}
