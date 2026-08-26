/**
 * ChatStreamBroadcaster — in-flight streaming tracking specs.
 *
 * Surface under test: the `streamingSessionIds` Set lifecycle exposed via
 * `isStreaming(sessionId)`. Contract locked here:
 *   - sessionId is present WHILE the stream loop is running.
 *   - sessionId is removed after NORMAL completion.
 *   - sessionId is removed after an ERROR thrown by the stream.
 *   - sessionId is removed after a USER ABORT (abort-tagged error).
 *
 * Mocking posture: direct constructor injection, narrow jest.Mocked
 * surfaces, no `as any` casts. The streaming loop is driven by a
 * hand-rolled async iterable so the test can observe `isStreaming` mid-flight.
 */

import 'reflect-metadata';

import type {
  Logger,
  SubagentRegistryService,
  SentryService,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import {
  MESSAGE_TYPES,
  type IAgentAdapter,
  type SessionId,
  type FlatStreamEventUnion,
  type BatchMessagePayload,
} from '@ptah-extension/shared';

import {
  ChatStreamBroadcaster,
  type WebviewManager,
} from './chat-stream-broadcaster.service';
import type { ChatPtahCliService } from '../ptah-cli/chat-ptah-cli.service';

const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' as SessionId;
const TAB_ID = 'tab-1';

function createMockLogger(): jest.Mocked<
  Pick<Logger, 'info' | 'debug' | 'warn' | 'error'>
> {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

interface Harness {
  broadcaster: ChatStreamBroadcaster;
  webviewManager: jest.Mocked<WebviewManager>;
  sdkAdapter: jest.Mocked<
    Pick<IAgentAdapter, 'isSessionActive' | 'endSession'>
  >;
  ptahCli: jest.Mocked<
    Pick<
      ChatPtahCliService,
      'hasSession' | 'deleteSession' | 'getAgentId' | 'setSdkSessionId'
    >
  >;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const webviewManager: jest.Mocked<WebviewManager> = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
  const sdkAdapter = {
    isSessionActive: jest.fn().mockReturnValue(false),
    endSession: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<Pick<IAgentAdapter, 'isSessionActive' | 'endSession'>>;
  const subagentRegistry = {
    update: jest.fn(),
  } as unknown as SubagentRegistryService;
  const sentryService = {
    captureException: jest.fn(),
  } as unknown as SentryService;
  const sessionMetadataStore = {
    createChild: jest.fn().mockResolvedValue(undefined),
  } as unknown as SessionMetadataStore;
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue('/fake/workspace'),
  } as unknown as IWorkspaceProvider;
  const ptahCli = {
    hasSession: jest.fn().mockReturnValue(false),
    deleteSession: jest.fn(),
    getAgentId: jest.fn().mockReturnValue(undefined),
    setSdkSessionId: jest.fn(),
  } as jest.Mocked<
    Pick<
      ChatPtahCliService,
      'hasSession' | 'deleteSession' | 'getAgentId' | 'setSdkSessionId'
    >
  >;

  const broadcaster = new ChatStreamBroadcaster(
    logger as unknown as Logger,
    webviewManager,
    sdkAdapter as unknown as IAgentAdapter,
    subagentRegistry,
    sentryService,
    sessionMetadataStore,
    workspaceProvider,
    ptahCli as unknown as ChatPtahCliService,
  );

  return { broadcaster, webviewManager, sdkAdapter, ptahCli };
}

function makeEvent(eventType: string): FlatStreamEventUnion {
  return {
    eventType,
    sessionId: SESSION_ID,
    messageId: 'msg-1',
  } as unknown as FlatStreamEventUnion;
}

describe('ChatStreamBroadcaster.isStreaming', () => {
  it('marks the session streaming WHILE the loop runs and clears it after NORMAL completion', async () => {
    const h = makeHarness();
    let observedMidStream = false;

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      observedMidStream = h.broadcaster.isStreaming(SESSION_ID as string);
      yield makeEvent('message_complete');
    }

    expect(h.broadcaster.isStreaming(SESSION_ID as string)).toBe(false);
    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(observedMidStream).toBe(true);
    expect(h.broadcaster.isStreaming(SESSION_ID as string)).toBe(false);
  });

  it('clears the session after the stream throws a generic ERROR', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('stream exploded');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.broadcaster.isStreaming(SESSION_ID as string)).toBe(false);
  });

  it('clears the session after a USER ABORT (abort-tagged error)', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('Request aborted by user');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.broadcaster.isStreaming(SESSION_ID as string)).toBe(false);
  });

  it('returns false for an unknown session', () => {
    const h = makeHarness();
    expect(h.broadcaster.isStreaming('never-streamed')).toBe(false);
  });
});

describe('ChatStreamBroadcaster.streamEventsToWebview — session teardown', () => {
  // Regression: cleanup used to be gated on `streamExitedNormally`, so a stream
  // that threw MID-FLIGHT (provider drop, transport close) left the registry
  // record alive with no consumer attached. `isSessionActive` — which only
  // proves registry presence — then reported that corpse as active, so the next
  // `chat:continue` skipped auto-resume and queued the user's message against a
  // dead query: the turn hung forever with no events, no error, and no watchdog.
  //
  // These cases yield one event before failing, so `eventCount > 0` and the
  // `isCorruptedResume` branch (eventCount === 0) cannot be what ends the
  // session — the assertion is non-vacuously about the finally block.
  it('ends the session after a mid-stream ERROR, not just a clean exit', async () => {
    const h = makeHarness();
    h.sdkAdapter.isSessionActive.mockReturnValue(true);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('stream exploded');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.sdkAdapter.endSession).toHaveBeenCalledTimes(1);
    expect(h.sdkAdapter.endSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it('ends the session after a USER ABORT', async () => {
    const h = makeHarness();
    h.sdkAdapter.isSessionActive.mockReturnValue(true);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('Request aborted by user');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.sdkAdapter.endSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it('still ends the session after a clean stream exit', async () => {
    const h = makeHarness();
    h.sdkAdapter.isSessionActive.mockReturnValue(true);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_complete');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.sdkAdapter.endSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it('does not end a session that is no longer registered', async () => {
    const h = makeHarness();
    h.sdkAdapter.isSessionActive.mockReturnValue(false);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('stream exploded');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.sdkAdapter.endSession).not.toHaveBeenCalled();
  });

  it('swallows an endSession failure so the fire-and-forget loop cannot reject', async () => {
    const h = makeHarness();
    h.sdkAdapter.isSessionActive.mockReturnValue(true);
    h.sdkAdapter.endSession.mockImplementation(() =>
      Promise.reject(new Error('teardown blew up')),
    );

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_complete');
    }

    await expect(
      h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID),
    ).resolves.toBeUndefined();
  });
});

/**
 * Every payload of `type` the broadcaster delivered, with BATCH envelopes
 * expanded back into their members.
 *
 * Chunks are coalesced (TASK_2026_323 B7), so reading `broadcastMessage` calls
 * directly finds zero `chat:chunk` entries and every assertion over them passes
 * VACUOUSLY. Unwrapping here is what keeps these tests about the payloads the
 * frontend actually receives — the router expands batches the same way.
 */
function broadcastsFor(
  h: Harness,
  type: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const [sentType, payload] of (
    h.webviewManager.broadcastMessage as jest.Mock
  ).mock.calls) {
    if (sentType === MESSAGE_TYPES.BATCH) {
      for (const inner of (payload as BatchMessagePayload).events) {
        if (inner.type === type) {
          out.push(inner.payload as Record<string, unknown>);
        }
      }
      continue;
    }
    if (sentType === type) out.push(payload as Record<string, unknown>);
  }
  return out;
}

/** Ordered list of the message types the transport saw, batches expanded. */
function deliveredTypes(h: Harness): string[] {
  const out: string[] = [];
  for (const [sentType, payload] of (
    h.webviewManager.broadcastMessage as jest.Mock
  ).mock.calls) {
    if (sentType === MESSAGE_TYPES.BATCH) {
      for (const inner of (payload as BatchMessagePayload).events) {
        out.push(inner.type);
      }
      continue;
    }
    out.push(sentType as string);
  }
  return out;
}

describe('ChatStreamBroadcaster.streamEventsToWebview — surfaceMode', () => {
  it('threads surfaceMode:true into CHAT_CHUNK and CHAT_COMPLETE payloads', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      yield makeEvent('message_complete');
    }

    await h.broadcaster.streamEventsToWebview(
      SESSION_ID,
      stream(),
      TAB_ID,
      true,
    );

    const chunks = broadcastsFor(h, 'chat:chunk');
    const completes = broadcastsFor(h, 'chat:complete');
    // Non-vacuity guard: without it, coalescing the chunks away would make
    // every assertion below pass by iterating nothing.
    expect(chunks).toHaveLength(2);
    expect(completes).toHaveLength(1);
    for (const chunk of chunks) {
      expect(chunk['surfaceMode']).toBe(true);
    }
    for (const complete of completes) {
      expect(complete['surfaceMode']).toBe(true);
    }
  });

  it('omits surfaceMode when the flag is not passed', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_complete');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    const chunks = broadcastsFor(h, 'chat:chunk');
    const completes = broadcastsFor(h, 'chat:complete');
    expect(chunks).toHaveLength(1);
    expect(completes).toHaveLength(1);
    for (const chunk of chunks) {
      expect(chunk).not.toHaveProperty('surfaceMode');
    }
    for (const complete of completes) {
      expect(complete).not.toHaveProperty('surfaceMode');
    }
  });

  it('threads surfaceMode:true into the CHAT_ERROR payload', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('stream exploded');
    }

    await h.broadcaster.streamEventsToWebview(
      SESSION_ID,
      stream(),
      TAB_ID,
      true,
    );

    const errors = broadcastsFor(h, 'chat:error');
    expect(errors.length).toBeGreaterThan(0);
    for (const err of errors) {
      expect(err['surfaceMode']).toBe(true);
    }
  });
});

describe('ChatStreamBroadcaster.streamEventsToWebview — chunk coalescing (B7)', () => {
  function makeIndexedEvent(i: number): FlatStreamEventUnion {
    return {
      eventType: 'text_delta',
      sessionId: SESSION_ID,
      messageId: `msg-${i}`,
    } as unknown as FlatStreamEventUnion;
  }

  it('costs ceil(200/64) sends for a 200-event burst, not 200', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      for (let i = 0; i < 200; i++) yield makeIndexedEvent(i);
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    // An async generator yields on the microtask queue, so all 200 events are
    // buffered before the 16 ms window can ever fire: every send here is a
    // size-cap flush plus the final drain on loop exit.
    const batches = (
      h.webviewManager.broadcastMessage as jest.Mock
    ).mock.calls.filter(([type]) => type === MESSAGE_TYPES.BATCH);
    expect(batches.length).toBeLessThanOrEqual(Math.ceil(200 / 64));
    expect(broadcastsFor(h, 'chat:chunk')).toHaveLength(200);
  });

  it('preserves event order through coalescing', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      for (let i = 0; i < 200; i++) yield makeIndexedEvent(i);
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    const ids = broadcastsFor(h, 'chat:chunk').map(
      (payload) => (payload['event'] as { messageId: string }).messageId,
    );
    expect(ids).toEqual(Array.from({ length: 200 }, (_, i) => `msg-${i}`));
  });

  it('flushes buffered chunks BEFORE chat:complete so a turn cannot close early', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeIndexedEvent(0);
      yield makeIndexedEvent(1);
      yield makeEvent('message_complete');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    const types = deliveredTypes(h);
    const lastChunk = types.lastIndexOf('chat:chunk');
    const complete = types.indexOf('chat:complete');
    expect(complete).toBeGreaterThan(-1);
    expect(lastChunk).toBeLessThan(complete);
  });

  it('flushes buffered chunks BEFORE chat:error so partial output is not lost', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeIndexedEvent(0);
      yield makeIndexedEvent(1);
      throw new Error('stream exploded');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    const types = deliveredTypes(h);
    expect(broadcastsFor(h, 'chat:chunk')).toHaveLength(2);
    expect(types.lastIndexOf('chat:chunk')).toBeLessThan(
      types.indexOf('chat:error'),
    );
  });

  it('delivers a single chunk BARE, exactly as before batching', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeIndexedEvent(0);
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    const calls = (h.webviewManager.broadcastMessage as jest.Mock).mock.calls;
    expect(calls.some(([type]) => type === MESSAGE_TYPES.BATCH)).toBe(false);
    expect(calls.some(([type]) => type === 'chat:chunk')).toBe(true);
  });

  it('does not await each chunk, so a slow transport cannot stall the drain', async () => {
    const h = makeHarness();
    let resolveTransport: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveTransport = resolve;
    });
    // Every send parks until released. If the loop awaited chunk delivery, it
    // could not reach the end of the stream at all.
    h.webviewManager.broadcastMessage.mockImplementation(() => gate);

    let drained = 0;
    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      for (let i = 0; i < 100; i++) {
        drained++;
        yield makeIndexedEvent(i);
      }
    }

    const running = h.broadcaster.streamEventsToWebview(
      SESSION_ID,
      stream(),
      TAB_ID,
    );
    // Let the microtask queue run to exhaustion with the transport still stuck.
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    expect(drained).toBe(100);

    resolveTransport?.();
    await running;
  });
});
