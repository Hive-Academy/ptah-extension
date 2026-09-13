/**
 * AgentMessageRouter unit tests.
 *
 * Drives the router against fake handles and fake tracked records, so every
 * capability shape is exercised without spawning anything. The manager spec
 * covers the same modes end to end through `sendToAgent`.
 */
import 'reflect-metadata';

jest.mock('tsyringe', () => ({
  injectable: () => (target: unknown) => target,
  inject: () => () => undefined,
}));

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    LOGGER: Symbol('LOGGER'),
    CLI_DETECTION_SERVICE: Symbol('CLI_DETECTION_SERVICE'),
  },
  Logger: class {},
}));

import {
  AgentMessageRouter,
  MAX_PENDING_MESSAGES,
  type ContinuationDispatcher,
  type MessageRoutableAgent,
} from './agent-message-router.service';
import type { CliDetectionService } from './cli-detection.service';
import type {
  AgentMessagingCapabilities,
  SdkHandle,
} from './cli-adapters/cli-adapter.interface';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentProcessInfo, CliType } from '@ptah-extension/shared';

function createLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createDetection(
  capabilities?: AgentMessagingCapabilities,
): jest.Mocked<CliDetectionService> {
  return {
    getAdapter: jest
      .fn()
      .mockReturnValue(
        capabilities ? { capabilities: () => capabilities } : undefined,
      ),
  } as unknown as jest.Mocked<CliDetectionService>;
}

function createRecord(
  overrides: Partial<MessageRoutableAgent> & { cli?: CliType } = {},
): MessageRoutableAgent {
  const { cli, ...rest } = overrides;
  return {
    info: {
      agentId: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
      cli: cli ?? 'codex',
      task: 'work',
      workingDirectory: '/workspace/root',
      status: 'running',
      startedAt: new Date().toISOString(),
    } as unknown as AgentProcessInfo,
    subprocessReleased: false,
    pendingMessages: [],
    ...rest,
  };
}

function createDispatcher(
  impl?: (agentId: string, message: string) => Promise<void>,
): jest.Mocked<ContinuationDispatcher> {
  return {
    continueConversation: jest.fn(
      impl ?? (() => Promise.resolve()),
    ) as jest.MockedFunction<ContinuationDispatcher['continueConversation']>,
  };
}

const AGENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

describe('AgentMessageRouter', () => {
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createLogger();
  });

  describe('capability resolution', () => {
    it('reads the live handle in preference to the adapter declaration', async () => {
      // The adapter says "steer"; the handle in hand has no steer channel and
      // can only continue. The handle wins, so nothing is injected mid-turn.
      const detection = createDetection({
        steer: true,
        interrupt: false,
        continuation: true,
      });
      const router = new AgentMessageRouter(logger, detection);
      const handle = {
        supportsContinuation: () => true,
        continue: jest.fn(),
      } as unknown as SdkHandle;
      const tracked = createRecord({ sdkHandle: handle });
      const dispatcher = createDispatcher();

      const outcome = await router.route(
        AGENT_ID,
        tracked,
        'hello',
        dispatcher,
      );

      expect(outcome.mode).toBe('queue-next-turn');
      expect(tracked.pendingMessages).toEqual(['hello']);
    });

    it('falls back to the adapter declaration for a record with no handle', async () => {
      const detection = createDetection({
        steer: false,
        interrupt: false,
        continuation: false,
      });
      const router = new AgentMessageRouter(logger, detection);
      const tracked = createRecord();

      const outcome = await router.route(
        AGENT_ID,
        tracked,
        'hello',
        createDispatcher(),
      );

      expect(outcome.mode).toBe('unsupported');
    });

    it('treats a released subprocess as unable to continue', async () => {
      const router = new AgentMessageRouter(logger, createDetection());
      const handle = {
        supportsContinuation: () => true,
        continue: jest.fn(),
      } as unknown as SdkHandle;
      const tracked = createRecord({
        sdkHandle: handle,
        subprocessReleased: true,
        info: { ...createRecord().info, status: 'completed' },
      });

      const outcome = await router.route(
        AGENT_ID,
        tracked,
        'hello',
        createDispatcher(),
      );

      expect(outcome.mode).toBe('unsupported');
    });
  });

  describe('interrupt-resume', () => {
    it('awaits the turn settle before resuming', async () => {
      const router = new AgentMessageRouter(logger, createDetection());
      let settleTurn!: (code: number) => void;
      const currentTurnDone = new Promise<number>((resolve) => {
        settleTurn = resolve;
      });
      const tracked = createRecord({ currentTurnDone });
      const interrupt = jest.fn(async () => {
        // The record only leaves `running` when the turn's own settle handling
        // runs — model that as a continuation of currentTurnDone.
        void currentTurnDone.then(() => {
          tracked.info = { ...tracked.info, status: 'completed' };
        });
        settleTurn(1);
      });
      tracked.sdkHandle = {
        supportsInterrupt: () => true,
        interrupt,
        supportsContinuation: () => true,
        continue: jest.fn(),
      } as unknown as SdkHandle;

      const dispatcher = createDispatcher(async () => {
        // Asserted INSIDE the dispatcher: a resume attempted while the record
        // still reads `running` is exactly the race this test exists for.
        expect(tracked.info.status).toBe('completed');
      });

      const outcome = await router.route(
        AGENT_ID,
        tracked,
        'redirect',
        dispatcher,
      );

      expect(outcome.mode).toBe('interrupt-resume');
      expect(dispatcher.continueConversation).toHaveBeenCalledWith(
        AGENT_ID,
        'redirect',
      );
    });

    it('reports unsupported when the resume itself fails', async () => {
      const router = new AgentMessageRouter(logger, createDetection());
      const tracked = createRecord({ currentTurnDone: Promise.resolve(1) });
      tracked.sdkHandle = {
        supportsInterrupt: () => true,
        interrupt: jest.fn().mockResolvedValue(undefined),
        supportsContinuation: () => true,
        continue: jest.fn(),
      } as unknown as SdkHandle;
      const dispatcher = createDispatcher(() =>
        Promise.reject(new Error('handle is gone')),
      );

      const outcome = await router.route(
        AGENT_ID,
        tracked,
        'redirect',
        dispatcher,
      );

      expect(outcome.mode).toBe('unsupported');
      expect(outcome.detail).toContain('handle is gone');
    });
  });

  describe('the pending queue', () => {
    const continuableRecord = (): MessageRoutableAgent => {
      const tracked = createRecord();
      tracked.sdkHandle = {
        supportsContinuation: () => true,
        continue: jest.fn(),
      } as unknown as SdkHandle;
      return tracked;
    };

    it('refuses over the cap rather than dropping the message', async () => {
      const router = new AgentMessageRouter(logger, createDetection());
      const tracked = continuableRecord();
      const dispatcher = createDispatcher();

      for (let i = 0; i < MAX_PENDING_MESSAGES; i++) {
        const queued = await router.route(
          AGENT_ID,
          tracked,
          `m${i}`,
          dispatcher,
        );
        expect(queued.mode).toBe('queue-next-turn');
      }

      const refused = await router.route(
        AGENT_ID,
        tracked,
        'overflow',
        dispatcher,
      );

      expect(refused.mode).toBe('unsupported');
      expect(tracked.pendingMessages).toHaveLength(MAX_PENDING_MESSAGES);
      expect(tracked.pendingMessages).not.toContain('overflow');
    });

    it('flushes exactly one entry per settle, in arrival order', async () => {
      const router = new AgentMessageRouter(logger, createDetection());
      const tracked = continuableRecord();
      tracked.pendingMessages.push('first', 'second');
      const dispatcher = createDispatcher();

      await router.flushPending(AGENT_ID, tracked, dispatcher);

      expect(dispatcher.continueConversation).toHaveBeenCalledTimes(1);
      expect(dispatcher.continueConversation).toHaveBeenCalledWith(
        AGENT_ID,
        'first',
      );
      expect(tracked.pendingMessages).toEqual(['second']);
    });

    it('is a no-op when nothing is queued', async () => {
      const router = new AgentMessageRouter(logger, createDetection());
      const dispatcher = createDispatcher();

      await router.flushPending(AGENT_ID, continuableRecord(), dispatcher);

      expect(dispatcher.continueConversation).not.toHaveBeenCalled();
    });

    it('drops the queue loudly when the subprocess was released', async () => {
      const router = new AgentMessageRouter(logger, createDetection());
      const tracked = continuableRecord();
      tracked.subprocessReleased = true;
      tracked.pendingMessages.push('first');
      const dispatcher = createDispatcher();

      await router.flushPending(AGENT_ID, tracked, dispatcher);

      expect(dispatcher.continueConversation).not.toHaveBeenCalled();
      expect(tracked.pendingMessages).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('logs a failed delivery instead of retrying it forever', async () => {
      const router = new AgentMessageRouter(logger, createDetection());
      const tracked = continuableRecord();
      tracked.pendingMessages.push('first');
      const dispatcher = createDispatcher(() =>
        Promise.reject(new Error('busy')),
      );

      await router.flushPending(AGENT_ID, tracked, dispatcher);

      expect(logger.error).toHaveBeenCalled();
      expect(tracked.pendingMessages).toEqual([]);
    });

    it('discardPending clears and reports what was still waiting', () => {
      const router = new AgentMessageRouter(logger, createDetection());
      const tracked = continuableRecord();
      tracked.pendingMessages.push('a', 'b');

      router.discardPending(AGENT_ID, tracked);

      expect(tracked.pendingMessages).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Discarded queued messages'),
        expect.objectContaining({ dropped: 2 }),
      );
    });
  });

  it('logs the selected mode with the agent id and the CLI', async () => {
    const router = new AgentMessageRouter(logger, createDetection());
    const tracked = createRecord({ cli: 'cursor' });

    await router.route(AGENT_ID, tracked, 'hello', createDispatcher());

    expect(logger.info).toHaveBeenCalledWith(
      '[AgentMessageRouter] Message routed',
      expect.objectContaining({
        agentId: AGENT_ID,
        cli: 'cursor',
        mode: 'unsupported',
      }),
    );
  });
});
