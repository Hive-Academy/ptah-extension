import { readCodexSessionHistory, type CodexHistoryRequest } from './codex-session-history';
import { CodexRequestRejectedError } from './codex-app-server-process';
import { CodexProtocolError, validateCodexResult } from './codex-protocol-validator';

// Synthetic pagination fixture with no user session data.
const root = {
  id: 'root', cliVersion: '0.165.0', createdAt: 1, updatedAt: 3,
  cwd: '/work', ephemeral: false, modelProvider: 'openai', preview: '',
  projectId: null, sessionId: 'session', source: 'appServer',
  status: { type: 'idle' }, turns: [], historyMode: 'paginated',
};
const child = { ...root, id: 'child', createdAt: 2, parentThreadId: 'root', sessionId: 'child-session' };
const other = { ...child, id: 'other', createdAt: 3, sessionId: 'other-session' };
const turn = (id: string) => ({ id, status: 'completed', items: [], itemsView: 'summary' });
const entry = (turnId: string, id: string) => ({
  turnId, startedAtMs: 10, completedAtMs: 11,
  item: { type: 'agentMessage', id, text: id },
});

function fixture(overrides: {
  repeatCursor?: boolean;
  malformed?: boolean;
  missing?: boolean;
  orphan?: boolean;
  legacy?: boolean;
  conflict?: boolean;
  blankCursor?: boolean;
  endless?: boolean;
  duplicateTurn?: boolean;
  duplicateItem?: boolean;
  subAgentRoot?: boolean;
  cycle?: boolean;
  unrelated?: boolean;
  secondChild?: boolean;
  childMismatch?: boolean;
  fallbackPages?: boolean;
} = {}, calls: string[] = []): CodexHistoryRequest {
  return async (method, params) => {
    calls.push(method);
    if (overrides.missing && method === 'thread/read')
      throw new CodexRequestRejectedError('thread/read', -1, 'codexRequestRejected', true);
    const id = 'threadId' in params ? params.threadId : undefined;
    let result: unknown;
    switch (method) {
      case 'thread/read':
        result = { thread: id === 'child' ? overrides.childMismatch
          ? { ...child, parentThreadId: 'different' } : child : id === 'other' ? other : overrides.legacy
          ? { ...root, historyMode: 'legacy', turns: 'includeTurns' in params && params.includeTurns
            ? [{ ...turn('r1'), itemsView: undefined, items: [entry('r1', 'embedded').item] }]
            : [] }
          : overrides.subAgentRoot ? { ...root, parentThreadId: 'parent' } : root };
        break;
      case 'thread/list':
        result = 'archived' in params && params.archived ? { data: [] }
          : overrides.fallbackPages ? 'cursor' in params && params.cursor
            ? { data: [{ ...other, parentThreadId: 'child' }], nextCursor: null }
            : { data: [{ ...child, id: 'unrelated', parentThreadId: 'elsewhere' }, child], nextCursor: 'page-2' }
          : {
          data: overrides.orphan
            ? [{ ...child, id: 'orphan', parentThreadId: 'missing', sessionId: root.sessionId }]
            : overrides.cycle
              ? [{ ...child, id: 'a', parentThreadId: 'b' }, { ...child, id: 'b', parentThreadId: 'a' }]
            : overrides.unrelated
              ? [{ ...child, id: 'unrelated', parentThreadId: 'elsewhere', sessionId: 'another-session' }]
            : overrides.legacy ? [] : overrides.secondChild ? [child, other] : [child],
          nextCursor: overrides.endless
            ? String(Number('cursor' in params ? params.cursor ?? '0' : '0') + 1)
            : overrides.blankCursor ? ' ' : null,
        };
        break;
      case 'thread/turns/list':
        result = 'cursor' in params && params.cursor
          ? { data: [turn(overrides.duplicateTurn ? (id === 'root' ? 'r1' : 'c1') : (id === 'root' ? 'r2' : 'c2'))], nextCursor: overrides.repeatCursor ? 'page-2' : null }
          : { data: [{ ...turn(id === 'root' ? 'r1' : 'c1'),
              items: overrides.conflict ? [entry('r1', 'missing').item] : [] }], nextCursor: 'page-2' };
        break;
      case 'thread/items/list': {
        const turnId = 'turnId' in params && typeof params.turnId === 'string' ? params.turnId : '';
        result = overrides.malformed
          ? { data: [{ turnId: 'wrong', item: { type: 'agentMessage', id: 'bad', text: 'bad' } }] }
          : 'cursor' in params && params.cursor
            ? { data: [entry(turnId, `${turnId}-${overrides.duplicateItem ? 'a' : 'b'}`)] }
            : { data: [entry(turnId, `${turnId}-a`)], nextCursor: 'item-2' };
        break;
      }
    }
    return validateCodexResult(method, result);
  };
}

describe('readCodexSessionHistory', () => {
  const logger = { warn: jest.fn() };

  it('hydrates root and child in order, including every turn and item page', async () => {
    const snapshot = await readCodexSessionHistory('root', fixture(), () => undefined, logger);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(['root', 'child']);
    expect(snapshot.threads[0].turns.map((value) => value.id)).toEqual(['r1', 'r2']);
    expect(snapshot.threads[0].turns[0].items.map((item) => item.id)).toEqual(['r1-a', 'r1-b']);
    expect(snapshot.threads[0].turns[0].itemEntries?.[0].startedAtMs).toBe(10);
    expect(snapshot.threads[1].turns[1].items.map((item) => item.id)).toEqual(['c2-a', 'c2-b']);
  });

  it('uses 25 row pages for turns and items while retaining cursor paging', async () => {
    const normal = fixture();
    const request: CodexHistoryRequest = async (method, params) => {
      if (method === 'thread/turns/list' || method === 'thread/items/list')
        expect(params).toMatchObject({ limit: 25 });
      return normal(method, params);
    };
    const snapshot = await readCodexSessionHistory('root', request, () => undefined, logger);
    expect(snapshot.threads[0].turns.map((value) => value.id)).toEqual(['r1', 'r2']);
    expect(snapshot.threads[0].turns[0].items.map((value) => value.id)).toEqual(['r1-a', 'r1-b']);
  });

  it('reports a repeated cursor', async () => {
    await expect(readCodexSessionHistory('root', fixture({ repeatCursor: true }), () => undefined, logger))
      .rejects.toMatchObject({ code: 'stalledCursor' });
  });

  it('reports a malformed item page', async () => {
    await expect(readCodexSessionHistory('root', fixture({ malformed: true }), () => undefined, logger))
      .rejects.toMatchObject({ code: 'malformedPage' });
  });

  it.each([
    'thread/read',
    'thread/turns/list',
    'thread/items/list',
  ] as const)(
    'classifies a request-local invalidResult from %s as malformedPage',
    async (failedMethod) => {
      const normal = fixture();
      const request: CodexHistoryRequest = async (method, params) => {
        if (method === failedMethod)
          throw new CodexProtocolError('invalidResult', method, [
            { path: ['data'], code: 'invalid_type' },
          ]);
        return normal(method, params);
      };
      await expect(
        readCodexSessionHistory('root', request, () => undefined, logger),
      ).rejects.toMatchObject({ code: 'malformedPage' });
    },
  );

  it('limits descendant discovery to the root and keeps root history after a bad list result', async () => {
    logger.warn.mockClear();
    const normal = fixture();
    const request: CodexHistoryRequest = async (method, params) => {
      if (method === 'thread/list') {
        expect(params).toMatchObject({ ancestorThreadId: 'root', limit: 20 });
        if ('archived' in params && !params.archived)
          throw new CodexProtocolError('invalidResult', method, [
            { path: ['data', 0, 'source'], code: 'invalid_type' },
          ]);
      }
      return normal(method, params);
    };
    const snapshot = await readCodexSessionHistory('root', request, () => undefined, logger);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(['root']);
    expect(snapshot.threads[0].turns.map((turn) => turn.id)).toEqual(['r1', 'r2']);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Codex descendant discovery incomplete; continuing available history',
      { partialListing: true, completedLists: 1, failedLists: 1, failures: [
        { archived: false, reason: 'malformedPage', issues: JSON.stringify([
          { path: ['data', 0, 'source'], code: 'invalid_type' },
        ]) },
      ] },
    );
  });

  it('returns hydrated root history if a list frame closes the process', async () => {
    logger.warn.mockClear();
    const calls: string[] = [];
    const normal = fixture({}, calls);
    const request: CodexHistoryRequest = async (method, params) => {
      if (method === 'thread/list') throw new Error('Codex invalid protocol frame');
      return normal(method, params);
    };
    const snapshot = await readCodexSessionHistory('root', request, () => undefined, logger);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(['root']);
    expect(snapshot.threads[0].turns.map((turn) => turn.id)).toEqual(['r1', 'r2']);
    expect(calls).toContain('thread/items/list');
    expect(logger.warn).toHaveBeenCalledWith(
      'Codex descendant discovery incomplete; continuing available history',
      { partialListing: false, completedLists: 0, failedLists: 1, failures: [
        { archived: false, reason: 'processFailure', issues: '[]' },
      ] },
    );
  });

  it('aggregates failures from both archived list calls into one warning', async () => {
    logger.warn.mockClear();
    const normal = fixture();
    const request: CodexHistoryRequest = async (method, params) => {
      if (method === 'thread/list')
        throw new CodexRequestRejectedError(method, -32000, 'codexRequestRejected');
      return normal(method, params);
    };
    const snapshot = await readCodexSessionHistory('root', request, () => undefined, logger);
    expect(snapshot.threads.map((value) => value.id)).toEqual(['root']);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Codex descendant discovery incomplete; continuing available history',
      { partialListing: false, completedLists: 0, failedLists: 2, failures: [
        { archived: false, reason: 'requestRejected', issues: '[]', rpcCode: -32000 },
        { archived: true, reason: 'requestRejected', issues: '[]', rpcCode: -32000 },
      ] },
    );
  });

  it('retries plain cursor listing after the experimental ancestor param is rejected', async () => {
    logger.warn.mockClear();
    const normal = fixture({ fallbackPages: true });
    const listParams: unknown[] = [];
    const request: CodexHistoryRequest = async (method, params) => {
      if (method === 'thread/list') {
        listParams.push(params);
        if ('ancestorThreadId' in params)
          throw new CodexRequestRejectedError(method, -32602, 'codexRequestRejected');
      }
      return normal(method, params);
    };
    const snapshot = await readCodexSessionHistory('root', request, () => undefined, logger);
    expect(snapshot.threads.map((value) => value.id)).toEqual(['root', 'child', 'other']);
    expect(listParams).toEqual([
      expect.objectContaining({ ancestorThreadId: 'root', archived: false }),
      expect.objectContaining({ archived: false }),
      expect.objectContaining({ archived: false, cursor: 'page-2' }),
      expect.objectContaining({ ancestorThreadId: 'root', archived: true }),
      expect.objectContaining({ archived: true }),
    ]);
    expect(listParams[1]).not.toHaveProperty('ancestorThreadId');
    expect(listParams[2]).not.toHaveProperty('ancestorThreadId');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(['invalid child result', 'parent mismatch'])(
    'keeps root and other child after %s, with one warning', async (failure) => {
      logger.warn.mockClear();
      const normal = fixture({ secondChild: true, childMismatch: failure === 'parent mismatch' });
      const request: CodexHistoryRequest = async (method, params) => {
        if (failure === 'invalid child result' && method === 'thread/read' &&
            'threadId' in params && params.threadId === 'child')
          throw new CodexProtocolError('invalidResult', method, [
            { path: ['thread', 'parentThreadId'], code: 'invalid_type' },
          ]);
        return normal(method, params);
      };
      const snapshot = await readCodexSessionHistory('root', request, () => undefined, logger);
      expect(snapshot.threads.map((value) => value.id)).toEqual(['root', 'other']);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Codex descendant discovery incomplete; continuing available history',
        expect.objectContaining({ failures: [expect.objectContaining({
          threadId: 'child', reason: 'malformedPage',
          issues: failure === 'invalid child result'
            ? JSON.stringify([{ path: ['thread', 'parentThreadId'], code: 'invalid_type' }])
            : '[]',
        })] }),
      );
    },
  );

  it('propagates an abort from the child failure catch', async () => {
    logger.warn.mockClear();
    let aborted = false;
    const normal = fixture();
    const request: CodexHistoryRequest = async (method, params) => {
      if (method === 'thread/read' && 'threadId' in params && params.threadId === 'child') {
        aborted = true;
        throw new Error('child read failed');
      }
      return normal(method, params);
    };
    await expect(readCodexSessionHistory('root', request, () => {
      if (aborted) throw new Error('Codex history read aborted');
    }, logger)).rejects.toThrow('Codex history read aborted');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('never returns empty history for a missing thread', async () => {
    await expect(readCodexSessionHistory('root', fixture({ missing: true }), () => undefined, logger))
      .rejects.toMatchObject({ code: 'threadNotFound' });
  });

  it('excludes orphan threads even when they share the root session id', async () => {
    const snapshot = await readCodexSessionHistory('root', fixture({ orphan: true }), () => undefined, logger);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(['root']);
  });

  it.each([{ cycle: true }, { unrelated: true }])('excludes unreachable threads', async (overrides) => {
    const snapshot = await readCodexSessionHistory('root', fixture(overrides), () => undefined, logger);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(['root']);
  });

  it('accepts a sub-agent thread as the requested root', async () => {
    const snapshot = await readCodexSessionHistory('root', fixture({ subAgentRoot: true }), () => undefined, logger);
    expect(snapshot.threads[0].parentThreadId).toBe('parent');
  });

  it('keeps embedded legacy items without calling the item page endpoint', async () => {
    const calls: string[] = [];
    const snapshot = await readCodexSessionHistory('root', fixture({ legacy: true }, calls), () => undefined, logger);
    expect(snapshot.threads[0].turns[0].items.map((item) => item.id)).toEqual(['embedded']);
    expect(calls).not.toContain('thread/items/list');
  });

  it.each([
    [{ conflict: true }, 'malformedPage'],
    [{ duplicateTurn: true }, 'malformedPage'],
    [{ duplicateItem: true }, 'malformedPage'],
    [{ blankCursor: true }, 'stalledCursor'],
    [{ endless: true }, 'pageLimitExceeded'],
  ] as const)('fails explicitly on conflicting or unbounded pages', async (overrides, code) => {
    await expect(readCodexSessionHistory('root', fixture(overrides), () => undefined, logger))
      .rejects.toMatchObject({ code });
  });
});
