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
import type {
  IAgentAdapter,
  SessionId,
  FlatStreamEventUnion,
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

describe('ChatStreamBroadcaster.streamEventsToWebview — surfaceMode', () => {
  function broadcastsFor(
    h: Harness,
    type: string,
  ): Array<Record<string, unknown>> {
    return (h.webviewManager.broadcastMessage as jest.Mock).mock.calls
      .filter(([t]) => t === type)
      .map(([, payload]) => payload as Record<string, unknown>);
  }

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

    for (const chunk of broadcastsFor(h, 'chat:chunk')) {
      expect(chunk['surfaceMode']).toBe(true);
    }
    for (const complete of broadcastsFor(h, 'chat:complete')) {
      expect(complete['surfaceMode']).toBe(true);
    }
  });

  it('omits surfaceMode when the flag is not passed', async () => {
    const h = makeHarness();

    async function* stream(): AsyncGenerator<FlatStreamEventUnion> {
      yield makeEvent('message_complete');
    }

    await h.broadcaster.streamEventsToWebview(SESSION_ID, stream(), TAB_ID);

    for (const chunk of broadcastsFor(h, 'chat:chunk')) {
      expect(chunk).not.toHaveProperty('surfaceMode');
    }
    for (const complete of broadcastsFor(h, 'chat:complete')) {
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
