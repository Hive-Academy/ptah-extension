import 'reflect-metadata';

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  forkSession: jest.fn(),
}));

const sdkModuleMock = require('@anthropic-ai/claude-agent-sdk') as {
  forkSession: jest.Mock;
};
function getMockedForkSession(): jest.Mock {
  return sdkModuleMock.forkSession;
}

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import type { SessionId, AISessionConfig } from '@ptah-extension/shared';
import {
  createMockLogger,
  createFakeAsyncGenerator,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

import { SessionForkService } from './session-fork.service';
import { SdkError, SessionNotActiveError } from '../errors';
import type { SessionMetadataStore } from '../session-metadata-store';
import type { SessionHistoryReaderService } from '../session-history-reader.service';
import type { SessionLifecycleManager, Query } from './index';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function createMockSentry(): jest.Mocked<
  Pick<SentryService, 'captureException'>
> {
  return { captureException: jest.fn() };
}

function createMockMetadataStore(): jest.Mocked<
  Pick<SessionMetadataStore, 'create' | 'get' | 'touch'>
> {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    touch: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockHistoryReader(): jest.Mocked<
  Pick<SessionHistoryReaderService, 'resolveNativeMessageId'>
> {
  return {
    resolveNativeMessageId: jest
      .fn()
      .mockImplementation((_, __, id: string) => Promise.resolve(id)),
  };
}

function createMockSessionLifecycle(): jest.Mocked<
  Pick<SessionLifecycleManager, 'find'>
> {
  return {
    find: jest.fn().mockReturnValue(undefined),
  };
}

function createMockWorkspaceProvider(): jest.Mocked<
  Pick<IWorkspaceProvider, 'getWorkspaceRoot'>
> {
  return {
    getWorkspaceRoot: jest.fn().mockReturnValue('/fake/workspace'),
  };
}

function createFakeQuery(): Query {
  const gen = createFakeAsyncGenerator<SDKMessage>([]);
  const q = {
    [Symbol.asyncIterator]: () => gen as AsyncIterator<SDKMessage, void>,
    next: () => gen.next(),
    return: (value?: void) => gen.return(value as unknown as SDKMessage),
    throw: (e?: unknown) => gen.throw(e),
    interrupt: jest.fn().mockResolvedValue(undefined),
    setPermissionMode: jest.fn().mockResolvedValue(undefined),
    setModel: jest.fn().mockResolvedValue(undefined),
    streamInput: jest.fn().mockResolvedValue(undefined),
    rewindFiles: jest.fn().mockResolvedValue({ canRewind: true }),
  };
  return q as unknown as Query;
}

interface Harness {
  service: SessionForkService;
  logger: MockLogger;
  sentry: ReturnType<typeof createMockSentry>;
  metadataStore: ReturnType<typeof createMockMetadataStore>;
  historyReader: ReturnType<typeof createMockHistoryReader>;
  sessionLifecycle: ReturnType<typeof createMockSessionLifecycle>;
  workspaceProvider: ReturnType<typeof createMockWorkspaceProvider>;
}

function makeService(): Harness {
  const logger = createMockLogger();
  const sentry = createMockSentry();
  const metadataStore = createMockMetadataStore();
  const historyReader = createMockHistoryReader();
  const sessionLifecycle = createMockSessionLifecycle();
  const workspaceProvider = createMockWorkspaceProvider();

  const service = new SessionForkService(
    asLogger(logger),
    metadataStore as unknown as SessionMetadataStore,
    historyReader as unknown as SessionHistoryReaderService,
    sessionLifecycle as unknown as SessionLifecycleManager,
    workspaceProvider as unknown as IWorkspaceProvider,
    sentry as unknown as SentryService,
  );

  return {
    service,
    logger,
    sentry,
    metadataStore,
    historyReader,
    sessionLifecycle,
    workspaceProvider,
  };
}

const baseSessionConfig = {
  model: 'claude-sonnet-4-20250514',
} as AISessionConfig;

describe('SessionForkService', () => {
  describe('forkSession()', () => {
    beforeEach(() => {
      getMockedForkSession().mockReset();
    });

    it('delegates to SDK forkSession with upToMessageId and title', async () => {
      const h = makeService();
      getMockedForkSession().mockResolvedValueOnce({
        sessionId: 'forked-uuid-123',
      });

      const result = await h.service.forkSession({
        sessionId: 'source-uuid' as SessionId,
        upToMessageId: 'msg-uuid-50',
        title: 'My Fork',
      });

      expect(result).toEqual({ sessionId: 'forked-uuid-123' });
      expect(getMockedForkSession()).toHaveBeenCalledTimes(1);
      expect(getMockedForkSession()).toHaveBeenCalledWith('source-uuid', {
        upToMessageId: 'msg-uuid-50',
        title: 'My Fork',
      });
    });

    it('passes undefined upToMessageId/title when omitted (full copy)', async () => {
      const h = makeService();
      getMockedForkSession().mockResolvedValueOnce({ sessionId: 'fork-2' });

      await h.service.forkSession({ sessionId: 'src' as SessionId });

      expect(getMockedForkSession()).toHaveBeenCalledWith('src', {
        upToMessageId: undefined,
        title: undefined,
      });
    });

    it('wraps SDK errors as SdkError with context and reports to Sentry', async () => {
      const h = makeService();
      getMockedForkSession().mockRejectedValueOnce(
        new Error('boom: source not found'),
      );

      await expect(
        h.service.forkSession({ sessionId: 'src' as SessionId }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Failed to fork session src'),
      });
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'SdkAgentAdapter.forkSession',
        }),
      );
    });

    it('resolves Ptah-internal upToMessageId to native SDK UUID before calling fork()', async () => {
      const h = makeService();
      const ptahId = 'msg_1778055502540_cegogbr';
      const nativeId = 'msg_01AbCdEfGhIjKlMnOpQrStUvWxYz';

      h.historyReader.resolveNativeMessageId.mockResolvedValueOnce(nativeId);
      getMockedForkSession().mockResolvedValueOnce({
        sessionId: 'forked-uuid-native',
      });

      await h.service.forkSession({
        sessionId: 'source-session-id' as SessionId,
        upToMessageId: ptahId,
        title: 'Branch',
      });

      expect(h.historyReader.resolveNativeMessageId).toHaveBeenCalledWith(
        'source-session-id',
        expect.any(String),
        ptahId,
      );
      expect(getMockedForkSession()).toHaveBeenCalledWith('source-session-id', {
        upToMessageId: nativeId,
        title: 'Branch',
      });
    });

    it('passes native UUID through unchanged via the resolveNativeMessageId fast path', async () => {
      const h = makeService();
      const nativeId = 'msg_01AbCdEfGhIjKlMnOpQrStUvWxYz01';
      getMockedForkSession().mockResolvedValueOnce({
        sessionId: 'forked-uuid',
      });

      await h.service.forkSession({
        sessionId: 'src-session' as SessionId,
        upToMessageId: nativeId,
      });

      expect(getMockedForkSession()).toHaveBeenCalledWith('src-session', {
        upToMessageId: nativeId,
        title: undefined,
      });
    });

    it('throws SdkError (not the raw SDK error) when historyReader cannot resolve the Ptah ID', async () => {
      const h = makeService();
      const ptahId = 'msg_1778055502540_notfound';
      h.historyReader.resolveNativeMessageId.mockRejectedValueOnce(
        new Error(
          "upToMessageId 'msg_1778055502540_notfound' not found in session history",
        ),
      );
      getMockedForkSession().mockResolvedValueOnce({
        sessionId: 'should-not-be-reached',
      });

      await expect(
        h.service.forkSession({
          sessionId: 'src' as SessionId,
          upToMessageId: ptahId,
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Failed to fork session src'),
      });

      expect(getMockedForkSession()).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ errorSource: 'SdkAgentAdapter.forkSession' }),
      );
    });

    it('throws SdkError when source has no workspaceId and no active workspace folder', async () => {
      const h = makeService();
      h.workspaceProvider.getWorkspaceRoot.mockReturnValue(
        undefined as unknown as string,
      );
      h.metadataStore.get.mockResolvedValueOnce(null);
      getMockedForkSession().mockResolvedValueOnce({ sessionId: 'fork-x' });

      await expect(
        h.service.forkSession({ sessionId: 'src' as SessionId }),
      ).rejects.toBeInstanceOf(SdkError);
    });
  });

  describe('rewindFiles()', () => {
    it('throws SessionNotActiveError when the session has no live Query handle', async () => {
      const h = makeService();
      h.sessionLifecycle.find.mockReturnValueOnce(undefined);

      const err = await h.service
        .rewindFiles({
          sessionId: 'dead-session' as SessionId,
          userMessageId: 'msg-1',
        })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SessionNotActiveError);
      expect(err).toBeInstanceOf(SdkError);
      expect((err as Error).message).toContain(
        'session dead-session is not active or has no live Query handle',
      );
    });

    it('throws SessionNotActiveError when session exists but query is null', async () => {
      const h = makeService();
      h.sessionLifecycle.find.mockReturnValueOnce({
        tabId: 'preregistered',
        realSessionId: null,
        query: null,
        config: baseSessionConfig,
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await expect(
        h.service.rewindFiles({
          sessionId: 'preregistered' as SessionId,
          userMessageId: 'msg-1',
        }),
      ).rejects.toBeInstanceOf(SessionNotActiveError);
    });

    it('delegates to query.rewindFiles with userMessageId and dryRun', async () => {
      const h = makeService();
      const fakeQuery = createFakeQuery();
      const rewindMock = fakeQuery.rewindFiles as jest.Mock;
      rewindMock.mockResolvedValueOnce({
        canRewind: true,
        filesChanged: ['/a.ts', '/b.ts'],
        insertions: 12,
        deletions: 3,
      });

      h.sessionLifecycle.find.mockReturnValueOnce({
        tabId: 'live',
        realSessionId: null,
        query: fakeQuery,
        config: baseSessionConfig,
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await h.service.rewindFiles({
        sessionId: 'live' as SessionId,
        userMessageId: 'user-msg-uuid',
        dryRun: true,
      });

      expect(rewindMock).toHaveBeenCalledTimes(1);
      expect(rewindMock).toHaveBeenCalledWith('user-msg-uuid', {
        dryRun: true,
      });
      expect(result.canRewind).toBe(true);
      expect(result.filesChanged).toEqual(['/a.ts', '/b.ts']);
      expect(result.insertions).toBe(12);
      expect(result.deletions).toBe(3);
    });

    it('wraps SDK errors as SdkError with context and reports to Sentry', async () => {
      const h = makeService();
      const fakeQuery = createFakeQuery();
      (fakeQuery.rewindFiles as jest.Mock).mockRejectedValueOnce(
        new Error('checkpointing not enabled'),
      );

      h.sessionLifecycle.find.mockReturnValueOnce({
        tabId: 'live',
        realSessionId: null,
        query: fakeQuery,
        config: baseSessionConfig,
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await expect(
        h.service.rewindFiles({
          sessionId: 'live' as SessionId,
          userMessageId: 'msg',
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Failed to rewind files'),
      });
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'SdkAgentAdapter.rewindFiles',
        }),
      );
    });

    it('realUUID-keyed lookup succeeds: find(realUUID) returns a record with query set and rewindFiles resolves', async () => {
      const h = makeService();
      const fakeQuery = createFakeQuery();
      const rewindMock = fakeQuery.rewindFiles as jest.Mock;
      rewindMock.mockResolvedValueOnce({
        canRewind: true,
        filesChanged: ['/src/a.ts'],
        insertions: 5,
        deletions: 2,
      });

      h.sessionLifecycle.find.mockImplementation((id: string) => {
        if (id === 'real-uuid-from-sdk') {
          return {
            tabId: 'tab_1',
            realSessionId: 'real-uuid-from-sdk',
            query: fakeQuery,
            config: {} as AISessionConfig,
            abortController: new AbortController(),
            messageQueue: [],
            resolveNext: null,
            currentModel: 'claude-sonnet-4-20250514',
            lastActivityAt: 0,
          };
        }
        return undefined;
      });

      const result = await h.service.rewindFiles({
        sessionId: 'real-uuid-from-sdk' as SessionId,
        userMessageId: 'user-msg-uuid',
      });

      expect(rewindMock).toHaveBeenCalledTimes(1);
      expect(result.canRewind).toBe(true);
      expect(result.filesChanged).toEqual(['/src/a.ts']);
    });

    it('passes { dryRun: false } to query.rewindFiles when called with dryRun=false', async () => {
      const h = makeService();
      const fakeQuery = createFakeQuery();
      const rewindMock = fakeQuery.rewindFiles as jest.Mock;
      rewindMock.mockResolvedValueOnce({
        canRewind: true,
        filesChanged: ['/x.ts'],
        insertions: 1,
        deletions: 0,
      });

      h.sessionLifecycle.find.mockReturnValueOnce({
        tabId: 'live',
        realSessionId: null,
        query: fakeQuery,
        config: baseSessionConfig,
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await h.service.rewindFiles({
        sessionId: 'live' as SessionId,
        userMessageId: 'msg-commit',
        dryRun: false,
      });

      expect(rewindMock).toHaveBeenCalledWith('msg-commit', { dryRun: false });
    });

    it('passes { dryRun: undefined } to query.rewindFiles when dryRun is omitted', async () => {
      const h = makeService();
      const fakeQuery = createFakeQuery();
      const rewindMock = fakeQuery.rewindFiles as jest.Mock;
      rewindMock.mockResolvedValueOnce({
        canRewind: false,
        error: 'checkpoint missing',
      });

      h.sessionLifecycle.find.mockReturnValueOnce({
        tabId: 'live',
        realSessionId: null,
        query: fakeQuery,
        config: baseSessionConfig,
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await h.service.rewindFiles({
        sessionId: 'live' as SessionId,
        userMessageId: 'msg-omitted',
      });

      expect(rewindMock).toHaveBeenCalledWith('msg-omitted', {
        dryRun: undefined,
      });
    });
  });
});
