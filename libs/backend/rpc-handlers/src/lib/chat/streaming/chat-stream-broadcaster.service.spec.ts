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
import { SessionTurnStateRegistry } from '@ptah-extension/agent-sdk';
import {
  MESSAGE_TYPES,
  type IAgentAdapter,
  type SessionId,
  type FlatStreamEventUnion,
  type BatchMessagePayload,
  type TurnStateEvent,
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
    Pick<
      IAgentAdapter,
      | 'isSessionActive'
      | 'endSession'
      | 'getSessionToken'
      | 'endSessionIfTokenMatches'
    >
  >;
  logger: jest.Mocked<Pick<Logger, 'info' | 'debug' | 'warn' | 'error'>>;
  ptahCli: jest.Mocked<
    Pick<
      ChatPtahCliService,
      'hasSession' | 'deleteSession' | 'getAgentId' | 'setSdkSessionId'
    >
  >;
  turnState: SessionTurnStateRegistry;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const webviewManager: jest.Mocked<WebviewManager> = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
  // Default posture: nothing registered under the id, so the finally block has
  // no record to tear down. Tests that exercise teardown opt in by making
  // `getSessionToken` return a token.
  const sdkAdapter = {
    isSessionActive: jest.fn().mockReturnValue(false),
    endSession: jest.fn().mockResolvedValue(undefined),
    getSessionToken: jest.fn().mockReturnValue(null),
    endSessionIfTokenMatches: jest.fn().mockResolvedValue(true),
  } as jest.Mocked<
    Pick<
      IAgentAdapter,
      | 'isSessionActive'
      | 'endSession'
      | 'getSessionToken'
      | 'endSessionIfTokenMatches'
    >
  >;
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

  // The real registry: a pure in-memory reducer, so the turn-state tests
  // observe the same transitions production does.
  const turnState = new SessionTurnStateRegistry();

  const broadcaster = new ChatStreamBroadcaster(
    logger as unknown as Logger,
    webviewManager,
    sdkAdapter as unknown as IAgentAdapter,
    subagentRegistry,
    sentryService,
    sessionMetadataStore,
    workspaceProvider,
    ptahCli as unknown as ChatPtahCliService,
    turnState,
  );

  return {
    broadcaster,
    webviewManager,
    sdkAdapter,
    ptahCli,
    logger,
    turnState,
  };
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
  //
  // Teardown now goes through `endSessionIfTokenMatches`, not a presence check:
  // the loop tears down the record it STREAMED, identified by the token read at
  // loop start, so a newer record registered under the same id survives.
  it('ends the session after a mid-stream ERROR, not just a clean exit', async () => {
    const h = makeHarness();
    h.sdkAdapter.getSessionToken.mockReturnValue('T1');

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('stream exploded');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.sdkAdapter.endSessionIfTokenMatches).toHaveBeenCalledTimes(1);
    expect(h.sdkAdapter.endSessionIfTokenMatches).toHaveBeenCalledWith(
      SESSION_ID,
      'T1',
    );
  });

  it('ends the session after a USER ABORT', async () => {
    const h = makeHarness();
    h.sdkAdapter.getSessionToken.mockReturnValue('T1');

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('Request aborted by user');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.sdkAdapter.endSessionIfTokenMatches).toHaveBeenCalledWith(
      SESSION_ID,
      'T1',
    );
  });

  it('still ends the session after a clean stream exit', async () => {
    const h = makeHarness();
    h.sdkAdapter.getSessionToken.mockReturnValue('T1');

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_complete');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.sdkAdapter.endSessionIfTokenMatches).toHaveBeenCalledWith(
      SESSION_ID,
      'T1',
    );
  });

  it('does not end a session that is no longer registered', async () => {
    const h = makeHarness();
    h.sdkAdapter.getSessionToken.mockReturnValue(null);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('stream exploded');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.sdkAdapter.endSessionIfTokenMatches).not.toHaveBeenCalled();
    expect(h.sdkAdapter.endSession).not.toHaveBeenCalled();
  });

  it('swallows an endSession failure so the fire-and-forget loop cannot reject', async () => {
    const h = makeHarness();
    h.sdkAdapter.getSessionToken.mockReturnValue('T1');
    h.sdkAdapter.endSessionIfTokenMatches.mockImplementation(() =>
      Promise.reject(new Error('teardown blew up')),
    );

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_complete');
    }

    await expect(
      h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID),
    ).resolves.toBeUndefined();
  });

  // The bug this whole primitive exists for. `chat:continue` resumes an idle
  // session and starts this loop; a follow-up `/slash` command then ends that
  // record and registers a NEW one under the SAME id, spending ~2s on harness
  // preflight before the fresh query starts. The old loop sees the end as a
  // thrown abort and lands in `finally` in that window. A presence check by id
  // says "active" — the new record IS — so the old loop used to abort the new
  // record's controller and the slash command died with "Operation aborted".
  it('does NOT end the session when a newer record owns the id before the stream throws (slash follow-up race)', async () => {
    const h = makeHarness();
    h.sdkAdapter.getSessionToken.mockReturnValue('T1');
    h.sdkAdapter.endSessionIfTokenMatches.mockResolvedValue(false);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('Request aborted by user');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.sdkAdapter.endSessionIfTokenMatches).toHaveBeenCalledWith(
      SESSION_ID,
      'T1',
    );
    expect(h.sdkAdapter.endSession).not.toHaveBeenCalled();
    expect(
      h.logger.info.mock.calls.some(([message]) =>
        String(message).includes('record was replaced before stream exit'),
      ),
    ).toBe(true);
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
    // Both buffered chunks, then the forced-idle turn_state (TASK_2026_360),
    // all ahead of chat:error.
    expect(
      broadcastsFor(h, 'chat:chunk').map(
        (p) => (p['event'] as FlatStreamEventUnion).eventType,
      ),
    ).toEqual(['text_delta', 'text_delta', 'turn_state']);
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

/** The `turn_state` chunk payloads the transport saw, in delivery order. */
function turnStateChunks(h: Harness): TurnStateEvent[] {
  return broadcastsFor(h, 'chat:chunk')
    .map((p) => p['event'] as FlatStreamEventUnion)
    .filter((e): e is TurnStateEvent => e.eventType === 'turn_state');
}

describe('ChatStreamBroadcaster.streamEventsToWebview - turn state (TASK_2026_360)', () => {
  it('pushes an idle turn_state AFTER the chunks and BEFORE chat:error when the stream throws', async () => {
    const h = makeHarness();
    h.turnState.markGenerating(SESSION_ID);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      yield makeEvent('text_delta');
      throw new Error('stream exploded');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    const chunks = broadcastsFor(h, 'chat:chunk');
    expect(chunks).toHaveLength(3);
    const last = chunks[2]['event'] as TurnStateEvent;
    expect(last.eventType).toBe('turn_state');
    expect(last).toMatchObject({
      phase: 'idle',
      terminalReason: null,
      sessionId: SESSION_ID,
    });
    expect(chunks[2]['tabId']).toBe(TAB_ID);
    expect(chunks[2]['sessionId']).toBe(SESSION_ID);

    const types = deliveredTypes(h);
    expect(types.lastIndexOf('chat:chunk')).toBeLessThan(
      types.indexOf('chat:error'),
    );
  });

  it('tags the forced idle with aborted_streaming on a USER ABORT and sends no chat:error', async () => {
    const h = makeHarness();
    h.turnState.markGenerating(SESSION_ID);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      throw new Error('Request aborted by user');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    const states = turnStateChunks(h);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      phase: 'idle',
      terminalReason: 'aborted_streaming',
    });
    expect(broadcastsFor(h, 'chat:error')).toHaveLength(0);
  });

  it('forces idle in finally when the loop exits normally mid-turn', async () => {
    const h = makeHarness();
    h.turnState.markGenerating(SESSION_ID);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    const states = turnStateChunks(h);
    expect(states).toHaveLength(1);
    expect(states[0].phase).toBe('idle');
    const types = deliveredTypes(h);
    expect(types.lastIndexOf('chat:chunk')).toBeGreaterThan(
      types.indexOf('chat:complete'),
    );
  });

  it('adds no turn_state of its own when the turn already settled, and passes the stream one through in order', async () => {
    const h = makeHarness();
    h.turnState.markGenerating(SESSION_ID);
    const settled = h.turnState.settleTurn(SESSION_ID);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
      yield makeEvent('message_complete');
      yield {
        ...makeEvent('turn_state'),
        ...settled,
      } as unknown as FlatStreamEventUnion;
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    const events = broadcastsFor(h, 'chat:chunk').map(
      (p) => (p['event'] as FlatStreamEventUnion).eventType,
    );
    expect(events).toEqual(['message_start', 'message_complete', 'turn_state']);
  });

  it('clears the registry entry when the loop exits', async () => {
    const h = makeHarness();
    h.turnState.markGenerating(SESSION_ID);
    h.turnState.settleTurn(SESSION_ID);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.turnState.get(SESSION_ID)).toBeUndefined();
  });

  it('keeps the registry entry when a newer record owns the id (slash follow-up race)', async () => {
    const h = makeHarness();
    h.sdkAdapter.getSessionToken.mockReturnValue({} as never);
    h.sdkAdapter.endSessionIfTokenMatches.mockResolvedValue(false);
    h.turnState.markGenerating(SESSION_ID);
    h.turnState.settleTurn(SESSION_ID);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    expect(h.turnState.get(SESSION_ID)?.phase).toBe('idle');
  });

  it('keys the turn state under the event session id, not the tabId it was started with', async () => {
    const h = makeHarness();
    const tabId = 'tab-as-session' as SessionId;
    h.turnState.markGenerating(SESSION_ID);

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_start'); // carries SESSION_ID
      throw new Error('stream exploded');
    }

    await h.broadcaster.streamEventsToWebview(tabId, stream(), TAB_ID);

    const states = turnStateChunks(h);
    expect(states).toHaveLength(1);
    expect(states[0].sessionId).toBe(SESSION_ID);
    expect(states[0].phase).toBe('idle');
  });
});
