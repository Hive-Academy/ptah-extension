import 'reflect-metadata';
import {
  normalizeCodexWorkspaceKey,
  type CodexSessionHistory,
} from '@ptah-extension/codex-runtime';
import {
  SessionId,
  resolveHistoryCursorEndIndex,
  selectHistoryPage,
} from '@ptah-extension/shared';
import type { SessionMetadata } from '../session-metadata-store';
import { projectCodexHistory } from './codex-history-projector';
import {
  SessionHistoryRouteError,
  SessionHistoryRouter,
  type NativeSessionHistoryPort,
} from './session-history-router';

const sessionId = SessionId.from('11111111-1111-4111-8111-111111111111');
const workspacePath = process.platform === 'win32' ? 'D:\\repo' : '/repo';
const nativeExecution: NonNullable<SessionMetadata['codexExecution']> = {
  version: 1,
  runtime: 'codex-app-server',
  sessionId,
  providerId: 'codex',
  workspaceId: normalizeCodexWorkspaceKey(workspacePath, process.platform),
  codex: { normalizedHome: '/codex-home' },
};
const nativeThread: NonNullable<SessionMetadata['codexThread']> = {
  version: 1,
  contextId: 'context',
  processGeneration: 1,
  workspaceId: workspacePath,
  profileFingerprint: 'fingerprint',
  state: 'inactive',
};
const nativeSession: SessionMetadata = {
  sessionId,
  name: 'Codex chat',
  workspaceId: workspacePath,
  createdAt: 100,
  lastActiveAt: 200,
  totalCost: 0,
  totalTokens: { input: 0, output: 0 },
  codexExecution: nativeExecution,
  codexThread: nativeThread,
};

/** Pinned-schema fixture; live thread/read shape remains UNCONFIRMED. */
const snapshot: CodexSessionHistory = {
  rootThreadId: sessionId,
  threads: [{
    id: sessionId,
    parentThreadId: null,
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 100,
        completedAt: 110,
        itemsView: 'full',
        items: [
          { type: 'userMessage', id: 'user-1', content: [{ type: 'text', text: 'Hello' }] },
          { type: 'agentMessage', id: 'answer-1', text: 'Hi' },
        ],
      },
      {
        id: 'turn-2',
        status: 'completed',
        startedAt: 120,
        completedAt: 130,
        itemsView: 'full',
        items: [
          { type: 'userMessage', id: 'user-2', content: [{ type: 'text', text: 'Again' }] },
          { type: 'agentMessage', id: 'answer-2', text: 'Done' },
        ],
      },
    ],
    cliVersion: 'pinned',
    createdAt: 100,
    updatedAt: 200,
    cwd: workspacePath,
    ephemeral: false,
    modelProvider: 'openai',
    preview: '',
    projectId: null,
    sessionId: 'session',
    source: 'appServer',
    status: { type: 'idle' },
  }],
};

function fixture(
  session: SessionMetadata | null,
  getNative: () => NativeSessionHistoryPort | undefined = () => undefined,
) {
  const metadata = { get: jest.fn(async () => session) };
  const legacy = {
    readSessionHistory: jest.fn(async () => ({ events: [], stats: null })),
    readSessionEvents: jest.fn(async () => []),
  };
  return { router: new SessionHistoryRouter(metadata, legacy, getNative), metadata, legacy };
}

describe('SessionHistoryRouter', () => {
  it('passes a Claude session through the existing reader with its options', async () => {
    const { router, legacy } = fixture({ ...nativeSession, codexExecution: undefined, codexThread: undefined });
    const options = { checkCompactionBoundary: true, includeBlockOwners: true };
    expect(await router.readSessionHistory(sessionId, workspacePath, options))
      .toEqual({ events: [], stats: null });
    expect(legacy.readSessionHistory).toHaveBeenCalledWith(sessionId, workspacePath, options);
    expect(await router.readSessionEvents(sessionId, workspacePath)).toEqual([]);
    expect(legacy.readSessionEvents).toHaveBeenCalledWith(sessionId, workspacePath);
  });

  it('reads and projects persisted native history through the optional port', async () => {
    const native = { readHistory: jest.fn(async () => snapshot) };
    const { router, legacy } = fixture(nativeSession, () => native);
    const expected = projectCodexHistory(sessionId, snapshot);
    expect(await router.readSessionHistory(sessionId, workspacePath))
      .toEqual({ events: expected.events, stats: null });
    expect(native.readHistory).toHaveBeenCalledWith(nativeSession);
    expect(expected.events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', delta: 'Hi' }));
    expect(legacy.readSessionHistory).not.toHaveBeenCalled();
  });

  it('returns a full native snapshot for tail and older-page selection', async () => {
    const native = { readHistory: jest.fn(async () => snapshot) };
    const { router, legacy } = fixture(nativeSession, () => native);
    const events = await router.readSessionEvents(sessionId, workspacePath);
    const tail = selectHistoryPage(events, { endIndex: events.length, maxEvents: 1 });
    expect(tail.olderCursor).not.toBeNull();
    if (tail.olderCursor === null) throw new Error('Expected older native history');
    const replayedEvents = await router.readSessionEvents(sessionId, workspacePath);
    const older = selectHistoryPage(replayedEvents, {
      endIndex: resolveHistoryCursorEndIndex(replayedEvents, tail.olderCursor),
      maxEvents: 1,
    });
    expect(older.olderCursor).toBeNull();
    expect([...older.events, ...tail.events]).toEqual(events);
    expect(events).toEqual(projectCodexHistory(sessionId, snapshot).events);
    expect(native.readHistory).toHaveBeenCalledTimes(2);
    expect(legacy.readSessionEvents).not.toHaveBeenCalled();
  });

  it('accepts a non-canonical caller path for the saved workspace key', async () => {
    const callerPath = process.platform === 'win32'
      ? 'D:\\Repo\\child\\..\\'
      : '/repo/child/../';
    const workspaceKey = normalizeCodexWorkspaceKey(callerPath, process.platform);
    const session: SessionMetadata = {
      ...nativeSession,
      workspaceId: callerPath,
      codexExecution: { ...nativeExecution, workspaceId: workspaceKey },
      codexThread: { ...nativeThread, workspaceId: callerPath },
    };
    const native = { readHistory: jest.fn(async () => snapshot) };
    const { router } = fixture(session, () => native);
    await expect(router.readSessionEvents(sessionId, callerPath)).resolves.toEqual(
      projectCodexHistory(sessionId, snapshot).events,
    );
    expect(native.readHistory).toHaveBeenCalledWith(session);
  });

  it('fails explicitly when a native session has no host port', async () => {
    const { router, legacy } = fixture(nativeSession);
    await expect(router.readSessionHistory(sessionId, workspacePath))
      .rejects.toMatchObject({ name: 'SessionHistoryRouteError', code: 'nativePortUnavailable' });
    await expect(router.readSessionEvents(sessionId, workspacePath))
      .rejects.toBeInstanceOf(SessionHistoryRouteError);
    expect(legacy.readSessionHistory).not.toHaveBeenCalled();
    expect(legacy.readSessionEvents).not.toHaveBeenCalled();
  });

  it('reads by execution thread id when the context mapping was not persisted', async () => {
    const session: SessionMetadata = { ...nativeSession, codexThread: undefined };
    const native = { readHistory: jest.fn(async () => snapshot) };
    const { router, legacy } = fixture(session, () => native);
    await expect(router.readSessionHistory(sessionId, workspacePath)).resolves.toMatchObject({
      stats: null,
    });
    expect(native.readHistory).toHaveBeenCalledWith(session);
    expect(legacy.readSessionHistory).not.toHaveBeenCalled();
  });

  it('resolves a host port registered after the router was first read', async () => {
    const host: { port?: NativeSessionHistoryPort } = {};
    const { router, legacy } = fixture(nativeSession, () => host.port);
    await expect(router.readSessionEvents(sessionId, workspacePath))
      .rejects.toMatchObject({ code: 'nativePortUnavailable' });
    host.port = { readHistory: jest.fn(async () => snapshot) };
    await expect(router.readSessionEvents(sessionId, workspacePath)).resolves.toEqual(
      projectCodexHistory(sessionId, snapshot).events,
    );
    expect(legacy.readSessionEvents).not.toHaveBeenCalled();
  });

  it('propagates native port rejection without reading Claude history', async () => {
    const failure = new Error('read failed');
    const native = { readHistory: jest.fn(async (): Promise<CodexSessionHistory> => {
      throw failure;
    }) };
    const { router, legacy } = fixture(nativeSession, () => native);
    await expect(router.readSessionHistory(sessionId, workspacePath)).rejects.toBe(failure);
    expect(legacy.readSessionHistory).not.toHaveBeenCalled();
  });

  it('rejects an execution thread id that differs from the requested session', async () => {
    const otherId = SessionId.from('22222222-2222-4222-8222-222222222222');
    const session: SessionMetadata = {
      ...nativeSession,
      codexExecution: { ...nativeExecution, sessionId: otherId },
    };
    const native = { readHistory: jest.fn(async () => snapshot) };
    const { router, legacy } = fixture(session, () => native);
    await expect(router.readSessionHistory(sessionId, workspacePath))
      .rejects.toMatchObject({ code: 'invalidNativeIdentity' });
    expect(native.readHistory).not.toHaveBeenCalled();
    expect(legacy.readSessionHistory).not.toHaveBeenCalled();
  });

  it('rejects a mismatched or invalid context workspace path', async () => {
    const native = { readHistory: jest.fn(async () => snapshot) };
    for (const path of ['relative/path', process.platform === 'win32' ? 'D:\\Other' : '/other']) {
      const session: SessionMetadata = {
        ...nativeSession,
        codexThread: { ...nativeThread, workspaceId: path },
      };
      const { router } = fixture(session, () => native);
      await expect(router.readSessionEvents(sessionId, workspacePath))
        .rejects.toMatchObject({ code: 'invalidNativeIdentity' });
    }
    expect(native.readHistory).not.toHaveBeenCalled();
  });

  it('delegates an absent metadata row to the legacy reader', async () => {
    const { router, legacy } = fixture(null);
    await expect(router.readSessionHistory(sessionId, workspacePath))
      .resolves.toEqual({ events: [], stats: null });
    expect(legacy.readSessionHistory).toHaveBeenCalledWith(sessionId, workspacePath, undefined);
  });
});
