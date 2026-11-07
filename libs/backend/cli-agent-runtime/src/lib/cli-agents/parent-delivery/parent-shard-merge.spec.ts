import { AgentId } from '@ptah-extension/shared';
import type { ParentCompletionOutboxEntry } from './parent-envelope.schema';
import { mergeCompletionKeyShards, mergeOutboxShards } from './parent-shard-merge';

const AGENT = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
const SESSION = 'session-1';
const TAB = 'tab-1';

function entry(dedupeKey: string, parentSessionId: string, body = 'body'): ParentCompletionOutboxEntry {
  return {
    dedupeKey, agentId: AGENT, parentSessionId, completedAt: '2026-11-07T00:00:00.000Z',
    body, verdict: 'delivered', originName: 'codex · lane', createdAt: Date.UTC(2026, 10, 7),
  };
}

describe('parent shard merge', () => {
  it('keeps the session outbox entries and adds the tab entries by dedupe key', () => {
    const session = { version: 1, entries: [entry('a', SESSION, 'session')] };
    const tab = { version: 1, entries: [entry('a', TAB, 'tab'), entry('b', TAB)] };

    expect(mergeOutboxShards(session, tab, SESSION)).toEqual({
      version: 1,
      entries: [entry('a', SESSION, 'session'), entry('b', SESSION)],
    });
  });

  it('re-addresses every valid moved outbox entry to the session', () => {
    const tab = { version: 1, entries: [entry('a', TAB), entry('b', TAB)] };

    const merged = mergeOutboxShards(undefined, tab, SESSION);

    expect(merged.entries).toEqual([entry('a', SESSION), entry('b', SESSION)]);
  });

  it('does not let a malformed destination entry suppress a valid moved entry', () => {
    const malformed = { dedupeKey: 'a' };
    const session = { version: 1, entries: [malformed] };
    const tab = { version: 1, entries: [entry('a', TAB)] };

    expect(mergeOutboxShards(session, tab, SESSION).entries).toEqual([
      malformed,
      entry('a', SESSION),
    ]);
  });

  it('keeps a malformed moved outbox entry as it is', () => {
    const tab = { version: 1, entries: [{ broken: true }] };

    expect(mergeOutboxShards(undefined, tab, SESSION).entries).toEqual([{ broken: true }]);
  });

  it('moves the tab key shard as is when the session has none', () => {
    const tab = { version: 1, keys: [{ dedupeKey: 'a', state: 'accepted', at: 1 }] };

    expect(mergeCompletionKeyShards(undefined, tab)).toEqual(tab);
  });

  it('keeps a key entry without a readable key instead of dropping it', () => {
    const session = { version: 1, keys: [{ dedupeKey: 'a', state: 'accepted', at: 1 }] };
    const tab = { version: 1, keys: [{ broken: true }] };

    expect(mergeCompletionKeyShards(session, tab).keys).toEqual([
      { dedupeKey: 'a', state: 'accepted', at: 1 }, { broken: true },
    ]);
  });

  it('throws on a malformed shard container', () => {
    expect(() => mergeOutboxShards({ version: 2, entries: [] }, { version: 1, entries: [] }, SESSION))
      .toThrow();
  });
});
