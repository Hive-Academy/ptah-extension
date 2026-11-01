import { readCodexSessionHistory, type CodexHistoryRequest } from './codex-session-history';
import { CodexRequestRejectedError } from './codex-app-server-process';
import { validateCodexResult } from './codex-protocol-validator';

// Hand-built from the pinned schema. Live paginated/child shape is UNCONFIRMED.
const root = {
  id: 'root', cliVersion: '0.165.0', createdAt: 1, updatedAt: 3,
  cwd: '/work', ephemeral: false, modelProvider: 'openai', preview: '',
  projectId: null, sessionId: 'session', source: 'appServer',
  status: { type: 'idle' }, turns: [], historyMode: 'paginated',
};
const child = { ...root, id: 'child', createdAt: 2, parentThreadId: 'root', sessionId: 'child-session' };
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
} = {}, calls: string[] = []): CodexHistoryRequest {
  return async (method, params) => {
    calls.push(method);
    if (overrides.missing && method === 'thread/read')
      throw new CodexRequestRejectedError('thread/read', -1, 'codexRequestRejected', true);
    const id = 'threadId' in params ? params.threadId : undefined;
    let result: unknown;
    switch (method) {
      case 'thread/read':
        result = { thread: id === 'child' ? child : overrides.legacy
          ? { ...root, historyMode: 'legacy', turns: 'includeTurns' in params && params.includeTurns
            ? [{ ...turn('r1'), itemsView: undefined, items: [entry('r1', 'embedded').item] }]
            : [] }
          : overrides.subAgentRoot ? { ...root, parentThreadId: 'parent' } : root };
        break;
      case 'thread/list':
        result = 'archived' in params && params.archived ? { data: [] } : {
          data: overrides.orphan
            ? [{ ...child, id: 'orphan', parentThreadId: 'missing', sessionId: root.sessionId }]
            : overrides.cycle
              ? [{ ...child, id: 'a', parentThreadId: 'b' }, { ...child, id: 'b', parentThreadId: 'a' }]
            : overrides.unrelated
              ? [{ ...child, id: 'unrelated', parentThreadId: 'elsewhere', sessionId: 'another-session' }]
            : overrides.legacy ? [] : [child],
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
  it('hydrates root and child in order, including every turn and item page', async () => {
    const snapshot = await readCodexSessionHistory('root', fixture(), () => undefined);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(['root', 'child']);
    expect(snapshot.threads[0].turns.map((value) => value.id)).toEqual(['r1', 'r2']);
    expect(snapshot.threads[0].turns[0].items.map((item) => item.id)).toEqual(['r1-a', 'r1-b']);
    expect(snapshot.threads[0].turns[0].itemEntries?.[0].startedAtMs).toBe(10);
    expect(snapshot.threads[1].turns[1].items.map((item) => item.id)).toEqual(['c2-a', 'c2-b']);
  });

  it('reports a repeated cursor', async () => {
    await expect(readCodexSessionHistory('root', fixture({ repeatCursor: true }), () => undefined))
      .rejects.toMatchObject({ code: 'stalledCursor' });
  });

  it('reports a malformed item page', async () => {
    await expect(readCodexSessionHistory('root', fixture({ malformed: true }), () => undefined))
      .rejects.toMatchObject({ code: 'malformedPage' });
  });

  it('never returns empty history for a missing thread', async () => {
    await expect(readCodexSessionHistory('root', fixture({ missing: true }), () => undefined))
      .rejects.toMatchObject({ code: 'threadNotFound' });
  });

  it('excludes orphan threads even when they share the root session id', async () => {
    const snapshot = await readCodexSessionHistory('root', fixture({ orphan: true }), () => undefined);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(['root']);
  });

  it.each([{ cycle: true }, { unrelated: true }])('excludes unreachable threads', async (overrides) => {
    const snapshot = await readCodexSessionHistory('root', fixture(overrides), () => undefined);
    expect(snapshot.threads.map((thread) => thread.id)).toEqual(['root']);
  });

  it('accepts a sub-agent thread as the requested root', async () => {
    const snapshot = await readCodexSessionHistory('root', fixture({ subAgentRoot: true }), () => undefined);
    expect(snapshot.threads[0].parentThreadId).toBe('parent');
  });

  it('keeps embedded legacy items without calling the item page endpoint', async () => {
    const calls: string[] = [];
    const snapshot = await readCodexSessionHistory('root', fixture({ legacy: true }, calls), () => undefined);
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
    await expect(readCodexSessionHistory('root', fixture(overrides), () => undefined))
      .rejects.toMatchObject({ code });
  });
});
