import { mergeCompletionKeyShards, mergeOutboxShards } from './parent-shard-merge';

describe('parent shard merge', () => {
  it('keeps the session outbox entries and adds the tab entries by dedupe key', () => {
    const session = { version: 1, entries: [{ dedupeKey: 'a', body: 'session' }] };
    const tab = { version: 1, entries: [{ dedupeKey: 'a', body: 'tab' }, { dedupeKey: 'b' }] };

    expect(mergeOutboxShards(session, tab)).toEqual({
      version: 1,
      entries: [{ dedupeKey: 'a', body: 'session' }, { dedupeKey: 'b' }],
    });
  });

  it('moves the tab shard as is when the session has none', () => {
    const tab = { version: 1, keys: [{ dedupeKey: 'a', state: 'accepted', at: 1 }] };

    expect(mergeCompletionKeyShards(undefined, tab)).toEqual(tab);
  });

  it('keeps an entry without a readable key instead of dropping it', () => {
    const session = { version: 1, keys: [{ dedupeKey: 'a', state: 'accepted', at: 1 }] };
    const tab = { version: 1, keys: [{ broken: true }] };

    expect(mergeCompletionKeyShards(session, tab).keys).toEqual([
      { dedupeKey: 'a', state: 'accepted', at: 1 }, { broken: true },
    ]);
  });

  it('throws on a malformed shard container', () => {
    expect(() => mergeOutboxShards({ version: 2, entries: [] }, { version: 1, entries: [] }))
      .toThrow();
  });
});
