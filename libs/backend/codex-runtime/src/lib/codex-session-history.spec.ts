import {
  readCodexSessionHistory,
  readCodexSessionTail,
  type CodexHistoryRequest,
} from './codex-session-history';
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
// The plain-cursor fallback lists "other" as a grandchild of the root;
// thread/read returns the same parent so list and read data agree.
const grandchild = { ...other, parentThreadId: 'child' };
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
          ? { ...child, parentThreadId: 'different' } : child
          : id === 'other' ? (overrides.fallbackPages ? grandchild : other) : overrides.legacy
          ? { ...root, historyMode: 'legacy', turns: 'includeTurns' in params && params.includeTurns
            ? [{ ...turn('r1'), itemsView: undefined, items: [entry('r1', 'embedded').item] }]
            : [] }
          : overrides.subAgentRoot ? { ...root, parentThreadId: 'parent' } : root };
        break;
      case 'thread/list':
        result = 'archived' in params && params.archived ? { data: [] }
          : overrides.fallbackPages ? 'cursor' in params && params.cursor
            ? { data: [grandchild], nextCursor: null }
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
  /** The warning carries failures as a JSON string; parse it back for assertions. */
  const warnMeta = (): Record<string, unknown> => {
    const meta: unknown = logger.warn.mock.calls[0]?.[1];
    if (!meta || typeof meta !== 'object' || !('failures' in meta) || typeof meta.failures !== 'string')
      throw new Error('missing warning metadata');
    const failures: unknown = JSON.parse(meta.failures);
    return { ...meta, failures };
  };

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
    expect(logger.warn.mock.calls[0]?.[0]).toBe(
      'Codex descendant discovery incomplete; continuing available history',
    );
    expect(warnMeta()).toEqual(
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
    expect(logger.warn.mock.calls[0]?.[0]).toBe(
      'Codex descendant discovery incomplete; continuing available history',
    );
    expect(warnMeta()).toEqual(
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
    expect(logger.warn.mock.calls[0]?.[0]).toBe(
      'Codex descendant discovery incomplete; continuing available history',
    );
    expect(warnMeta()).toEqual(
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
      expect(logger.warn.mock.calls[0]?.[0]).toBe(
        'Codex descendant discovery incomplete; continuing available history',
      );
      expect(warnMeta()).toEqual(
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
  ] as const)('fails explicitly on conflicting root history pages', async (overrides, code) => {
    await expect(readCodexSessionHistory('root', fixture(overrides), () => undefined, logger))
      .rejects.toMatchObject({ code });
  });

  // Listing failures degrade to the root-only history; the root read path
  // itself must still reject (previous test).
  it.each([
    [{ blankCursor: true }, 'stalledCursor'],
    [{ endless: true }, 'pageLimitExceeded'],
  ] as const)('keeps root history and warns after listing pages fail', async (overrides, code) => {
    logger.warn.mockClear();
    const snapshot = await readCodexSessionHistory('root', fixture(overrides), () => undefined, logger);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(['root']);
    expect(snapshot.threads[0].turns.map((turn) => turn.id)).toEqual(['r1', 'r2']);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toBe(
      'Codex descendant discovery incomplete; continuing available history',
    );
    expect(warnMeta()).toEqual({
      partialListing: true, completedLists: 1, failedLists: 1, failures: [
        { archived: false, reason: code, issues: '[]' },
      ],
    });
  });
});

// Synthetic tail fixture: turn `t${i}` is the i-th oldest; no user session data.
interface TailCall { method: string; params: Record<string, unknown>; bytes: number }
interface TailFixture {
  count: number;
  historyMode?: 'paginated' | 'legacy';
  /** Item pages a turn needs; such a turn is listed as a `summary` turn. */
  itemPages?: Record<number, number>;
  text?: (index: number) => string;
  itemText?: string;
  rejectDesc?: boolean;
  rejectTurns?: boolean;
  repeatCursor?: boolean;
  blankCursor?: boolean;
  duplicateTurn?: boolean;
  duplicateItem?: boolean;
  rootId?: string;
}

const TAIL_BOUND = { maxTurns: 200, maxTurnPages: 8, maxItemPages: 16 };
const TAIL_MAX_BYTES = 8 * 1024 * 1024;
const FRAME_LIMIT = 16 * 1024 * 1024;
const READ_METHODS = ['thread/read', 'thread/turns/list', 'thread/items/list'];

function tailTurn(config: TailFixture, index: number) {
  const id = config.duplicateTurn && index === config.count - 26 ? `t${config.count - 1}` : `t${index}`;
  return config.itemPages?.[index] !== undefined
    ? { id, status: 'completed', items: [], itemsView: 'summary' }
    : {
        id, status: 'completed', itemsView: 'full',
        items: [{ type: 'agentMessage', id: `${id}-m`, text: config.text?.(index) ?? id }],
      };
}

function tailServer(config: TailFixture): { request: CodexHistoryRequest; calls: TailCall[] } {
  const calls: TailCall[] = [];
  const rootThread: Record<string, unknown> = { ...root, id: config.rootId ?? 'root' };
  if (config.historyMode) rootThread['historyMode'] = config.historyMode;
  else delete rootThread['historyMode'];
  const request: CodexHistoryRequest = async (method, params) => {
    const record: TailCall = { method, params: { ...params }, bytes: 0 };
    calls.push(record);
    const cursor = 'cursor' in params && typeof params.cursor === 'string' ? params.cursor : undefined;
    const direction = 'sortDirection' in params ? params.sortDirection : undefined;
    let result: unknown;
    switch (method) {
      case 'thread/read':
        result = { thread: rootThread };
        break;
      case 'thread/turns/list': {
        if (config.rejectTurns || (config.rejectDesc && direction === 'desc'))
          throw new CodexRequestRejectedError(
            'thread/turns/list', config.rejectTurns ? -32600 : -32602, 'codexRequestRejected');
        const offset = cursor === 'same' ? 25 : Number(cursor ?? 0);
        const end = Math.min(offset + 25, config.count);
        const indexes = Array.from({ length: end - offset }, (_, k) =>
          direction === 'asc' ? offset + k : config.count - 1 - offset - k);
        const data = indexes.map((index) => tailTurn(config, index));
        record.bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
        result = {
          data,
          nextCursor: end >= config.count ? null
            : config.repeatCursor ? 'same' : config.blankCursor ? ' ' : String(end),
        };
        break;
      }
      case 'thread/items/list': {
        const turnId = 'turnId' in params && typeof params.turnId === 'string' ? params.turnId : '';
        const pagesNeeded = config.itemPages?.[Number(turnId.slice(1))] ?? 1;
        const page = Number(cursor ?? 0);
        const itemIndex = pagesNeeded - 1 - page;
        const data = [{
          turnId, startedAtMs: 10, completedAtMs: 11,
          item: {
            type: 'agentMessage',
            id: config.duplicateItem ? `${turnId}-dup` : `${turnId}-i${itemIndex}`,
            text: config.itemText ?? `${turnId}-i${itemIndex}`,
          },
        }];
        record.bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
        result = { data, nextCursor: page + 1 < pagesNeeded ? String(page + 1) : null };
        break;
      }
      default:
        throw new Error(`unexpected method ${method}`);
    }
    return validateCodexResult(method, result);
  };
  return { request, calls };
}

const tailIds = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => `t${from + k}`);
const callsOf = (calls: TailCall[], method: string) => calls.filter((call) => call.method === method);
const expectReadOnly = (calls: TailCall[]) => {
  expect(calls.every((call) => READ_METHODS.includes(call.method))).toBe(true);
  expect(callsOf(calls, 'thread/list')).toHaveLength(0);
  expect(calls.some((call) => 'includeTurns' in call.params)).toBe(false);
};

describe('readCodexSessionTail', () => {
  it.each([
    ['paginated', 'paginated'],
    ['legacy', 'legacy'],
    ['absent', undefined],
  ] as const)('bounds a 2,000-turn %s thread by the turn cap (AC 3.10, AC 3.9)', async (_label, historyMode) => {
    const server = tailServer({ count: 2_000, historyMode });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND);
    const turnLists = callsOf(server.calls, 'thread/turns/list');
    expect(turnLists).toHaveLength(8);
    for (const call of turnLists)
      expect(call.params).toMatchObject({ threadId: 'root', sortDirection: 'desc', itemsView: 'full', limit: 25 });
    expect(server.calls.length).toBeLessThanOrEqual(25);
    expect(callsOf(server.calls, 'thread/read')).toHaveLength(1);
    expectReadOnly(server.calls);
    expect(tail.thread.id).toBe('root');
    expect(tail.thread.turns.map((turn) => turn.id)).toEqual(tailIds(1_800, 1_999));
    expect(tail.thread.turns.at(-1)?.id).toBe('t1999');
    expect(tail.coversWholeHistory).toBe(false);
  });

  it('stops on the byte total alone for 1,500 turns of about 60 KB (row 41)', async () => {
    const text = (index: number) => `${index}:`.padEnd(60_000, 'x');
    const config: TailFixture = { count: 1_500, text };
    let fixtureBytes = 0;
    for (let index = 0; index < config.count; index++)
      fixtureBytes += Buffer.byteLength(JSON.stringify(tailTurn(config, index)), 'utf8');
    expect(fixtureBytes).toBeGreaterThan(10 * TAIL_MAX_BYTES);

    const server = tailServer(config);
    const tail = await readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND);
    const turnLists = callsOf(server.calls, 'thread/turns/list');
    expect(turnLists.every((call) => call.bytes < FRAME_LIMIT)).toBe(true);
    expect(turnLists).toHaveLength(6);
    expect(server.calls).toHaveLength(7);
    expect(server.calls.at(-1)).toBe(turnLists[5]);
    const received = turnLists.reduce((sum, call) => sum + call.bytes, 0);
    expect(received).toBeLessThanOrEqual(TAIL_MAX_BYTES + Math.max(...turnLists.map((call) => call.bytes)));
    expect(tail.thread.turns.map((turn) => turn.id)).toEqual(tailIds(1_350, 1_499));
    expect(tail.thread.turns.at(-1)?.id).toBe('t1499');
    expect(tail.coversWholeHistory).toBe(false);
    expectReadOnly(server.calls);
  });

  it('fails closed when the server refuses to page a legacy thread (F1 (a))', async () => {
    const server = tailServer({ count: 10, historyMode: 'legacy', rejectTurns: true });
    await expect(readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND))
      .rejects.toMatchObject({ code: 'requestRejected' });
    expect(server.calls.map((call) => call.method)).toEqual(['thread/read', 'thread/turns/list']);
    expectReadOnly(server.calls);
  });

  it('falls back to bounded ascending pages when desc is refused (A8)', async () => {
    const server = tailServer({ count: 30, rejectDesc: true });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND);
    expect(tail.thread.turns.map((turn) => turn.id)).toEqual(tailIds(0, 29));
    expect(tail.coversWholeHistory).toBe(false);
    expect(callsOf(server.calls, 'thread/turns/list').map((call) => call.params['sortDirection']))
      .toEqual(['desc', 'asc', 'asc']);
    expectReadOnly(server.calls);
  });

  it('keeps the newest maxTurns in the ascending fallback', async () => {
    const server = tailServer({ count: 30, rejectDesc: true });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, { ...TAIL_BOUND, maxTurns: 10 });
    expect(tail.thread.turns.map((turn) => turn.id)).toEqual(tailIds(20, 29));
    expect(tail.coversWholeHistory).toBe(false);
  });

  it('fails closed when the ascending fallback cannot reach the newest turns', async () => {
    const server = tailServer({ count: 2_000, rejectDesc: true });
    await expect(readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND))
      .rejects.toMatchObject({ code: 'pageLimitExceeded' });
    expect(callsOf(server.calls, 'thread/turns/list')).toHaveLength(TAIL_BOUND.maxTurnPages);
    expect(server.calls.length).toBeLessThanOrEqual(25);
  });

  it('throws pageLimitExceeded when the newest turn needs 17 item pages (F3)', async () => {
    const server = tailServer({ count: 3, itemPages: { 2: 17 } });
    await expect(readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND))
      .rejects.toMatchObject({ code: 'pageLimitExceeded' });
    const itemLists = callsOf(server.calls, 'thread/items/list');
    expect(itemLists).toHaveLength(16);
    for (const call of itemLists)
      expect(call.params).toMatchObject({ turnId: 't2', sortDirection: 'desc', limit: 25 });
  });

  it('drops a second-newest turn that exceeds the remaining item pages (F3)', async () => {
    const server = tailServer({ count: 3, itemPages: { 2: 10, 1: 10, 0: 1 } });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND);
    expect(tail.thread.turns.map((turn) => turn.id)).toEqual(['t2']);
    expect(tail.thread.turns[0].items.map((item) => item.id)).toEqual(tailIds(0, 9).map((id) => `t2-i${id.slice(1)}`));
    expect(tail.thread.turns[0].itemsView).toBe('full');
    expect(tail.coversWholeHistory).toBe(false);
    const itemLists = callsOf(server.calls, 'thread/items/list');
    expect(itemLists).toHaveLength(16);
    expect(itemLists.filter((call) => call.params['turnId'] === 't0')).toHaveLength(0);
    expect(JSON.stringify(tail)).not.toContain('t1-i');
  });

  it('drops a turn whose item pages cross the byte total (F3, bytes)', async () => {
    const server = tailServer({ count: 2, itemPages: { 1: 1, 0: 5 }, itemText: 'y'.repeat(3_000_000) });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND);
    expect(tail.thread.turns.map((turn) => turn.id)).toEqual(['t1']);
    expect(tail.coversWholeHistory).toBe(false);
    const itemLists = callsOf(server.calls, 'thread/items/list');
    // t1: one 3 MB page; t0: two more pages reach about 9 MB, so its third page is never requested.
    expect(itemLists).toHaveLength(3);
    expect(JSON.stringify(tail.thread.turns)).not.toContain('t0-i');
  });

  it('covers the whole history for a short thread', async () => {
    const server = tailServer({ count: 3 });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND);
    expect(tail.thread.turns.map((turn) => turn.id)).toEqual(['t0', 't1', 't2']);
    expect(tail.coversWholeHistory).toBe(true);
    expect(callsOf(server.calls, 'thread/turns/list')).toHaveLength(1);
  });

  it('covers the whole history when maxTurns is met by the last turn', async () => {
    const server = tailServer({ count: 25 });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, { ...TAIL_BOUND, maxTurns: 25 });
    expect(tail.thread.turns).toHaveLength(25);
    expect(tail.coversWholeHistory).toBe(true);
  });

  it('stops inside a page at maxTurns without requesting more pages', async () => {
    const server = tailServer({ count: 100 });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, { ...TAIL_BOUND, maxTurns: 30 });
    expect(tail.thread.turns.map((turn) => turn.id)).toEqual(tailIds(70, 99));
    expect(tail.coversWholeHistory).toBe(false);
    expect(callsOf(server.calls, 'thread/turns/list')).toHaveLength(2);
  });

  it('returns an empty thread as covering the whole history', async () => {
    const server = tailServer({ count: 0 });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND);
    expect(tail).toMatchObject({ thread: { id: 'root', turns: [] }, coversWholeHistory: true });
  });

  it('hydrates summary turns newest-first and returns items ascending', async () => {
    const server = tailServer({ count: 2, itemPages: { 1: 3 } });
    const tail = await readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND);
    expect(tail.thread.turns.map((turn) => turn.id)).toEqual(['t0', 't1']);
    expect(tail.thread.turns[1].items.map((item) => item.id)).toEqual(['t1-i0', 't1-i1', 't1-i2']);
    expect(tail.thread.turns[1].itemEntries?.[0].startedAtMs).toBe(10);
    expect(tail.coversWholeHistory).toBe(true);
    expectReadOnly(server.calls);
  });

  it.each([
    [{ repeatCursor: true }, 'stalledCursor'],
    [{ blankCursor: true }, 'stalledCursor'],
    [{ duplicateTurn: true }, 'malformedPage'],
    [{ duplicateItem: true, itemPages: { 59: 2 } }, 'malformedPage'],
    [{ rootId: 'other' }, 'malformedPage'],
  ] as const)('rejects a malformed or stalled tail (%j)', async (overrides, code) => {
    const server = tailServer({ count: 60, ...overrides });
    await expect(readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND))
      .rejects.toMatchObject({ code });
  });

  it('requests only read methods (A7, AC 6.1)', async () => {
    const server = tailServer({ count: 80, itemPages: { 79: 2, 60: 1 } });
    await readCodexSessionTail('root', server.request, () => undefined, TAIL_BOUND);
    expect([...new Set(server.calls.map((call) => call.method))].sort())
      .toEqual(['thread/items/list', 'thread/read', 'thread/turns/list']);
    expectReadOnly(server.calls);
  });

  it('stops when the read is no longer open', async () => {
    const server = tailServer({ count: 60 });
    let open = true;
    const request: CodexHistoryRequest = async (method, params) => {
      const result = await server.request(method, params);
      if (method === 'thread/turns/list') open = false;
      return result;
    };
    await expect(readCodexSessionTail('root', request, () => {
      if (!open) throw new Error('Codex history read aborted');
    }, TAIL_BOUND)).rejects.toThrow('aborted');
    expect(callsOf(server.calls, 'thread/turns/list')).toHaveLength(1);
  });
});
