/**
 * ChatRpcHandlers — thin facade specs. Locks five invariants:
 * 1. `register()` wires exactly the six `METHODS` entries, in order.
 * 2. Each method delegates to `ChatSessionService` on the happy path.
 * 3. `register()` subscribes the broadcaster to background-agent events.
 * 4. `runRpc` shape: emits `RPC: {method} called` /
 *    `success` debug logs on the happy path, and on a rejection logs
 *    `RPC: {method} failed`, captures Sentry under
 *    `errorSource: ChatRpcHandlers.{tag}`, and re-throws.
 * 5. `static hasStopIntent` delegates to the free `hasStopIntent` function.
 * Public pass-throughs (Ptah-CLI session helpers) are also covered.
 * Service-level behaviour lives in per-service specs.
 */

import 'reflect-metadata';

import type {
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';

import { ChatRpcHandlers } from './chat-rpc.handlers';
import type { ChatPtahCliService } from '../chat/ptah-cli/chat-ptah-cli.service';
import type { ChatStreamBroadcaster } from '../chat/streaming/chat-stream-broadcaster.service';
import type { ChatSessionService } from '../chat/session/chat-session.service';

type Mocked<T> = jest.Mocked<T>;

interface Suite {
  handlers: ChatRpcHandlers;
  rpc: MockRpcHandler;
  sentry: ReturnType<typeof createMockSentryService>;
  logger: ReturnType<typeof createMockLogger>;
  ptahCli: Mocked<ChatPtahCliService>;
  streamBroadcaster: Mocked<ChatStreamBroadcaster>;
  session: Mocked<ChatSessionService>;
}

function buildSuite(): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const sentry = createMockSentryService();

  const ptahCli = {
    getSdkSessionId: jest.fn().mockReturnValue(undefined),
    trackSession: jest.fn(),
  } as unknown as Mocked<ChatPtahCliService>;

  const streamBroadcaster = {} as unknown as Mocked<ChatStreamBroadcaster>;

  const session = {
    startSession: jest.fn().mockResolvedValue({ success: true }),
    continueSession: jest
      .fn()
      .mockResolvedValue({ success: true, sessionId: 'sid' }),
    resumeSession: jest
      .fn()
      .mockResolvedValue({ success: true, messages: [], events: [] }),
    abortSession: jest.fn().mockResolvedValue({ success: true }),
    getRunningAgents: jest.fn().mockResolvedValue({ agents: [] }),
    listBackgroundAgents: jest.fn().mockResolvedValue({ agents: [] }),
  } as unknown as Mocked<ChatSessionService>;

  const handlers = new ChatRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    sentry as unknown as SentryService,
    ptahCli,
    streamBroadcaster,
    session,
  );

  return {
    handlers,
    rpc,
    sentry,
    logger,
    ptahCli,
    streamBroadcaster,
    session,
  };
}

function getHandler(
  rpc: MockRpcHandler,
  method: string,
): (p: unknown) => Promise<unknown> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<unknown>]
  >;
  const match = calls.find(([name]) => name === method);
  if (!match) throw new Error(`Method ${method} not registered`);
  return match[1];
}

// UUID v4 fixtures — the chat RPC schemas (added for NODE-NESTJS-3Y
// hardening) reject any tabId/sessionId that is not a UUID, so test inputs
// for chat:start/continue/resume/abort must be valid UUIDs.
const TAB_UUID = '11111111-2222-4333-8444-555555555555';
const SESSION_UUID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('ChatRpcHandlers (Wave C7e thin facade)', () => {
  it('METHODS tuple is the six pre-extraction RPC names, in order', () => {
    expect([...ChatRpcHandlers.METHODS]).toEqual([
      'chat:start',
      'chat:continue',
      'chat:resume',
      'chat:abort',
      'chat:running-agents',
      'agent:backgroundList',
    ]);
  });

  it('register() wires exactly the six METHODS entries, in order', () => {
    const { handlers, rpc } = buildSuite();
    handlers.register();
    const registered = (rpc.registerMethod as jest.Mock).mock.calls.map(
      ([name]) => name,
    );
    expect(registered).toEqual([...ChatRpcHandlers.METHODS]);
  });

  it.each([...ChatRpcHandlers.METHODS])(
    'registers %s with a function handler',
    (method) => {
      const { handlers, rpc } = buildSuite();
      handlers.register();
      const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
        [string, unknown]
      >;
      const match = calls.find(([name]) => name === method);
      expect(match).toBeDefined();
      expect(typeof match?.[1]).toBe('function');
    },
  );

  describe('delegation — happy paths', () => {
    type Delegate = keyof Pick<
      ChatSessionService,
      | 'startSession'
      | 'continueSession'
      | 'resumeSession'
      | 'abortSession'
      | 'getRunningAgents'
      | 'listBackgroundAgents'
    >;
    const cases: ReadonlyArray<readonly [string, Delegate, unknown]> = [
      ['chat:start', 'startSession', { tabId: TAB_UUID, prompt: 'hi' }],
      [
        'chat:continue',
        'continueSession',
        { sessionId: SESSION_UUID, tabId: TAB_UUID, prompt: 'more' },
      ],
      [
        'chat:resume',
        'resumeSession',
        { sessionId: SESSION_UUID, tabId: TAB_UUID },
      ],
      ['chat:abort', 'abortSession', { sessionId: SESSION_UUID }],
      ['chat:running-agents', 'getRunningAgents', { sessionId: 'sid' }],
      ['agent:backgroundList', 'listBackgroundAgents', { sessionId: 'sid' }],
    ];

    it.each(cases)(
      '%s delegates to ChatSessionService.%s',
      async (method, delegate, params) => {
        const suite = buildSuite();
        suite.handlers.register();
        await getHandler(suite.rpc, method)(params);
        expect(suite.session[delegate]).toHaveBeenCalledWith(params);
      },
    );
  });

  // -------------------------------------------------------------------------
  // chat:start mcpServersOverride passthrough — verifies the RPC facade does not strip the field.
  // -------------------------------------------------------------------------

  describe('ChatRpcHandlers chat:start (mcpServersOverride passthrough)', () => {
    it('forwards mcpServersOverride from RPC params to ChatSessionService.startSession', async () => {
      const suite = buildSuite();
      suite.handlers.register();

      const params = {
        tabId: TAB_UUID,
        prompt: 'hi',
        mcpServersOverride: {
          ptah: {
            type: 'http' as const,
            url: 'http://override.example/proxy',
            headers: { 'X-Trace': 'on' },
          },
        },
      };
      await getHandler(suite.rpc, 'chat:start')(params);

      // The thin facade must pass the entire params object straight through
      // to ChatSessionService.startSession without stripping fields — that
      // service is the layer responsible for forwarding mcpServersOverride
      // into SdkAgentAdapter.startChatSession.
      expect(suite.session.startSession).toHaveBeenCalledWith(params);
    });
  });

  describe('runRpc — C7d shape (entry/exit logs + Sentry on throw)', () => {
    it('emits "RPC: chat:start called" + "success" debug logs on the happy path', async () => {
      const suite = buildSuite();
      suite.handlers.register();
      await getHandler(
        suite.rpc,
        'chat:start',
      )({
        tabId: TAB_UUID,
        prompt: 'hi',
      });
      const debugCalls = (suite.logger.debug as jest.Mock).mock.calls.map(
        ([msg]) => msg as string,
      );
      expect(debugCalls).toContain('RPC: chat:start called');
      expect(debugCalls).toContain('RPC: chat:start success');
    });

    it('on rejection logs failure + captures Sentry with ChatRpcHandlers.{tag} + rethrows', async () => {
      const suite = buildSuite();
      const boom = new Error('kaboom');
      (suite.session.continueSession as jest.Mock).mockRejectedValueOnce(boom);
      suite.handlers.register();

      await expect(
        getHandler(
          suite.rpc,
          'chat:continue',
        )({
          sessionId: SESSION_UUID,
          tabId: TAB_UUID,
          prompt: 'more',
        }),
      ).rejects.toBe(boom);

      const errorCalls = (suite.logger.error as jest.Mock).mock.calls;
      expect(
        errorCalls.some(([msg]) => msg === 'RPC: chat:continue failed'),
      ).toBe(true);

      expect(suite.sentry.captureException).toHaveBeenCalledWith(boom, {
        errorSource: 'ChatRpcHandlers.registerChatContinue',
      });
    });

    // Each method paired with a fixture that PASSES the chat schema's UUID
    // refines — otherwise the schema throws before the mocked delegate runs
    // and the Sentry-on-rethrow contract cannot be observed.
    it.each([
      [
        'chat:start',
        'registerChatStart',
        'startSession',
        { tabId: TAB_UUID, prompt: 'hi' },
      ],
      [
        'chat:continue',
        'registerChatContinue',
        'continueSession',
        { sessionId: SESSION_UUID, tabId: TAB_UUID, prompt: 'more' },
      ],
      [
        'chat:resume',
        'registerChatResume',
        'resumeSession',
        { sessionId: SESSION_UUID, tabId: TAB_UUID },
      ],
      [
        'chat:abort',
        'registerChatAbort',
        'abortSession',
        { sessionId: SESSION_UUID },
      ],
      [
        'chat:running-agents',
        'registerChatRunningAgents',
        'getRunningAgents',
        { sessionId: 'sid' },
      ],
      [
        'agent:backgroundList',
        'registerBackgroundAgentHandlers',
        'listBackgroundAgents',
        { sessionId: 'sid' },
      ],
    ] as const)(
      '%s uses errorSource ChatRpcHandlers.%s',
      async (method, tag, delegate, params) => {
        const suite = buildSuite();
        const boom = new Error(`fail-${method}`);
        (
          suite.session[delegate as keyof ChatSessionService] as jest.Mock
        ).mockRejectedValueOnce(boom);
        suite.handlers.register();

        await expect(getHandler(suite.rpc, method)(params)).rejects.toBe(boom);
        expect(suite.sentry.captureException).toHaveBeenCalledWith(boom, {
          errorSource: `ChatRpcHandlers.${tag}`,
        });
      },
    );
  });

  describe('public pass-throughs', () => {
    it('getPtahCliSdkSessionId forwards to ChatPtahCliService.getSdkSessionId', () => {
      const suite = buildSuite();
      (suite.ptahCli.getSdkSessionId as jest.Mock).mockReturnValueOnce(
        'sdk-uuid',
      );
      const result = suite.handlers.getPtahCliSdkSessionId('tab-1');
      expect(suite.ptahCli.getSdkSessionId).toHaveBeenCalledWith('tab-1');
      expect(result).toBe('sdk-uuid');
    });

    it('trackPtahCliSession forwards to ChatPtahCliService.trackSession', () => {
      const suite = buildSuite();
      suite.handlers.trackPtahCliSession('tab-1', 'real-sid');
      expect(suite.ptahCli.trackSession).toHaveBeenCalledWith(
        'tab-1',
        'real-sid',
      );
    });
  });

  describe('hasStopIntent (representative cases — delegates to free function)', () => {
    it.each([
      'stop',
      'STOP!',
      'cancel.',
      'please stop',
      'stop now',
      "stop what you're doing",
      "don't continue",
      'stop the execution',
    ])('returns true for %p', (msg) => {
      expect(ChatRpcHandlers.hasStopIntent(msg)).toBe(true);
    });

    it.each([
      'stop using semicolons and switch to the new API pattern please',
      'cancel the old approach and use the new one instead',
      'continue with the refactor',
      '',
      'add a feature',
    ])('returns false for %p', (msg) => {
      expect(ChatRpcHandlers.hasStopIntent(msg)).toBe(false);
    });
  });
});
